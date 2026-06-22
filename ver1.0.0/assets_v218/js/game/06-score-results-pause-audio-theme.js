// ===================== 점수 UI =====================
function updateScoreUI() {
  const p1Count = countLand(P1_LAND);
  const p2Count = countLand(P2_LAND);
  const total = GRID_SIZE * GRID_SIZE;

  const p1Percent = Math.round((p1Count / total) * 100);
  const p2Percent = Math.round((p2Count / total) * 100);
  const claimedTotal = Math.max(1, p1Count + p2Count);
  const p1GaugePercent = Math.max(0, Math.min(100, (p1Count / claimedTotal) * 100));
  const p2GaugePercent = Math.max(0, Math.min(100, (p2Count / claimedTotal) * 100));

  const p1Score = document.getElementById("p1Score");
  const p2Score = document.getElementById("p2Score");
  const p1PercentEl = document.getElementById("p1Percent");
  const p2PercentEl = document.getElementById("p2Percent");
  const leaderText = document.getElementById("leaderText");
  const p1GaugeFill = document.getElementById("p1GaugeFill");
  const p2GaugeFill = document.getElementById("p2GaugeFill");
  const gaugeDivider = document.getElementById("gaugeDivider");
  const p1GaugeText = document.getElementById("p1GaugeText");
  const p2GaugeText = document.getElementById("p2GaugeText");

  if (!p1Score || !p2Score) return;

  const p2NameEl = document.querySelector(".scoreCard.p2 .scoreName");
  if (p2NameEl) p2NameEl.textContent = matchMode === "ai" ? `AI ${getAiDifficultyLabel()}` : "2P";

  p1Score.textContent = `${p1Count}${tr("point")}`;
  p2Score.textContent = `${p2Count}${tr("point")}`;
  p1PercentEl.textContent = `${p1Percent}%`;
  p2PercentEl.textContent = `${p2Percent}%`;

  if (p1GaugeFill) p1GaugeFill.style.width = `${p1GaugePercent}%`;
  if (p2GaugeFill) p2GaugeFill.style.width = `${p2GaugePercent}%`;
  if (gaugeDivider) gaugeDivider.style.left = `${p1GaugePercent}%`;
  if (p1GaugeText) p1GaugeText.textContent = `1P ${p1Percent}%`;
  if (p2GaugeText) p2GaugeText.textContent = `2P ${p2Percent}%`;

  if (leaderText) {
    if (p1Count > p2Count) {
      leaderText.textContent = tr("leader1");
    } else if (p2Count > p1Count) {
      leaderText.textContent = tr("leader2");
    } else {
      leaderText.textContent = tr("leaderTie");
    }
  }

  updateDominanceEdgeOverlay(p1Percent, p2Percent, p1Count, p2Count);
  updateDominanceScoreGaugeUI(p1Percent, p2Percent, p1Count, p2Count);
}

let lastScoreUIUpdateTime = 0;
const SCORE_UI_UPDATE_INTERVAL = 200;
function updateScoreUIThrottled(force = false) {
  const now = performance.now();
  if (!force && now - lastScoreUIUpdateTime < SCORE_UI_UPDATE_INTERVAL) return;
  lastScoreUIUpdateTime = now;
  updateScoreUI();
}



// ===================== 사망 카메라 클로즈업 =====================
function startWinnerCameraCloseup(player) {
  if (!player || !player.mesh || !camera) return;

  const focus = player.mesh.position.clone();
  focus.y += 0.82;

  const currentPos = camera.position.clone();
  const currentLook = getCameraLookTarget();

  const dir = player.dir || { dx: 0, dz: 1 };
  const forward = new THREE.Vector3(dir.dx || 0, 0, dir.dz || 1);
  if (forward.lengthSq() < 0.0001) forward.set(0, 0, 1);
  forward.normalize();

  // 승리자 카메라: 이긴 블록을 중심으로 가까이 당기되, 보드 상황도 살짝 보이도록 높이를 유지한다.
  const side = new THREE.Vector3(-forward.z, 0, forward.x).multiplyScalar(1.0);
  const back = forward.clone().multiplyScalar(-5.4);
  const targetPos = focus.clone().add(back).add(side);
  targetPos.y += 4.6;

  deathCameraFocus = {
    startedAt: performance.now(),
    duration: 1150,
    hold: true,
    fromPos: currentPos,
    fromLook: currentLook,
    toPos: targetPos,
    toLook: focus
  };
}

