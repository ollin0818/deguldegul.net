import {
  createGuestSession,
  findSessionUser,
  getBearerToken,
  publicUser,
  registerNickname,
  updateProfileColor
} from "./auth.js";
import {
  createAiGameSession,
  getAiRanking,
  submitAiRankingResult
} from "./ai-ranking.js";

function allowedOrigins(env) {
  return new Set(
    String(env.ALLOWED_ORIGINS || "https://deguldegul.net")
      .split(",")
      .map(value => value.trim())
      .filter(Boolean)
  );
}

function corsHeaders(request, env) {
  const origin = request.headers.get("Origin");
  const headers = new Headers({
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    "Cache-Control": "no-store",
    "Vary": "Origin"
  });

  if (origin && allowedOrigins(env).has(origin)) {
    headers.set("Access-Control-Allow-Origin", origin);
  }

  return headers;
}

function json(request, env, data, status = 200) {
  const headers = corsHeaders(request, env);
  headers.set("Content-Type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(data), { status, headers });
}

function errorResponse(request, env, status, code, message) {
  return json(request, env, { ok: false, error: { code, message } }, status);
}

async function readJson(request) {
  const contentType = request.headers.get("Content-Type") || "";
  if (!contentType.toLowerCase().includes("application/json")) return null;
  try {
    return await request.json();
  } catch {
    return null;
  }
}

function isOriginAllowed(request, env) {
  const origin = request.headers.get("Origin");
  return !origin || allowedOrigins(env).has(origin);
}

async function requireSession(request, env) {
  const token = getBearerToken(request);
  if (!token) return null;
  return findSessionUser(env, token);
}

async function handleGuest(request, env) {
  const existing = await requireSession(request, env);
  if (existing) {
    return json(request, env, {
      ok: true,
      authenticated: true,
      needsNickname: !existing.row.nickname,
      user: publicUser(existing.row)
    });
  }

  const guest = await createGuestSession(env);
  return json(request, env, {
    ok: true,
    authenticated: true,
    needsNickname: true,
    sessionToken: guest.token,
    expiresAt: guest.expiresAt,
    user: guest.user
  }, 201);
}

async function handleSession(request, env) {
  const session = await requireSession(request, env);
  if (!session) {
    return errorResponse(
      request,
      env,
      401,
      "invalid_session",
      "로그인 정보가 없거나 만료되었습니다."
    );
  }

  return json(request, env, {
    ok: true,
    authenticated: true,
    needsNickname: !session.row.nickname,
    user: publicUser(session.row)
  });
}

async function handleNickname(request, env) {
  const session = await requireSession(request, env);
  if (!session) {
    return errorResponse(
      request,
      env,
      401,
      "invalid_session",
      "로그인 정보가 없거나 만료되었습니다."
    );
  }

  const body = await readJson(request);
  if (!body || typeof body.nickname !== "string") {
    return errorResponse(
      request,
      env,
      400,
      "invalid_request",
      "닉네임을 입력해주세요."
    );
  }

  const result = await registerNickname(env, session, body.nickname, body.profileColor);
  if (!result.ok) {
    const status = result.code === "nickname_taken" ? 409 : 400;
    return errorResponse(request, env, status, result.code, result.message);
  }

  return json(request, env, {
    ok: true,
    authenticated: true,
    needsNickname: false,
    user: result.user
  });
}

async function handleProfile(request, env) {
  const session = await requireSession(request, env);
  if (!session) {
    return errorResponse(
      request,
      env,
      401,
      "invalid_session",
      "로그인 정보가 없거나 만료되었습니다."
    );
  }

  const body = await readJson(request);
  if (!body || typeof body.profileColor !== "string") {
    return errorResponse(
      request,
      env,
      400,
      "invalid_request",
      "프로필 색상을 선택해주세요."
    );
  }

  const result = await updateProfileColor(env, session, body.profileColor);
  if (!result.ok) {
    return errorResponse(request, env, 400, result.code, result.message);
  }

  return json(request, env, {
    ok: true,
    authenticated: true,
    needsNickname: false,
    user: result.user
  });
}

async function requireRankingUser(request, env) {
  const session = await requireSession(request, env);
  if (!session) {
    return {
      response: errorResponse(
        request,
        env,
        401,
        "invalid_session",
        "로그인 정보가 없거나 만료되었습니다."
      )
    };
  }

  if (!session.row.nickname) {
    return {
      response: errorResponse(
        request,
        env,
        403,
        "nickname_required",
        "AI 랭킹을 이용하려면 닉네임을 먼저 등록해주세요."
      )
    };
  }

  return { session };
}

async function handleAiGameSession(request, env) {
  const auth = await requireRankingUser(request, env);
  if (auth.response) return auth.response;

  const body = await readJson(request);
  if (!body) {
    return errorResponse(
      request,
      env,
      400,
      "invalid_request",
      "게임 설정을 확인해주세요."
    );
  }

  const result = await createAiGameSession(env, auth.session.row.uid, body);
  if (!result.ok) {
    return errorResponse(request, env, 400, result.code, result.message);
  }

  return json(request, env, result, 201);
}

async function handleAiResult(request, env) {
  const auth = await requireRankingUser(request, env);
  if (auth.response) return auth.response;

  const body = await readJson(request);
  if (!body) {
    return errorResponse(
      request,
      env,
      400,
      "invalid_request",
      "제출할 게임 기록을 확인해주세요."
    );
  }

  const result = await submitAiRankingResult(env, auth.session.row.uid, body);
  if (!result.ok) {
    const status = result.code === "duplicate_submission"
      ? 409
      : (result.code === "game_session_expired" ? 410 : 400);
    return errorResponse(request, env, status, result.code, result.message);
  }

  return json(request, env, result, 201);
}

async function handleAiRanking(request, env) {
  const auth = await requireRankingUser(request, env);
  if (auth.response) return auth.response;

  const url = new URL(request.url);
  const result = await getAiRanking(
    env,
    auth.session.row.uid,
    url.searchParams.get("difficulty"),
    url.searchParams.get("mode")
  );

  if (!result.ok) {
    return errorResponse(request, env, 400, result.code, result.message);
  }

  return json(request, env, result);
}

export default {
  async fetch(request, env) {
    if (!isOriginAllowed(request, env)) {
      return errorResponse(request, env, 403, "origin_not_allowed", "허용되지 않은 요청입니다.");
    }

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(request, env) });
    }

    if (!env.DB || !env.SESSION_PEPPER) {
      return errorResponse(
        request,
        env,
        500,
        "server_not_configured",
        "로그인 서버 설정이 완료되지 않았습니다."
      );
    }

    const { pathname } = new URL(request.url);

    try {
      if (pathname === "/api/health" && request.method === "GET") {
        return json(request, env, { ok: true, service: "deguldegul-api" });
      }
      if (pathname === "/api/auth/guest" && request.method === "POST") {
        return handleGuest(request, env);
      }
      if (pathname === "/api/auth/session" && request.method === "GET") {
        return handleSession(request, env);
      }
      if (pathname === "/api/auth/nickname" && request.method === "POST") {
        return handleNickname(request, env);
      }
      if (pathname === "/api/auth/profile" && request.method === "POST") {
        return handleProfile(request, env);
      }
      if (pathname === "/api/ai/sessions" && request.method === "POST") {
        return handleAiGameSession(request, env);
      }
      if (pathname === "/api/ai/results" && request.method === "POST") {
        return handleAiResult(request, env);
      }
      if (pathname === "/api/ai/rankings" && request.method === "GET") {
        return handleAiRanking(request, env);
      }

      return errorResponse(request, env, 404, "not_found", "API 경로를 찾을 수 없습니다.");
    } catch (error) {
      console.error(JSON.stringify({
        message: "Unhandled API error",
        path: pathname,
        error: error instanceof Error ? error.message : String(error)
      }));
      return errorResponse(
        request,
        env,
        500,
        "internal_error",
        "서버 처리 중 오류가 발생했습니다."
      );
    }
  }
};
