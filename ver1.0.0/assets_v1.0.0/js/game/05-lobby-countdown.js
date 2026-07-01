// ===================== 게임 모드 선택 =====================
function setMatchMode(mode) {
  if (isCountingDown || gameStarted) return;
  matchMode = mode === "ai" ? "ai" : "pvp";
  if (matchMode === "ai") {
    readyState[2] = true;
    selectedColors[2] = getAiColorData();
  } else {
    readyState[2] = false;
    if (selectedColors[2] && String(selectedColors[2].name || "").startsWith("AI-")) selectedColors[2] = COLOR_CHOICES[1];
  }
  updateGameModeUI();
  updateReadyUI();
}

function setAiDifficulty(level) {
  if (isCountingDown || gameStarted) return;
  const requested = AI_DIFFICULTIES[level] ? level : "easy";
  const requestedIndex = AI_DIFFICULTY_ORDER.indexOf(requested);
  if (requestedIndex >= 0) aiDifficultyCarouselIndex = requestedIndex;
  if (!isAiDifficultyUnlocked(requested)) {
    updateGameModeUI();
    return;
  }
  aiDifficulty = requested;
  if (matchMode === "ai") selectedColors[2] = getAiColorData();
  updateGameModeUI();
  updateReadyUI();
}

function shiftAiDifficulty(direction) {
  if (isCountingDown || gameStarted) return;
  const total = AI_DIFFICULTY_ORDER.length;
  if (!total) return;
  aiDifficultyCarouselIndex = Math.max(0, Math.min(total - 1, aiDifficultyCarouselIndex + direction));
  const viewedLevel = AI_DIFFICULTY_ORDER[aiDifficultyCarouselIndex];
  if (isAiDifficultyUnlocked(viewedLevel)) {
    aiDifficulty = viewedLevel;
    if (matchMode === "ai") selectedColors[2] = getAiColorData();
  }
  updateGameModeUI();
  updateReadyUI();
}

function setGameMode(mode) {
  if (isCountingDown || gameStarted) return;
  gameMode = mode === "item" ? "item" : "speed";
  updateGameModeUI();
  updateReadyUI();
}

function toggleGhostMode(checked) {
  if (isCountingDown || gameStarted) {
    updateGameModeUI();
    return;
  }

  const nextGhost = !!checked;

  if (nextGhost && !ghostModeEnabled) {
    preGhostDarkMode = isDarkMode;
    isDarkMode = true;
    applyTheme();
  } else if (!nextGhost && ghostModeEnabled) {
    if (preGhostDarkMode !== null) {
      isDarkMode = preGhostDarkMode;
      preGhostDarkMode = null;
      applyTheme();
    }
  }

  ghostModeEnabled = nextGhost;
  updateGameModeUI();
  updateReadyUI();
}

