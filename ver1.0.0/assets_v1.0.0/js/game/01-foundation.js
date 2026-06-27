/*
  2인용 3D 블록 땅따먹기
  - 1P: WASD
  - 2P: 방향키
  - AI 없음
  - 블록은 미끄러지지 않고 90도 엎어지듯 이동
  - 자기 흔적 라인을 본인이 밟아도 사망
  - 상대 흔적 라인을 밟아도 상대를 죽임
  - 자기 땅으로 돌아오면 둘러싼 영역 점령
  - 전체 색감: 파스텔 톤
*/

// ===================== 기본 설정 =====================
function safeLocalStorageGet(key, fallback = null) {
  try {
    const value = localStorage.getItem(key);
    return value === null ? fallback : value;
  } catch (error) {
    return fallback;
  }
}

function safeLocalStorageSet(key, value) {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch (error) {
    return false;
  }
}

const GRID_SIZE = 31;
const HALF = Math.floor(GRID_SIZE / 2);
const CELL = 1;
// 인게임 타일 간격 보정: 논리 칸은 1 유지, 실제 보이는 타일만 살짝 줄여 일정한 틈을 만든다.
const TILE_VISUAL_SIZE = 0.90;
const TILE_GAP = CELL - TILE_VISUAL_SIZE;
const MOVE_TIME = 145;

const PERFORMANCE_STORAGE_KEY = "degulDegulPerformanceLevel";
const PERFORMANCE_TABLET_STORAGE_KEY = "degulDegulTabletPerformanceLevel";
const PERFORMANCE_HUD_STORAGE_KEY = "degulDegulPerformanceHud";
const PERFORMANCE_PRESETS = {
  low: { fps: 45, pixelRatio: 1, glowTiles: 36, effectInterval: 2, specialTileInterval: 4, backgroundInterval: 5, ghostFogDots: 20, enableSpecialTileAnimation: false },
  medium: { fps: 60, pixelRatio: 1.5, glowTiles: 80, effectInterval: 2, specialTileInterval: 2, backgroundInterval: 3, ghostFogDots: 40, enableSpecialTileAnimation: true },
  high: { fps: 60, pixelRatio: 2, glowTiles: 180, effectInterval: 1, specialTileInterval: 1, backgroundInterval: 1, ghostFogDots: 80, enableSpecialTileAnimation: true }
};

function getForcedDeviceLayoutForPerformance() {
  try {
    return forcedDeviceLayout || "";
  } catch (error) {
    return "";
  }
}

function detectNativeTabletForPerformance() {
  const ua = navigator.userAgent || "";
  const uaDataReportsMobile = navigator.userAgentData?.mobile === true;
  const touchPoints = Number(navigator.maxTouchPoints) || 0;
  const hasCoarsePointer = window.matchMedia && window.matchMedia("(pointer: coarse)").matches;
  const shortestScreenSide = Math.min(
    Number(window.screen?.width) || window.innerWidth,
    Number(window.screen?.height) || window.innerHeight,
    window.innerWidth,
    window.innerHeight
  );
  const isIPad = /iPad/i.test(ua) || (/Macintosh/i.test(ua) && touchPoints > 1);
  const isAndroidTablet = /Android/i.test(ua) && !/Mobile/i.test(ua) && !uaDataReportsMobile;
  const largeTouchScreen = (touchPoints > 0 || hasCoarsePointer) && !uaDataReportsMobile && shortestScreenSide >= 700;
  return isIPad || isAndroidTablet || largeTouchScreen;
}

function isTabletPerformanceMode() {
  const forcedLayout = getForcedDeviceLayoutForPerformance();
  if (forcedLayout === "tablet") return true;
  if (forcedLayout === "pc") return false;
  return detectNativeTabletForPerformance();
}

function getPerformanceStorageKeyForCurrentDevice() {
  return isTabletPerformanceMode() ? PERFORMANCE_TABLET_STORAGE_KEY : PERFORMANCE_STORAGE_KEY;
}

function getInitialPerformanceLevel() {
  const storageKey = getPerformanceStorageKeyForCurrentDevice();
  const saved = safeLocalStorageGet(storageKey);
  if (PERFORMANCE_PRESETS[saved]) return saved;
  if (storageKey === PERFORMANCE_TABLET_STORAGE_KEY) return "low";
  const lowPowerDevice = (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4)
    || (navigator.deviceMemory && navigator.deviceMemory <= 4)
    || /Android|iPad|Tablet/i.test(navigator.userAgent || "");
  return lowPowerDevice ? "low" : "medium";
}

let performanceStorageKey = getPerformanceStorageKeyForCurrentDevice();
let performanceLevel = getInitialPerformanceLevel();
let performanceConfig = PERFORMANCE_PRESETS[performanceLevel];
let performanceFrameCounter = 0;
let performanceHudEnabled = safeLocalStorageGet(PERFORMANCE_HUD_STORAGE_KEY) === "1";
const performanceMetrics = {
  fps: 0,
  frameMs: 0,
  lastFrameAt: 0,
  sampleStartedAt: 0,
  sampleFrames: 0,
  lastClaimMs: 0
};
const performanceAutoTune = {
  lowFpsStartedAt: 0,
  lastLevelChangeAt: performance.now(),
  cooldownMs: 15000,
  sustainMs: 6500,
  emergency30Fps: false,
  emergencyStartedAt: 0,
  nextRecoveryProbeAt: 0
};
const frameTasks = new Set();
let nextFrameTaskId = 1;
const boardMatrixScratch = new THREE.Matrix4();
const boardQuaternionScratch = new THREE.Quaternion();
const boardColorScratch = new THREE.Color();

function addFrameTask(update, cancel) {
  if (typeof update !== "function") return null;
  const task = { id: nextFrameTaskId++, update, cancel };
  frameTasks.add(task);
  return task;
}

function removeFrameTask(task) {
  if (!task || !frameTasks.delete(task)) return;
  if (typeof task.cancel === "function") task.cancel();
}

function updateFrameTasks(now) {
  if (!frameTasks.size) return;
  for (const task of frameTasks) {
    let keep = false;
    try {
      keep = task.update(now) !== false;
    } catch (error) {
      console.error("Frame task failed", error);
    }
    if (!keep) frameTasks.delete(task);
  }
}

function clearFrameTasks() {
  for (const task of frameTasks) {
    if (typeof task.cancel === "function") task.cancel();
  }
  frameTasks.clear();
}

function resetGhostVisionFogDots() {
  ghostVisionFogDots = Array.from({ length: performanceConfig.ghostFogDots }, (_, i) => ({
    x: (Math.sin(i * 37.17) * 0.5 + 0.5),
    y: (Math.cos(i * 21.41) * 0.5 + 0.5),
    r: 80 + (i % 9) * 28,
    a: 0.035 + (i % 5) * 0.006,
    s: 0.12 + (i % 7) * 0.025
  }));
  if (typeof rebuildGhostFogTexture === "function") rebuildGhostFogTexture();
}

function applyRendererPerformanceConfig() {
  if (!renderer) return;
  const dpr = Math.max(1, Number(window.devicePixelRatio) || 1);
  renderer.setPixelRatio(Math.min(dpr, performanceConfig.pixelRatio));
  // 내부 렌더링 배율만 성능 옵션에 따라 조절하고, 캔버스 표시 크기는
  // 항상 현재 기기의 뷰포트 전체를 사용한다.
  renderer.setSize(window.innerWidth, window.innerHeight, true);
  renderer.domElement.style.width = "100vw";
  renderer.domElement.style.height = "100vh";
  renderer.domElement.style.display = "block";
  if (typeof resizeGhostVisionOverlay === "function") resizeGhostVisionOverlay();
}

function updatePerformanceSettingsUI() {
  const labels = {
    ko: { low: "낮음", medium: "보통", high: "높음" },
    en: { low: "Low", medium: "Medium", high: "High" },
    ja: { low: "低", medium: "標準", high: "高" },
    zh: { low: "低", medium: "中", high: "高" }
  };
  const langLabels = labels[currentLang] || labels.ko;
  const value = document.getElementById("settingsPerformanceValue");
  if (value) value.textContent = langLabels[performanceLevel];
  document.querySelectorAll("[data-performance-level]").forEach(button => {
    const level = button.dataset.performanceLevel;
    button.textContent = langLabels[level];
    button.classList.toggle("selected", level === performanceLevel);
    button.setAttribute("aria-pressed", level === performanceLevel ? "true" : "false");
  });
  updatePerformanceHudUI();
}

function updatePerformanceHudUI() {
  const hud = document.getElementById("performanceHud");
  const button = document.getElementById("settingsPerformanceHudToggle");
  const labels = {
    ko: performanceHudEnabled ? "📊 성능 정보 숨기기" : "📊 성능 정보 표시",
    en: performanceHudEnabled ? "📊 Hide performance info" : "📊 Show performance info",
    ja: performanceHudEnabled ? "📊 パフォーマンス情報を隠す" : "📊 パフォーマンス情報を表示",
    zh: performanceHudEnabled ? "📊 隐藏性能信息" : "📊 显示性能信息"
  };
  if (hud) hud.classList.toggle("show", performanceHudEnabled);
  if (button) {
    button.textContent = labels[currentLang] || labels.ko;
    button.classList.toggle("active", performanceHudEnabled);
  }
}

function setPerformanceHudEnabled(enabled, persist = true) {
  performanceHudEnabled = !!enabled;
  performanceMetrics.fps = 0;
  performanceMetrics.frameMs = 0;
  performanceMetrics.lastFrameAt = 0;
  performanceMetrics.sampleStartedAt = 0;
  performanceMetrics.sampleFrames = 0;
  if (persist) {
    safeLocalStorageSet(PERFORMANCE_HUD_STORAGE_KEY, performanceHudEnabled ? "1" : "0");
  }
  updatePerformanceHudUI();
}

function togglePerformanceHud() {
  setPerformanceHudEnabled(!performanceHudEnabled);
}

function updatePerformanceMetrics(now) {
  if (!renderer) return;
  if (!performanceMetrics.sampleStartedAt) performanceMetrics.sampleStartedAt = now;
  performanceMetrics.sampleFrames++;
  if (performanceMetrics.lastFrameAt) {
    const frameTime = now - performanceMetrics.lastFrameAt;
    performanceMetrics.frameMs = performanceMetrics.frameMs
      ? performanceMetrics.frameMs * 0.82 + frameTime * 0.18
      : frameTime;
  }
  performanceMetrics.lastFrameAt = now;
  const elapsed = now - performanceMetrics.sampleStartedAt;
  if (elapsed < 500) return;
  performanceMetrics.fps = performanceMetrics.sampleFrames * 1000 / elapsed;
  performanceMetrics.sampleFrames = 0;
  performanceMetrics.sampleStartedAt = now;

  updateAutomaticPerformanceLevel(now);
  if (!performanceHudEnabled) return;

  const hud = document.getElementById("performanceHud");
  if (!hud) return;
  const info = renderer.info;
  let activeBuckets = 0;
  if (boardTileBuckets && boardTileBuckets.size) {
    boardTileBuckets.forEach(bucket => { if (bucket.tiles.length) activeBuckets++; });
  }
  hud.textContent = [
    `FPS ${performanceMetrics.fps.toFixed(1)}  ${performanceMetrics.frameMs.toFixed(1)}ms`,
    `Draw ${info.render.calls}  Tri ${info.render.triangles}`,
    `Geo ${info.memory.geometries}  Tex ${info.memory.textures}`,
    `Board buckets ${activeBuckets}`,
    `Claim ${performanceMetrics.lastClaimMs.toFixed(2)}ms`,
    `Mode ${performanceLevel}${performanceAutoTune.emergency30Fps ? " (30 FPS emergency)" : ""} / ${gamePhase}`
  ].join("\n");
}

function updateAutomaticPerformanceLevel(now) {
  if (gamePhase !== GAME_PHASE.PLAYING || document.hidden) {
    performanceAutoTune.lowFpsStartedAt = 0;
    return;
  }
  if (performanceLevel === "low" && performanceAutoTune.emergency30Fps) {
    if (now >= performanceAutoTune.nextRecoveryProbeAt) {
      performanceAutoTune.emergency30Fps = false;
      performanceAutoTune.lowFpsStartedAt = 0;
      performanceAutoTune.lastLevelChangeAt = now;
    }
    return;
  }
  if (now - performanceAutoTune.lastLevelChangeAt < performanceAutoTune.cooldownMs) return;
  const targetFps = performanceConfig.fps;
  const lowThreshold = targetFps * 0.72;
  if (performanceMetrics.fps >= lowThreshold) {
    performanceAutoTune.lowFpsStartedAt = 0;
    return;
  }
  if (!performanceAutoTune.lowFpsStartedAt) {
    performanceAutoTune.lowFpsStartedAt = now;
    return;
  }
  if (now - performanceAutoTune.lowFpsStartedAt < performanceAutoTune.sustainMs) return;
  if (performanceLevel === "low") {
    performanceAutoTune.emergency30Fps = true;
    performanceAutoTune.emergencyStartedAt = now;
    performanceAutoTune.nextRecoveryProbeAt = now + 20000;
    performanceAutoTune.lowFpsStartedAt = 0;
    return;
  }
  setPerformanceLevel(performanceLevel === "high" ? "medium" : "low", { automatic: true });
}

function setPerformanceLevel(level, options = {}) {
  if (!PERFORMANCE_PRESETS[level]) return;
  performanceLevel = level;
  performanceConfig = PERFORMANCE_PRESETS[level];
  performanceAutoTune.lowFpsStartedAt = 0;
  performanceAutoTune.lastLevelChangeAt = performance.now();
  performanceAutoTune.emergency30Fps = false;
  performanceAutoTune.emergencyStartedAt = 0;
  performanceAutoTune.nextRecoveryProbeAt = 0;
  performanceStorageKey = getPerformanceStorageKeyForCurrentDevice();
  if (options.persist !== false) safeLocalStorageSet(performanceStorageKey, level);
  if (document.body) {
    document.body.classList.toggle("performance-low", level === "low");
    document.body.classList.toggle("performance-medium", level === "medium");
    document.body.classList.toggle("performance-high", level === "high");
    document.body.classList.toggle("tablet-performance-mode", performanceStorageKey === PERFORMANCE_TABLET_STORAGE_KEY);
  }
  if (typeof ghostVisionFogDots !== "undefined") resetGhostVisionFogDots();
  applyRendererPerformanceConfig();
  updatePerformanceSettingsUI();
}

function syncPerformanceLevelForCurrentDevice() {
  const nextStorageKey = getPerformanceStorageKeyForCurrentDevice();
  if (nextStorageKey === performanceStorageKey) {
    if (document.body) document.body.classList.toggle("tablet-performance-mode", nextStorageKey === PERFORMANCE_TABLET_STORAGE_KEY);
    return;
  }
  performanceStorageKey = nextStorageKey;
  const saved = safeLocalStorageGet(nextStorageKey);
  const nextLevel = PERFORMANCE_PRESETS[saved]
    ? saved
    : (nextStorageKey === PERFORMANCE_TABLET_STORAGE_KEY ? "low" : "medium");
  setPerformanceLevel(nextLevel, { persist: false });
}

// ===================== 효과음 매니저 =====================
// 파일명 기준 매칭:
// 카운트다운 3,2,1 / START / 블록 이동 루프 / 방향 전환 / 영역 점령 / 아이템 생성 / 아이템 획득 / 버튼 클릭
const DegulSfx = (() => {
  const ids = {
    countdown: "sfxCountdown",
    start: "sfxStart",
    roll: "sfxRoll",
    rollP1: "sfxRollP1",
    rollP2: "sfxRollP2",
    rollAI: "sfxRollAI",
    turn: "sfxTurn",
    turnP1: "sfxTurnP1",
    turnP2: "sfxTurnP2",
    turnAI: "sfxTurnAI",
    button: "sfxButton",
    spawn: "sfxSpawn",
    pickup: "sfxPickup",
    pickupSpeed: "sfxPickupSpeed",
    pickupShield: "sfxPickupShield",
    pickupGiant: "sfxPickupGiant",
    shieldWallHit: "sfxShieldWallHit",
    ghostLightOn: "sfxGhostLightOn",
    ghostLightOff: "sfxGhostLightOff",
    captureP1: "sfxCaptureP1",
    captureP2: "sfxCaptureP2",
    captureAI: "sfxCaptureAI"
  };

  const volumes = {
    countdown: 0.72,
    start: 0.86,
    roll: 0.32,
    rollP1: 0.36,
    rollP2: 0.36,
    rollAI: 0.36,
    turn: 0.52,
    turnP1: 0.58,
    turnP2: 0.58,
    turnAI: 0.58,
    button: 0.42,
    spawn: 0.70,
    pickup: 0.82,
    pickupSpeed: 0.84,
    pickupShield: 0.84,
    pickupGiant: 0.86,
    shieldWallHit: 0.88,
    ghostLightOn: 0.82,
    ghostLightOff: 0.82,
    captureP1: 0.88,
    captureP2: 0.88,
    captureAI: 0.88
  };

  let unlocked = false;
  let rollingCount = 0;
  let rollStopTimer = null;
  const rollingCounts = { rollP1: 0, rollP2: 0, rollAI: 0 };
  const rollStopTimers = { rollP1: null, rollP2: null, rollAI: null };
  let lastTurnAt = 0;
  const oneShotPools = {};
  const oneShotActiveCounts = {};
  const lastOneShotAt = {};
  const ONE_SHOT_POOL_LIMIT = 3;
  const oneShotMinIntervals = {
    button: 45,
    turn: 90,
    turnP1: 90,
    turnP2: 90,
    turnAI: 90,
    pickup: 120,
    pickupSpeed: 120,
    pickupShield: 120,
    pickupGiant: 120,
    shieldWallHit: 120,
    captureP1: 120,
    captureP2: 120,
    captureAI: 120,
    spawn: 120
  };
  const reportedAudioFailures = new Set();

  function reportAudioFailure(name, error) {
    const key = `${name}:${error && error.name ? error.name : "playback"}`;
    if (reportedAudioFailures.has(key)) return;
    reportedAudioFailures.add(key);
    console.warn(`[DegulSfx] ${name} 재생 실패`, error || "");
    document.dispatchEvent(new CustomEvent("degul:audio-error", {
      detail: { sound: name, error: error && error.message ? error.message : String(error || "") }
    }));
  }

  function get(name) {
    return document.getElementById(ids[name]);
  }

  function unlock() {
    if (unlocked) return;
    unlocked = true;
    Object.keys(ids).forEach(name => {
      const audio = get(name);
      if (!audio) return;
      audio.volume = getEffectiveVolume(name);
      audio.load();
      audio.addEventListener("error", () => {
        reportAudioFailure(name, audio.error || new Error("오디오 파일 로드 실패"));
      }, { once: true });
    });
  }

  function getEffectiveVolume(name) {
    const master = Number.isFinite(sfxVolume) ? sfxVolume : 1;
    return (volumes[name] ?? 0.7) * master;
  }

  function applyMasterVolume() {
    Object.keys(ids).forEach(name => {
      const audio = get(name);
      if (!audio) return;
      audio.volume = getEffectiveVolume(name);
    });
  }

  function oneShot(name) {
    unlock();
    const base = get(name);
    if (!base) return;
    const now = performance.now();
    const minInterval = oneShotMinIntervals[name] || 0;
    if (minInterval && now - (lastOneShotAt[name] || 0) < minInterval) return;
    lastOneShotAt[name] = now;
    try {
      const pool = oneShotPools[name] || (oneShotPools[name] = []);
      const activeCount = oneShotActiveCounts[name] || 0;
      if (!pool.length && activeCount >= ONE_SHOT_POOL_LIMIT) return;
      const audio = pool.pop() || base.cloneNode(true);
      oneShotActiveCounts[name] = activeCount + 1;
      audio.volume = getEffectiveVolume(name);
      audio.currentTime = 0;
      audio.onended = () => {
        oneShotActiveCounts[name] = Math.max(0, (oneShotActiveCounts[name] || 1) - 1);
        if (audio !== base && pool.length < ONE_SHOT_POOL_LIMIT) pool.push(audio);
      };
      const p = audio.play();
      if (p && typeof p.catch === "function") {
        p.catch(error => {
          oneShotActiveCounts[name] = Math.max(0, (oneShotActiveCounts[name] || 1) - 1);
          reportAudioFailure(name, error);
        });
      }
    } catch (error) {
      oneShotActiveCounts[name] = Math.max(0, (oneShotActiveCounts[name] || 1) - 1);
      reportAudioFailure(name, error);
    }
  }

  function getActorSoundSide(actor) {
    if (actor && actor.isAI) return "AI";
    if (typeof P2_LAND !== "undefined" && actor && actor.landId === P2_LAND) return "P2";
    return "P1";
  }

  function getRollSoundName(actor) {
    const side = getActorSoundSide(actor);
    if (side === "AI") return "rollAI";
    if (side === "P2") return "rollP2";
    return "rollP1";
  }

  function playLoop(name) {
    unlock();
    const audio = get(name) || get("roll");
    if (!audio) return;
    if (rollStopTimers[name]) {
      clearTimeout(rollStopTimers[name]);
      rollStopTimers[name] = null;
    }
    audio.volume = getEffectiveVolume(name);
    if (audio.paused) {
      audio.currentTime = 0;
      const p = audio.play();
      if (p && typeof p.catch === "function") p.catch(error => reportAudioFailure(name, error));
    }
  }

  function stopLoopSoon(name) {
    const audio = get(name) || get("roll");
    if (!audio) return;
    if (rollStopTimers[name]) clearTimeout(rollStopTimers[name]);
    rollStopTimers[name] = setTimeout(() => {
      if ((rollingCounts[name] || 0) > 0) return;
      audio.pause();
      audio.currentTime = 0;
    }, 70);
  }

  function playTurn(actor) {
    const now = performance.now();
    if (now - lastTurnAt < 70) return;
    lastTurnAt = now;

    const side = getActorSoundSide(actor);
    if (side === "AI") {
      oneShot("turnAI");
    } else if (side === "P2") {
      oneShot("turnP2");
    } else {
      oneShot("turnP1");
    }
  }

  function beginRoll(actor) {
    const name = getRollSoundName(actor);
    rollingCounts[name] = (rollingCounts[name] || 0) + 1;
    playLoop(name);
  }

  function endRoll(actor) {
    const name = getRollSoundName(actor);
    rollingCounts[name] = Math.max(0, (rollingCounts[name] || 0) - 1);
    if (rollingCounts[name] > 0) return;
    stopLoopSoon(name);
  }

  function stopAll() {
    rollingCount = 0;
    if (rollStopTimer) clearTimeout(rollStopTimer);
    rollStopTimer = null;
    Object.keys(rollingCounts).forEach(name => { rollingCounts[name] = 0; });
    Object.keys(rollStopTimers).forEach(name => {
      if (rollStopTimers[name]) clearTimeout(rollStopTimers[name]);
      rollStopTimers[name] = null;
    });
    Object.keys(ids).forEach(name => {
      const audio = get(name);
      if (!audio) return;
      try {
        audio.pause();
        audio.currentTime = 0;
      } catch (e) {}
    });
  }

  function playItemPickup(itemType) {
    if (itemType === ITEM_TYPES.MOVE_BOOST) {
      oneShot("pickupSpeed");
    } else if (itemType === ITEM_TYPES.SHIELD) {
      oneShot("pickupShield");
    } else if (itemType === ITEM_TYPES.LINE_SURGE) {
      oneShot("pickupGiant");
    } else {
      oneShot("pickup");
    }
  }

  function playCapture(actor) {
    if (actor && actor.isAI) {
      oneShot("captureAI");
    } else if (typeof P2_LAND !== "undefined" && actor && actor.landId === P2_LAND) {
      oneShot("captureP2");
    } else {
      oneShot("captureP1");
    }
  }

  return { unlock, oneShot, playTurn, beginRoll, endRoll, stopAll, playItemPickup, playCapture, applyMasterVolume };
})();

const EMPTY = 0;
const P1_LAND = 1;
const P2_LAND = 2;

const COLOR_CHOICES = [
  { name: "Sky", actor: 0x7dc7ff, landLight: 0xaedcff, landDark: 0x1d6fae, line: 0x78d8ff },
  { name: "Pink", actor: 0xff92b8, landLight: 0xffc1d6, landDark: 0xb93b72, line: 0xffa6c8 },
  { name: "Mint", actor: 0x62e6b7, landLight: 0xb8f7d4, landDark: 0x169b72, line: 0x6fffd1 },
  { name: "Yellow", actor: 0xffd166, landLight: 0xffec9e, landDark: 0xc79216, line: 0xffdf73 },
  { name: "Purple", actor: 0xb69cff, landLight: 0xd8ccff, landDark: 0x7057d6, line: 0xc8b6ff },
  { name: "Coral", actor: 0xff8a76, landLight: 0xffc0b5, landDark: 0xc55342, line: 0xff9b8a },
  { name: "Gift Box", actor: 0xff3b6b, landLight: 0xffd7e5, landDark: 0xc21f4b, line: 0xff6f9b, skin: "gift" },
  { name: "Ice", actor: 0x8ee8ff, landLight: 0xcdf7ff, landDark: 0x32a9d8, line: 0xb8f6ff, skin: "ice" },
  { name: "Rainbow", actor: 0xff3b30, landLight: 0xffb3ad, landDark: 0xb7a1d9, line: 0xffd8a8, skin: "rainbow" },
  { name: "Chocolate", actor: 0x5a2f18, landLight: 0xc98b55, landDark: 0x3a1d0f, line: 0xf2c38f, skin: "chocolate", hidden: true },
  { name: "Knight", actor: 0x1f2937, landLight: 0xf8fafc, landDark: 0x111827, line: 0xcbd5e1, skin: "chess" },
  { name: "Extreme", actor: 0x843cff, landLight: 0xb784ff, landDark: 0x5b21b6, line: 0xd8b4fe, skin: "extreme", sparkle: true },
  { name: "Hell", actor: 0x2a0000, landLight: 0xff4b1f, landDark: 0x510000, line: 0xffb000, skin: "hell", sparkle: true },
  { name: "Chaos", actor: 0x00ff78, landLight: 0x54ff9d, landDark: 0x003b1e, line: 0x00ffcc, skin: "chaos", sparkle: true },
  { name: "Ghost", actor: 0xd7dce5, landLight: 0xbfc5cf, landDark: 0x6d7480, line: 0xe8ebf0, skin: "ghost" }
 ];

const SOLID_COLOR_CHOICES = COLOR_CHOICES.filter(choice => !choice.skin);
const SKIN_COLOR_CHOICES = COLOR_CHOICES.filter(choice => !!choice.skin && !choice.hidden);

const AI_SKIN_UNLOCK_STORAGE_KEY = "degulDegulUnlockedSkinsV1";
const AI_LOCAL_RECORD_STORAGE_KEY = "degulDegulAiLocalRecordsV1";
const AI_CLEAR_REWARDS = {
  easy: { skin: "gift", labelKo: "선물 스킨", labelEn: "Gift Skin" },
  normal: { skin: "ice", labelKo: "얼음 스킨", labelEn: "Ice Skin" },
  hard: { skin: "rainbow", labelKo: "무지개 스킨", labelEn: "Rainbow Skin" },
  superhard: { skin: "chess", labelKo: "나이트 스킨", labelEn: "Knight Skin", labelJa: "ナイトスキン", labelZh: "骑士皮肤" },
  extreme: { skin: "extreme", labelKo: "익스트림 AI 스킨", labelEn: "Extreme AI Skin" },
  hell: { skin: "hell", labelKo: "지옥 AI 스킨", labelEn: "Hell AI Skin" },
  chaos: { skin: "chaos", labelKo: "카오스 AI 스킨", labelEn: "Chaos AI Skin" }
};

