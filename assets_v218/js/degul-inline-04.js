(function () {
  let activePanel = "main";
  let dragStartX = 0;
  let dragStartY = 0;
  let dragging = false;

  window.setLobbyPanel = function(panel) {
    const card = document.querySelector("#lobby .lobbyCard");
    const arrow = document.getElementById("lobbyOnlineArrow");
    if (!card) return;
    activePanel = panel === "online" ? "online" : "main";
    card.classList.toggle("online-match-active", activePanel === "online");
    if (arrow) {
      arrow.classList.toggle("is-back", activePanel === "online");
      arrow.dataset.panelTarget = activePanel === "online" ? "main" : "online";
      const translate = typeof tr === "function" ? tr : key => key;
      arrow.setAttribute("aria-label", activePanel === "online" ? translate("localPanel") : translate("onlinePanel"));
    }
  };

  window.toggleLobbyPanel = function() {
    window.setLobbyPanel(activePanel === "online" ? "main" : "online");
  };

  window.setOnlineMatchColor = function(color, button) {
    const preview = document.getElementById("onlineColorPreview");
    const panel = document.querySelector(".onlineMatchPanel");
    if (preview) preview.style.setProperty("--online-match-color", color);
    if (panel) panel.style.setProperty("--online-match-color", color);
    document.querySelectorAll(".onlineColorChip").forEach(chip => chip.classList.remove("selected"));
    if (button) button.classList.add("selected");
    const status = document.getElementById("onlineMatchStatus");
    if (status) status.textContent = "";
  };

  function bindLobbyPanelDrag() {
    const slider = document.getElementById("lobbyPanelSlider");
    if (!slider || slider.dataset.dragReady === "1") return;
    slider.dataset.dragReady = "1";

    slider.addEventListener("pointerdown", (event) => {
      if (event.target.closest("button, input, label, .palette, .onlineColorPalette")) return;
      dragging = true;
      dragStartX = event.clientX;
      dragStartY = event.clientY;
      slider.classList.add("is-dragging");
    });

    window.addEventListener("pointerup", (event) => {
      if (!dragging) return;
      dragging = false;
      slider.classList.remove("is-dragging");
      const dx = event.clientX - dragStartX;
      const dy = event.clientY - dragStartY;
      if (Math.abs(dx) < 64 || Math.abs(dx) < Math.abs(dy) * 1.2) return;
      if (dx < 0) window.setLobbyPanel("online");
      if (dx > 0) window.setLobbyPanel("main");
    });

    slider.addEventListener("pointercancel", () => {
      dragging = false;
      slider.classList.remove("is-dragging");
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bindLobbyPanelDrag);
  } else {
    bindLobbyPanelDrag();
  }
})();

/* 사이트 정보 > 게임 소개 튜토리얼 다시 보기 다국어 문구 */
(function () {
  function applyTutorialReplayLanguage() {
    const lang = window.currentLang || (typeof currentLang !== "undefined" ? currentLang : "ko");
    const texts = {
      ko: { title: "이용 방법 튜토리얼", body: "대전 방식, 게임 모드, 색상 선택과 준비 완료 순서를 로비에서 다시 안내합니다.", button: "튜토리얼 다시 보기" },
      en: { title: "How-to Tutorial", body: "Replay the lobby guide for battle type, game mode, color selection, and ready flow.", button: "Replay Tutorial" },
      zh: { title: "使用方法教程", body: "在大厅重新说明对战方式、游戏模式、颜色选择和准备完成流程。", button: "重新查看教程" },
      ja: { title: "遊び方チュートリアル", body: "対戦方式、ゲームモード、色選択、準備完了までの流れをロビーで再案内します。", button: "チュートリアルをもう一度見る" }
    };
    const text = texts[lang] || texts.ko;
    const title = document.getElementById("siteInfoTutorialTitle");
    const body = document.getElementById("siteInfoTutorialText");
    const button = document.getElementById("siteInfoTutorialReplayButton");
    if (!title || !body || !button || !text) return;
    title.textContent = text.title;
    body.textContent = text.body;
    button.textContent = text.button;
  }

  const originalUpdateSiteInfoLanguageForTutorial = window.updateSiteInfoLanguage;
  window.updateSiteInfoLanguage = function () {
    if (typeof originalUpdateSiteInfoLanguageForTutorial === "function") {
      originalUpdateSiteInfoLanguageForTutorial();
    }
    applyTutorialReplayLanguage();
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", applyTutorialReplayLanguage);
  } else {
    applyTutorialReplayLanguage();
  }
})();
