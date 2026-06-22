// ===================== 플레이어 생성 =====================
function createPlayers() {
  const aiColor = getAiColorData();
  const p2Color = matchMode === "ai" ? aiColor : selectedColors[2];
  const aiLabel = getAiDifficultyLabel();

  p1 = createActor({
    name: "1P",
    x: 5,
    z: GRID_SIZE - 6,
    color: selectedColors[1].actor,
    colorData: selectedColors[1],
    landId: P1_LAND,
    lineColor: selectedColors[1].line,
    isAI: false
  });

  p2 = createActor({
    name: matchMode === "ai" ? `AI ${aiLabel}` : "2P",
    x: GRID_SIZE - 6,
    z: 5,
    color: p2Color.actor,
    colorData: p2Color,
    landId: P2_LAND,
    lineColor: p2Color.line,
    isAI: matchMode === "ai",
    aiDifficulty
  });

  players = [p1, p2];

  // 요청 수정: 카오스 모드 AI는 시작부터 보호막을 상시 유지한다.
  enableChaosAiPermanentShield(p2);
}

function addSolidActorFaviconEyes(mesh) {
  if (!mesh) return;

  const rimMaterial = new THREE.MeshBasicMaterial({ color: 0xf8fbff });
  const pupilMaterial = new THREE.MeshBasicMaterial({ color: 0x050814 });
  const rimGeometry = new THREE.CapsuleGeometry(0.052, 0.135, 4, 10);
  const pupilGeometry = new THREE.CapsuleGeometry(0.038, 0.122, 4, 10);

  [-0.115, 0.115].forEach(x => {
    const rim = new THREE.Mesh(rimGeometry, rimMaterial);
    rim.position.set(x, -0.015, 0.405);
    rim.scale.z = 0.28;
    rim.renderOrder = 2;
    mesh.add(rim);

    const pupil = new THREE.Mesh(pupilGeometry, pupilMaterial);
    pupil.position.set(x, -0.015, 0.423);
    pupil.scale.z = 0.24;
    pupil.renderOrder = 3;
    mesh.add(pupil);
  });
}

function createActor({name, x, z, color, colorData = null, landId, lineColor, isAI = false, aiDifficulty = null}) {
  const actorColorData = colorData || COLOR_CHOICES.find(c => c.actor === color) || { actor: color, landLight: color };
  let mesh;
  if (actorColorData.skin === "ghost") {
    mesh = createGhostActorObject();
    mesh.position.set(toWorld(x), 0.56, toWorld(z));
    mesh.userData.baseY = 0.56;
  } else if (actorColorData.skin === "chess") {
    mesh = createKnightActorObject();
    mesh.position.set(toWorld(x), 0.38, toWorld(z));
    mesh.userData.baseY = 0.38;
  } else {
    const geo = new THREE.BoxGeometry(0.8, 0.8, 0.8);
    const mat = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.38,
      metalness: 0.06
    });
    applySkinToMaterial(mat, actorColorData, "actor");
    if (!actorColorData.skin) {
      const eyeFaceMat = mat.clone();
      const eyeFaceHsl = {};
      eyeFaceMat.color.getHSL(eyeFaceHsl);
      eyeFaceMat.color.setHSL(
        eyeFaceHsl.h,
        Math.max(0, eyeFaceHsl.s * 0.58),
        Math.min(1, eyeFaceHsl.l + 0.045)
      );
      // BoxGeometry 재질 순서: +X, -X, +Y, -Y, +Z, -Z.
      // 눈은 +Z 면에 있으므로 해당 면만 채도를 낮춘다.
      mesh = new THREE.Mesh(geo, [mat, mat, mat, mat, eyeFaceMat, mat]);
    } else {
      mesh = new THREE.Mesh(geo, mat);
    }
    mesh.castShadow = true;
    mesh.position.set(toWorld(x), 0.42, toWorld(z));
    if (!actorColorData.skin) addSolidActorFaviconEyes(mesh);
  }
  mesh.userData.skin = actorColorData.skin || "solid";
  actorsGroup.add(mesh);

  const startDir = landId === P1_LAND ? {dx: 1, dz: 0} : {dx: -1, dz: 0};

  return {
    name,
    x, z,
    mesh,
    colorData: actorColorData,
    landId,
    moving: false,
    dir: startDir,
    nextDir: {...startDir},
    trail: createPointList(),
    trailMeshes: [],
    lineColor,
    alive: true,
    moveBoostUntil: 0,
    boostEffect: null,
    shieldUntil: 0,
    shieldEffect: null,
    lineSurgeUntil: 0,
    lineSurgeEffect: null,
    pendingLineSurgePath: null,
    visualScale: 1,
    isAI,
    aiDifficulty,
    aiLastDecisionAt: 0
  };
}


// ===================== 고스트 모드 암막 / 핀 조명 연출 =====================
function createGhostVisionOverlay() {
  ghostVisionCanvas = document.createElement("canvas");
  ghostVisionCanvas.id = "ghostVisionOverlay";
  ghostVisionCanvas.style.position = "fixed";
  ghostVisionCanvas.style.inset = "0";
  ghostVisionCanvas.style.width = "100vw";
  ghostVisionCanvas.style.height = "100vh";
  ghostVisionCanvas.style.pointerEvents = "none";
  ghostVisionCanvas.style.zIndex = "9";
  ghostVisionCanvas.style.display = "none";
  ghostVisionCanvas.style.mixBlendMode = "normal";
  document.body.appendChild(ghostVisionCanvas);
  ghostVisionCtx = ghostVisionCanvas.getContext("2d");

  resetGhostVisionFogDots();

  resizeGhostVisionOverlay();
}

function rebuildGhostFogTexture() {
  const size = performanceLevel === "low" ? 320 : 480;
  if (!ghostFogTextureCanvas) {
    ghostFogTextureCanvas = document.createElement("canvas");
    ghostFogTextureCtx = ghostFogTextureCanvas.getContext("2d");
  }
  ghostFogTextureCanvas.width = size;
  ghostFogTextureCanvas.height = size;
  if (!ghostFogTextureCtx) return;

  const ctx = ghostFogTextureCtx;
  ctx.clearRect(0, 0, size, size);
  const bg = ctx.createRadialGradient(size * 0.5, size * 0.42, size * 0.08, size * 0.5, size * 0.5, size * 0.72);
  bg.addColorStop(0, "rgba(24,25,31,0.34)");
  bg.addColorStop(0.46, "rgba(5,6,9,0.28)");
  bg.addColorStop(1, "rgba(0,0,0,0.62)");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, size, size);

  for (const dot of ghostVisionFogDots) {
    const x = dot.x * size;
    const y = dot.y * size;
    const radius = Math.max(20, dot.r * size / 720);
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
    gradient.addColorStop(0, `rgba(52,54,64,${Math.min(0.11, dot.a * 2.1)})`);
    gradient.addColorStop(0.55, `rgba(18,19,24,${Math.min(0.08, dot.a * 1.4)})`);
    gradient.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  }
}

