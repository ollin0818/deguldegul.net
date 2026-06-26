const ROOM_CODE_PATTERN = /^[A-Z0-9]{6}$/;
const PLAYER_ID_PATTERN = /^[a-f0-9-]{36}$/i;
const ROOM_TTL_MS = 1000 * 60 * 60 * 3;

function json(data, init = {}) {
  return Response.json(data, {
    ...init,
    headers: {
      "Cache-Control": "no-store",
      ...(init.headers || {})
    }
  });
}

function error(status, code, message) {
  return json({ ok: false, error: code, message }, { status });
}

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

function sanitizeNickname(value) {
  const text = String(value || "Player").normalize("NFC").trim().replace(/\s+/g, " ");
  return Array.from(text).slice(0, 12).join("") || "Player";
}

function sanitizeSkin(value) {
  const skin = String(value || "sky").toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 32);
  return skin || "sky";
}

function makeRoomCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
}

function roomStub(env, code) {
  return env.ONLINE_ROOM.getByName(`room:${code}`);
}

async function forwardToRoom(env, code, path, request) {
  if (!ROOM_CODE_PATTERN.test(code)) return error(400, "invalid_room_code", "6자리 방 코드가 필요합니다.");
  const url = new URL(request.url);
  url.pathname = path;
  return roomStub(env, code).fetch(new Request(url, request));
}

export class OnlineRoom {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request) {
    const url = new URL(request.url);
    const code = url.searchParams.get("code") || "";
    if (!ROOM_CODE_PATTERN.test(code)) return error(400, "invalid_room_code", "6자리 방 코드가 필요합니다.");