function updateGameModeUI() {
  const classicBtn = document.getElementById("classicModeBtn");
  const itemBtn = document.getElementById("itemModeBtn");
  const modeWrap = document.getElementById("modeSelectWrap");
  const ghostBox = document.getElementById("ghostToggleBox");
  const ghostCheck = document.getElementById("ghostModeCheck");
  const pvpBtn = document.getElementById("pvpModeBtn");
  const aiBtn = document.getElementById("aiModeBtn");
  const aiWrap = document.getElementById("aiDifficultyWrap");

  if (classicBtn) classicBtn.classList.toggle("selected", gameMode === "speed");
  if (itemBtn) itemBtn.classList.toggle("selected", gameMode === "item");
  document.body.classList.toggle("ghost-mode-lock", ghostModeEnabled);
  if (modeWrap) modeWrap.classList.toggle("ghost-active", ghostModeEnabled);
  if (ghostBox) ghostBox.classList.toggle("active", ghostModeEnabled);
  if (ghostCheck) ghostCheck.checked = ghostModeEnabled;
  const themeBtn = document.getElementById("themeToggle");
  if (themeBtn) {
    themeBtn.disabled = ghostModeEnabled;
    themeBtn.title = ghostModeEnabled ? tr("ghostDarkOnly") : "";
  }
  if (pvpBtn) pvpBtn.classList.toggle("selected", matchMode === "pvp");
  if (aiBtn) aiBtn.classList.toggle("selected", matchMode === "ai");
  if (aiWrap) aiWrap.classList.toggle("show", matchMode === "ai");
  document.body.classList.toggle("ai-match-mode", matchMode === "ai");

  if (!AI_DIFFICULTY_ORDER[aiDifficultyCarouselIndex]) {
    aiDifficultyCarouselIndex = Math.max(0, AI_DIFFICULTY_ORDER.indexOf(aiDifficulty));
  }

  if (!isAiDifficultyUnlocked(aiDifficulty)) {
    aiDifficulty = getFirstUnlockedAiDifficulty();
    if (matchMode === "ai") selectedColors[2] = getAiColorData();
  }

  AI_DIFFICULTY_ORDER.forEach(level => {
    const btn = document.getElementById(`aiDiff${level.charAt(0).toUpperCase()}${level.slice(1)}`);
    if (!btn) return;
    const locked = !isAiDifficultyUnlocked(level);
    btn.classList.toggle("selected", aiDifficulty === level && !locked);
    btn.classList.toggle("viewing", AI_DIFFICULTY_ORDER[aiDifficultyCarouselIndex] === level);
    btn.classList.toggle("locked", locked);
    btn.disabled = locked;
    btn.setAttribute("aria-disabled", locked ? "true" : "false");
    if (locked) {
      const needText = getAiDifficultyUnlockHint(level);
      btn.title = needText;
      btn.setAttribute("data-unlock-label", needText);
      btn.setAttribute("aria-label", `${getAiDifficultyLabel(level)} ${needText}`);
    } else {
      btn.title = getAiDifficultyLabel(level);
      btn.removeAttribute("data-unlock-label");
      btn.setAttribute("aria-label", getAiDifficultyLabel(level));
    }
  });

  const track = document.getElementById("aiDifficultyTrack");
  if (track) track.style.transform = `translateX(${-aiDifficultyCarouselIndex * 100}%)`;

  const prevBtn = document.getElementById("aiDifficultyPrev");
  const nextBtn = document.getElementById("aiDifficultyNext");
  if (prevBtn) prevBtn.disabled = aiDifficultyCarouselIndex <= 0;
  if (nextBtn) nextBtn.disabled = aiDifficultyCarouselIndex >= AI_DIFFICULTY_ORDER.length - 1;

  const dots = document.getElementById("aiDifficultyDots");
  if (dots) {
    dots.innerHTML = AI_DIFFICULTY_ORDER.map((level, index) => {
      const active = index === aiDifficultyCarouselIndex ? " active" : "";
      const locked = !isAiDifficultyUnlocked(level) ? " locked" : "";
      return `<span class="aiDifficultyDot${active}${locked}"></span>`;
    }).join("");
  }

  updateAiRecordPanel();
}

// ===================== 로비 색상 선택 / 준비 =====================
function buildLobbyPalettes() {
  createPaletteForPlayer(1);
  createPaletteForPlayer(2);
}

function createPaletteForPlayer(playerNum) {
  const palette = document.getElementById(`p${playerNum}Palette`);
  if (!palette) return;
  palette.innerHTML = "";
  palette.classList.add("compactPalette");

  const stepper = document.createElement("div");
  stepper.className = "solidColorStepper";

  const prevBtn = document.createElement("button");
  prevBtn.type = "button";
  prevBtn.className = "solidArrowBtn";
  prevBtn.textContent = "‹";
  prevBtn.title = tr("previousSolid");
  prevBtn.onclick = () => cycleSolidColor(playerNum, -1);

  const solidBtn = document.createElement("button");
  solidBtn.type = "button";
  solidBtn.className = "solidColorButton";
  solidBtn.dataset.role = "solid-picker";
  solidBtn.onclick = () => cycleSolidColor(playerNum, 1);

  const nextBtn = document.createElement("button");
  nextBtn.type = "button";
  nextBtn.className = "solidArrowBtn";
  nextBtn.textContent = "›";
  nextBtn.title = tr("nextSolid");
  nextBtn.onclick = () => cycleSolidColor(playerNum, 1);

  stepper.appendChild(prevBtn);
  stepper.appendChild(solidBtn);
  stepper.appendChild(nextBtn);
  palette.appendChild(stepper);

  const skinCarousel = document.createElement("div");
  skinCarousel.className = "skinPalette skinCarousel";

  const skinPrevBtn = document.createElement("button");
  skinPrevBtn.type = "button";
  skinPrevBtn.className = "skinArrowBtn skinPrevBtn";
  skinPrevBtn.textContent = "‹";
  skinPrevBtn.title = tr("previousSkin");
  skinPrevBtn.onclick = () => shiftSkinChoice(playerNum, -1);

  const skinViewport = document.createElement("div");
  skinViewport.className = "skinViewport";

  const skinTrack = document.createElement("div");
  skinTrack.className = "skinTrack";

  SKIN_COLOR_CHOICES.forEach(colorData => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "skinChoiceButton colorChip";
    chip.style.setProperty("--chip-color", `#${colorData.actor.toString(16).padStart(6, "0")}`);
    chip.dataset.skin = colorData.skin;
    chip.textContent = colorData.name;
    const locked = !isSkinUnlocked(colorData.skin);
    chip.classList.toggle("locked", locked);
    if (locked) {
      chip.dataset.unlockLabel = getSkinUnlockHint(colorData.skin);
      chip.title = `${colorData.name} · ${getSkinUnlockHint(colorData.skin)}`;
      chip.setAttribute("aria-label", tr("lockedSkinAria", getColorDisplayName(colorData), getSkinUnlockHint(colorData.skin)));
    } else {
      chip.title = colorData.name;
      chip.removeAttribute("data-unlock-label");
      chip.setAttribute("aria-label", colorData.name);
    }
    chip.onclick = () => selectPlayerColor(playerNum, colorData);
    skinTrack.appendChild(chip);
  });

  skinViewport.appendChild(skinTrack);

  const skinNextBtn = document.createElement("button");
  skinNextBtn.type = "button";
  skinNextBtn.className = "skinArrowBtn skinNextBtn";
  skinNextBtn.textContent = "›";
  skinNextBtn.title = tr("nextSkin");
  skinNextBtn.onclick = () => shiftSkinChoice(playerNum, 1);

  const skinDots = document.createElement("div");
  skinDots.className = "skinDots";

  skinCarousel.appendChild(skinPrevBtn);
  skinCarousel.appendChild(skinViewport);
  skinCarousel.appendChild(skinNextBtn);
  skinCarousel.appendChild(skinDots);
  palette.appendChild(skinCarousel);

  updateCompactPaletteUI(playerNum);
}

