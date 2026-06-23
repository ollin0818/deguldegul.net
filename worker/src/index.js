import {
  createGuestSession,
  findSessionUser,
  getBearerToken,
  publicUser,
  registerNickname
} from "./auth.js";

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

  const result = await registerNickname(env, session, body.nickname);
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

      return errorResponse(request, env, 404, "not_found", "API 경로를 찾을 수 없습니다.");
    } catch (error) {
      console.error("Unhandled API error", error);
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
