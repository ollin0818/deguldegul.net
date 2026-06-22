// ===================== 흔적 라인 =====================
function createTrailVisual(actor, x, z) {
  const group = new THREE.Group();
  group.position.set(toWorld(x), 0, toWorld(z));
  group.userData.isTrailVisual = true;

  const baseMat = new THREE.MeshStandardMaterial({
    color: actor.lineColor,
    emissive: actor.lineColor,
    emissiveIntensity: 0.18,
    roughness: 0.4
  });
  const base = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.09, 0.72), baseMat);
  base.position.y = 0.045;
  group.add(base);
  group.userData.base = base;

  // 보호막 발동 중에는 흔적 라인이 반투명한 2칸 높이의 벽 큐브처럼 보인다.
  const wallMat = new THREE.MeshStandardMaterial({
    color: actor.lineColor,
    emissive: actor.lineColor,
    emissiveIntensity: 0.32,
    roughness: 0.28,
    metalness: 0.02,
    transparent: true,
    opacity: 0.34,
    depthWrite: false
  });
  const wall = new THREE.Mesh(new THREE.BoxGeometry(0.78, 1.86, 0.78), wallMat);
  wall.position.y = 0.93;
  wall.castShadow = false;
  wall.receiveShadow = false;
  wall.visible = false;
  group.add(wall);
  group.userData.shieldWall = wall;

  // 1차 최적화: 보호막 벽 외곽선(EdgesGeometry)은 저사양 GPU 부담이 커서 제거

  return group;
}

function applyShieldTrailWallVisual(visual, visible) {
  if (!visual || !visual.userData) return;
  const wall = visual.userData.shieldWall;
  const base = visual.userData.base;

  if (wall) {
    wall.visible = visible;
    wall.scale.y = 1;
    if (wall.material) wall.material.opacity = visible ? 0.32 : 0;
  }

  if (base && base.material) {
    base.material.emissiveIntensity = visible ? 0.30 : 0.18;
  }
}

function setShieldTrailWalls(actor, visible, now = performance.now(), force = false) {
  if (!actor || !actor.trailMeshes) return;

  // 1차 최적화: 매 프레임 모든 흔적 벽을 펄스 애니메이션으로 갱신하지 않고,
  // 보호막 ON/OFF 상태가 바뀔 때만 전체 흔적라인 표시 상태를 변경한다.
  if (!force && actor._shieldTrailVisible === visible) return;
  actor._shieldTrailVisible = visible;

  for (const visual of actor.trailMeshes) {
    applyShieldTrailWallVisual(visual, visible);
  }
}

function disposeMaterialResource(material) {
  if (!material) return;
  if (!(material.userData && material.userData.preserveTexturesOnDispose)) {
    const textureKeys = ["map", "alphaMap", "aoMap", "bumpMap", "displacementMap", "emissiveMap", "envMap", "lightMap", "metalnessMap", "normalMap", "roughnessMap"];
    for (const key of textureKeys) {
      const texture = material[key];
      if (texture && typeof texture.dispose === "function") texture.dispose();
    }
  }
  if (typeof material.dispose === "function") material.dispose();
}

function disposeObject3D(object) {
  if (!object) return;
  object.traverse(child => {
    if (child.geometry) child.geometry.dispose();
    if (Array.isArray(child.material)) {
      child.material.forEach(disposeMaterialResource);
    } else {
      disposeMaterialResource(child.material);
    }
  });
}

function addTrail(actor, x, z) {
  if (containsPoint(actor.trail, x, z)) return;

  actor.trail.push({x, z});
  if (actor.trail.pointSet) actor.trail.pointSet.add(pointKey(x, z));

  // 고스트 모드: 흔적 데이터는 남겨서 점령/사망 판정은 유지하지만 화면에는 표시하지 않는다.
  if (ghostModeEnabled) return;

  const visual = createTrailVisual(actor, x, z);
  boardGroup.add(visual);
  actor.trailMeshes.push(visual);
  // 1차 최적화: 새로 생긴 흔적만 보호막 벽 표시 상태를 적용한다.
  applyShieldTrailWallVisual(visual, isShieldActive(actor));
}

function clearTrail(actor) {
  for (const mesh of actor.trailMeshes) {
    boardGroup.remove(mesh);
    disposeObject3D(mesh);
  }
  actor.trail = createPointList();
  actor.trailMeshes = [];
  actor._shieldTrailVisible = null;
}

// ===================== 영역 점령 =====================
function claimArea(actor) {
  const claimStartedAt = performance.now();
  const glowCells = [];

  function addGlowCell(x, z) {
    if (!inBounds(x, z)) return;
    const key = `${x},${z}`;
    if (addGlowCell.seen.has(key)) return;
    addGlowCell.seen.add(key);
    glowCells.push({x, z});
  }
  addGlowCell.seen = new Set();

  for (const p of actor.trail) {
    if (inBounds(p.x, p.z)) {
      if (land[p.z][p.x] !== actor.landId) addGlowCell(p.x, p.z);
      land[p.z][p.x] = actor.landId;
    }
  }

  /*
    flood fill:
    자기 땅과 라인을 벽으로 보고
    바깥과 연결되지 않은 칸을 둘러싼 영역으로 판단.
  */
  const totalCells = GRID_SIZE * GRID_SIZE;
  const blocked = new Uint8Array(totalCells);
  const outside = new Uint8Array(totalCells);
  const queue = new Int32Array(totalCells);
  let queueTail = 0;

  for (let z = 0; z < GRID_SIZE; z++) {
    for (let x = 0; x < GRID_SIZE; x++) {
      const index = z * GRID_SIZE + x;
      blocked[index] = land[z][x] === actor.landId || containsPoint(actor.trail, x, z) ? 1 : 0;
    }
  }

  for (let i = 0; i < GRID_SIZE; i++) {
    enqueueOutside(i, 0);
    enqueueOutside(i, GRID_SIZE - 1);
    enqueueOutside(0, i);
    enqueueOutside(GRID_SIZE - 1, i);
  }

  function enqueueOutside(x, z) {
    if (!inBounds(x, z)) return;
    const index = z * GRID_SIZE + x;
    if (outside[index] || blocked[index]) return;
    outside[index] = 1;
    queue[queueTail++] = index;
  }

  for (let head = 0; head < queueTail; head++) {
    const index = queue[head];
    const x = index % GRID_SIZE;
    const z = (index / GRID_SIZE) | 0;
    enqueueOutside(x + 1, z);
    enqueueOutside(x - 1, z);
    enqueueOutside(x, z + 1);
    enqueueOutside(x, z - 1);
  }

  for (let z = 0; z < GRID_SIZE; z++) {
    for (let x = 0; x < GRID_SIZE; x++) {
      if (!outside[z * GRID_SIZE + x]) {
        if (land[z][x] !== actor.landId) addGlowCell(x, z);
        land[z][x] = actor.landId;
      }
    }
  }

  if (glowCells.length > 0) DegulSfx.playCapture(actor);
  assignRainbowIndices(actor.landId, glowCells);
  clearTrail(actor);
  refreshBoardCells(glowCells);
  createLandClaimGlow(actor, glowCells);
  updateScoreUI();
  performanceMetrics.lastClaimMs = performance.now() - claimStartedAt;
}

// ===================== 영역 점령 발광 이펙트 =====================
function createLandClaimGlow(actor, claimedCells) {
  if (!actor || !claimedCells || claimedCells.length === 0) return;

  const colorData = getColorDataForLandId(actor.landId) || selectedColors[actor === p1 ? 1 : 2];
  const glowColor = colorData ? colorData.landLight : actor.lineColor;
  const group = new THREE.Group();
  group.userData.startedAt = performance.now();
  group.userData.duration = 620;
  group.userData.tiles = [];

  // 너무 넓은 영역을 한 번에 먹어도 렉이 걸리지 않게 최대 표시 수를 제한한다.
  const maxGlowTiles = performanceConfig.glowTiles;
  const step = Math.max(1, Math.ceil(claimedCells.length / maxGlowTiles));

  const pulseMat = new THREE.MeshBasicMaterial({
    color: glowColor,
    transparent: true,
    opacity: 0.42,
    depthWrite: false,
    blending: THREE.AdditiveBlending
  });

  const rimMat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.36,
    depthWrite: false,
    blending: THREE.AdditiveBlending
  });

  const pulseGeo = new THREE.BoxGeometry(0.98, 0.035, 0.98);
  const rimGeo = new THREE.BoxGeometry(0.74, 0.04, 0.74);

  for (let i = 0; i < claimedCells.length; i += step) {
    const cell = claimedCells[i];
    if (!inBounds(cell.x, cell.z)) continue;

    const pulse = new THREE.Mesh(pulseGeo, pulseMat.clone());
    pulse.position.set(toWorld(cell.x), 0.155, toWorld(cell.z));
    pulse.userData.baseY = pulse.position.y;
    pulse.userData.phase = Math.random() * Math.PI * 2;
    pulse.renderOrder = 5;
    group.add(pulse);
    group.userData.tiles.push(pulse);

    // 일부 칸에 흰색 림을 섞어서 발광이 너무 평면적으로 보이지 않게 한다.
    if (i % (step * 3) === 0) {
      const rim = new THREE.Mesh(rimGeo, rimMat.clone());
      rim.position.set(toWorld(cell.x), 0.18, toWorld(cell.z));
      rim.userData.baseY = rim.position.y;
      rim.userData.phase = Math.random() * Math.PI * 2;
      rim.renderOrder = 6;
      group.add(rim);
      group.userData.tiles.push(rim);
    }
  }

  boardGroup.add(group);
  activeClaimGlowEffects.push(group);
}

function updateClaimGlowEffects() {
  if (!activeClaimGlowEffects.length) return;

  const now = performance.now();

  for (let i = activeClaimGlowEffects.length - 1; i >= 0; i--) {
    const group = activeClaimGlowEffects[i];
    const elapsed = now - group.userData.startedAt;
    const t = Math.min(elapsed / group.userData.duration, 1);
    const fade = 1 - easeOutCubic(t);
    const lift = Math.sin(t * Math.PI) * 0.085;
    const scale = 1 + Math.sin(t * Math.PI) * 0.16;

    for (const tile of group.userData.tiles) {
      tile.position.y = tile.userData.baseY + lift + Math.sin(now * 0.014 + tile.userData.phase) * 0.006;
      tile.scale.set(scale, 1, scale);
      if (tile.material) tile.material.opacity = tile.geometry.parameters.width < 0.8 ? 0.34 * fade : 0.46 * fade;
    }

    if (t >= 1) {
      boardGroup.remove(group);
      disposeObjectTree(group);
      activeClaimGlowEffects.splice(i, 1);
    }
  }
}

