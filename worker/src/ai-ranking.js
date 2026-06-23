import {
  createSessionToken,
  hashSessionToken
} from "./auth.js";

export const AI_DIFFICULTIES = Object.freeze([
  "easy",
  "normal",
  "hard",
  "superhard",
  "extreme",
  "hell",
  "chaos"
]);

export const AI_RANKING_MODES = Object.freeze(["speed", "item"]);

const GAME_SESSION_TTL_MS = 6 * 60 * 60 * 1000;
const SUBMISSION_CLOCK_TOLERANCE_MS = 10 * 1000;
const MIN_CLEAR_TIME_MS = 1000;
const MAX_CLEAR_TIME_MS = 6 * 60 * 60 * 1000;

function integer(value) {
  return Number.isInteger(value) ? value : NaN;
}

export function validateGameConfig(body) {
  const difficulty = String(body?.difficulty || "").toLowerCase();
  const mode = String(body?.mode || "").toLowerCase();
  const ghostMode = body?.ghostMode === true;

  if (!AI_DIFFICULTIES.includes(difficulty)) {
    return {
      ok: false,
      code: "invalid_difficulty",
      message: "지원하지 않는 AI 난이도입니다."
    };
  }

  if (!AI_RANKING_MODES.includes(mode)) {
    return {
      ok: false,
      code: "invalid_mode",
      message: "지원하지 않는 게임 모드입니다."
    };
  }

  return { ok: true, difficulty, mode, ghostMode };
}

export function validateResultPayload(body) {
  const sessionId = String(body?.sessionId || "");
  const submissionToken = String(body?.submissionToken || "");
  const clearTimeMs = integer(body?.clearTimeMs);
  const territoryBasisPoints = integer(body?.territoryBasisPoints);

  if (!/^[0-9a-f-]{36}$/i.test(sessionId) || !/^[A-Za-z0-9_-]{32,}$/.test(submissionToken)) {
    return {
      ok: false,
      code: "invalid_game_session",
      message: "게임 시작 세션 정보가 올바르지 않습니다."
    };
  }

  if (
    !Number.isFinite(clearTimeMs)
    || clearTimeMs < MIN_CLEAR_TIME_MS
    || clearTimeMs > MAX_CLEAR_TIME_MS
  ) {
    return {
      ok: false,
      code: "invalid_clear_time",
      message: "클리어 시간이 올바르지 않습니다."
    };
  }

  if (
    !Number.isFinite(territoryBasisPoints)
    || territoryBasisPoints < 0
    || territoryBasisPoints > 10000
  ) {
    return {
      ok: false,
      code: "invalid_territory_rate",
      message: "점령률이 올바르지 않습니다."
    };
  }

  return {
    ok: true,
    sessionId,
    submissionToken,
    clearTimeMs,
    territoryBasisPoints
  };
}

export async function createAiGameSession(env, userUid, body) {
  const config = validateGameConfig(body);
  if (!config.ok) return config;

  const now = Date.now();
  const sessionId = crypto.randomUUID();
  const submissionToken = createSessionToken();
  const submissionTokenHash = await hashSessionToken(
    submissionToken,
    env.SESSION_PEPPER
  );

  await env.DB.prepare(`
    INSERT INTO ai_game_sessions (
      session_id,
      submission_token_hash,
      user_uid,
      difficulty,
      mode,
      ghost_mode,
      started_at,
      expires_at,
      submitted_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)
  `).bind(
    sessionId,
    submissionTokenHash,
    userUid,
    config.difficulty,
    config.mode,
    config.ghostMode ? 1 : 0,
    now,
    now + GAME_SESSION_TTL_MS
  ).run();

  return {
    ok: true,
    sessionId,
    submissionToken,
    startedAt: now,
    expiresAt: now + GAME_SESSION_TTL_MS,
    difficulty: config.difficulty,
    mode: config.mode,
    ghostMode: config.ghostMode
  };
}

function isDuplicateSubmissionError(error) {
  return /UNIQUE constraint failed.*ai_rank_submissions/i.test(
    String(error?.message || error)
  );
}

