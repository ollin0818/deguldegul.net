// ===================== 초기화 =====================
function init() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0xe9edf3);
  scene.fog = null;

  camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 200);
  camera.position.set(0, 30, 28);
  camera.lookAt(0, 0, 0);

  renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: "high-performance" });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = false;
  // 1차 최적화: 저사양 노트북 렉 감소를 위해 실시간 그림자는 비활성화
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  document.body.appendChild(renderer.domElement);
  createGhostVisionOverlay();

  hemiLight = new THREE.HemisphereLight(0xffffff, 0xd9e6ff, 1.6);
  scene.add(hemiLight);

  dirLight = new THREE.DirectionalLight(0xffffff, 1.35);
  dirLight.position.set(12, 22, 10);
  dirLight.castShadow = false;
  dirLight.shadow.mapSize.width = 512;
  dirLight.shadow.mapSize.height = 512;
  scene.add(dirLight);

  createPerspectiveBackgroundGrid();

  boardGroup = new THREE.Group();
  actorsGroup = new THREE.Group();
  scene.add(boardGroup);
  scene.add(actorsGroup);

  createBoard();
  createPlayers();
  isDarkMode = localStorage.getItem("blockLandDarkMode") === "1";
  applyTheme();
  buildLobbyPalettes();
  updateGameModeUI();
  updateReadyUI();
  updateScoreUI();
  setupLobbyBgm();
  applyLanguage();
  setupMobileControlLayer();
  showPrivacyConsentIfNeeded();

  window.addEventListener("resize", onResize);
  document.addEventListener("pointerdown", () => DegulSfx.unlock(), { passive: true });
  document.addEventListener("click", e => {
    if (e.target && e.target.closest && e.target.closest("button")) DegulSfx.oneShot("button");
  }, true);
  window.addEventListener("keydown", e => {
    if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Control", "Enter", " ", "Escape"].includes(e.key)) {
      e.preventDefault();
    }
    keys[e.key.toLowerCase()] = true;
    keys[e.key] = true;
    tryStartLobbyBgm();
    DegulSfx.unlock();

    if (e.key === "Escape") {
      e.preventDefault();
      const settingsOverlay = document.getElementById("settingsOverlay");
      const settingsOpen = settingsOverlay && settingsOverlay.classList.contains("show");
      if (settingsOpen) {
        closeSettingsPopup();
        return;
      }
      const lobbyVisible = !gameStarted && document.getElementById("lobby") && document.getElementById("lobby").style.display !== "none";
      const pcLobby = lobbyVisible && !document.body.classList.contains("mobile-device") && !document.body.classList.contains("tablet-device");
      if (pcLobby) {
        openSettingsPopup();
        return;
      }
      if (gameStarted && !gameOver && !isCountingDown) {
        togglePauseMenu();
        return;
      }
    }

    if (isPaused) return;

    if (canAcceptLobbyReadyInput()) {
      if (e.key === "Control") {
        e.preventDefault();
        if (!e.repeat) setReady(1, !readyState[1]);
      }
      if (e.key === "Enter" && matchMode !== "ai") {
        e.preventDefault();
        if (!e.repeat) setReady(2, !readyState[2]);
      }
    }

    if (e.key.toLowerCase() === "r") restartGame();
  });
  window.addEventListener("keyup", e => {
    keys[e.key.toLowerCase()] = false;
    keys[e.key] = false;
  });
}


// ===================== 인게임 배경: 게임판과 같은 기울기의 확장 네모 그리드 =====================
function isExtremeAiBackgroundActive() {
  return matchMode === "ai" && aiDifficulty === "extreme";
}

function isHellAiBackgroundActive() {
  return matchMode === "ai" && aiDifficulty === "hell";
}

function isChaosAiBackgroundActive() {
  return matchMode === "ai" && aiDifficulty === "chaos";
}

function isExtremeOrHellAiBoardDarkActive() {
  return matchMode === "ai" && (aiDifficulty === "extreme" || aiDifficulty === "hell" || aiDifficulty === "chaos");
}

