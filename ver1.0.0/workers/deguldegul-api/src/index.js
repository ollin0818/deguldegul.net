const SESSION_TTL_SECONDS = 60 * 60 * 24 * 180;
const AI_SESSION_TTL_SECONDS = 60 * 60 * 3;
const DIFFICULTIES = new Set(["easy", "normal", "hard", "superhard", "extreme", "hell", "chaos"]);
const MODES = new Set(["speed", "item"]);
const GOOGLE_ISSUERS = new Set(["https://accounts.google.com", "accounts.google.com"]);

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

function corsHeaders(request, env) {
  const origin = request.headers.get("Origin") || "";
  const allowed = String(env.ALLOWED_ORIGINS || "")
    .split(",")
    .map(item => item.trim())
    .filter(Boolean);
  const allowOrigin = allowed.includes(origin) ? origin : allowed[0] || "*";
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Accept, Authorization",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin"
  };
}

function json(request, env, data, status = 200) {
  return Response.json(data, {
    status,
    headers: {
      ...corsHeaders(request, env),
      "Cache-Control": "no-store"
    }
  });
}

function options(request, env) {
  return new Response(null, { status: 204, headers: corsHeaders(request, env) });
}

function fail(request, env, status, code, message) {
  return json(request, env, { ok: false, error: { code, message } }, status);
}

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