function startDeathCameraCloseup(player, worldPos) {
  // 이전 버전 호환용: 이제 패배자 대신 승리자 클로즈업을 endGame에서 처리한다.
  return;
}

function getCameraLookTarget() {
  const dir = new THREE.Vector3();
  camera.getWorldDirection(dir);
  return camera.position.clone().add(dir.multiplyScalar(18));
}

function updateDeathCameraCloseup() {
  if (!deathCameraFocus || !camera) return;

  const now = performance.now();
  const t = Math.min((now - deathCameraFocus.startedAt) / deathCameraFocus.duration, 1);
  const eased = smootherStep(t);

  camera.position.lerpVectors(deathCameraFocus.fromPos, deathCameraFocus.toPos, eased);

  const look = new THREE.Vector3().lerpVectors(deathCameraFocus.fromLook, deathCameraFocus.toLook, eased);
  camera.lookAt(look);
}

function clearDeathCameraCloseup() {
  deathCameraFocus = null;
  if (camera) {
    camera.position.set(0, 30, 28);
    camera.lookAt(0, 0, 0);
  }
}


// ===================== 사망 모션 =====================
function playDeathMotion(player, onDone) {
  const mesh = player.mesh;
  const startScale = mesh.scale.clone();
  const startPos = (mesh.userData && mesh.userData.deathLockedPos) ? mesh.userData.deathLockedPos.clone() : mesh.position.clone();
  mesh.position.copy(startPos);
  const startRot = mesh.rotation.clone();
  const startTime = performance.now();
  // 요청 수정: 사망 시 터지는 모션을 기존 0.85초에서 약 2.35초로 늘림
  // 기존보다 약 1.5초 더 길게 유지되어 카메라 클로즈업과 폭발 연출을 더 여유 있게 보여준다.
  const duration = 2350;

  createDeathParticles(startPos, player.lineColor);

  function step() {
    const t = Math.min((performance.now() - startTime) / duration, 1);
    const pop = Math.sin(t * Math.PI);
    const shake = Math.sin(t * Math.PI * 10) * 0.035 * (1 - t);

    mesh.position.x = startPos.x + shake;
    mesh.position.z = startPos.z - shake;
    mesh.position.y = startPos.y + pop * 0.75;

    mesh.rotation.x = startRot.x + pop * Math.PI * 1.2;
    mesh.rotation.z = startRot.z + Math.sin(t * Math.PI * 8) * 0.35 * (1 - t);

    const s = Math.max(0.02, 1 - t);
    mesh.scale.set(startScale.x * s, startScale.y * s, startScale.z * s);

    if (t < 1) {
      requestAnimationFrame(step);
    } else {
      mesh.scale.copy(startScale);
      mesh.position.copy(startPos);
      mesh.rotation.copy(startRot);
      onDone();
    }
  }

  step();
}

function createDeathParticles(pos, color) {
  const particleCount = 16;
  const particles = [];

  for (let i = 0; i < particleCount; i++) {
    const geo = new THREE.BoxGeometry(0.16, 0.16, 0.16);
    const mat = new THREE.MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: 0.16,
      roughness: 0.45
    });

    const p = new THREE.Mesh(geo, mat);
    p.position.copy(pos);
    scene.add(p);

    const angle = (Math.PI * 2 * i) / particleCount;
    const speed = 0.055 + Math.random() * 0.035;

    particles.push({
      mesh: p,
      vx: Math.cos(angle) * speed,
      vz: Math.sin(angle) * speed,
      vy: 0.055 + Math.random() * 0.045,
      life: 1
    });
  }

  function updateParticles() {
    let alive = false;

    for (const p of particles) {
      if (p.life <= 0) continue;

      alive = true;
      p.mesh.position.x += p.vx;
      p.mesh.position.z += p.vz;
      p.mesh.position.y += p.vy;
      p.vy -= 0.0022;
      p.life -= 0.011;

      const s = Math.max(0, p.life);
      p.mesh.scale.set(s, s, s);
    }

    if (alive) {
      requestAnimationFrame(updateParticles);
    } else {
      for (const p of particles) {
        scene.remove(p.mesh);
        p.mesh.geometry.dispose();
        p.mesh.material.dispose();
      }
    }
  }

  updateParticles();
}

