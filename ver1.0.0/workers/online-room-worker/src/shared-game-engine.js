export const DegulServerGame = (() => {
  const GRID_SIZE = 31;
  const EMPTY = 0;
  const P1_LAND = 1;
  const P2_LAND = 2;
  const TICK_MS = 145;
  const WIN_RATIO = 0.6;
  const DIRS = {
    up: { dx: 0, dz: -1 },
    down: { dx: 0, dz: 1 },
    left: { dx: -1, dz: 0 },
    right: { dx: 1, dz: 0 }
  };

  function pointKey(x, z) {
    return z * GRID_SIZE + x;
  }

  function createPointList(points = []) {
    const list = points.map((point) => ({ x: point.x, z: point.z }));
    list.pointSet = new Set(list.map((point) => pointKey(point.x, point.z)));
    return list;
  }

  function containsPoint(list, x, z) {
    return !!list && !!list.pointSet && list.pointSet.has(pointKey(x, z));
  }

  function inBounds(x, z) {
    return x >= 0 && z >= 0 && x < GRID_SIZE && z < GRID_SIZE;
  }

  function createLand() {
    const land = [];
    for (let z = 0; z < GRID_SIZE; z += 1) {
      land[z] = [];
      for (let x = 0; x < GRID_SIZE; x += 1) land[z][x] = EMPTY;
    }
    markSquareLand(land, 5, GRID_SIZE - 6, 2, P1_LAND);
    markSquareLand(land, GRID_SIZE - 6, 5, 2, P2_LAND);
    return land;
  }

  function markSquareLand(land, cx, cz, radius, owner) {
    for (let z = cz - radius; z <= cz + radius; z += 1) {
      for (let x = cx - radius; x <= cx + radius; x += 1) {
        if (inBounds(x, z)) land[z][x] = owner;
      }
    }
  }

  function createActor(slot) {
    const isP1 = slot === 1;
    const landId = isP1 ? P1_LAND : P2_LAND;
    const dir = isP1 ? { dx: 1, dz: 0 } : { dx: -1, dz: 0 };
    return {
      slot,
      name: `${slot}P`,
      x: isP1 ? 5 : GRID_SIZE - 6,
      z: isP1 ? GRID_SIZE - 6 : 5,
      dir: { ...dir },
      nextDir: { ...dir },
      landId,
      trail: createPointList(),
      alive: true,
      lastSeq: 0,
      lastInputAt: 0
    };
  }

  function createState(options = {}) {
    const now = Number(options.now || Date.now());
    return {
      version: 1,
      phase: "waiting",
      tick: 0,
      createdAt: now,
      updatedAt: now,
      countdownStartAt: 0,
      startAt: 0,
      endedAt: 0,
      mode: options.mode === "item" ? "item" : "speed",
      ghostMode: !!options.ghostMode,
      land: createLand(),
      players: {
        1: createActor(1),
        2: createActor(2)
      },
      result: null,
      events: []
    };
  }

  function hydrateState(raw) {
    const state = raw && raw.version ? raw : createState();
    state.land = Array.isArray(state.land) ? state.land : createLand();
    for (const slot of [1, 2]) {
      const player = state.players && state.players[slot] ? state.players[slot] : createActor(slot);
      player.trail = createPointList(player.trail || []);
      player.dir = normalizeDirObject(player.dir) || (slot === 1 ? { dx: 1, dz: 0 } : { dx: -1, dz: 0 });
      player.nextDir = normalizeDirObject(player.nextDir) || { ...player.dir };
      state.players[slot] = player;
    }
    state.events = Array.isArray(state.events) ? state.events : [];
    return state;
  }

  function serializeState(state) {
    return {
      ...state,
      players: {
        1: serializeActor(state.players[1]),
        2: serializeActor(state.players[2])
      },
      events: []
    };
  }

  function serializeActor(actor) {
    return {
      ...actor,
      trail: (actor.trail || []).map((point) => ({ x: point.x, z: point.z }))
    };
  }

  function normalizeDirName(value) {
    const name = String(value || "").toLowerCase();
    return DIRS[name] ? name : "";
  }

  function normalizeDirObject(value) {
    if (!value) return null;
    const dx = Math.sign(Number(value.dx) || 0);
    const dz = Math.sign(Number(value.dz) || 0);
    if (Math.abs(dx) + Math.abs(dz) !== 1) return null;
    return { dx, dz };
  }

  function setDirection(state, slot, direction, seq, now = Date.now()) {
    const player = state.players[slot];
    if (!player || !player.alive || state.phase !== "playing") {
      return { accepted: false, reason: "not_playing", lastSeq: player?.lastSeq || 0 };
    }
    const nextSeq = Number(seq) || 0;
    if (nextSeq <= Number(player.lastSeq || 0)) {
      return { accepted: false, reason: "stale_seq", lastSeq: player.lastSeq };
    }
    const name = normalizeDirName(direction);
    if (!name) return { accepted: false, reason: "invalid_direction", lastSeq: player.lastSeq };
    const dir = DIRS[name];
    if (player.dir && player.dir.dx === -dir.dx && player.dir.dz === -dir.dz) {
      player.lastSeq = nextSeq;
      player.lastInputAt = now;
      return { accepted: true, ignored: true, reason: "reverse_blocked", lastSeq: player.lastSeq };
    }
    player.nextDir = { ...dir };
    player.lastSeq = nextSeq;
    player.lastInputAt = now;
    state.updatedAt = now;
    return { accepted: true, lastSeq: player.lastSeq };
  }

  function beginCountdown(state, now = Date.now()) {
    if (state.phase === "playing" || state.phase === "ended" || state.phase === "countdown") return state;
    state.phase = "countdown";
    state.countdownStartAt = now;
    state.startAt = now + 4000;
    state.updatedAt = now;
    return state;
  }

  function advanceTo(state, now = Date.now()) {
    state.events = [];
    if (state.phase === "countdown" && now >= state.startAt) {
      state.phase = "playing";
      state.updatedAt = now;
      state.events.push({ type: "start", at: state.startAt });
    }
    while (state.phase === "playing" && state.updatedAt + TICK_MS <= now) {
      tick(state, state.updatedAt + TICK_MS);
    }
    return state;
  }

  function tick(state, at) {
    state.tick += 1;
    const first = state.tick % 2 === 0 ? [1, 2] : [2, 1];
    const startPositions = {
      1: { x: state.players[1].x, z: state.players[1].z },
      2: { x: state.players[2].x, z: state.players[2].z }
    };
    const planned = {};

    for (const slot of first) {
      const actor = state.players[slot];
      if (!actor.alive) continue;
      actor.dir = { ...actor.nextDir };
      planned[slot] = { x: actor.x + actor.dir.dx, z: actor.z + actor.dir.dz };
    }

    if (planned[1] && planned[2]) {
      const sameCell = planned[1].x === planned[2].x && planned[1].z === planned[2].z;
      const swapped = planned[1].x === startPositions[2].x && planned[1].z === startPositions[2].z
        && planned[2].x === startPositions[1].x && planned[2].z === startPositions[1].z;
      if (sameCell || swapped) {
        endGame(state, 0, "collision", at);
        return;
      }
    }

    for (const slot of first) {
      const actor = state.players[slot];
      if (state.phase !== "playing" || !actor.alive) continue;
      moveActor(state, actor, at);
    }
    checkWinByLand(state, at);
    state.updatedAt = at;
  }

  function moveActor(state, actor, at) {
    const nx = actor.x + actor.dir.dx;
    const nz = actor.z + actor.dir.dz;
    const opponent = state.players[actor.slot === 1 ? 2 : 1];
    if (!inBounds(nx, nz)) {
      endGame(state, opponent.slot, "wall", at);
      return;
    }
    if (containsPoint(actor.trail, nx, nz)) {
      endGame(state, opponent.slot, "self_trail", at, { loser: actor.slot, x: nx, z: nz });
      return;
    }
    if (opponent && opponent.alive && containsPoint(opponent.trail, nx, nz)) {
      endGame(state, actor.slot, "opponent_trail", at, { loser: opponent.slot, x: nx, z: nz });
      return;
    }
    if (opponent && opponent.alive && opponent.x === nx && opponent.z === nz) {
      endGame(state, 0, "collision", at);
      return;
    }

    actor.x = nx;
    actor.z = nz;
    const currentLand = state.land[nz][nx];
    if (currentLand !== actor.landId) addTrail(actor, nx, nz);
    if (actor.trail.length > 0 && currentLand === actor.landId) claimArea(state, actor);
  }

  function addTrail(actor, x, z) {
    if (containsPoint(actor.trail, x, z)) return;
    actor.trail.push({ x, z });
    actor.trail.pointSet.add(pointKey(x, z));
  }

  function clearTrail(actor) {
    actor.trail = createPointList();
  }

  function claimArea(state, actor) {
    const land = state.land;
    const changed = [];
    const addChanged = (x, z) => {
      if (inBounds(x, z)) changed.push({ x, z });
    };

    for (const point of actor.trail) {
      if (inBounds(point.x, point.z)) {
        if (land[point.z][point.x] !== actor.landId) addChanged(point.x, point.z);
        land[point.z][point.x] = actor.landId;
      }
    }

    const total = GRID_SIZE * GRID_SIZE;
    const blocked = new Uint8Array(total);
    const outside = new Uint8Array(total);
    const queue = new Int32Array(total);
    let tail = 0;

    for (let z = 0; z < GRID_SIZE; z += 1) {
      for (let x = 0; x < GRID_SIZE; x += 1) {
        const index = pointKey(x, z);
        blocked[index] = land[z][x] === actor.landId || containsPoint(actor.trail, x, z) ? 1 : 0;
      }
    }

    const enqueue = (x, z) => {
      if (!inBounds(x, z)) return;
      const index = pointKey(x, z);
      if (outside[index] || blocked[index]) return;
      outside[index] = 1;
      queue[tail] = index;
      tail += 1;
    };

    for (let i = 0; i < GRID_SIZE; i += 1) {
      enqueue(i, 0);
      enqueue(i, GRID_SIZE - 1);
      enqueue(0, i);
      enqueue(GRID_SIZE - 1, i);
    }
    for (let head = 0; head < tail; head += 1) {
      const index = queue[head];
      const x = index % GRID_SIZE;
      const z = (index / GRID_SIZE) | 0;
      enqueue(x + 1, z);
      enqueue(x - 1, z);
      enqueue(x, z + 1);
      enqueue(x, z - 1);
    }

    for (let z = 0; z < GRID_SIZE; z += 1) {
      for (let x = 0; x < GRID_SIZE; x += 1) {
        if (!outside[pointKey(x, z)]) {
          if (land[z][x] !== actor.landId) addChanged(x, z);
          land[z][x] = actor.landId;
        }
      }
    }
    state.events.push({ type: "claim", slot: actor.slot, cells: dedupeCells(changed) });
    clearTrail(actor);
  }

  function dedupeCells(cells) {
    const seen = new Set();
    const result = [];
    for (const cell of cells) {
      const key = pointKey(cell.x, cell.z);
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(cell);
    }
    return result;
  }

  function countLand(state, owner) {
    let count = 0;
    for (let z = 0; z < GRID_SIZE; z += 1) {
      for (let x = 0; x < GRID_SIZE; x += 1) {
        if (state.land[z][x] === owner) count += 1;
      }
    }
    return count;
  }

  function score(state) {
    const total = GRID_SIZE * GRID_SIZE;
    const p1 = countLand(state, P1_LAND);
    const p2 = countLand(state, P2_LAND);
    return {
      p1,
      p2,
      p1Percent: Math.round((p1 / total) * 100),
      p2Percent: Math.round((p2 / total) * 100)
    };
  }

  function checkWinByLand(state, at) {
    if (state.phase !== "playing") return;
    const counts = score(state);
    const total = GRID_SIZE * GRID_SIZE;
    if (counts.p1 >= total * WIN_RATIO) endGame(state, 1, "land", at);
    else if (counts.p2 >= total * WIN_RATIO) endGame(state, 2, "land", at);
  }

  function forfeit(state, loserSlot, at = Date.now()) {
    if (state.phase === "ended") return state;
    const winner = Number(loserSlot) === 1 ? 2 : 1;
    endGame(state, winner, "forfeit", at, { loser: Number(loserSlot) });
    return state;
  }

  function endGame(state, winnerSlot, reason, at, detail = {}) {
    if (state.phase === "ended") return;
    state.phase = "ended";
    state.endedAt = at;
    state.updatedAt = at;
    const counts = score(state);
    state.result = {
      winnerSlot: Number(winnerSlot) || 0,
      loserSlot: detail.loser || (winnerSlot ? (winnerSlot === 1 ? 2 : 1) : 0),
      reason,
      endedAt: at,
      tick: state.tick,
      score: counts
    };
    state.events.push({ type: "ended", result: state.result });
  }

  function snapshot(state, now = Date.now()) {
    const publicState = serializeState(state);
    return {
      type: "snapshot",
      serverNow: now,
      tickMs: TICK_MS,
      countdownRemainingMs: state.phase === "countdown" ? Math.max(0, state.startAt - now) : 0,
      state: {
        phase: publicState.phase,
        tick: publicState.tick,
        mode: publicState.mode,
        ghostMode: publicState.ghostMode,
        countdownStartAt: publicState.countdownStartAt,
        startAt: publicState.startAt,
        updatedAt: publicState.updatedAt,
        endedAt: publicState.endedAt,
        land: publicState.land,
        players: publicState.players,
        score: score(state),
        result: publicState.result,
        events: state.events || []
      }
    };
  }

  return {
    GRID_SIZE,
    EMPTY,
    P1_LAND,
    P2_LAND,
    TICK_MS,
    createState,
    hydrateState,
    serializeState,
    beginCountdown,
    advanceTo,
    setDirection,
    forfeit,
    snapshot,
    score
  };
})();
