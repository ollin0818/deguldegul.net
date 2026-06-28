export const DegulServerGame = (() => {
  const GRID_SIZE = 31;
  const EMPTY = 0;
  const P1_LAND = 1;
  const P2_LAND = 2;
  const TICK_MS = 145;
  const SPEED_TICK_MS = 82;
  const ITEM_TICK_MS = 105;
  const INPUT_DELAY_TICKS = 1;
  const ITEM_LIFETIME_MS = 6000;
  const ITEM_FIRST_SPAWN_DELAY_MS = 3500;
  const ITEM_SPAWN_INTERVAL_MS = 4500;
  const ITEM_TYPES = ["area_claim"];
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
      lastInputAt: 0,
      pendingInputs: []
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
      landRevision: 0,
      landChanges: [],
      items: [],
      nextItemId: 1,
      nextItemSpawnAt: 0,
      players: {
        1: createActor(1),
        2: createActor(2)
      },
      result: null,
      events: []
    };
  }

  function getTickMs(state) {
    return state?.mode === "item" ? ITEM_TICK_MS : SPEED_TICK_MS;
  }

  function hydrateState(raw) {
    const state = raw && raw.version ? raw : createState();
    state.land = Array.isArray(state.land) ? state.land : createLand();
    state.landRevision = Number(state.landRevision || 0);
    state.landChanges = Array.isArray(state.landChanges) ? state.landChanges : [];
    for (const slot of [1, 2]) {
      const player = state.players && state.players[slot] ? state.players[slot] : createActor(slot);
      player.trail = createPointList(player.trail || []);
      player.dir = normalizeDirObject(player.dir) || (slot === 1 ? { dx: 1, dz: 0 } : { dx: -1, dz: 0 });
      player.nextDir = normalizeDirObject(player.nextDir) || { ...player.dir };
      player.pendingInputs = Array.isArray(player.pendingInputs) ? player.pendingInputs : [];
      state.players[slot] = player;
    }
    state.items = Array.isArray(state.items) ? state.items : [];
    state.nextItemId = Number(state.nextItemId || 1);
    state.nextItemSpawnAt = Number(state.nextItemSpawnAt || 0);
    state.events = Array.isArray(state.events) ? state.events : [];
    return state;
  }

  function serializeState(state) {
    return {
      ...state,
      items: (state.items || []).map((item) => ({ ...item })),
      players: {
        1: serializeActor(state.players[1]),
        2: serializeActor(state.players[2])
      },
      events: [],
      landChanges: []
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
    const targetTick = Number(state.tick || 0) + INPUT_DELAY_TICKS;
    player.pendingInputs = [{ seq: nextSeq, direction: name, targetTick, receivedAt: now }];
    player.lastSeq = nextSeq;
    player.lastInputAt = now;
    return { accepted: true, lastSeq: player.lastSeq, targetTick, inputDelayTicks: INPUT_DELAY_TICKS };
  }

  function beginCountdown(state, now = Date.now()) {
    if (state.phase === "playing" || state.phase === "ended" || state.phase === "countdown") return state;
    state.phase = "countdown";
    state.countdownStartAt = now;
    state.startAt = now + 3000;
    state.updatedAt = now;
    return state;
  }

  function advanceTo(state, now = Date.now()) {
    state.events = [];
    if (state.phase === "countdown" && now >= state.startAt) {
      state.phase = "playing";
      state.updatedAt = now;
      if (state.mode === "item" && !state.nextItemSpawnAt) state.nextItemSpawnAt = now + ITEM_FIRST_SPAWN_DELAY_MS;
      state.events.push({ type: "start", at: state.startAt });
    }
    const tickMs = getTickMs(state);
    while (state.phase === "playing" && state.updatedAt + tickMs <= now) {
      tick(state, state.updatedAt + tickMs);
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
      applyPendingInputs(actor, state.tick);
      actor.dir = { ...actor.nextDir };
      const nx = actor.x + actor.dir.dx;
      const nz = actor.z + actor.dir.dz;
      if (inBounds(nx, nz)) planned[slot] = { x: nx, z: nz };
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
    updateItems(state, at);
    checkWinByLand(state, at);
    state.updatedAt = at;
  }

  function applyPendingInputs(actor, tick) {
    if (!Array.isArray(actor.pendingInputs) || !actor.pendingInputs.length) return;
    const remaining = [];
    for (const input of actor.pendingInputs) {
      if (Number(input.targetTick || 0) > tick) {
        remaining.push(input);
        continue;
      }
      const dir = DIRS[normalizeDirName(input.direction)];
      if (!dir) continue;
      if (actor.dir && actor.dir.dx === -dir.dx && actor.dir.dz === -dir.dz) continue;
      actor.nextDir = { ...dir };
    }
    actor.pendingInputs = remaining.slice(-8);
  }

  function moveActor(state, actor, at) {
    const nx = actor.x + actor.dir.dx;
    const nz = actor.z + actor.dir.dz;
    const opponent = state.players[actor.slot === 1 ? 2 : 1];
    if (!inBounds(nx, nz)) {
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
    pickupItemAtActor(state, actor, at);
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
    const cells = dedupeCells(changed);
    if (cells.length) {
      state.landRevision = Number(state.landRevision || 0) + 1;
      state.landChanges.push({ revision: state.landRevision, slot: actor.slot, cells });
      state.landChanges = state.landChanges.slice(-8);
    }
    state.events.push({ type: "claim", slot: actor.slot, cells });
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

  function addLandChanges(state, slot, cells) {
    const deduped = dedupeCells(cells);
    if (!deduped.length) return;
    state.landRevision = Number(state.landRevision || 0) + 1;
    state.landChanges.push({ revision: state.landRevision, slot, cells: deduped });
    state.landChanges = state.landChanges.slice(-8);
  }

  function updateItems(state, at) {
    if (state.mode !== "item" || state.phase !== "playing") {
      state.items = [];
      return;
    }
    state.items = (state.items || []).filter((item) => at - Number(item.bornAt || 0) <= ITEM_LIFETIME_MS);
    if (!state.nextItemSpawnAt) state.nextItemSpawnAt = at + ITEM_FIRST_SPAWN_DELAY_MS;
    if (at < state.nextItemSpawnAt) return;
    spawnItem(state, at);
    state.nextItemSpawnAt = at + ITEM_SPAWN_INTERVAL_MS;
  }

  function spawnItem(state, at) {
    const candidates = [];
    for (let z = 2; z < GRID_SIZE - 2; z += 1) {
      for (let x = 2; x < GRID_SIZE - 2; x += 1) {
        if (state.players[1]?.alive && state.players[1].x === x && state.players[1].z === z) continue;
        if (state.players[2]?.alive && state.players[2].x === x && state.players[2].z === z) continue;
        if (containsPoint(state.players[1]?.trail, x, z) || containsPoint(state.players[2]?.trail, x, z)) continue;
        if ((state.items || []).some((item) => item.x === x && item.z === z)) continue;
        candidates.push({ x, z });
      }
    }
    if (!candidates.length) return;
    const spot = candidates[Math.floor(Math.random() * candidates.length)];
    const type = ITEM_TYPES[Math.floor(Math.random() * ITEM_TYPES.length)] || "area_claim";
    const item = {
      id: state.nextItemId,
      type,
      x: spot.x,
      z: spot.z,
      bornAt: at,
      lifetimeMs: ITEM_LIFETIME_MS
    };
    state.nextItemId = Number(state.nextItemId || 1) + 1;
    state.items = [...(state.items || []), item].slice(-4);
    state.events.push({ type: "item_spawn", item });
  }

  function pickupItemAtActor(state, actor, at) {
    if (state.mode !== "item" || !Array.isArray(state.items) || !state.items.length) return;
    const index = state.items.findIndex((item) => item && item.x === actor.x && item.z === actor.z);
    if (index < 0) return;
    const [item] = state.items.splice(index, 1);
    if (!item) return;
    if (item.type === "area_claim") claimItemArea(state, actor, item.x, item.z);
    state.events.push({ type: "item_pickup", slot: actor.slot, item });
  }

  function claimItemArea(state, actor, cx, cz) {
    const changed = [];
    for (let z = cz - 2; z <= cz + 2; z += 1) {
      for (let x = cx - 2; x <= cx + 2; x += 1) {
        if (!inBounds(x, z)) continue;
        if (state.land[z][x] !== actor.landId) changed.push({ x, z });
        state.land[z][x] = actor.landId;
      }
    }
    addLandChanges(state, actor.slot, changed);
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

  function snapshot(state, now = Date.now(), options = {}) {
    const publicState = serializeState(state);
    const full = options.full === true || state.phase !== "playing";
    const sinceLandRevision = Number(options.sinceLandRevision || 0);
    const landDelta = full ? [] : (state.landChanges || [])
      .filter((change) => Number(change.revision || 0) > sinceLandRevision)
      .flatMap((change) => (change.cells || []).map((cell) => ({ ...cell, owner: state.players[change.slot]?.landId || change.slot })));
    return {
      type: "snapshot",
      serverNow: now,
      tickMs: getTickMs(state),
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
        land: full ? publicState.land : undefined,
        landRevision: Number(state.landRevision || 0),
        landDelta,
        items: publicState.items || [],
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
    SPEED_TICK_MS,
    ITEM_TICK_MS,
    getTickMs,
    INPUT_DELAY_TICKS,
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