function createVictoryFireworks(player) {
  if (!player || !player.mesh) return;

  const basePos = player.mesh.position.clone();
  const paperColors = [0xffd166, 0xff8fb3, 0xffafcc, 0xa2d2ff, 0xbde0fe, 0xcdb4db, 0xffffff];
  const pieces = [];
  const group = new THREE.Group();
  scene.add(group);

  const createPaperPiece = (origin, delay = 0) => {
    const w = 0.045 + Math.random() * 0.04;
    const h = 0.13 + Math.random() * 0.12;
    const geo = new THREE.PlaneGeometry(w, h);
    const mat = new THREE.MeshBasicMaterial({
      color: paperColors[Math.floor(Math.random() * paperColors.length)],
      transparent: true,
      opacity: 0.96,
      side: THREE.DoubleSide
    });

    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(origin);
    mesh.rotation.set(
      Math.random() * Math.PI,
      Math.random() * Math.PI,
      Math.random() * Math.PI
    );
    group.add(mesh);

    const angle = Math.random() * Math.PI * 2;
    const radiusSpeed = 0.012 + Math.random() * 0.036;

    pieces.push({
      mesh,
      mat,
      bornAt: performance.now(),
      delay,
      life: 1,
      vx: Math.cos(angle) * radiusSpeed,
      vz: Math.sin(angle) * radiusSpeed,
      vy: 0.055 + Math.random() * 0.055,
      gravity: 0.0018 + Math.random() * 0.0014,
      driftX: (Math.random() - 0.5) * 0.014,
      driftZ: (Math.random() - 0.5) * 0.014,
      rotX: (Math.random() - 0.5) * 0.24,
      rotY: (Math.random() - 0.5) * 0.28,
      rotZ: (Math.random() - 0.5) * 0.22,
      wobble: Math.random() * Math.PI * 2,
      fallStart: 0.18 + Math.random() * 0.2
    });
  };

  for (let burst = 0; burst < 4; burst++) {
    const center = basePos.clone();
    center.x += (Math.random() - 0.5) * 2.4;
    center.z += (Math.random() - 0.5) * 1.8;
    center.y += 1.55 + Math.random() * 0.75;

    for (let i = 0; i < 18; i++) {
      const origin = center.clone();
      origin.x += (Math.random() - 0.5) * 0.18;
      origin.z += (Math.random() - 0.5) * 0.18;
      origin.y += (Math.random() - 0.5) * 0.14;
      createPaperPiece(origin, burst * 120 + Math.random() * 130);
    }
  }

  function updateConfettiFireworks() {
    const now = performance.now();
    let alive = false;

    for (const p of pieces) {
      const local = now - p.bornAt - p.delay;
      if (local < 0) {
        alive = true;
        continue;
      }

      const t = Math.min(local / 1850, 1);
      const fade = Math.max(0, 1 - Math.max(0, t - 0.68) / 0.32);

      p.mesh.position.x += p.vx + p.driftX * Math.sin(local * 0.012 + p.wobble);
      p.mesh.position.z += p.vz + p.driftZ * Math.cos(local * 0.01 + p.wobble);
      p.mesh.position.y += p.vy;

      if (t > p.fallStart) {
        p.vy -= p.gravity;
      } else {
        p.vy *= 0.985;
      }

      p.mesh.rotation.x += p.rotX;
      p.mesh.rotation.y += p.rotY;
      p.mesh.rotation.z += p.rotZ + Math.sin(local * 0.02 + p.wobble) * 0.035;
      p.mat.opacity = fade * 0.96;

      const scale = 1 + Math.sin(local * 0.018 + p.wobble) * 0.18;
      p.mesh.scale.set(scale, scale, scale);

      if (t < 1) alive = true;
    }

    if (alive) {
      requestAnimationFrame(updateConfettiFireworks);
    } else {
      scene.remove(group);
      disposeObjectTree(group);
    }
  }

  updateConfettiFireworks();
}