function resizeGhostVisionOverlay() {
  if (!ghostVisionCanvas) return;
  const dpr = Math.max(1, Math.min(performanceConfig.pixelRatio, window.devicePixelRatio || 1));
  ghostVisionCanvas.width = Math.floor(window.innerWidth * dpr);
  ghostVisionCanvas.height = Math.floor(window.innerHeight * dpr);
  ghostVisionCanvas.style.width = `${window.innerWidth}px`;
  ghostVisionCanvas.style.height = `${window.innerHeight}px`;
  if (ghostVisionCtx) ghostVisionCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  rebuildGhostFogTexture();
}

function getGhostVisionTarget(now) {
  const t = now % GHOST_VISION_CYCLE_MS;
  if (t < GHOST_VISION_SPOT_MS) {
    return { actor: p1, phase: "p1", local: t };
  }
  if (t < GHOST_VISION_SPOT_MS + GHOST_VISION_DARK_MS) {
    return { actor: null, phase: "dark1", local: t - GHOST_VISION_SPOT_MS };
  }
  if (t < GHOST_VISION_SPOT_MS + GHOST_VISION_DARK_MS + GHOST_VISION_SPOT_MS) {
    return { actor: p2, phase: "p2", local: t - GHOST_VISION_SPOT_MS - GHOST_VISION_DARK_MS };
  }
  return { actor: null, phase: "dark2", local: t - GHOST_VISION_SPOT_MS - GHOST_VISION_DARK_MS - GHOST_VISION_SPOT_MS };
}

function getGhostSpotAlpha(local) {
  const fade = GHOST_VISION_FADE_MS;
  const inA = Math.min(1, local / fade);
  const outA = Math.min(1, (GHOST_VISION_SPOT_MS - local) / fade);
  const a = Math.max(0, Math.min(1, inA, outA));
  return a * a * (3 - 2 * a);
}

function playGhostLightTransitionSfx(nextPhase) {
  const previousPhase = ghostVisionPhase && ghostVisionPhase.phase;
  if (previousPhase === nextPhase) return;

  const previousHadLight = previousPhase === "p1" || previousPhase === "p2";
  const nextHasLight = nextPhase === "p1" || nextPhase === "p2";

  if (!previousHadLight && nextHasLight) {
    DegulSfx.oneShot("ghostLightOn");
  } else if (previousHadLight && !nextHasLight) {
    DegulSfx.oneShot("ghostLightOff");
  }
}

function projectWorldToScreen(worldPosition) {
  if (!camera || !renderer) return null;
  const v = worldPosition.clone().project(camera);
  if (v.z < -1 || v.z > 1) return null;
  return {
    x: (v.x * 0.5 + 0.5) * window.innerWidth,
    y: (-v.y * 0.5 + 0.5) * window.innerHeight
  };
}

function getActorScreenPosition(actor) {
  if (!actor || !actor.mesh) return null;
  const pos = new THREE.Vector3();
  actor.mesh.getWorldPosition(pos);
  pos.y += 0.32;
  return projectWorldToScreen(pos);
}

function drawBlackFog(ctx, w, h, now) {
  ctx.fillStyle = "rgba(0,0,0,0.955)";
  ctx.fillRect(0, 0, w, h);
  if (!ghostFogTextureCanvas) rebuildGhostFogTexture();
  if (ghostFogTextureCanvas) {
    const driftX = Math.sin(now * 0.00011) * 12;
    const driftY = Math.cos(now * 0.00009) * 9;
    ctx.save();
    ctx.globalAlpha = 0.92;
    ctx.drawImage(ghostFogTextureCanvas, driftX - 12, driftY - 9, w + 24, h + 18);
    ctx.restore();
  }
}