function shiftSkinChoice(playerNum, direction) {
  if (readyState[playerNum] || isCountingDown || gameStarted || (matchMode === "ai" && playerNum === 2)) return;
  const total = SKIN_COLOR_CHOICES.length;
  if (!total) return;
  skinCarouselIndex[playerNum] = Math.max(0, Math.min(total - 1, (skinCarouselIndex[playerNum] || 0) + direction));
  const colorData = SKIN_COLOR_CHOICES[skinCarouselIndex[playerNum]];
  if (colorData && isSkinUnlocked(colorData.skin)) {
    selectPlayerColor(playerNum, colorData);
  } else {
    updateCompactPaletteUI(playerNum);
  }
}

function cycleSolidColor(playerNum, direction) {
  if (readyState[playerNum] || isCountingDown || gameStarted || (matchMode === "ai" && playerNum === 2)) return;
  const current = selectedColors[playerNum];
  let idx = SOLID_COLOR_CHOICES.indexOf(current);
  if (idx < 0) idx = 0;
  else idx = (idx + direction + SOLID_COLOR_CHOICES.length) % SOLID_COLOR_CHOICES.length;
  selectPlayerColor(playerNum, SOLID_COLOR_CHOICES[idx]);
}

function updateCompactPaletteUI(playerNum) {
  const palette = document.getElementById(`p${playerNum}Palette`);
  if (!palette) return;
  const selected = selectedColors[playerNum];
  const solidBtn = palette.querySelector('[data-role="solid-picker"]');
  const solidSelected = selected && !selected.skin ? selected : SOLID_COLOR_CHOICES[0];
  if (solidBtn) {
    solidBtn.style.setProperty("--solid-color", `#${solidSelected.actor.toString(16).padStart(6, "0")}`);
    const solidName = getColorDisplayName(solidSelected);
    solidBtn.textContent = solidName;
    solidBtn.title = tr("changeSolidTitle", solidName);
    solidBtn.setAttribute("aria-label", tr("changeSolidAria", solidName));
    solidBtn.classList.toggle("selected", selected === solidSelected && !selected.skin);
  }

  const totalSkins = SKIN_COLOR_CHOICES.length;
  let currentSkinIndex = skinCarouselIndex[playerNum] || 0;
  currentSkinIndex = Math.max(0, Math.min(totalSkins - 1, currentSkinIndex));
  skinCarouselIndex[playerNum] = currentSkinIndex;

  const skinTrack = palette.querySelector(".skinTrack");
  if (skinTrack) skinTrack.style.transform = `translateX(${-currentSkinIndex * 100}%)`;

  palette.querySelectorAll(".skinTrack .colorChip").forEach(chip => {
    const choice = SKIN_COLOR_CHOICES.find(c => c.skin === chip.dataset.skin);
    if (!choice) return;
    const locked = !isSkinUnlocked(choice.skin);
    chip.classList.toggle("locked", locked);
    if (locked) {
      chip.dataset.unlockLabel = getSkinUnlockHint(choice.skin);
      chip.title = `${choice.name} · ${getSkinUnlockHint(choice.skin)}`;
      chip.setAttribute("aria-label", tr("lockedSkinAria", getColorDisplayName(choice), getSkinUnlockHint(choice.skin)));
    } else {
      chip.removeAttribute("data-unlock-label");
      chip.title = choice.name;
      chip.setAttribute("aria-label", choice.name);
    }
    chip.classList.toggle("selected", choice === selected && !locked);
  });

  const skinPrevBtn = palette.querySelector(".skinPrevBtn");
  const skinNextBtn = palette.querySelector(".skinNextBtn");
  if (skinPrevBtn) skinPrevBtn.disabled = currentSkinIndex <= 0;
  if (skinNextBtn) skinNextBtn.disabled = currentSkinIndex >= totalSkins - 1;

  const skinDots = palette.querySelector(".skinDots");
  if (skinDots) {
    skinDots.innerHTML = SKIN_COLOR_CHOICES.map((choice, index) => {
      const active = index === currentSkinIndex ? " active" : "";
      const locked = !isSkinUnlocked(choice.skin) ? " locked" : "";
      return `<span class="skinDot${active}${locked}"></span>`;
    }).join("");
  }
}