// ===================== 승패 처리 =====================
function killPlayer(player, reason, options = {}) {
  if (gameEnding || gameResultLocked || !player.alive || player.dying) return;
  gameEnding = true;

  // 보호막 라인 벽 판정은 tryMove에서 처리한다.
  const isSelfTrailDeath = reason && reason.includes("자기 흔적");
  if (!options.ignoreShield && !isSelfTrailDeath && consumeShield(player)) {
    return;
  }

  player.dying = true;
  player.moving = false;
  player.rollToken = null;
  setGamePhase(GAME_PHASE.ENDED);

  // 사망 위치 고정:
  // 기존 이동 애니메이션이나 종료 연출이 블록 위치를 덮어써서 센터로 이동하는 현상을 막는다.
  // 자기 흔적/상대 흔적 판정처럼 특정 칸에서 죽는 경우에는 그 칸을 우선 사용하고,
  // 그 외에는 현재 월드 위치를 그대로 보존한다.
  if (player.mesh) {
    const lockedDeathPos = new THREE.Vector3();
    if (options.deathCell && Number.isFinite(options.deathCell.x) && Number.isFinite(options.deathCell.z)) {
      const isGhostSkin = player.colorData && player.colorData.skin === "ghost";
      const surgeActive = isLineSurgeActive(player);
      lockedDeathPos.set(
        toWorld(options.deathCell.x),
        isGhostSkin ? (surgeActive ? 1.36 : 0.56) : (surgeActive ? 1.22 : 0.42),
        toWorld(options.deathCell.z)
      );
    } else {
      player.mesh.getWorldPosition(lockedDeathPos);
    }

    if (player.mesh.parent !== scene) scene.attach(player.mesh);
    player.mesh.position.copy(lockedDeathPos);
    player.mesh.userData.deathLockedPos = lockedDeathPos.clone();
  }

  const winner = getOpponent(player);
  playDeathMotion(player, () => {
    player.alive = false;
    player.mesh.visible = false;
    clearTrail(player);

    if (winner && winner.alive) {
      endGame(winner, reason);
    } else {
      endGame(null, reason);
    }
  });
}

function checkWinByLand() {
  if (gameOver || gameEnding || gameResultLocked) return;
  const p1Count = countLand(P1_LAND);
  const p2Count = countLand(P2_LAND);
  const total = GRID_SIZE * GRID_SIZE;

  if (p1Count >= total * 0.60) {
    endGame(p1, tr("landWin", "1P"));
  } else if (p2Count >= total * 0.60) {
    endGame(p2, tr("landWin", "2P"));
  }
}

function endGame(winner, text) {
  if (gameResultLocked) return;
  gameResultLocked = true;
  gameEnding = true;
  DegulSfx.stopAll();
  pauseIngameBgm(true);
  stopItemSpawner();
  fadeOutDominanceEdgeOverlay();
  fadeOutDominanceScoreGaugeUI();
  setGamePhase(GAME_PHASE.ENDED);
  matchEndedAt = performance.now();
  keys = {};
  resetLobbyReady();
  recordAiMatchResult(winner, text);
  handleAiClearReward(winner);

  if (winner && winner.alive !== false) {
    startWinnerCameraCloseup(winner);
    // 승리자 줌인이 시작되는 프레임에 결과에 맞는 BGM을 재생한다.
    // AI가 승리한 경우에는 사용자 패배 전용 BGM이 승리 BGM보다 우선한다.
    if (typeof window.startDegulOutcomeBgm === "function") {
      window.startDegulOutcomeBgm(winner);
    }
    createVictoryFireworks(winner);
  }

  const lockedResultToken = gameResultToken;
  setTimeout(() => {
    if (lockedResultToken !== gameResultToken) return;
    showResultPopup(winner, text);
  }, winner ? 1250 : 700);
}




// ===================== 일시정지 메뉴 =====================
function updatePauseMenuButtonVisibility() {
  const btn = document.getElementById("pauseMenuButton");
  if (!btn) return;
  const shouldShow = gameStarted && !gameOver && !isCountingDown;
  btn.classList.toggle("show", shouldShow);
}