    if (request.method === "POST" && url.pathname === "/create") {
      return this.create(code, await readJson(request));
    }
    if (request.method === "POST" && url.pathname === "/join") {
      return this.join(code, await readJson(request));
    }
    if (request.method === "GET" && url.pathname === "/state") {
      return this.getState();
    }
    if (request.method === "POST" && url.pathname === "/ready") {
      return this.setReady(await readJson(request));
    }
    if (request.method === "POST" && url.pathname === "/skin") {
      return this.setSkin(await readJson(request));
    }
    if (request.method === "POST" && url.pathname === "/leave") {
      return this.leave(await readJson(request));
    }
    return error(404, "not_found", "온라인 방 API를 찾을 수 없습니다.");
  }

  async loadRoom() {
    return await this.state.storage.get("room");
  }

  async saveRoom(room) {
    room.updatedAt = Date.now();
    await this.state.storage.put("room", room);
    await this.state.storage.setAlarm(room.updatedAt + ROOM_TTL_MS);
    return room;
  }

  publicRoom(room) {
    return {
      code: room.code,
      createdAt: room.createdAt,
      updatedAt: room.updatedAt,
      players: {
        1: room.players[1] ? this.publicPlayer(room.players[1]) : null,
        2: room.players[2] ? this.publicPlayer(room.players[2]) : null
      }
    };
  }

  publicPlayer(player) {
    return {
      playerId: player.playerId,
      nickname: player.nickname,
      slot: player.slot,
      ready: !!player.ready,
      skin: player.skin,
      joinedAt: player.joinedAt,
      lastSeenAt: player.lastSeenAt
    };
  }

  async create(code, body) {
    const existing = await this.loadRoom();
    if (existing && (existing.players[1] || existing.players[2])) {
      return error(409, "room_exists", "이미 사용 중인 방 코드입니다.");
    }
    const now = Date.now();
    const player = {
      playerId: crypto.randomUUID(),
      nickname: sanitizeNickname(body.nickname),
      slot: 1,
      ready: false,
      skin: sanitizeSkin(body.skin),
      joinedAt: now,
      lastSeenAt: now
    };
    const room = {
      code,
      createdAt: now,
      updatedAt: now,
      players: { 1: player, 2: null }
    };
    await this.saveRoom(room);
    return json({ ok: true, room: this.publicRoom(room), playerId: player.playerId, slot: 1 });
  }

  async join(code, body) {
    const room = await this.loadRoom();
    if (!room) return error(404, "room_not_found", "방을 찾을 수 없습니다.");
    const now = Date.now();
    const existingSlot = this.findPlayerSlot(room, body.playerId);
    if (existingSlot) {
      const player = room.players[existingSlot];
      player.nickname = sanitizeNickname(body.nickname || player.nickname);
      player.skin = sanitizeSkin(body.skin || player.skin);
      player.lastSeenAt = now;
      await this.saveRoom(room);
      return json({ ok: true, room: this.publicRoom(room), playerId: player.playerId, slot: existingSlot });
    }
    const slot = room.players[1] ? (room.players[2] ? 0 : 2) : 1;
    if (!slot) return error(409, "room_full", "방이 가득 찼습니다.");
    const player = {
      playerId: crypto.randomUUID(),
      nickname: sanitizeNickname(body.nickname),
      slot,
      ready: false,
      skin: sanitizeSkin(body.skin),
      joinedAt: now,
      lastSeenAt: now
    };
    room.players[slot] = player;
    await this.saveRoom(room);
    return json({ ok: true, room: this.publicRoom(room), playerId: player.playerId, slot });
  }

  async getState() {
    const room = await this.loadRoom();
    if (!room) return error(404, "room_not_found", "방을 찾을 수 없습니다.");
    return json({ ok: true, room: this.publicRoom(room) });
  }

  async setReady(body) {
    const result = await this.updatePlayer(body.playerId, (player) => {
      player.ready = body.ready === true;
    });
    if (result instanceof Response) return result;
    return json({ ok: true, room: this.publicRoom(result) });
  }

  async setSkin(body) {
    const result = await this.updatePlayer(body.playerId, (player) => {
      player.skin = sanitizeSkin(body.skin);
      player.ready = false;
    });
    if (result instanceof Response) return result;
    return json({ ok: true, room: this.publicRoom(result) });
  }

  async leave(body) {
    const room = await this.loadRoom();
    if (!room) return json({ ok: true });
    const slot = this.findPlayerSlot(room, body.playerId);
    if (slot) {
      room.players[slot] = null;
      if (!room.players[1] && !room.players[2]) {
        await this.state.storage.delete("room");
        await this.state.storage.deleteAlarm();
        return json({ ok: true });
      }
      await this.saveRoom(room);
    }
    return json({ ok: true, room: room ? this.publicRoom(room) : null });
  }

  async updatePlayer(playerId, mutate) {
    if (!PLAYER_ID_PATTERN.test(String(playerId || ""))) {
      return error(401, "invalid_player", "방 참가자 정보가 올바르지 않습니다.");
    }
    const room = await this.loadRoom();
    if (!room) return error(404, "room_not_found", "방을 찾을 수 없습니다.");
    const slot = this.findPlayerSlot(room, playerId);
    if (!slot) return error(403, "player_not_in_room", "해당 방 참가자가 아닙니다.");
    mutate(room.players[slot]);
    room.players[slot].lastSeenAt = Date.now();
    await this.saveRoom(room);
    return room;
  }

  findPlayerSlot(room, playerId) {
    if (!PLAYER_ID_PATTERN.test(String(playerId || ""))) return 0;
    if (room.players[1]?.playerId === playerId) return 1;
    if (room.players[2]?.playerId === playerId) return 2;
    return 0;
  }

  async alarm() {
    const room = await this.loadRoom();
    if (!room) return;
    if (Date.now() - Number(room.updatedAt || 0) >= ROOM_TTL_MS) {
      await this.state.storage.delete("room");
      await this.state.storage.deleteAlarm();
      return;
    }
    await this.state.storage.setAlarm(Number(room.updatedAt || Date.now()) + ROOM_TTL_MS);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/online/")) {
      return error(404, "not_found", "온라인 API 경로가 아닙니다.");
    }

    if (request.method === "POST" && url.pathname === "/api/online/rooms") {
      const body = await readJson(request);
      for (let attempt = 0; attempt < 8; attempt += 1) {
        const code = makeRoomCode();
        const createUrl = new URL(request.url);
        createUrl.pathname = "/create";
        createUrl.search = `?code=${encodeURIComponent(code)}`;
        const response = await roomStub(env, code).fetch(new Request(createUrl, {
          method: "POST",
          headers: request.headers,
          body: JSON.stringify(body)
        }));
        if (response.status !== 409) return response;
      }
      return error(503, "room_code_exhausted", "방 코드를 생성하지 못했습니다.");
    }

    const match = url.pathname.match(/^\/api\/online\/rooms\/([A-Z0-9]{6})(?:\/(join|ready|skin|leave))?$/i);
    if (!match) return error(404, "not_found", "온라인 방 API를 찾을 수 없습니다.");
    const code = match[1].toUpperCase();
    const action = match[2] || "state";
    const actionPath = action === "state" ? "/state" : `/${action}`;
    const targetUrl = new URL(request.url);
    targetUrl.searchParams.set("code", code);
    return forwardToRoom(env, code, actionPath, new Request(targetUrl, request));
  }
};