function selectPlayerColor(playerNum, colorData) {
  if (readyState[playerNum] || isCountingDown || gameStarted || (matchMode === "ai" && playerNum === 2)) return;
  if (colorData && colorData.skin && !isSkinUnlocked(colorData.skin)) return;

  selectedColors[playerNum] = colorData;
  if (colorData && colorData.skin) {
    const selectedSkinIndex = SKIN_COLOR_CHOICES.findIndex(c => c === colorData || c.skin === colorData.skin);
    if (selectedSkinIndex >= 0) skinCarouselIndex[playerNum] = selectedSkinIndex;
  }

  // 같은 색상을 동시에 고르면 상대 색상을 비어있는 첫 색상으로 자동 변경
  const other = playerNum === 1 ? 2 : 1;
  if (selectedColors[other] === colorData) {
    selectedColors[other] = COLOR_CHOICES.find(c => c !== colorData) || COLOR_CHOICES[0];
  }

  updateReadyUI();
  syncLobbySelectionToScene();
}

function syncLobbySelectionToScene() {
  if (isCountingDown || gameStarted || !actorsGroup) return;

  while (actorsGroup.children.length > 0) {
    const obj = actorsGroup.children[0];
    actorsGroup.remove(obj);
    disposeObjectTree(obj);
  }

  createPlayers();
  if (typeof refreshBoardColors === "function") refreshBoardColors();
  updateScoreUI();
}

function clearLobbyReadyStartTimer() {
  if (lobbyReadyStartTimer) {
    clearTimeout(lobbyReadyStartTimer);
    lobbyReadyStartTimer = null;
  }
}

function scheduleLobbyStartIfReady() {
  clearLobbyReadyStartTimer();
  if (!(readyState[1] && readyState[2])) return;

  lobbyReadyStartTimer = setTimeout(() => {
    lobbyReadyStartTimer = null;
    if (readyState[1] && readyState[2] && canAcceptLobbyReadyInput()) {
      startCountdown();
    }
  }, 850);
}

function setReady(playerNum, value) {
  if (!canAcceptLobbyReadyInput()) return;
  if (matchMode === "ai" && playerNum === 2) return;

  readyState[playerNum] = !!value;
  if (matchMode === "ai") readyState[2] = true;

  if (!(readyState[1] && readyState[2])) {
    clearLobbyReadyStartTimer();
  }

  updateReadyUI();
  scheduleLobbyStartIfReady();
}

function resetLobbyReady() {
  clearLobbyReadyStartTimer();
  readyState = { 1: false, 2: matchMode === "ai" };
  updateReadyUI();
}