function clearClaimGlowEffects() {
  for (const group of activeClaimGlowEffects) {
    if (group.parent) group.parent.remove(group);
    disposeObjectTree(group);
  }
  activeClaimGlowEffects = [];
}




// ===================== 아이템 시스템 =====================
const ITEM_TYPES = {
  AREA: "area_claim",
  MOVE_BOOST: "speed_boost",
  SHIELD: "shield",
  LINE_SURGE: "line_surge",
  AI_SUMMON: "robot_vacuum"
};

const ITEM_DEFINITIONS = [
  { type: ITEM_TYPES.AREA, label: "영역확장", weight: 1 },
  { type: ITEM_TYPES.MOVE_BOOST, label: "스피드 부스트", weight: 1 },
  { type: ITEM_TYPES.SHIELD, label: "보호막", weight: 1 },
  { type: ITEM_TYPES.LINE_SURGE, label: "거대화", weight: 1 },
  { type: ITEM_TYPES.AI_SUMMON, label: "로봇청소기", weight: 0.85 }
];

function startItemSpawner() {
  stopItemSpawner();

  if (gameMode !== "item") return;

  const createItemSpawnInterval = (intervalMs) => {
    if (itemSpawnIntervalTimer) {
      clearInterval(itemSpawnIntervalTimer);
      itemSpawnIntervalTimer = null;
    }

    itemSpawnIntervalTimer = setInterval(() => {
      if (!gameStarted || gameOver || isCountingDown || isPaused || gameMode !== "item") return;
      spawnRandomItem();
    }, intervalMs);
  };

  itemSpawnDelayTimer = setTimeout(() => {
    if (!gameStarted || gameOver || isCountingDown || isPaused || gameMode !== "item") return;

    spawnRandomItem();
    createItemSpawnInterval(5000);

    itemSpawnSpeedupTimer = setTimeout(() => {
      if (!gameStarted || gameOver || isCountingDown || gameMode !== "item") return;
      createItemSpawnInterval(3000);
    }, 20000);
  }, 5000);
}

function stopItemSpawner() {
  if (itemSpawnDelayTimer) {
    clearTimeout(itemSpawnDelayTimer);
    itemSpawnDelayTimer = null;
  }

  if (itemSpawnIntervalTimer) {
    clearInterval(itemSpawnIntervalTimer);
    itemSpawnIntervalTimer = null;
  }

  if (itemSpawnSpeedupTimer) {
    clearTimeout(itemSpawnSpeedupTimer);
    itemSpawnSpeedupTimer = null;
  }

  clearAreaItem();
  clearSummonedAiAssists();
}

function chooseRandomItemType() {
  const total = ITEM_DEFINITIONS.reduce((sum, item) => sum + item.weight, 0);
  let roll = Math.random() * total;

  for (const item of ITEM_DEFINITIONS) {
    roll -= item.weight;
    if (roll <= 0) return item.type;
  }

  return ITEM_TYPES.AREA;
}

function syncActiveItemReference() {
  activeItem = activeItems && activeItems.length ? activeItems[0] : null;
}

function createItemSpawnTileGlow(x, z) {
  const group = new THREE.Group();
  group.name = "ItemSpawnTileGlow";
  // 영역점령 아이템의 5×5 미리보기 타일은 점멸 중 최대 Y 약 0.157까지 올라온다.
  // 생성 칸의 노란 효과가 그 아래에 가려지지 않도록 항상 조금 더 위에 배치한다.
  group.position.set(toWorld(x), 0.18, toWorld(z));

  const glowMaterial = new THREE.MeshBasicMaterial({
    color: 0xffbd00,
    transparent: true,
    opacity: 0.72,
    blending: THREE.NormalBlending,
    depthWrite: false,
    side: THREE.DoubleSide
  });
  const glow = new THREE.Mesh(
    new THREE.PlaneGeometry(TILE_VISUAL_SIZE * 0.94, TILE_VISUAL_SIZE * 0.94),
    glowMaterial
  );
  glow.rotation.x = -Math.PI / 2;
  glow.renderOrder = 3;
  group.add(glow);

  const sparkleMaterial = new THREE.MeshBasicMaterial({
    color: 0xffff9a,
    transparent: true,
    opacity: 0.85,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide
  });
  const sparkleGeometry = new THREE.PlaneGeometry(TILE_VISUAL_SIZE * 0.17, TILE_VISUAL_SIZE * 0.17);
  const sparkleOffsets = [
    [-0.31, -0.29],
    [0.30, -0.23],
    [-0.24, 0.31],
    [0.27, 0.28]
  ];

  for (const [offsetX, offsetZ] of sparkleOffsets) {
    const sparkle = new THREE.Mesh(sparkleGeometry, sparkleMaterial);
    sparkle.position.set(offsetX, 0.006, offsetZ);
    sparkle.rotation.x = -Math.PI / 2;
    sparkle.rotation.z = Math.PI / 4;
    sparkle.renderOrder = 4;
    group.add(sparkle);
  }

  group.userData.glow = glow;
  group.userData.sparkles = group.children.slice(1);
  boardGroup.add(group);
  return group;
}

function updateItemSpawnTileGlow(item, now) {
  const group = item && item.tileGlow;
  if (!group) return;

  const t = now * 0.001;
  const pulse = 0.5 + 0.5 * Math.sin(t * 8.2 + item.x * 0.31 + item.z * 0.27);
  const glow = group.userData.glow;

  if (glow && glow.material) {
    // 밝은 타일에서도 노란색이 흰색으로 탈색되지 않도록 높은 기본 불투명도를 유지한다.
    glow.material.opacity = 0.56 + pulse * 0.34;
    const glowScale = 0.96 + pulse * 0.055;
    glow.scale.set(glowScale, glowScale, 1);
  }

  const sparkles = group.userData.sparkles || [];
  sparkles.forEach((sparkle, index) => {
    const sparklePulse = 0.5 + 0.5 * Math.sin(t * 11.5 + index * 1.65);
    sparkle.visible = sparklePulse > 0.22;
    sparkle.material.opacity = 0.30 + sparklePulse * 0.70;
    const sparkleScale = 0.45 + sparklePulse * 0.85;
    sparkle.scale.set(sparkleScale, sparkleScale, 1);
  });
}

function clearItemSpawnTileGlow(item) {
  if (!item || !item.tileGlow) return;

  const group = item.tileGlow;
  boardGroup.remove(group);
  group.traverse(obj => {
    if (obj.geometry) obj.geometry.dispose();
    if (obj.material) obj.material.dispose();
  });
  item.tileGlow = null;
}

function spawnRandomItem() {
  const candidates = [];

  for (let z = 2; z < GRID_SIZE - 2; z++) {
    for (let x = 2; x < GRID_SIZE - 2; x++) {
      if (p1 && p1.alive && p1.x === x && p1.z === z) continue;
      if (p2 && p2.alive && p2.x === x && p2.z === z) continue;
      if (p1 && containsPoint(p1.trail, x, z)) continue;
      if (p2 && containsPoint(p2.trail, x, z)) continue;
      if (activeItems && activeItems.some(item => item && item.x === x && item.z === z)) continue;
      candidates.push({x, z});
    }
  }

  if (!candidates.length) return;

  const spot = candidates[Math.floor(Math.random() * candidates.length)];
  const type = chooseRandomItemType();
  const group = createItemObject(type);
  const itemSpawnY = type === ITEM_TYPES.MOVE_BOOST ? 0.54 : 0.78;
  group.position.set(toWorld(spot.x), itemSpawnY, toWorld(spot.z));
  scene.add(group);

  const item = {
    type,
    x: spot.x,
    z: spot.z,
    group,
    core: group.userData.core,
    ring: group.userData.ring,
    accent: group.userData.accent,
    previewMeshes: [],
    previewOwner: 1,
    lastPreviewSwap: 0,
    bornAt: performance.now(),
    lifetimeMs: 6000,
    tileGlow: createItemSpawnTileGlow(spot.x, spot.z)
  };

  activeItems.push(item);
  DegulSfx.oneShot("spawn");
  syncActiveItemReference();

  if (type === ITEM_TYPES.AREA) {
    createItemClaimPreview(item);
  }
}