const AI_DIFFICULTY_ORDER = ["easy", "normal", "hard", "superhard", "extreme", "hell", "chaos"];
const AI_DIFFICULTY_PROGRESS_STORAGE_KEY = "degulDegulAiDifficultyClearsV1";
let aiClearedDifficulties = loadAiDifficultyClears();

function loadAiDifficultyClears() {
  try {
    const raw = safeLocalStorageGet(AI_DIFFICULTY_PROGRESS_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter(level => AI_DIFFICULTY_ORDER.includes(level)) : []);
  } catch (e) {
    return new Set();
  }
}

function saveAiDifficultyClears() {
  try {
    safeLocalStorageSet(AI_DIFFICULTY_PROGRESS_STORAGE_KEY, JSON.stringify(Array.from(aiClearedDifficulties)));
  } catch (e) {}
}

function isAiDifficultyUnlocked(level) {
  const index = AI_DIFFICULTY_ORDER.indexOf(level);
  if (index < 0) return false;
  if (index <= 2) return true; // 첫 방문 기본 해금: 이지, 노말, 하드
  return aiClearedDifficulties.has(AI_DIFFICULTY_ORDER[index - 1]);
}

function getFirstUnlockedAiDifficulty() {
  return AI_DIFFICULTY_ORDER.find(level => isAiDifficultyUnlocked(level)) || "easy";
}

function getNextAiDifficulty(level) {
  const index = AI_DIFFICULTY_ORDER.indexOf(level);
  if (index < 0 || index >= AI_DIFFICULTY_ORDER.length - 1) return null;
  return AI_DIFFICULTY_ORDER[index + 1];
}

function getAiDifficultyLabel(level) {
  const data = AI_DIFFICULTIES[level];
  if (!data) return level;
  const jaLabels = { easy: "イージー", normal: "ノーマル", hard: "ハード", superhard: "スーパーハード", extreme: "エクストリーム", hell: "ヘル", chaos: "カオス" };
  const zhLabels = { easy: "简单", normal: "普通", hard: "困难", superhard: "超困难", extreme: "极限", hell: "地狱", chaos: "混沌" };
  if (currentLang === "zh") return zhLabels[level] || data.labelKo;
  if (currentLang === "ja") return jaLabels[level] || data.labelKo;
  return currentLang === "en" ? data.labelEn : data.labelKo;
}

function getAiDifficultyUnlockHint(level) {
  const hintsKo = {
    superhard: "하드 클리어 시 해금",
    extreme: "슈퍼하드 클리어 시 해금",
    hell: "익스트림 클리어 시 해금",
    chaos: "지옥 클리어 시 해금"
  };
  const hintsEn = {
    superhard: "Unlocks after clearing Hard",
    extreme: "Unlocks after clearing Super Hard",
    hell: "Unlocks after clearing Extreme",
    chaos: "Unlocks after clearing Hell"
  };
  const hintsJa = {
    superhard: "ハードクリアで解放",
    extreme: "スーパーハードクリアで解放",
    hell: "エクストリームクリアで解放",
    chaos: "ヘルクリアで解放"
  };
  const hintsZh = {
    superhard: "通关困难后解锁",
    extreme: "通关超困难后解锁",
    hell: "通关极限后解锁",
    chaos: "通关地狱后解锁"
  };
  if (currentLang === "zh") return hintsZh[level] || getAiDifficultyLabel(level);
  if (currentLang === "ja") return hintsJa[level] || getAiDifficultyLabel(level);
  if (currentLang === "en") return hintsEn[level] || getAiDifficultyLabel(level);
  return hintsKo[level] || getAiDifficultyLabel(level);
}

function markAiDifficultyCleared(level) {
  if (!AI_DIFFICULTY_ORDER.includes(level)) return "";
  const nextLevel = getNextAiDifficulty(level);
  const wasNextLocked = nextLevel ? !isAiDifficultyUnlocked(nextLevel) : false;
  aiClearedDifficulties.add(level);
  saveAiDifficultyClears();
  updateGameModeUI();

  if (nextLevel && wasNextLocked && isAiDifficultyUnlocked(nextLevel)) {
    if (currentLang === "zh") return `🔓 新AI难度已解锁：${getAiDifficultyLabel(nextLevel)}`;
    if (currentLang === "ja") return `🔓 新しいAI難易度が解放されました：${getAiDifficultyLabel(nextLevel)}`;
    return currentLang === "en"
      ? `🔓 New AI difficulty unlocked: ${getAiDifficultyLabel(nextLevel)}`
      : `🔓 새 AI 난이도 해금: ${getAiDifficultyLabel(nextLevel)}`;
  }
  return "";
}
const SKIN_UNLOCK_HINTS_KO = {
  gift: "AI 이지 클리어",
  ice: "AI 노말 클리어",
  rainbow: "AI 하드 클리어",
  chess: "AI 슈퍼하드 클리어",
  chocolate: "AI 슈퍼하드 클리어",
  extreme: "AI 익스트림 클리어",
  hell: "AI 지옥 클리어",
  chaos: "AI 카오스 클리어",
  ghost: "AI 하드 이상 고스트 클리어"
};
const SKIN_UNLOCK_HINTS_EN = {
  gift: "Clear AI Easy",
  ice: "Clear AI Normal",
  rainbow: "Clear AI Hard",
  chess: "Clear AI Super Hard",
  chocolate: "Clear AI Super Hard",
  extreme: "Clear AI Extreme",
  hell: "Clear AI Hell",
  chaos: "Clear AI Chaos",
  ghost: "Clear AI Hard+ Ghost"
};
const SKIN_UNLOCK_HINTS_JA = {
  gift: "AIイージークリア",
  ice: "AIノーマルクリア",
  rainbow: "AIハードクリア",
  chess: "AIスーパーハードクリア",
  chocolate: "AIスーパーハードクリア",
  extreme: "AIエクストリームクリア",
  hell: "AIヘルクリア",
  chaos: "AIカオスクリア",
  ghost: "AIハード以上のゴーストクリア"
};
const SKIN_UNLOCK_HINTS_ZH = {
  gift: "通关AI简单",
  ice: "通关AI普通",
  rainbow: "通关AI困难",
  chess: "通关AI超困难",
  chocolate: "通关AI超困难",
  extreme: "通关AI极限",
  hell: "通关AI地狱",
  chaos: "通关AI混沌",
  ghost: "通关AI困难以上幽灵模式"
};
let unlockedSkins = loadUnlockedSkins();
let pendingSkinUnlockNotice = "";

function loadUnlockedSkins() {
  try {
    const raw = safeLocalStorageGet(AI_SKIN_UNLOCK_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    const skins = new Set(Array.isArray(parsed) ? parsed : []);
    if (skins.has("chocolate")) skins.add("chess");
    return skins;
  } catch (e) {
    return new Set();
  }
}

function saveUnlockedSkins() {
  try {
    safeLocalStorageSet(AI_SKIN_UNLOCK_STORAGE_KEY, JSON.stringify(Array.from(unlockedSkins)));
  } catch (e) {}
}

function isSkinUnlocked(skin) {
  return !skin || unlockedSkins.has(skin);
}

function getSkinUnlockHint(skin) {
  const map = currentLang === "zh" ? SKIN_UNLOCK_HINTS_ZH : (currentLang === "ja" ? SKIN_UNLOCK_HINTS_JA : (currentLang === "en" ? SKIN_UNLOCK_HINTS_EN : SKIN_UNLOCK_HINTS_KO));
  return map[skin] || (currentLang === "zh" ? "未解锁" : (currentLang === "ja" ? "ロック中" : (currentLang === "en" ? "Locked" : "잠금")));
}

function getSkinRewardLabel(reward) {
  if (!reward) return "";
  if (currentLang === "zh") return reward.labelZh || reward.labelKo || reward.labelEn;
  if (currentLang === "ja") return reward.labelJa || reward.labelKo || reward.labelEn;
  return currentLang === "en" ? reward.labelEn : reward.labelKo;
}


const COLOR_DISPLAY_NAMES = {
  Sky: { ko: "하늘색", en: "Sky Blue" },
  Pink: { ko: "분홍색", en: "Pink" },
  Mint: { ko: "민트색", en: "Mint" },
  Yellow: { ko: "노란색", en: "Yellow" },
  Purple: { ko: "보라색", en: "Purple" },
  Coral: { ko: "코랄색", en: "Coral" },
  "Gift Box": { ko: "선물 스킨", en: "Gift Skin" },
  Ice: { ko: "얼음 스킨", en: "Ice Skin" },
  Rainbow: { ko: "무지개 스킨", en: "Rainbow Skin" },
  Chocolate: { ko: "초콜릿 스킨", en: "Chocolate Skin" },
    Extreme: { ko: "익스트림 AI 스킨", en: "Extreme AI Skin", ja: "エクストリームAIスキン" },
  Hell: { ko: "지옥 AI 스킨", en: "Hell AI Skin", ja: "ヘルAIスキン" },
  Chaos: { ko: "카오스 AI 스킨", en: "Chaos AI Skin", ja: "カオスAIスキン" },
  Ghost: { ko: "유령 스킨", en: "Ghost Skin", ja: "ゴーストスキン" }
};
Object.assign(COLOR_DISPLAY_NAMES.Sky, { ja: "空色" });
Object.assign(COLOR_DISPLAY_NAMES.Pink, { ja: "ピンク" });
Object.assign(COLOR_DISPLAY_NAMES.Mint, { ja: "ミント" });
Object.assign(COLOR_DISPLAY_NAMES.Yellow, { ja: "イエロー" });
Object.assign(COLOR_DISPLAY_NAMES.Purple, { ja: "パープル" });
Object.assign(COLOR_DISPLAY_NAMES.Coral, { ja: "コーラル" });
Object.assign(COLOR_DISPLAY_NAMES["Gift Box"], { ja: "ギフトスキン" });
Object.assign(COLOR_DISPLAY_NAMES.Ice, { ja: "アイススキン" });
Object.assign(COLOR_DISPLAY_NAMES.Rainbow, { ja: "レインボースキン" });
Object.assign(COLOR_DISPLAY_NAMES.Chocolate, { ja: "チョコレートスキン" });
COLOR_DISPLAY_NAMES.Knight = { ko: "나이트 스킨", en: "Knight Skin", ja: "ナイトスキン", zh: "骑士皮肤" };
Object.assign(COLOR_DISPLAY_NAMES.Sky, { zh: "天蓝色" });
Object.assign(COLOR_DISPLAY_NAMES.Pink, { zh: "粉色" });
Object.assign(COLOR_DISPLAY_NAMES.Mint, { zh: "薄荷色" });
Object.assign(COLOR_DISPLAY_NAMES.Yellow, { zh: "黄色" });
Object.assign(COLOR_DISPLAY_NAMES.Purple, { zh: "紫色" });
Object.assign(COLOR_DISPLAY_NAMES.Coral, { zh: "珊瑚色" });
Object.assign(COLOR_DISPLAY_NAMES["Gift Box"], { zh: "礼物皮肤" });
Object.assign(COLOR_DISPLAY_NAMES.Ice, { zh: "冰雪皮肤" });
Object.assign(COLOR_DISPLAY_NAMES.Rainbow, { zh: "彩虹皮肤" });
Object.assign(COLOR_DISPLAY_NAMES.Chocolate, { zh: "巧克力皮肤" });
Object.assign(COLOR_DISPLAY_NAMES.Extreme, { zh: "极限AI皮肤" });
Object.assign(COLOR_DISPLAY_NAMES.Hell, { zh: "地狱AI皮肤" });
Object.assign(COLOR_DISPLAY_NAMES.Chaos, { zh: "混沌AI皮肤" });
Object.assign(COLOR_DISPLAY_NAMES.Ghost, { zh: "幽灵皮肤" });


function getColorDisplayName(colorData) {
  if (!colorData) return currentLang === "zh" ? "颜色" : (currentLang === "ja" ? "色" : (currentLang === "en" ? "Color" : "색상"));
  const display = COLOR_DISPLAY_NAMES[colorData.name];
  if (!display) return colorData.name;
  return currentLang === "zh" ? (display.zh || display.ko || display.en) : (currentLang === "ja" ? (display.ja || display.ko || display.en) : (currentLang === "en" ? display.en : display.ko));
}

function unlockSkinReward(reward) {
  if (!reward || !reward.skin) return "";
  if (unlockedSkins.has(reward.skin)) return "";

  unlockedSkins.add(reward.skin);
  if (currentLang === "ja") return `🎁 新しいスキンが解放されました：${getSkinRewardLabel(reward)}`;
  return currentLang === "en"
    ? `🎁 New skin unlocked: ${getSkinRewardLabel(reward)}`
    : `🎁 새 스킨 해금: ${getSkinRewardLabel(reward)}`;
}

function unlockSkinByAiClear(level) {
  const notice = unlockSkinReward(AI_CLEAR_REWARDS[level]);
  if (notice) {
    saveUnlockedSkins();
    buildLobbyPalettes();
    updateReadyUI();
  }
  return notice;
}

function loadAiLocalRecords() {
  try {
    const raw = safeLocalStorageGet(AI_LOCAL_RECORD_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch (e) {
    return {};
  }
}

function saveAiLocalRecords(records) {
  try {
    safeLocalStorageSet(AI_LOCAL_RECORD_STORAGE_KEY, JSON.stringify(records || {}));
  } catch (e) {}
}

function getAiRecordText(key) {
  const text = {
    ko: {
      title: "내 AI대전 기록",
      popupTitle: "AI대전 기록",
      wing: "AI대전 기록",
      wingSub: "랭킹",
      localTab: "내 기록",
      rankingTab: "AI 랭킹",
      rankingTitle: "AI 랭킹",
      rankingStatus: "TOP 100",
      rankingSoonLabel: "Cloudflare D1 랭킹 시스템 예정",
      rankingSoonText: "배포 후 TOP 100 랭킹으로 연결됩니다.",
      bestTime: "최고 클리어 타임",
      bestStreak: "최고 연승",
      lastWinType: "최근 승리 방식",
      lastWinMode: "최근 승리 모드",
      uncleared: "미클리어",
      none: "-",
      streak: count => `${count}연승`,
      modes: { speed: "스피드 모드", item: "아이템 모드", ghostSuffix: " + 고스트" },
      types: {
        land: "영역 점령",
        lineCut: "라인 절단",
        collision: "충돌 승리",
        trail: "상대 실수",
        timeout: "판정 승리",
        other: "승리"
      }
    },
    en: {
      title: "My AI Records",
      popupTitle: "AI Records",
      wing: "AI Records",
      wingSub: "Ranking",
      localTab: "My Records",
      rankingTab: "AI Ranking",
      rankingTitle: "AI Ranking",
      rankingStatus: "TOP 100",
      rankingSoonLabel: "Cloudflare D1 ranking system planned",
      rankingSoonText: "After deployment, this will connect to the TOP 100 ranking.",
      bestTime: "Best Clear Time",
      bestStreak: "Best Streak",
      lastWinType: "Latest Win Type",
      lastWinMode: "Latest Win Mode",
      uncleared: "Uncleared",
      none: "-",
      streak: count => `${count} win${count === 1 ? "" : "s"}`,
      modes: { speed: "Speed Mode", item: "Item Mode", ghostSuffix: " + Ghost" },
      types: {
        land: "Territory",
        lineCut: "Line Cut",
        collision: "Collision",
        trail: "Opponent Error",
        timeout: "Decision",
        other: "Win"
      }
    },
    ja: {
      title: "AI記録",
      popupTitle: "AI記録",
      wing: "AI記録",
      wingSub: "ランキング",
      localTab: "自分の記録",
      rankingTab: "AIランキング",
      rankingTitle: "AIランキング",
      rankingStatus: "TOP 100",
      rankingSoonLabel: "Cloudflare D1ランキング予定",
      rankingSoonText: "デプロイ後、TOP 100ランキングに接続します。",
      bestTime: "最速クリア",
      bestStreak: "最高連勝",
      lastWinType: "直近の勝ち方",
      lastWinMode: "直近の勝利モード",
      uncleared: "未クリア",
      none: "-",
      streak: count => `${count}連勝`,
      modes: { speed: "スピードモード", item: "アイテムモード", ghostSuffix: " + ゴースト" },
      types: {
        land: "陣地制圧",
        lineCut: "ライン切断",
        collision: "衝突勝利",
        trail: "相手ミス",
        timeout: "判定勝利",
        other: "勝利"
      }
    },
    zh: {
      title: "AI记录",
      popupTitle: "AI记录",
      wing: "AI记录",
      wingSub: "排行",
      localTab: "我的记录",
      rankingTab: "AI排行榜",
      rankingTitle: "AI排行榜",
      rankingStatus: "TOP 100",
      rankingSoonLabel: "计划接入 Cloudflare D1 排行系统",
      rankingSoonText: "部署后将连接 TOP 100 排行榜。",
      bestTime: "最快通关",
      bestStreak: "最高连胜",
      lastWinType: "最近胜利方式",
      lastWinMode: "最近胜利模式",
      uncleared: "未通关",
      none: "-",
      streak: count => `${count}连胜`,
      modes: { speed: "速度模式", item: "道具模式", ghostSuffix: " + 幽灵" },
      types: {
        land: "占领胜利",
        lineCut: "切断路线",
        collision: "碰撞胜利",
        trail: "对手失误",
        timeout: "判定胜利",
        other: "胜利"
      }
    }
  };
  const langPack = text[currentLang] || text.ko;
  return key ? langPack[key] : langPack;
}

function classifyAiWinType(reasonText) {
  const text = String(reasonText || "").toLowerCase();
  if (text.includes("60") || text.includes("영역") || text.includes("territory") || text.includes("占") || text.includes("陣地")) return "land";
  if (text.includes("라인") || text.includes("line") || text.includes("절단") || text.includes("切")) return "lineCut";
  if (text.includes("충돌") || text.includes("collision") || text.includes("碰撞") || text.includes("衝突")) return "collision";
  if (text.includes("흔적") || text.includes("trail") || text.includes("라인") || text.includes("痕") || text.includes("跡")) return "trail";
  if (text.includes("time") || text.includes("시간") || text.includes("判定")) return "timeout";
  return "other";
}

function formatAiRecordWinMode(record, text) {
  if (!record || !record.lastWinMode) return text.none;
  const modeLabels = text.modes || {};
  const baseLabel = modeLabels[record.lastWinMode] || record.lastWinMode;
  return record.lastWinGhost ? `${baseLabel}${modeLabels.ghostSuffix || ""}` : baseLabel;
}

function getAiRecordDifficultyForView() {
  return AI_DIFFICULTY_ORDER[aiRecordDifficultyIndex] || aiDifficulty || "easy";
}

function setAiRecordDifficulty(levelOrIndex) {
  const requestedIndex = typeof levelOrIndex === "number"
    ? levelOrIndex
    : AI_DIFFICULTY_ORDER.indexOf(levelOrIndex);
  if (requestedIndex < 0 || requestedIndex >= AI_DIFFICULTY_ORDER.length) return;
  aiRecordDifficultyIndex = requestedIndex;
  updateAiRecordPanel();
  if (typeof window.DegulAiRanking?.refresh === "function") {
    window.DegulAiRanking.refresh();
  }
}

function shiftAiRecordDifficulty(direction) {
  const total = AI_DIFFICULTY_ORDER.length;
  if (!total) return;
  aiRecordDifficultyIndex = (aiRecordDifficultyIndex + direction + total) % total;
  updateAiRecordPanel();
  if (typeof window.DegulAiRanking?.refresh === "function") {
    window.DegulAiRanking.refresh();
  }
}

function updateAiRecordPanel() {
  const panel = document.getElementById("aiRankingPanel");
  if (!panel) return;

  const level = getAiRecordDifficultyForView();
  const record = loadAiLocalRecords()[level] || null;
  const text = getAiRecordText();
  const typeLabels = text.types || {};

  const rankingWing = document.getElementById("aiRankingWing");
  const rankingWingText = document.getElementById("aiRankingWingText");
  const popupTitle = document.getElementById("aiRecordPopupTitle");
  const rankingStatus = document.getElementById("aiRankingStatus");
  const title = document.getElementById("aiRecordTitle");
  const diff = document.getElementById("aiRecordDifficulty");
  const bestTimeLabel = document.getElementById("aiRecordBestTimeLabel");
  const streakLabel = document.getElementById("aiRecordStreakLabel");
  const winTypeLabel = document.getElementById("aiRecordWinTypeLabel");
  const winModeLabel = document.getElementById("aiRecordWinModeLabel");
  const bestTime = document.getElementById("aiRecordBestTime");
  const streak = document.getElementById("aiRecordStreak");
  const winType = document.getElementById("aiRecordWinType");
  const winMode = document.getElementById("aiRecordWinMode");
  const carouselLabel = document.getElementById("aiRecordDifficultyCarouselLabel");
  const carouselCurrent = document.getElementById("aiRecordDifficultyCurrent");
  const carouselDots = document.getElementById("aiRecordDifficultyDots");

  if (rankingWing) rankingWing.setAttribute("aria-label", text.rankingTitle);
  if (rankingWingText) rankingWingText.textContent = text.rankingTab;
  if (popupTitle) popupTitle.textContent = text.rankingTitle;
  if (rankingStatus) rankingStatus.textContent = text.rankingStatus;
  if (title) title.textContent = text.title;
  if (diff) diff.textContent = getAiDifficultyLabel(level);
  if (carouselLabel) carouselLabel.textContent = getAiDifficultyLabel(level);
  if (carouselCurrent) carouselCurrent.setAttribute("aria-label", `${getAiDifficultyLabel(level)}. ${tr("nextAiDifficulty")}`);
  if (carouselDots) {
    carouselDots.innerHTML = AI_DIFFICULTY_ORDER.map((difficulty, index) => {
      const active = index === aiRecordDifficultyIndex ? " active" : "";
      const label = getAiDifficultyLabel(difficulty);
      return `<button class="aiRecordDifficultyDot${active}" type="button" onclick="setAiRecordDifficulty(${index})" aria-label="${label}" aria-pressed="${index === aiRecordDifficultyIndex ? "true" : "false"}"></button>`;
    }).join("");
  }
  if (bestTimeLabel) bestTimeLabel.textContent = text.bestTime;
  if (streakLabel) streakLabel.textContent = text.bestStreak;
  if (winTypeLabel) winTypeLabel.textContent = text.lastWinType;
  if (winModeLabel) winModeLabel.textContent = text.lastWinMode;
  if (bestTime) bestTime.textContent = record && Number.isFinite(record.bestTimeMs) ? formatResultTime(record.bestTimeMs) : text.uncleared;
  if (streak) streak.textContent = text.streak(record && Number.isFinite(record.bestStreak) ? record.bestStreak : 0);
  if (winType) winType.textContent = record && record.lastWinType ? (typeLabels[record.lastWinType] || typeLabels.other || text.none) : text.none;
  if (winMode) winMode.textContent = formatAiRecordWinMode(record, text);

  document.getElementById("aiRecordBestTimeBox")?.classList.toggle("empty", !record || !Number.isFinite(record.bestTimeMs));
  document.getElementById("aiRecordStreakBox")?.classList.toggle("empty", !record || !Number.isFinite(record.bestStreak) || record.bestStreak <= 0);
  document.getElementById("aiRecordWinTypeBox")?.classList.toggle("empty", !record || !record.lastWinType);
  document.getElementById("aiRecordWinModeBox")?.classList.toggle("empty", !record || !record.lastWinMode);
}

function setAiRecordPopupTab(tab) {
  const text = getAiRecordText();
  const popupTitle = document.getElementById("aiRecordPopupTitle");
  const rankingPanel = document.getElementById("aiRankingPanel");
  if (popupTitle) popupTitle.textContent = text.rankingTitle;
  if (rankingPanel) rankingPanel.hidden = false;
  if (typeof window.DegulAiRanking?.refresh === "function") {
    window.DegulAiRanking.refresh();
  }
}

function openAiRecordPopup() {
  openAiRankingPopup();
}

function openAiRankingPopup() {
  if (!AI_DIFFICULTY_ORDER[aiRecordDifficultyIndex]) {
    aiRecordDifficultyIndex = Math.max(0, AI_DIFFICULTY_ORDER.indexOf(aiDifficulty));
  }
  updateAiRecordPanel();
  setAiRecordPopupTab("ranking");
  const overlay = document.getElementById("aiRecordOverlay");
  if (!overlay) return;
  overlay.classList.add("show");
  overlay.setAttribute("aria-hidden", "false");
}

function closeAiRecordPopup(event) {
  if (event && event.target !== event.currentTarget) return;
  const overlay = document.getElementById("aiRecordOverlay");
  if (!overlay) return;
  overlay.classList.remove("show");
  overlay.setAttribute("aria-hidden", "true");
}

function isLocalTestMode() {
  try {
    return window.DegulTestGuard?.isTestMode?.() === true;
  } catch {
    return false;
  }
}

function recordAiMatchResult(winner, reasonText) {
  if (isLocalTestMode()) return;
  if (matchMode !== "ai" || !AI_DIFFICULTY_ORDER.includes(aiDifficulty)) return;
  const records = loadAiLocalRecords();
  const current = records[aiDifficulty] && typeof records[aiDifficulty] === "object" ? records[aiDifficulty] : {};
  const playerWon = !!winner && winner.landId === P1_LAND;
  const elapsedMs = Math.max(0, (matchEndedAt || performance.now()) - (matchStartedAt || matchEndedAt || performance.now()));
  const playedMode = gameMode === "item" ? "item" : "speed";
  const modeRecords = current.modeRecords && typeof current.modeRecords === "object"
    ? current.modeRecords
    : {};
  const modeRecord = modeRecords[playedMode] && typeof modeRecords[playedMode] === "object"
    ? modeRecords[playedMode]
    : {};

  modeRecord.matchCount = (Number.isFinite(modeRecord.matchCount) ? modeRecord.matchCount : 0) + 1;
  modeRecord.lastPlayedAt = Date.now();

  if (playerWon) {
    current.clearCount = (Number.isFinite(current.clearCount) ? current.clearCount : 0) + 1;
    current.currentStreak = (Number.isFinite(current.currentStreak) ? current.currentStreak : 0) + 1;
    current.bestStreak = Math.max(Number.isFinite(current.bestStreak) ? current.bestStreak : 0, current.currentStreak);
    current.bestTimeMs = Number.isFinite(current.bestTimeMs) ? Math.min(current.bestTimeMs, elapsedMs) : elapsedMs;
    current.lastWinType = classifyAiWinType(reasonText);
    current.lastWinMode = playedMode;
    current.lastWinGhost = !!ghostModeEnabled;
    current.lastClearedAt = Date.now();

    // 향후 스피드/아이템 모드별 랭킹 집계를 위해 난이도 안에서 모드별 기록도 별도 누적한다.
    modeRecord.clearCount = (Number.isFinite(modeRecord.clearCount) ? modeRecord.clearCount : 0) + 1;
    modeRecord.winCount = (Number.isFinite(modeRecord.winCount) ? modeRecord.winCount : 0) + 1;
    modeRecord.bestTimeMs = Number.isFinite(modeRecord.bestTimeMs)
      ? Math.min(modeRecord.bestTimeMs, elapsedMs)
      : elapsedMs;
    modeRecord.lastWinType = current.lastWinType;
    modeRecord.lastWinGhost = !!ghostModeEnabled;
    modeRecord.lastClearedAt = Date.now();
  } else {
    current.currentStreak = 0;
    modeRecord.lossCount = (Number.isFinite(modeRecord.lossCount) ? modeRecord.lossCount : 0) + 1;
  }

  modeRecords[playedMode] = modeRecord;
  current.modeRecords = modeRecords;
  current.lastPlayedAt = Date.now();
  records[aiDifficulty] = current;
  saveAiLocalRecords(records);
  updateAiRecordPanel();

  if (typeof window.DegulAiRanking?.finishMatch === "function") {
    const totalCells = Math.max(1, GRID_SIZE * GRID_SIZE);
    window.DegulAiRanking.finishMatch({
      won: playerWon,
      clearTimeMs: Math.round(elapsedMs),
      territoryBasisPoints: Math.round((countLand(P1_LAND) / totalCells) * 10000)
    });
  }
}

function handleAiClearReward(winner) {
  pendingSkinUnlockNotice = "";
  if (isLocalTestMode()) return;
  if (matchMode !== "ai" || !winner || winner.landId !== P1_LAND) return;

  const notices = [];
  const difficultyNotice = markAiDifficultyCleared(aiDifficulty);
  if (difficultyNotice) notices.push(difficultyNotice);

  const baseNotice = unlockSkinReward(AI_CLEAR_REWARDS[aiDifficulty]);
  if (baseNotice) notices.push(baseNotice);

  const ghostEligibleOrder = ["hard", "superhard", "extreme", "hell", "chaos"];
  if (ghostModeEnabled && ghostEligibleOrder.includes(aiDifficulty)) {
    const ghostNotice = unlockSkinReward({
      skin: "ghost",
      labelKo: "유령 스킨",
      labelEn: "Ghost Skin"
    });
    if (ghostNotice) notices.push(ghostNotice);
  }

  if (notices.length > 0) {
    saveUnlockedSkins();
    buildLobbyPalettes();
    updateReadyUI();
  }
  pendingSkinUnlockNotice = notices.join("\n");
}

const RAINBOW_LAND_COLORS = [0xffb3ad, 0xffc98f, 0xffeda3, 0x9fe3b0, 0x9fd0ff, 0xb6bdf4, 0xd2a7e8];
const RAINBOW_ACTOR_STOPS = ["#ff3b30", "#ff9500", "#ffd60a", "#34c759", "#0a84ff", "#3348ff", "#af52de"];
const rainbowClaimCounters = { [P1_LAND]: 0, [P2_LAND]: 0 };

const SKIN_TEXTURE_CACHE = {
  actor: {},
  land: {}
};

function makeCanvasTexture(drawer, size = 256) {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  drawer(ctx, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 4;
  return texture;
}

function drawGiftActorTexture(ctx, s) {
  const g = ctx.createLinearGradient(0, 0, s, s);
  g.addColorStop(0, "#ff7898");
  g.addColorStop(0.55, "#ff2f63");
  g.addColorStop(1, "#c91644");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);

  ctx.fillStyle = "rgba(255,255,255,0.95)";
  ctx.fillRect(s * 0.43, 0, s * 0.14, s);
  ctx.fillRect(0, s * 0.43, s, s * 0.14);

  ctx.strokeStyle = "rgba(180, 18, 58, 0.42)";
  ctx.lineWidth = s * 0.035;
  ctx.strokeRect(s * 0.06, s * 0.06, s * 0.88, s * 0.88);

  ctx.fillStyle = "rgba(255,255,255,0.34)";
  ctx.beginPath();
  ctx.ellipse(s * 0.28, s * 0.23, s * 0.22, s * 0.08, -0.55, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(s * 0.72, s * 0.23, s * 0.22, s * 0.08, 0.55, 0, Math.PI * 2);
  ctx.fill();
}

function drawGiftLandTexture(ctx, s) {
  ctx.fillStyle = "#ffe1ec";
  ctx.fillRect(0, 0, s, s);
  const step = s / 4;
  for (let y = -step; y < s + step; y += step) {
    for (let x = -step; x < s + step; x += step) {
      ctx.fillStyle = "rgba(255, 47, 99, 0.20)";
      ctx.fillRect(x, y, step * 0.48, step * 0.48);
      ctx.fillStyle = "rgba(255, 255, 255, 0.62)";
      ctx.fillRect(x + step * 0.48, y, step * 0.08, step * 0.48);
      ctx.fillRect(x, y + step * 0.48, step * 0.48, step * 0.08);
    }
  }
  ctx.strokeStyle = "rgba(255, 47, 99, 0.18)";
  ctx.lineWidth = 5;
  for (let i = -s; i < s * 2; i += step) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i + s, s);
    ctx.stroke();
  }
}

function drawIceActorTexture(ctx, s) {
  const g = ctx.createLinearGradient(0, 0, s, s);
  g.addColorStop(0, "#f5feff");
  g.addColorStop(0.44, "#8ee8ff");
  g.addColorStop(1, "#2fb1df");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);

  ctx.strokeStyle = "rgba(255,255,255,0.82)";
  ctx.lineWidth = s * 0.035;
  for (let i = 0; i < 9; i++) {
    const y = (i * 31) % s;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(s, (y + s * 0.32) % s);
    ctx.stroke();
  }

  ctx.fillStyle = "rgba(255,255,255,0.38)";
  ctx.beginPath();
  ctx.moveTo(s * 0.12, s * 0.16);
  ctx.lineTo(s * 0.44, s * 0.08);
  ctx.lineTo(s * 0.26, s * 0.34);
  ctx.closePath();
  ctx.fill();
}

function drawIceLandTexture(ctx, s) {
  const g = ctx.createLinearGradient(0, 0, s, s);
  g.addColorStop(0, "#f2fdff");
  g.addColorStop(0.55, "#c8f6ff");
  g.addColorStop(1, "#8fdff4");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);

  ctx.strokeStyle = "rgba(255,255,255,0.82)";
  ctx.lineWidth = 4;
  for (let i = 0; i < 7; i++) {
    ctx.beginPath();
    ctx.moveTo((i * 43) % s, 0);
    ctx.lineTo(((i * 43) + s * 0.55) % s, s);
    ctx.stroke();
  }

  ctx.strokeStyle = "rgba(48, 169, 216, 0.24)";
  ctx.lineWidth = 3;
  for (let i = 0; i < 8; i++) {
    const x = (i * 37) % s;
    ctx.beginPath();
    ctx.moveTo(x, s * 0.18);
    ctx.lineTo((x + s * 0.32) % s, s * 0.52);
    ctx.lineTo((x + s * 0.12) % s, s * 0.84);
    ctx.stroke();
  }
}