function base64UrlToBytes(value) {
  const normalized = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function base64UrlToJson(value) {
  return JSON.parse(new TextDecoder().decode(base64UrlToBytes(value)));
}

function bytesToBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function randomToken(bytes = 32) {
  const data = new Uint8Array(bytes);
  crypto.getRandomValues(data);
  return bytesToBase64Url(data);
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

async function sessionHash(token, env) {
  return sha256Hex(`${token}.${env.SESSION_PEPPER || ""}`);
}

function publicUser(row) {
  if (!row) return null;
  return {
    id: row.uid,
    nickname: row.nickname || null,
    profileColor: row.profile_color || "#64beff",
    createdAt: row.created_at || null,
    role: row.role || null,
    googleLinked: Boolean(row.google_sub),
    googleEmail: row.google_email || null,
    googleName: row.google_name || null,
    googlePicture: row.google_picture || null
  };
}

function normalizeNickname(value) {
  return String(value || "").normalize("NFC").trim().replace(/\s+/gu, " ");
}

function nicknameKey(value) {
  return normalizeNickname(value).toLocaleLowerCase("ko-KR");
}

function validProfileColor(value) {
  const color = String(value || "").trim();
  return /^#[0-9a-f]{6}$/i.test(color) ? color.toLowerCase() : "#64beff";
}

async function getUserByUid(env, uid) {
  return env.DB.prepare("SELECT * FROM users WHERE uid = ? AND status = 'active'").bind(uid).first();
}

async function getBearerSession(request, env) {
  const authorization = request.headers.get("Authorization") || "";
  const token = authorization.match(/^Bearer\s+(.+)$/i)?.[1] || "";
  if (!token) return null;
  const hash = await sessionHash(token, env);
  const current = nowSeconds();
  const row = await env.DB.prepare(
    `SELECT sessions.*, users.*
     FROM sessions
     JOIN users ON users.uid = sessions.user_uid
     WHERE sessions.session_hash = ?
       AND sessions.revoked_at IS NULL
       AND sessions.expires_at > ?
       AND users.status = 'active'`
  ).bind(hash, current).first();
  if (!row) return null;
  await env.DB.prepare("UPDATE sessions SET last_seen_at = ? WHERE session_hash = ?").bind(current, hash).run();
  await env.DB.prepare("UPDATE users SET last_seen_at = ? WHERE uid = ?").bind(current, row.user_uid).run();
  return { token, sessionHash: hash, user: row };
}

async function createSession(env, userUid) {
  const token = randomToken(32);
  const current = nowSeconds();
  const expiresAt = current + SESSION_TTL_SECONDS;
  await env.DB.prepare(
    `INSERT INTO sessions (session_hash, user_uid, created_at, last_seen_at, expires_at)
     VALUES (?, ?, ?, ?, ?)`
  ).bind(await sessionHash(token, env), userUid, current, current, expiresAt).run();
  return { token, expiresAt };
}

async function createGuestUser(env) {
  const uid = crypto.randomUUID();
  const current = nowSeconds();
  await env.DB.prepare(
    `INSERT INTO users (uid, nickname, nickname_key, status, created_at, updated_at, last_seen_at, profile_color)
     VALUES (?, NULL, NULL, 'active', ?, ?, ?, '#64beff')`
  ).bind(uid, current, current, current).run();
  return getUserByUid(env, uid);
}

async function authGuest(request, env) {
  const existing = await getBearerSession(request, env);
  const user = existing?.user || await createGuestUser(env);
  const session = existing ? { token: existing.token, expiresAt: existing.user.expires_at } : await createSession(env, user.uid);
  return json(request, env, {
    ok: true,
    authenticated: true,
    needsNickname: !user.nickname,
    sessionToken: session.token,
    expiresAt: session.expiresAt,
    user: publicUser(user)
  }, 201);
}

async function authSession(request, env) {
  const session = await getBearerSession(request, env);
  if (!session) return fail(request, env, 401, "unauthorized", "로그인이 필요합니다.");
  return json(request, env, {
    ok: true,
    authenticated: true,
    needsNickname: !session.user.nickname,
    user: publicUser(session.user)
  });
}

async function setNickname(request, env) {
  const session = await getBearerSession(request, env);
  if (!session) return fail(request, env, 401, "unauthorized", "로그인이 필요합니다.");
  const body = await readJson(request);
  const nickname = normalizeNickname(body.nickname);
  const length = Array.from(nickname).length;
  if (length < 2 || length > 12) {
    return fail(request, env, 400, "invalid_nickname", "닉네임은 2자 이상 12자 이하로 입력해주세요.");
  }
  const color = validProfileColor(body.profileColor || session.user.profile_color);
  const current = nowSeconds();
  try {
    await env.DB.prepare(
      `UPDATE users
       SET nickname = ?, nickname_key = ?, profile_color = ?, updated_at = ?, last_seen_at = ?
       WHERE uid = ? AND status = 'active'`
    ).bind(nickname, nicknameKey(nickname), color, current, current, session.user.uid).run();
  } catch (error) {
    if (String(error?.message || "").includes("UNIQUE")) {
      return fail(request, env, 409, "nickname_taken", "닉네임 중복입니다.");
    }
    throw error;
  }
  const user = await getUserByUid(env, session.user.uid);
  return json(request, env, {
    ok: true,
    authenticated: true,
    needsNickname: false,
    user: publicUser(user)
  });
}

async function updateProfile(request, env) {
  const session = await getBearerSession(request, env);
  if (!session) return fail(request, env, 401, "unauthorized", "로그인이 필요합니다.");
  const body = await readJson(request);
  const color = validProfileColor(body.profileColor);
  const current = nowSeconds();
  await env.DB.prepare(
    "UPDATE users SET profile_color = ?, updated_at = ?, last_seen_at = ? WHERE uid = ? AND status = 'active'"
  ).bind(color, current, current, session.user.uid).run();
  const user = await getUserByUid(env, session.user.uid);
  return json(request, env, { ok: true, authenticated: true, user: publicUser(user) });
}

async function getGoogleJwk(kid) {
  const response = await fetch("https://www.googleapis.com/oauth2/v3/certs", {
    headers: { Accept: "application/json" },
    cf: { cacheTtl: 3600, cacheEverything: true }
  });
  const data = await response.json();
  return data.keys?.find(key => key.kid === kid);
}

async function verifyGoogleCredential(credential, env) {
  const clientId = String(env.GOOGLE_CLIENT_ID || "").trim();
  if (!clientId) {
    const error = new Error("Google 로그인이 아직 설정되지 않았습니다.");
    error.code = "google_not_configured";
    error.status = 503;
    throw error;
  }
  const parts = String(credential || "").split(".");
  if (parts.length !== 3) {
    const error = new Error("Google 인증 토큰이 올바르지 않습니다.");
    error.code = "invalid_google_credential";
    error.status = 400;
    throw error;
  }
  const header = base64UrlToJson(parts[0]);
  const payload = base64UrlToJson(parts[1]);
  if (header.alg !== "RS256" || !header.kid) {
    const error = new Error("지원하지 않는 Google 인증 토큰입니다.");
    error.code = "invalid_google_header";
    error.status = 400;
    throw error;
  }
  const jwk = await getGoogleJwk(header.kid);
  if (!jwk) {
    const error = new Error("Google 인증 키를 확인하지 못했습니다.");
    error.code = "google_key_not_found";
    error.status = 401;
    throw error;
  }
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const valid = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    base64UrlToBytes(parts[2]),
    new TextEncoder().encode(`${parts[0]}.${parts[1]}`)
  );
  const current = nowSeconds();
  if (!valid || !GOOGLE_ISSUERS.has(payload.iss) || payload.aud !== clientId || Number(payload.exp || 0) <= current) {
    const error = new Error("Google 인증을 검증하지 못했습니다.");
    error.code = "google_verification_failed";
    error.status = 401;
    throw error;
  }
  if (payload.email_verified !== true && payload.email_verified !== "true") {
    const error = new Error("검증된 Google 이메일만 연결할 수 있습니다.");
    error.code = "google_email_unverified";
    error.status = 403;
    throw error;
  }
  return {
    sub: String(payload.sub || ""),
    email: String(payload.email || ""),
    name: String(payload.name || ""),
    picture: String(payload.picture || "")
  };
}

async function authGoogle(request, env) {
  const body = await readJson(request);
  let google;
  try {
    google = await verifyGoogleCredential(body.credential, env);
  } catch (error) {
    return fail(request, env, error.status || 401, error.code || "google_auth_failed", error.message || "Google 인증에 실패했습니다.");
  }
  if (!google.sub) return fail(request, env, 401, "google_sub_missing", "Google 계정 식별자를 확인하지 못했습니다.");

  const current = nowSeconds();
  const session = await getBearerSession(request, env);
  let user = await env.DB.prepare("SELECT * FROM users WHERE google_sub = ? AND status = 'active'").bind(google.sub).first();

  if (session?.user && user && user.uid !== session.user.uid) {
    return fail(request, env, 409, "google_already_linked", "이미 다른 프로필에 연결된 Google 계정입니다.");
  }

  if (session?.user && !user) {
    await env.DB.prepare(
      `UPDATE users
       SET google_sub = ?, google_email = ?, google_name = ?, google_picture = ?, updated_at = ?, last_seen_at = ?
       WHERE uid = ? AND status = 'active'`
    ).bind(google.sub, google.email, google.name, google.picture, current, current, session.user.uid).run();
    user = await getUserByUid(env, session.user.uid);
  }

  if (!user) {
    const uid = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO users (
        uid, nickname, nickname_key, status, created_at, updated_at, last_seen_at, profile_color,
        google_sub, google_email, google_name, google_picture
      ) VALUES (?, NULL, NULL, 'active', ?, ?, ?, '#64beff', ?, ?, ?, ?)`
    ).bind(uid, current, current, current, google.sub, google.email, google.name, google.picture).run();
    user = await getUserByUid(env, uid);
  } else {
    await env.DB.prepare(
      "UPDATE users SET google_email = ?, google_name = ?, google_picture = ?, updated_at = ?, last_seen_at = ? WHERE uid = ?"
    ).bind(google.email, google.name, google.picture, current, current, user.uid).run();
    user = await getUserByUid(env, user.uid);
  }

  const newSession = await createSession(env, user.uid);
  return json(request, env, {
    ok: true,
    authenticated: true,
    needsNickname: !user.nickname,
    sessionToken: newSession.token,
    expiresAt: newSession.expiresAt,
    user: publicUser(user)
  });
}

function googleConfig(request, env) {
  const clientId = String(env.GOOGLE_CLIENT_ID || "").trim();
  return json(request, env, {
    ok: true,
    enabled: Boolean(clientId),
    clientId
  });
}

function sanitizeDifficulty(value) {
  const difficulty = String(value || "easy");
  return DIFFICULTIES.has(difficulty) ? difficulty : "easy";
}

function sanitizeMode(value) {
  const mode = String(value || "speed");
  return MODES.has(mode) ? mode : "speed";
}

async function createAiSession(request, env) {
  const session = await getBearerSession(request, env);
  if (!session?.user?.nickname) return fail(request, env, 401, "nickname_required", "닉네임 등록이 필요합니다.");
  const body = await readJson(request);
  const current = nowSeconds();
  const sessionId = crypto.randomUUID();
  const submissionToken = randomToken(32);
  await env.DB.prepare(
    `INSERT INTO ai_game_sessions (
      session_id, submission_token_hash, user_uid, difficulty, mode, ghost_mode, started_at, expires_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    sessionId,
    await sessionHash(submissionToken, env),
    session.user.uid,
    sanitizeDifficulty(body.difficulty),
    sanitizeMode(body.mode),
    body.ghostMode === true ? 1 : 0,
    current,
    current + AI_SESSION_TTL_SECONDS
  ).run();
  return json(request, env, { ok: true, sessionId, submissionToken });
}

async function submitAiResult(request, env) {
  const session = await getBearerSession(request, env);
  if (!session?.user?.nickname) return fail(request, env, 401, "nickname_required", "닉네임 등록이 필요합니다.");
  const body = await readJson(request);
  const tokenHash = await sessionHash(body.submissionToken || "", env);
  const current = nowSeconds();
  const game = await env.DB.prepare(
    `SELECT * FROM ai_game_sessions
     WHERE session_id = ? AND submission_token_hash = ? AND user_uid = ? AND submitted_at IS NULL AND expires_at > ?`
  ).bind(body.sessionId || "", tokenHash, session.user.uid, current).first();
  if (!game) return fail(request, env, 409, "invalid_game_session", "제출 가능한 게임 세션이 없습니다.");

  const clearTimeMs = Math.round(Number(body.clearTimeMs) || 0);
  const territoryBasisPoints = Math.round(Number(body.territoryBasisPoints) || 0);
  if (clearTimeMs < 1000 || clearTimeMs > 21600000 || territoryBasisPoints < 0 || territoryBasisPoints > 10000) {
    return fail(request, env, 400, "invalid_result", "랭킹 기록 값이 올바르지 않습니다.");
  }

  const submissionId = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare("UPDATE ai_game_sessions SET submitted_at = ? WHERE session_id = ?").bind(current, game.session_id),
    env.DB.prepare(
      `INSERT INTO ai_rank_submissions (
        submission_id, game_session_id, user_uid, difficulty, mode, ghost_mode,
        clear_time_ms, territory_basis_points, submitted_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      submissionId,
      game.session_id,
      session.user.uid,
      game.difficulty,
      game.mode,
      game.ghost_mode,
      clearTimeMs,
      territoryBasisPoints,
      current
    )
  ]);

  const best = await env.DB.prepare(
    "SELECT * FROM ai_best_records WHERE user_uid = ? AND difficulty = ? AND mode = ?"
  ).bind(session.user.uid, game.difficulty, game.mode).first();
  const isBetter = !best
    || clearTimeMs < best.clear_time_ms
    || (clearTimeMs === best.clear_time_ms && territoryBasisPoints > best.territory_basis_points);
  if (isBetter) {
    await env.DB.prepare(
      `INSERT INTO ai_best_records (
        user_uid, difficulty, mode, submission_id, clear_time_ms, territory_basis_points, ghost_mode, achieved_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_uid, difficulty, mode) DO UPDATE SET
        submission_id = excluded.submission_id,
        clear_time_ms = excluded.clear_time_ms,
        territory_basis_points = excluded.territory_basis_points,
        ghost_mode = excluded.ghost_mode,
        achieved_at = excluded.achieved_at`
    ).bind(
      session.user.uid,
      game.difficulty,
      game.mode,
      submissionId,
      clearTimeMs,
      territoryBasisPoints,
      game.ghost_mode,
      current
    ).run();
  }
  return json(request, env, { ok: true, submitted: true, bestUpdated: isBetter });
}

async function getRankings(request, env) {
  const session = await getBearerSession(request, env);
  if (!session?.user?.nickname) return fail(request, env, 401, "nickname_required", "닉네임 등록이 필요합니다.");
  const url = new URL(request.url);
  const difficulty = sanitizeDifficulty(url.searchParams.get("difficulty"));
  const mode = sanitizeMode(url.searchParams.get("mode"));
  const rows = await env.DB.prepare(
    `SELECT ai_best_records.*, users.nickname, users.profile_color
     FROM ai_best_records
     JOIN users ON users.uid = ai_best_records.user_uid
     WHERE ai_best_records.difficulty = ? AND ai_best_records.mode = ? AND users.status = 'active'
     ORDER BY clear_time_ms ASC, territory_basis_points DESC, achieved_at ASC, user_uid ASC
     LIMIT 100`
  ).bind(difficulty, mode).all();
  const top = (rows.results || []).map((row, index) => ({
    rank: index + 1,
    nickname: row.nickname,
    profileColor: row.profile_color || "#64beff",
    clearTimeMs: row.clear_time_ms,
    territoryBasisPoints: row.territory_basis_points,
    ghostMode: row.ghost_mode === 1,
    achievedAt: row.achieved_at
  }));
  const ownIndex = (rows.results || []).findIndex(row => row.user_uid === session.user.uid);
  const own = ownIndex >= 0 ? rows.results[ownIndex] : null;
  return json(request, env, {
    ok: true,
    difficulty,
    mode,
    top,
    me: own ? {
      rank: ownIndex + 1,
      nickname: own.nickname,
      clearTimeMs: own.clear_time_ms,
      territoryBasisPoints: own.territory_basis_points,
      ghostMode: own.ghost_mode === 1,
      achievedAt: own.achieved_at
    } : null
  });
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return options(request, env);
    const url = new URL(request.url);
    try {
      if (request.method === "POST" && url.pathname === "/api/auth/guest") return authGuest(request, env);
      if (request.method === "GET" && url.pathname === "/api/auth/session") return authSession(request, env);
      if (request.method === "POST" && url.pathname === "/api/auth/nickname") return setNickname(request, env);
      if (request.method === "POST" && url.pathname === "/api/auth/profile") return updateProfile(request, env);
      if (request.method === "GET" && url.pathname === "/api/auth/google/config") return googleConfig(request, env);
      if (request.method === "POST" && url.pathname === "/api/auth/google") return authGoogle(request, env);
      if (request.method === "POST" && url.pathname === "/api/ai/sessions") return createAiSession(request, env);
      if (request.method === "POST" && url.pathname === "/api/ai/results") return submitAiResult(request, env);
      if (request.method === "GET" && url.pathname === "/api/ai/rankings") return getRankings(request, env);
      return fail(request, env, 404, "not_found", "API를 찾을 수 없습니다.");
    } catch (error) {
      console.error(error);
      return fail(request, env, 500, "internal_error", "서버 오류가 발생했습니다.");
    }
  }
};