function createItemIconTexture(type) {
  const key = type || "default";
  if (!createItemIconTexture.cache) createItemIconTexture.cache = {};
  if (createItemIconTexture.cache[key]) return createItemIconTexture.cache[key];

  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext("2d");

  ctx.clearRect(0, 0, 256, 256);
  ctx.shadowColor = "rgba(255,255,255,0.55)";
  ctx.shadowBlur = 10;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = "rgba(255,255,255,0.96)";
  ctx.fillStyle = "rgba(255,255,255,0.96)";

  if (type === ITEM_TYPES.AREA) {
    // 3×3 점령 타일 + 깃발: 주변 영역을 즉시 칠한다는 의미
    ctx.shadowBlur = 8;
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 3; col++) {
        ctx.globalAlpha = row === 1 && col === 1 ? 1 : 0.72;
        roundRect(ctx, 45 + col * 45, 64 + row * 38, 34, 28, 7);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
    ctx.lineWidth = 12;
    ctx.beginPath();
    ctx.moveTo(128, 46);
    ctx.lineTo(128, 188);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(132, 50);
    ctx.lineTo(196, 76);
    ctx.lineTo(132, 104);
    ctx.closePath();
    ctx.fill();
  } else if (type === ITEM_TYPES.MOVE_BOOST) {
    // 번개 + 속도선: 딱 보면 빨라지는 아이템
    ctx.fillStyle = "rgba(255,255,255,0.98)";
    ctx.beginPath();
    ctx.moveTo(138, 28);
    ctx.lineTo(70, 136);
    ctx.lineTo(122, 130);
    ctx.lineTo(100, 228);
    ctx.lineTo(188, 104);
    ctx.lineTo(134, 112);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 0.72;
    ctx.fillRect(36, 70, 54, 16);
    ctx.fillRect(22, 118, 62, 16);
    ctx.fillRect(38, 166, 42, 16);
    ctx.globalAlpha = 1;
  } else if (type === ITEM_TYPES.SHIELD) {
    // 방패 + 보호 돔: 라인을 막아주는 방어 아이템
    ctx.beginPath();
    ctx.moveTo(128, 34);
    ctx.bezierCurveTo(178, 50, 205, 64, 205, 64);
    ctx.bezierCurveTo(202, 146, 176, 196, 128, 224);
    ctx.bezierCurveTo(80, 196, 54, 146, 51, 64);
    ctx.bezierCurveTo(51, 64, 78, 50, 128, 34);
    ctx.closePath();
    ctx.fill();
    ctx.globalCompositeOperation = "destination-out";
    ctx.beginPath();
    ctx.moveTo(128, 75);
    ctx.bezierCurveTo(154, 84, 168, 91, 168, 91);
    ctx.bezierCurveTo(164, 142, 151, 170, 128, 188);
    ctx.bezierCurveTo(105, 170, 92, 142, 88, 91);
    ctx.bezierCurveTo(88, 91, 102, 84, 128, 75);
    ctx.closePath();
    ctx.fill();
    ctx.globalCompositeOperation = "source-over";
    ctx.lineWidth = 10;
    ctx.globalAlpha = 0.70;
    ctx.beginPath();
    ctx.arc(128, 130, 86, Math.PI * 1.08, Math.PI * 1.92);
    ctx.stroke();
    ctx.globalAlpha = 1;
  } else if (type === ITEM_TYPES.LINE_SURGE) {
    // 거대 큐브 + 위쪽 화살표: 3×3으로 커지는 효과를 바로 인지
    ctx.globalAlpha = 0.55;
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 3; col++) {
        roundRect(ctx, 46 + col * 45, 112 + row * 34, 34, 26, 6);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
    ctx.lineWidth = 16;
    ctx.beginPath();
    ctx.moveTo(128, 92);
    ctx.lineTo(128, 30);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(82, 78);
    ctx.lineTo(128, 28);
    ctx.lineTo(174, 78);
    ctx.closePath();
    ctx.fill();
    ctx.lineWidth = 10;
    ctx.strokeRect(84, 114, 88, 78);
  } else if (type === ITEM_TYPES.AI_SUMMON) {
    // 로봇청소기 본체 + 회전 브러시 + 청소 라인: 상대 영역을 청소해 빈 영역으로 만든다는 의미
    ctx.shadowColor = "rgba(0,122,255,0.52)";
    ctx.shadowBlur = 12;
    ctx.fillStyle = "#f8fafc";
    ctx.strokeStyle = "rgba(17,24,39,0.92)";
    ctx.lineWidth = 10;
    ctx.beginPath();
    ctx.arc(128, 128, 62, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.shadowBlur = 0;
    ctx.fillStyle = "rgba(17,24,39,0.10)";
    ctx.beginPath();
    ctx.arc(128, 128, 38, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "rgba(0,122,255,0.86)";
    ctx.beginPath();
    ctx.arc(128, 102, 9, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = "rgba(17,24,39,0.82)";
    ctx.lineWidth = 8;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(84, 166);
    ctx.lineTo(172, 166);
    ctx.stroke();

    ctx.strokeStyle = "rgba(0,122,255,0.72)";
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.moveTo(84, 190);
    ctx.lineTo(172, 190);
    ctx.stroke();

    ctx.fillStyle = "rgba(17,24,39,0.88)";
    ctx.beginPath();
    ctx.arc(96, 92, 7, 0, Math.PI * 2);
    ctx.arc(160, 92, 7, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.beginPath();
    ctx.arc(128, 128, 64, 0, Math.PI * 2);
    ctx.fill();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  createItemIconTexture.cache[key] = texture;
  return texture;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function addIconPlaneToItemCube(group, type, position, rotation) {
  const texture = createItemIconTexture(type);
  const mat = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    opacity: 0.96,
    depthWrite: false,
    side: THREE.DoubleSide
  });
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(0.44, 0.44), mat);
  plane.position.copy(position);
  plane.rotation.set(rotation.x || 0, rotation.y || 0, rotation.z || 0);
  group.add(plane);
  return plane;
}

function getItemBaseColor(type, owner = 1) {
  if (type === ITEM_TYPES.AREA) return selectedColors[owner]?.actor || 0x34c759;
  if (type === ITEM_TYPES.MOVE_BOOST) return 0xffcc00;
  if (type === ITEM_TYPES.SHIELD) return 0x0a84ff;
  if (type === ITEM_TYPES.LINE_SURGE) return 0xff3b30;
  if (type === ITEM_TYPES.AI_SUMMON) return 0x7c3cff;
  return 0xffd166;
}

function applyItemObjectColor(itemOrGroup, colorValue) {
  const group = itemOrGroup?.group || itemOrGroup;
  if (!group || !group.userData) return;

  const color = new THREE.Color(colorValue);
  const core = group.userData.core;
  const ring = group.userData.ring;

  if (core && core.material) {
    core.material.color.copy(color);
    core.material.emissive.copy(color);
    core.material.emissiveIntensity = isDarkMode ? 1.12 : 0.78;
  }

  if (ring && ring.material) {
    ring.material.color.copy(color);
  }
}

function createShieldOrbitObject() {
  const orbit = new THREE.Group();
  orbit.name = "ShieldItemOrbit";

  const shieldTex = createItemIconTexture(ITEM_TYPES.SHIELD);
  const shieldMat = new THREE.MeshBasicMaterial({
    map: shieldTex,
    transparent: true,
    opacity: 0.92,
    depthWrite: false,
    side: THREE.DoubleSide
  });

  const shieldGeo = new THREE.PlaneGeometry(0.32, 0.32);
  const radius = 0.62;

  for (let i = 0; i < 4; i++) {
    const angle = i * Math.PI / 2;
    const shield = new THREE.Mesh(shieldGeo.clone(), shieldMat.clone());
    shield.position.set(Math.cos(angle) * radius, 0.02, Math.sin(angle) * radius);
    shield.rotation.y = -angle + Math.PI / 2;
    shield.userData.orbitAngle = angle;
    orbit.add(shield);
  }

  return orbit;
}


function createItemTileGridObject(owner = 1) {
  const group = new THREE.Group();
  group.name = "AreaSkinBoxItem";

  const colorData = selectedColors[owner] || selectedColors[1] || COLOR_CHOICES[0];
  const mat = new THREE.MeshStandardMaterial({
    color: colorData.actor,
    emissive: colorData.actor,
    emissiveIntensity: isDarkMode ? 0.95 : 0.56,
    roughness: 0.34,
    metalness: 0.06
  });
  applySkinToMaterial(mat, colorData, "actor");
  mat.emissive.set(colorData.actor || 0x34c759);
  mat.emissiveIntensity = isDarkMode ? 0.86 : 0.44;

  const cube = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.58, 0.58), mat);
  cube.position.y = 0.48;
  cube.castShadow = true;
  cube.receiveShadow = true;
  group.add(cube);

  const edge = new THREE.LineSegments(
    new THREE.EdgesGeometry(cube.geometry),
    new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.72 })
  );
  cube.add(edge);

  const glow = new THREE.Mesh(
    new THREE.BoxGeometry(0.90, 0.90, 0.90),
    new THREE.MeshBasicMaterial({
      color: colorData.actor || 0x34c759,
      transparent: true,
      opacity: 0.14,
      wireframe: true
    })
  );
  glow.position.y = 0.48;
  group.add(glow);

  group.userData.core = cube;
  group.userData.ring = glow;
  group.userData.accent = edge;
  group.userData.owner = owner;
  return group;
}

function applyAreaItemSkin(itemOrGroup, owner = 1) {
  const group = itemOrGroup?.group || itemOrGroup;
  if (!group || !group.userData) return;

  const visual = group.userData.visual || group;
  const colorData = selectedColors[owner] || selectedColors[1] || COLOR_CHOICES[0];
  const core = visual.userData?.core || group.userData.core;
  const ring = visual.userData?.ring || group.userData.ring;

  if (core && core.material) {
    applySkinToMaterial(core.material, colorData, "actor");
    core.material.emissive.set(colorData.actor || 0x34c759);
    core.material.emissiveIntensity = isDarkMode ? 0.86 : 0.44;
    core.material.needsUpdate = true;
  }

  if (ring && ring.material) {
    ring.material.color.set(colorData.actor || 0x34c759);
    ring.material.opacity = 0.12;
  }

  visual.userData.owner = owner;
  group.userData.lastAreaColorOwner = owner;
}

function createItemLightningObject() {
  const group = new THREE.Group();
  const shape = new THREE.Shape();
  shape.moveTo(0.08, 0.54);
  shape.lineTo(-0.28, 0.04);
  shape.lineTo(-0.04, 0.06);
  shape.lineTo(-0.16, -0.54);
  shape.lineTo(0.34, 0.12);
  shape.lineTo(0.05, 0.08);
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.075, bevelEnabled: true, bevelThickness: 0.018, bevelSize: 0.018, bevelSegments: 1 });
  const mat = new THREE.MeshStandardMaterial({
    color: 0xffcc00,
    emissive: 0xffcc00,
    emissiveIntensity: isDarkMode ? 1.25 : 0.95,
    roughness: 0.16,
    metalness: 0.10
  });
  const bolt = new THREE.Mesh(geo, mat);
  bolt.rotation.x = Math.PI / 2;
  bolt.position.y = 0.50;
  bolt.castShadow = true;
  group.add(bolt);

  const glow = new THREE.Mesh(
    new THREE.SphereGeometry(0.62, 28, 14),
    new THREE.MeshBasicMaterial({ color: 0xffcc00, transparent: true, opacity: 0.18, wireframe: true })
  );
  glow.position.y = 0.47;
  group.add(glow);
  group.userData.core = bolt;
  group.userData.ring = glow;
  return group;
}