export async function submitAiRankingResult(env, userUid, body) {
  const payload = validateResultPayload(body);
  if (!payload.ok) return payload;

  const now = Date.now();
  const submissionTokenHash = await hashSessionToken(
    payload.submissionToken,
    env.SESSION_PEPPER
  );
  const gameSession = await env.DB.prepare(`
    SELECT
      session_id,
      user_uid,
      difficulty,
      mode,
      ghost_mode,
      started_at,
      expires_at,
      submitted_at
    FROM ai_game_sessions
    WHERE session_id = ?
      AND submission_token_hash = ?
    LIMIT 1
  `).bind(payload.sessionId, submissionTokenHash).first();

  if (!gameSession || gameSession.user_uid !== userUid) {
    return {
      ok: false,
      code: "invalid_game_session",
      message: "유효한 게임 시작 세션을 찾을 수 없습니다."
    };
  }

  if (gameSession.submitted_at !== null) {
    return {
      ok: false,
      code: "duplicate_submission",
      message: "이미 제출된 게임 기록입니다."
    };
  }

  if (gameSession.expires_at <= now) {
    return {
      ok: false,
      code: "game_session_expired",
      message: "게임 시작 세션이 만료되었습니다."
    };
  }

  const serverElapsedMs = Math.max(0, now - gameSession.started_at);
  if (payload.clearTimeMs > serverElapsedMs + SUBMISSION_CLOCK_TOLERANCE_MS) {
    return {
      ok: false,
      code: "invalid_clear_time",
      message: "게임 세션 시간보다 긴 클리어 기록은 제출할 수 없습니다."
    };
  }

  const submissionId = crypto.randomUUID();

  try {
    const results = await env.DB.batch([
      env.DB.prepare(`
        INSERT INTO ai_rank_submissions (
          submission_id,
          game_session_id,
          user_uid,
          difficulty,
          mode,
          ghost_mode,
          clear_time_ms,
          territory_basis_points,
          submitted_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        submissionId,
        gameSession.session_id,
        userUid,
        gameSession.difficulty,
        gameSession.mode,
        gameSession.ghost_mode,
        payload.clearTimeMs,
        payload.territoryBasisPoints,
        now
      ),
      env.DB.prepare(`
        INSERT INTO ai_best_records (
          user_uid,
          difficulty,
          mode,
          submission_id,
          clear_time_ms,
          territory_basis_points,
          ghost_mode,
          achieved_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (user_uid, difficulty, mode) DO UPDATE SET
          submission_id = excluded.submission_id,
          clear_time_ms = excluded.clear_time_ms,
          territory_basis_points = excluded.territory_basis_points,
          ghost_mode = excluded.ghost_mode,
          achieved_at = excluded.achieved_at
        WHERE excluded.clear_time_ms < ai_best_records.clear_time_ms
           OR (
             excluded.clear_time_ms = ai_best_records.clear_time_ms
             AND excluded.territory_basis_points > ai_best_records.territory_basis_points
           )
      `).bind(
        userUid,
        gameSession.difficulty,
        gameSession.mode,
        submissionId,
        payload.clearTimeMs,
        payload.territoryBasisPoints,
        gameSession.ghost_mode,
        now
      ),
      env.DB.prepare(`
        UPDATE ai_game_sessions
        SET submitted_at = ?
        WHERE session_id = ?
          AND submitted_at IS NULL
      `).bind(now, gameSession.session_id)
    ]);

    return {
      ok: true,
      accepted: true,
      bestUpdated: results[1]?.meta?.changes === 1,
      difficulty: gameSession.difficulty,
      mode: gameSession.mode
    };
  } catch (error) {
    if (isDuplicateSubmissionError(error)) {
      return {
        ok: false,
        code: "duplicate_submission",
        message: "이미 제출된 게임 기록입니다."
      };
    }
    throw error;
  }
}

function publicRankingRow(row, rank) {
  return {
    rank,
    nickname: row.nickname,
    profileColor: row.profile_color,
    clearTimeMs: row.clear_time_ms,
    territoryBasisPoints: row.territory_basis_points,
    ghostMode: row.ghost_mode === 1,
    achievedAt: row.achieved_at
  };
}

export async function getAiRanking(env, userUid, difficulty, mode) {
  const config = validateGameConfig({ difficulty, mode, ghostMode: false });
  if (!config.ok) return config;

  const [topResult, myRecord] = await env.DB.batch([
    env.DB.prepare(`
      SELECT
        records.user_uid,
        records.clear_time_ms,
        records.territory_basis_points,
        records.ghost_mode,
        records.achieved_at,
        users.nickname,
        users.profile_color
      FROM ai_best_records AS records
      INNER JOIN users ON users.uid = records.user_uid
      WHERE records.difficulty = ?
        AND records.mode = ?
        AND users.status = 'active'
        AND users.nickname IS NOT NULL
      ORDER BY
        records.clear_time_ms ASC,
        records.territory_basis_points DESC,
        records.achieved_at ASC,
        records.user_uid ASC
      LIMIT 100
    `).bind(config.difficulty, config.mode),
    env.DB.prepare(`
      SELECT
        records.user_uid,
        records.clear_time_ms,
        records.territory_basis_points,
        records.ghost_mode,
        records.achieved_at,
        users.nickname,
        users.profile_color
      FROM ai_best_records AS records
      INNER JOIN users ON users.uid = records.user_uid
      WHERE records.user_uid = ?
        AND records.difficulty = ?
        AND records.mode = ?
        AND users.status = 'active'
        AND users.nickname IS NOT NULL
      LIMIT 1
    `).bind(userUid, config.difficulty, config.mode)
  ]);

  const top = (topResult.results || []).map((row, index) =>
    publicRankingRow(row, index + 1)
  );

  let me = null;
  const myRow = myRecord.results?.[0] || null;
  if (myRow) {
    const betterCount = await env.DB.prepare(`
      SELECT COUNT(*) AS count
      FROM ai_best_records AS records
      INNER JOIN users ON users.uid = records.user_uid
      WHERE records.difficulty = ?
        AND records.mode = ?
        AND users.status = 'active'
        AND users.nickname IS NOT NULL
        AND (
          records.clear_time_ms < ?
          OR (
            records.clear_time_ms = ?
            AND records.territory_basis_points > ?
          )
          OR (
            records.clear_time_ms = ?
            AND records.territory_basis_points = ?
            AND records.achieved_at < ?
          )
          OR (
            records.clear_time_ms = ?
            AND records.territory_basis_points = ?
            AND records.achieved_at = ?
            AND records.user_uid < ?
          )
        )
    `).bind(
      config.difficulty,
      config.mode,
      myRow.clear_time_ms,
      myRow.clear_time_ms,
      myRow.territory_basis_points,
      myRow.clear_time_ms,
      myRow.territory_basis_points,
      myRow.achieved_at,
      myRow.clear_time_ms,
      myRow.territory_basis_points,
      myRow.achieved_at,
      userUid
    ).first();

    me = publicRankingRow(myRow, Number(betterCount?.count || 0) + 1);
  }

  return {
    ok: true,
    difficulty: config.difficulty,
    mode: config.mode,
    top,
    me
  };
}