function openPauseMenu() {
  if (!gameStarted || gameOver || isCountingDown) return;
  if (isPaused) return;

  setGamePhase(GAME_PHASE.PAUSED);
  pauseStartedAt = performance.now();
  keys = {};

  // 일시정지 중에는 인게임 BGM만 현재 위치에서 잠시 멈춘다.
  pauseIngameBgm(false);

  const overlay = document.getElementById("pauseOverlay");
  if (overlay) {
    overlay.classList.add("show");
    overlay.setAttribute("aria-hidden", "false");
  }
  updatePauseVolumeUI();
}

function closePauseMenuVisual() {
  const overlay = document.getElementById("pauseOverlay");
  if (!overlay) return;
  overlay.classList.remove("show");
  overlay.setAttribute("aria-hidden", "true");
}

function resumeGameFromMenu() {
  if (!isPaused) {
    closePauseMenuVisual();
    return;
  }

  const pausedFor = Math.max(0, performance.now() - pauseStartedAt);
  for (const actor of players) {
    if (!actor) continue;
    if (actor.moveBoostUntil) actor.moveBoostUntil += pausedFor;
    if (actor.shieldUntil) actor.shieldUntil += pausedFor;
    if (actor.lineSurgeUntil) actor.lineSurgeUntil += pausedFor;
  }
  if (activeItems && activeItems.length) {
    for (const item of activeItems) {
      if (item && item.bornAt) item.bornAt += pausedFor;
    }
    syncActiveItemReference();
  }

  setGamePhase(GAME_PHASE.PLAYING);
  pauseStartedAt = 0;
  keys = {};
  closePauseMenuVisual();

  // 이어서 플레이할 때는 멈췄던 지점부터 인게임 BGM을 다시 재생한다.
  playIngameBgm();
}

function togglePauseMenu() {
  if (isPaused) resumeGameFromMenu();
  else openPauseMenu();
}

function goMainFromPauseMenu() {
  closePauseMenuVisual();
  resetMatch();
  returnToLobby();
  updatePauseMenuButtonVisibility();
}

function setBgmVolumeFromSlider(value) {
  bgmVolume = Math.max(0, Math.min(1, Number(value) / 100));
  if (bgmVolume > 0) localStorage.setItem("degulDegulPrevBgmVolume", String(bgmVolume));
  localStorage.setItem("degulDegulBgmVolume", String(bgmVolume));
  const lobbyBgm = document.getElementById("lobbyBgm");
  const ingameBgm = document.getElementById("ingameBgm");
  if (lobbyBgm) lobbyBgm.volume = bgmVolume;
  if (ingameBgm) ingameBgm.volume = bgmVolume;
  updatePauseVolumeUI();
}

function setSfxVolumeFromSlider(value) {
  sfxVolume = Math.max(0, Math.min(1, Number(value) / 100));
  if (!Number.isFinite(sfxVolume)) sfxVolume = 0.8;
  if (sfxVolume > 0) localStorage.setItem("degulDegulPrevSfxVolume", String(sfxVolume));
  localStorage.setItem("degulDegulSfxVolume", String(sfxVolume));
  if (typeof DegulSfx !== "undefined" && typeof DegulSfx.applyMasterVolume === "function") {
    DegulSfx.applyMasterVolume();
  }
  updatePauseVolumeUI();
}

function toggleBgmMute() {
  if (bgmVolume > 0) {
    localStorage.setItem("degulDegulPrevBgmVolume", String(bgmVolume));
    setBgmVolumeFromSlider(0);
  } else {
    const restored = parseFloat(localStorage.getItem("degulDegulPrevBgmVolume") || "0.42");
    setBgmVolumeFromSlider(Math.round(Math.max(0.01, Math.min(1, restored)) * 100));
    tryStartLobbyBgm();
  }
}

function toggleSfxMute() {
  if (sfxVolume > 0) {
    localStorage.setItem("degulDegulPrevSfxVolume", String(sfxVolume));
    setSfxVolumeFromSlider(0);
  } else {
    const restored = parseFloat(localStorage.getItem("degulDegulPrevSfxVolume") || "0.8");
    setSfxVolumeFromSlider(Math.round(Math.max(0.01, Math.min(1, restored)) * 100));
  }
}