function createItemShieldDomeObject(colorValue) {
  const group = new THREE.Group();
  const shieldShape = new THREE.Shape();
  shieldShape.moveTo(0, 0.48);
  shieldShape.bezierCurveTo(0.34, 0.38, 0.50, 0.28, 0.50, 0.28);
  shieldShape.bezierCurveTo(0.48, -0.18, 0.28, -0.44, 0, -0.58);
  shieldShape.bezierCurveTo(-0.28, -0.44, -0.48, -0.18, -0.50, 0.28);
  shieldShape.bezierCurveTo(-0.50, 0.28, -0.34, 0.38, 0, 0.48);
  shieldShape.closePath();

  const shieldGeo = new THREE.ExtrudeGeometry(shieldShape, { depth: 0.06, bevelEnabled: true, bevelThickness: 0.018, bevelSize: 0.018, bevelSegments: 1 });
  const shieldMat = new THREE.MeshStandardMaterial({
    color: 0x0a84ff,
    emissive: 0x0a84ff,
    emissiveIntensity: isDarkMode ? 1.05 : 0.76,
    roughness: 0.18,
    metalness: 0.08,
    transparent: true,
    opacity: 0.86
  });
  const shield = new THREE.Mesh(shieldGeo, shieldMat);
  shield.rotation.x = Math.PI / 2;
  shield.position.y = 0.48;
  shield.castShadow = true;
  group.add(shield);

  const rim = new THREE.LineSegments(
    new THREE.EdgesGeometry(shieldGeo),
    new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.75 })
  );
  shield.add(rim);

  const aura = new THREE.Mesh(
    new THREE.SphereGeometry(0.68, 32, 16, 0, Math.PI * 2, 0, Math.PI * 0.58),
    new THREE.MeshBasicMaterial({ color: 0x0a84ff, transparent: true, opacity: 0.18, wireframe: true })
  );
  aura.position.y = 0.20;
  group.add(aura);
  group.userData.core = shield;
  group.userData.ring = aura;
  group.userData.accent = rim;
  return group;
}

function createItemGiantObject(colorValue) {
  const group = new THREE.Group();
  group.name = "GiantGrowingSkinCubeItem";

  // 거대화 아이템: 생성된 칸의 정중앙에 뜬 큐브가
  // 1P/2P 블럭 스킨을 번갈아 보여주며 6초 동안 2×2 크기까지 천천히 커진다.
  const colorData = selectedColors[1] || COLOR_CHOICES[0];
  const mat = new THREE.MeshStandardMaterial({
    color: colorData.actor || colorValue || 0xffc400,
    emissive: colorData.actor || colorValue || 0xffc400,
    emissiveIntensity: isDarkMode ? 0.9 : 0.48,
    roughness: 0.34,
    metalness: 0.06
  });
  applySkinToMaterial(mat, colorData, "actor");
  mat.emissive.set(colorData.actor || colorValue || 0xffc400);

  const cube = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), mat);
  cube.position.set(0, 0, 0);
  cube.scale.set(0.58, 0.58, 0.58);
  cube.castShadow = true;
  cube.receiveShadow = true;
  group.add(cube);

  const edge = new THREE.LineSegments(
    new THREE.EdgesGeometry(cube.geometry),
    new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.78 })
  );
  cube.add(edge);

  const glow = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshBasicMaterial({
      color: colorData.actor || colorValue || 0xffc400,
      transparent: true,
      opacity: 0.12,
      wireframe: true
    })
  );
  glow.position.set(0, 0, 0);
  glow.scale.set(0.74, 0.74, 0.74);
  group.add(glow);

  group.userData.core = cube;
  group.userData.ring = glow;
  group.userData.accent = edge;
  group.userData.owner = 1;
  group.userData.minGiantSize = 0.58;
  group.userData.maxGiantSize = 1.60; // 그리드 기준 2×2 정육면체 느낌
  return group;
}


function createItemRobotVacuumObject() {
  const group = new THREE.Group();
  group.name = "RobotVacuumItemObject";

  const bodyMat = new THREE.MeshStandardMaterial({
    color: 0xf3f6fb,
    emissive: 0x4aa3ff,
    emissiveIntensity: isDarkMode ? 0.42 : 0.22,
    roughness: 0.34,
    metalness: 0.10
  });

  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.48, 0.52, 0.24, 56), bodyMat);
  body.position.y = 0.42;
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);

  const rim = new THREE.Mesh(
    new THREE.TorusGeometry(0.52, 0.025, 8, 72),
    new THREE.MeshBasicMaterial({ color: 0x111827, transparent: true, opacity: 0.72, depthWrite: false })
  );
  rim.rotation.x = Math.PI / 2;
  rim.position.y = 0.56;
  group.add(rim);

  const dustBin = new THREE.Mesh(
    new THREE.BoxGeometry(0.28, 0.055, 0.18),
    new THREE.MeshStandardMaterial({ color: 0x9aa4b5, roughness: 0.44, metalness: 0.08 })
  );
  dustBin.position.set(0, 0.59, -0.08);
  dustBin.castShadow = true;
  group.add(dustBin);

  const sensor = new THREE.Mesh(
    new THREE.SphereGeometry(0.065, 16, 10),
    new THREE.MeshBasicMaterial({ color: 0x007aff, transparent: true, opacity: 0.94 })
  );
  sensor.position.set(0, 0.61, 0.22);
  group.add(sensor);

  const brushMat = new THREE.MeshBasicMaterial({ color: 0x111827, transparent: true, opacity: 0.88, depthWrite: false });
  const brush = new THREE.Group();
  brush.name = "VacuumBrush";
  for (let i = 0; i < 4; i++) {
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.035, 0.06), brushMat);
    blade.position.x = 0.19;
    blade.rotation.y = i * Math.PI / 2;
    brush.add(blade);
  }
  brush.position.set(0, 0.26, 0.38);
  group.add(brush);

  const cleanLine = new THREE.Mesh(
    new THREE.BoxGeometry(1.06, 0.035, 0.12),
    new THREE.MeshBasicMaterial({ color: 0x8fd3ff, transparent: true, opacity: 0.58, depthWrite: false })
  );
  cleanLine.position.set(0, 0.18, 0.48);
  group.add(cleanLine);

  group.userData.core = body;
  group.userData.ring = rim;
  group.userData.accent = cleanLine;
  group.userData.innerRing = brush;
  group.userData.icon = sensor;
  return group;
}

function createItemObject(type) {
  const group = new THREE.Group();
  group.userData.itemType = type;

  const baseColor = getItemBaseColor(type, 1);

  // 요청 반영: 스피드/보호막은 단독 오브젝트, 거대화는 성장 화살표 큐브,
  // 영역확장은 플레이어 박스 스킨이 번갈아 보이는 심플 박스로 표현한다.
  if (type === ITEM_TYPES.MOVE_BOOST || type === ITEM_TYPES.SHIELD || type === ITEM_TYPES.LINE_SURGE || type === ITEM_TYPES.AREA || type === ITEM_TYPES.AI_SUMMON) {
    let visualOnly = null;
    if (type === ITEM_TYPES.MOVE_BOOST) {
      visualOnly = createItemLightningObject();
    } else if (type === ITEM_TYPES.SHIELD) {
      visualOnly = createItemShieldDomeObject(baseColor);
    } else if (type === ITEM_TYPES.LINE_SURGE) {
      visualOnly = createItemGiantObject(baseColor);
    } else if (type === ITEM_TYPES.AI_SUMMON) {
      visualOnly = createItemRobotVacuumObject();
    } else {
      visualOnly = createItemTileGridObject(1);
    }

    group.add(visualOnly);
    group.userData.visual = visualOnly;
    group.userData.core = visualOnly.userData.core || null;
    group.userData.ring = visualOnly.userData.ring || null;
    group.userData.accent = visualOnly.userData.accent || null;
    group.userData.mouth = visualOnly.userData.mouth || null;
    group.userData.eye = visualOnly.userData.eye || null;
    group.userData.iconPlanes = [];
    group.userData.baseScale = 1;
    group.userData.lastAreaColorOwner = 1;
    return group;
  }
  const cubeMat = new THREE.MeshStandardMaterial({
    color: baseColor,
    emissive: baseColor,
    emissiveIntensity: isDarkMode ? 1.05 : 0.72,
    roughness: 0.18,
    metalness: 0.12
  });

  const coreSize = type === ITEM_TYPES.LINE_SURGE ? 0.58 : 0.54;
  const cube = new THREE.Mesh(new THREE.BoxGeometry(coreSize, coreSize, coreSize), cubeMat);
  cube.position.y = type === ITEM_TYPES.LINE_SURGE ? 0.04 : 0;
  cube.castShadow = true;
  cube.receiveShadow = true;
  group.add(cube);

  const edge = new THREE.LineSegments(
    new THREE.EdgesGeometry(cube.geometry),
    new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.74 })
  );
  cube.add(edge);

  const iconOffset = coreSize / 2 + 0.006;
  const iconScale = type === ITEM_TYPES.LINE_SURGE ? 0.38 : 0.40;
  const frontIcon = addIconPlaneToItemCube(group, type, new THREE.Vector3(0, 0, iconOffset), { x: 0, y: 0, z: 0 });
  frontIcon.scale.setScalar(iconScale / 0.44);
  const backIcon = addIconPlaneToItemCube(group, type, new THREE.Vector3(0, 0, -iconOffset), { x: 0, y: Math.PI, z: 0 });
  backIcon.scale.setScalar(iconScale / 0.44);
  const topIcon = addIconPlaneToItemCube(group, type, new THREE.Vector3(0, iconOffset, 0), { x: -Math.PI / 2, y: 0, z: 0 });
  topIcon.scale.setScalar(iconScale / 0.44);

  const glow = new THREE.Mesh(
    new THREE.BoxGeometry(0.88, 0.88, 0.88),
    new THREE.MeshBasicMaterial({
      color: baseColor,
      transparent: true,
      opacity: 0.16,
      wireframe: true
    })
  );
  group.add(glow);

  let visual = null;
  if (type === ITEM_TYPES.AREA) {
    visual = createItemTileGridObject(baseColor);
  } else if (type === ITEM_TYPES.MOVE_BOOST) {
    visual = createItemLightningObject();
  } else if (type === ITEM_TYPES.SHIELD) {
    visual = createItemShieldDomeObject(baseColor);
    const shieldOrbit = createShieldOrbitObject();
    group.add(shieldOrbit);
    group.userData.shieldOrbit = shieldOrbit;
  } else if (type === ITEM_TYPES.LINE_SURGE) {
    visual = createItemGiantObject(baseColor);
  }

  if (visual) {
    group.add(visual);
    group.userData.visual = visual;
  }

  group.userData.core = cube;
  group.userData.ring = glow;
  group.userData.accent = edge;
  group.userData.iconPlanes = group.children.filter(child => child.geometry && child.geometry.type === "PlaneGeometry");
  group.userData.baseScale = 1;
  group.userData.lastAreaColorOwner = 1;
  return group;
}

