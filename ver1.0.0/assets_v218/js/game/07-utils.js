// ===================== 유틸 =====================
function getOpponent(actor) {
  return actor === p1 ? p2 : p1;
}

function pointKey(x, z) {
  return z * GRID_SIZE + x;
}

function createPointList() {
  const list = [];
  list.pointSet = new Set();
  return list;
}

function containsPoint(arr, x, z) {
  if (!arr) return false;
  if (arr.pointSet) return arr.pointSet.has(pointKey(x, z));
  return arr.some(p => p.x === x && p.z === z);
}

function inBounds(x, z) {
  return x >= 0 && z >= 0 && x < GRID_SIZE && z < GRID_SIZE;
}

function toWorld(i) {
  return (i - HALF) * CELL;
}

function countLand(owner) {
  let c = 0;
  for (let z = 0; z < GRID_SIZE; z++) {
    for (let x = 0; x < GRID_SIZE; x++) {
      if (land[z][x] === owner) c++;
    }
  }
  return c;
}

function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

function smootherStep(t) {
  t = Math.max(0, Math.min(1, t));
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function updateCamera() {
  if (deathCameraFocus) return;

  // 카메라 고정: 플레이어가 움직여도 시점은 따라가지 않음
  // 지옥/카오스 AI 난이도는 각 BGM BPM에 맞춰 아주 약한 줌 펄스를 적용한다.
  const bpmCameraPulse =
    matchMode === "ai" && gameStarted && !gameOver && !isCountingDown
      ? (aiDifficulty === "hell" ? 149 : (aiDifficulty === "chaos" ? 160 : 0))
      : 0;

  if (bpmCameraPulse) {
    const beatMs = 60000 / bpmCameraPulse;
    const beat = (performance.now() % beatMs) / beatMs;
    const pulse = Math.sin(beat * Math.PI * 2);
    const easedPulse = Math.sign(pulse) * Math.pow(Math.abs(pulse), 0.65);
    const baseAmount = aiDifficulty === "chaos" ? 0.20 : 0.18;
    const zoomAmount = baseAmount * easedPulse;

    camera.position.set(0, 30 - zoomAmount, 28 - zoomAmount * 0.74);
    camera.lookAt(0, 0, 0);
    return;
  }

  camera.position.set(0, 30, 28);
  camera.lookAt(0, 0, 0);
}



function openSiteInfoPopup(tabName) {
  const overlay = document.getElementById('siteInfoOverlay');
  if (!overlay) return;
  setSiteInfoTab(tabName || 'home');
  overlay.classList.add('show');
  overlay.setAttribute('aria-hidden', 'false');
}

function closeSiteInfoPopup(event) {
  if (event && event.target && event.target.id !== 'siteInfoOverlay') return;
  const overlay = document.getElementById('siteInfoOverlay');
  if (!overlay) return;
  overlay.classList.remove('show');
  overlay.setAttribute('aria-hidden', 'true');
}

function setSiteInfoTab(tabName) {
  const target = tabName || 'home';
  document.querySelectorAll('.siteInfoTab').forEach((button) => {
    button.classList.toggle('active', button.dataset.siteTab === target);
  });
  document.querySelectorAll('.siteInfoPanel').forEach((panel) => {
    panel.classList.toggle('active', panel.dataset.sitePanel === target);
  });
}

function openHelpPopup() {
  const overlay = document.getElementById("helpOverlay");
  if (!overlay) return;
  overlay.classList.add("show");
  overlay.setAttribute("aria-hidden", "false");
}

function closeHelpPopup(event) {
  if (event && event.target && event.target.id !== "helpOverlay") return;
  const overlay = document.getElementById("helpOverlay");
  if (!overlay) return;
  overlay.classList.remove("show");
  overlay.setAttribute("aria-hidden", "true");
}

function restartGame() {
  closePauseMenuVisual();
  resetMatch();
  resetLobbyReady();
  document.getElementById("lobby").style.display = "flex";
  playLobbyBgm();
}

function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  applyRendererPerformanceConfig();
  resizeGhostVisionOverlay();
}
