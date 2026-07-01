const PRODUCTION_API_BASE = "https://deguldegul.net";
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Accept"
};

let sessionToken = "";
let sessionPromise = null;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...CORS_HEADERS,
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}

async function api(path, options = {}) {
  const headers = new Headers(options.headers || {});
  headers.set("Accept", "application/json");
  if (options.body) headers.set("Content-Type", "application/json");
  const response = await fetch(`${PRODUCTION_API_BASE}${path}`, {
    ...options,
    headers,
    cache: "no-store"
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data?.error?.message || `HTTP ${response.status}`);
    error.status = response.status;
    error.code = data?.error?.code || "request_failed";
    throw error;
  }
  return data;
}

async function ensureSession() {
  if (sessionToken) return sessionToken;
  if (sessionPromise) return sessionPromise;
  sessionPromise = (async () => {
    const guest = await api("/api/auth/guest", { method: "POST", body: "{}" });
    sessionToken = guest.sessionToken || "";
    const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
    const nickname = `운영자뷰${suffix}`;
    try {
      const named = await api("/api/auth/nickname", {
        method: "POST",
        headers: { Authorization: `Bearer ${sessionToken}` },
        body: JSON.stringify({ nickname, profileColor: "#64beff" })
      });
      if (named.sessionToken) sessionToken = named.sessionToken;
    } catch (error) {
      if (error.code !== "nickname_taken" && error.status !== 409) throw error;
    }
    return sessionToken;
  })();
  try {
    return await sessionPromise;
  } finally {
    sessionPromise = null;
  }
}

async function getRanking(request) {
  const url = new URL(request.url);
  const difficulty = url.searchParams.get("difficulty") || "easy";
  const mode = url.searchParams.get("mode") === "item" ? "item" : "speed";
  let token = await ensureSession();
  try {
    return await api(`/api/ai/rankings?difficulty=${encodeURIComponent(difficulty)}&mode=${encodeURIComponent(mode)}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` }
    });
  } catch (error) {
    if (error.status !== 401 && error.status !== 403) throw error;
    sessionToken = "";
    token = await ensureSession();
    return api(`/api/ai/rankings?difficulty=${encodeURIComponent(difficulty)}&mode=${encodeURIComponent(mode)}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` }
    });
  }
}

export default {
  async fetch(request) {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });
    const url = new URL(request.url);
    if (request.method !== "GET" || url.pathname !== "/api/ai/rankings") {
      return json({ ok: false, error: { code: "not_found", message: "Not found" } }, 404);
    }
    try {
      const data = await getRanking(request);
      return json(data);
    } catch (error) {
      return json({
        ok: false,
        error: {
          code: error.code || "ranking_proxy_failed",
          message: error.message || "Ranking proxy failed"
        }
      }, error.status || 502);
    }
  }
};