function disposeItemObject(item) {
  if (!item) return;

  clearItemClaimPreview(item);
  clearItemSpawnTileGlow(item);

  if (item.group) {
    scene.remove(item.group);
    item.group.traverse(obj => {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        if (obj.material.map) obj.material.map.dispose();
        obj.material.dispose();
      }
    });
  }
}

function clearAreaItem(itemToClear = null) {
  if (itemToClear) {
    disposeItemObject(itemToClear);
    activeItems = activeItems.filter(item => item !== itemToClear);
    syncActiveItemReference();
    return;
  }

  if (!activeItems || !activeItems.length) {
    activeItem = null;
    return;
  }

  for (const item of activeItems) {
    disposeItemObject(item);
  }

  activeItems = [];
  activeItem = null;
}

function createItemClaimPreview(item) {
  if (!item) return;

  clearItemClaimPreview(item);

  const previewGeo = new THREE.BoxGeometry(0.9, 0.055, 0.9);

  for (let z = item.z - 2; z <= item.z + 2; z++) {
    for (let x = item.x - 2; x <= item.x + 2; x++) {
      if (!inBounds(x, z)) continue;

      const previewMat = new THREE.MeshStandardMaterial({
        color: selectedColors[1].landLight,
        emissive: selectedColors[1].landLight,
        emissiveIntensity: 0.18,
        transparent: true,
        opacity: 0.72,
        roughness: 0.48,
        metalness: 0.02
      });

      const preview = new THREE.Mesh(previewGeo.clone(), previewMat);
      preview.position.set(toWorld(x), 0.105, toWorld(z));
      preview.receiveShadow = false;
      preview.castShadow = false;
      preview.userData.baseY = preview.position.y;
      boardGroup.add(preview);
      item.previewMeshes.push(preview);
    }
  }
}

function clearItemClaimPreview(item) {
  if (!item || !item.previewMeshes) return;

  for (const mesh of item.previewMeshes) {
    boardGroup.remove(mesh);
    if (mesh.geometry) mesh.geometry.dispose();
    if (mesh.material) mesh.material.dispose();
  }

  item.previewMeshes = [];
}

function updateItemClaimPreview(item) {
  if (!item || item.type !== ITEM_TYPES.AREA || !item.previewMeshes || !item.previewMeshes.length) return;

  const now = performance.now();

  if (!item.lastPreviewSwap || now - item.lastPreviewSwap >= 520) {
    item.previewOwner = item.previewOwner === 1 ? 2 : 1;
    item.lastPreviewSwap = now;

    const previewColor = selectedColors[item.previewOwner].landLight;
    for (const mesh of item.previewMeshes) {
      mesh.material.color.set(previewColor);
      mesh.material.emissive.set(previewColor);
    }
  }

  const pulse = 0.012 + Math.sin(now * 0.006 + item.x * 0.1) * 0.012;
  for (const mesh of item.previewMeshes) {
    mesh.position.y = mesh.userData.baseY + pulse;
  }
}

function updateSingleItemAnimation(item, now) {
  if (!item || !item.group) return;

  updateItemClaimPreview(item);
  updateItemSpawnTileGlow(item, now);

  const t = now * 0.001;
  const type = item.type;

  // 스피드 아이템(번개)은 너무 공중에 떠 보이면 어느 칸에 있는지 헷갈리므로
  // 다른 아이템보다 살짝 낮은 기준 Y에서 떠오르도록 조정한다.
  const itemBaseY = type === ITEM_TYPES.MOVE_BOOST ? 0.54 : (type === ITEM_TYPES.LINE_SURGE ? 0.82 : (type === ITEM_TYPES.AI_SUMMON ? 0.74 : 0.78));
  const itemFloatAmp = type === ITEM_TYPES.MOVE_BOOST ? 0.065 : (type === ITEM_TYPES.LINE_SURGE ? 0 : (type === ITEM_TYPES.AI_SUMMON ? 0.075 : 0.10));
  item.group.position.y = itemBaseY + Math.sin(t * 2.6 + item.x * 0.13 + item.z * 0.11) * itemFloatAmp;

  // 기본은 공중에서 시계방향 회전, 스피드 아이템만 훨씬 빠르게 회전한다.
  item.group.rotation.x = type === ITEM_TYPES.LINE_SURGE ? Math.sin(t * 0.8) * 0.035 : Math.sin(t * 1.2) * 0.06;
  item.group.rotation.y -= (type === ITEM_TYPES.MOVE_BOOST ? 0.056 : (type === ITEM_TYPES.LINE_SURGE ? 0.010 : (type === ITEM_TYPES.AI_SUMMON ? 0.042 : 0.018)));
  item.group.rotation.z = type === ITEM_TYPES.LINE_SURGE ? Math.sin(t * 0.7) * 0.025 : Math.sin(t * 1.05) * 0.045;

  // 영역확장/거대화 아이템은 오브젝트 자체가 1P/2P 선택 스킨을 번갈아 보여준다.
  if ((type === ITEM_TYPES.AREA || type === ITEM_TYPES.LINE_SURGE) && (!item.lastObjectColorSwap || now - item.lastObjectColorSwap >= 520)) {
    item.objectColorOwner = item.objectColorOwner === 1 ? 2 : 1;
    item.lastObjectColorSwap = now;
    applyAreaItemSkin(item.group, item.objectColorOwner);
  }

  // 거대화 아이템은 생성 칸 정중앙에서 1×1 → 2×2 → 1×1 크기로 부드럽게 반복한다.
  if (type === ITEM_TYPES.LINE_SURGE) {
    item.group.scale.set(1, 1, 1);

    const age = Math.max(0, now - (item.bornAt || now));
    const sizeCycleMs = 2000;
    const sizePulse = 0.5 - 0.5 * Math.cos((age / sizeCycleMs) * Math.PI * 2);

    const visual = item.group.userData && item.group.userData.visual;
    const core = item.core || (visual && visual.userData && visual.userData.core);
    const ring = item.ring || (visual && visual.userData && visual.userData.ring);
    const minSize = (visual && visual.userData && visual.userData.minGiantSize) || 0.58;
    const maxSize = (visual && visual.userData && visual.userData.maxGiantSize) || 1.60;
    const size = minSize + (maxSize - minSize) * sizePulse;

    if (core) core.scale.set(size, size, size);
    if (ring) {
      ring.scale.set(size + 0.16, size + 0.16, size + 0.16);
      if (ring.material) ring.material.opacity = 0.10 + sizePulse * 0.06;
    }
  } else {
    item.group.scale.set(1, 1, 1);

    if (item.core) {
      const basePulse = 1 + Math.sin(t * 4.4) * 0.045;
      item.core.scale.set(basePulse, basePulse, basePulse);
    }

    if (item.ring) {
      const glowPulse = 1 + Math.sin(t * 5.2) * 0.08;
      item.ring.scale.set(glowPulse, glowPulse, glowPulse);
      if (item.ring.material) item.ring.material.opacity = 0.12 + Math.abs(Math.sin(t * 4.2)) * 0.10;
    }
  }

  // 로봇청소기 아이템은 브러시와 청소 라인이 빠르게 회전/점멸한다.
  if (type === ITEM_TYPES.AI_SUMMON && item.group.userData) {
    const innerRing = item.group.userData.innerRing;
    const accent = item.group.userData.accent;
    const icon = item.group.userData.icon;
    if (innerRing) innerRing.rotation.z -= 0.075;
    if (accent) {
      accent.rotation.y += 0.095;
      if (accent.material) accent.material.opacity = 0.55 + Math.abs(Math.sin(t * 8.8)) * 0.38;
    }
    if (icon) icon.rotation.z = Math.sin(t * 4.6) * 0.09;
  }

  // 보호막 아이템은 4개의 방패가 큐브 주변 4면을 반시계 방향으로 돈다.
  const shieldOrbit = item.group.userData && item.group.userData.shieldOrbit;
  if (shieldOrbit) {
    shieldOrbit.rotation.y += 0.032;
    shieldOrbit.children.forEach((shield, index) => {
      shield.position.y = 0.02 + Math.sin(t * 3.4 + index * 0.8) * 0.045;
      shield.rotation.z = Math.sin(t * 3.0 + index) * 0.12;
    });
  }

  applyItemExpiryBlink(item, now);
}

function applyItemExpiryBlink(item, now) {
  if (!item || !item.group) return;

  const lifetime = item.lifetimeMs || 6000;
  const age = now - (item.bornAt || now);
  const remaining = lifetime - age;

  // 마지막 1초 전까진 항상 보이게 하고, 사라지기 직전 1초 동안만 빠르게 규칙 점멸한다.
  if (remaining > 1000) {
    item.group.visible = true;
    return;
  }

  const fastPeriodMs = 140;

  // 모든 아이템이 같은 타이밍으로 켜지고 꺼지도록 performance.now() 전역값만 사용한다.
  const blinkStep = Math.floor(now / fastPeriodMs);
  item.group.visible = (blinkStep % 2) === 0;
}

function updateAreaItemAnimation() {
  if (!activeItems || !activeItems.length) {
    activeItem = null;
    return;
  }

  const now = performance.now();

  for (const item of [...activeItems]) {
    if (!item) continue;

    // 생성 주기와 별개로 각 아이템은 6초 동안 맵 위에 유지된다.
    if (now - item.bornAt > (item.lifetimeMs || 6000)) {
      clearAreaItem(item);
      continue;
    }

    updateSingleItemAnimation(item, now);
  }

  syncActiveItemReference();
}

function checkItemPickup(actor) {
  if (!activeItems || !activeItems.length || !actor || !actor.alive) return;

  const pickedItem = activeItems.find(item => item && actor.x === item.x && actor.z === item.z);
  if (!pickedItem) return;

  const itemX = pickedItem.x;
  const itemZ = pickedItem.z;
  const itemType = pickedItem.type;
  const usesDedicatedRobotSounds = itemType === ITEM_TYPES.AI_SUMMON
    && typeof window.playRobotCleanerPickupSounds === "function";

  if (usesDedicatedRobotSounds) {
    // 로봇청소기는 실제 획득이 확정된 이 지점에서 획득음과 발동음을 동시에 재생한다.
    window.playRobotCleanerPickupSounds();
  } else {
    DegulSfx.playItemPickup(itemType);
  }
  clearAreaItem(pickedItem);

  if (itemType === ITEM_TYPES.MOVE_BOOST) {
    applyMoveBoost(actor);
  } else if (itemType === ITEM_TYPES.SHIELD) {
    applyShield(actor);
  } else if (itemType === ITEM_TYPES.LINE_SURGE) {
    applyLineSurge(actor);
  } else if (itemType === ITEM_TYPES.AI_SUMMON) {
    applyRobotVacuum(actor);
  } else {
    claimItemArea(actor, itemX, itemZ);
  }
}