function getPerspectiveGridTheme() {
  if (isChaosAiBackgroundActive()) {
    return {
      floor: 0x001307,
      line: 0x00ff78,
      strongLine: 0x00ffcc,
      boardEdge: 0xb8ffd8,
      floorOpacity: 0.96,
      lineOpacity: 0.54,
      strongOpacity: 0.84,
      edgeOpacity: 0.72,
      extreme: false,
      hell: false,
      chaos: true,
      sparkleColor: 0x00ff78,
      floorEmissive: 0x003b1e
    };
  }

  if (isHellAiBackgroundActive()) {
    return {
      floor: 0x120000,
      line: 0xff3b1f,
      strongLine: 0xffb000,
      boardEdge: 0xffd08a,
      floorOpacity: 0.96,
      lineOpacity: 0.58,
      strongOpacity: 0.86,
      edgeOpacity: 0.74,
      extreme: false,
      hell: true,
      sparkleColor: 0xffb000,
      floorEmissive: 0x5a0000
    };
  }

  if (isExtremeAiBackgroundActive()) {
    return {
      floor: 0x14001f,
      line: 0x9b5cff,
      strongLine: 0xd8b4fe,
      boardEdge: 0xf5d0fe,
      floorOpacity: 0.94,
      lineOpacity: 0.56,
      strongOpacity: 0.84,
      edgeOpacity: 0.72,
      extreme: true,
      hell: false,
      sparkleColor: 0xd8b4fe,
      floorEmissive: 0x3b0764
    };
  }

  if (isDarkMode) {
    return {
      floor: 0x080b12,
      line: 0x5c6676,
      strongLine: 0x8994a8,
      boardEdge: 0xf5f7fb,
      floorOpacity: 0.98,
      lineOpacity: 0.36,
      strongOpacity: 0.58,
      edgeOpacity: 0.48,
      extreme: false,
      hell: false,
      sparkleColor: 0xd8b4fe,
      floorEmissive: 0x000000
    };
  }

  return {
    floor: 0xe8ecf2,
    line: 0xb6beca,
    strongLine: 0xa5afbd,
    boardEdge: 0xffffff,
    floorOpacity: 0.96,
    lineOpacity: 0.42,
    strongOpacity: 0.60,
    edgeOpacity: 0.34,
    extreme: false,
    hell: false,
    sparkleColor: 0xd8b4fe,
    floorEmissive: 0x000000
  };
}

function updatePerspectiveBackgroundGridTheme() {
  if (!backgroundGridGroup) return;
  const theme = getPerspectiveGridTheme();

  backgroundGridGroup.traverse(obj => {
    if (!obj.material) return;
    const role = obj.userData && obj.userData.gridRole;
    if (role === "floor") {
      obj.material.color.set(theme.floor);
      obj.material.opacity = theme.floorOpacity;
      if (obj.material.emissive) {
        obj.material.emissive.set(theme.floorEmissive || 0x000000);
        obj.material.emissiveIntensity = (theme.extreme || theme.hell || theme.chaos) ? 0.22 : 0;
      }
      obj.material.needsUpdate = true;
    } else if (role === "line") {
      obj.material.color.set(theme.line);
      obj.material.opacity = theme.lineOpacity;
      obj.material.needsUpdate = true;
    } else if (role === "strongLine") {
      obj.material.color.set(theme.strongLine);
      obj.material.opacity = theme.strongOpacity;
      obj.material.needsUpdate = true;
    } else if (role === "boardEdge") {
      obj.material.color.set(theme.boardEdge);
      obj.material.opacity = theme.edgeOpacity;
      obj.material.needsUpdate = true;
    } else if (role === "extremeSparkle") {
      const activeSparkle = !!(theme.extreme || theme.hell || theme.chaos);
      obj.visible = activeSparkle;
      obj.material.color.set(theme.sparkleColor || 0xd8b4fe);
      obj.material.opacity = activeSparkle ? (theme.hell ? 0.64 : 0.58) : 0;
      obj.material.needsUpdate = true;
    }
  });
}