function drawRainbowActorTexture(ctx, s) {
  const g = ctx.createLinearGradient(0, 0, s, s);
  RAINBOW_ACTOR_STOPS.forEach((color, idx) => {
    g.addColorStop(idx / (RAINBOW_ACTOR_STOPS.length - 1), color);
  });
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);

  ctx.globalAlpha = 0.35;
  ctx.fillStyle = "#ffffff";
  for (let i = -s; i < s * 2; i += s * 0.22) {
    ctx.save();
    ctx.translate(i, 0);
    ctx.rotate(-Math.PI / 8);
    ctx.fillRect(0, -s * 0.1, s * 0.075, s * 1.45);
    ctx.restore();
  }
  ctx.globalAlpha = 1;

  ctx.strokeStyle = "rgba(255,255,255,0.78)";
  ctx.lineWidth = s * 0.035;
  ctx.strokeRect(s * 0.06, s * 0.06, s * 0.88, s * 0.88);
}

function getRainbowLandColor(index) {
  return RAINBOW_LAND_COLORS[((index || 0) % RAINBOW_LAND_COLORS.length + RAINBOW_LAND_COLORS.length) % RAINBOW_LAND_COLORS.length];
}

function isRainbowColorData(colorData) {
  return !!(colorData && colorData.skin === "rainbow");
}

function getColorDataForLandId(landId) {
  if (landId === P1_LAND) return selectedColors[1];
  if (landId === P2_LAND) return matchMode === "ai" ? getAiColorData() : selectedColors[2];
  return null;
}

function getRainbowCellIndex(x, z, owner) {
  return landRainbowIndex[z] && landRainbowIndex[z][x] !== undefined && landRainbowIndex[z][x] !== null
    ? landRainbowIndex[z][x]
    : ((x + z) % RAINBOW_LAND_COLORS.length);
}

function assignRainbowIndices(owner, claimedCells) {
  const colorData = getColorDataForLandId(owner);
  if (!isRainbowColorData(colorData) || !claimedCells || !claimedCells.length) return;

  for (const cell of claimedCells) {
    if (!inBounds(cell.x, cell.z)) continue;
    if (!landRainbowIndex[cell.z]) landRainbowIndex[cell.z] = [];
    landRainbowIndex[cell.z][cell.x] = rainbowClaimCounters[owner] % RAINBOW_LAND_COLORS.length;
    rainbowClaimCounters[owner] = (rainbowClaimCounters[owner] + 1) % RAINBOW_LAND_COLORS.length;
  }
}


function drawGhostLandTexture(ctx, s) {
  // 고스트 모드 점령 영역: 요청대로 짙은 검은색 기반으로 변경
  const g = ctx.createLinearGradient(0, 0, s, s);
  g.addColorStop(0, "#2a2a2e");
  g.addColorStop(0.52, "#111113");
  g.addColorStop(1, "#020203");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);

  const haze = ctx.createRadialGradient(s * 0.32, s * 0.22, 0, s * 0.5, s * 0.5, s * 0.86);
  haze.addColorStop(0, "rgba(255,255,255,0.12)");
  haze.addColorStop(0.42, "rgba(255,255,255,0.035)");
  haze.addColorStop(1, "rgba(0,0,0,0.46)");
  ctx.fillStyle = haze;
  ctx.fillRect(0, 0, s, s);

  ctx.strokeStyle = "rgba(255,255,255,0.11)";
  ctx.lineWidth = 4;
  for (let i = -s; i < s * 2; i += s * 0.24) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.bezierCurveTo(i + s * 0.16, s * 0.28, i + s * 0.03, s * 0.62, i + s * 0.32, s);
    ctx.stroke();
  }

  ctx.strokeStyle = "rgba(255,255,255,0.18)";
  ctx.lineWidth = 3;
  ctx.strokeRect(s * 0.065, s * 0.065, s * 0.87, s * 0.87);
}
function createGhostActorObject() {
  const group = new THREE.Group();
  group.userData.skin = "ghost";

  const bodyMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.46,
    metalness: 0.01,
    transparent: true,
    opacity: 0.96
  });
  const shadowMat = new THREE.MeshStandardMaterial({
    color: 0xdfe5ef,
    roughness: 0.62,
    metalness: 0.01,
    transparent: true,
    opacity: 0.88
  });
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0x050505 });
  const blushMat = new THREE.MeshBasicMaterial({ color: 0xff9fbd, transparent: true, opacity: 0.72 });
  const mouthMat = new THREE.MeshBasicMaterial({ color: 0x050505 });
  const tongueMat = new THREE.MeshBasicMaterial({ color: 0xff9ab6 });

  // 둥글고 통통한 본체
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.40, 40, 28), bodyMat);
  head.position.y = 0.23;
  head.scale.set(1.06, 1.18, 0.98);
  group.add(head);

  const belly = new THREE.Mesh(new THREE.SphereGeometry(0.39, 40, 22), bodyMat);
  belly.position.y = -0.08;
  belly.scale.set(1.08, 0.95, 0.94);
  group.add(belly);

  const softShade = new THREE.Mesh(new THREE.SphereGeometry(0.40, 32, 18), shadowMat);
  softShade.position.set(0.04, -0.15, -0.02);
  softShade.scale.set(1.02, 0.70, 0.88);
  group.add(softShade);

  // 참고 이미지처럼 양팔을 위로 든 느낌
  const armL = new THREE.Mesh(new THREE.SphereGeometry(0.17, 22, 14), bodyMat.clone());
  armL.position.set(-0.36, 0.03, 0.02);
  armL.scale.set(0.78, 1.42, 0.70);
  armL.rotation.z = -0.54;
  group.add(armL);

  const armR = new THREE.Mesh(new THREE.SphereGeometry(0.17, 22, 14), bodyMat.clone());
  armR.position.set(0.37, 0.08, 0.02);
  armR.scale.set(0.78, 1.55, 0.70);
  armR.rotation.z = 0.62;
  group.add(armR);

  // 하단 물결 꼬리
  for (let i = 0; i < 4; i++) {
    const foot = new THREE.Mesh(new THREE.SphereGeometry(0.12, 18, 12), bodyMat.clone());
    foot.position.set((i - 1.5) * 0.18, -0.43 + (i % 2) * 0.02, 0.02);
    foot.scale.set(1.02, 0.58, 0.88);
    group.add(foot);
  }

  // 얼굴: 큰 검은 눈 + 동그란 입 + 분홍 혀
  const face = new THREE.Group();
  const eyeL = new THREE.Mesh(new THREE.SphereGeometry(0.058, 16, 10), eyeMat);
  const eyeR = new THREE.Mesh(new THREE.SphereGeometry(0.058, 16, 10), eyeMat);
  eyeL.position.set(-0.13, 0.27, 0.375);
  eyeR.position.set(0.13, 0.27, 0.375);
  face.add(eyeL, eyeR);

  const mouth = new THREE.Mesh(new THREE.SphereGeometry(0.078, 18, 12), mouthMat);
  mouth.position.set(0, 0.13, 0.388);
  mouth.scale.set(0.82, 1.24, 0.34);
  face.add(mouth);

  const tongue = new THREE.Mesh(new THREE.SphereGeometry(0.045, 16, 8), tongueMat);
  tongue.position.set(0.026, 0.095, 0.414);
  tongue.scale.set(1.05, 0.56, 0.18);
  tongue.rotation.z = -0.25;
  face.add(tongue);

  const blushL = new THREE.Mesh(new THREE.SphereGeometry(0.032, 12, 8), blushMat);
  const blushR = new THREE.Mesh(new THREE.SphereGeometry(0.032, 12, 8), blushMat);
  blushL.position.set(-0.23, 0.13, 0.374);
  blushR.position.set(0.23, 0.13, 0.374);
  blushL.scale.set(1.45, 0.55, 0.18);
  blushR.scale.set(1.45, 0.55, 0.18);
  face.add(blushL, blushR);
  group.add(face);

  const glow = new THREE.Mesh(
    new THREE.SphereGeometry(0.55, 32, 16),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.15 })
  );
  glow.scale.set(1.05, 1.08, 1.0);
  group.add(glow);

  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(0.36, 32),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.12, side: THREE.DoubleSide })
  );
  shadow.position.y = -0.51;
  shadow.rotation.x = -Math.PI / 2;
  shadow.scale.set(1.25, 0.55, 1);
  group.add(shadow);

  group.traverse(obj => { if (obj.isMesh) obj.castShadow = true; });
  return group;
}

function createKnightActorObject() {
  const group = new THREE.Group();
  group.userData.skin = "chess";

  const white = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.32, metalness: 0.08 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x111827, roughness: 0.36, metalness: 0.06 });
  const eye = new THREE.MeshBasicMaterial({ color: 0x020617 });

  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.48, 0.16, 28), dark);
  base.position.y = -0.20;
  group.add(base);

  const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.36, 0.18, 28), white);
  pedestal.position.y = -0.04;
  group.add(pedestal);

  const neck = new THREE.Mesh(new THREE.CapsuleGeometry(0.18, 0.54, 8, 20), white);
  neck.position.set(-0.02, 0.28, 0.00);
  neck.rotation.z = -0.20;
  group.add(neck);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.24, 28, 18), white);
  head.position.set(0.03, 0.68, 0.03);
  head.scale.set(0.92, 1.10, 0.72);
  group.add(head);

  const muzzle = new THREE.Mesh(new THREE.CapsuleGeometry(0.105, 0.32, 8, 16), white);
  muzzle.position.set(0.05, 0.62, 0.25);
  muzzle.rotation.x = Math.PI / 2;
  group.add(muzzle);

  const mane = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.58, 0.08), dark);
  mane.position.set(-0.11, 0.44, -0.12);
  mane.rotation.z = -0.24;
  group.add(mane);

  const earL = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.18, 4), white);
  earL.position.set(-0.08, 0.92, -0.02);
  earL.rotation.z = -0.28;
  group.add(earL);

  const earR = new THREE.Mesh(new THREE.ConeGeometry(0.065, 0.16, 4), white);
  earR.position.set(0.07, 0.90, -0.01);
  earR.rotation.z = 0.16;
  group.add(earR);

  const eyeMesh = new THREE.Mesh(new THREE.SphereGeometry(0.026, 10, 8), eye);
  eyeMesh.position.set(0.13, 0.72, 0.23);
  group.add(eyeMesh);

  const bridle = new THREE.Mesh(new THREE.TorusGeometry(0.155, 0.012, 8, 32), dark);
  bridle.position.set(0.05, 0.63, 0.20);
  bridle.rotation.x = Math.PI / 2;
  group.add(bridle);

  group.scale.set(0.92, 0.92, 0.92);
  group.rotation.y = Math.PI;
  group.traverse(obj => { if (obj.isMesh) obj.castShadow = true; });
  return group;
}

function updateKnightActorStep(actor, now) {
  if (!actor || !actor.mesh || !actor.colorData || actor.colorData.skin !== "chess") return;
  const phase = actor.landId === P1_LAND ? 0 : Math.PI;
  const bob = Math.sin(now * 0.009 + phase) * 0.018;
  actor.mesh.position.y = (actor.mesh.userData.baseY || 0.38) + bob;
  actor.mesh.rotation.y = Math.atan2(actor.dir.dx, actor.dir.dz || 0.0001);
  actor.mesh.rotation.z = Math.sin(now * 0.006 + phase) * 0.025;
}

function updateGhostActorFloat(actor, now) {
  if (!actor || !actor.mesh || !actor.colorData || actor.colorData.skin !== "ghost") return;
  const phase = actor.landId === P1_LAND ? 0 : Math.PI;
  const bob = Math.sin(now * 0.0042 + phase) * 0.085;
  const sway = Math.sin(now * 0.0025 + phase) * 0.055;
  const scaleLift = ((actor.visualScale || actor.mesh.scale.x || 1) - 1) * 0.40;
  actor.mesh.position.y = (actor.mesh.userData.baseY || 0.56) + bob + scaleLift;
  actor.mesh.rotation.z = Math.sin(now * 0.0034 + phase) * 0.08;
  actor.mesh.rotation.x = Math.sin(now * 0.0027 + phase) * 0.035;
  actor.mesh.rotation.y = Math.atan2(actor.dir.dx, actor.dir.dz || 0.0001) + sway;
}


function drawExtremeActorTexture(ctx, s) {
  const g = ctx.createRadialGradient(s * 0.28, s * 0.22, 0, s * 0.52, s * 0.56, s * 0.82);
  g.addColorStop(0, "#f3e8ff");
  g.addColorStop(0.20, "#d8b4fe");
  g.addColorStop(0.55, "#843cff");
  g.addColorStop(1, "#1a073f");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);

  ctx.globalCompositeOperation = "screen";
  ctx.strokeStyle = "rgba(255,255,255,0.62)";
  ctx.lineWidth = s * 0.035;
  for (let i = -s; i < s * 2; i += s * 0.22) {
    ctx.beginPath();
    ctx.moveTo(i, s);
    ctx.lineTo(i + s * 0.36, 0);
    ctx.stroke();
  }
  ctx.globalCompositeOperation = "source-over";

  ctx.strokeStyle = "rgba(216,180,254,0.94)";
  ctx.lineWidth = s * 0.045;
  ctx.strokeRect(s * 0.06, s * 0.06, s * 0.88, s * 0.88);
}

function drawExtremeLandTexture(ctx, s) {
  const g = ctx.createLinearGradient(0, 0, s, s);
  g.addColorStop(0, "#d8b4fe");
  g.addColorStop(0.35, "#843cff");
  g.addColorStop(0.7, "#5b21b6");
  g.addColorStop(1, "#1a073f");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);

  ctx.globalCompositeOperation = "screen";
  ctx.fillStyle = "rgba(255,255,255,0.16)";
  for (let i = 0; i < 10; i++) {
    const x = (i * 37) % s;
    const y = (i * 61) % s;
    ctx.beginPath();
    ctx.arc(x, y, s * (0.025 + (i % 3) * 0.01), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalCompositeOperation = "source-over";

  ctx.strokeStyle = "rgba(216,180,254,0.46)";
  ctx.lineWidth = s * 0.035;
  ctx.strokeRect(s * 0.055, s * 0.055, s * 0.89, s * 0.89);
}


function drawChocolateActorTexture(ctx, s) {
  const g = ctx.createLinearGradient(0, 0, s, s);
  g.addColorStop(0, "#a86434");
  g.addColorStop(0.42, "#5a2f18");
  g.addColorStop(1, "#271006");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);

  // 초콜릿 바 조각 홈
  ctx.strokeStyle = "rgba(255, 218, 175, 0.34)";
  ctx.lineWidth = s * 0.035;
  ctx.beginPath();
  ctx.moveTo(s * 0.50, s * 0.08);
  ctx.lineTo(s * 0.50, s * 0.92);
  ctx.moveTo(s * 0.08, s * 0.50);
  ctx.lineTo(s * 0.92, s * 0.50);
  ctx.stroke();

  ctx.strokeStyle = "rgba(43, 19, 9, 0.42)";
  ctx.lineWidth = s * 0.045;
  ctx.strokeRect(s * 0.08, s * 0.08, s * 0.84, s * 0.84);

  ctx.fillStyle = "rgba(255, 235, 205, 0.46)";
  ctx.beginPath();
  ctx.ellipse(s * 0.30, s * 0.24, s * 0.20, s * 0.07, -0.45, 0, Math.PI * 2);
  ctx.fill();
}

function drawChocolateLandTexture(ctx, s) {
  const g = ctx.createLinearGradient(0, 0, s, s);
  g.addColorStop(0, "#c98b55");
  g.addColorStop(0.38, "#8b4a25");
  g.addColorStop(0.74, "#5a2f18");
  g.addColorStop(1, "#2b1309");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);

  // 초콜릿 타일 패턴
  const step = s / 4;
  ctx.strokeStyle = "rgba(255, 221, 180, 0.28)";
  ctx.lineWidth = s * 0.018;
  for (let x = step; x < s; x += step) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, s);
    ctx.stroke();
  }
  for (let y = step; y < s; y += step) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(s, y);
    ctx.stroke();
  }

  ctx.fillStyle = "rgba(255, 236, 205, 0.18)";
  for (let i = 0; i < 10; i++) {
    const x = (i * 47 + 19) % s;
    const y = (i * 31 + 23) % s;
    ctx.beginPath();
    ctx.arc(x, y, s * 0.018, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.strokeStyle = "rgba(45, 18, 7, 0.30)";
  ctx.lineWidth = s * 0.04;
  ctx.strokeRect(s * 0.055, s * 0.055, s * 0.89, s * 0.89);
}

function drawChessActorTexture(ctx, s) {
  const g = ctx.createLinearGradient(0, 0, s, s);
  g.addColorStop(0, "#f8fafc");
  g.addColorStop(0.42, "#64748b");
  g.addColorStop(1, "#020617");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);

  ctx.fillStyle = "rgba(255,255,255,0.14)";
  ctx.fillRect(0, 0, s * 0.5, s * 0.5);
  ctx.fillRect(s * 0.5, s * 0.5, s * 0.5, s * 0.5);
  ctx.fillStyle = "rgba(15,23,42,0.22)";
  ctx.fillRect(s * 0.5, 0, s * 0.5, s * 0.5);
  ctx.fillRect(0, s * 0.5, s * 0.5, s * 0.5);

  ctx.save();
  ctx.translate(s * 0.5, s * 0.52);
  ctx.scale(s / 256, s / 256);
  ctx.fillStyle = "#f8fafc";
  ctx.strokeStyle = "rgba(2,6,23,0.78)";
  ctx.lineWidth = 10;
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(-58, 66);
  ctx.lineTo(58, 66);
  ctx.lineTo(48, 34);
  ctx.bezierCurveTo(38, 10, 34, -16, 18, -34);
  ctx.bezierCurveTo(2, -52, -24, -55, -45, -74);
  ctx.bezierCurveTo(-22, -86, 16, -88, 42, -62);
  ctx.bezierCurveTo(54, -50, 50, -28, 34, -20);
  ctx.bezierCurveTo(62, -3, 62, 28, 42, 44);
  ctx.lineTo(-34, 44);
  ctx.bezierCurveTo(-38, 20, -30, -6, -12, -22);
  ctx.bezierCurveTo(-34, -20, -54, -7, -66, 12);
  ctx.bezierCurveTo(-72, -12, -64, -43, -45, -74);
  ctx.stroke();
  ctx.fill();

  ctx.fillStyle = "#020617";
  ctx.beginPath();
  ctx.arc(10, -56, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.strokeStyle = "rgba(248,250,252,0.90)";
  ctx.lineWidth = s * 0.045;
  ctx.strokeRect(s * 0.06, s * 0.06, s * 0.88, s * 0.88);
  ctx.strokeStyle = "rgba(2,6,23,0.70)";
  ctx.lineWidth = s * 0.020;
  ctx.strokeRect(s * 0.115, s * 0.115, s * 0.77, s * 0.77);
}

function drawChessLandTexture(ctx, s) {
  const step = s / 4;
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 4; x++) {
      ctx.fillStyle = ((x + y) % 2 === 0) ? "#f8fafc" : "#111827";
      ctx.fillRect(x * step, y * step, step, step);
    }
  }

  ctx.fillStyle = "rgba(203,213,225,0.20)";
  ctx.fillRect(0, 0, s, s);
  ctx.strokeStyle = "rgba(2,6,23,0.34)";
  ctx.lineWidth = s * 0.018;
  for (let i = 1; i < 4; i++) {
    ctx.beginPath();
    ctx.moveTo(i * step, 0);
    ctx.lineTo(i * step, s);
    ctx.moveTo(0, i * step);
    ctx.lineTo(s, i * step);
    ctx.stroke();
  }
  ctx.strokeStyle = "rgba(248,250,252,0.48)";
  ctx.lineWidth = s * 0.04;
  ctx.strokeRect(s * 0.055, s * 0.055, s * 0.89, s * 0.89);
}

function drawHellActorTexture(ctx, s) {
  const g = ctx.createRadialGradient(s * 0.42, s * 0.34, 0, s * 0.5, s * 0.52, s * 0.82);
  g.addColorStop(0, "#ffb000");
  g.addColorStop(0.22, "#ff4b1f");
  g.addColorStop(0.58, "#510000");
  g.addColorStop(1, "#090000");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);

  ctx.globalCompositeOperation = "screen";
  ctx.strokeStyle = "rgba(255,176,0,0.62)";
  ctx.lineWidth = s * 0.045;
  for (let i = -s; i < s * 2; i += s * 0.26) {
    ctx.beginPath();
    ctx.moveTo(i, s);
    ctx.bezierCurveTo(i + s * 0.16, s * 0.68, i - s * 0.12, s * 0.32, i + s * 0.26, 0);
    ctx.stroke();
  }
  ctx.globalCompositeOperation = "source-over";

  ctx.strokeStyle = "rgba(255,176,0,0.86)";
  ctx.lineWidth = s * 0.05;
  ctx.strokeRect(s * 0.06, s * 0.06, s * 0.88, s * 0.88);
}