function updateReadyUI() {
  [1, 2].forEach(playerNum => {
    const preview = document.getElementById(`p${playerNum}Preview`);
    const readyBox = document.getElementById(`p${playerNum}ReadyBox`);
    const palette = document.getElementById(`p${playerNum}Palette`);

    if (preview) {
      preview.style.setProperty("--preview-color", `#${selectedColors[playerNum].actor.toString(16).padStart(6, "0")}`);
      preview.dataset.skin = selectedColors[playerNum].skin || "";
    }

    if (readyBox) {
      readyBox.classList.toggle("ready", readyState[playerNum]);
      readyBox.textContent = readyState[playerNum] ? tr("readyDone", playerNum) : tr("readyBefore", playerNum);
    }

    if (palette) {
      updateCompactPaletteUI(playerNum);
    }

    const box = preview ? preview.closest(".playerSelectBox") : null;
    const title = box ? box.querySelector(".playerSelectTitle") : null;
    const hint = box ? box.querySelector(".readyHint") : null;
    if (box && playerNum === 2) box.classList.toggle("ai-locked", matchMode === "ai");
    if (title && playerNum === 2) title.textContent = matchMode === "ai" ? `AI ${getAiDifficultyLabel()}` : "2P COLOR";
    if (hint && playerNum === 1) hint.textContent = isMobileDevice ? tr("tapReadyCard") : tr("pressCtrlReady");
    if (hint && playerNum === 2) hint.textContent = matchMode === "ai" ? tr("aiAutoReady") : (isMobileDevice ? tr("tapReadyCard") : tr("pressEnterReady"));
  });

  const startStatus = document.getElementById("startStatus");
  if (startStatus) {
    if (readyState[1] && readyState[2]) startStatus.textContent = matchMode === "ai" ? tr("aiStarting", getAiDifficultyLabel()) : tr("bothReady");
    else if (readyState[1]) startStatus.textContent = matchMode === "ai" ? tr("p1AiStarting") : (isMobileDevice ? tr("p1MobileReady") : tr("p1Ready"));
    else if (readyState[2] && matchMode !== "ai") startStatus.textContent = isMobileDevice ? tr("p2MobileReady") : tr("p2Ready");
    else {
      const modeLabel = gameMode === "item" ? tr("itemMode") : tr("classicMode");
      const ghostLabel = ghostModeEnabled ? tr("ghostPlus") : "";
      startStatus.textContent = matchMode === "ai"
        ? (isMobileDevice ? tr("aiMobileReadyStatus", getAiDifficultyLabel()) : tr("aiDesktopReadyStatus", getAiDifficultyLabel()))
        : (isMobileDevice ? tr("mobileReadyStatus", modeLabel, ghostLabel) : tr("readyStatus", modeLabel, ghostLabel));
    }
  }
}

// ===================== 로비 / 시작 카운트 =====================
function clearCountdownTimer() {
  if (countdownIntervalTimer) {
    clearInterval(countdownIntervalTimer);
    countdownIntervalTimer = null;
  }
}

function startCountdown() {
  clearLobbyReadyStartTimer();
  clearCountdownTimer();
  if (isCountingDown || !canAcceptLobbyReadyInput()) return;

  if (ghostModeEnabled && !isDarkMode) {
    preGhostDarkMode = false;
    isDarkMode = true;
    applyTheme();
  }

  resetMatch();
  pauseLobbyBgm();
  pauseIngameBgm(true);

  const lobby = document.getElementById("lobby");
  const countdown = document.getElementById("countdownOverlay");
  const countNumber = document.getElementById("countNumber");

  lobby.style.display = "none";
  countdown.style.display = "flex";
  countdown.classList.toggle("item-mode", gameMode === "item");
  countdown.classList.toggle("classic-mode", gameMode === "speed");
  countdown.classList.toggle("ghost-mode", ghostModeEnabled);

  const isChaosCountdown = matchMode === "ai" && aiDifficulty === "chaos";
  // 카오스 카운트다운은 처음부터 해킹 화면으로 시작하지 않고, 2초부터 치지직거리며 급격히 침식되도록 한다.
  countdown.classList.remove("chaos-countdown", "chaos-breach", "chaos-count-3", "chaos-count-2", "chaos-count-1", "chaos-count-start");

  const applyChaosCountdownState = state => {
    if (!countdown) return;
    countdown.classList.remove("chaos-count-3", "chaos-count-2", "chaos-count-1", "chaos-count-start");
    if (!isChaosCountdown) return;

    if (state === "2" || state === "1" || state === "start") {
      countdown.classList.add("chaos-countdown", "chaos-breach", `chaos-count-${state}`);
    } else {
      countdown.classList.remove("chaos-countdown", "chaos-breach");
    }
  };

  const applyGhostCountdownState = state => {
    if (!countdown) return;
    countdown.classList.remove("ghost-count-3", "ghost-count-2", "ghost-count-1", "ghost-count-start");
    if (ghostModeEnabled && state) countdown.classList.add(`ghost-count-${state}`);
  };

  closePauseMenuVisual();
  setGamePhase(GAME_PHASE.COUNTDOWN);
  gameEnding = false;
  gameResultLocked = false;
  gameResultToken++;

  const setCountdownText = value => {
    countNumber.textContent = value;
    countNumber.setAttribute("data-chaos-text", String(value));
  };

  let count = 3;
  setCountdownText(count);
  applyGhostCountdownState("3");
  applyChaosCountdownState("3");
  DegulSfx.oneShot("countdown");

  countdownIntervalTimer = setInterval(() => {
    count--;

    if (count > 0) {
      setCountdownText(count);
      applyGhostCountdownState(String(count));
      applyChaosCountdownState(String(count));
      DegulSfx.oneShot("countdown");
    } else if (count === 0) {
      setCountdownText(tr("start"));
      applyGhostCountdownState("start");
      applyChaosCountdownState("start");
      DegulSfx.oneShot("start");
    } else {
      clearCountdownTimer();
      countdown.style.display = "none";
      countdown.classList.remove("chaos-countdown", "chaos-breach", "chaos-count-3", "chaos-count-2", "chaos-count-1", "chaos-count-start");
      countNumber.removeAttribute("data-chaos-text");
      applyGhostCountdownState(null);
      setGamePhase(GAME_PHASE.PLAYING);
      matchStartedAt = performance.now();
      matchEndedAt = 0;
      gameEnding = false;
      gameResultLocked = false;
      keys = {};
      if (matchMode === "ai" && typeof window.DegulAiRanking?.beginMatch === "function") {
        window.DegulAiRanking.beginMatch({
          difficulty: aiDifficulty,
          mode: gameMode === "item" ? "item" : "speed",
          ghostMode: !!ghostModeEnabled
        });
      }
      playIngameBgm();
      startItemSpawner();
    }
  }, 1000);
}