function updatePauseVolumeUI() {
  const bgmSlider = document.getElementById("pauseBgmVolume");
  const sfxSlider = document.getElementById("pauseSfxVolume");
  const bgmValue = document.getElementById("pauseBgmValue");
  const sfxValue = document.getElementById("pauseSfxValue");
  const bgmPercent = Math.round(bgmVolume * 100);
  const sfxPercent = Math.round(sfxVolume * 100);

  if (bgmSlider) bgmSlider.value = bgmPercent;
  if (sfxSlider) sfxSlider.value = sfxPercent;
  if (bgmValue) bgmValue.textContent = `${bgmPercent}%`;
  if (sfxValue) sfxValue.textContent = `${sfxPercent}%`;

  const settingsBgmSlider = document.getElementById("settingsBgmVolume");
  const settingsSfxSlider = document.getElementById("settingsSfxVolume");
  const settingsBgmValue = document.getElementById("settingsBgmValue");
  const settingsSfxValue = document.getElementById("settingsSfxValue");
  if (settingsBgmSlider) {
    settingsBgmSlider.value = bgmPercent;
    if (typeof window.updateDegulVolumeSlider === "function") {
      window.updateDegulVolumeSlider(settingsBgmSlider, false);
    }
  }
  if (settingsSfxSlider) {
    settingsSfxSlider.value = sfxPercent;
    if (typeof window.updateDegulVolumeSlider === "function") {
      window.updateDegulVolumeSlider(settingsSfxSlider, false);
    }
  }
  if (settingsBgmValue) settingsBgmValue.textContent = `${bgmPercent}%`;
  if (settingsSfxValue) settingsSfxValue.textContent = `${sfxPercent}%`;

  const settingsBgmMute = document.getElementById("settingsBgmMute");
  const settingsSfxMute = document.getElementById("settingsSfxMute");
  if (settingsBgmMute) {
    settingsBgmMute.textContent = bgmPercent === 0 ? "🔈" : "🔇";
    settingsBgmMute.classList.toggle("muted", bgmPercent === 0);
    settingsBgmMute.setAttribute("aria-label", bgmPercent === 0 ? tr("unmuteBgm") : tr("muteBgm"));
  }
  if (settingsSfxMute) {
    settingsSfxMute.textContent = sfxPercent === 0 ? "🔈" : "🔇";
    settingsSfxMute.classList.toggle("muted", sfxPercent === 0);
    settingsSfxMute.setAttribute("aria-label", sfxPercent === 0 ? tr("unmuteSfx") : tr("muteSfx"));
  }
  updateSettingsThemeUI();
}

// ===================== 로비 BGM =====================
function setupLobbyBgm() {
  const bgm = document.getElementById("lobbyBgm");
  const ingame = document.getElementById("ingameBgm");
  if (!bgm) return;

  bgm.volume = bgmVolume;
  bgm.loop = true;
  bgm.autoplay = true;
  if (ingame) {
    ingame.volume = bgmVolume;
    ingame.loop = true;
  }
  updatePauseVolumeUI();

  // 브라우저 정책상 자동재생이 막힐 경우, 첫 클릭/키입력 때 즉시 이어서 재생
  document.addEventListener("pointerdown", tryStartLobbyBgm, { once: true });
  document.addEventListener("keydown", tryStartLobbyBgm, { once: true });
  setTimeout(() => playLobbyBgm(), 80);
  updateSoundToggleUI();
}

function isLobbyVisible() {
  const lobby = document.getElementById("lobby");
  return lobby && lobby.style.display !== "none" && !gameStarted && !isCountingDown;
}

function isResultPopupVisible() {
  const message = document.getElementById("message");
  return !!message && message.style.display !== "none" && message.classList.contains("show");
}

function canAcceptLobbyReadyInput() {
  return isLobbyVisible() && !isResultPopupVisible() && !gameStarted && !isCountingDown;
}

function tryStartLobbyBgm() {
  if (!lobbyBgmEnabled || !isLobbyVisible()) return;
  playLobbyBgm();
}