// ===================== 인게임 배경: 게임판 규격과 정확히 맞는 확장 네모 그리드 =====================
function createPerspectiveBackgroundGrid() {
  if (backgroundGridGroup) {
    scene.remove(backgroundGridGroup);
    disposeObjectTree(backgroundGridGroup);
  }

  const theme = getPerspectiveGridTheme();
  backgroundGridGroup = new THREE.Group();
  backgroundGridGroup.name = "BoardExactExtendedGrid";

  // 실제 보드 타일 중심은 -15 ~ 15, 타일 논리 경계는 -15.5 ~ 15.5다.
  // 배경 그리드는 이 경계선 기준으로 1칸씩 확장해서 보드 칸과 정확히 맞춘다.
  const tileStep = CELL;
  const boardEdge = GRID_SIZE * CELL * 0.5;
  const extendTiles = 48;
  const half = boardEdge + extendTiles * CELL;
  const y = -0.112;

  const floorGeo = new THREE.PlaneGeometry(half * 2, half * 2, 1, 1);
  const floorMat = new THREE.MeshStandardMaterial({
    color: theme.floor,
    roughness: 0.98,
    metalness: 0,
    transparent: true,
    opacity: theme.floorOpacity,
    side: THREE.DoubleSide,
    depthWrite: false
  });
  floorMat.userData = { gridRole: "floor" };
  const floor = new THREE.Mesh(floorGeo, floorMat);
  floor.userData.gridRole = "floor";
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = y - 0.02;
  floor.receiveShadow = true;
  floor.renderOrder = -40;
  backgroundGridGroup.add(floor);

  const lineMat = new THREE.LineBasicMaterial({
    color: theme.line,
    transparent: true,
    opacity: theme.lineOpacity,
    depthWrite: false
  });
  lineMat.userData = { gridRole: "line" };

  const strongLineMat = new THREE.LineBasicMaterial({
    color: theme.strongLine,
    transparent: true,
    opacity: theme.strongOpacity,
    depthWrite: false
  });
  strongLineMat.userData = { gridRole: "strongLine" };

  function addLine(x1, z1, x2, z2, strong = false) {
    const geo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(x1, y, z1),
      new THREE.Vector3(x2, y, z2)
    ]);
    const line = new THREE.Line(geo, strong ? strongLineMat : lineMat);
    line.userData.gridRole = strong ? "strongLine" : "line";
    line.renderOrder = -30;
    backgroundGridGroup.add(line);
  }

  // 칸 경계선(-15.5, -14.5, ... 15.5)과 같은 규격으로 무한 확장.
  // 이렇게 해야 보드 타일의 1칸과 배경 네모칸 1칸이 정확히 이어진다.
  const start = -half;
  const end = half;
  const lineCount = Math.round((end - start) / tileStep);
  for (let n = 0; n <= lineCount; n++) {
    const v = start + n * tileStep;
    const gridIndexFromBoardEdge = Math.round((v + boardEdge) / tileStep);
    const strong = gridIndexFromBoardEdge % 5 === 0;
    addLine(v, start, v, end, strong);
    addLine(start, v, end, v, strong);
  }

  // 실제 게임판의 논리 외곽선. 배경 그리드와 보드의 첫 경계가 딱 맞는지 확인 가능하게 옅게 표시.
  const edgeMat = new THREE.LineBasicMaterial({
    color: theme.boardEdge,
    transparent: true,
    opacity: theme.edgeOpacity,
    depthWrite: false
  });
  edgeMat.userData = { gridRole: "boardEdge" };
  const edgeOffset = boardEdge;
  const edgePoints = [
    [new THREE.Vector3(-edgeOffset, y + 0.004, -edgeOffset), new THREE.Vector3(edgeOffset, y + 0.004, -edgeOffset)],
    [new THREE.Vector3(edgeOffset, y + 0.004, -edgeOffset), new THREE.Vector3(edgeOffset, y + 0.004, edgeOffset)],
    [new THREE.Vector3(edgeOffset, y + 0.004, edgeOffset), new THREE.Vector3(-edgeOffset, y + 0.004, edgeOffset)],
    [new THREE.Vector3(-edgeOffset, y + 0.004, edgeOffset), new THREE.Vector3(-edgeOffset, y + 0.004, -edgeOffset)]
  ];
  edgePoints.forEach(points => {
    const geo = new THREE.BufferGeometry().setFromPoints(points);
    const line = new THREE.Line(geo, edgeMat);
    line.userData.gridRole = "boardEdge";
    line.renderOrder = -25;
    backgroundGridGroup.add(line);
  });

  // AI 익스트림 전용: 익스트림 스킨 색의 보라색 반짝임 포인트.
  // 항상 생성해두고 난이도가 로봇청소기일 때만 표시해, 다른 모드 성능에는 영향이 거의 없게 한다.
  const sparklePositions = [];
  const sparkleCount = 120;
  for (let i = 0; i < sparkleCount; i++) {
    const seedX = Math.sin(i * 12.9898) * 43758.5453;
    const seedZ = Math.sin(i * 78.233) * 24634.6345;
    const rx = seedX - Math.floor(seedX);
    const rz = seedZ - Math.floor(seedZ);
    sparklePositions.push(
      -half + rx * half * 2,
      y + 0.018 + ((i % 5) * 0.002),
      -half + rz * half * 2
    );
  }

  const sparkleGeo = new THREE.BufferGeometry();
  sparkleGeo.setAttribute("position", new THREE.Float32BufferAttribute(sparklePositions, 3));
  const sparkleMat = new THREE.PointsMaterial({
    color: theme.sparkleColor || 0xd8b4fe,
    size: 0.095,
    transparent: true,
    opacity: (theme.extreme || theme.hell || theme.chaos) ? (theme.hell ? 0.64 : (theme.chaos ? 0.68 : 0.58)) : 0,
    depthWrite: false,
    blending: THREE.AdditiveBlending
  });
  sparkleMat.userData = { gridRole: "extremeSparkle" };
  const sparkle = new THREE.Points(sparkleGeo, sparkleMat);
  sparkle.userData.gridRole = "extremeSparkle";
  sparkle.visible = !!(theme.extreme || theme.hell || theme.chaos);
  sparkle.renderOrder = -20;
  backgroundGridGroup.add(sparkle);

  backgroundGridGroup.renderOrder = -50;
  scene.add(backgroundGridGroup);
}