function disposeObjectTree(obj) {
  obj.traverse(child => {
    if (child.geometry) child.geometry.dispose();
    if (Array.isArray(child.material)) {
      child.material.forEach(disposeMaterialResource);
    } else {
      disposeMaterialResource(child.material);
    }
  });
}

function clearSceneExtras() {
  // 재시작 시 이동 피벗, 사망 파티클, 아이템처럼 scene에 직접 붙은 임시 오브젝트 제거
  const keepObjects = new Set([boardGroup, actorsGroup, backgroundGridGroup, hemiLight, dirLight]);
  const removable = scene.children.filter(obj => !keepObjects.has(obj));

  for (const obj of removable) {
    scene.remove(obj);
    disposeObjectTree(obj);
  }
}

function resetMatch() {
  if (typeof window.DegulAiRanking?.cancelMatch === "function") {
    window.DegulAiRanking.cancelMatch();
  }
  clearFrameTasks();
  clearCountdownTimer();
  DegulSfx.stopAll();
  pauseIngameBgm(true);
  stopItemSpawner();
  clearSceneExtras();
  clearClaimGlowEffects();
  clearSummonedAiAssists();
  clearDeathCameraCloseup();
  closePauseMenuVisual();
  setGamePhase(GAME_PHASE.LOBBY);
  gameEnding = false;
  gameResultLocked = false;
  gameResultToken++;
  keys = {};

  // 기존 오브젝트 제거
  if (boardGroup) {
    while (boardGroup.children.length > 0) {
      const obj = boardGroup.children[0];
      boardGroup.remove(obj);
      disposeObjectTree(obj);
    }
  }

  if (actorsGroup) {
    while (actorsGroup.children.length > 0) {
      const obj = actorsGroup.children[0];
      actorsGroup.remove(obj);
      disposeObjectTree(obj);
    }
  }

  if (typeof disposeBoardTileStates === "function") disposeBoardTileStates();
  boardTileRenderGroup = null;
  boardTileInstances = null;
  boardTileGeometry = null;
  specialBoardInstanceMeshes = [];
  boardTileBuckets = new Map();
  cells = [];
  land = [];
  landRainbowIndex = [];
  players = [];
  updateBuffUI();

  createBoard();
  createPlayers();
  applyTheme();
  updateScoreUI();
  fadeOutDominanceEdgeOverlay();
  fadeOutDominanceScoreGaugeUI();

  const message = document.getElementById("message");
  message.classList.remove("show");
  message.style.display = "none";
  const countdownOverlay = document.getElementById("countdownOverlay");
  countdownOverlay.style.display = "none";
  countdownOverlay.classList.remove("item-mode");
  countdownOverlay.classList.remove("classic-mode");
  countdownOverlay.classList.remove("ghost-mode");
  countdownOverlay.classList.remove("ghost-count-3", "ghost-count-2", "ghost-count-1", "ghost-count-start");

  closePauseMenuVisual();
  updatePauseMenuButtonVisibility();

  camera.position.set(0, 30, 28);
  camera.lookAt(0, 0, 0);
}

function returnToLobby() {
  pauseIngameBgm(true);
  const lobby = document.getElementById("lobby");
  const card = lobby.querySelector(".lobbyCard p");

  card.textContent = tr("lobbyDesc");
  lobby.style.display = "flex";
  closePauseMenuVisual();
  updatePauseMenuButtonVisibility();
  resetLobbyReady();
  playLobbyBgm();

  setGamePhase(GAME_PHASE.LOBBY);
}

function escapeResultHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatResultTime(ms) {
  if (!Number.isFinite(ms) || ms < 0) ms = 0;
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const tenths = Math.floor((ms % 1000) / 100);
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${tenths}`;
}

function getResultMatchTimeText() {
  const end = matchEndedAt || performance.now();
  const start = matchStartedAt || end;
  return formatResultTime(end - start);
}

function getResultScoreSnapshot() {
  const p1Count = countLand(P1_LAND);
  const p2Count = countLand(P2_LAND);
  const total = Math.max(1, GRID_SIZE * GRID_SIZE);
  return {
    p1Count,
    p2Count,
    p1Percent: Math.round((p1Count / total) * 100),
    p2Percent: Math.round((p2Count / total) * 100)
  };
}

function getResultPlayerColor(playerNum) {
  const source = playerNum === 1 ? p1 : p2;
  const fallback = playerNum === 1 ? 0x0a84ff : 0xff375f;
  const colorData = source && source.colorData ? source.colorData : null;
  const color = colorData && Number.isFinite(colorData.actor) ? colorData.actor : fallback;
  return `#${color.toString(16).padStart(6, "0")}`;
}

function getResultPlayerName(playerNum) {
  if (playerNum === 1) return "1P";
  if (matchMode === "ai") return tr("aiResultName", getAiDifficultyLabel(aiDifficulty));
  return "2P";
}

function getResultSkinClass(playerNum) {
  const source = playerNum === 1 ? p1 : p2;
  const skin = source && source.colorData && source.colorData.skin ? source.colorData.skin : "solid";
  const aiClass = playerNum === 2 && matchMode === "ai" ? ` aiDifficulty-${aiDifficulty}` : "";
  return `resultSkin-${skin}${aiClass}`;
}

function buildResultPlayerCard(playerNum, winner, score) {
  const player = playerNum === 1 ? p1 : p2;
  const isWinner = !!winner && player === winner;
  const isDraw = !winner;
  const status = isDraw ? tr("resultDrawBadge") : (isWinner ? tr("resultWinBadge") : tr("resultLoseBadge"));
  const statusClass = isDraw ? "draw" : (isWinner ? "winner" : "loser");
  const count = playerNum === 1 ? score.p1Count : score.p2Count;
  const percent = playerNum === 1 ? score.p1Percent : score.p2Percent;
  const color = getResultPlayerColor(playerNum);
  const playerName = getResultPlayerName(playerNum);
  const skinClass = getResultSkinClass(playerNum);

  return `
    <div class="resultPlayerCard p${playerNum} ${statusClass} ${skinClass}" data-result-ai="${playerNum === 2 && matchMode === "ai" ? "true" : "false"}" style="--result-block-color:${color}">
      <div class="resultBadge">${escapeResultHtml(status)}</div>
      <div class="resultBlockIcon" aria-hidden="true"></div>
      <div class="resultPlayerName">${escapeResultHtml(playerName)}</div>
      <div class="resultScoreLine"><strong>${percent}%</strong><span>${escapeResultHtml(tr("resultCells", count))}</span></div>
    </div>
  `;
}

function showResultPopup(winner, reasonText) {
  const message = document.getElementById("message");
  const result = document.getElementById("resultText");
  const score = getResultScoreSnapshot();
  const safeReason = escapeResultHtml(reasonText).replace(/\n/g, "<br>");
  const resultTitle = winner ? `${winner.name} ${tr("win")}` : tr("draw");
  const resultSubtitle = winner ? "" : tr("drawSubtitle");
  const reasonLabel = winner ? tr("winReason") : tr("resultReason");
  const unlockNotice = pendingSkinUnlockNotice ? `<span class="skinUnlockNotice">${pendingSkinUnlockNotice}</span>` : "";
  const hideRetry = !!(window.DegulOnlineRoom && typeof window.DegulOnlineRoom.hasActiveMatchState === "function" && window.DegulOnlineRoom.hasActiveMatchState());
  pendingSkinUnlockNotice = "";

  result.innerHTML = `
    <div class="resultTimerBar">
      <span class="resultTimerLabel">${escapeResultHtml(tr("playTime"))}</span>
      <span class="resultTimerValue">${getResultMatchTimeText()}</span>
    </div>
    <h1 class="resultTitleV2">${escapeResultHtml(resultTitle)}</h1>
    ${resultSubtitle ? `<p class="resultSubtitleV2">${resultSubtitle}</p>` : ""}
    <div class="resultVsBoard">
      ${buildResultPlayerCard(1, winner, score)}
      <div class="resultVsMark">VS</div>
      ${buildResultPlayerCard(2, winner, score)}
    </div>
    <div class="resultReasonBox"><b>${escapeResultHtml(reasonLabel)}</b>${safeReason}${unlockNotice}</div>
    <div class="resultActions">
      ${hideRetry ? "" : `<button onclick="retryResultMatch()">${escapeResultHtml(tr("retry"))}</button>`}
      <button class="secondary" onclick="closeResultToLobby()">${escapeResultHtml(tr("backToLobby"))}</button>
    </div>
  `;

  message.style.display = "block";
  requestAnimationFrame(() => message.classList.add("show"));
}