function playLobbyBgm() {
  const bgm = document.getElementById("lobbyBgm");
  if (!bgm || !lobbyBgmEnabled || !isLobbyVisible()) return;

  const playPromise = bgm.play();
  if (playPromise && typeof playPromise.then === "function") {
    playPromise
      .then(() => {
        lobbyBgmStarted = true;
        updateSoundToggleUI();
      })
      .catch(() => {
        lobbyBgmStarted = false;
        updateSoundToggleUI();
      });
  }
}

function pauseLobbyBgm() {
  const bgm = document.getElementById("lobbyBgm");
  if (!bgm) return;
  bgm.pause();
  updateSoundToggleUI();
}

function getCurrentIngameBgmSrc() {
  // 고스트 모드 BGM은 대전 방식과 AI 난이도별 고유 BGM보다 항상 우선한다.
  if (ghostModeEnabled) {
    return GHOST_MODE_INGAME_BGM_SRC;
  }
  if (matchMode === "ai") {
    return AI_INGAME_BGM_BY_DIFFICULTY[aiDifficulty] || DEFAULT_INGAME_BGM_SRC;
  }
  return DEFAULT_INGAME_BGM_SRC;
}

function syncIngameBgmSource(resetToStart = false) {
  const bgm = document.getElementById("ingameBgm");
  if (!bgm) return;

  const nextSrc = getCurrentIngameBgmSrc();
  const shouldChange = currentIngameBgmSrc !== nextSrc || !bgm.getAttribute("src") || bgm.getAttribute("src") !== nextSrc;

  if (shouldChange) {
    const wasPaused = bgm.paused;
    bgm.pause();
    bgm.setAttribute("src", nextSrc);
    bgm.load();
    currentIngameBgmSrc = nextSrc;
    if (!wasPaused && !resetToStart) {
      try { bgm.currentTime = 0; } catch (e) {}
    }
  } else if (resetToStart) {
    try { bgm.currentTime = 0; } catch (e) {}
  }
}

function playIngameBgm() {
  const bgm = document.getElementById("ingameBgm");
  if (!bgm) return;
  syncIngameBgmSource(false);
  if (!lobbyBgmEnabled || !gameStarted || gameOver || isCountingDown || isPaused) return;
  bgm.volume = bgmVolume;
  bgm.loop = true;
  const playPromise = bgm.play();
  if (playPromise && typeof playPromise.then === "function") {
    playPromise
      .then(() => { ingameBgmStarted = true; })
      .catch(() => { ingameBgmStarted = false; });
  }
}

function pauseIngameBgm(resetToStart = false) {
  const bgm = document.getElementById("ingameBgm");
  if (!bgm) return;
  bgm.pause();
  if (resetToStart) {
    syncIngameBgmSource(true);
  }
  ingameBgmStarted = false;
}

function toggleLobbyBgm() {
  const bgm = document.getElementById("lobbyBgm");
  if (!bgm) return;

  lobbyBgmEnabled = !lobbyBgmEnabled;

  if (lobbyBgmEnabled) {
    if (gameStarted && !gameOver && !isCountingDown) playIngameBgm();
    else playLobbyBgm();
  } else {
    bgm.pause();
    pauseIngameBgm(false);
  }

  updateSoundToggleUI();
}

function updateSoundToggleUI() {
  const btn = document.getElementById("soundToggle");
  const bgm = document.getElementById("lobbyBgm");
  if (!btn || !bgm) return;

  if (!lobbyBgmEnabled) {
    btn.textContent = tr("soundOff");
  } else if (bgm.paused) {
    btn.textContent = tr("soundOn");
  } else {
    btn.textContent = tr("soundPlaying");
  }
}

// ===================== 다크모드 =====================
function getThemeColors() {
  if (isExtremeOrHellAiBoardDarkActive() || isDarkMode) {
    return {
      sceneBg: isHellAiBackgroundActive() ? 0x080000 : (isExtremeAiBackgroundActive() ? 0x090011 : 0x050609),
      fog: isHellAiBackgroundActive() ? 0x080000 : (isExtremeAiBackgroundActive() ? 0x090011 : 0x050609),
      emptyLand: 0x161a22,
      p1Land: 0xaedcff,
      p2Land: 0xffc1d6
    };
  }

  return {
    sceneBg: 0xf7f0ff,
    fog: 0xf7f0ff,
    emptyLand: 0xf1f4ff,
    p1Land: 0xaedcff,
    p2Land: 0xffc1d6
  };
}