function createSummonedAiAssistObject(owner) {
  const group = new THREE.Group();
  group.name = "RobotVacuumAssist";

  const ownerColor = owner && owner.lineColor ? owner.lineColor : 0x8fd3ff;
  const bodyMat = new THREE.MeshStandardMaterial({
    color: 0xf5f7fb,
    emissive: ownerColor,
    emissiveIntensity: isDarkMode ? 0.38 : 0.22,
    roughness: 0.36,
    metalness: 0.10
  });

  // 로봇청소기는 실제 충돌 판정과 분리된 2×2 크기의 보조 오브젝트로 표시한다.
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.92, 0.98, 0.36, 64), bodyMat);
  body.position.y = 0.42;
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);

  const rim = new THREE.Mesh(
    new THREE.TorusGeometry(0.98, 0.045, 8, 80),
    new THREE.MeshBasicMaterial({ color: 0x111827, transparent: true, opacity: 0.70, depthWrite: false })
  );
  rim.rotation.x = Math.PI / 2;
  rim.position.y = 0.62;
  group.add(rim);

  const sensor = new THREE.Mesh(
    new THREE.SphereGeometry(0.11, 18, 12),
    new THREE.MeshBasicMaterial({ color: ownerColor, transparent: true, opacity: 0.95 })
  );
  sensor.position.set(0, 0.68, 0.46);
  group.add(sensor);

  const dustBin = new THREE.Mesh(
    new THREE.BoxGeometry(0.46, 0.07, 0.30),
    new THREE.MeshStandardMaterial({ color: 0xa5adba, roughness: 0.42, metalness: 0.10 })
  );
  dustBin.position.set(0, 0.66, -0.16);
  dustBin.castShadow = true;
  group.add(dustBin);

  const brush = new THREE.Group();
  brush.name = "VacuumBrush";
  const brushMat = new THREE.MeshBasicMaterial({ color: 0x111827, transparent: true, opacity: 0.86, depthWrite: false });
  for (let i = 0; i < 6; i++) {
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.045, 0.08), brushMat);
    blade.position.x = 0.28;
    blade.rotation.y = i * Math.PI / 3;
    brush.add(blade);
  }
  brush.position.set(0, 0.20, 0.80);
  group.add(brush);

  const cleanBar = new THREE.Mesh(
    new THREE.BoxGeometry(1.92, 0.055, 0.20),
    new THREE.MeshBasicMaterial({ color: 0x8fd3ff, transparent: true, opacity: 0.72, depthWrite: false })
  );
  cleanBar.position.y = 0.16;
  cleanBar.position.z = 0.90;
  group.add(cleanBar);

  const footprint = new THREE.Mesh(
    new THREE.PlaneGeometry(1.92, 1.92),
    new THREE.MeshBasicMaterial({ color: 0x8fd3ff, transparent: true, opacity: 0.14, depthWrite: false, side: THREE.DoubleSide })
  );
  footprint.rotation.x = -Math.PI / 2;
  footprint.position.y = 0.055;
  group.add(footprint);

  group.userData.core = body;
  group.userData.ring = rim;
  group.userData.cutter = cleanBar;
  group.userData.footprint = footprint;
  group.userData.brush = brush;
  group.userData.sensor = sensor;
  return group;
}

function applyRobotVacuum(actor) {
  if (!actor || !actor.alive) return;
  const opponent = getOpponent(actor);
  if (!opponent || !opponent.alive) return;

  const now = performance.now();
  const group = createSummonedAiAssistObject(actor);
  group.position.set(toWorld(actor.x), 0.18, toWorld(actor.z));
  scene.add(group);

  activeSummonedAiAssists.push({
    owner: actor,
    target: opponent,
    group,
    x: actor.x,
    z: actor.z,
    visualX: actor.x,
    visualZ: actor.z,
    dir: actor.dir ? { dx: actor.dir.dx || 1, dz: actor.dir.dz || 0 } : { dx: 1, dz: 0 },
    bornAt: now,
    expiresAt: now + 3000,
    lastStepAt: now - 90,
    stepMs: 90,
    cuts: 0
  });

  createRobotVacuumBurst(actor.x, actor.z, actor.lineColor || 0x00ffcc);
  // 전용 발동음이 없는 이전 버전에서만 기존 생성음을 폴백으로 사용한다.
  if (typeof window.playRobotCleanerPickupSounds !== "function") {
    DegulSfx.oneShot("spawn");
  }
}

function clearSummonedAiAssists() {
  if (!activeSummonedAiAssists || !activeSummonedAiAssists.length) {
    activeSummonedAiAssists = [];
    return;
  }

  for (const assist of activeSummonedAiAssists) {
    disposeSummonedAiAssist(assist);
  }
  activeSummonedAiAssists = [];
}

function disposeSummonedAiAssist(assist) {
  if (!assist || !assist.group) return;
  scene.remove(assist.group);
  disposeObject3D(assist.group);
  assist.group = null;
}

function getNearestOpponentLandCell(assist) {
  if (!assist || !assist.target) return null;
  const targetLandId = assist.target.landId;
  if (!targetLandId) return null;

  let best = null;
  let bestScore = Infinity;

  for (let z = 0; z < GRID_SIZE; z++) {
    for (let x = 0; x < GRID_SIZE; x++) {
      if (land[z][x] !== targetLandId) continue;
      const dist = Math.abs(x - assist.x) + Math.abs(z - assist.z);
      const towardPlayer = assist.target && assist.target.alive
        ? (Math.abs(x - assist.target.x) + Math.abs(z - assist.target.z)) * 0.035
        : 0;
      const score = dist + towardPlayer + Math.random() * 0.05;
      if (score < bestScore) {
        bestScore = score;
        best = { x, z, dist };
      }
    }
  }

  return best;
}

function getSummonedAiFootprintCells(assist, centerX = assist.x, centerZ = assist.z) {
  const cells = [];
  const dir = assist && assist.dir ? assist.dir : { dx: 1, dz: 0 };

  // 2×2 로봇청소기가 지나가는 길은 이동 방향 기준 두 줄 폭으로 중립화한다.
  const offsets = Math.abs(dir.dx) > 0
    ? [{x: 0, z: 0}, {x: 0, z: 1}, {x: -dir.dx, z: 0}, {x: -dir.dx, z: 1}]
    : [{x: 0, z: 0}, {x: 1, z: 0}, {x: 0, z: -dir.dz}, {x: 1, z: -dir.dz}];

  for (const offset of offsets) {
    const x = centerX + offset.x;
    const z = centerZ + offset.z;
    if (inBounds(x, z) && !cells.some(cell => cell.x === x && cell.z === z)) {
      cells.push({ x, z });
    }
  }

  return cells;
}

function neutralizeOpponentLandAround(assist) {
  if (!assist || !assist.target) return 0;
  const targetLandId = assist.target.landId;
  if (!targetLandId) return 0;

  const changed = [];
  for (const cell of getSummonedAiFootprintCells(assist)) {
    if (land[cell.z][cell.x] === targetLandId) {
      land[cell.z][cell.x] = EMPTY;
      changed.push(cell);
    }
  }

  if (changed.length > 0) {
    assist.cuts += changed.length;
    refreshBoardCells(changed);
    createLandNeutralizeSpark(changed, assist.owner && assist.owner.lineColor ? assist.owner.lineColor : 0x00ffcc);
    updateScoreUI();
  }

  return changed.length;
}

function getSummonedAiNextStep(assist) {
  if (!assist || !assist.target) return null;
  const targetLand = getNearestOpponentLandCell(assist);
  const fallback = assist.target && assist.target.alive ? { x: assist.target.x, z: assist.target.z } : null;
  const target = targetLand || fallback;
  if (!target) return null;

  const dirs = [
    {dx: 1, dz: 0}, {dx: -1, dz: 0}, {dx: 0, dz: 1}, {dx: 0, dz: -1}
  ];

  let best = null;
  let bestScore = Infinity;
  for (const dir of dirs) {
    const nx = assist.x + dir.dx;
    const nz = assist.z + dir.dz;
    if (!inBounds(nx, nz)) continue;
    const dist = Math.abs(target.x - nx) + Math.abs(target.z - nz);
    const sameDirBonus = assist.dir && assist.dir.dx === dir.dx && assist.dir.dz === dir.dz ? -0.18 : 0;
    const edgePenalty = Math.min(nx, nz, GRID_SIZE - 1 - nx, GRID_SIZE - 1 - nz) < 1 ? 0.6 : 0;
    const score = dist + edgePenalty + sameDirBonus + Math.random() * 0.08;
    if (score < bestScore) {
      bestScore = score;
      best = { x: nx, z: nz, dx: dir.dx, dz: dir.dz };
    }
  }
  return best;
}

function updateSummonedAiAssistStep(assist, now) {
  if (!assist || !assist.group || !assist.target || !assist.target.alive) return;
  if (now - assist.lastStepAt < assist.stepMs) return;
  assist.lastStepAt = now;

  neutralizeOpponentLandAround(assist);

  const next = getSummonedAiNextStep(assist);
  if (!next) return;
  assist.x = next.x;
  assist.z = next.z;
  assist.dir = { dx: next.dx, dz: next.dz };

  neutralizeOpponentLandAround(assist);
}

