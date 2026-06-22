(function(){
  // PC UI는 FHD 브라우저 가용 영역을 기준으로 하되 고해상도에서는 완만하게만 확대한다.
  // 위치 기준은 가상 QHD 스테이지가 아닌 실제 viewport를 사용한다.
  const BASE_UI_WIDTH = 1920;
  const BASE_UI_HEIGHT = 960;
  const MIN_COMPACT_PC_SCALE = 0.78;
  const MIN_PC_SCALE = 0.90;
  const MAX_PC_SCALE = 1.22;
  const TABLET_UI_WIDTH = 1280;
  const TABLET_UI_HEIGHT = 800;

  function getViewportSize() {
    const viewport = window.visualViewport;
    return {
      width: Math.max(1, viewport ? viewport.width : window.innerWidth),
      height: Math.max(1, viewport ? viewport.height : window.innerHeight)
    };
  }

  function updateLobbyUiScale(viewport, uiScale) {
    const lobby = document.getElementById('lobby');
    const card = lobby && lobby.querySelector('.lobbyCard');
    if (!card) {
      document.documentElement.style.setProperty('--lobby-ui-scale', uiScale.toFixed(4));
      return;
    }

    // 패널 양쪽에 붙는 기록/랭킹 탭과 온라인 탭의 펼침 폭까지 화면 안에 포함한다.
    const horizontalAttachmentReserve = 260 * 2;
    const cardWidth = Math.max(680, card.offsetWidth);
    const cardHeight = Math.max(1, card.scrollHeight);
    const bottomReserve = parseFloat(
      getComputedStyle(document.documentElement).getPropertyValue('--ui-lobby-bottom-reserve')
    ) || 124;
    const availableWidth = Math.max(1, viewport.width - 36);
    const availableHeight = Math.max(1, viewport.height - bottomReserve - 36);
    const widthFit = availableWidth / (cardWidth + horizontalAttachmentReserve);
    const heightFit = availableHeight / cardHeight;
    const lobbyScale = Math.max(0.62, Math.min(uiScale, widthFit, heightFit));

    document.documentElement.style.setProperty('--lobby-ui-scale', lobbyScale.toFixed(4));
  }

  function updateResponsiveUiScale() {
    const viewport = getViewportSize();
    const fitScale = Math.min(
      viewport.width / BASE_UI_WIDTH,
      viewport.height / BASE_UI_HEIGHT
    );
    const minimumScale = viewport.width < 1440 || viewport.height < 800
      ? MIN_COMPACT_PC_SCALE
      : MIN_PC_SCALE;
    // QHD·4K에서는 FHD 초과 배율의 36%만 반영해 체감 크기 차이를 제한한다.
    const softenedScale = fitScale > 1
      ? 1 + (fitScale - 1) * 0.36
      : fitScale;
    const scale = Math.max(minimumScale, Math.min(MAX_PC_SCALE, softenedScale));
    const stageWidth = viewport.width;
    const stageHeight = viewport.height;
    const stageLeft = 0;
    const stageTop = 0;
    const adHeight = viewport.width <= 799 ? 60 : 90;
    const adTop = Math.max(8, Math.min(18, 8 * scale));
    const adGap = Math.max(12, Math.min(22, 14 * scale));
    const lobbyBottomGap = Math.max(16, Math.min(30, 20 * scale));
    const tabletScale = Math.max(0.1, Math.min(1,
      viewport.width / TABLET_UI_WIDTH,
      viewport.height / TABLET_UI_HEIGHT
    ));

    document.documentElement.style.setProperty('--ui-scale', scale.toFixed(4));
    document.documentElement.style.setProperty('--ui-stage-width', `${stageWidth.toFixed(2)}px`);
    document.documentElement.style.setProperty('--ui-stage-height', `${stageHeight.toFixed(2)}px`);
    document.documentElement.style.setProperty('--ui-stage-left', `${stageLeft.toFixed(2)}px`);
    document.documentElement.style.setProperty('--ui-stage-top', `${stageTop.toFixed(2)}px`);
    document.documentElement.style.setProperty('--ui-stage-center-y', `${(stageHeight / 2).toFixed(2)}px`);
    document.documentElement.style.setProperty('--ui-edge', `${Math.max(14, 18 * scale).toFixed(2)}px`);
    document.documentElement.style.setProperty('--ui-bgm-bottom', `${Math.max(56, 66 * scale).toFixed(2)}px`);
    document.documentElement.style.setProperty('--ui-ad-side-edge', `${Math.max(18, 28 * scale).toFixed(2)}px`);
    document.documentElement.style.setProperty('--ui-ad-bottom', `${lobbyBottomGap.toFixed(2)}px`);
    document.documentElement.style.setProperty('--ui-ad-top', `${adTop.toFixed(2)}px`);
    document.documentElement.style.setProperty('--ui-ad-height', `${adHeight}px`);
    document.documentElement.style.setProperty('--ui-ad-gap', `${adGap.toFixed(2)}px`);
    document.documentElement.style.setProperty('--ui-score-top', `${(adTop + adHeight + adGap).toFixed(2)}px`);
    document.documentElement.style.setProperty('--ui-lobby-bottom-reserve', `${(lobbyBottomGap + adHeight + adGap).toFixed(2)}px`);
    document.documentElement.style.setProperty('--ui-message-hidden-scale', (scale * 0.96).toFixed(4));
    document.documentElement.style.setProperty('--tablet-ui-scale', tabletScale.toFixed(4));
    document.documentElement.style.setProperty('--tablet-message-hidden-scale', (tabletScale * 0.96).toFixed(4));
    document.documentElement.dataset.uiDesignScale = scale.toFixed(4);
    updateLobbyUiScale(viewport, scale);
  }

  function wrapCountdownUi() {
    const overlay = document.getElementById('countdownOverlay');
    if (!overlay || document.getElementById('countdownScaleRoot')) return;
    const root = document.createElement('div');
    root.id = 'countdownScaleRoot';
    while (overlay.firstChild) root.appendChild(overlay.firstChild);
    overlay.appendChild(root);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      wrapCountdownUi();
      updateResponsiveUiScale();
    });
  } else {
    wrapCountdownUi();
  }

  updateResponsiveUiScale();
  window.addEventListener('resize', updateResponsiveUiScale, { passive: true });
  window.addEventListener('orientationchange', updateResponsiveUiScale, { passive: true });
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', updateResponsiveUiScale, { passive: true });
  }
})();


window.addEventListener("load", () => {
  updateSettingsThemeUI();
  updatePauseVolumeUI();
});