// ===================== 보드 생성 =====================
function createBoard() {
  cells = [];
  land = [];
  landRainbowIndex = [];
  rainbowClaimCounters[P1_LAND] = 0;
  rainbowClaimCounters[P2_LAND] = 0;

  const baseGeo = new THREE.BoxGeometry(TILE_VISUAL_SIZE, 0.08, TILE_VISUAL_SIZE);

  for (let z = 0; z < GRID_SIZE; z++) {
    cells[z] = [];
    land[z] = [];

    for (let x = 0; x < GRID_SIZE; x++) {
      land[z][x] = EMPTY;

      const mat = new THREE.MeshStandardMaterial({
        color: 0xf1f4ff,
        roughness: 0.72,
        metalness: 0.03
      });

      const tile = new THREE.Mesh(baseGeo, mat);
      tile.position.set(toWorld(x), -0.04, toWorld(z));
      tile.receiveShadow = true;
      boardGroup.add(tile);

      cells[z][x] = tile;
    }
  }

  // 1P 시작 땅: 좌측 하단
  markSquareLand(5, GRID_SIZE - 6, 2, P1_LAND);

  // 2P 시작 땅: 우측 상단
  markSquareLand(GRID_SIZE - 6, 5, 2, P2_LAND);

  createBoardSeamGrid();
  refreshBoardColors();
}

// 인게임 타일 경계 보정: 실제 타일 크기를 줄여 생긴 일정한 틈 위에
// 아주 얇은 보조 라인만 얹어 칸 구분이 균일하게 보이도록 한다.
function createBoardSeamGrid() {
  if (!boardGroup) return;

  if (boardSeamGrid) {
    boardGroup.remove(boardSeamGrid);
    if (boardSeamGrid.geometry) boardSeamGrid.geometry.dispose();
    if (boardSeamGrid.material) boardSeamGrid.material.dispose();
    boardSeamGrid = null;
  }

  const boardEdge = GRID_SIZE * CELL * 0.5;
  const y = 0.092;
  const positions = [];

  for (let i = 0; i <= GRID_SIZE; i++) {
    const v = -boardEdge + i * CELL;
    positions.push(v, y, -boardEdge, v, y, boardEdge);
    positions.push(-boardEdge, y, v, boardEdge, y, v);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));

  const mat = new THREE.LineBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.26,
    depthWrite: false
  });

  boardSeamGrid = new THREE.LineSegments(geo, mat);
  boardSeamGrid.name = "BoardTileSeamGrid";
  boardSeamGrid.renderOrder = 25;
  boardGroup.add(boardSeamGrid);
  updateBoardSeamGridTheme();
}