function hideResultPopupThen(callback) {
  const message = document.getElementById("message");
  message.classList.remove("show");
  setTimeout(() => {
    message.style.display = "none";
    if (typeof callback === "function") callback();
  }, 180);
}

function retryResultMatch() {
  hideResultPopupThen(() => {
    document.getElementById("lobby").style.display = "flex";
    readyState = { 1: true, 2: true };
    if (matchMode === "ai") readyState[2] = true;
    updateReadyUI();
    startCountdown();
  });
}

function closeResultToLobby() {
  hideResultPopupThen(() => {
    restartGame();
  });
}


function updateDominanceEdgeOverlay(p1Percent, p2Percent, p1Count, p2Count) {
  const overlay = document.getElementById("dominanceEdgeOverlay");
  if (!overlay) return;

  if (gameOver || isCountingDown || !gameStarted) {
    overlay.classList.remove("show", "p1", "p2");
    overlay.classList.add("fade-out");
    return;
  }

  const p1Dominant = p1Percent >= 50 && p1Count > p2Count;
  const p2Dominant = p2Percent >= 50 && p2Count > p1Count;

  overlay.classList.remove("fade-out", "p1", "p2");

  if (p1Dominant) {
    const leadPower = Math.min(1, Math.max(0.34, (p1Percent - 50) / 22 + 0.34));
    overlay.style.setProperty("--dominance-alpha", leadPower.toFixed(2));
    overlay.classList.add("show", "p1");
  } else if (p2Dominant) {
    const leadPower = Math.min(1, Math.max(0.34, (p2Percent - 50) / 22 + 0.34));
    overlay.style.setProperty("--dominance-alpha", leadPower.toFixed(2));
    overlay.classList.add("show", "p2");
  } else {
    overlay.classList.remove("show");
  }
}

function fadeOutDominanceEdgeOverlay() {
  const overlay = document.getElementById("dominanceEdgeOverlay");
  if (!overlay) return;
  overlay.classList.add("fade-out");
  overlay.classList.remove("show");
  setTimeout(() => {
    overlay.classList.remove("p1", "p2");
  }, 950);
}



function updateDominanceScoreGaugeUI(p1Percent, p2Percent, p1Count, p2Count) {
  const scoreUI = document.getElementById("scoreUI");
  if (!scoreUI) return;

  if (gameOver || isCountingDown || !gameStarted) {
    scoreUI.classList.remove("dominance-score-active", "score-p1-leading", "score-p2-leading");
    scoreUI.classList.add("dominance-score-fade");
    scoreUI.style.setProperty("--dominance-ui-fill", "0%");
    return;
  }

  const p1Dominant = p1Percent >= 50 && p1Count > p2Count;
  const p2Dominant = p2Percent >= 50 && p2Count > p1Count;

  scoreUI.classList.remove("dominance-score-fade", "score-p1-leading", "score-p2-leading");

  if (p1Dominant) {
    // 요청 반영: 50% = UI 절반(50%), 60% 이상 = UI 끝까지(100%)
    // 51%, 52%처럼 1% 단위로 올라갈 때마다 채움 폭이 5%씩 늘어나도록 조정
    const fill = Math.max(50, Math.min(100, 50 + ((p1Percent - 50) * 5)));
    scoreUI.style.setProperty("--dominance-ui-fill", `${fill}%`);
    scoreUI.style.setProperty("--dominance-ui-glow", "rgba(125,199,255,0.46)");
    scoreUI.classList.add("dominance-score-active", "score-p1-leading");
  } else if (p2Dominant) {
    const fill = Math.max(50, Math.min(100, 50 + ((p2Percent - 50) * 5)));
    scoreUI.style.setProperty("--dominance-ui-fill", `${fill}%`);
    scoreUI.style.setProperty("--dominance-ui-glow", "rgba(255,146,184,0.46)");
    scoreUI.classList.add("dominance-score-active", "score-p2-leading");
  } else {
    scoreUI.classList.remove("dominance-score-active", "score-p1-leading", "score-p2-leading");
    scoreUI.style.setProperty("--dominance-ui-fill", "0%");
  }
}

function fadeOutDominanceScoreGaugeUI() {
  const scoreUI = document.getElementById("scoreUI");
  if (!scoreUI) return;
  scoreUI.classList.add("dominance-score-fade");
  scoreUI.classList.remove("dominance-score-active");
  scoreUI.style.setProperty("--dominance-ui-fill", "0%");
  setTimeout(() => {
    scoreUI.classList.remove("score-p1-leading", "score-p2-leading", "dominance-score-fade");
  }, 950);
}