function applyTheme() {
  const colors = getThemeColors();
  document.body.classList.toggle("dark-mode", isDarkMode);

  if (scene) {
    scene.background = new THREE.Color(colors.sceneBg);
    scene.fog = null;
  }

  if (hemiLight) {
    hemiLight.color.set(0xffffff);
    hemiLight.groundColor.set(0xd9e6ff);
    hemiLight.intensity = 1.6;
  }

  if (dirLight) {
    dirLight.color.set(0xffffff);
    dirLight.intensity = 1.35;
  }

  document.body.classList.toggle("ghost-mode-lock", ghostModeEnabled);
  updatePerspectiveBackgroundGridTheme();
  updateBoardSeamGridTheme();

  const btn = document.getElementById("themeToggle");
  if (btn) {
  btn.textContent = ghostModeEnabled ? tr("ghostDarkFixed") : (isDarkMode ? tr("darkOn") : tr("darkOff"));
    btn.disabled = ghostModeEnabled;
  }

  refreshBoardColors();
}

function runThemeTransition(applyThemeChange) {
  const reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduceMotion || document.hidden) {
    applyThemeChange();
    return;
  }

  let overlay = document.getElementById("themeFadeOverlay");
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = "themeFadeOverlay";
    document.body.appendChild(overlay);
  }

  const bodyStyle = window.getComputedStyle(document.body);
  const lobby = document.getElementById("lobby");
  const lobbyStyle = lobby ? window.getComputedStyle(lobby) : null;
  overlay.style.background = (lobbyStyle && lobbyStyle.backgroundImage && lobbyStyle.backgroundImage !== "none")
    ? lobbyStyle.backgroundImage
    : (bodyStyle.backgroundImage && bodyStyle.backgroundImage !== "none" ? bodyStyle.backgroundImage : bodyStyle.backgroundColor);
  overlay.style.opacity = "0";
  document.body.classList.add("theme-transitioning");

  requestAnimationFrame(() => {
    overlay.style.opacity = "1";
    window.setTimeout(() => {
      applyThemeChange();
      requestAnimationFrame(() => {
        overlay.style.opacity = "0";
        window.setTimeout(() => {
          document.body.classList.remove("theme-transitioning");
          if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
        }, 260);
      });
    }, 150);
  });
}

function toggleDarkMode() {
  runThemeTransition(() => {
    if (ghostModeEnabled) {
      isDarkMode = true;
      applyTheme();
      updateGameModeUI();
      updateSettingsThemeUI();
      return;
    }
    isDarkMode = !isDarkMode;
    localStorage.setItem("blockLandDarkMode", isDarkMode ? "1" : "0");
    applyTheme();
    updateSettingsThemeUI();
  });
}



function openSettingsPopup() {
  const overlay = document.getElementById("settingsOverlay");
  if (!overlay) return;
  updatePauseVolumeUI();
  updateSettingsThemeUI();
  updatePerformanceSettingsUI();
  overlay.classList.add("show");
  overlay.setAttribute("aria-hidden", "false");
}

function closeSettingsPopup(event) {
  if (event && event.target !== event.currentTarget) return;
  const overlay = document.getElementById("settingsOverlay");
  if (!overlay) return;
  overlay.classList.remove("show");
  overlay.setAttribute("aria-hidden", "true");
}

function toggleDarkModeFromSettings() {
  toggleDarkMode();
  updateSettingsThemeUI();
}

function updateSettingsThemeUI() {
  const settingsBtn = document.getElementById("settingsThemeToggle");
  const pauseBtn = document.getElementById("pauseThemeToggle");
  const text = isDarkMode ? "☀️ 라이트모드" : "🌙 다크모드";
  if (settingsBtn) settingsBtn.textContent = text;
  if (pauseBtn) pauseBtn.textContent = text;
}

