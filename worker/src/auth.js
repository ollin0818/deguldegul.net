const NICKNAME_MIN_LENGTH = 2;
const NICKNAME_MAX_LENGTH = 12;
const DEFAULT_PROFILE_COLOR = "#64beff";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 180;
const encoder = new TextEncoder();
const BLOCKED_NICKNAME_FRAGMENTS = Object.freeze([
  "씨발",
  "시발",
  "씹새",
  "개새끼",
  "새끼",
  "병신",
  "지랄",
  "존나",
  "좆",
  "보지",
  "자지",
  "섹스",
  "야동",
  "강간",
  "창녀",
  "fuck",
  "shit",
  "cunt",
  "pussy",
  "porn",
  "whore",
  "slut",
  "nigger",
  "faggot",
  "ちんこ",
  "まんこ",
  "セックス",
  "せっくす",
  "レイプ",
  "れいぷ",
  "エロ",
  "えろ",
  "操你妈",
  "肏",
  "屌",
  "鸡巴",
  "陰莖",
  "阴茎",
  "陰道",
  "阴道",
  "色情",
  "強姦",
  "强奸",
  "傻逼"
]);
const BLOCKED_NICKNAME_EXACT = new Set([
  "ㅅㅂ",
  "ㅂㅅ",
  "sex",
  "sexy",
  "dick",
  "dicks",
  "rape",
  "rapist",
  "bitch",
  "bitches",
  "くそ",
  "しね"
]);
const ASCII_DISGUISE_MAP = Object.freeze({
  "0": "o",
  "1": "i",
  "3": "e",
  "4": "a",
  "5": "s",
  "7": "t",
  "8": "b",
  "9": "g",
  "@": "a",
  "$": "s",
  "!": "i"
});

export function normalizeNickname(value) {
  return String(value ?? "")
    .normalize("NFC")
    .trim()
    .replace(/\s+/gu, " ");
}

export function nicknameKey(value) {
  return normalizeNickname(value).toLowerCase();
}

export function nicknameModerationKey(value) {
  return normalizeNickname(value)
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[01345789@$!]/g, character => ASCII_DISGUISE_MAP[character] || character)
    .replace(/[\p{White_Space}\p{Punctuation}\p{Symbol}\p{Mark}_]+/gu, "");
}

export function containsBlockedNicknameTerm(value) {
  const key = nicknameModerationKey(value);
  if (!key) return false;
  if (BLOCKED_NICKNAME_EXACT.has(key)) return true;
  return BLOCKED_NICKNAME_FRAGMENTS.some(term => key.includes(term));
}

export function validateNickname(value) {
  const nickname = normalizeNickname(value);
  const length = Array.from(nickname).length;

  if (length < NICKNAME_MIN_LENGTH || length > NICKNAME_MAX_LENGTH) {
    return {
      ok: false,
      code: "invalid_nickname_length",
      message: "닉네임은 2자 이상 12자 이하로 입력해주세요."
    };
  }

  if (/[\u0000-\u001f\u007f]/u.test(nickname)) {
    return {
      ok: false,
      code: "invalid_nickname",
      message: "닉네임에 사용할 수 없는 문자가 포함되어 있습니다."
    };
  }

  if (containsBlockedNicknameTerm(nickname)) {
    return {
      ok: false,
      code: "inappropriate_nickname",
      message: "선정적이거나 비속어가 포함된 닉네임은 사용할 수 없습니다."
    };
  }

  return { ok: true, nickname, key: nicknameKey(nickname) };
}

export function validateProfileColor(value) {
  const color = String(value || DEFAULT_PROFILE_COLOR).trim().toLowerCase();
  if (!/^#[0-9a-f]{6}$/.test(color)) {
    return {
      ok: false,
      code: "invalid_profile_color",
      message: "프로필 색상 형식이 올바르지 않습니다."
    };
  }
  return { ok: true, color };
}

function bytesToBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function bytesToHex(bytes) {
  return Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
}

export function createSessionToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
}

export async function hashSessionToken(token, pepper) {
  if (!pepper) throw new Error("SESSION_PEPPER is not configured");

  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(pepper),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(token));
  return bytesToHex(new Uint8Array(signature));
}

export function getBearerToken(request) {
  const header = request.headers.get("Authorization") || "";
  const match = header.match(/^Bearer\s+([A-Za-z0-9_-]{32,})$/i);
  return match ? match[1] : "";
}