function drawHellLandTexture(ctx, s) {
  const g = ctx.createLinearGradient(0, 0, s, s);
  g.addColorStop(0, "#2a0000");
  g.addColorStop(0.34, "#510000");
  g.addColorStop(0.68, "#ff4b1f");
  g.addColorStop(1, "#ffb000");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);

  ctx.globalCompositeOperation = "screen";
  for (let i = 0; i < 8; i++) {
    const x = (i * 53) % s;
    const y = (i * 31) % s;
    const r = s * (0.08 + (i % 3) * 0.025);
    const lava = ctx.createRadialGradient(x, y, 0, x, y, r);
    lava.addColorStop(0, "rgba(255,176,0,0.72)");
    lava.addColorStop(0.45, "rgba(255,75,31,0.34)");
    lava.addColorStop(1, "rgba(255,75,31,0)");
    ctx.fillStyle = lava;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalCompositeOperation = "source-over";

  ctx.strokeStyle = "rgba(255,176,0,0.45)";
  ctx.lineWidth = s * 0.04;
  ctx.strokeRect(s * 0.055, s * 0.055, s * 0.89, s * 0.89);
}


function drawChaosActorTexture(ctx, s) {
  // 카오스 블럭: 체크무늬 제거, 영역보다 훨씬 진한 네온 초록/검정 대비
  const g = ctx.createLinearGradient(0, 0, s, s);
  g.addColorStop(0, "#001908");
  g.addColorStop(0.38, "#003b18");
  g.addColorStop(0.70, "#007a32");
  g.addColorStop(1, "#001104");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);

  // 어두운 내부 음영으로 영역과 확실히 분리
  const vignette = ctx.createRadialGradient(s * 0.45, s * 0.38, s * 0.08, s * 0.5, s * 0.5, s * 0.74);
  vignette.addColorStop(0, "rgba(0,255,120,0.24)");
  vignette.addColorStop(0.48, "rgba(0,90,36,0.20)");
  vignette.addColorStop(1, "rgba(0,0,0,0.72)");
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, s, s);

  ctx.globalCompositeOperation = "screen";
  // 디지털 오류 느낌의 얇은 발광 라인
  ctx.fillStyle = "rgba(0,255,120,0.32)";
  for (let i = 0; i < 10; i++) {
    const y = (i * 29 + 11) % s;
    const x = (i % 4) * s * 0.11;
    const w = s * (0.28 + (i % 3) * 0.12);
    ctx.fillRect(x, y, w, s * 0.014);
  }
  ctx.fillStyle = "rgba(255,255,255,0.30)";
  ctx.fillRect(s * 0.12, s * 0.12, s * 0.30, s * 0.055);
  ctx.fillStyle = "rgba(0,255,204,0.26)";
  ctx.fillRect(s * 0.58, s * 0.73, s * 0.26, s * 0.05);
  ctx.globalCompositeOperation = "source-over";

  ctx.strokeStyle = "rgba(0,255,120,0.96)";
  ctx.lineWidth = s * 0.06;
  ctx.strokeRect(s * 0.055, s * 0.055, s * 0.89, s * 0.89);
  ctx.strokeStyle = "rgba(0,20,8,0.88)";
  ctx.lineWidth = s * 0.026;
  ctx.strokeRect(s * 0.12, s * 0.12, s * 0.76, s * 0.76);
}

function drawChaosLandTexture(ctx, s) {
  // 카오스 영역: 체크무늬 제거, 흰색/초록색 반짝이는 디지털 오류 영역
  const g = ctx.createLinearGradient(0, 0, s, s);
  g.addColorStop(0, "#eafff0");
  g.addColorStop(0.34, "#7dffae");
  g.addColorStop(0.70, "#12e66d");
  g.addColorStop(1, "#cffff0");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);

  ctx.globalCompositeOperation = "screen";
  // 반짝이는 흰색 픽셀
  ctx.fillStyle = "rgba(255,255,255,0.58)";
  for (let i = 0; i < 16; i++) {
    const x = (i * 47 + 13) % s;
    const y = (i * 31 + 19) % s;
    const w = s * (0.028 + (i % 3) * 0.012);
    ctx.fillRect(x, y, w, w);
  }

  // 초록색 스캔라인/글리치 라인
  ctx.fillStyle = "rgba(0,255,120,0.24)";
  for (let i = 0; i < 9; i++) {
    const y = (i * 37 + 7) % s;
    ctx.fillRect(0, y, s, s * 0.012);
  }

  ctx.strokeStyle = "rgba(255,255,255,0.34)";
  ctx.lineWidth = s * 0.018;
  for (let i = -s; i < s * 2; i += s * 0.22) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i + s * 0.45, s);
    ctx.stroke();
  }
  ctx.globalCompositeOperation = "source-over";

  ctx.strokeStyle = "rgba(255,255,255,0.46)";
  ctx.lineWidth = s * 0.024;
  ctx.strokeRect(s * 0.055, s * 0.055, s * 0.89, s * 0.89);
  ctx.strokeStyle = "rgba(0,255,120,0.50)";
  ctx.lineWidth = s * 0.04;
  ctx.strokeRect(s * 0.095, s * 0.095, s * 0.81, s * 0.81);
}

function getSkinTexture(type, skin) {
  if (!skin) return null;
  const cache = SKIN_TEXTURE_CACHE[type];
  if (cache[skin]) return cache[skin];
  const drawers = {
    actor: { gift: drawGiftActorTexture, ice: drawIceActorTexture, rainbow: drawRainbowActorTexture, chocolate: drawChocolateActorTexture, chess: drawChessActorTexture, chaos: drawChaosActorTexture },
    land: { gift: drawGiftLandTexture, ice: drawIceLandTexture, chocolate: drawChocolateLandTexture, chess: drawChessLandTexture, chaos: drawChaosLandTexture, ghost: drawGhostLandTexture }
  };
  const drawer = drawers[type] && drawers[type][skin];
  if (!drawer) return null;
  cache[skin] = makeCanvasTexture(drawer);
  return cache[skin];
}

function applySkinToMaterial(mat, colorData, type) {
  const texture = getSkinTexture(type, colorData && colorData.skin);
  if (texture) {
    mat.map = texture;
    mat.color.set(0xffffff);
    mat.roughness = colorData.skin === "ice" ? 0.18 : (colorData.skin === "ghost" ? 0.64 : (colorData.skin === "hell" ? 0.42 : (colorData.skin === "chaos" ? 0.24 : (colorData.skin === "chess" ? 0.32 : (colorData.skin === "chocolate" ? 0.50 : 0.54)))));
    mat.metalness = colorData.skin === "ice" ? 0.02 : (colorData.skin === "chaos" ? 0.14 : (colorData.skin === "chess" ? 0.08 : (colorData.skin === "extreme" || colorData.skin === "hell" ? 0.08 : 0.05)));
    if (mat.emissive) {
      if (colorData.skin === "chaos") {
        mat.emissive.set(type === "actor" ? 0x003b18 : 0x00d96a);
        mat.emissiveIntensity = type === "actor" ? 0.36 : 0.34;
      } else {
        mat.emissive.set(0x000000);
        mat.emissiveIntensity = 0;
      }
    }
  } else {
    mat.map = null;
    mat.color.set(type === "actor" ? colorData.actor : colorData.landLight);
    mat.roughness = type === "actor" ? 0.38 : 0.72;
    mat.metalness = type === "actor" ? 0.06 : 0.03;
    if (mat.emissive) {
      mat.emissive.set(0x000000);
      mat.emissiveIntensity = 0;
    }
  }
  mat.needsUpdate = true;
}

let selectedColors = { 1: COLOR_CHOICES[0], 2: COLOR_CHOICES[1] };
let readyState = { 1: false, 2: false };
let lobbyReadyStartTimer = null;
let countdownIntervalTimer = null;

const AI_DIFFICULTIES = {
  easy: {
    labelKo: "이지", labelEn: "Easy", actor: 0x34c759, landLight: 0xb8f7d4, landDark: 0x168a52, line: 0x5ff0a0,
    speedBonus: 0, randomRate: 0.40, lookAhead: 1, aggression: 0.62, returnBias: 0.82,
    counterBias: 0.35, attackTrailTrigger: 8, boldTrailTrigger: 12, pressureRange: 5
  },
  normal: {
    labelKo: "노말", labelEn: "Normal", actor: 0x0a84ff, landLight: 0xaedcff, landDark: 0x1d6fae, line: 0x78d8ff,
    speedBonus: 0, randomRate: 0.18, lookAhead: 2, aggression: 1.08, returnBias: 1.03,
    counterBias: 1.15, attackTrailTrigger: 5, boldTrailTrigger: 8, pressureRange: 8
  },
  hard: {
    labelKo: "하드", labelEn: "Hard", actor: 0xff3b30, landLight: 0xffb3ac, landDark: 0xb3261e, line: 0xff7a70,
    speedBonus: 0.3, randomRate: 0.08, lookAhead: 3, aggression: 1.36, returnBias: 1.22,
    counterBias: 1.45, attackTrailTrigger: 4, boldTrailTrigger: 7, pressureRange: 9
  },
  superhard: {
    labelKo: "슈퍼하드", labelEn: "Super Hard", actor: 0xff2d95, landLight: 0xffb8dc, landDark: 0xb01866, line: 0xff76bd,
    speedBonus: 0.5, randomRate: 0.03, lookAhead: 4, aggression: 1.66, returnBias: 1.38,
    counterBias: 1.75, attackTrailTrigger: 3, boldTrailTrigger: 6, pressureRange: 10
  },
  extreme: {
    labelKo: "익스트림", labelEn: "Extreme", actor: 0x843cff, landLight: 0xb784ff, landDark: 0x5b21b6, line: 0xd8b4fe,
    speedBonus: 0.7, randomRate: 0.012, lookAhead: 5, aggression: 2.08, returnBias: 1.50,
    counterBias: 2.18, attackTrailTrigger: 2, boldTrailTrigger: 5, pressureRange: 12
  },
  hell: {
    labelKo: "지옥", labelEn: "Hell", actor: 0x2a0000, landLight: 0xff4b1f, landDark: 0x510000, line: 0xffb000,
    speedBonus: 0.9, randomRate: 0.006, lookAhead: 6, aggression: 2.34, returnBias: 1.60,
    counterBias: 2.48, attackTrailTrigger: 2, boldTrailTrigger: 4, pressureRange: 13
  },
  chaos: {
    labelKo: "카오스", labelEn: "Chaos", actor: 0x00ff78, landLight: 0x54ff9d, landDark: 0x003b1e, line: 0x00ffcc,
    speedBonus: 1.2, randomRate: 0.004, lookAhead: 7, aggression: 2.42, returnBias: 1.46,
    counterBias: 2.52, attackTrailTrigger: 2, boldTrailTrigger: 4, pressureRange: 14,
    chaosExpansion: true, farExpansionRange: 11, expansionTrailLimit: 16, expansionBias: 1.55,
    playerChaseStealBias: 2.05, playerStealPressureRange: 9
  }
};

// AI 대전 난이도별 인게임 BGM 파일명 매핑
// - 이지/노말/PVP: 기존 기본 인게임 BGM 유지
// - 하드 이상 AI 대전: 같은 폴더에 아래 wav 파일을 넣으면 자동 적용
const DEFAULT_INGAME_BGM_SRC = "audio_v1.0.0/ingame_bgm(drumX).mp3";
const GHOST_MODE_INGAME_BGM_SRC = "audio_v1.0.0/ghostmode_bgm.mp3";
const AI_INGAME_BGM_BY_DIFFICULTY = {
  easy: DEFAULT_INGAME_BGM_SRC,
  normal: DEFAULT_INGAME_BGM_SRC,
  hard: "audio_v1.0.0/ai_hard_bgm.mp3",
  superhard: "audio_v1.0.0/ai_superhard_bgm.mp3",
  extreme: "audio_v1.0.0/ai_extreme_bgm.mp3",
  hell: "audio_v1.0.0/ai_hell_bgm.mp3",
  chaos: "audio_v1.0.0/ai_chaos_bgm.mp3"
};

let currentIngameBgmSrc = DEFAULT_INGAME_BGM_SRC;

let scene, camera, renderer;
let boardGroup, actorsGroup, backgroundGridGroup, boardSeamGrid, boardTileInstances, boardTileRenderGroup, boardTileGeometry;
let cells = [];
let land = [];
let landRainbowIndex = [];
let specialBoardInstanceMeshes = [];
let boardTileBuckets = new Map();
let p1, p2;
let players = [];
const GAME_PHASE = Object.freeze({
  LOBBY: "lobby",
  COUNTDOWN: "countdown",
  PLAYING: "playing",
  PAUSED: "paused",
  ENDED: "ended"
});
let gamePhase = GAME_PHASE.LOBBY;
let gameOver = true;
let gameStarted = false;
let matchStartedAt = 0;
let matchEndedAt = 0;
let isCountingDown = false;
let keys = {};
let isDarkMode = false;
let hemiLight, dirLight;
let activeItem = null;
let activeItems = [];
let activeSummonedAiAssists = [];
let gameMode = "speed";
let matchMode = "pvp";
let aiDifficulty = "easy";
let aiDifficultyCarouselIndex = 0;
let aiRecordDifficultyIndex = -1;
let skinCarouselIndex = { 1: 0, 2: 0 };
let ghostModeEnabled = false;
let preGhostDarkMode = null;
let itemSpawnDelayTimer = null;
let itemSpawnIntervalTimer = null;
let itemSpawnSpeedupTimer = null;
let lobbyBgmEnabled = true;
let lobbyBgmStarted = false;
let ingameBgmStarted = false;
let isPaused = false;
let pauseStartedAt = 0;
let bgmVolume = parseFloat(safeLocalStorageGet("degulDegulBgmVolume", "0.42"));
if (!Number.isFinite(bgmVolume)) bgmVolume = 0.42;
bgmVolume = Math.max(0, Math.min(1, bgmVolume));
let sfxVolume = parseFloat(safeLocalStorageGet("degulDegulSfxVolume", "0.8"));
if (!Number.isFinite(sfxVolume)) sfxVolume = 0.8;
sfxVolume = Math.max(0, Math.min(1, sfxVolume));
let activeClaimGlowEffects = [];
let deathCameraFocus = null;
// 결과창 중복 호출 방지: 충돌 무승부/사망/점령 승리 중 가장 먼저 확정된 결과만 표시한다.
let gameEnding = false;
let gameResultLocked = false;
let gameResultToken = 0;

function setGamePhase(phase) {
  gamePhase = phase;
  gameStarted = phase === GAME_PHASE.PLAYING || phase === GAME_PHASE.PAUSED;
  gameOver = phase === GAME_PHASE.LOBBY || phase === GAME_PHASE.COUNTDOWN || phase === GAME_PHASE.ENDED;
  isCountingDown = phase === GAME_PHASE.COUNTDOWN;
  isPaused = phase === GAME_PHASE.PAUSED;
}

let ghostVisionCanvas = null;
let ghostVisionCtx = null;
let ghostFogTextureCanvas = null;
let ghostFogTextureCtx = null;
let ghostVisionPhase = { target: null, alpha: 0, phase: "dark" };
let ghostVisionFogDots = [];
const GHOST_VISION_CYCLE_MS = 8000;
const GHOST_VISION_SPOT_MS = 2000;
const GHOST_VISION_DARK_MS = 2000;
const GHOST_VISION_FADE_MS = 520;


const DEGUL_LANG_ORDER = ["ko", "en", "ja", "zh"];
const DEGUL_LANG_STORAGE_KEY = "degulDegulLanguage";

function detectInitialLanguage() {
  let savedLang = "";
  try {
    savedLang = safeLocalStorageGet(DEGUL_LANG_STORAGE_KEY, "");
  } catch (e) {}
  if (DEGUL_LANG_ORDER.includes(savedLang)) return savedLang;

  const browserLangs = [];
  if (Array.isArray(navigator.languages)) browserLangs.push(...navigator.languages);
  if (navigator.language) browserLangs.push(navigator.language);
  if (navigator.userLanguage) browserLangs.push(navigator.userLanguage);

  for (const rawLang of browserLangs) {
    const lang = String(rawLang || "").toLowerCase();
    if (lang.startsWith("ko")) return "ko";
    if (lang.startsWith("ja")) return "ja";
    if (lang.startsWith("zh")) return "zh";
  }

  return "en";
}

let currentLang = detectInitialLanguage();

let isMobileDevice = false;
let isMobilePhoneBlocked = false;

let forcedDeviceLayout = "";
let autoPcLayoutApplied = false;
try { localStorage.removeItem("degulDegulDeviceLayoutChoice"); } catch (e) {}

function getPhysicalDisplayResolution() {
  const dpr = Math.max(1, Number(window.devicePixelRatio) || 1);
  const screenWidth = Number(window.screen?.width) || window.innerWidth;
  const screenHeight = Number(window.screen?.height) || window.innerHeight;
  const physicalWidth = Math.round(screenWidth * dpr);
  const physicalHeight = Math.round(screenHeight * dpr);

  return {
    width: Math.max(physicalWidth, physicalHeight),
    height: Math.min(physicalWidth, physicalHeight)
  };
}

function isBelowFhdDisplay() {
  const display = getPhysicalDisplayResolution();
  return display.width < 1920 || display.height < 1080;
}

function isAtLeastFhdDisplay() {
  return !isBelowFhdDisplay();
}

function isBelowFhdViewport() {
  const width = Math.max(window.innerWidth, window.innerHeight);
  return width < 1920;
}

function syncAutoPcLayoutForLargeViewport() {
  if (!isAtLeastFhdDisplay() || isBelowFhdViewport()) {
    if (autoPcLayoutApplied && forcedDeviceLayout === "pc") {
      forcedDeviceLayout = "";
      autoPcLayoutApplied = false;
      return true;
    }
    return false;
  }
  if (forcedDeviceLayout !== "pc") {
    forcedDeviceLayout = "pc";
    autoPcLayoutApplied = true;
    return true;
  }
  return false;
}

function applyForcedDeviceLayoutClass() {
  syncAutoPcLayoutForLargeViewport();
  document.body.classList.toggle("device-layout-forced-pc", forcedDeviceLayout === "pc");
  document.body.classList.toggle("device-layout-forced-tablet", forcedDeviceLayout === "tablet");
}

function setForcedDeviceLayout(choice) {
  if (detectMobilePhoneDevice()) {
    forcedDeviceLayout = "";
    updateMobileUIState();
    return;
  }
  forcedDeviceLayout = choice === "tablet" ? "tablet" : "pc";
  autoPcLayoutApplied = false;
  applyForcedDeviceLayoutClass();

  const overlay = document.getElementById("deviceLayoutChoiceOverlay");
  if (overlay) {
    overlay.classList.remove("show");
    overlay.setAttribute("aria-hidden", "true");
  }

  updateMobileUIState();
  fitMobileLobbyToViewport();
}

function setupDeviceLayoutChoicePrompt() {
  if (document.getElementById("deviceLayoutChoiceOverlay")) {
    updateDeviceLayoutChoicePrompt();
    return;
  }

  const overlay = document.createElement("div");
  overlay.id = "deviceLayoutChoiceOverlay";
  overlay.setAttribute("aria-hidden", "true");
  overlay.innerHTML = `
    <div class="deviceLayoutChoiceCard" role="dialog" aria-modal="true" aria-labelledby="deviceLayoutChoiceTitle">
      <div class="deviceLayoutChoiceBadge" id="deviceLayoutChoiceBadge">DISPLAY SETUP</div>
      <h2 id="deviceLayoutChoiceTitle">접속 환경을 선택해주세요</h2>
      <p id="deviceLayoutChoiceText">FHD 미만 해상도에서는 먼저 PC 환경인지 태블릿 환경인지 선택한 뒤, 선택한 레이아웃으로 로비가 열립니다.</p>
      <div class="deviceLayoutChoiceButtons">
        <button type="button" class="deviceLayoutChoiceBtn" id="choosePcLayoutBtn">
          <span class="deviceLayoutChoiceIcon">🖥️</span>
          <strong id="choosePcLayoutTitle">PC 환경</strong>
          <span id="choosePcLayoutText">마우스와 키보드 기준 레이아웃</span>
        </button>
        <button type="button" class="deviceLayoutChoiceBtn" id="chooseTabletLayoutBtn">
          <span class="deviceLayoutChoiceIcon">📱</span>
          <strong id="chooseTabletLayoutTitle">태블릿 환경</strong>
          <span id="chooseTabletLayoutText">터치 조작과 태블릿 로비 레이아웃</span>
        </button>
      </div>
      <p class="deviceLayoutChoiceHint" id="deviceLayoutChoiceHint">현재 화면에 맞는 레이아웃을 적용합니다.</p>
    </div>
  `;
  document.body.appendChild(overlay);

  document.getElementById("choosePcLayoutBtn")?.addEventListener("click", () => setForcedDeviceLayout("pc"));
  document.getElementById("chooseTabletLayoutBtn")?.addEventListener("click", () => setForcedDeviceLayout("tablet"));

  updateDeviceLayoutChoicePrompt();
}

function updateDeviceLayoutChoicePrompt() {
  applyForcedDeviceLayoutClass();

  const overlay = document.getElementById("deviceLayoutChoiceOverlay");
  if (!overlay) return;

  const setText = (id, ko, en, ja, zh) => {
    const el = document.getElementById(id);
    if (el) el.textContent = currentLang === "zh" ? (zh || en) : (currentLang === "ja" ? (ja || en) : (currentLang === "en" ? en : ko));
  };

  setText("deviceLayoutChoiceBadge", "DISPLAY SETUP", "DISPLAY SETUP", "DISPLAY SETUP");
  setText("deviceLayoutChoiceTitle", "접속 환경을 선택해주세요", "Choose your display environment", "接続環境を選択してください", "请选择显示环境");
  setText(
    "deviceLayoutChoiceText",
    "FHD 미만 해상도에서는 먼저 PC 환경인지 태블릿 환경인지 선택한 뒤, 선택한 레이아웃으로 로비가 열립니다.",
    "On resolutions below FHD, choose PC or tablet first. The lobby will open with that layout.",
    "FHD未満の解像度では、まずPC環境かタブレット環境を選ぶと、そのレイアウトでロビーが開きます。",
    "在低于FHD的分辨率下，请先选择PC或平板环境，大厅将使用所选布局打开。"
  );
  setText("choosePcLayoutTitle", "PC 환경", "PC", "PC環境", "PC环境");
  setText("choosePcLayoutText", "마우스와 키보드 기준 레이아웃", "Mouse and keyboard layout", "マウスとキーボード向けレイアウト", "鼠标和键盘布局");
  setText("chooseTabletLayoutTitle", "태블릿 환경", "Tablet", "タブレット環境", "平板环境");
  setText("chooseTabletLayoutText", "터치 조작과 태블릿 로비 레이아웃", "Touch controls and tablet lobby layout", "タッチ操作とタブレット向けロビーレイアウト", "触控操作和平板大厅布局");
  setText(
    "deviceLayoutChoiceHint",
    "현재 화면에 맞는 레이아웃을 적용합니다.",
    "The layout will be applied for the current display.",
    "現在の画面に合わせたレイアウトを適用します。",
    "将应用适合当前屏幕的布局。"
  );

  const isMobilePhone = detectMobilePhoneDevice();
  const shouldAsk = !isMobilePhone
    && (isBelowFhdDisplay() || isBelowFhdViewport())
    && !forcedDeviceLayout;
  overlay.classList.toggle("show", shouldAsk);
  overlay.setAttribute("aria-hidden", shouldAsk ? "false" : "true");
}

function hasTouchInput() {
  return (navigator.maxTouchPoints && navigator.maxTouchPoints > 0) || (window.matchMedia && window.matchMedia("(pointer: coarse)").matches);
}

function getShortestScreenSide() {
  const sw = window.screen && window.screen.width ? window.screen.width : window.innerWidth;
  const sh = window.screen && window.screen.height ? window.screen.height : window.innerHeight;
  return Math.min(sw, sh, window.innerWidth, window.innerHeight);
}

function detectTabletDevice() {
  if (forcedDeviceLayout === "tablet") return true;
  if (forcedDeviceLayout === "pc") return false;
  return detectNativeTabletDevice();
}

function detectNativeTabletDevice() {
  const ua = navigator.userAgent || "";
  const uaDataReportsMobile = navigator.userAgentData?.mobile === true;
  const isIPad = /iPad/i.test(ua) || (/Macintosh/i.test(ua) && navigator.maxTouchPoints && navigator.maxTouchPoints > 1);
  const isAndroidTablet = /Android/i.test(ua) && !/Mobile/i.test(ua) && !uaDataReportsMobile;
  const largeTouchScreen = hasTouchInput()
    && !uaDataReportsMobile
    && Math.min(window.screen?.width || window.innerWidth, window.screen?.height || window.innerHeight) >= 700;
  return isIPad || isAndroidTablet || largeTouchScreen;
}

function detectMobileDevice() {
  if (forcedDeviceLayout === "tablet") return true;
  if (forcedDeviceLayout === "pc") return false;
  return navigator.userAgentData?.mobile === true
    || /Android|iPhone|iPad|iPod|Mobile|IEMobile|Opera Mini/i.test(navigator.userAgent)
    || (hasTouchInput() && Math.min(window.innerWidth, window.innerHeight) <= 900);
}

function detectMobilePhoneDevice() {
  const ua = navigator.userAgent || "";
  const explicitPhone = navigator.userAgentData?.mobile === true
    || /iPhone|iPod|IEMobile|Opera Mini/i.test(ua)
    || (/Android/i.test(ua) && /Mobile/i.test(ua));
  const shortestPhysicalSide = Math.min(
    Number(window.screen?.width) || window.innerWidth,
    Number(window.screen?.height) || window.innerHeight
  );
  const shortestViewportSide = Math.min(window.innerWidth, window.innerHeight);
  const smallTouchScreen = hasTouchInput()
    && Math.min(shortestPhysicalSide, shortestViewportSide) < 700;
  return !detectNativeTabletDevice() && (explicitPhone || smallTouchScreen);
}

function updateMobileUIState() {
  applyForcedDeviceLayoutClass();
  isMobilePhoneBlocked = detectMobilePhoneDevice();
  if (isMobilePhoneBlocked && forcedDeviceLayout) {
    forcedDeviceLayout = "";
    autoPcLayoutApplied = false;
    applyForcedDeviceLayoutClass();
  }
  updateDeviceLayoutChoicePrompt();
  const isTabletDevice = detectTabletDevice();
  isMobileDevice = detectMobileDevice();
  const isLandscape = window.innerWidth >= window.innerHeight;
  document.body.classList.toggle("tablet-device", isTabletDevice && !isMobilePhoneBlocked);
  document.body.classList.toggle("mobile-device", isMobileDevice);
  document.body.classList.toggle("mobile-landscape", isMobileDevice && isLandscape);
  document.body.classList.toggle("mobile-portrait", isMobileDevice && !isLandscape);
  document.body.classList.toggle("mobile-phone-blocked", isMobilePhoneBlocked);
  syncPerformanceLevelForCurrentDevice();

  const phoneBlockOverlay = document.getElementById("mobilePhoneBlockOverlay");
  if (phoneBlockOverlay) phoneBlockOverlay.setAttribute("aria-hidden", isMobilePhoneBlocked ? "false" : "true");
  const phoneBlockText = document.getElementById("mobilePhoneBlockText");
  if (phoneBlockText) phoneBlockText.textContent = tr("phoneRecommend");

  const notice = document.getElementById("mobileRecommendNotice");
  if (notice) notice.textContent = tr("mobileRecommend");

  const rotateOverlay = document.getElementById("mobileOrientationOverlay");
  if (rotateOverlay) rotateOverlay.setAttribute("aria-hidden", (isMobileDevice && !isMobilePhoneBlocked && !isLandscape) ? "false" : "true");
  const rotateTitle = document.getElementById("mobileRotateTitle");
  if (rotateTitle) rotateTitle.textContent = tr("rotateTitle");
  const rotateText = document.getElementById("mobileRotateText");
  if (rotateText) rotateText.textContent = tr("rotateText");

  const shouldShowControls = isMobileDevice && !isMobilePhoneBlocked && isLandscape && gameStarted && !gameOver && !isCountingDown;
  document.body.classList.toggle("mobile-controls-active", shouldShowControls);

  const layer = document.getElementById("mobileControlLayer");
  if (layer) layer.setAttribute("aria-hidden", shouldShowControls ? "false" : "true");

  if (isMobilePhoneBlocked) {
    document.documentElement.style.setProperty("--mobile-lobby-scale", "1");
    try { pauseLobbyBgm(); } catch (e) {}
    return;
  }

  fitMobileLobbyToViewport();
}

