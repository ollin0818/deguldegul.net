import { DegulServerGame } from "./shared-game-engine.js";

const ROOM_CODE_PATTERN = /^[A-Z0-9]{6}$/;
const PLAYER_ID_PATTERN = /^[a-f0-9-]{36}$/i;
const ROOM_TTL_MS = 1000 * 60 * 60 * 3;
const DISCONNECT_FORFEIT_MS = 12_000;
const SNAPSHOT_INTERVAL_MS = 82;
const QUICK_MATCH_TTL_MS = 45_000;
const QUICK_MATCH_MODES = ["speed", "item"];
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Accept"
};

function json(data, init = {}) {
  return Response.json(data, {
    ...init,
    headers: {
      "Cache-Control": "no-store",
      ...CORS_HEADERS,
      ...(init.headers || {})
    }
  });
}

function optionsResponse() {
  return new Response(null, {
    status: 204,
    headers: {
      "Cache-Control": "no-store",
      ...CORS_HEADERS
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

function sanitizeMode(value) {
  return value === "item" ? "item" : "speed";
}

function waitingKeyForMode(mode) {
  return `waiting:${sanitizeMode(mode)}`;
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

function matchmakerStub(env) {
  return env.ONLINE_MATCHMAKER.getByName("quick:v1");
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
    this.tickTimer = null;
    this.roomCache = undefined;
    this.gameCache = undefined;
    this.lastGamePersistAt = 0;
    this.lastBroadcastLandRevision = 0;
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
    if (request.method === "GET" && url.pathname === "/play") {
      return this.connect(request);
    }
    return error(404, "not_found", "온라인 방 API를 찾을 수 없습니다.");
  }

  async loadRoom() {
    if (this.roomCache !== undefined) return this.roomCache;
    this.roomCache = await this.state.storage.get("room");
    return this.roomCache;
  }

  async saveRoom(room) {
    room.updatedAt = Date.now();
    this.roomCache = room;
    await this.state.storage.put("room", room);
    await this.state.storage.setAlarm(room.updatedAt + ROOM_TTL_MS);
    return room;
  }

  async loadGame() {
    if (this.gameCache) return this.gameCache;
    this.gameCache = DegulServerGame.hydrateState(await this.state.storage.get("game"));
    return this.gameCache;
  }

  async saveGame(game, options = {}) {
    this.gameCache = game;
    const now = Date.now();
    const shouldPersist = options.force === true
      || game.phase === "ended"
      || game.phase === "waiting"
      || now - this.lastGamePersistAt >= 700;
    if (!shouldPersist) return game;
    await this.state.storage.put("game", DegulServerGame.serializeState(game));
    this.lastGamePersistAt = now;
    return game;
  }

  publicRoom(room) {
    return {
      code: room.code,
      mode: sanitizeMode(room.mode),
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
      mode: sanitizeMode(body.mode),
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
    await this.maybeStartGame(result);
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
      const game = await this.loadGame();
      if (game.phase === "countdown" || game.phase === "playing") {
        DegulServerGame.forfeit(game, slot, Date.now());
        await this.saveGame(game, { force: true });
        await this.persistResult(room, game.result);
        this.broadcastSnapshot(game, { full: true });
      }
      room.players[slot] = null;
      if (!room.players[1] && !room.players[2]) {
        this.roomCache = null;
        this.gameCache = null;
        await this.state.storage.delete("room");
        await this.state.storage.delete("game");
        await this.state.storage.deleteAlarm();
        return json({ ok: true });
      }
      await this.saveRoom(room);
    }
    return json({ ok: true, room: room ? this.publicRoom(room) : null });
  }

  async maybeStartGame(room) {
    if (!room?.players?.[1] || !room?.players?.[2]) return;
    if (!room.players[1].ready || !room.players[2].ready) return;
    if (!this.hasConnectedPlayers()) return;
    let game = await this.loadGame();
    if (game.phase === "waiting" || game.phase === "ended") {
      game = DegulServerGame.createState({ now: Date.now(), mode: sanitizeMode(room.mode) });
      DegulServerGame.beginCountdown(game, Date.now());
      await this.saveGame(game, { force: true });
      this.lastBroadcastLandRevision = 0;
      this.broadcastSnapshot(game, { full: true });
      this.scheduleTick();
    }
  }

  async connect(request) {
    if (request.headers.get("Upgrade") !== "websocket") {
      return error(426, "websocket_required", "WebSocket 연결이 필요합니다.");
    }
    const url = new URL(request.url);
    const playerId = url.searchParams.get("playerId") || "";
    const room = await this.loadRoom();
    if (!room) return error(404, "room_not_found", "방을 찾을 수 없습니다.");
    const slot = this.findPlayerSlot(room, playerId);
    if (!slot) return error(403, "player_not_in_room", "해당 방 참가자가 아닙니다.");

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    this.state.acceptWebSocket(server, [`slot:${slot}`]);
    server.serializeAttachment({ playerId, slot, connectedAt: Date.now(), lastPongAt: Date.now() });

    const player = room.players[slot];
    player.lastSeenAt = Date.now();
    player.disconnectedAt = 0;
    await this.saveRoom(room);

    const game = await this.loadGame();
    this.send(server, { type: "hello", slot, playerId, room: this.publicRoom(room), serverNow: Date.now() });
    this.send(server, DegulServerGame.snapshot(game, Date.now(), { full: true }));
    this.broadcastPresence(room);
    await this.maybeStartGame(room);
    this.scheduleTick();
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, message) {
    let data;
    try {
      data = JSON.parse(String(message));
    } catch {
      this.send(ws, { type: "error", code: "bad_json", message: "메시지 형식이 올바르지 않습니다." });
      return;
    }
    const attachment = ws.deserializeAttachment() || {};
    attachment.lastSeenAt = Date.now();
    ws.serializeAttachment(attachment);

    if (data.type === "ping") {
      this.send(ws, { type: "pong", clientNow: data.clientNow || 0, serverNow: Date.now() });
      return;
    }
    if (data.type !== "input") return;
    const slot = Number(attachment.slot);
    const game = DegulServerGame.advanceTo(await this.loadGame(), Date.now());
    const ack = DegulServerGame.setDirection(game, slot, data.direction, data.seq, Date.now());
    await this.saveGame(game);
    this.send(ws, { type: "ack", seq: Number(data.seq) || 0, ...ack, serverNow: Date.now() });
  }

  async webSocketClose(ws) {
    await this.markDisconnected(ws);
  }

  async webSocketError(ws) {
    await this.markDisconnected(ws);
  }

  async markDisconnected(ws) {
    const attachment = ws.deserializeAttachment() || {};
    const slot = Number(attachment.slot);
    if (!slot) return;
    const room = await this.loadRoom();
    if (!room?.players?.[slot]) return;
    room.players[slot].disconnectedAt = Date.now();
    room.players[slot].lastSeenAt = Date.now();
    await this.saveRoom(room);
    this.broadcastPresence(room);
    await this.state.storage.setAlarm(Date.now() + DISCONNECT_FORFEIT_MS);
  }

  send(ws, payload) {
    try {
      ws.send(JSON.stringify(payload));
    } catch {}
  }

  broadcast(payload) {
    const text = JSON.stringify(payload);
    for (const ws of this.state.getWebSockets()) {
      try {
        ws.send(text);
      } catch {}
    }
  }

  broadcastPresence(room) {
    this.broadcast({ type: "room", room: this.publicRoom(room), serverNow: Date.now() });
  }

  hasConnectedPlayers() {
    const connected = new Set();
    for (const ws of this.state.getWebSockets()) {
      const slot = Number((ws.deserializeAttachment() || {}).slot);
      if (slot === 1 || slot === 2) connected.add(slot);
    }
    return connected.has(1) && connected.has(2);
  }

  broadcastSnapshot(game, options = {}) {
    const snapshot = DegulServerGame.snapshot(game, Date.now(), {
      full: options.full === true,
      sinceLandRevision: options.full === true ? 0 : this.lastBroadcastLandRevision
    });
    this.broadcast(snapshot);
    this.lastBroadcastLandRevision = Number(snapshot.state?.landRevision || this.lastBroadcastLandRevision || 0);
  }

  scheduleTick() {
    if (this.tickTimer) return;
    this.tickTimer = setTimeout(() => this.runTick(), SNAPSHOT_INTERVAL_MS);
  }

  async runTick() {
    this.tickTimer = null;
    const game = DegulServerGame.advanceTo(await this.loadGame(), Date.now());
    await this.saveGame(game, { force: game.phase === "ended" });
    this.broadcastSnapshot(game, { full: game.phase !== "playing" });
    if (game.phase === "ended" && game.result) {
      const room = await this.loadRoom();
      await this.persistResult(room, game.result);
      return;
    }
    if (game.phase === "countdown" || game.phase === "playing") this.scheduleTick();
  }

  async persistResult(room, result) {
    if (!result || !this.env.DB) return;
    const markerKey = `resultSaved:${result.endedAt}:${result.tick}`;
    const alreadySaved = await this.state.storage.get(markerKey);
    if (alreadySaved) return;
    try {
      await this.env.DB.prepare(`
        CREATE TABLE IF NOT EXISTS online_match_results (
          id TEXT PRIMARY KEY,
          room_code TEXT NOT NULL,
          winner_slot INTEGER NOT NULL,
          loser_slot INTEGER NOT NULL,
          reason TEXT NOT NULL,
          p1_score INTEGER NOT NULL,
          p2_score INTEGER NOT NULL,
          p1_percent INTEGER NOT NULL,
          p2_percent INTEGER NOT NULL,
          started_at INTEGER,
          ended_at INTEGER NOT NULL,
          result_json TEXT NOT NULL
        )
      `).run();
      await this.env.DB.prepare(`
        INSERT OR IGNORE INTO online_match_results
        (id, room_code, winner_slot, loser_slot, reason, p1_score, p2_score, p1_percent, p2_percent, started_at, ended_at, result_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        crypto.randomUUID(),
        room?.code || "",
        result.winnerSlot,
        result.loserSlot,
        result.reason,
        result.score?.p1 || 0,
        result.score?.p2 || 0,
        result.score?.p1Percent || 0,
        result.score?.p2Percent || 0,
        room?.createdAt || 0,
        result.endedAt,
        JSON.stringify(result)
      ).run();
      await this.state.storage.put(markerKey, true);
    } catch (error) {
      console.error("Failed to persist online match result", error);
    }
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
    const game = await this.loadGame();
    if ((game.phase === "countdown" || game.phase === "playing") && this.state.getWebSockets().length < 2) {
      const now = Date.now();
      const staleSlot = [1, 2].find((slot) => {
        const player = room.players[slot];
        return player?.disconnectedAt && now - player.disconnectedAt >= DISCONNECT_FORFEIT_MS;
      });
      if (staleSlot) {
        DegulServerGame.forfeit(game, staleSlot, now);
        await this.saveGame(game, { force: true });
        await this.persistResult(room, game.result);
        this.broadcastSnapshot(game, { full: true });
      } else {
        await this.state.storage.setAlarm(now + DISCONNECT_FORFEIT_MS);
        return;
      }
    }
    if (Date.now() - Number(room.updatedAt || 0) >= ROOM_TTL_MS) {
      this.roomCache = null;
      this.gameCache = null;
      await this.state.storage.delete("room");
      await this.state.storage.delete("game");
      await this.state.storage.deleteAlarm();
      return;
    }
    await this.state.storage.setAlarm(Number(room.updatedAt || Date.now()) + ROOM_TTL_MS);
  }
}

export class OnlineMatchmaker {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/quick") {
      return this.quick(await readJson(request), request);
    }
    if (request.method === "POST" && url.pathname === "/quick/cancel") {
      return this.cancel(await readJson(request));
    }
    return error(404, "not_found", "빠른대전 API를 찾을 수 없습니다.");
  }

  async quick(body, request) {
    const now = Date.now();
    await this.prune(now);

    const existingTicket = String(body.ticket || "");
    if (existingTicket) {
      const result = await this.state.storage.get(`ticket:${existingTicket}`);
      if (result?.status === "matched") {
        await this.state.storage.delete(`ticket:${existingTicket}`);
        return json({ ok: true, status: "matched", ...result.match });
      }
      if (result?.status === "waiting") {
        const expectedMode = sanitizeMode(body.mode || result.mode);
        if (sanitizeMode(result.mode) !== expectedMode) {
          await this.cancel({ ticket: existingTicket });
        } else {
          await this.state.storage.put(`ticket:${existingTicket}`, { ...result, mode: expectedMode, lastSeenAt: now });
          const waitingKey = waitingKeyForMode(expectedMode);
          const waiting = await this.state.storage.get(waitingKey);
          if (waiting?.ticket === existingTicket) {
            await this.state.storage.put(waitingKey, { ...waiting, mode: expectedMode, lastSeenAt: now });
          }
          await this.state.storage.setAlarm(now + QUICK_MATCH_TTL_MS);
          return json({ ok: true, status: "waiting", ticket: existingTicket });
        }
      }
    }

    const current = {
      ticket: crypto.randomUUID(),
      nickname: sanitizeNickname(body.nickname),
      skin: sanitizeSkin(body.skin),
      mode: sanitizeMode(body.mode),
      createdAt: now,
      lastSeenAt: now
    };
    const waitingKey = waitingKeyForMode(current.mode);
    const waiting = await this.state.storage.get(waitingKey);
    if (waiting && waiting.ticket !== current.ticket && now - Number(waiting.createdAt || 0) < QUICK_MATCH_TTL_MS) {
      await this.state.storage.delete(waitingKey);
      const match = await this.createMatchedRoom(waiting, current, request);
      await this.state.storage.put(`ticket:${waiting.ticket}`, {
        status: "matched",
        matchedAt: now,
        match: match.player1
      });
      return json({ ok: true, status: "matched", ...match.player2 });
    }

    await this.state.storage.put(waitingKey, current);
    await this.state.storage.put(`ticket:${current.ticket}`, { status: "waiting", ...current });
    await this.state.storage.setAlarm(now + QUICK_MATCH_TTL_MS);
    return json({ ok: true, status: "waiting", ticket: current.ticket });
  }

  async cancel(body) {
    const ticket = String(body.ticket || "");
    if (ticket) {
      for (const mode of QUICK_MATCH_MODES) {
        const waitingKey = waitingKeyForMode(mode);
        const waiting = await this.state.storage.get(waitingKey);
        if (waiting?.ticket === ticket) await this.state.storage.delete(waitingKey);
      }
      const legacyWaiting = await this.state.storage.get("waiting");
      if (legacyWaiting?.ticket === ticket) await this.state.storage.delete("waiting");
      await this.state.storage.delete(`ticket:${ticket}`);
    }
    return json({ ok: true });
  }

  async createMatchedRoom(first, second, request) {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const code = makeRoomCode();
      const baseUrl = new URL(request.url);
      baseUrl.search = `?code=${encodeURIComponent(code)}`;

      const createUrl = new URL(baseUrl);
      createUrl.pathname = "/create";
      const createResponse = await roomStub(this.env, code).fetch(new Request(createUrl, {
        method: "POST",
        headers: request.headers,
        body: JSON.stringify({ nickname: first.nickname, skin: first.skin, mode: sanitizeMode(first.mode) })
      }));
      if (createResponse.status === 409) continue;
      const created = await createResponse.json();
      if (!createResponse.ok || created?.ok === false) throw new Error("quick_match_create_failed");

      const joinUrl = new URL(baseUrl);
      joinUrl.pathname = "/join";
      const joinResponse = await roomStub(this.env, code).fetch(new Request(joinUrl, {
        method: "POST",
        headers: request.headers,
        body: JSON.stringify({ nickname: second.nickname, skin: second.skin })
      }));
      const joined = await joinResponse.json();
      if (!joinResponse.ok || joined?.ok === false) throw new Error("quick_match_join_failed");

      await this.setRoomReady(code, created.playerId, request);
      const ready2 = await this.setRoomReady(code, joined.playerId, request);
      const room = ready2.room || joined.room || created.room;
      return {
        player1: { room, roomCode: code, playerId: created.playerId, slot: 1 },
        player2: { room, roomCode: code, playerId: joined.playerId, slot: 2 }
      };
    }
    throw new Error("quick_match_room_code_exhausted");
  }

  async setRoomReady(code, playerId, request) {
    const readyUrl = new URL(request.url);
    readyUrl.pathname = "/ready";
    readyUrl.search = `?code=${encodeURIComponent(code)}`;
    const response = await roomStub(this.env, code).fetch(new Request(readyUrl, {
      method: "POST",
      headers: request.headers,
      body: JSON.stringify({ playerId, ready: true })
    }));
    return await response.json();
  }

  async prune(now = Date.now()) {
    for (const mode of QUICK_MATCH_MODES) {
      const waitingKey = waitingKeyForMode(mode);
      const waiting = await this.state.storage.get(waitingKey);
      if (waiting && now - Number(waiting.lastSeenAt || waiting.createdAt || 0) >= QUICK_MATCH_TTL_MS) {
        await this.state.storage.delete(waitingKey);
        await this.state.storage.delete(`ticket:${waiting.ticket}`);
      }
    }
    const legacyWaiting = await this.state.storage.get("waiting");
    if (legacyWaiting) {
      await this.state.storage.delete("waiting");
      await this.state.storage.delete(`ticket:${legacyWaiting.ticket}`);
    }
  }

  async alarm() {
    await this.prune(Date.now());
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return optionsResponse();
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

    if (request.method === "POST" && (url.pathname === "/api/online/quick" || url.pathname === "/api/online/quick/cancel")) {
      const targetUrl = new URL(request.url);
      targetUrl.pathname = url.pathname.endsWith("/cancel") ? "/quick/cancel" : "/quick";
      return matchmakerStub(env).fetch(new Request(targetUrl, request));
    }

    const match = url.pathname.match(/^\/api\/online\/rooms\/([A-Z0-9]{6})(?:\/(join|ready|skin|leave|play))?$/i);
    if (!match) return error(404, "not_found", "온라인 방 API를 찾을 수 없습니다.");
    const code = match[1].toUpperCase();
    const action = match[2] || "state";
    const actionPath = action === "state" ? "/state" : `/${action}`;
    const targetUrl = new URL(request.url);
    targetUrl.searchParams.set("code", code);
    return forwardToRoom(env, code, actionPath, new Request(targetUrl, request));
  }
};