function drawGhostSpotlight(ctx, x, y, radius, alpha, color) {
  if (alpha <= 0) return;

  ctx.save();
  ctx.globalCompositeOperation = "destination-out";
  const cut = ctx.createRadialGradient(x, y, radius * 0.08, x, y, radius);
  cut.addColorStop(0, `rgba(0,0,0,${0.98 * alpha})`);
  cut.addColorStop(0.54, `rgba(0,0,0,${0.78 * alpha})`);
  cut.addColorStop(0.82, `rgba(0,0,0,${0.26 * alpha})`);
  cut.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = cut;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.globalCompositeOperation = "screen";
  const glow = ctx.createRadialGradient(x, y, radius * 0.05, x, y, radius * 1.15);
  glow.addColorStop(0, `rgba(255,245,210,${0.18 * alpha})`);
  glow.addColorStop(0.42, `rgba(255,232,168,${0.09 * alpha})`);
  glow.addColorStop(1, "rgba(255,232,168,0)");
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(x, y, radius * 1.15, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.globalCompositeOperation = "source-over";
  ctx.strokeStyle = color || `rgba(255,246,205,${0.13 * alpha})`;
  ctx.lineWidth = Math.max(10, radius * 0.08);
  ctx.filter = `blur(${Math.max(8, radius * 0.055)}px)`;
  ctx.beginPath();
  ctx.arc(x, y, radius * 0.84, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function drawFaintGhostItem(ctx, now) {
  if (!activeItems || !activeItems.length || gameMode !== "item") return;

  for (const item of activeItems) {
    if (!item || !item.group) continue;
    const pos = new THREE.Vector3();
    item.group.getWorldPosition(pos);
    pos.y += 0.28;
    const screen = projectWorldToScreen(pos);
    if (!screen) continue;

    const pulse = 0.5 + 0.5 * Math.sin(now * 0.004 + item.x * 0.21 + item.z * 0.17);
    const r = 9 + pulse * 3;

    ctx.save();
    ctx.globalCompositeOperation = "screen";
    const g = ctx.createRadialGradient(screen.x, screen.y, 1, screen.x, screen.y, r * 2.2);
    g.addColorStop(0, "rgba(255,209,102,0.72)");
    g.addColorStop(0.45, "rgba(255,209,102,0.24)");
    g.addColorStop(1, "rgba(255,209,102,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(screen.x, screen.y, r * 2.2, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = `rgba(255,255,255,${0.42 + pulse * 0.36})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(screen.x, screen.y, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
}

function updateGhostVisionOverlay() {
  if (!ghostVisionCanvas || !ghostVisionCtx) return;

  const active = ghostModeEnabled && gameStarted && !gameOver && !isCountingDown;
  ghostVisionCanvas.style.display = active ? "block" : "none";
  if (!active) {
    ghostVisionPhase = { target: null, alpha: 0, phase: "dark" };
    return;
  }

  const now = performance.now();
  const w = window.innerWidth;
  const h = window.innerHeight;
  const ctx = ghostVisionCtx;
  ctx.clearRect(0, 0, w, h);

  drawBlackFog(ctx, w, h, now);

  const target = getGhostVisionTarget(now);
  playGhostLightTransitionSfx(target.phase);
  let alpha = 0;
  if (target.actor && target.actor.alive) {
    alpha = getGhostSpotAlpha(target.local);
    const screen = getActorScreenPosition(target.actor);
    if (screen) {
      const radius = Math.max(88, Math.min(150, Math.min(w, h) * 0.17));
      const playerColor = target.actor.landId === P1_LAND ? "rgba(125,199,255,0.16)" : "rgba(255,146,184,0.16)";
      drawGhostSpotlight(ctx, screen.x, screen.y, radius, alpha, playerColor);
    }
  }

  drawFaintGhostItem(ctx, now);
  ghostVisionPhase = { target: target.actor, alpha, phase: target.phase };
}

function canPlayGhostBlockSfx(actor) {
  // 실제 효과음 파일이 추가되면 블록 노출 타이밍에만 재생하도록 이 함수로 체크한다.
  if (!ghostModeEnabled) return true;
  return !!(ghostVisionPhase.target === actor && ghostVisionPhase.alpha > 0.35);
}

// ===================== 유령 스킨 떠다니는 루프 =====================
function updateGhostSkinActors() {
  const now = performance.now();
  for (const actor of players) {
    if (actor && actor.alive && !actor.moving) updateGhostActorFloat(actor, now);
    if (actor && actor.alive && !actor.moving) updateKnightActorStep(actor, now);
  }
}

// ===================== 메인 루프 =====================
function updateExtremeAiBackgroundGrid() {
  if (!backgroundGridGroup) return;
  const theme = getPerspectiveGridTheme();
  const active = !!(theme.extreme || theme.hell || theme.chaos);
  if (!active) return;
  if (performanceFrameCounter % performanceConfig.backgroundInterval !== 0) return;
  const t = performance.now() * 0.001;
  const pulse = active ? (0.5 + 0.5 * Math.sin(t * (theme.hell ? 4.2 : (theme.chaos ? 6.6 : 3.4)))) : 0;

  const parts = backgroundGridGroup.userData.renderParts || {};
  Object.values(parts).forEach(obj => {
    if (!obj.material) return;
    const role = obj.userData && obj.userData.gridRole;

    if (role === "line") {
      obj.material.color.set(theme.line);
      obj.material.opacity = active ? ((theme.hell ? 0.44 : (theme.chaos ? 0.48 : 0.42)) + pulse * 0.26) : theme.lineOpacity;
    } else if (role === "strongLine") {
      obj.material.color.set(theme.strongLine);
      obj.material.opacity = active ? ((theme.hell ? 0.70 : (theme.chaos ? 0.74 : 0.68)) + pulse * 0.24) : theme.strongOpacity;
    } else if (role === "boardEdge") {
      obj.material.color.set(theme.boardEdge);
      obj.material.opacity = active ? ((theme.hell ? 0.58 : (theme.chaos ? 0.62 : 0.56)) + pulse * 0.22) : theme.edgeOpacity;
    } else if (role === "floor" && obj.material.emissive) {
      obj.material.emissive.set(theme.floorEmissive || 0x000000);
      obj.material.emissiveIntensity = active ? (0.18 + pulse * (theme.hell ? 0.24 : (theme.chaos ? 0.30 : 0.18))) : 0;
    } else if (role === "extremeSparkle") {
      obj.visible = active;
      obj.rotation.y += active ? (theme.hell ? 0.0018 : (theme.chaos ? 0.0038 : 0.0012)) : 0;
      obj.material.color.set(theme.sparkleColor || 0xd8b4fe);
      obj.material.opacity = active ? ((theme.hell ? 0.34 : (theme.chaos ? 0.38 : 0.28)) + pulse * (theme.hell ? 0.54 : (theme.chaos ? 0.62 : 0.48))) : 0;
    }
  });
}

let lastRenderedFrameAt = 0;
function getTargetRenderFps() {
  if (document.hidden) return 0;
  if (gamePhase === GAME_PHASE.PLAYING) {
    return performanceAutoTune.emergency30Fps ? 30 : performanceConfig.fps;
  }
  if (gamePhase === GAME_PHASE.COUNTDOWN) return Math.min(30, performanceConfig.fps);
  if (gamePhase === GAME_PHASE.PAUSED) return 2;
  if (gamePhase === GAME_PHASE.ENDED) {
    const deathMotionActive = players && players.some(player => player && player.dying && player.alive !== false);
    if (deathMotionActive || deathCameraFocus) return performanceLevel === "low" ? 30 : 60;
    return 10;
  }
  return 15;
}

function animate() {
  requestAnimationFrame(animate);
  const now = performance.now();
  const targetFps = getTargetRenderFps();
  if (targetFps <= 0) return;
  const frameInterval = 1000 / targetFps;
  if (now - lastRenderedFrameAt < frameInterval) return;
  lastRenderedFrameAt = now - ((now - lastRenderedFrameAt) % frameInterval);
  performanceFrameCounter++;

  updatePauseMenuButtonVisibility();

  if (gameStarted && !gameOver && !isCountingDown && !isPaused) {
    handleInput();
    updateCamera();
    updateScoreUIThrottled();
    const updateEffects = performanceFrameCounter % performanceConfig.effectInterval === 0;
    if (updateEffects) {
      updatePlayerBuffs();
      updateAreaItemAnimation();
      updateSummonedAiAssists();
      updateClaimGlowEffects();
    }
    updateExtremeAiLandSparkle();
    updateGhostSkinActors();
  }

  // 게임 종료 후에도 승리자 줌인 카메라가 계속 보간되도록 별도로 업데이트한다.
  if (deathCameraFocus && !isPaused) {
    updateDeathCameraCloseup();
  }

  updateExtremeAiBackgroundGrid();
  if (performanceLevel === "high" || performanceFrameCounter % 2 === 0) updateGhostVisionOverlay();
  updateFrameTasks(now);
  renderer.render(scene, camera);
  updatePerformanceMetrics(now);
}

function handleInput() {
  // 키를 떼도 멈추지 않는 자동 전진 방식.
  // 2P 대전: 1P는 WASD, 2P는 방향키.
  // AI 대전: 1P는 WASD와 방향키를 모두 사용할 수 있다.
  if (p1.alive) {
    const p1ArrowControlEnabled = matchMode === "ai";

    if (keys["w"] || (p1ArrowControlEnabled && keys["ArrowUp"])) setNextDirection(p1, 0, -1);
    else if (keys["s"] || (p1ArrowControlEnabled && keys["ArrowDown"])) setNextDirection(p1, 0, 1);
    else if (keys["a"] || (p1ArrowControlEnabled && keys["ArrowLeft"])) setNextDirection(p1, -1, 0);
    else if (keys["d"] || (p1ArrowControlEnabled && keys["ArrowRight"])) setNextDirection(p1, 1, 0);

    if (!p1.moving) {
      p1.dir = {...p1.nextDir};
      tryMove(p1, p1.dir.dx, p1.dir.dz);
    }
  }

  if (p2.alive) {
    if (matchMode === "ai" && p2.isAI) {
      updateAiDirection(p2);
    } else {
      if (keys["ArrowUp"]) setNextDirection(p2, 0, -1);
      else if (keys["ArrowDown"]) setNextDirection(p2, 0, 1);
      else if (keys["ArrowLeft"]) setNextDirection(p2, -1, 0);
      else if (keys["ArrowRight"]) setNextDirection(p2, 1, 0);
    }

    if (!p2.moving) {
      p2.dir = {...p2.nextDir};
      tryMove(p2, p2.dir.dx, p2.dir.dz);
    }
  }
}

function getAiConfig() {
  return AI_DIFFICULTIES[aiDifficulty] || AI_DIFFICULTIES.easy;
}

function getAiColorData() {
  const cfg = getAiConfig();
  return {
    name: `AI-${aiDifficulty}`,
    actor: cfg.actor,
    landLight: cfg.landLight,
    landDark: cfg.landDark,
    line: cfg.line,
    skin: (aiDifficulty === "extreme" || aiDifficulty === "hell" || aiDifficulty === "chaos") ? aiDifficulty : null,
    sparkle: aiDifficulty === "extreme" || aiDifficulty === "hell" || aiDifficulty === "chaos"
  };
}

function getAiDifficultyLabel(level = aiDifficulty) {
  const cfg = AI_DIFFICULTIES[level] || getAiConfig();
  const jaLabels = { easy: "イージー", normal: "ノーマル", hard: "ハード", superhard: "スーパーハード", extreme: "エクストリーム", hell: "ヘル", chaos: "カオス" };
  const zhLabels = { easy: "简单", normal: "普通", hard: "困难", superhard: "超困难", extreme: "极限", hell: "地狱", chaos: "混沌" };
  if (currentLang === "zh") return zhLabels[level] || cfg.labelKo;
  if (currentLang === "ja") return jaLabels[level] || cfg.labelKo;
  return currentLang === "en" ? cfg.labelEn : cfg.labelKo;
}

const aiNavigationCache = {
  boardVersion: 0,
  landDistanceMaps: new Map()
};

function invalidateAiNavigationCache() {
  aiNavigationCache.boardVersion++;
  aiNavigationCache.landDistanceMaps.clear();
}

function createAiDistanceContext() {
  return {
    boardVersion: aiNavigationCache.boardVersion,
    landDistanceMaps: aiNavigationCache.landDistanceMaps,
    chaosReturnPaths: new Map()
  };
}

function buildLandDistanceMap(targetLandId) {
  const distances = Array.from({ length: GRID_SIZE }, () => Array(GRID_SIZE).fill(GRID_SIZE * 2));
  const queue = [];

  for (let zz = 0; zz < GRID_SIZE; zz++) {
    for (let xx = 0; xx < GRID_SIZE; xx++) {
      if (land[zz][xx] === targetLandId) {
        distances[zz][xx] = 0;
        queue.push({ x: xx, z: zz });
      }
    }
  }

  for (let head = 0; head < queue.length; head++) {
    const point = queue[head];
    const nextDistance = distances[point.z][point.x] + 1;
    const dirs = [{dx: 1, dz: 0}, {dx: -1, dz: 0}, {dx: 0, dz: 1}, {dx: 0, dz: -1}];
    for (const dir of dirs) {
      const nx = point.x + dir.dx;
      const nz = point.z + dir.dz;
      if (!inBounds(nx, nz) || distances[nz][nx] <= nextDistance) continue;
      distances[nz][nx] = nextDistance;
      queue.push({ x: nx, z: nz });
    }
  }

  return distances;
}

function getDistanceToLandId(targetLandId, x, z, aiContext = null) {
  if (aiContext && aiContext.landDistanceMaps) {
    if (!aiContext.landDistanceMaps.has(targetLandId)) {
      aiContext.landDistanceMaps.set(targetLandId, buildLandDistanceMap(targetLandId));
    }
    const map = aiContext.landDistanceMaps.get(targetLandId);
    return map && map[z] ? map[z][x] : GRID_SIZE * 2;
  }

  let best = GRID_SIZE * 2;
  for (let zz = 0; zz < GRID_SIZE; zz++) {
    for (let xx = 0; xx < GRID_SIZE; xx++) {
      if (land[zz][xx] === targetLandId) {
        const d = Math.abs(xx - x) + Math.abs(zz - z);
        if (d < best) best = d;
      }
    }
  }
  return best;
}

function getDistanceToOwnLand(actor, x, z, aiContext = null) {
  return getDistanceToLandId(actor.landId, x, z, aiContext);
}

function isDangerPointForActor(actor, x, z) {
  if (!inBounds(x, z)) return true;
  const opponent = getOpponent(actor);
  if (containsPoint(actor.trail, x, z)) return true;
  if (opponent && opponent.alive && containsPoint(opponent.trail, x, z)) return false;
  if (opponent && opponent.alive && opponent.x === x && opponent.z === z) return true;
  return false;
}

function getDistanceToPointList(x, z, points) {
  if (!points || !points.length) return GRID_SIZE * 2;
  let best = GRID_SIZE * 2;
  for (const p of points) {
    const d = Math.abs(p.x - x) + Math.abs(p.z - z);
    if (d < best) best = d;
  }
  return best;
}

function isOpponentExpandingBoldly(opponent, cfg) {
  if (!opponent || !opponent.alive) return false;
  if (!opponent.trail || opponent.trail.length < cfg.attackTrailTrigger) return false;
  const opponentStandingLand = land[opponent.z] && land[opponent.z][opponent.x];
  return opponentStandingLand !== opponent.landId || opponent.trail.length >= cfg.boldTrailTrigger;
}

function isAiActor(actor) {
  return !!(actor && actor.isAI);
}

function isHardAi(actor) {
  return actor && actor.isAI && (actor.aiDifficulty === "hard" || actor.aiDifficulty === "superhard" || actor.aiDifficulty === "extreme" || actor.aiDifficulty === "hell" || actor.aiDifficulty === "chaos");
}

function isMoveUnsafeForAi(actor, dir, options = {}) {
  if (!actor || !dir) return true;

  const stepDistance = getActorStepDistance(actor);
  const opponent = getOpponent(actor);
  const allowOpponentTrailAttack = !!options.allowOpponentTrailAttack;

  for (let step = 1; step <= stepDistance; step++) {
    const nx = actor.x + dir.dx * step;
    const nz = actor.z + dir.dz * step;

    if (!inBounds(nx, nz)) return true;

    // AI는 모든 난이도에서 자기 라인으로 들어가는 선택을 피한다.
    // 이지/노말 포함 전체 난이도에서 자기 라인은 이동 불가 칸으로 취급한다.
    if (containsPoint(actor.trail, nx, nz)) return true;

    if (opponent && opponent.alive && opponent.x === nx && opponent.z === nz) return true;

    if (opponent && opponent.alive && containsPoint(opponent.trail, nx, nz)) {
      // 상대 보호막이 켜져 있으면 라인은 실제 벽이므로 공격 허용 여부와 관계없이 이동할 수 없다.
      if (isShieldActive(opponent)) return true;
      // 상대 라인을 자르는 것은 공격이므로 별도 허용 옵션이 있을 때만 위험 판정에서 제외한다.
      if (!allowOpponentTrailAttack) return true;
    }
  }

  return false;
}

function hasChaosAiReturnPath(actor, dir, aiContext = null) {
  if (!actor || actor.aiDifficulty !== "chaos" || !dir) return true;

  const stepDistance = getActorStepDistance(actor);
  const startX = actor.x + dir.dx * stepDistance;
  const startZ = actor.z + dir.dz * stepDistance;
  if (!inBounds(startX, startZ)) return false;
  if (land[startZ][startX] === actor.landId) return true;
  const trailVersion = actor.trail ? actor.trail.length : 0;
  const opponent = getOpponent(actor);
  const cacheKey = `${startX},${startZ}|${trailVersion}|${opponent && opponent.alive ? `${opponent.x},${opponent.z},${opponent.trail.length},${isShieldActive(opponent) ? 1 : 0}` : "none"}`;
  if (aiContext && aiContext.chaosReturnPaths && aiContext.chaosReturnPaths.has(cacheKey)) {
    return aiContext.chaosReturnPaths.get(cacheKey);
  }

  const total = GRID_SIZE * GRID_SIZE;
  const visited = new Uint8Array(total);
  const queue = new Int32Array(total);
  let head = 0;
  let tail = 0;

  const enqueue = (x, z) => {
    if (!inBounds(x, z)) return;
    const index = z * GRID_SIZE + x;
    if (visited[index]) return;
    if (!(x === startX && z === startZ) && containsPoint(actor.trail, x, z)) return;
    if (opponent && opponent.alive && opponent.x === x && opponent.z === z) return;
    if (opponent && opponent.alive && isShieldActive(opponent) && containsPoint(opponent.trail, x, z)) return;
    visited[index] = 1;
    queue[tail++] = index;
  };

  enqueue(startX, startZ);
  while (head < tail) {
    const index = queue[head++];
    const x = index % GRID_SIZE;
    const z = (index / GRID_SIZE) | 0;
    if (land[z][x] === actor.landId) {
      if (aiContext && aiContext.chaosReturnPaths) aiContext.chaosReturnPaths.set(cacheKey, true);
      return true;
    }
    enqueue(x + 1, z);
    enqueue(x - 1, z);
    enqueue(x, z + 1);
    enqueue(x, z - 1);
  }

  if (aiContext && aiContext.chaosReturnPaths) aiContext.chaosReturnPaths.set(cacheKey, false);
  return false;
}

function recoverChaosAiFromTrailTrap(actor, dirs) {
  if (!actor || actor.aiDifficulty !== "chaos" || !actor.trail || !actor.trail.length) return null;

  const maxRollback = Math.min(3, actor.trail.length);
  for (let removed = 0; removed < maxRollback; removed++) {
    if (!removeRecentTrailPoint(actor)) break;
    const escape = dirs.find(dir =>
      !isMoveUnsafeForAi(actor, dir, { allowOpponentTrailAttack: true })
      && hasChaosAiReturnPath(actor, dir)
    );
    if (escape) {
      setShieldTrailWalls(actor, true, performance.now(), true);
      return escape;
    }
  }

  return null;
}

function getAiCandidateDirections(actor) {
  const dirs = [
    {dx: 0, dz: -1},
    {dx: 1, dz: 0},
    {dx: 0, dz: 1},
    {dx: -1, dz: 0}
  ];

  const nonReverse = dirs.filter(dir => !(actor.dir && actor.dir.dx === -dir.dx && actor.dir.dz === -dir.dz));
  const reverse = dirs.find(dir => actor.dir && actor.dir.dx === -dir.dx && actor.dir.dz === -dir.dz);

  // 기본적으로 역주행은 금지하지만, 자살을 피할 유일한 선택이면 마지막 후보로만 사용한다.
  return reverse ? [...nonReverse, reverse] : nonReverse;
}

function getAiItemChaseLimit() {
  if (aiDifficulty === "chaos") return 15;
  if (aiDifficulty === "hell") return 14;
  if (aiDifficulty === "extreme") return 13;
  if (aiDifficulty === "superhard") return 11;
  if (aiDifficulty === "hard") return 9;
  if (aiDifficulty === "normal") return 7;
  return 5;
}

function getAiItemValueMultiplier(itemType, actor) {
  if (itemType === ITEM_TYPES.SHIELD) return isShieldActive(actor) ? 0.28 : 1.08;
  if (itemType === ITEM_TYPES.MOVE_BOOST) return isMoveBoostActive(actor) ? 0.38 : 1.0;
  if (itemType === ITEM_TYPES.LINE_SURGE) return isLineSurgeActive(actor) ? 0.30 : 1.18;
  if (itemType === ITEM_TYPES.AI_SUMMON) return 1.26;
  if (itemType === ITEM_TYPES.AREA) return 1.12;
  return 1;
}

function getAiItemScore(actor, nx, nz, cfg) {
  if (gameMode !== "item" || !activeItems || !activeItems.length || !actor || !actor.isAI) return 0;
  if (actor.trail && actor.trail.length >= 8) return 0; // 너무 멀리 나간 상태면 아이템보다 복귀 우선

  const chaseLimit = getAiItemChaseLimit();
  let bestScore = 0;

  for (const item of activeItems) {
    if (!item) continue;

    const currentDist = Math.abs(item.x - actor.x) + Math.abs(item.z - actor.z);
    const nextDist = Math.abs(item.x - nx) + Math.abs(item.z - nz);

    // 너무 멀면 포기하고 기존 점령/생존 판단을 따른다.
    if (currentDist > chaseLimit || nextDist > chaseLimit + 1) continue;

    const closing = currentDist - nextDist;
    const nearBonus = Math.max(0, chaseLimit - nextDist + 1) * 34;
    const directPickupBonus = nextDist === 0 ? 2800 : 0;
    const valueMul = getAiItemValueMultiplier(item.type, actor);
    const lifeLeftBonus = Math.max(0, 5000 - (performance.now() - item.bornAt)) / 5000;

    // 가까운 아이템은 적극적으로 먹되, 여러 아이템 중 가장 유리한 아이템을 선택한다.
    const score = (directPickupBonus + nearBonus + closing * 360) * valueMul * cfg.aggression * (0.82 + lifeLeftBonus * 0.18);
    if (score > bestScore) bestScore = score;
  }

  return bestScore;
}

function getShieldedOpponentExpansionScore(actor, opponent, nx, nz, nextLand, aiContext) {
  if (!actor || !opponent || !opponent.alive || !isShieldActive(opponent)) return 0;

  const currentOwnDistance = getDistanceToOwnLand(actor, actor.x, actor.z, aiContext);
  const nextOwnDistance = getDistanceToOwnLand(actor, nx, nz, aiContext);
  const movingOutward = nextOwnDistance > currentOwnDistance;
  const returning = currentOwnDistance - nextOwnDistance;
  const trailLength = actor.trail ? actor.trail.length : 0;
  let score = 0;

  // 상대 보호막이 켜진 동안에는 라인 공격이 불가능하므로 점령 면적 확대를 최우선으로 둔다.
  if (nextLand === EMPTY) score += 760;
  else if (nextLand === opponent.landId) score += 980;
  else if (nextLand === actor.landId) score += trailLength > 0 ? 720 : 40;

  if (trailLength < 7 && movingOutward && nextLand !== actor.landId) score += 420;
  if (trailLength >= 5) score += returning * 360;
  if (trailLength >= 8 && nextLand !== actor.landId) score -= 850;
  if (trailLength >= 5 && nextLand === actor.landId) score += 980;

  const playerDistance = Math.abs(opponent.x - nx) + Math.abs(opponent.z - nz);
  score += Math.min(playerDistance, 10) * 22;
  return score;
}

function evaluateAiDirection(actor, dir, cfg, aiContext = null) {
  const nx = actor.x + dir.dx;
  const nz = actor.z + dir.dz;
  if (!inBounds(nx, nz)) return -99999;

  const opponent = getOpponent(actor);
  const opponentTrailHit = opponent && opponent.alive && containsPoint(opponent.trail, nx, nz);
  const opponentShieldActive = !!(opponent && opponent.alive && isShieldActive(opponent));

  // AI 자살 방지: 자기 라인, 벽, 직접 충돌은 최고 우선순위로 배제한다.
  if (isMoveUnsafeForAi(actor, dir, { allowOpponentTrailAttack: opponentTrailHit })) return -99999;
  if (actor.aiDifficulty === "chaos" && !hasChaosAiReturnPath(actor, dir, aiContext)) return -99999;

  let score = 0;
  const nextLand = land[nz][nx];

  // 상대 보호막 중에는 아이템 추격보다 영역 확장을 우선한다.
  if (!opponentShieldActive) score += getAiItemScore(actor, nx, nz, cfg);

  if (opponentTrailHit && !opponentShieldActive) score += 2600 + cfg.aggression * 480 + cfg.counterBias * 780;

  if (nextLand === actor.landId) {
    score += actor.trail.length > 0 ? 980 * cfg.returnBias : 80;
  } else if (nextLand === EMPTY) {
    score += actor.trail.length > 0 ? 78 * cfg.aggression : 230 * cfg.aggression;
  } else {
    score += 175 * cfg.aggression;
  }

  if (opponentShieldActive) {
    score += getShieldedOpponentExpansionScore(actor, opponent, nx, nz, nextLand, aiContext);
  }

  if (cfg.chaosExpansion && opponent && opponent.alive && !opponentShieldActive) {
    const playerDistanceNow = Math.abs(opponent.x - actor.x) + Math.abs(opponent.z - actor.z);
    const playerDistanceNext = Math.abs(opponent.x - nx) + Math.abs(opponent.z - nz);
    const farFromPlayer = playerDistanceNow >= (cfg.farExpansionRange || 11);
    const underTrailLimit = actor.trail.length < (cfg.expansionTrailLimit || 16);
    const currentOwnDist = getDistanceToOwnLand(actor, actor.x, actor.z, aiContext);
    const nextOwnDistForExpansion = getDistanceToOwnLand(actor, nx, nz, aiContext);
    const expandingOutward = nextOwnDistForExpansion >= currentOwnDist;

    if (farFromPlayer && underTrailLimit) {
      // 카오스 전용 추가 로직:
      // 플레이어와 멀어지면 멀리서 혼자 확장하기보다, 플레이어 쪽으로 붙어서 플레이어 영역을 침식한다.
      const stealBias = cfg.playerChaseStealBias || 2.0;
      const closingPlayer = playerDistanceNow - playerDistanceNext;
      const currentOpponentLandDist = getDistanceToLandId(opponent.landId, actor.x, actor.z, aiContext);
      const nextOpponentLandDist = getDistanceToLandId(opponent.landId, nx, nz, aiContext);
      const closingOpponentLand = currentOpponentLandDist - nextOpponentLandDist;
      const nearPlayerPressure = Math.max(0, (cfg.playerStealPressureRange || 9) - playerDistanceNext);

      // 1순위: 플레이어에게 가까워지는 방향
      score += closingPlayer * 760 * stealBias;

      // 2순위: 플레이어 영역에 가까워지고, 실제로 밟아 뺏어먹을 수 있는 방향
      score += closingOpponentLand * 520 * stealBias;
      if (nextLand === opponent.landId) {
        score += 1450 * stealBias;
        score += nearPlayerPressure * 120 * stealBias;
      } else if (nextLand === EMPTY && closingPlayer > 0) {
        score += 240 * stealBias;
      } else if (nextLand !== actor.landId && closingPlayer > 0) {
        score += 520 * stealBias;
      }

      // 멀어진 상태에서 반대로 더 멀리 가는 선택은 강하게 억제한다.
      if (playerDistanceNext > playerDistanceNow && nextLand !== actor.landId) {
        score -= 820 * stealBias;
      }

      // 단, 너무 긴 꼬리를 만들면 생존 복귀를 허용한다.
      if (actor.trail.length >= 7 && nextLand === actor.landId) score += 520 * cfg.returnBias;
    } else if (underTrailLimit) {
      // 플레이어와 너무 멀지 않을 때는 기존 카오스식 대범한 영역 확장을 유지한다.
      if (nextLand === EMPTY) score += 260 * (cfg.expansionBias || 1.5);
      if (nextLand !== actor.landId) score += Math.min(actor.trail.length + 1, 12) * 56 * (cfg.expansionBias || 1.5);
      if (expandingOutward && nextLand !== actor.landId) score += 300 * (cfg.expansionBias || 1.5);
      if (actor.trail.length >= 7 && nextLand === actor.landId) score += 520 * cfg.returnBias;
    }
  }

  if (actor.trail.length > 0) {
    const currentDist = getDistanceToOwnLand(actor, actor.x, actor.z, aiContext);
    const nextDist = getDistanceToOwnLand(actor, nx, nz, aiContext);
    const returning = currentDist - nextDist;

    score += returning * 190 * cfg.returnBias;

    // 라인이 길어질수록 복귀를 더 강하게 선호해서 혼자 꼬여 죽는 상황을 줄인다.
    if (actor.trail.length > 5) score += returning * 125;
    if (actor.trail.length > 8 && nextLand !== actor.landId) score -= 420;
    if (actor.trail.length > 12 && nextLand !== actor.landId) score -= 720;
    if (actor.trail.length > 6 && nextLand === actor.landId) score += 620 * cfg.returnBias;
  }

  if (opponent && opponent.alive && !opponentShieldActive) {
    const distToOpponent = Math.abs(opponent.x - nx) + Math.abs(opponent.z - nz);
    const opponentTrailDist = getDistanceToPointList(nx, nz, opponent.trail);
    const opponentBold = isOpponentExpandingBoldly(opponent, cfg);

    // 플레이어가 대범하게 넓히면 견제하되, AI 자기 라인이 길면 먼저 살아서 복귀한다.
    const aiOverExtended = actor.trail.length >= (aiDifficulty === "easy" ? 9 : aiDifficulty === "normal" ? 8 : aiDifficulty === "chaos" ? 13 : aiDifficulty === "hell" ? 10 : aiDifficulty === "extreme" ? 9 : 7);

    if (opponentBold && !aiOverExtended) {
      const currentTrailDist = getDistanceToPointList(actor.x, actor.z, opponent.trail);
      const closingTrail = currentTrailDist - opponentTrailDist;
      score += Math.max(0, cfg.pressureRange - opponentTrailDist) * 92 * cfg.counterBias;
      score += closingTrail * 285 * cfg.counterBias;

      if (aiDifficulty !== "easy") {
        score += Math.max(0, 7 - opponentTrailDist) * 130 * cfg.counterBias;
        score += Math.max(0, 5 - distToOpponent) * 42 * cfg.aggression;
      }
    } else {
      score += Math.max(0, 6 - distToOpponent) * 16 * cfg.aggression;
      if (opponent.trail && opponent.trail.length > 0 && !aiOverExtended) {
        score += Math.max(0, 5 - opponentTrailDist) * 26 * cfg.counterBias;
      }
    }
  }

  const edgePenalty = Math.max(0, 3 - Math.min(nx, nz, GRID_SIZE - 1 - nx, GRID_SIZE - 1 - nz)) * 150;
  score -= edgePenalty;

  // 높은 난이도는 몇 칸 앞의 막다른 길과 자기 라인 충돌을 더 엄격하게 예측한다.
  let lx = nx, lz = nz, ldx = dir.dx, ldz = dir.dz;
  for (let i = 1; i < cfg.lookAhead; i++) {
    lx += ldx;
    lz += ldz;
    if (!inBounds(lx, lz) || containsPoint(actor.trail, lx, lz)) {
      score -= 1200 / i;
      break;
    }
    if (isDangerPointForActor(actor, lx, lz)) {
      score -= 620 / i;
      break;
    }
  }

  return score + Math.random() * 24;
}

function updateAiDirection(actor) {
  if (!actor || actor.moving || !actor.alive) return;
  const cfg = getAiConfig();
  const dirs = getAiCandidateDirections(actor);
  const aiContext = createAiDistanceContext();

  const scored = dirs
    .map(dir => ({ dir, score: evaluateAiDirection(actor, dir, cfg, aiContext) }))
    .filter(item => item.score > -9000)
    .sort((a, b) => b.score - a.score);

  if (!scored.length) {
    const recoveredEscape = recoverChaosAiFromTrailTrap(actor, dirs);
    if (recoveredEscape) {
      const changed = !actor.nextDir || actor.nextDir.dx !== recoveredEscape.dx || actor.nextDir.dz !== recoveredEscape.dz;
      actor.nextDir = { dx: recoveredEscape.dx, dz: recoveredEscape.dz };
      if (changed && gameStarted && !gameOver && !isCountingDown && !isPaused) {
        DegulSfx.playTurn(actor);
      }
      return;
    }

    // 막다른 길에서는 기존 반대 방향 금지를 풀고, 죽지 않는 칸을 최우선으로 선택한다.
    const emergency = dirs.find(dir => !isMoveUnsafeForAi(actor, dir, { allowOpponentTrailAttack: true }));
    if (emergency) {
      const changed = !actor.nextDir || actor.nextDir.dx !== emergency.dx || actor.nextDir.dz !== emergency.dz;
      actor.nextDir = { dx: emergency.dx, dz: emergency.dz };
      if (changed && gameStarted && !gameOver && !isCountingDown && !isPaused) {
        DegulSfx.playTurn(actor);
      }
    }
    return;
  }

  let chosen = scored[0].dir;
  if (Math.random() < cfg.randomRate) {
    const poolSize = Math.min(scored.length, aiDifficulty === "easy" ? 4 : 3);
    chosen = scored[Math.floor(Math.random() * poolSize)].dir;
  }

  // 현재 진행 방향이 자살 방향이면 랜덤성을 무시하고 실제로 안전한 방향을 다시 찾는다.
  if (isMoveUnsafeForAi(actor, chosen, { allowOpponentTrailAttack: true })) {
    const safest = scored.find(item => !isMoveUnsafeForAi(actor, item.dir, { allowOpponentTrailAttack: true }));
    if (!safest) return;
    chosen = safest.dir;
  }

  if (actor.dir && actor.dir.dx === -chosen.dx && actor.dir.dz === -chosen.dz) {
    const changed = !actor.nextDir || actor.nextDir.dx !== chosen.dx || actor.nextDir.dz !== chosen.dz;
    actor.nextDir = {dx: chosen.dx, dz: chosen.dz};
    if (changed && gameStarted && !gameOver && !isCountingDown && !isPaused) {
      DegulSfx.playTurn(actor);
    }
  } else {
    setNextDirection(actor, chosen.dx, chosen.dz);
  }
}

function setNextDirection(actor, dx, dz) {
  // 완전 반대 방향 입력은 허용하지 않음.
  // 바로 뒤로 돌면 자기 흔적 판정이 너무 쉽게 발생해서 뱀게임처럼 방향전환만 가능하게 처리.
  if (actor.dir && actor.dir.dx === -dx && actor.dir.dz === -dz) return;

  const changed = !actor.nextDir || actor.nextDir.dx !== dx || actor.nextDir.dz !== dz;
  actor.nextDir = {dx, dz};
  if (changed && gameStarted && !gameOver && !isCountingDown && !isPaused) {
    DegulSfx.playTurn(actor);
  }
}

// ===================== 이동 처리 =====================

function getActorStepDistance(actor) {
  return isLineSurgeActive(actor) ? 3 : 1;
}

function tryMove(actor, dx, dz) {
  if (gameOver || gameEnding || gameResultLocked || !actor || !actor.alive || actor.dying) return;
  const stepDistance = getActorStepDistance(actor);
  const path = [];

  for (let step = 1; step <= stepDistance; step++) {
    const nx = actor.x + dx * step;
    const nz = actor.z + dz * step;

    if (!inBounds(nx, nz)) return;
    path.push({ x: nx, z: nz });
  }

  const opponent = getOpponent(actor);

  /*
    보호막 규칙:
    - 보호막이 켜져 있는 동안 그 플레이어의 흔적 라인은 벽처럼 동작한다.
    - 상대는 보호막이 켜진 플레이어의 라인을 밟거나 지나갈 수 없다.
    - 본인도 보호막이 켜진 동안 자기 라인을 밟거나 지나갈 수 없다.
    - 보호막 시간이 끝나면 기존 규칙대로 자기 라인/상대 라인을 밟으면 사망한다.
    - 거대화 중에는 보폭이 3칸으로 커지므로 이동 경로의 모든 칸을 판정한다.
  */

  for (const point of path) {
    const nx = point.x;
    const nz = point.z;

    // 자기 라인 처리
    if (containsPoint(actor.trail, nx, nz)) {
      // AI는 난이도와 관계없이 자기 선을 밟아 자살하지 않도록 자기 라인을 벽처럼 막는다.
      if (isShieldActive(actor) || isAiActor(actor)) {
        playShieldBlockEffect(actor, nx, nz);
        return;
      }

      killPlayer(actor, tr("selfTrail", actor.name), { ignoreShield: true, deathCell: { x: nx, z: nz } });
      return;
    }

    // 상대 라인 처리
    if (opponent && opponent.alive && containsPoint(opponent.trail, nx, nz)) {
      if (isShieldActive(opponent)) {
        playShieldBlockEffect(opponent, nx, nz);
        return;
      }

      killPlayer(opponent, tr("otherTrail", actor.name, opponent.name), { ignoreShield: true });
      return;
    }

    // 두 플레이어가 같은 칸에 들어가면 충돌 처리
    if (opponent && opponent.alive && opponent.x === nx && opponent.z === nz) {
      endGame(null, tr("collisionDraw"));
      return;
    }
  }

  const finalPoint = path[path.length - 1];
  actor.pendingLineSurgePath = stepDistance > 1 ? path : null;

  rollActor(actor, dx * stepDistance, dz * stepDistance, () => {
    if (gameOver || gameEnding || gameResultLocked || !actor.alive || actor.dying) return;
    actor.x = finalPoint.x;
    actor.z = finalPoint.z;
    afterMove(actor);
  });
}

function rollActor(actor, dx, dz, onDone) {
  actor.moving = true;
  const rollToken = Symbol("roll");
  actor.rollToken = rollToken;
  DegulSfx.beginRoll(actor);

  const mesh = actor.mesh;
  const startPos = mesh.position.clone();
  const surgeActive = isLineSurgeActive(actor);
  const isGhostSkin = actor.colorData && actor.colorData.skin === "ghost";
  const isKnightSkin = actor.colorData && actor.colorData.skin === "chess";
  const visualScale = surgeActive ? 3 : 1;
  const halfSize = 0.4 * visualScale;
  const endY = isGhostSkin ? (surgeActive ? 1.36 : 0.56) : (isKnightSkin ? (surgeActive ? 1.14 : 0.38) : (surgeActive ? 1.22 : 0.42));
  const endPos = new THREE.Vector3(toWorld(actor.x + dx), endY, toWorld(actor.z + dz));

  if (isGhostSkin || isKnightSkin) {
    const startTime = performance.now();
    const duration = getActorMoveTime(actor);
    const startRotY = mesh.rotation.y;
    const targetRotY = Math.atan2(Math.sign(dx), Math.sign(dz) || 0.0001);

    function hopStep(now) {
      if (actor.dying || actor.rollToken !== rollToken) {
        actor.moving = false;
        DegulSfx.endRoll(actor);
        return false;
      }

      const t = Math.min((now - startTime) / duration, 1);
      const eased = easeOutCubic(t);
      mesh.position.lerpVectors(startPos, endPos, eased);
      mesh.position.y = endY + Math.sin(eased * Math.PI) * (isKnightSkin ? 0.12 : 0.18);
      mesh.userData.baseY = endY;
      mesh.rotation.y = startRotY + (targetRotY - startRotY) * eased;
      mesh.rotation.z = Math.sin(eased * Math.PI * 2) * (isKnightSkin ? 0.035 : 0.08);
      if (isKnightSkin) mesh.rotation.x = Math.sin(eased * Math.PI) * 0.045;

      if (t >= 1) {
        mesh.position.copy(endPos);
        mesh.userData.baseY = endY;
        if (actor.dying || actor.rollToken !== rollToken) {
          actor.moving = false;
          DegulSfx.endRoll(actor);
          return false;
        }
        actor.moving = false;
        actor.rollToken = null;
        DegulSfx.endRoll(actor);
        onDone();
        return false;
      }
      return true;
    }
    addFrameTask(hopStep);
    return;
  }

  const pivot = new THREE.Group();
  scene.add(pivot);

  const stepX = Math.sign(dx);
  const stepZ = Math.sign(dz);
  const edgeOffset = new THREE.Vector3(stepX * halfSize, -halfSize, stepZ * halfSize);
  pivot.position.copy(startPos).add(edgeOffset);

  scene.attach(mesh);
  pivot.attach(mesh);

  const axis = new THREE.Vector3(stepZ, 0, -stepX).normalize();
  const startTime = performance.now();
  const duration = getActorMoveTime(actor);

  function step(now) {
    if (actor.dying || actor.rollToken !== rollToken) {
      scene.attach(mesh);
      scene.remove(pivot);
      actor.moving = false;
      DegulSfx.endRoll(actor);
      return false;
    }

    const t = Math.min((now - startTime) / duration, 1);
    const eased = easeOutCubic(t);
    pivot.rotation.set(0,0,0);
    pivot.rotateOnAxis(axis, eased * Math.PI / 2);

    if (t >= 1) {
      scene.attach(mesh);
      scene.remove(pivot);

      mesh.position.copy(endPos);
      mesh.rotation.x = Math.round(mesh.rotation.x / (Math.PI/2)) * (Math.PI/2);
      mesh.rotation.y = Math.round(mesh.rotation.y / (Math.PI/2)) * (Math.PI/2);
      mesh.rotation.z = Math.round(mesh.rotation.z / (Math.PI/2)) * (Math.PI/2);

      if (actor.dying || actor.rollToken !== rollToken) {
        actor.moving = false;
        DegulSfx.endRoll(actor);
        return false;
      }
      actor.moving = false;
      actor.rollToken = null;
      DegulSfx.endRoll(actor);
      onDone();
      return false;
    }
    return true;
  }

  addFrameTask(step);
}

function afterMove(actor) {
  if (gameOver || gameEnding || gameResultLocked || !actor || !actor.alive || actor.dying) return;
  if (isLineSurgeActive(actor)) {
    const surgePath = actor.pendingLineSurgePath && actor.pendingLineSurgePath.length
      ? actor.pendingLineSurgePath
      : [{ x: actor.x, z: actor.z }];

    for (const point of surgePath) {
      claimLineSurgeStep(actor, point.x, point.z);
    }

    actor.pendingLineSurgePath = null;
    checkItemPickup(actor);
    checkWinByLand();
    return;
  }

  const currentLand = land[actor.z][actor.x];

  // 자기 땅 밖이면 흔적 생성
  if (currentLand !== actor.landId) {
    addTrail(actor, actor.x, actor.z);
  }

  // 흔적을 만든 상태로 자기 땅에 돌아오면 점령
  if (actor.trail.length > 0 && currentLand === actor.landId) {
    claimArea(actor);
  }

  checkItemPickup(actor);
  checkWinByLand();
}