function updateBoardSeamGridTheme() {
  if (!boardSeamGrid || !boardSeamGrid.material) return;
  boardSeamGrid.material.color.set(isExtremeOrHellAiBoardDarkActive() || isDarkMode ? 0xe8eef8 : 0xffffff);
  boardSeamGrid.material.opacity = ghostModeEnabled ? 0.34 : (isExtremeOrHellAiBoardDarkActive() ? 0.32 : 0.26);
  boardSeamGrid.material.needsUpdate = true;
}

function markSquareLand(cx, cz, radius, owner) {
  const claimedCells = [];
  for (let z = cz - radius; z <= cz + radius; z++) {
    for (let x = cx - radius; x <= cx + radius; x++) {
      if (inBounds(x, z)) {
        land[z][x] = owner;
        claimedCells.push({x, z});
      }
    }
  }
  assignRainbowIndices(owner, claimedCells);
}


// ===================== 보드 렌더링 최적화 =====================
// 전체 보드 색상을 매번 다시 적용하지 않고, 실제로 점령 상태가 바뀐 칸만 갱신한다.
// 판정 배열(land)은 그대로 유지하고, 시각 표현만 부분 업데이트한다.
function refreshBoardCells(changedCells) {
  if (!changedCells || !changedCells.length) return;

  // 한 번에 너무 넓은 영역이 바뀌는 경우에는 전체 갱신이 더 안전하고 빠르다.
  if (changedCells.length > GRID_SIZE * GRID_SIZE * 0.42) {
    refreshBoardColors();
    return;
  }

  const seen = new Set();
  for (const cell of changedCells) {
    if (!cell || !inBounds(cell.x, cell.z)) continue;
    const key = `${cell.x},${cell.z}`;
    if (seen.has(key)) continue;
    seen.add(key);
    refreshBoardCell(cell.x, cell.z);
  }
}

function refreshBoardCell(x, z) {
  if (!cells || !cells[z] || !cells[z][x]) return;

  const colors = getThemeColors();
  const tile = cells[z][x];

  tile.userData.extremeAiLand = false;
  tile.userData.hellAiLand = false;
  tile.userData.chaosAiLand = false;
  tile.userData.extremeAiPhase = tile.userData.extremeAiPhase || Math.random() * Math.PI * 2;

  const applyChessLandCell = () => {
    tile.material.map = null;
    tile.material.color.set(((x + z) % 2 === 0) ? 0xf8fafc : 0x111827);
    tile.material.roughness = 0.34;
    tile.material.metalness = 0.06;
    tile.material.emissive.set(0x000000);
    tile.material.emissiveIntensity = 0;
    tile.material.needsUpdate = true;
  };

  if (land[z][x] === P1_LAND) {
    const colorData = selectedColors[1];
    if (isRainbowColorData(colorData)) {
      tile.material.map = null;
      tile.material.color.set(getRainbowLandColor(getRainbowCellIndex(x, z, P1_LAND)));
      tile.material.roughness = 0.46;
      tile.material.metalness = 0.04;
      tile.material.needsUpdate = true;
    } else if (colorData && colorData.skin === "chess") {
      applyChessLandCell();
    } else {
      applySkinToMaterial(tile.material, colorData, "land");
    }

    if (colorData && (colorData.skin === "extreme" || colorData.skin === "hell" || colorData.skin === "chaos")) {
      tile.userData.extremeAiLand = true;
      tile.userData.hellAiLand = colorData.skin === "hell";
      tile.userData.chaosAiLand = colorData.skin === "chaos";
      tile.material.emissive.set(colorData.skin === "hell" ? 0xff4500 : (colorData.skin === "chaos" ? 0x00ff78 : 0x843cff));
      tile.material.emissiveIntensity = colorData.skin === "hell" ? 0.30 : (colorData.skin === "chaos" ? 0.38 : 0.22);
    } else {
      tile.material.emissive.set(0x000000);
      tile.material.emissiveIntensity = 0;
    }

    tile.position.y = 0.02;
    tile.scale.y = 1.55;
  } else if (land[z][x] === P2_LAND) {
    const colorData = matchMode === "ai" ? getAiColorData() : selectedColors[2];
    if (isRainbowColorData(colorData)) {
      tile.material.map = null;
      tile.material.color.set(getRainbowLandColor(getRainbowCellIndex(x, z, P2_LAND)));
      tile.material.roughness = 0.46;
      tile.material.metalness = 0.04;
      tile.material.needsUpdate = true;
    } else if (colorData && colorData.skin === "chess") {
      applyChessLandCell();
    } else {
      applySkinToMaterial(tile.material, colorData, "land");
    }

    if (colorData && (colorData.skin === "extreme" || colorData.skin === "hell" || colorData.skin === "chaos")) {
      tile.userData.extremeAiLand = true;
      tile.userData.hellAiLand = colorData.skin === "hell";
      tile.userData.chaosAiLand = colorData.skin === "chaos";
      tile.material.emissive.set(colorData.skin === "hell" ? 0xff4500 : (colorData.skin === "chaos" ? 0x00ff78 : 0x843cff));
      tile.material.emissiveIntensity = colorData.skin === "hell" ? 0.30 : (colorData.skin === "chaos" ? 0.38 : 0.22);
    } else {
      tile.userData.extremeAiLand = false;
      tile.userData.hellAiLand = false;
      tile.userData.chaosAiLand = false;
      tile.material.emissive.set(0x000000);
      tile.material.emissiveIntensity = 0;
    }

    tile.position.y = 0.02;
    tile.scale.y = 1.55;
  } else {
    tile.material.map = null;
    tile.material.color.set(colors.emptyLand);
    tile.material.roughness = 0.72;
    tile.material.metalness = 0.03;
    tile.material.needsUpdate = true;
    tile.material.emissive.set(0x000000);
    tile.material.emissiveIntensity = 0;

    tile.position.y = -0.04;
    tile.scale.y = 1;
  }

}