function fitMobileLobbyToViewport() {
  if (!isMobileDevice || isMobilePhoneBlocked || !document.body.classList.contains("mobile-landscape")) {
    document.documentElement.style.setProperty("--mobile-lobby-scale", "1");
    return;
  }

  const isTablet = document.body.classList.contains("tablet-device");
  if (isTablet) {
    const tabletScale = Math.max(0.1, Math.min(1,
      window.innerWidth / 1280,
      window.innerHeight / 800
    ));
    document.documentElement.style.setProperty("--mobile-lobby-scale", tabletScale.toFixed(4));
    return;
  }

  const lobby = document.getElementById("lobby");
  const card = lobby ? lobby.querySelector(".lobbyCard") : null;
  if (!card || getComputedStyle(lobby).display === "none") return;
  document.documentElement.style.setProperty("--mobile-lobby-scale", "1");
  const safeW = Math.max(320, window.innerWidth - 16);
  const safeH = Math.max(240, window.innerHeight - 10);
  const needW = Math.max(1, card.scrollWidth);
  const needH = Math.max(1, card.scrollHeight);
  const scale = Math.max(0.76, Math.min(1, safeW / needW, safeH / needH));
  document.documentElement.style.setProperty("--mobile-lobby-scale", scale.toFixed(3));
}


function setMobileVirtualKey(key, pressed) {
  if (!key) return;
  keys[key.toLowerCase()] = pressed;
  keys[key] = pressed;
}

function clearMobilePadKeys(keyMap) {
  keyMap.forEach(key => setMobileVirtualKey(key, false));
}

function setupAnalogMobilePad(pad, keyMap) {
  if (!pad || pad.dataset.analogReady === "true") return;
  pad.dataset.analogReady = "true";
  let activePointerId = null;
  let activeKey = null;

  const applyVector = (clientX, clientY) => {
    const rect = pad.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    let dx = clientX - cx;
    let dy = clientY - cy;
    const max = rect.width * 0.34;
    const dist = Math.hypot(dx, dy);
    if (dist > max) {
      dx = dx / dist * max;
      dy = dy / dist * max;
    }
    pad.style.setProperty("--joy-x", `${dx.toFixed(1)}px`);
    pad.style.setProperty("--joy-y", `${dy.toFixed(1)}px`);

    let nextKey = null;
    if (dist > rect.width * 0.13) {
      if (Math.abs(dx) >= Math.abs(dy)) nextKey = dx > 0 ? keyMap.right : keyMap.left;
      else nextKey = dy > 0 ? keyMap.down : keyMap.up;
    }

    if (nextKey !== activeKey) {
      if (activeKey) setMobileVirtualKey(activeKey, false);
      activeKey = nextKey;
      if (activeKey) setMobileVirtualKey(activeKey, true);
    }
  };

  const release = event => {
    if (event && activePointerId !== null && event.pointerId !== activePointerId) return;
    if (event) event.preventDefault();
    if (activePointerId !== null && pad.releasePointerCapture) {
      try { pad.releasePointerCapture(activePointerId); } catch (e) {}
    }
    activePointerId = null;
    if (activeKey) setMobileVirtualKey(activeKey, false);
    activeKey = null;
    pad.classList.remove("active");
    pad.style.setProperty("--joy-x", "0px");
    pad.style.setProperty("--joy-y", "0px");
    clearMobilePadKeys([keyMap.up, keyMap.left, keyMap.down, keyMap.right]);
  };

  pad.addEventListener("pointerdown", event => {
    event.preventDefault();
    tryStartLobbyBgm();
    DegulSfx.unlock();
    activePointerId = event.pointerId;
    if (pad.setPointerCapture) {
      try { pad.setPointerCapture(activePointerId); } catch (e) {}
    }
    pad.classList.add("active");
    applyVector(event.clientX, event.clientY);
  }, { passive: false });

  pad.addEventListener("pointermove", event => {
    if (activePointerId !== event.pointerId) return;
    event.preventDefault();
    applyVector(event.clientX, event.clientY);
  }, { passive: false });

  pad.addEventListener("pointerup", release, { passive: false });
  pad.addEventListener("pointercancel", release, { passive: false });
  pad.addEventListener("lostpointercapture", release, { passive: false });
}

function setupMobileControlLayer() {
  setupDeviceLayoutChoicePrompt();
  updateMobileUIState();

  setupAnalogMobilePad(document.querySelector(".mobilePadP1"), { up: "w", left: "a", down: "s", right: "d" });
  setupAnalogMobilePad(document.querySelector(".mobilePadP2"), { up: "ArrowUp", left: "ArrowLeft", down: "ArrowDown", right: "ArrowRight" });

  document.querySelectorAll("[data-mobile-key]").forEach(btn => {
    const key = btn.dataset.mobileKey;
    const press = event => {
      event.preventDefault();
      tryStartLobbyBgm();
      DegulSfx.unlock();
      setMobileVirtualKey(key, true);
      btn.classList.add("pressed");
    };
    const release = event => {
      if (event) event.preventDefault();
      setMobileVirtualKey(key, false);
      btn.classList.remove("pressed");
    };

    btn.addEventListener("pointerdown", press, { passive: false });
    btn.addEventListener("pointerup", release, { passive: false });
    btn.addEventListener("pointercancel", release, { passive: false });
    btn.addEventListener("pointerleave", release, { passive: false });
  });

  document.querySelectorAll("[data-mobile-ready]").forEach(btn => {
    btn.addEventListener("click", event => {
      event.preventDefault();
      const playerNum = Number(btn.dataset.mobileReady);
      if (!canAcceptLobbyReadyInput()) return;
      if (playerNum === 2 && matchMode === "ai") return;
      setReady(playerNum, !readyState[playerNum]);
    });
  });



  document.querySelectorAll("#p1ReadyBox, #p2ReadyBox").forEach(box => {
    const playerNum = box.id === "p1ReadyBox" ? 1 : 2;
    const toggleFromTouchCard = event => {
      if (!isMobileDevice) return;
      event.preventDefault();
      tryStartLobbyBgm();
      DegulSfx.unlock();
      if (!canAcceptLobbyReadyInput()) return;
      if (playerNum === 2 && matchMode === "ai") return;
      setReady(playerNum, !readyState[playerNum]);
    };
    box.addEventListener("click", toggleFromTouchCard, { passive: false });
    box.addEventListener("keydown", event => {
      if (event.key === "Enter" || event.key === " ") toggleFromTouchCard(event);
    });
  });

  window.addEventListener("orientationchange", () => window.setTimeout(updateMobileUIState, 180));
  window.addEventListener("resize", () => window.setTimeout(updateMobileUIState, 80));
  window.setInterval(updateMobileUIState, 300);
}


const I18N = {
  ko: {
    langButton: "EN",
    mobileRecommend: "모바일 환경에서는 PC 또는 패드로 플레이하길 권장드립니다.",
    soundOff: "🔇 BGM 꺼짐",
    soundOn: "🔊 BGM 켜기",
    soundPlaying: "🎵 로비 BGM 재생중",
    darkOn: "☀️ 라이트모드",
    darkOff: "🌙 다크모드",
    point: "점",
    leader1: "현재 우세: 1P",
    leader2: "현재 우세: 2P",
    leaderTie: "현재 우세: 동점",
    readyDone: p => `${p}P 준비 완료`,
    readyBefore: p => `${p}P 준비 전`,
    bothReady: "둘 다 준비 완료! 게임을 시작합니다.",
    p1Ready: "1P 준비 완료. 2P는 Enter 키를 눌러주세요.",
    p2Ready: "2P 준비 완료. 1P는 Ctrl 키를 눌러주세요.",
    classicMode: "스피드 모드",
    itemMode: "아이템 모드",
    ghostPlus: " + 고스트 모드",
    readyStatus: (mode, ghost) => `${mode}${ghost} 선택됨. 색상을 고르고 각자 준비하세요.`,
    speedBoost: "스피드 부스트",
    shield: "보호막",
    lineSurge: "거대화",
    win: "승리",
    draw: "무승부",
    winReason: "승리 이유",
    resultReason: "결과 이유",
    collisionDraw: "두 플레이어가 충돌했습니다. 무승부!",
    selfTrail: p => `${p}가 자기 흔적 라인을 밟았습니다.`,
    otherTrail: (a, o) => `${a}가 ${o}의 흔적 라인을 밟았습니다.`,
    landWin: p => `${p}가 맵의 60% 이상을 점령했습니다!`,
    start: "START!",
    lobbyDesc: "각 플레이어가 원하는 색상을 고른 뒤 준비하면 게임이 시작됩니다.",
    playTime: "플레이 시간",
    drawSubtitle: "두 블럭이 동시에 멈춰 승부가 갈리지 않았어요.",
    resultWinBadge: "승리",
    resultLoseBadge: "패배",
    resultDrawBadge: "무승부",
    resultCells: count => `${count}칸 점령`,
    retry: "다시하기",
    backToLobby: "로비로 돌아가기",
    aiResultName: level => `AI ${level}`,
    previousSolid: "이전 단색",
    nextSolid: "다음 단색",
    previousSkin: "이전 스킨",
    nextSkin: "다음 스킨",
    changeSolidTitle: name => `${name} · 클릭해서 변경`,
    changeSolidAria: name => `${name}. 클릭해서 단색 변경`,
    lockedSkinAria: (name, hint) => `${name} 잠김. ${hint}`,
    tapReadyCard: "준비 카드를 터치하세요",
    aiAutoReady: "AI는 자동 준비됩니다",
    pressCtrlReady: "Ctrl 키로 준비 완료",
    pressEnterReady: "Enter 키로 준비 완료",
    aiStarting: level => `AI ${level} 대전을 시작합니다.`,
    p1AiStarting: "1P 준비 완료. AI 대전을 시작합니다.",
    p1MobileReady: "1P 준비 완료. 2P 준비 카드를 터치하세요.",
    p2MobileReady: "2P 준비 완료. 1P 준비 카드를 터치하세요.",
    aiMobileReadyStatus: level => `AI ${level} 선택됨. 1P 준비 카드를 터치하세요.`,
    aiDesktopReadyStatus: level => `AI ${level} 선택됨. 1P 색상을 고르고 Ctrl로 시작하세요.`,
    mobileReadyStatus: (mode, ghost) => `${mode}${ghost} 선택됨. 준비 카드를 터치하세요.`,
    ghostDarkOnly: "고스트모드에서는 다크모드만 사용할 수 있습니다.",
    ghostDarkFixed: "👻 다크모드 고정",
    phoneRecommend: "모바일에서는 플레이할 수 없습니다. PC 또는 태블릿으로 플레이하길 권장합니다.",
    rotateTitle: "가로모드로 돌려주세요",
    rotateText: "모바일 로비는 가로 한 화면에 맞춰 최적화됩니다.",
    unmuteBgm: "BGM 음소거 해제",
    muteBgm: "BGM 음소거",
    unmuteSfx: "효과음 음소거 해제",
    muteSfx: "효과음 음소거",
    onlinePanel: "온라인 대전 보기",
    localPanel: "로컬 대전 설정 패널 보기",
    nextAiDifficulty: "다음 AI 난이도"
  },
  ja: {
    langButton: "KO",
    mobileRecommend: "モバイル環境では、PCまたはコントローラーでのプレイをおすすめします。",
    soundOff: "🔇 BGM オフ",
    soundOn: "🔊 BGM オン",
    soundPlaying: "🎵 ロビーBGM 再生中",
    darkOn: "☀️ ライトモード",
    darkOff: "🌙 ダークモード",
    point: "点",
    leader1: "優勢：1P",
    leader2: "優勢：2P",
    leaderTie: "優勢：同点",
    readyDone: p => `${p}P 準備完了`,
    readyBefore: p => `${p}P 準備前`,
    bothReady: "2人とも準備完了！ゲームを開始します。",
    p1Ready: "1Pの準備完了。2PはEnterキーを押してください。",
    p2Ready: "2Pの準備完了。1PはCtrlキーを押してください。",
    classicMode: "スピードモード",
    itemMode: "アイテムモード",
    ghostPlus: " + ゴーストモード",
    readyStatus: (mode, ghost) => `${mode}${ghost}を選択中。色を選んで準備してください。`,
    speedBoost: "スピードブースト",
    shield: "シールド",
    lineSurge: "巨大化",
    win: "勝利",
    draw: "引き分け",
    winReason: "勝利理由",
    resultReason: "結果理由",
    collisionDraw: "2人のプレイヤーが衝突しました。引き分け！",
    selfTrail: p => `${p}が自分のラインを踏みました。`,
    otherTrail: (a, o) => `${a}が${o}のラインを踏みました。`,
    landWin: p => `${p}がマップの60%以上を制圧しました！`,
    start: "START!",
    lobbyDesc: "好きな色を選んで、2人とも準備するとゲームが始まります。",
    playTime: "プレイ時間",
    drawSubtitle: "2つのブロックが同時に止まり、勝負はつきませんでした。",
    resultWinBadge: "勝利",
    resultLoseBadge: "敗北",
    resultDrawBadge: "引き分け",
    resultCells: count => `${count}マス制圧`,
    retry: "もう一度",
    backToLobby: "ロビーへ戻る",
    aiResultName: level => `AI ${level}`,
    previousSolid: "前の単色",
    nextSolid: "次の単色",
    previousSkin: "前のスキン",
    nextSkin: "次のスキン",
    changeSolidTitle: name => `${name} · クリックして変更`,
    changeSolidAria: name => `${name}。クリックして単色を変更`,
    lockedSkinAria: (name, hint) => `${name}はロック中。${hint}`,
    tapReadyCard: "準備カードをタップしてください",
    aiAutoReady: "AIは自動で準備します",
    pressCtrlReady: "Ctrlキーで準備完了",
    pressEnterReady: "Enterキーで準備完了",
    aiStarting: level => `AI ${level} 対戦を開始します。`,
    p1AiStarting: "1Pの準備完了。AI対戦を開始します。",
    p1MobileReady: "1Pの準備完了。2Pの準備カードをタップしてください。",
    p2MobileReady: "2Pの準備完了。1Pの準備カードをタップしてください。",
    aiMobileReadyStatus: level => `AI ${level}を選択中。1Pの準備カードをタップしてください。`,
    aiDesktopReadyStatus: level => `AI ${level}を選択中。1Pの色を選び、Ctrlで開始してください。`,
    mobileReadyStatus: (mode, ghost) => `${mode}${ghost}を選択中。準備カードをタップしてください。`,
    ghostDarkOnly: "ゴーストモードではダークモードのみ使用できます。",
    ghostDarkFixed: "👻 ダークモード固定",
    phoneRecommend: "スマートフォンではプレイできません。PCまたはタブレットでのプレイを推奨します。",
    rotateTitle: "横向きにしてください",
    rotateText: "モバイルロビーは横向きの1画面に最適化されています。",
    unmuteBgm: "BGMのミュートを解除",
    muteBgm: "BGMをミュート",
    unmuteSfx: "効果音のミュートを解除",
    muteSfx: "効果音をミュート",
    onlinePanel: "オンライン対戦を見る",
    localPanel: "ローカル対戦設定を表示",
    nextAiDifficulty: "次のAI難易度"
  },
  zh: {
    langButton: "🌐",
    mobileRecommend: "移动设备环境下，建议使用PC或手柄游玩。",
    soundOff: "🔇 BGM 关闭",
    soundOn: "🔊 BGM 开启",
    soundPlaying: "🎵 大厅BGM播放中",
    darkOn: "☀️ 浅色模式",
    darkOff: "🌙 深色模式",
    point: "分",
    leader1: "当前领先：1P",
    leader2: "当前领先：2P",
    leaderTie: "当前领先：平局",
    readyDone: p => `${p}P 已准备`,
    readyBefore: p => `${p}P 未准备`,
    bothReady: "双方准备完成！游戏开始。",
    p1Ready: "1P已准备。请2P按 Enter 键。",
    p2Ready: "2P已准备。请1P按 Ctrl 键。",
    classicMode: "速度模式",
    itemMode: "道具模式",
    ghostPlus: " + 幽灵模式",
    readyStatus: (mode, ghost) => `已选择${mode}${ghost}。请选择颜色并准备。`,
    speedBoost: "速度加成",
    shield: "护盾",
    lineSurge: "巨大化",
    win: "胜利",
    draw: "平局",
    winReason: "胜利原因",
    resultReason: "结果原因",
    collisionDraw: "两名玩家相撞。平局！",
    selfTrail: p => `${p}踩到了自己的轨迹线。`,
    otherTrail: (a, o) => `${a}踩到了${o}的轨迹线。`,
    landWin: p => `${p}占领了地图60%以上！`,
    start: "START!",
    lobbyDesc: "选择喜欢的颜色，双方准备后游戏开始。",
    playTime: "游戏时间",
    drawSubtitle: "两个方块同时停止，未能分出胜负。",
    resultWinBadge: "胜利",
    resultLoseBadge: "失败",
    resultDrawBadge: "平局",
    resultCells: count => `占领${count}格`,
    retry: "再来一局",
    backToLobby: "返回大厅",
    aiResultName: level => `AI ${level}`,
    previousSolid: "上一种纯色",
    nextSolid: "下一种纯色",
    previousSkin: "上一个皮肤",
    nextSkin: "下一个皮肤",
    changeSolidTitle: name => `${name} · 点击更换`,
    changeSolidAria: name => `${name}。点击更换纯色`,
    lockedSkinAria: (name, hint) => `${name}已锁定。${hint}`,
    tapReadyCard: "请点击准备卡",
    aiAutoReady: "AI会自动准备",
    pressCtrlReady: "按Ctrl准备",
    pressEnterReady: "按Enter准备",
    aiStarting: level => `开始AI ${level}对战。`,
    p1AiStarting: "1P已准备。开始AI对战。",
    p1MobileReady: "1P已准备。请点击2P准备卡。",
    p2MobileReady: "2P已准备。请点击1P准备卡。",
    aiMobileReadyStatus: level => `已选择AI ${level}。请点击1P准备卡。`,
    aiDesktopReadyStatus: level => `已选择AI ${level}。请选择1P颜色并按Ctrl开始。`,
    mobileReadyStatus: (mode, ghost) => `已选择${mode}${ghost}。请点击准备卡。`,
    ghostDarkOnly: "幽灵模式只能使用深色模式。",
    ghostDarkFixed: "👻 锁定深色模式",
    phoneRecommend: "手机无法进行游戏。建议使用PC或平板设备游玩。",
    rotateTitle: "请旋转至横屏",
    rotateText: "移动端大厅已针对横屏单页显示进行优化。",
    unmuteBgm: "取消BGM静音",
    muteBgm: "静音BGM",
    unmuteSfx: "取消音效静音",
    muteSfx: "静音音效",
    onlinePanel: "查看在线对战",
    localPanel: "查看本地对战设置",
    nextAiDifficulty: "下一个AI难度"
  },
  en: {
    langButton: "日本語",
    mobileRecommend: "For the best experience on mobile, we recommend playing on PC or with a controller.",
    soundOff: "🔇 BGM Off",
    soundOn: "🔊 BGM On",
    soundPlaying: "🎵 Lobby BGM Playing",
    darkOn: "☀️ Light Mode",
    darkOff: "🌙 Dark Mode",
    point: "pts",
    leader1: "Leading: 1P",
    leader2: "Leading: 2P",
    leaderTie: "Leading: Tie",
    readyDone: p => `${p}P Ready`,
    readyBefore: p => `${p}P Not Ready`,
    bothReady: "Both players are ready! Starting the game.",
    p1Ready: "1P is ready. 2P, press Enter.",
    p2Ready: "2P is ready. 1P, press Ctrl.",
    classicMode: "Speed Mode",
    itemMode: "Item Mode",
    ghostPlus: " + Ghost Mode",
    readyStatus: (mode, ghost) => `${mode}${ghost} selected. Pick colors and get ready.`,
    speedBoost: "Speed Boost",
    shield: "Shield",
    lineSurge: "Giant",
    win: "Wins",
    draw: "Draw",
    winReason: "Reason for Victory",
    resultReason: "Result Reason",
    collisionDraw: "Both players collided. Draw!",
    selfTrail: p => `${p} stepped on their own trail line.`,
    otherTrail: (a, o) => `${a} stepped on ${o}'s trail line.`,
    landWin: p => `${p} captured more than 60% of the map!`,
    start: "START!",
    lobbyDesc: "Choose your colors, then both players must ready up to start.",
    playTime: "Play Time",
    drawSubtitle: "Both blocks stopped at the same time, so there is no winner.",
    resultWinBadge: "Win",
    resultLoseBadge: "Lose",
    resultDrawBadge: "Draw",
    resultCells: count => `${count} tiles claimed`,
    retry: "Retry",
    backToLobby: "Back to Lobby",
    aiResultName: level => `AI ${level}`,
    previousSolid: "Previous solid color",
    nextSolid: "Next solid color",
    previousSkin: "Previous skin",
    nextSkin: "Next skin",
    changeSolidTitle: name => `${name} · Click to change`,
    changeSolidAria: name => `${name}. Click to change solid color`,
    lockedSkinAria: (name, hint) => `${name} locked. ${hint}`,
    tapReadyCard: "Tap the ready card",
    aiAutoReady: "AI readies automatically",
    pressCtrlReady: "Press Ctrl to ready",
    pressEnterReady: "Press Enter to ready",
    aiStarting: level => `Starting AI ${level} battle.`,
    p1AiStarting: "1P ready. Starting AI battle.",
    p1MobileReady: "1P ready. Tap the 2P ready card.",
    p2MobileReady: "2P ready. Tap the 1P ready card.",
    aiMobileReadyStatus: level => `AI ${level} selected. Tap the 1P ready card.`,
    aiDesktopReadyStatus: level => `AI ${level} selected. Choose a 1P color and press Ctrl to start.`,
    mobileReadyStatus: (mode, ghost) => `${mode}${ghost} selected. Tap each ready card.`,
    ghostDarkOnly: "Only Dark Mode is available in Ghost Mode.",
    ghostDarkFixed: "👻 Dark Mode Locked",
    phoneRecommend: "Playing on phones is not supported. Please use a PC or tablet.",
    rotateTitle: "Rotate to landscape",
    rotateText: "The mobile lobby is optimized for a single landscape screen.",
    unmuteBgm: "Unmute BGM",
    muteBgm: "Mute BGM",
    unmuteSfx: "Unmute SFX",
    muteSfx: "Mute SFX",
    onlinePanel: "View online battle",
    localPanel: "View local battle settings",
    nextAiDifficulty: "Next AI difficulty"
  }
};