export function publicUser(row) {
  return {
    nickname: row.nickname || null,
    profileColor: row.profile_color || DEFAULT_PROFILE_COLOR,
    createdAt: row.created_at
  };
}

export async function findSessionUser(env, token) {
  if (!token) return null;

  const now = Math.floor(Date.now() / 1000);
  const sessionHash = await hashSessionToken(token, env.SESSION_PEPPER);
  const row = await env.DB.prepare(`
    SELECT
      users.uid,
      users.nickname,
      users.profile_color,
      users.created_at,
      users.status,
      sessions.session_hash,
      sessions.expires_at
    FROM sessions
    INNER JOIN users ON users.uid = sessions.user_uid
    WHERE sessions.session_hash = ?
      AND sessions.revoked_at IS NULL
      AND sessions.expires_at > ?
      AND users.status = 'active'
    LIMIT 1
  `).bind(sessionHash, now).first();

  if (!row) return null;

  await env.DB.batch([
    env.DB.prepare(
      "UPDATE sessions SET last_seen_at = ? WHERE session_hash = ?"
    ).bind(now, sessionHash),
    env.DB.prepare(
      "UPDATE users SET last_seen_at = ?, updated_at = ? WHERE uid = ?"
    ).bind(now, now, row.uid)
  ]);

  return { row, sessionHash };
}

export async function createGuestSession(env) {
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + SESSION_TTL_SECONDS;
  const uid = crypto.randomUUID();
  const token = createSessionToken();
  const sessionHash = await hashSessionToken(token, env.SESSION_PEPPER);

  await env.DB.batch([
    env.DB.prepare(`
      INSERT INTO users (
        uid, nickname, nickname_key, status,
        created_at, updated_at, last_seen_at
      ) VALUES (?, NULL, NULL, 'active', ?, ?, ?)
    `).bind(uid, now, now, now),
    env.DB.prepare(`
      INSERT INTO sessions (
        session_hash, user_uid, created_at, last_seen_at, expires_at, revoked_at
      ) VALUES (?, ?, ?, ?, ?, NULL)
    `).bind(sessionHash, uid, now, now, expiresAt)
  ]);

  return {
    token,
    expiresAt,
    user: {
      nickname: null,
      profileColor: DEFAULT_PROFILE_COLOR,
      createdAt: now
    }
  };
}

export async function registerNickname(env, session, rawNickname, rawProfileColor) {
  const validation = validateNickname(rawNickname);
  if (!validation.ok) return validation;
  const colorValidation = validateProfileColor(rawProfileColor);
  if (!colorValidation.ok) return colorValidation;

  const now = Math.floor(Date.now() / 1000);

  try {
    const result = await env.DB.prepare(`
      UPDATE users
      SET nickname = ?, nickname_key = ?, profile_color = ?, updated_at = ?, last_seen_at = ?
      WHERE uid = ?
        AND nickname IS NULL
        AND status = 'active'
    `).bind(
      validation.nickname,
      validation.key,
      colorValidation.color,
      now,
      now,
      session.row.uid
    ).run();

    if (result.meta.changes !== 1) {
      return {
        ok: false,
        code: "nickname_already_registered",
        message: "이미 닉네임 등록이 완료된 계정입니다."
      };
    }
  } catch (error) {
    const message = String(error?.message || error);
    if (/UNIQUE constraint failed|users_nickname_key_unique/i.test(message)) {
      return {
        ok: false,
        code: "nickname_taken",
        message: "이미 사용 중인 닉네임입니다."
      };
    }
    throw error;
  }

  return {
    ok: true,
    user: {
      nickname: validation.nickname,
      profileColor: colorValidation.color,
      createdAt: session.row.created_at
    }
  };
}

export async function updateProfileColor(env, session, rawProfileColor) {
  const validation = validateProfileColor(rawProfileColor);
  if (!validation.ok) return validation;

  const now = Math.floor(Date.now() / 1000);
  const result = await env.DB.prepare(`
    UPDATE users
    SET profile_color = ?, updated_at = ?, last_seen_at = ?
    WHERE uid = ?
      AND nickname IS NOT NULL
      AND status = 'active'
  `).bind(validation.color, now, now, session.row.uid).run();

  if (result.meta.changes !== 1) {
    return {
      ok: false,
      code: "nickname_required",
      message: "닉네임을 먼저 등록해주세요."
    };
  }

  return {
    ok: true,
    user: {
      nickname: session.row.nickname,
      profileColor: validation.color,
      createdAt: session.row.created_at
    }
  };
}