function refreshBoardColors() {
  const colors = getThemeColors();

  for (let z = 0; z < GRID_SIZE; z++) {
    for (let x = 0; x < GRID_SIZE; x++) {
      const tile = cells[z][x];

      tile.userData.extremeAiLand = false;
      tile.userData.hellAiLand = false;
      tile.userData.chaosAiLand = false;
      tile.userData.extremeAiPhase = tile.userData.extremeAiPhase || Math.random() * Math.PI * 2;
      const applyChessLandCell = () => {
        tile.material.map = null;
        tile.material.color.set(((x + z) % 2 === 0) ? 0xf8fafc : 0x111827);
        tile.material.roughness = 0.34;
        tile.material.metalness = 0.06;
        tile.material.emissive.set(0x000000);
        tile.material.emissiveIntensity = 0;
        tile.material.needsUpdate = true;
      };

      if (land[z][x] === P1_LAND) {
        const colorData = selectedColors[1];
        if (isRainbowColorData(colorData)) {
          tile.material.map = null;
          tile.material.color.set(getRainbowLandColor(getRainbowCellIndex(x, z, P1_LAND)));
          tile.material.roughness = 0.46;
          tile.material.metalness = 0.04;
          tile.material.needsUpdate = true;
        } else if (colorData && colorData.skin === "chess") {
          applyChessLandCell();
        } else {
          applySkinToMaterial(tile.material, colorData, "land");
        }
        if (colorData && (colorData.skin === "extreme" || colorData.skin === "hell" || colorData.skin === "chaos")) {
          tile.userData.extremeAiLand = true;
          tile.userData.hellAiLand = colorData.skin === "hell";
          tile.userData.chaosAiLand = colorData.skin === "chaos";
          tile.material.emissive.set(colorData.skin === "hell" ? 0xff4500 : (colorData.skin === "chaos" ? 0x00ff78 : 0x843cff));
          tile.material.emissiveIntensity = colorData.skin === "hell" ? 0.30 : (colorData.skin === "chaos" ? 0.38 : 0.22);
        } else {
          tile.userData.extremeAiLand = false;
          tile.userData.hellAiLand = false;
          tile.userData.chaosAiLand = false;
          tile.material.emissive.set(0x000000);
          tile.material.emissiveIntensity = 0;
        }

        // 점령된 블록은 살짝 올라오게 해서 입체감 강화
        tile.position.y = 0.02;
        tile.scale.y = 1.55;
      } else if (land[z][x] === P2_LAND) {
        const colorData = matchMode === "ai" ? getAiColorData() : selectedColors[2];
        if (isRainbowColorData(colorData)) {
          tile.material.map = null;
          tile.material.color.set(getRainbowLandColor(getRainbowCellIndex(x, z, P2_LAND)));
          tile.material.roughness = 0.46;
          tile.material.metalness = 0.04;
          tile.material.needsUpdate = true;
        } else if (colorData && colorData.skin === "chess") {
          applyChessLandCell();
        } else {
          applySkinToMaterial(tile.material, colorData, "land");
        }
        if (colorData && (colorData.skin === "extreme" || colorData.skin === "hell" || colorData.skin === "chaos")) {
          tile.userData.extremeAiLand = true;
          tile.userData.hellAiLand = colorData.skin === "hell";
          tile.userData.chaosAiLand = colorData.skin === "chaos";
          tile.material.emissive.set(colorData.skin === "hell" ? 0xff4500 : (colorData.skin === "chaos" ? 0x00ff78 : 0x843cff));
          tile.material.emissiveIntensity = colorData.skin === "hell" ? 0.30 : (colorData.skin === "chaos" ? 0.38 : 0.22);
        } else {
          tile.userData.extremeAiLand = false;
          tile.userData.hellAiLand = false;
          tile.userData.chaosAiLand = false;
          tile.material.emissive.set(0x000000);
          tile.material.emissiveIntensity = 0;
        }

        // 점령된 블록은 살짝 올라오게 해서 입체감 강화
        tile.position.y = 0.02;
        tile.scale.y = 1.55;
      } else {
        tile.material.map = null;
        tile.material.color.set(colors.emptyLand);
        tile.material.roughness = 0.72;
        tile.material.metalness = 0.03;
        tile.material.needsUpdate = true;
        tile.userData.extremeAiLand = false;
        tile.userData.hellAiLand = false;
        tile.userData.chaosAiLand = false;
        tile.material.emissive.set(0x000000);
        tile.material.emissiveIntensity = 0;

        // 빈 블록은 기본 높이로 유지
        tile.position.y = -0.04;
        tile.scale.y = 1;
      }
    }
  }
}