const STATIC_TRANSLATIONS = [
  ["#ui", {
    ko: `<b>데굴데굴</b><br>\n  1P 방향전환: WASD / AI 대전 시 방향키도 가능 / 2P 방향전환: 방향키<br>\n  시작하면 블록은 자동으로 계속 굴러감<br>\n  내 땅 밖으로 나가면 흔적 라인이 생김<br>\n  다시 내 땅으로 돌아오면 둘러싼 영역 점령<br>\n  상대 라인 또는 자기 라인을 밟으면 사망<br>\n  아이템 모드: 영역확장 / 스피드 부스트 / 보호막 / 거대화 아이템 랜덤 등장<br>\n  고스트 모드: 흔적 라인이 보이지 않지만 점령/사망 판정은 유지<br>\n  R 재시작`,
    en: `<b>ROLL ROLL</b><br>\n  1P Turn: WASD / Arrow Keys also work in AI Battle / 2P Turn: Arrow Keys<br>\n  After the start, blocks roll forward automatically<br>\n  Leaving your territory creates a trail line<br>\n  Return to your territory to claim the enclosed area<br>\n  Stepping on your own or the opponent's line is fatal<br>\n  Item Mode: Area Expand / Speed Boost / Shield / Giant / Robot Vacuum items appear randomly<br>\n  Ghost Mode: Trail lines are hidden, but capture/death rules still apply<br>\n  R Restart`
  }, "html"],
  [".lobbyKicker", { ko: "2인용 territory rolling game", en: "2-player territory rolling game" }],
  [".lobbyCard > p", { ko: "각 플레이어가 원하는 색상을 고른 뒤 준비하면 게임이 시작됩니다.", en: "Choose your colors, then both players must ready up to start." }],
  ["#matchSelectWrap", { ko: "대전 방식 선택", en: "Match type selection" }, "aria-label"],
  ["#pvpModeBtn strong", { ko: "2P 대전", en: "2P Versus" }],
  ["#pvpModeBtn span", { ko: "친구와 같은 화면에서 대전", en: "Play against a friend on one screen" }],
  ["#aiModeBtn strong", { ko: "AI 대전", en: "AI Battle" }],
  ["#aiModeBtn span", { ko: "1P가 AI와 혼자 대전", en: "1P battles against AI" }],
  ["#aiDifficultyWrap", { ko: "AI 난이도 선택", en: "AI difficulty selection" }, "aria-label"],
  ["#aiDiffEasy", { ko: "이지", en: "Easy" }],
  ["#aiDiffNormal", { ko: "노말", en: "Normal" }],
  ["#aiDiffHard", { ko: "하드", en: "Hard" }],
  ["#aiDiffSuperhard", { ko: "슈퍼하드", en: "Super Hard" }],
  ["#aiDiffExtreme", { ko: "익스트림", en: "Extreme" }],
  ["#aiDiffHell", { ko: "지옥", en: "Hell" }],
  ["#aiDiffChaos", { ko: "카오스", en: "Chaos" }],
  ["#modeSelectWrap", { ko: "게임 모드 선택", en: "Game mode selection" }, "aria-label"],
  ["#ghostToggleBox", { ko: "고스트 모드: 흔적과 시야가 가려지는 혼란 모드", en: "Ghost Mode: play with trail lines hidden" }, "title"],
  ["#ghostToggleBox", { ko: "고스트 모드", en: "Ghost Mode" }, "aria-label"],
  ["#classicModeBtn strong", { ko: "스피드 모드", en: "Speed Mode" }],
  ["#classicModeBtn span", { ko: "스피드 부스트 속도가 기본인 빠른 모드", en: "A fast mode where Speed Boost speed is the default" }],
  ["#itemModeBtn strong", { ko: "아이템 모드", en: "Item Mode" }],
  ["#itemModeBtn span", { ko: "영역확장 / 스피드 / 보호막 / 거대화 / 로봇청소기 등장", en: "Area / Speed / Shield / Giant / Robot Vacuum items appear" }],
  ["#p1ReadyBox", { ko: "1P 준비 전", en: "1P Not Ready" }],
  ["#p2ReadyBox", { ko: "2P 준비 전", en: "2P Not Ready" }],
  [".playerSelectBox:nth-child(1) .readyHint", { ko: "Ctrl 키로 준비 완료", en: "Press Ctrl to ready" }],
  [".playerSelectBox:nth-child(2) .readyHint", { ko: "Enter 키로 준비 완료", en: "Press Enter to ready" }],
  ["#helpTitle", { ko: "한눈에 보는 데굴데굴 룰", en: "ROLL ROLL Rules at a Glance" }],
  [".helpHeader p", { ko: "기본 규칙을 익힌 뒤, 스피드 모드와 아이템 모드 중 원하는 방식으로 플레이하세요.", en: "Learn the basic rules, then choose Speed Mode or Item Mode to play your way." }],
  [".helpRuleCard:nth-child(1) strong", { ko: "1. 밖으로 나가면 흔적 생성", en: "1. Leave your land to create a trail" }],
  [".helpRuleCard:nth-child(1) span", { ko: "내 영역 밖으로 굴러가면 지나간 길이 라인으로 남습니다.", en: "When you roll outside your area, your path remains as a line." }],
  [".helpRuleCard:nth-child(2) strong", { ko: "2. 돌아오면 영역 점령", en: "2. Return to claim territory" }],
  [".helpRuleCard:nth-child(2) span", { ko: "흔적으로 둘러싼 공간이 내 색으로 채워집니다.", en: "The space enclosed by your trail fills with your color." }],
  [".helpRuleCard:nth-child(3) strong", { ko: "3. 자기 라인을 밟으면 위험", en: "3. Your own line is dangerous" }],
  [".helpRuleCard:nth-child(3) span", { ko: "자기 라인을 밟으면 바로 사망 판정입니다.", en: "Stepping on your own line causes instant death." }],
  [".helpRuleCard:nth-child(4) strong", { ko: "4. 더 넓게 차지하거나 상대 라인을 끊으면 승리", en: "4. Claim more area or cut the opponent line to win" }],
  [".helpRuleCard:nth-child(4) span", { ko: "상단 게이지로 점령률을 확인하고, 상대 라인을 끊어도 승리할 수 있습니다.", en: "Use the top gauge to track territory share, and you can also win by cutting the opponent line." }],
  [".helpRuleCard:nth-child(5) strong", { ko: "스피드 모드", en: "Speed Mode" }],
  [".helpRuleCard:nth-child(5) span", { ko: "아이템 없이 빠른 기본 속도로 겨루는 모드입니다. 순수한 경로 설계와 반응 속도가 중요합니다.", en: "A no-item mode with a faster base speed. Route planning and reaction speed matter most." }],
  [".helpRuleCard:nth-child(6) strong", { ko: "아이템 모드", en: "Item Mode" }],
  [".helpRuleCard:nth-child(6) span", { ko: "영역확장, 스피드 부스트, 보호막, 거대화, 로봇청소기 아이템이 등장해 역전 변수가 생깁니다.", en: "Area Expand, Speed Boost, Shield, Giant, and Robot Vacuum items create comeback chances." }],
  [".helpRuleCard:nth-child(7) strong", { ko: "고스트 모드 적용 시", en: "When Ghost Mode is On" }],
  [".helpRuleCard:nth-child(7) span", { ko: "흔적 라인이 보이지 않습니다. 하지만 돌아오면 영역은 점령되고, 자기 라인을 밟으면 사망합니다.", en: "Trail lines are hidden. But returning still claims territory, and stepping on your own line still causes death." }],
  [".helpFooterTip", { ko: "조작: 1P는 WASD, AI 대전에서는 방향키도 사용 가능합니다. 2P 대전에서는 2P가 방향키를 사용합니다. 1P 준비는 Ctrl, 2P 준비는 Enter입니다.", en: "Controls: 1P uses WASD, and Arrow Keys also work in AI Battle. In 2P Versus, 2P uses Arrow Keys. 1P readies with Ctrl, 2P with Enter." }],
  ["#countRule", { ko: "", en: "" }, "html"],
  ["#classicCountdownGuide", { ko: "스피드 모드 규칙 설명", en: "Speed Mode rule guide" }, "aria-label"],
  ["#classicCountdownGuide .classicGuideTitle strong", { ko: "스피드 모드 규칙", en: "Speed Mode Rules" }],
  ["#classicCountdownGuide .classicGuideTitle span", { ko: "아이템 없이 스피드 부스트 속도로 빠르게 영역을 넓히는 모드입니다.", en: "A no-item mode where Speed Boost speed is the default for faster territory battles." }],
  ["#classicCountdownGuide .classicGuideStep:nth-child(1) b", { ko: "1. 밖으로 나가면 흔적 생성", en: "1. Leave your land to create a trail" }],
  ["#classicCountdownGuide .classicGuideStep:nth-child(1) span", { ko: "내 영역 밖으로 굴러가면 지나간 길이 라인으로 남습니다.", en: "When you roll outside your area, your path remains as a line." }],
  ["#classicCountdownGuide .classicGuideStep:nth-child(2) b", { ko: "2. 돌아오면 영역 점령", en: "2. Return to claim territory" }],
  ["#classicCountdownGuide .classicGuideStep:nth-child(2) span", { ko: "흔적으로 둘러싼 공간이 내 색으로 채워집니다.", en: "The space enclosed by your trail fills with your color." }],
  ["#classicCountdownGuide .classicGuideStep:nth-child(3) b", { ko: "3. 자기 라인을 밟으면 위험", en: "3. Your own line is dangerous" }],
  ["#classicCountdownGuide .classicGuideStep:nth-child(3) span", { ko: "자기 라인을 밟으면 바로 사망 판정입니다.", en: "Stepping on your own line causes instant death." }],
  ["#classicCountdownGuide .classicGuideStep:nth-child(4) b", { ko: "4. 더 넓게 차지하거나 상대 라인을 끊으면 승리", en: "4. Claim more area or cut the opponent line to win" }],
  ["#classicCountdownGuide .classicGuideStep:nth-child(4) span", { ko: "상단 게이지로 점령률을 확인하고, 상대 라인을 끊어도 승리할 수 있습니다.", en: "Use the top gauge to track territory share, and you can also win by cutting the opponent line." }],
  ["#ghostCountdownGuide", { ko: "고스트 모드 규칙 설명", en: "Ghost Mode rule guide" }, "aria-label"],
  ["#ghostCountdownGuide .classicGuideTitle strong", { ko: "고스트 모드 규칙", en: "Ghost Mode Rules" }],
  ["#ghostCountdownGuide .classicGuideTitle span", { ko: "서로의 흔적과 시야가 가려져 기억과 심리전이 중요해지는 모드입니다.", en: "Trail lines are hidden, making memory and mind games important." }],
  ["#ghostCountdownGuide .classicGuideStep:nth-child(1) b", { ko: "1. 흔적은 숨김", en: "1. Trails are hidden" }],
  ["#ghostCountdownGuide .classicGuideStep:nth-child(1) span", { ko: "내 땅 밖으로 나가도 이동 경로가 화면에 표시되지 않습니다.", en: "Your path is not shown even when you leave your territory." }],
  ["#ghostCountdownGuide .classicGuideStep:nth-child(2) b", { ko: "2. 점령은 그대로", en: "2. Capturing still works" }],
  ["#ghostCountdownGuide .classicGuideStep:nth-child(2) span", { ko: "다시 내 땅으로 돌아오면 보이지 않았던 경로 기준으로 영역을 차지합니다.", en: "Return to your land to claim territory based on the hidden route." }],
  ["#ghostCountdownGuide .classicGuideStep:nth-child(3) b", { ko: "3. 판정도 그대로", en: "3. Hit rules still apply" }],
  ["#ghostCountdownGuide .classicGuideStep:nth-child(3) span", { ko: "자기 흔적이나 상대 흔적은 보이지 않아도 밟으면 사망합니다.", en: "Even invisible trails will kill you if stepped on." }],
  ["#itemCountdownGuide", { ko: "아이템 기능 설명", en: "Item guide" }, "aria-label"],
  ["#itemCountdownGuide .itemGuideCard:nth-child(1) strong", { ko: "영역확장", en: "Area Expand" }],
  ["#itemCountdownGuide .itemGuideCard:nth-child(1) span", { ko: "먹은 위치 주변을 내 영역으로 즉시 점령합니다.", en: "Instantly claims the area around the pickup spot." }],
  ["#itemCountdownGuide .itemGuideCard:nth-child(2) strong", { ko: "스피드 부스트", en: "Speed Boost" }],
  ["#itemCountdownGuide .itemGuideCard:nth-child(2) span", { ko: "2초 동안 블록이 더 빠르게 굴러갑니다.", en: "Your block rolls faster for 2 seconds." }],
  ["#itemCountdownGuide .itemGuideCard:nth-child(3) strong", { ko: "보호막", en: "Shield" }],
  ["#itemCountdownGuide .itemGuideCard:nth-child(3) span", { ko: "4초 동안 내 흔적 라인이 2칸 높이의 벽처럼 솟아납니다.", en: "For 4 seconds, your trail rises like a 2-cell-high wall." }],
  ["#itemCountdownGuide .itemGuideCard:nth-child(4) strong", { ko: "거대화", en: "Giant" }],
  ["#itemCountdownGuide .itemGuideCard:nth-child(4) span", { ko: "1.5초 동안 3×3 크기로 거대화되어 3칸씩 이동하며 지나가는 주변 3×3 영역을 즉시 내 땅으로 바꿉니다.", en: "For 1.5 seconds, grow into a 3×3 giant cube, move 3 tiles at a time, and instantly claim the surrounding 3×3 area as you move." }],
  ["#itemCountdownGuide .itemGuideCard:nth-child(5) strong", { ko: "로봇청소기", en: "Robot Vacuum" }],
  ["#itemCountdownGuide .itemGuideCard:nth-child(5) span", { ko: "3초 동안 2×2 로봇청소기를 보내 상대 영역을 지나가며 빈 영역으로 청소합니다.", en: "Deploys a 2×2 robot vacuum for 3 seconds that cleans enemy territory into empty tiles as it passes." }],
  ["#countdownControlGuide", { ko: "조작법 풀배열 키보드 안내", en: "Full keyboard controls guide" }, "aria-label"],
  ["#countdownControlGuide .controlKeyboardTitle strong", { ko: "조작법", en: "Controls" }],
  ["#countdownControlGuide .controlKeyboardTitle > div:first-child span", { ko: "풀배열 키보드에서 1P는 WASD, 2P는 방향키가 강조됩니다.", en: "On the full keyboard, WASD is highlighted for 1P and Arrow Keys for 2P." }],
  ["#tabletJoystickGuideTitle", { ko: "태블릿 조작법", en: "Tablet Controls" }],
  ["#tabletJoystickGuideText", { ko: "화면 양쪽 조이스틱을 360도로 밀어 방향을 바꿉니다.", en: "Push the joysticks on both sides in any direction to steer." }],
  ["#countdownControlGuide .playerKeyLabel:nth-child(1) b", { ko: "1P 이동", en: "1P Move" }],
  ["#countdownControlGuide .playerKeyLabel:nth-child(2) b", { ko: "2P 이동", en: "2P Move" }],
  ["#countdownControlGuide .playerKeyLabel:nth-child(2) span", { ko: "방향키 ↑ ← ↓ →", en: "Arrow Keys ↑ ← ↓ →" }],
  ["#privacyToggle", { ko: "개인정보 및 광고 안내 열기", en: "Open privacy and ads notice" }, "aria-label"],
  ["#privacyToggle", { ko: "개인정보 및 광고 안내", en: "Privacy and Ads Notice" }, "title"],
  ["#privacyBadge", { ko: "🛡 개인정보 · 광고 안내", en: "🛡 Privacy · Ads Notice" }],
  ["#privacyTitle", { ko: "개인정보 및 광고 동의 안내", en: "Privacy and Ads Consent Notice" }],
  ["#privacyIntro", { ko: "이 게임은 서비스 제공과 광고 운영을 위해 최소한의 정보를 사용할 수 있습니다. 계속 이용하려면 아래 내용을 확인해 주세요.", en: "This game may use minimal information for service operation and advertising. Please review the details below to continue." }],
  ["#privacySection1Title", { ko: "1. 수집되는 정보", en: "1. Information Used" }],
  ["#privacySection1Text", { ko: "게임 진행을 위한 로컬 저장 정보, 언어 설정, 동의 여부, 광고 제공 과정에서 생성되는 쿠키 또는 기기 식별 정보가 사용될 수 있습니다.", en: "Local game settings, language preference, consent status, and cookies or device identifiers created during ad delivery may be used." }],
  ["#privacySection2Title", { ko: "2. 이용 목적", en: "2. Purpose of Use" }],
  ["#privacySection2Text", { ko: "게임 설정 저장, 서비스 안정화, 광고 표시, 광고 성과 측정 및 부정 이용 방지를 위해 사용됩니다.", en: "Used to save game settings, stabilize the service, show ads, measure ad performance, and prevent misuse." }],
  ["#privacySection3Title", { ko: "3. 광고 및 쿠키 안내", en: "3. Ads and Cookies" }],
  ["#privacySection3Text", { ko: "Google AdSense 등 광고 서비스가 쿠키를 사용해 개인화 또는 비개인화 광고를 표시할 수 있습니다. 브라우저 설정에서 쿠키를 제한할 수 있습니다.", en: "Ad services such as Google AdSense may use cookies to show personalized or non-personalized ads. You can restrict cookies in your browser settings." }],
  ["#privacySection4Title", { ko: "4. 보관 및 관리", en: "4. Storage and Control" }],
  ["#privacySection4Text", { ko: "이 게임의 기본 설정과 동의 기록은 사용자의 브라우저에 저장됩니다. 브라우저 데이터 삭제 시 기록이 초기화될 수 있습니다.", en: "Basic game settings and consent records are stored in your browser. Clearing browser data may reset these records." }],
  ["#privacyCloseOnlyBtn", { ko: "나중에 하기", en: "Later" }],
  ["#privacyAgreeBtn", { ko: "동의하고 계속하기", en: "Agree and Continue" }],
  ["#message button", { ko: "로비로 돌아가기", en: "Back to Lobby" }]
];

function tr(key, ...args) {
  const value = (I18N[currentLang] && I18N[currentLang][key]) || I18N.ko[key] || "";
  return typeof value === "function" ? value(...args) : value;
}


function renderLobbyTitle() {
  const title = document.querySelector(".titleRollText");
  if (!title) return;

  const label = currentLang === "en" ? "ROLL ROLL" : (currentLang === "ja" ? "ゴロゴロ" : (currentLang === "zh" ? "咕噜咕噜" : "데굴데굴"));
  title.setAttribute("aria-label", label);
  title.classList.toggle("englishTitle", currentLang === "en");
  title.classList.toggle("japaneseTitle", currentLang === "ja");
  title.classList.toggle("chineseTitle", currentLang === "zh");
  title.innerHTML = "";

  Array.from(label).forEach((ch, index) => {
    const span = document.createElement("span");
    span.className = ch === " " ? "titleRollChar titleSpace" : "titleRollChar";
    span.style.setProperty("--char-index", index);
    span.textContent = ch === " " ? "\u00A0" : ch;
    title.appendChild(span);
  });
}


function updateSiteInfoLanguage() {
  const ko = currentLang !== "en";
  const setText = (selector, value) => {
    const el = document.querySelector(selector);
    if (el) el.textContent = value;
  };
  const setAttr = (selector, attr, value) => {
    const el = document.querySelector(selector);
    if (el) el.setAttribute(attr, value);
  };
  const setList = (selector, values) => {
    document.querySelectorAll(selector).forEach((el, index) => {
      if (values[index] !== undefined) el.textContent = values[index];
    });
  };
  const setCards = (panel, cards) => {
    document.querySelectorAll(`[data-site-panel="${panel}"] .siteInfoCard`).forEach((card, index) => {
      const data = cards[index];
      if (!data) return;
      const title = card.querySelector("strong");
      const body = card.querySelector("span, p");
      if (title) title.textContent = data[0];
      if (body) body.textContent = data[1];
    });
  };

  setAttr("#siteInfoToggle", "aria-label", ko ? "사이트 정보 메뉴 열기" : "Open site information menu");
  setAttr("#siteInfoToggle", "title", ko ? "사이트 정보" : "Site Info");
  setAttr("#siteInfoOverlay .siteInfoCloseButton", "aria-label", ko ? "사이트 정보 닫기" : "Close site information");
  setAttr(".siteInfoTabs", "aria-label", ko ? "사이트 정보 메뉴" : "Site information menu");
  setAttr(".lobbyFooterLinks", "aria-label", ko ? "사이트 정책 바로가기" : "Site policy links");

  setText(".siteInfoBrand strong", ko ? "데굴데굴" : "ROLL ROLL");
  setText(".siteInfoBrand span", ko
    ? "게임 소개, 조작법, 업데이트, 정책, 문의를 한곳에서 확인할 수 있습니다."
    : "Game overview, controls, updates, policies, and contact information are available here.");

  setList(".siteInfoTab", ko
    ? ["홈", "게임 소개", "조작법", "업데이트 내역", "개인정보처리방침", "이용약관", "문의하기"]
    : ["Home", "About", "Controls", "Updates", "Privacy Policy", "Terms", "Contact"]);

  setList(".lobbyFooterLinks button", ko
    ? ["개인정보처리방침", "이용약관", "문의하기"]
    : ["Privacy Policy", "Terms", "Contact"]);

  setText('[data-site-panel="home"] h2', ko ? "홈" : "Home");
  setText('[data-site-panel="home"] .siteInfoLead', ko
    ? "데굴데굴은 같은 화면에서 두 명이 영역을 차지하며 겨루는 2인용 액션 전략 게임입니다. 로비에서 모드와 색상을 선택하고 바로 플레이할 수 있습니다."
    : "ROLL ROLL is a two-player action strategy game where players compete to claim territory on the same screen. Choose a mode and colors in the lobby, then start playing right away.");
  setCards("home", ko
    ? [["게임하기","현재 화면의 로비에서 2P 대전 또는 AI 대전을 선택하고 준비하면 게임이 시작됩니다."],["지원 모드","스피드 모드, 아이템 모드, 고스트 모드, AI 대전을 제공합니다."],["목표","라인을 그어 영역을 점령하고 상대보다 더 넓은 땅을 차지하세요."],["정책 안내","광고, 쿠키, 브라우저 저장소 안내는 개인정보처리방침에서 확인할 수 있습니다."]]
    : [["Play","Select 2P Battle or AI Battle in the lobby, get ready, and the game will begin."],["Supported Modes","Speed Mode, Item Mode, Ghost Mode, and AI Battle are available."],["Goal","Draw lines, claim territory, and take more space than your opponent."],["Policy Notice","Details about ads, cookies, and browser storage are available in the Privacy Policy."]]);

  setText('[data-site-panel="about"] h2', ko ? "게임 소개" : "About the Game");
  setText('[data-site-panel="about"] .siteInfoLead', ko
    ? "블록을 굴려 자신의 영역 밖으로 나가면 이동 경로가 라인으로 남고, 다시 내 영역으로 돌아오면 둘러싼 공간이 내 색으로 채워집니다."
    : "Roll your block outside your territory to leave a trail. Return safely to your own territory to fill the enclosed area with your color.");
  setCards("about", ko
    ? [["기본 규칙","자신의 영역 밖에서 만든 라인을 안전하게 닫으면 새로운 영역을 점령합니다."],["승리 조건","더 많은 영역을 차지하거나, 상대의 라인을 끊어 승리할 수 있습니다."],["스피드 모드","빠른 템포로 진행되는 기본 경쟁 모드입니다."],["아이템 모드","영역확장, 스피드 부스트, 보호막, 거대화 등 다양한 변수를 활용합니다."],["고스트 모드","서로의 흔적과 시야가 가려져 기억력과 심리전이 더 중요해집니다."],["AI 대전","혼자서도 AI 난이도를 선택해 연습하거나 도전할 수 있습니다."]]
    : [["Basic Rule","Close the line you made outside your territory to claim new space."],["Win Condition","Win by claiming more territory or cutting your opponent’s trail."],["Speed Mode","A fast-paced basic competitive mode."],["Item Mode","Use items such as area expansion, speed boost, shield, and giant mode."],["Ghost Mode","Trails are hidden, making memory and mind games more important."],["AI Battle","Practice or challenge yourself against selectable AI difficulties."]]);

  setText('[data-site-panel="controls"] h2', ko ? "조작법" : "Controls");
  setText('[data-site-panel="controls"] .pcControlGuide .siteInfoLead', ko
    ? "PC 환경에서는 키보드로 조작합니다. 게임 시작 전 카운트다운 화면에서도 조작 키를 다시 확인할 수 있습니다."
    : "On PC, the game is controlled with the keyboard. You can also check the controls again on the countdown screen before the match starts.");
  setCards("controls", ko
    ? [["1P 이동","W A S D"],["2P 이동","방향키 ↑ ← ↓ →"],["1P 준비","Ctrl 또는 1P 준비 카드 선택"],["2P 준비","Enter 또는 2P 준비 카드 선택"],["일시정지","ESC 또는 좌측 상단 메뉴 버튼"]]
    : [["1P Move","W A S D"],["2P Move","Arrow Keys ↑ ← ↓ →"],["1P Ready","Ctrl or tap the 1P ready card"],["2P Ready","Enter or tap the 2P ready card"],["Pause","ESC or the top-left menu button"]]);
  setText('[data-site-panel="controls"] .tabletControlGuide .siteInfoLead', ko
    ? "태블릿 환경에서는 화면 양쪽의 가상 조이스틱으로 조작합니다. 왼쪽 조이스틱은 1P, 오른쪽 조이스틱은 2P 전용입니다."
    : "On tablets, use the virtual joysticks on both sides of the screen. The left joystick controls 1P, and the right joystick controls 2P.");
  setAttr(".tabletControlVisual", "aria-label", ko ? "태블릿 조작 안내 그림" : "Tablet control guide illustration");
  setText(".tabletPlayerLabel.left", ko ? "1P 조이스틱" : "1P Joystick");
  setText(".tabletPlayerLabel.right", ko ? "2P 조이스틱" : "2P Joystick");
  const tabletCards = document.querySelectorAll('[data-site-panel="controls"] .tabletControlGuide .siteInfoCard');
  (ko
    ? [["1P 이동","화면 왼쪽 조이스틱을 밀어서 이동합니다."],["2P 이동","화면 오른쪽 조이스틱을 밀어서 이동합니다."],["준비","로비에서 각 플레이어의 준비 카드를 터치합니다."],["일시정지","좌측 상단 메뉴 버튼을 터치합니다."]]
    : [["1P Move","Push the left joystick on the screen to move."],["2P Move","Push the right joystick on the screen to move."],["Ready","Tap each player’s ready card in the lobby."],["Pause","Tap the top-left menu button."]]
  ).forEach((data, index) => {
    const card = tabletCards[index];
    if (!card) return;
    const title = card.querySelector("strong");
    const body = card.querySelector("span");
    if (title) title.textContent = data[0];
    if (body) body.textContent = data[1];
  });

  setText('[data-site-panel="updates"] h2', ko ? "업데이트 내역" : "Updates");
  setText('[data-site-panel="updates"] .siteInfoLead', ko
    ? "실제 배포 버전을 기준으로 주요 기능 추가와 수정 내역을 안내합니다."
    : "Major features and fixes are listed by the actual deployed version.");
  const updateItems = document.querySelectorAll('[data-site-panel="updates"] .updateItem');
  const updateTexts = ko
    ? [["ver1.0.0",["단색 블록과 로비 미리보기에 캐릭터 눈 디자인 적용","한국어·영어·일본어·중국어 UI 번역 누락 보완","배포용 개인정보처리방침과 실제 버전 업데이트 내역 정비"]],["ver214–217",["준비 완료·결과 UI·우세 외곽선·사망 모션 사운드 추가","로봇청소기 아이템 획득 및 발동 사운드 추가","효과음 재생 시점과 중복 재생 방지 로직 개선"]],["ver200–211",["온라인 대전 패널과 로비 슬라이드 UI 추가","스킨·AI 난이도 잠금 표시와 캐러셀 UI 개선","설정창 블록형 볼륨 슬라이더와 PC·태블릿 레이아웃 개선"]]]
    : [["ver1.0.0",["Added character eyes to solid-color blocks and lobby previews","Completed missing Korean, English, Japanese, and Chinese UI translations","Prepared the deployment privacy policy and replaced the update log with actual versions"]],["ver214–217",["Added ready, result UI, dominance edge, and death-motion sounds","Added Robot Vacuum pickup and activation sounds","Improved sound timing and duplicate-play prevention"]],["ver200–211",["Added the online battle panel and lobby slider","Improved skin and AI difficulty locks and carousel UI","Added block-style volume sliders and improved PC/tablet layouts"]]];
  updateItems.forEach((item, index) => {
    const data = updateTexts[index];
    if (!data) return;
    const b = item.querySelector("b");
    if (b) b.textContent = data[0];
    item.querySelectorAll("li").forEach((li, liIndex) => {
      if (data[1][liIndex]) li.textContent = data[1][liIndex];
    });
  });

  setText('[data-site-panel="privacy"] h2', ko ? "개인정보처리방침" : "Privacy Policy");
  setText('[data-site-panel="privacy"] .siteInfoLead', ko
    ? "데굴데굴은 개인정보 보호법 등 관련 법령을 준수하며, 서비스 제공에 필요한 최소한의 정보만 처리합니다. 본 방침은 2026년 6월 21일부터 시행됩니다."
    : "ROLL ROLL follows applicable privacy laws and processes only the minimum information needed to provide the service. This policy is effective June 21, 2026.");
  setCards("privacy", ko
    ? [["처리하는 정보","회원가입이나 직접 식별정보를 요구하지 않습니다. 언어, 음량, 화면 모드, 동의 기록, AI 진행도·해금 스킨·로컬 전적이 브라우저 저장소에 저장될 수 있습니다."],["처리 목적","게임 설정 유지, 진행도와 로컬 기록 제공, 이용자 선택 기억, 서비스 오류 확인 및 안정적인 서비스 제공을 위해 사용합니다."],["보유 및 파기","브라우저 저장 정보는 이용자가 브라우저 데이터를 삭제할 때까지 보관됩니다. 사이트 데이터 또는 쿠키를 삭제하면 언제든 직접 파기할 수 있습니다."],["광고·쿠키","Google AdSense가 적용되면 Google 등 제3자 광고 사업자가 이전 방문 기록을 바탕으로 광고를 제공하기 위해 쿠키, IP 주소, 기기·브라우저 정보를 사용할 수 있습니다."],["제3자 제공·국외 처리","현재 운영자가 개인정보를 판매하거나 자체 서버에서 제3자에게 제공하지 않습니다. 향후 광고로 국외 처리가 발생하면 적용 전에 대상·목적·항목·보유기간과 거부 방법을 본 방침에 추가합니다."],["이용자의 권리","브라우저 설정에서 쿠키를 차단하거나 저장 데이터를 삭제할 수 있습니다. 광고 개인화 설정은 Google 광고 설정에서 관리할 수 있습니다."],["아동의 개인정보","이 서비스는 아동의 개인정보를 의도적으로 수집하지 않습니다. 관련 정보가 수집된 사실을 알게 되면 확인 후 삭제 조치합니다."],["문의 및 책임자","개인정보 관련 문의, 열람·삭제 요청 및 신고는 운영자 이메일 contact@deguldegul.net 으로 접수할 수 있습니다."]]
    : [["Information Processed","No account or directly identifying information is required. Language, volume, display mode, consent records, AI progress, unlocked skins, and local match records may be stored in browser storage."],["Purpose","Information is used to retain game settings, provide progress and local records, remember choices, diagnose errors, and operate the service reliably."],["Retention and Deletion","Browser data remains until the user clears it. Users can delete it at any time by clearing site data or cookies in their browser."],["Ads and Cookies","If Google AdSense is enabled, third-party advertising vendors including Google may use cookies, IP addresses, and device or browser information to serve ads based on prior visits."],["Third Parties and International Processing","The operator currently does not sell personal information or provide it from its own server to third parties. Before advertising causes international processing, this policy will identify the recipient, purpose, data, retention period, and refusal options."],["User Rights","Users can block cookies or delete stored data in browser settings. Ad personalization can be managed through Google Ads Settings."],["Children’s Privacy","The service does not intentionally collect children’s personal information. If such collection is discovered, the information will be reviewed and deleted."],["Contact and Privacy Manager","Privacy questions, access or deletion requests, and reports can be sent to the operator at contact@deguldegul.net."]]);
  setText('[data-site-panel="privacy"] .siteInfoMutedNote', ko
    ? "시행일: 2026년 6월 21일 · Google의 정보 이용 안내: policies.google.com/technologies/partner-sites · 광고 설정: adssettings.google.com · 광고 및 외부 서비스 범위가 변경되면 본 방침도 갱신합니다."
    : "Effective date: June 21, 2026 · Google partner-site information: policies.google.com/technologies/partner-sites · Ad settings: adssettings.google.com · This policy will be updated when advertising or external services change.");

  setText('[data-site-panel="terms"] h2', ko ? "이용약관" : "Terms of Use");
  setText('[data-site-panel="terms"] .siteInfoLead', ko ? "데굴데굴을 이용하기 전 아래 내용을 확인해 주세요." : "Please review the following before using ROLL ROLL.");
  setCards("terms", ko
    ? [["서비스 이용","본 게임은 무료로 제공되며, 별도의 회원가입 없이 이용할 수 있습니다."],["저장 데이터","일부 설정, 동의 여부, 플레이 기록은 사용자의 브라우저에 저장될 수 있습니다."],["서비스 변경","운영자는 기능, 디자인, 정책, 제공 방식을 필요에 따라 변경하거나 종료할 수 있습니다."],["금지 행위","서비스 방해, 코드 무단 악용, 광고 시스템 조작, 비정상적인 접근은 금지됩니다."]]
    : [["Service Use","This game is provided for free and can be used without separate membership registration."],["Stored Data","Some settings, consent status, and play records may be stored in the user’s browser."],["Service Changes","The operator may change or discontinue features, design, policies, or service methods as needed."],["Prohibited Actions","Service disruption, unauthorized code abuse, ad system manipulation, and abnormal access are prohibited."]]);

  setText('[data-site-panel="contact"] h2', ko ? "문의하기" : "Contact");
  setText('[data-site-panel="contact"] .siteInfoLead', ko
    ? "게임 오류 제보, 광고/정책 문의, 기타 의견은 아래 이메일로 보내주세요."
    : "For bug reports, ad/policy questions, or other feedback, please email the address below.");
  setText('[data-site-panel="contact"] .siteInfoMutedNote', ko
    ? "문의 시 사용 환경, 브라우저, 발생 상황을 함께 적어주면 확인에 도움이 됩니다."
    : "Including your device, browser, and what happened will help with review.");
}