function updateSummonedAiAssists() {
  if (!activeSummonedAiAssists || !activeSummonedAiAssists.length) return;
  const now = performance.now();

  for (const assist of [...activeSummonedAiAssists]) {
    if (!assist || !assist.group || now >= assist.expiresAt || gameOver || !gameStarted) {
      disposeSummonedAiAssist(assist);
      activeSummonedAiAssists = activeSummonedAiAssists.filter(item => item !== assist);
      continue;
    }

    updateSummonedAiAssistStep(assist, now);

    assist.visualX += (assist.x - assist.visualX) * 0.38;
    assist.visualZ += (assist.z - assist.visualZ) * 0.38;
    assist.group.position.x = toWorld(assist.visualX);
    assist.group.position.z = toWorld(assist.visualZ);

    const t = now * 0.001;
    assist.group.position.y = 0.16 + Math.sin(t * 6.5) * 0.028;
    if (assist.dir) {
      const targetYaw = Math.atan2(assist.dir.dx, assist.dir.dz);
      assist.group.rotation.y += (targetYaw - assist.group.rotation.y) * 0.22;
    }
    const ring = assist.group.userData && assist.group.userData.ring;
    const cutter = assist.group.userData && assist.group.userData.cutter;
    const brush = assist.group.userData && assist.group.userData.brush;
    if (ring) ring.rotation.z += 0.04;
    if (brush) brush.rotation.y += 0.65;
    if (cutter && cutter.material) {
      cutter.material.opacity = 0.42 + Math.abs(Math.sin(t * 10.0)) * 0.32;
    }
  }
}

function createRobotVacuumBurst(x, z, colorValue) {
  const group = new THREE.Group();
  group.position.set(toWorld(x), 0.18, toWorld(z));
  scene.add(group);

  const color = colorValue || 0x00ffcc;
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.56, 0.025, 8, 60),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.78, depthWrite: false })
  );
  ring.rotation.x = Math.PI / 2;
  group.add(ring);

  const light = new THREE.Mesh(
    new THREE.SphereGeometry(0.36, 18, 10),
    new THREE.MeshBasicMaterial({ color: 0x00ffcc, transparent: true, opacity: 0.24, wireframe: true })
  );
  light.position.y = 0.42;
  group.add(light);

  const start = performance.now();
  function step() {
    const t = Math.min((performance.now() - start) / 420, 1);
    const scale = 1 + t * 1.9;
    group.scale.set(scale, scale, scale);
    group.rotation.y += 0.12;
    group.children.forEach(child => { if (child.material) child.material.opacity *= 0.91; });
    if (t < 1) {
      requestAnimationFrame(step);
    } else {
      scene.remove(group);
      disposeObject3D(group);
    }
  }
  step();
}

function createLandNeutralizeSpark(cellsToClear, colorValue) {
  const cells = Array.isArray(cellsToClear) ? cellsToClear : [];
  if (!cells.length) return;

  const group = new THREE.Group();
  const avgX = cells.reduce((sum, cell) => sum + cell.x, 0) / cells.length;
  const avgZ = cells.reduce((sum, cell) => sum + cell.z, 0) / cells.length;
  group.position.set(toWorld(avgX), 0.20, toWorld(avgZ));
  scene.add(group);

  const color = colorValue || 0x00ffcc;
  for (const cell of cells) {
    const wipe = new THREE.Mesh(
      new THREE.BoxGeometry(0.86, 0.045, 0.86),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.46, depthWrite: false })
    );
    wipe.position.set(toWorld(cell.x) - toWorld(avgX), 0.04, toWorld(cell.z) - toWorld(avgZ));
    group.add(wipe);
  }

  for (let i = 0; i < 4; i++) {
    const slash = new THREE.Mesh(
      new THREE.BoxGeometry(1.18, 0.045, 0.075),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.82, depthWrite: false })
    );
    slash.position.y = 0.10 + i * 0.035;
    slash.rotation.y = i * Math.PI / 4;
    group.add(slash);
  }

  const start = performance.now();
  function step() {
    const t = Math.min((performance.now() - start) / 280, 1);
    group.scale.setScalar(1 + t * 0.46);
    group.rotation.y += 0.15;
    group.children.forEach(child => { if (child.material) child.material.opacity *= 0.86; });
    if (t < 1) {
      requestAnimationFrame(step);
    } else {
      scene.remove(group);
      disposeObject3D(group);
    }
  }
  step();
}

function claimItemArea(actor, cx, cz) {
  const glowCells = [];

  for (let z = cz - 2; z <= cz + 2; z++) {
    for (let x = cx - 2; x <= cx + 2; x++) {
      if (inBounds(x, z)) {
        if (land[z][x] !== actor.landId) glowCells.push({x, z});
        land[z][x] = actor.landId;
      }
    }
  }

  refreshBoardCells(glowCells);
  createLandClaimGlow(actor, glowCells);
  updateScoreUI();
  checkWinByLand();
}

function applyLineSurge(actor) {
  actor.lineSurgeUntil = performance.now() + 1500;
  ensureLineSurgeEffect(actor);
  if (actor.lineSurgeEffect) actor.lineSurgeEffect.visible = true;
  claimLineSurgeStep(actor);
  updateBuffUI();
}

function isLineSurgeActive(actor) {
  return actor && actor.lineSurgeUntil && performance.now() < actor.lineSurgeUntil;
}

function getLineSurgeCells(actor, centerX = actor.x, centerZ = actor.z) {
  const cells = [];

  for (let oz = -1; oz <= 1; oz++) {
    for (let ox = -1; ox <= 1; ox++) {
      cells.push({ x: centerX + ox, z: centerZ + oz });
    }
  }

  return cells.filter(cell => inBounds(cell.x, cell.z));
}

function claimLineSurgeStep(actor, centerX = actor.x, centerZ = actor.z) {
  const glowCells = [];

  for (const cell of getLineSurgeCells(actor, centerX, centerZ)) {
    if (land[cell.z][cell.x] !== actor.landId) glowCells.push(cell);
    land[cell.z][cell.x] = actor.landId;
  }

  clearTrail(actor);
  refreshBoardCells(glowCells);
  // 거대화 점령은 추가 발광/흰색 림 없이 블록 색상만 즉시 변경
  updateScoreUI();
}

function ensureLineSurgeEffect(actor) {
  if (actor.lineSurgeEffect || !actor.mesh) return;

  // 거대화 상태에서는 별도 흰색 레이아웃/와이어/스피드 라인 없이 블록만 커지게 유지
  const effect = new THREE.Group();
  effect.visible = false;
  actor.mesh.add(effect);
  actor.lineSurgeEffect = effect;
}

function applyActorVisualScale(actor) {
  if (!actor || !actor.mesh || !actor.alive) return;

  const targetScale = isLineSurgeActive(actor) ? 3 : 1;
  if (actor.visualScale === undefined) actor.visualScale = actor.mesh.scale.x || 1;

  const lerpSpeed = targetScale > actor.visualScale ? 0.16 : 0.12;
  actor.visualScale += (targetScale - actor.visualScale) * lerpSpeed;
  if (Math.abs(targetScale - actor.visualScale) < 0.01) actor.visualScale = targetScale;

  const s = actor.visualScale;
  actor.mesh.scale.set(s, s, s);

  const baseY = actor.mesh.userData.baseY || (actor.colorData && actor.colorData.skin === "ghost" ? 0.56 : 0.42);
  const targetY = baseY + (s - 1) * 0.40;

  if (!actor.moving) {
    actor.mesh.position.y += (targetY - actor.mesh.position.y) * 0.18;
  } else {
    actor.mesh.position.y = Math.max(actor.mesh.position.y, targetY);
  }
}

function applyMoveBoost(actor) {
  actor.moveBoostUntil = performance.now() + 2000;
  ensureSpeedEffect(actor);
  if (actor.boostEffect) actor.boostEffect.visible = true;
  updateBuffUI();
}

function applyShield(actor) {
  actor.shieldUntil = isChaosAiPermanentShield(actor) ? Number.POSITIVE_INFINITY : performance.now() + 4000;
  ensureShieldEffect(actor);
  if (actor.shieldEffect) actor.shieldEffect.visible = true;
  updateBuffUI();
}

function isChaosAiPermanentShield(actor) {
  return !!(actor && actor.isAI && actor.aiDifficulty === "chaos");
}

function enableChaosAiPermanentShield(actor) {
  if (!isChaosAiPermanentShield(actor)) return;
  actor.shieldUntil = Number.POSITIVE_INFINITY;
  ensureShieldEffect(actor);
  if (actor.shieldEffect) actor.shieldEffect.visible = true;
}

function ensureShieldEffect(actor) {
  if (actor.shieldEffect || !actor.mesh) return;

  const effect = new THREE.Group();

  const shell = new THREE.Mesh(
    new THREE.SphereGeometry(0.82, 32, 20),
    new THREE.MeshBasicMaterial({
      color: 0xffd166,
      transparent: true,
      opacity: 0.18,
      wireframe: true
    })
  );
  effect.add(shell);

  const ringMat = new THREE.MeshBasicMaterial({
    color: 0xffd166,
    transparent: true,
    opacity: 0.46
  });

  const ringA = new THREE.Mesh(new THREE.TorusGeometry(0.76, 0.024, 8, 48), ringMat);
  ringA.rotation.x = Math.PI / 2;
  const ringB = new THREE.Mesh(new THREE.TorusGeometry(0.76, 0.024, 8, 48), ringMat.clone());
  ringB.rotation.y = Math.PI / 2;
  effect.add(ringA, ringB);

  effect.visible = false;
  actor.mesh.add(effect);
  actor.shieldEffect = effect;
}

function isShieldActive(actor) {
  return !!(actor && (isChaosAiPermanentShield(actor) || (actor.shieldUntil && performance.now() < actor.shieldUntil)));
}

function consumeShield(actor) {
  if (!isShieldActive(actor)) return false;

  // 카오스 AI의 보호막은 소모되지 않는 상시 보호막으로 유지한다.
  if (isChaosAiPermanentShield(actor)) {
    ensureShieldEffect(actor);
    if (actor.shieldEffect) actor.shieldEffect.visible = true;
    updateBuffUI();
    return true;
  }

  actor.shieldUntil = 0;
  if (actor.shieldEffect) actor.shieldEffect.visible = false;

  createShieldBreakEffect(actor);
  updateBuffUI();
  return true;
}