function updateExtremeAiLandSparkle() {
  if (!cells || !cells.length) return;

  const now = performance.now();
  for (let z = 0; z < GRID_SIZE; z++) {
    if (!cells[z]) continue;
    for (let x = 0; x < GRID_SIZE; x++) {
      const tile = cells[z][x];
      if (!tile || !tile.userData || !tile.userData.extremeAiLand || !tile.material) continue;

      const phase = tile.userData.extremeAiPhase || 0;
      const isHell = !!tile.userData.hellAiLand;
      const isChaos = !!tile.userData.chaosAiLand;
      const pulse = isHell
        ? 0.42 + Math.max(0, Math.sin(now * 0.0068 + phase)) * 0.56
        : (isChaos
          ? 0.38 + Math.max(0, Math.sin(now * 0.0115 + phase)) * 0.64
          : 0.34 + Math.max(0, Math.sin(now * 0.0055 + phase)) * 0.46);
      const twinkle = Math.max(0, Math.sin(now * (isHell ? 0.022 : (isChaos ? 0.038 : 0.017)) + phase * 2.7)) * (isHell ? 0.26 : (isChaos ? 0.36 : 0.18));

      if (isHell) {
        const lavaWave = Math.max(0, Math.sin(now * 0.009 + phase * 1.4));
        const lavaColor = lavaWave > 0.58 ? 0xffb000 : (lavaWave > 0.25 ? 0xff4500 : 0x6b0000);
        tile.material.emissive.set(lavaColor);
        tile.material.emissiveIntensity = pulse + twinkle;
        tile.position.y = 0.02 + Math.max(0, Math.sin(now * 0.008 + phase)) * 0.026;
      } else if (isChaos) {
        const glitch = Math.sin(now * 0.041 + phase * 5.1) > 0.72;
        tile.material.emissive.set(glitch ? 0x00ffcc : 0x00ff78);
        tile.material.emissiveIntensity = pulse + twinkle + (glitch ? 0.42 : 0);
        tile.position.y = 0.02 + Math.max(0, Math.sin(now * 0.010 + phase)) * 0.024 + (glitch ? 0.012 : 0);
      } else {
        tile.material.emissive.set(0x843cff);
        tile.material.emissiveIntensity = pulse + twinkle;
        tile.position.y = 0.02 + Math.max(0, Math.sin(now * 0.006 + phase)) * 0.018;
      }
    }
  }
}