function updateExtendedLanguageText() {
  const lang = currentLang;
  const setText = (selector, value) => {
    const el = document.querySelector(selector);
    if (el && value !== undefined) el.textContent = value;
  };
  const setHtml = (selector, value) => {
    const el = document.querySelector(selector);
    if (el && value !== undefined) el.innerHTML = value;
  };
  const setButtonLabel = (selector, value) => {
    const el = document.querySelector(selector);
    if (!el || value === undefined) return;
    const suffix = el.querySelector("span");
    if (el.firstChild && el.firstChild.nodeType === Node.TEXT_NODE) el.firstChild.nodeValue = value;
    else el.insertBefore(document.createTextNode(value), suffix || el.firstChild);
  };
  const setAttr = (selector, attr, value) => {
    const el = document.querySelector(selector);
    if (el && value !== undefined) el.setAttribute(attr, value);
  };
  const setList = (selector, values) => {
    document.querySelectorAll(selector).forEach((el, index) => {
      if (values[index] !== undefined) el.textContent = values[index];
    });
  };
  const setCards = (panel, cards) => {
    document.querySelectorAll(`[data-site-panel="${panel}"] .siteInfoCard`).forEach((card, index) => {
      const data = cards[index];
      if (!data) return;
      const title = card.querySelector("strong");
      const body = card.querySelector("span, p");
      if (title) title.textContent = data[0];
      if (body) body.textContent = data[1];
    });
  };

  const settingsTexts = {
    ko: {
      close: "설정 닫기", title: "설정", desc: "소리와 화면 모드를 조절할 수 있습니다.", sfx: "효과음", bgmMute: "BGM 음소거", sfxMute: "효과음 음소거",
      performance: "성능 옵션",
      pauseTitle: "일시정지", pauseDesc: "ESC 또는 메뉴 버튼으로 언제든 다시 열 수 있습니다.", resume: "계속 플레이", main: "메인화면으로 가기", volume: "음량", pauseAria: "일시정지 메뉴"
    },
    en: {
      close: "Close settings", title: "Settings", desc: "Adjust sound and display options.", sfx: "SFX", bgmMute: "Mute BGM", sfxMute: "Mute SFX",
      performance: "Performance",
      pauseTitle: "Paused", pauseDesc: "You can reopen this menu anytime with ESC or the menu button.", resume: "Continue", main: "Go to Lobby", volume: "Volume", pauseAria: "Pause menu"
    },
    ja: {
      close: "設定を閉じる", title: "設定", desc: "サウンドと画面モードを調整できます。", sfx: "効果音", bgmMute: "BGMをミュート", sfxMute: "効果音をミュート",
      performance: "パフォーマンス",
      pauseTitle: "一時停止", pauseDesc: "ESCまたはメニューボタンでいつでも開き直せます。", resume: "プレイを再開", main: "ロビーに戻る", volume: "音量", pauseAria: "一時停止メニュー"
    },
    zh: {
      close: "关闭设置", title: "设置", desc: "可以调整声音和画面模式。", sfx: "音效", bgmMute: "静音BGM", sfxMute: "静音音效",
      performance: "性能选项",
      pauseTitle: "暂停", pauseDesc: "可随时按ESC或菜单按钮重新打开。", resume: "继续游戏", main: "返回大厅", volume: "音量", pauseAria: "暂停菜单"
    }
  }[lang] || {};
  setAttr("#settingsOverlay .settingsCloseButton", "aria-label", settingsTexts.close);
  setText("#settingsTitle", settingsTexts.title);
  setText(".settingsHeader p", settingsTexts.desc);
  setText('.settingsRow.settingsAudioRow:nth-of-type(2) label', settingsTexts.sfx);
  const sfxLabel = document.querySelector('.settingsRow.settingsAudioRow:nth-of-type(2) label');
  const sfxValue = document.getElementById('settingsSfxValue');
  if (sfxLabel && sfxValue) sfxLabel.innerHTML = `${settingsTexts.sfx} <span id="settingsSfxValue">${sfxValue.textContent}</span>`;
  setAttr("#settingsBgmMute", "aria-label", settingsTexts.bgmMute);
  setAttr("#settingsSfxMute", "aria-label", settingsTexts.sfxMute);
  const performanceLabel = document.getElementById("settingsPerformanceLabel");
  const performanceValue = document.getElementById("settingsPerformanceValue");
  if (performanceLabel && performanceValue) {
    performanceLabel.innerHTML = `${settingsTexts.performance} <span id="settingsPerformanceValue">${performanceValue.textContent}</span>`;
  }
  updatePerformanceSettingsUI();
  setText("#pauseTitle", settingsTexts.pauseTitle);
  setText(".pausePanel p", settingsTexts.pauseDesc);
  setText(".pausePrimaryButton", settingsTexts.resume);
  setText(".pauseSecondaryButton", settingsTexts.main);
  setText(".pauseSliderBox label", settingsTexts.volume);
  setAttr("#pauseOverlay .pausePanel", "aria-label", settingsTexts.pauseAria);

  const commonTexts = {
    ko: {
      onlineTitle: "온라인 대전", onlineLead: "원하는 방식으로 상대와 실시간 대전을 시작하세요.", onlinePreview: "색상 선택 미리보기",
      onlineButton: "온라인 대전", onlineStatus: "원하는 방식으로 상대와 실시간 대전을 시작하세요.",
      onlineGo: "온라인 대전", onlineBack: "로컬 대전 설정 돌아가기",
      onlineAria: "온라인 대전", onlinePalette: "온라인 대전 색상 미리보기", colors: ["하늘색", "분홍색", "노란색", "민트색", "보라색", "주황색"],
      pauseOpen: "일시정지 메뉴 열기", pauseMenu: "일시정지 메뉴", helpOpen: "게임 설명 열기", helpTitle: "게임 설명",
      settingsOpen: "설정 열기", settingsTitle: "설정", helpClose: "게임 설명 닫기", privacyClose: "개인정보 안내 나중에 하기",
      gauge: "점령률 게이지", mobileActions: "모바일 액션 버튼", ready1: "1P 준비", ready2: "2P 준비", item: "아이템"
    },
    en: {
      onlineTitle: "Online Battle", onlineLead: "Choose how to start a realtime match.", onlinePreview: "Color Preview",
      onlineButton: "Online Battle", onlineStatus: "Choose how to start a realtime match.",
      onlineGo: "Online Battle", onlineBack: "Back to Local Battle",
      onlineAria: "Online battle", onlinePalette: "Online battle color preview", colors: ["Sky Blue", "Pink", "Yellow", "Mint", "Purple", "Orange"],
      pauseOpen: "Open pause menu", pauseMenu: "Pause menu", helpOpen: "Open game guide", helpTitle: "Game Guide",
      settingsOpen: "Open settings", settingsTitle: "Settings", helpClose: "Close game guide", privacyClose: "Review privacy notice later",
      gauge: "Territory gauge", mobileActions: "Mobile action buttons", ready1: "1P Ready", ready2: "2P Ready", item: "Item"
    },
    ja: {
      onlineTitle: "オンライン対戦", onlineLead: "好きな方法でリアルタイム対戦を始めましょう。", onlinePreview: "カラー選択プレビュー",
      onlineButton: "オンライン対戦", onlineStatus: "好きな方法でリアルタイム対戦を始めましょう。",
      onlineGo: "オンライン対戦", onlineBack: "ローカル対戦設定に戻る",
      onlineAria: "オンライン対戦", onlinePalette: "オンライン対戦カラープレビュー", colors: ["空色", "ピンク", "イエロー", "ミント", "パープル", "オレンジ"],
      pauseOpen: "一時停止メニューを開く", pauseMenu: "一時停止メニュー", helpOpen: "ゲーム説明を開く", helpTitle: "ゲーム説明",
      settingsOpen: "設定を開く", settingsTitle: "設定", helpClose: "ゲーム説明を閉じる", privacyClose: "プライバシー案内をあとで確認",
      gauge: "制圧率ゲージ", mobileActions: "モバイル操作ボタン", ready1: "1P準備", ready2: "2P準備", item: "アイテム"
    },
    zh: {
      onlineTitle: "在线对战", onlineLead: "选择一种方式开始实时对战。", onlinePreview: "颜色选择预览",
      onlineButton: "在线对战", onlineStatus: "选择一种方式开始实时对战。",
      onlineGo: "在线对战", onlineBack: "返回本地对战设置",
      onlineAria: "在线对战", onlinePalette: "在线对战颜色预览", colors: ["天蓝色", "粉色", "黄色", "薄荷色", "紫色", "橙色"],
      pauseOpen: "打开暂停菜单", pauseMenu: "暂停菜单", helpOpen: "打开游戏说明", helpTitle: "游戏说明",
      settingsOpen: "打开设置", settingsTitle: "设置", helpClose: "关闭游戏说明", privacyClose: "稍后查看隐私说明",
      gauge: "占领率进度条", mobileActions: "移动端操作按钮", ready1: "1P准备", ready2: "2P准备", item: "道具"
    }
  }[lang];

  setText(".onlineMatchPanel h2", commonTexts.onlineTitle);
  setText(".onlineMatchLead", commonTexts.onlineLead);
  setText(".onlineColorInfo > strong", commonTexts.onlinePreview);
  setText(".onlineMatchStartButton", commonTexts.onlineButton);
  setText("#onlineMatchStatus", commonTexts.onlineStatus);
  setText(".onlineTextGo", commonTexts.onlineGo);
  setText(".onlineTextBack", commonTexts.onlineBack);
  setAttr(".onlineMatchSlide", "aria-label", commonTexts.onlineAria);
  setAttr(".onlineColorPalette", "aria-label", commonTexts.onlinePalette);
  document.querySelectorAll(".onlineColorChip").forEach((chip, index) => {
    if (commonTexts.colors[index]) chip.setAttribute("aria-label", commonTexts.colors[index]);
  });
  const onlineArrow = document.getElementById("lobbyOnlineArrow");
  if (onlineArrow) onlineArrow.setAttribute("aria-label", onlineArrow.classList.contains("is-back") ? tr("localPanel") : tr("onlinePanel"));
  setAttr("#pauseMenuButton", "aria-label", commonTexts.pauseOpen);
  setAttr("#pauseMenuButton", "title", commonTexts.pauseMenu);
  setAttr(".scoreGaugeWrap", "aria-label", commonTexts.gauge);
  setAttr(".mobileActionStack", "aria-label", commonTexts.mobileActions);
  setButtonLabel('[data-mobile-ready="1"]', commonTexts.ready1);
  setButtonLabel('[data-mobile-ready="2"]', commonTexts.ready2);
  setButtonLabel('[data-mobile-key="shift"]', commonTexts.item);
  setAttr(".lobbyHelpButton", "aria-label", commonTexts.helpOpen);
  setAttr(".lobbyHelpButton", "title", commonTexts.helpTitle);
  setAttr("#lobbySettingsButton", "aria-label", commonTexts.settingsOpen);
  setAttr("#lobbySettingsButton", "title", commonTexts.settingsTitle);
  setAttr("#helpOverlay .helpCloseButton", "aria-label", commonTexts.helpClose);
  setAttr("#privacyOverlay .privacyCloseButton", "aria-label", commonTexts.privacyClose);


  if (lang === "zh") {
    const zhTexts = {
      ".lobbyKicker": "双人领地滚动游戏",
      ".lobbyCard > p": "选择喜欢的颜色，双方准备后游戏开始。",
      "#pvpModeBtn strong": "2P对战",
      "#pvpModeBtn span": "和朋友在同一画面中对战",
      "#aiModeBtn strong": "AI对战",
      "#aiModeBtn span": "1P单人挑战AI",
      "#aiDiffEasy": "简单",
      "#aiDiffNormal": "普通",
      "#aiDiffHard": "困难",
      "#aiDiffSuperhard": "超困难",
      "#aiDiffExtreme": "极限",
      "#aiDiffHell": "地狱",
      "#aiDiffChaos": "混沌",
      "#classicModeBtn strong": "速度模式",
      "#classicModeBtn span": "以标准高速节奏扩张领地",
      "#itemModeBtn strong": "道具模式",
      "#itemModeBtn span": "领地扩张 / 速度 / 护盾 / 巨大化 / 扫地机器人登场",
      "#p1ReadyBox": "1P 未准备",
      "#p2ReadyBox": "2P 未准备",
      ".playerSelectBox:nth-child(1) .readyHint": "按 Ctrl 准备",
      ".playerSelectBox:nth-child(2) .readyHint": "按 Enter 准备",
      "#helpTitle": "一眼看懂规则",
      ".helpHeader p": "记住基本规则后，就可以游玩速度模式或道具模式。",
      ".helpRuleCard:nth-child(1) strong": "1. 离开领地会留下轨迹线",
      ".helpRuleCard:nth-child(1) span": "滚出自己的领地后，经过的路线会成为轨迹线。",
      ".helpRuleCard:nth-child(2) strong": "2. 返回后占领区域",
      ".helpRuleCard:nth-child(2) span": "用轨迹线围住的区域会变成自己的颜色。",
      ".helpRuleCard:nth-child(3) strong": "3. 踩到自己的轨迹线很危险",
      ".helpRuleCard:nth-child(3) span": "踩到自己的轨迹线会立刻出局。",
      ".helpRuleCard:nth-child(4) strong": "4. 占更多地或切断对方轨迹即可获胜",
      ".helpRuleCard:nth-child(4) span": "通过上方进度条确认占领率，也可以切断对方轨迹获胜。",
      ".helpRuleCard:nth-child(5) strong": "速度模式",
      ".helpRuleCard:nth-child(5) span": "没有道具，以更快基础速度竞争的模式。路线选择和反应速度很重要。",
      ".helpRuleCard:nth-child(6) strong": "道具模式",
      ".helpRuleCard:nth-child(6) span": "领地扩张、速度加成、护盾、巨大化、扫地机器人会带来逆转机会。",
      ".helpRuleCard:nth-child(7) strong": "幽灵模式ON",
      ".helpRuleCard:nth-child(7) span": "轨迹线不可见，但返回时仍可占领区域，踩到自己的轨迹线仍会出局。",
      ".helpFooterTip": "操作：1P使用WASD，AI对战时也可使用方向键。2P对战中2P使用方向键。1P准备为Ctrl，2P准备为Enter。",
      "#classicCountdownGuide .classicGuideTitle strong": "速度模式规则",
      "#classicCountdownGuide .classicGuideTitle span": "没有道具，以高速扩张领地的模式。",
      "#classicCountdownGuide .classicGuideStep:nth-child(1) b": "1. 离开领地会留下轨迹线",
      "#classicCountdownGuide .classicGuideStep:nth-child(1) span": "滚出自己的领地后，经过的路线会成为轨迹线。",
      "#classicCountdownGuide .classicGuideStep:nth-child(2) b": "2. 返回后占领区域",
      "#classicCountdownGuide .classicGuideStep:nth-child(2) span": "用轨迹线围住的区域会变成自己的颜色。",
      "#classicCountdownGuide .classicGuideStep:nth-child(3) b": "3. 踩到自己的轨迹线很危险",
      "#classicCountdownGuide .classicGuideStep:nth-child(3) span": "踩到自己的轨迹线会立刻出局。",
      "#classicCountdownGuide .classicGuideStep:nth-child(4) b": "4. 占更多地或切断对方轨迹即可获胜",
      "#classicCountdownGuide .classicGuideStep:nth-child(4) span": "通过上方进度条确认占领率，也可以切断对方轨迹获胜。",
      "#ghostCountdownGuide .classicGuideTitle strong": "幽灵模式规则",
      "#ghostCountdownGuide .classicGuideTitle span": "轨迹线不可见，记忆和心理战会更重要。",
      "#ghostCountdownGuide .classicGuideStep:nth-child(1) b": "1. 轨迹线隐藏",
      "#ghostCountdownGuide .classicGuideStep:nth-child(1) span": "离开自己的领地后，移动路线不会显示在画面上。",
      "#ghostCountdownGuide .classicGuideStep:nth-child(2) b": "2. 占领规则不变",
      "#ghostCountdownGuide .classicGuideStep:nth-child(2) span": "返回自己的领地后，会根据隐藏路线占领区域。",
      "#ghostCountdownGuide .classicGuideStep:nth-child(3) b": "3. 判定也不变",
      "#ghostCountdownGuide .classicGuideStep:nth-child(3) span": "无论是自己还是对手的隐藏轨迹，踩到都会出局。",
      "#itemCountdownGuide .itemGuideCard:nth-child(1) strong": "领地扩张",
      "#itemCountdownGuide .itemGuideCard:nth-child(1) span": "立即将拾取地点周围变成自己的领地。",
      "#itemCountdownGuide .itemGuideCard:nth-child(2) strong": "速度加成",
      "#itemCountdownGuide .itemGuideCard:nth-child(2) span": "2秒内方块滚动速度提高。",
      "#itemCountdownGuide .itemGuideCard:nth-child(3) strong": "护盾",
      "#itemCountdownGuide .itemGuideCard:nth-child(3) span": "4秒内自己的轨迹线会像2格宽的墙一样升起。",
      "#itemCountdownGuide .itemGuideCard:nth-child(4) strong": "巨大化",
      "#itemCountdownGuide .itemGuideCard:nth-child(4) span": "1.5秒内变成3×3大小，每次前进3格，并立即占领周围3×3区域。",
      "#itemCountdownGuide .itemGuideCard:nth-child(5) strong": "扫地机器人",
      "#itemCountdownGuide .itemGuideCard:nth-child(5) span": "派出2×2扫地机器人3秒，经过对方领地并清理空格。",
      "#countdownControlGuide .controlKeyboardTitle strong": "操作方法",
      "#countdownControlGuide .controlKeyboardTitle > div:first-child span": "全键盘中，1P的WASD和2P的方向键会被高亮。",
      "#tabletJoystickGuideTitle": "平板操作",
      "#tabletJoystickGuideText": "将屏幕左右两侧的摇杆向360度方向推动即可改变方向。",
      "#countdownControlGuide .playerKeyLabel:nth-child(1) b": "1P移动",
      "#countdownControlGuide .playerKeyLabel:nth-child(2) b": "2P移动",
      "#countdownControlGuide .playerKeyLabel:nth-child(2) span": "方向键 ↑ ← ↓ →",
      "#privacyBadge": "🛡 隐私与广告说明",
      "#privacyTitle": "隐私与广告同意说明",
      "#privacyIntro": "本游戏可能会为提供服务和广告运营使用最少量的信息。继续前请确认以下内容。",
      "#privacySection1Title": "1. 使用的信息",
      "#privacySection1Text": "可能会使用游戏进度所需的本地保存信息、语言设置、同意状态，以及广告投放时产生的Cookie或设备识别信息。",
      "#privacySection2Title": "2. 使用目的",
      "#privacySection2Text": "用于保存游戏设置、稳定服务、显示广告、衡量广告效果以及防止异常使用。",
      "#privacySection3Title": "3. 关于广告与Cookie",
      "#privacySection3Text": "Google AdSense等广告服务可能会使用Cookie，并显示个性化或非个性化广告。Cookie可在浏览器设置中限制。",
      "#privacySection4Title": "4. 保存与管理",
      "#privacySection4Text": "本游戏的基本设置和同意记录会保存在用户浏览器中。删除浏览器数据后，记录可能会被初始化。",
      "#privacyCloseOnlyBtn": "稍后再说",
      "#privacyAgreeBtn": "同意并继续",
      "#message button": "返回大厅"
    };
    Object.entries(zhTexts).forEach(([selector, value]) => setText(selector, value));
    setHtml("#ui", `<b>滚滚方块</b><br>\n  1P转向：WASD / AI对战时也可使用方向键 / 2P转向：方向键<br>\n  开始后方块会自动持续滚动<br>\n  离开自己的领地后会留下轨迹线<br>\n  返回自己的领地后，占领被围住的区域<br>\n  踩到对手轨迹线或自己的轨迹线都会出局<br>\n  道具模式：领地扩张 / 速度加成 / 护盾 / 巨大化 / 扫地机器人随机出现<br>\n  幽灵模式：轨迹线不可见，但占领和出局判定保持不变<br>\n  R键重新开始`);

    setAttr("#matchSelectWrap", "aria-label", "选择对战方式");
    setAttr("#aiDifficultyWrap", "aria-label", "选择AI难度");
    setAttr("#modeSelectWrap", "aria-label", "选择游戏模式");
    setAttr("#ghostToggleBox", "title", "幽灵模式：隐藏轨迹线进行游玩");
    setAttr("#ghostToggleBox", "aria-label", "幽灵模式");
    setAttr("#classicCountdownGuide", "aria-label", "速度模式规则说明");
    setAttr("#ghostCountdownGuide", "aria-label", "幽灵模式规则说明");
    setAttr("#itemCountdownGuide", "aria-label", "道具说明");
    setAttr("#countdownControlGuide", "aria-label", "全键盘操作指南");
    setAttr("#privacyToggle", "aria-label", "打开隐私与广告说明");
    setAttr("#privacyToggle", "title", "隐私与广告说明");

    setAttr("#siteInfoToggle", "aria-label", "打开网站信息菜单");
    setAttr("#siteInfoToggle", "title", "网站信息");
    setAttr("#siteInfoOverlay .siteInfoCloseButton", "aria-label", "关闭网站信息");
    setAttr(".siteInfoTabs", "aria-label", "网站信息菜单");
    setAttr(".lobbyFooterLinks", "aria-label", "网站政策链接");
    setText(".siteInfoBrand strong", "滚滚方块");
    setText(".siteInfoBrand span", "可在这里查看游戏介绍、操作方法、更新记录、政策和联系方式。");
    setList(".siteInfoTab", ["首页", "游戏介绍", "操作方法", "更新记录", "隐私政策", "使用条款", "联系我们"]);
    setList(".lobbyFooterLinks button", ["隐私政策", "使用条款", "联系我们"]);

    setText('[data-site-panel="home"] h2', "首页");
    setText('[data-site-panel="home"] .siteInfoLead', "滚滚方块是一款双人动作策略游戏，玩家在同一画面中争夺领地。在大厅选择模式和颜色后即可开始游玩。");
    setCards("home", [["开始游戏", "在当前大厅选择2P对战或AI对战，准备完成后游戏开始。"], ["支持模式", "支持速度模式、道具模式、幽灵模式和AI对战。"], ["目标", "画出轨迹线占领区域，争取比对手获得更大的领地。"], ["政策说明", "广告、Cookie和浏览器存储相关内容可在隐私政策中查看。"]]);
    setText('[data-site-panel="about"] h2', "游戏介绍");
    setText('[data-site-panel="about"] .siteInfoLead', "滚动方块离开自己的领地后，移动路线会变成轨迹线；再次回到自己的领地时，被围住的区域会变成自己的颜色。");
    setCards("about", [["基本规则", "在自己的领地外安全闭合轨迹线，就能占领新的区域。"], ["胜利条件", "占领更多区域，或切断对手的轨迹线即可获胜。"], ["速度模式", "节奏更快的基础对战模式。"], ["道具模式", "利用领地扩张、速度加成、护盾、巨大化等变化创造机会。"], ["幽灵模式", "轨迹线不可见，因此记忆力和心理战更加重要。"], ["AI对战", "单人也可以选择AI难度进行练习或挑战。"]]);
    setText('[data-site-panel="controls"] h2', "操作方法");
    setText('[data-site-panel="controls"] .pcControlGuide .siteInfoLead', "PC环境下使用键盘操作。游戏开始前的倒计时画面也会再次显示操作键。");
    setCards("controls", [["1P移动", "W A S D"], ["2P移动", "方向键 ↑ ← ↓ →"], ["1P准备", "Ctrl 或选择1P准备卡"], ["2P准备", "Enter 或选择2P准备卡"], ["暂停", "ESC 或左上角菜单按钮"]]);
    setText('[data-site-panel="controls"] .tabletControlGuide .siteInfoLead', "平板环境下使用屏幕左右两侧的虚拟摇杆操作。左侧摇杆控制1P，右侧摇杆控制2P。");
    setText(".tabletPlayerLabel.left", "1P摇杆");
    setText(".tabletPlayerLabel.right", "2P摇杆");
    const tabletCards = document.querySelectorAll('[data-site-panel="controls"] .tabletControlGuide .siteInfoCard');
    [["1P移动", "推动屏幕左侧摇杆移动。"], ["2P移动", "推动屏幕右侧摇杆移动。"], ["准备", "在大厅点击各玩家的准备卡。"], ["暂停", "点击左上角菜单按钮。"]].forEach((data, index) => {
      const card = tabletCards[index];
      if (!card) return;
      const title = card.querySelector("strong");
      const body = card.querySelector("span");
      if (title) title.textContent = data[0];
      if (body) body.textContent = data[1];
    });
    setText('[data-site-panel="updates"] h2', "更新记录");
    setText('[data-site-panel="updates"] .siteInfoLead', "按实际发布版本说明主要功能和修复内容。");
    document.querySelectorAll('[data-site-panel="updates"] .updateItem').forEach((item, index) => {
      const data = [["ver1.0.0", ["为纯色方块和大厅预览添加角色眼睛设计", "补全韩语、英语、日语和中文UI翻译", "完善发布用隐私政策并将更新记录改为实际版本"]], ["ver214–217", ["新增准备完成、结果UI、领先边框和死亡动作音效", "新增扫地机器人拾取与启动音效", "优化音效触发时机和防重复播放逻辑"]], ["ver200–211", ["新增在线对战准备面板和大厅滑动UI", "优化皮肤与AI难度锁定标记及轮播UI", "新增方块式音量滑块并优化PC与平板布局"]]][index];
      if (!data) return;
      const b = item.querySelector("b");
      if (b) b.textContent = data[0];
      item.querySelectorAll("li").forEach((li, liIndex) => { if (data[1][liIndex]) li.textContent = data[1][liIndex]; });
    });
    setText('[data-site-panel="privacy"] h2', "隐私政策");
    setText('[data-site-panel="privacy"] .siteInfoLead', "滚滚方块遵守适用的隐私法律，仅处理提供服务所需的最少信息。本政策自2026年6月21日起生效。");
    setCards("privacy", [["处理的信息", "无需注册账号或提供直接身份信息。语言、音量、显示模式、同意记录、AI进度、已解锁皮肤和本地对战记录可能保存在浏览器存储中。"], ["处理目的", "用于保留游戏设置、提供进度和本地记录、记住用户选择、排查错误并稳定提供服务。"], ["保存与删除", "浏览器数据会保留到用户主动清除为止。用户可随时通过浏览器删除网站数据或Cookie。"], ["广告与Cookie", "启用Google AdSense后，包括Google在内的第三方广告服务商可能使用Cookie、IP地址及设备或浏览器信息，根据用户以往的访问记录投放广告。"], ["第三方与境外处理", "运营者目前不会出售个人信息，也不会通过自有服务器向第三方提供信息。今后如广告导致境外处理，将在启用前补充接收方、目的、信息项目、保存期限和拒绝方式。"], ["用户权利", "用户可以在浏览器设置中阻止Cookie或删除保存的数据，并可通过Google广告设置管理广告个性化。"], ["儿童隐私", "本服务不会故意收集儿童个人信息。如发现相关信息，将进行确认并删除。"], ["联系与隐私负责人", "隐私咨询、访问或删除请求及举报可发送至运营者邮箱 contact@deguldegul.net。"]]);
    setText('[data-site-panel="privacy"] .siteInfoMutedNote', "生效日期：2026年6月21日 · Google合作网站信息：policies.google.com/technologies/partner-sites · 广告设置：adssettings.google.com · 广告或外部服务发生变化时将更新本政策。");
    setText('[data-site-panel="terms"] h2', "使用条款");
    setText('[data-site-panel="terms"] .siteInfoLead', "使用滚滚方块前，请确认以下内容。");
    setCards("terms", [["服务使用", "本游戏免费提供，无需注册会员即可使用。"], ["保存数据", "部分设置、同意状态和游玩记录可能会保存到用户浏览器中。"], ["服务变更", "运营者可根据需要变更或终止功能、设计、政策和提供方式。"], ["禁止行为", "禁止干扰服务、非法利用代码、操纵广告系统和异常访问。"]]);
    setText('[data-site-panel="contact"] h2', "联系我们");
    setText('[data-site-panel="contact"] .siteInfoLead', "游戏错误反馈、广告/政策咨询或其他意见，请发送至以下邮箱。");
    setText('[data-site-panel="contact"] .siteInfoMutedNote', "咨询时请一并填写使用环境、浏览器和发生情况，以便更快确认。");
    return;
  }

  if (lang !== "ja") return;

  const jaTexts = {
    ".lobbyKicker": "2人用テリトリーローリングゲーム",
    ".lobbyCard > p": "好きな色を選んで、2人とも準備するとゲームが始まります。",
    "#pvpModeBtn strong": "2P対戦",
    "#pvpModeBtn span": "友だちと同じ画面で対戦",
    "#aiModeBtn strong": "AI対戦",
    "#aiModeBtn span": "1PがAIと1人で対戦",
    "#aiDiffEasy": "イージー",
    "#aiDiffNormal": "ノーマル",
    "#aiDiffHard": "ハード",
    "#aiDiffSuperhard": "スーパーハード",
    "#aiDiffExtreme": "エクストリーム",
    "#aiDiffHell": "ヘル",
    "#aiDiffChaos": "カオス",
    "#classicModeBtn strong": "スピードモード",
    "#classicModeBtn span": "スピードブースト速度が標準の高速モード",
    "#itemModeBtn strong": "アイテムモード",
    "#itemModeBtn span": "エリア拡張 / スピード / シールド / 巨大化 / ロボット掃除機が登場",
    "#p1ReadyBox": "1P 準備前",
    "#p2ReadyBox": "2P 準備前",
    ".playerSelectBox:nth-child(1) .readyHint": "Ctrlキーで準備完了",
    ".playerSelectBox:nth-child(2) .readyHint": "Enterキーで準備完了",
    "#helpTitle": "ひと目でわかるルール",
    ".helpHeader p": "基本ルールを覚えたら、スピードモードまたはアイテムモードで遊びましょう。",
    ".helpRuleCard:nth-child(1) strong": "1. 外に出るとラインができる",
    ".helpRuleCard:nth-child(1) span": "自分のエリアの外へ転がると、通った道がラインとして残ります。",
    ".helpRuleCard:nth-child(2) strong": "2. 戻るとエリアを制圧",
    ".helpRuleCard:nth-child(2) span": "ラインで囲んだ空間が自分の色で塗られます。",
    ".helpRuleCard:nth-child(3) strong": "3. 自分のラインを踏むと危険",
    ".helpRuleCard:nth-child(3) span": "自分のラインを踏むと即アウトです。",
    ".helpRuleCard:nth-child(4) strong": "4. 広く取るか相手のラインを切れば勝利",
    ".helpRuleCard:nth-child(4) span": "上部ゲージで制圧率を確認しながら、相手のラインを切って勝つこともできます。",
    ".helpRuleCard:nth-child(5) strong": "スピードモード",
    ".helpRuleCard:nth-child(5) span": "アイテムなしで、速い基本速度で競うモードです。ルート取りと反応速度が重要です。",
    ".helpRuleCard:nth-child(6) strong": "アイテムモード",
    ".helpRuleCard:nth-child(6) span": "エリア拡張、スピードブースト、シールド、巨大化、ロボット掃除機で逆転のチャンスが生まれます。",
    ".helpRuleCard:nth-child(7) strong": "ゴーストモードON",
    ".helpRuleCard:nth-child(7) span": "ラインは見えません。ただし戻ればエリアを制圧でき、自分のラインを踏むとアウトです。",
    ".helpFooterTip": "操作：1PはWASD、AI対戦では方向キーも使えます。2P対戦では2Pが方向キーを使います。1P準備はCtrl、2P準備はEnterです。",
    "#classicCountdownGuide .classicGuideTitle strong": "スピードモードのルール",
    "#classicCountdownGuide .classicGuideTitle span": "アイテムなしで高速にエリアを広げるモードです。",
    "#classicCountdownGuide .classicGuideStep:nth-child(1) b": "1. 外に出るとラインができる",
    "#classicCountdownGuide .classicGuideStep:nth-child(1) span": "自分のエリアの外へ転がると、通った道がラインとして残ります。",
    "#classicCountdownGuide .classicGuideStep:nth-child(2) b": "2. 戻るとエリアを制圧",
    "#classicCountdownGuide .classicGuideStep:nth-child(2) span": "ラインで囲んだ空間が自分の色で塗られます。",
    "#classicCountdownGuide .classicGuideStep:nth-child(3) b": "3. 自分のラインを踏むと危険",
    "#classicCountdownGuide .classicGuideStep:nth-child(3) span": "自分のラインを踏むと即アウトです。",
    "#classicCountdownGuide .classicGuideStep:nth-child(4) b": "4. 広く取るか相手のラインを切れば勝利",
    "#classicCountdownGuide .classicGuideStep:nth-child(4) span": "上部ゲージで制圧率を確認しながら、相手のラインを切って勝つこともできます。",
    "#ghostCountdownGuide .classicGuideTitle strong": "ゴーストモードのルール",
    "#ghostCountdownGuide .classicGuideTitle span": "ラインが見えないため、記憶と駆け引きが重要になるモードです。",
    "#ghostCountdownGuide .classicGuideStep:nth-child(1) b": "1. ラインは非表示",
    "#ghostCountdownGuide .classicGuideStep:nth-child(1) span": "自分のエリア外に出ても、移動ルートは画面に表示されません。",
    "#ghostCountdownGuide .classicGuideStep:nth-child(2) b": "2. 制圧はそのまま",
    "#ghostCountdownGuide .classicGuideStep:nth-child(2) span": "自分のエリアに戻ると、見えなかったルートを基準にエリアを取ります。",
    "#ghostCountdownGuide .classicGuideStep:nth-child(3) b": "3. 判定もそのまま",
    "#ghostCountdownGuide .classicGuideStep:nth-child(3) span": "自分や相手の見えないラインも、踏むとアウトになります。",
    "#itemCountdownGuide .itemGuideCard:nth-child(1) strong": "エリア拡張",
    "#itemCountdownGuide .itemGuideCard:nth-child(1) span": "取った場所の周囲をすぐに自分のエリアにします。",
    "#itemCountdownGuide .itemGuideCard:nth-child(2) strong": "スピードブースト",
    "#itemCountdownGuide .itemGuideCard:nth-child(2) span": "2秒間、ブロックがより速く転がります。",
    "#itemCountdownGuide .itemGuideCard:nth-child(3) strong": "シールド",
    "#itemCountdownGuide .itemGuideCard:nth-child(3) span": "4秒間、自分のラインが2マス分の壁のように立ち上がります。",
    "#itemCountdownGuide .itemGuideCard:nth-child(4) strong": "巨大化",
    "#itemCountdownGuide .itemGuideCard:nth-child(4) span": "1.5秒間3×3サイズになり、3マスずつ進みながら周囲の3×3エリアをすぐに自分のものにします。",
    "#itemCountdownGuide .itemGuideCard:nth-child(5) strong": "ロボット掃除機",
    "#itemCountdownGuide .itemGuideCard:nth-child(5) span": "3秒間2×2のロボット掃除機を送り、相手エリアを通りながら空きマスに掃除します。",
    "#countdownControlGuide .controlKeyboardTitle strong": "操作方法",
    "#countdownControlGuide .controlKeyboardTitle > div:first-child span": "フルキーボードでは、1PはWASD、2Pは方向キーが強調表示されます。",
    "#tabletJoystickGuideTitle": "タブレット操作",
    "#tabletJoystickGuideText": "画面左右のジョイスティックを360度に倒して方向を変えます。",
    "#countdownControlGuide .playerKeyLabel:nth-child(1) b": "1P移動",
    "#countdownControlGuide .playerKeyLabel:nth-child(2) b": "2P移動",
    "#countdownControlGuide .playerKeyLabel:nth-child(2) span": "方向キー ↑ ← ↓ →",
    "#privacyBadge": "🛡 プライバシー・広告について",
    "#privacyTitle": "プライバシーおよび広告同意のご案内",
    "#privacyIntro": "このゲームでは、サービス提供と広告運用のために最小限の情報を使用する場合があります。続けるには以下をご確認ください。",
    "#privacySection1Title": "1. 使用される情報",
    "#privacySection1Text": "ゲーム進行のためのローカル保存情報、言語設定、同意状況、広告配信時に生成されるCookieまたは端末識別情報が使用される場合があります。",
    "#privacySection2Title": "2. 利用目的",
    "#privacySection2Text": "ゲーム設定の保存、サービスの安定化、広告表示、広告効果測定、不正利用防止のために使用されます。",
    "#privacySection3Title": "3. 広告とCookieについて",
    "#privacySection3Text": "Google AdSenseなどの広告サービスがCookieを使用し、パーソナライズ広告または非パーソナライズ広告を表示する場合があります。Cookieはブラウザ設定で制限できます。",
    "#privacySection4Title": "4. 保存と管理",
    "#privacySection4Text": "このゲームの基本設定と同意記録は、利用者のブラウザに保存されます。ブラウザデータを削除すると記録が初期化される場合があります。",
    "#privacyCloseOnlyBtn": "あとで",
    "#privacyAgreeBtn": "同意して続ける",
    "#message button": "ロビーに戻る"
  };
  Object.entries(jaTexts).forEach(([selector, value]) => setText(selector, value));
  setHtml("#ui", `<b>デグルデグル</b><br>\n  1P方向転換：WASD / AI対戦では方向キーも使用可能 / 2P方向転換：方向キー<br>\n  開始するとブロックは自動で転がり続けます<br>\n  自分のエリア外へ出るとラインができます<br>\n  自分のエリアに戻ると、囲んだ場所を制圧します<br>\n  相手のラインまたは自分のラインを踏むとアウトです<br>\n  アイテムモード：エリア拡張 / スピードブースト / シールド / 巨大化 / ロボット掃除機がランダムに出現<br>\n  ゴーストモード：ラインは見えませんが、制圧とアウト判定はそのままです<br>\n  Rでリスタート`);

  setAttr("#matchSelectWrap", "aria-label", "対戦方式の選択");
  setAttr("#aiDifficultyWrap", "aria-label", "AI難易度の選択");
  setAttr("#modeSelectWrap", "aria-label", "ゲームモードの選択");
  setAttr("#ghostToggleBox", "title", "ゴーストモード：ラインを隠した状態でプレイ");
  setAttr("#ghostToggleBox", "aria-label", "ゴーストモード");
  setAttr("#classicCountdownGuide", "aria-label", "スピードモードのルール説明");
  setAttr("#ghostCountdownGuide", "aria-label", "ゴーストモードのルール説明");
  setAttr("#itemCountdownGuide", "aria-label", "アイテム説明");
  setAttr("#countdownControlGuide", "aria-label", "フルキーボード操作ガイド");
  setAttr("#privacyToggle", "aria-label", "プライバシーと広告案内を開く");
  setAttr("#privacyToggle", "title", "プライバシーと広告のご案内");

  setAttr("#siteInfoToggle", "aria-label", "サイト情報メニューを開く");
  setAttr("#siteInfoToggle", "title", "サイト情報");
  setAttr("#siteInfoOverlay .siteInfoCloseButton", "aria-label", "サイト情報を閉じる");
  setAttr(".siteInfoTabs", "aria-label", "サイト情報メニュー");
  setAttr(".lobbyFooterLinks", "aria-label", "サイトポリシーへのリンク");
  setText(".siteInfoBrand strong", "デグルデグル");
  setText(".siteInfoBrand span", "ゲーム紹介、操作方法、更新情報、ポリシー、お問い合わせをまとめて確認できます。");
  setList(".siteInfoTab", ["ホーム", "ゲーム紹介", "操作方法", "更新情報", "プライバシーポリシー", "利用規約", "お問い合わせ"]);
  setList(".lobbyFooterLinks button", ["プライバシーポリシー", "利用規約", "お問い合わせ"]);

  setText('[data-site-panel="home"] h2', "ホーム");
  setText('[data-site-panel="home"] .siteInfoLead', "デグルデグルは、同じ画面で2人がエリアを取り合う2人用アクション戦略ゲームです。ロビーでモードと色を選び、すぐにプレイできます。");
  setCards("home", [["ゲームを遊ぶ", "現在のロビーで2P対戦またはAI対戦を選び、準備するとゲームが始まります。"], ["対応モード", "スピードモード、アイテムモード、ゴーストモード、AI対戦に対応しています。"], ["目標", "ラインを引いてエリアを制圧し、相手より広い領地を取りましょう。"], ["ポリシー案内", "広告、Cookie、ブラウザ保存についてはプライバシーポリシーで確認できます。"]]);
  setText('[data-site-panel="about"] h2', "ゲーム紹介");
  setText('[data-site-panel="about"] .siteInfoLead', "ブロックを転がして自分のエリア外へ出ると移動ルートがラインになり、再び自分のエリアに戻ると囲んだ空間が自分の色で塗られます。");
  setCards("about", [["基本ルール", "自分のエリア外で作ったラインを安全に閉じると、新しいエリアを制圧できます。"], ["勝利条件", "より多くのエリアを取るか、相手のラインを切ると勝利できます。"], ["スピードモード", "テンポよく進む基本の対戦モードです。"], ["アイテムモード", "エリア拡張、スピードブースト、シールド、巨大化などの変化を活用します。"], ["ゴーストモード", "ラインが見えないため、記憶力と駆け引きがより重要になります。"], ["AI対戦", "1人でもAI難易度を選んで練習や挑戦ができます。"]]);
  setText('[data-site-panel="controls"] h2', "操作方法");
  setText('[data-site-panel="controls"] .pcControlGuide .siteInfoLead', "PC環境ではキーボードで操作します。ゲーム開始前のカウントダウン画面でも操作キーを確認できます。");
  setCards("controls", [["1P移動", "W A S D"], ["2P移動", "方向キー ↑ ← ↓ →"], ["1P準備", "Ctrlまたは1P準備カードを選択"], ["2P準備", "Enterまたは2P準備カードを選択"], ["一時停止", "ESCまたは左上のメニューボタン"]]);
  setText('[data-site-panel="controls"] .tabletControlGuide .siteInfoLead', "タブレット環境では、画面左右のバーチャルジョイスティックで操作します。左のジョイスティックは1P、右のジョイスティックは2P専用です。");
  setText(".tabletPlayerLabel.left", "1Pジョイスティック");
  setText(".tabletPlayerLabel.right", "2Pジョイスティック");
  const tabletCards = document.querySelectorAll('[data-site-panel="controls"] .tabletControlGuide .siteInfoCard');
  [["1P移動", "画面左側のジョイスティックを倒して移動します。"], ["2P移動", "画面右側のジョイスティックを倒して移動します。"], ["準備", "ロビーで各プレイヤーの準備カードをタップします。"], ["一時停止", "左上のメニューボタンをタップします。"]].forEach((data, index) => {
    const card = tabletCards[index];
    if (!card) return;
    const title = card.querySelector("strong");
    const body = card.querySelector("span");
    if (title) title.textContent = data[0];
    if (body) body.textContent = data[1];
  });
  setText('[data-site-panel="updates"] h2', "更新情報");
  setText('[data-site-panel="updates"] .siteInfoLead', "実際の配布バージョンに基づいて、主な機能追加と修正内容を案内します。");
  document.querySelectorAll('[data-site-panel="updates"] .updateItem').forEach((item, index) => {
    const data = [["ver1.0.0", ["単色ブロックとロビープレビューにキャラクターの目を追加", "韓国語・英語・日本語・中国語UIの翻訳漏れを補完", "配布用プライバシーポリシーを整備し、更新履歴を実際のバージョンに変更"]], ["ver214–217", ["準備完了・結果UI・優勢エッジ・死亡モーションのサウンドを追加", "ロボット掃除機の取得音と発動音を追加", "効果音の再生タイミングと重複防止ロジックを改善"]], ["ver200–211", ["オンライン対戦準備パネルとロビースライドUIを追加", "スキン・AI難易度のロック表示とカルーセルUIを改善", "ブロック型音量スライダーとPC・タブレットレイアウトを改善"]]][index];
    if (!data) return;
    const b = item.querySelector("b");
    if (b) b.textContent = data[0];
    item.querySelectorAll("li").forEach((li, liIndex) => { if (data[1][liIndex]) li.textContent = data[1][liIndex]; });
  });
  setText('[data-site-panel="privacy"] h2', "プライバシーポリシー");
  setText('[data-site-panel="privacy"] .siteInfoLead', "デグルデグルは適用されるプライバシー法令を遵守し、サービス提供に必要な最小限の情報のみを取り扱います。本方針は2026年6月21日から施行します。");
  setCards("privacy", [["取り扱う情報", "会員登録や直接識別情報は要求しません。言語、音量、画面モード、同意記録、AI進行度、解放スキン、ローカル対戦記録がブラウザ保存領域に保存される場合があります。"], ["利用目的", "ゲーム設定の維持、進行度とローカル記録の提供、利用者の選択の記憶、エラー確認、安定したサービス提供のために使用します。"], ["保存期間と削除", "ブラウザデータは利用者が削除するまで保存されます。ブラウザのサイトデータまたはCookieを削除することで、いつでも消去できます。"], ["広告とCookie", "Google AdSenseを有効にした場合、Googleを含む第三者広告事業者が、過去の訪問履歴に基づく広告配信のためにCookie、IPアドレス、端末・ブラウザ情報を使用する場合があります。"], ["第三者・国外処理", "運営者は現在、個人情報を販売せず、独自サーバーから第三者へ提供しません。今後広告により国外処理が発生する場合は、開始前に受領者、目的、情報項目、保存期間、拒否方法を本方針へ追加します。"], ["利用者の権利", "ブラウザ設定でCookieを拒否したり保存データを削除できます。広告のパーソナライズはGoogle広告設定で管理できます。"], ["子どものプライバシー", "本サービスは子どもの個人情報を意図的に収集しません。収集の事実を把握した場合は確認後に削除します。"], ["お問い合わせ・管理責任者", "プライバシーに関する質問、閲覧・削除依頼、申告は運営者メール contact@deguldegul.net で受け付けます。"]]);
  setText('[data-site-panel="privacy"] .siteInfoMutedNote', "施行日：2026年6月21日 · Googleパートナーサイト情報：policies.google.com/technologies/partner-sites · 広告設定：adssettings.google.com · 広告や外部サービスの利用範囲が変わった場合は本方針を更新します。");
  setText('[data-site-panel="terms"] h2', "利用規約");
  setText('[data-site-panel="terms"] .siteInfoLead', "デグルデグルを利用する前に、以下の内容をご確認ください。");
  setCards("terms", [["サービス利用", "本ゲームは無料で提供され、会員登録なしで利用できます。"], ["保存データ", "一部の設定、同意状況、プレイ記録は利用者のブラウザに保存される場合があります。"], ["サービス変更", "運営者は必要に応じて、機能、デザイン、ポリシー、提供方法を変更または終了することがあります。"], ["禁止行為", "サービス妨害、コードの不正利用、広告システムの操作、不正アクセスは禁止されています。"]]);
  setText('[data-site-panel="contact"] h2', "お問い合わせ");
  setText('[data-site-panel="contact"] .siteInfoLead', "ゲームの不具合報告、広告・ポリシーに関するお問い合わせ、その他のご意見は下記メールアドレスへお送りください。");
  setText('[data-site-panel="contact"] .siteInfoMutedNote', "お問い合わせの際は、利用環境、ブラウザ、発生状況をあわせて記載していただくと確認がスムーズです。");
}