function playShieldBlockEffect(owner, x, z) {
  if (!owner || !owner.mesh) return;

  DegulSfx.oneShot("shieldWallHit");

  const block = new THREE.Group();
  const wallColor = owner.lineColor || 0xffd166;
  block.position.set(toWorld(x), 0.94, toWorld(z));
  scene.add(block);

  const mat = new THREE.MeshBasicMaterial({
    color: wallColor,
    transparent: true,
    opacity: 0.58,
    wireframe: true,
    depthWrite: false
  });

  const wall = new THREE.Mesh(new THREE.BoxGeometry(0.92, 1.88, 0.92), mat);
  block.add(wall);

  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.62, 0.026, 8, 40),
    new THREE.MeshBasicMaterial({
      color: wallColor,
      transparent: true,
      opacity: 0.72,
      depthWrite: false
    })
  );
  ring.rotation.x = Math.PI / 2;
  ring.position.y = -0.88;
  block.add(ring);

  const start = performance.now();

  function updateBlockEffect() {
    const t = Math.min((performance.now() - start) / 260, 1);
    const scale = 1 + t * 0.65;
    block.scale.set(scale, scale, scale);
    block.rotation.y += 0.12;

    block.children.forEach(child => {
      if (child.material) child.material.opacity *= 0.88;
    });

    if (t < 1) {
      requestAnimationFrame(updateBlockEffect);
    } else {
      scene.remove(block);
      block.traverse(obj => {
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) obj.material.dispose();
      });
    }
  }

  updateBlockEffect();
}

function createShieldBreakEffect(actor) {
  if (!actor || !actor.mesh) return;

  const burst = new THREE.Group();
  burst.position.copy(actor.mesh.position);
  scene.add(burst);

  const mat = new THREE.MeshBasicMaterial({
    color: 0xffd166,
    transparent: true,
    opacity: 0.75
  });

  for (let i = 0; i < 12; i++) {
    const shard = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.22), mat.clone());
    const angle = (Math.PI * 2 * i) / 12;
    shard.position.set(Math.cos(angle) * 0.28, 0.08, Math.sin(angle) * 0.28);
    shard.rotation.y = angle;
    shard.userData.vx = Math.cos(angle) * 0.035;
    shard.userData.vz = Math.sin(angle) * 0.035;
    shard.userData.vy = 0.018 + Math.random() * 0.025;
    burst.add(shard);
  }

  const start = performance.now();
  function updateBurst() {
    const t = Math.min((performance.now() - start) / 420, 1);

    burst.children.forEach(shard => {
      shard.position.x += shard.userData.vx;
      shard.position.z += shard.userData.vz;
      shard.position.y += shard.userData.vy;
      shard.material.opacity = 0.75 * (1 - t);
      shard.scale.setScalar(1 - t * 0.55);
    });

    if (t < 1) {
      requestAnimationFrame(updateBurst);
    } else {
      scene.remove(burst);
      burst.traverse(obj => {
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) obj.material.dispose();
      });
    }
  }

  updateBurst();
}

function ensureSpeedEffect(actor) {
  if (actor.boostEffect || !actor.mesh) return;

  const effect = new THREE.Group();

  const glowMat = new THREE.MeshBasicMaterial({
    color: 0xffd166,
    transparent: true,
    opacity: 0.32,
    wireframe: true
  });
  const glow = new THREE.Mesh(new THREE.BoxGeometry(1.02, 1.02, 1.02), glowMat);
  effect.add(glow);

  const streakMat = new THREE.MeshBasicMaterial({
    color: 0xffd166,
    transparent: true,
    opacity: 0.48
  });

  for (let i = 0; i < 4; i++) {
    const streak = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.44), streakMat.clone());
    streak.position.set(-0.62 - i * 0.10, -0.22 + i * 0.14, 0.32 - i * 0.20);
    streak.userData.baseX = streak.position.x;
    effect.add(streak);
  }

  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.64, 0.026, 8, 40),
    new THREE.MeshBasicMaterial({
      color: 0xffd166,
      transparent: true,
      opacity: 0.42
    })
  );
  ring.rotation.x = Math.PI / 2;
  ring.position.y = -0.02;
  effect.add(ring);

  effect.visible = false;
  actor.mesh.add(effect);
  actor.boostEffect = effect;
}

function isMoveBoostActive(actor) {
  return actor && actor.moveBoostUntil && performance.now() < actor.moveBoostUntil;
}

function getActorMoveTime(actor) {
  // 스피드 모드: 아이템 모드의 스피드 부스트 속도를 기본 이동 속도로 사용
  const base = gameMode === "speed" ? 82 : (isMoveBoostActive(actor) ? 82 : MOVE_TIME);
  if (actor && actor.isAI) {
    const cfg = getAiConfig();
    return Math.max(52, Math.round(base / (1 + (cfg.speedBonus || 0))));
  }
  return base;
}

function updatePlayerBuffs() {
  const now = performance.now();

  for (const actor of players) {
    if (!actor || !actor.mesh) continue;

    const active = isMoveBoostActive(actor);
    const lineSurgeActive = isLineSurgeActive(actor);

    if (!active) {
      actor.moveBoostUntil = 0;
      if (actor.boostEffect) actor.boostEffect.visible = false;
      applyActorVisualScale(actor);
    } else {
      ensureSpeedEffect(actor);
      applyActorVisualScale(actor);

      if (actor.boostEffect) {
        actor.boostEffect.visible = true;
        actor.boostEffect.rotation.y += 0.08;

        actor.boostEffect.children.forEach((child, idx) => {
          if (child.userData && child.userData.baseX !== undefined) {
            child.position.x = child.userData.baseX - Math.sin(now * 0.012 + idx) * 0.12;
            child.material.opacity = 0.28 + Math.abs(Math.sin(now * 0.01 + idx)) * 0.34;
          }
        });
      }
    }

    if (!lineSurgeActive) {
      actor.lineSurgeUntil = 0;
      if (actor.lineSurgeEffect) actor.lineSurgeEffect.visible = false;
      applyActorVisualScale(actor);
    } else {
      ensureLineSurgeEffect(actor);
      applyActorVisualScale(actor);
      if (actor.lineSurgeEffect) {
        actor.lineSurgeEffect.visible = true;
        actor.lineSurgeEffect.rotation.y += 0.045;
        actor.lineSurgeEffect.children.forEach((child, idx) => {
          if (child.userData && child.userData.baseZ !== undefined) {
            child.position.z = child.userData.baseZ - Math.sin(now * 0.014 + idx) * 0.16;
            child.material.opacity = 0.22 + Math.abs(Math.sin(now * 0.012 + idx)) * 0.30;
          }
        });
      }
    }

    const shieldActive = isShieldActive(actor);

    if (!shieldActive) {
      actor.shieldUntil = 0;
      if (actor.shieldEffect) actor.shieldEffect.visible = false;
      setShieldTrailWalls(actor, false, now);
    } else {
      setShieldTrailWalls(actor, true, now);
      ensureShieldEffect(actor);
      if (actor.shieldEffect) {
        actor.shieldEffect.visible = true;
        actor.shieldEffect.rotation.y += 0.035;
        actor.shieldEffect.rotation.z += 0.018;

        actor.shieldEffect.children.forEach((child, idx) => {
          if (child.material) {
            child.material.opacity = idx === 0
              ? 0.13 + Math.abs(Math.sin(now * 0.006)) * 0.10
              : 0.32 + Math.abs(Math.sin(now * 0.008 + idx)) * 0.22;
          }
        });
      }
    }
  }

  updateBuffUI();
}

function updateBuffUI() {
  const ui = document.getElementById("buffUI");
  const p1Pill = document.getElementById("p1BuffPill");
  const p2Pill = document.getElementById("p2BuffPill");
  const p1ShieldPill = document.getElementById("p1ShieldPill");
  const p2ShieldPill = document.getElementById("p2ShieldPill");
  if (!ui || !p1Pill || !p2Pill || !p1ShieldPill || !p2ShieldPill) return;
  let p1LinePill = document.getElementById("p1LinePill");
  let p2LinePill = document.getElementById("p2LinePill");
  if (!p1LinePill) {
    p1LinePill = document.createElement("div");
    p1LinePill.id = "p1LinePill";
    p1LinePill.className = "buffPill";
    ui.appendChild(p1LinePill);
  }
  if (!p2LinePill) {
    p2LinePill = document.createElement("div");
    p2LinePill.id = "p2LinePill";
    p2LinePill.className = "buffPill";
    ui.appendChild(p2LinePill);
  }

  const now = performance.now();
  const p1Left = p1 && isMoveBoostActive(p1) ? Math.ceil((p1.moveBoostUntil - now) / 1000) : 0;
  const p2Left = p2 && isMoveBoostActive(p2) ? Math.ceil((p2.moveBoostUntil - now) / 1000) : 0;
  const p1PermanentShield = p1 && isChaosAiPermanentShield(p1);
  const p2PermanentShield = p2 && isChaosAiPermanentShield(p2);
  const p1ShieldLeft = p1 && isShieldActive(p1) ? (p1PermanentShield ? Infinity : Math.ceil((p1.shieldUntil - now) / 1000)) : 0;
  const p2ShieldLeft = p2 && isShieldActive(p2) ? (p2PermanentShield ? Infinity : Math.ceil((p2.shieldUntil - now) / 1000)) : 0;
  const p1LineLeft = p1 && isLineSurgeActive(p1) ? Math.ceil((p1.lineSurgeUntil - now) / 1000) : 0;
  const p2LineLeft = p2 && isLineSurgeActive(p2) ? Math.ceil((p2.lineSurgeUntil - now) / 1000) : 0;

  p1Pill.style.display = p1Left > 0 ? "block" : "none";
  p2Pill.style.display = p2Left > 0 ? "block" : "none";
  p1ShieldPill.style.display = p1ShieldLeft > 0 ? "block" : "none";
  p2ShieldPill.style.display = p2ShieldLeft > 0 ? "block" : "none";
  p1LinePill.style.display = p1LineLeft > 0 ? "block" : "none";
  p2LinePill.style.display = p2LineLeft > 0 ? "block" : "none";

  p1Pill.textContent = `1P ${tr("speedBoost")} ${p1Left}s`;
  p2Pill.textContent = `2P ${tr("speedBoost")} ${p2Left}s`;
  p1ShieldPill.textContent = p1PermanentShield ? `1P ${tr("shield")} ∞` : `1P ${tr("shield")} ${p1ShieldLeft}s`;
  p2ShieldPill.textContent = p2PermanentShield ? `${p2 && p2.isAI ? "AI" : "2P"} ${tr("shield")} ∞` : `2P ${tr("shield")} ${p2ShieldLeft}s`;
  p1LinePill.textContent = `1P ${tr("lineSurge")} ${p1LineLeft}s`;
  p2LinePill.textContent = `2P ${tr("lineSurge")} ${p2LineLeft}s`;

  ui.style.display = (p1Left > 0 || p2Left > 0 || p1ShieldLeft > 0 || p2ShieldLeft > 0 || p1LineLeft > 0 || p2LineLeft > 0) ? "flex" : "none";
}