function applyLanguage() {
  document.documentElement.lang = currentLang;
  document.title = currentLang === "ja" ? "ゴロゴロ" : (currentLang === "zh" ? "咕噜咕噜" : (currentLang === "en" ? "ROLL ROLL" : "데굴데굴"));
  renderLobbyTitle();
  STATIC_TRANSLATIONS.forEach(([selector, values, mode]) => {
    const el = document.querySelector(selector);
    const langValue = values[currentLang] || values.en || values.ko;
    if (!el || !langValue) return;
    if (mode === "html") el.innerHTML = langValue;
    else if (mode === "aria-label" || mode === "title") el.setAttribute(mode, langValue);
    else el.textContent = langValue;
  });

  updateSiteInfoLanguage();
  updateExtendedLanguageText();

  updateLanguageDropdownUI();

  const mobileNotice = document.getElementById("mobileRecommendNotice");
  if (mobileNotice) mobileNotice.textContent = tr("mobileRecommend");

  updateDeviceLayoutChoicePrompt();
  updateExtendedLanguageText();
  updateMobileUIState();
  updateSoundToggleUI();
  applyTheme();
  updateReadyUI();
  updateScoreUI();
  updateBuffUI();
  updatePauseVolumeUI();
  buildLobbyPalettes();
  updateGameModeUI();
  updateReadyUI();
}

function updateLanguageDropdownUI() {
  const wrap = document.getElementById("languageSelectWrap");
  const menu = document.getElementById("languageDropdownMenu");
  const btn = document.getElementById("languageToggle");
  const labels = {
    ko: { aria: "언어 선택", title: "언어 선택" },
    en: { aria: "Select language", title: "Language" },
    ja: { aria: "言語を選択", title: "言語" },
    zh: { aria: "选择语言", title: "语言" }
  };
  if (btn) {
    btn.textContent = "🌐";
    btn.setAttribute("aria-label", labels[currentLang]?.aria || "Select language");
    btn.setAttribute("title", labels[currentLang]?.title || "Language");
  }
  if (menu) {
    menu.setAttribute("aria-label", labels[currentLang]?.aria || "Select language");
    menu.querySelectorAll("[data-lang]").forEach(item => {
      item.classList.toggle("selected", item.dataset.lang === currentLang);
      item.setAttribute("aria-checked", item.dataset.lang === currentLang ? "true" : "false");
    });
  }
  if (wrap) wrap.classList.remove("open");
}

function toggleLanguageMenu(event) {
  if (event) event.stopPropagation();
  const wrap = document.getElementById("languageSelectWrap");
  if (!wrap) return;
  wrap.classList.toggle("open");
}

function selectLanguage(lang) {
  if (!DEGUL_LANG_ORDER.includes(lang)) return;
  currentLang = lang;
  safeLocalStorageSet(DEGUL_LANG_STORAGE_KEY, currentLang);
  const wrap = document.getElementById("languageSelectWrap");
  if (wrap) wrap.classList.remove("open");
  applyLanguage();
}

document.addEventListener("click", event => {
  const wrap = document.getElementById("languageSelectWrap");
  if (wrap && !wrap.contains(event.target)) wrap.classList.remove("open");
});

function toggleLanguage() {
  toggleLanguageMenu();
}


function openPrivacyPopup(isFirstVisit = false) {
  const overlay = document.getElementById("privacyOverlay");
  if (!overlay) return;
  overlay.classList.add("show");
  overlay.setAttribute("aria-hidden", "false");
  overlay.dataset.firstVisit = isFirstVisit ? "1" : "0";
}

function closePrivacyPopup(event) {
  if (event && event.target && event.currentTarget && event.target !== event.currentTarget) return;
  const overlay = document.getElementById("privacyOverlay");
  if (!overlay) return;
  overlay.classList.remove("show");
  overlay.setAttribute("aria-hidden", "true");
}

function agreePrivacyPolicy() {
  const overlay = document.getElementById("privacyOverlay");
  const isFirstVisitConsent = overlay && overlay.dataset.firstVisit === "1";
  safeLocalStorageSet("degulDegulPrivacyConsent", "1");
  safeLocalStorageSet("degulDegulPrivacyConsentAt", new Date().toISOString());
  closePrivacyPopup();

  // 첫 방문 동의 완료 직후에는 데굴데굴 룰 안내 UI를 한 번 이어서 보여준다.
  if (isFirstVisitConsent && safeLocalStorageGet("degulDegulFirstRuleGuideShown") !== "1") {
    safeLocalStorageSet("degulDegulFirstRuleGuideShown", "1");
    window.setTimeout(() => openHelpPopup(), 180);
  }
}

function showPrivacyConsentIfNeeded() {
  if (safeLocalStorageGet("degulDegulPrivacyConsent") === "1") return;
  window.setTimeout(() => openPrivacyPopup(true), 350);
}

