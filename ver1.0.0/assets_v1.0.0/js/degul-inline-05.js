/* 동의방침 → 게임 룰 → 데굴데굴 이용방법 튜토리얼 */
(function () {
  let tutorialStep = 0;
  let tutorialActive = false;
  let tutorialResizeHandler = null;
  let tutorialClickGuard = 0;

  const tutorialTargets = ["#matchSelectWrap", "#modeSelectWrap", ".playerSelectWrap"];
  const tutorialTranslations = {
    ko: {
      steps: [
        ["대전 방식을 선택하세요.", "2P 대전은 같은 화면에서 친구와 대결하고, AI 대전은 혼자 AI와 겨룹니다."],
        ["게임 모드를 고르세요.", "스피드 모드는 빠른 기본 대전이고, 아이템 모드는 다양한 변수를 만들며, 고스트 모드는 서로의 흔적과 시야를 가려 혼란을 줄 수 있습니다."],
        ["색상을 고르고 준비를 완료하세요.", "각 플레이어가 원하는 색상을 선택한 뒤 준비 완료를 누르면 게임이 시작됩니다."]
      ],
      next: "마우스 클릭 또는 Space 키로 다음 설명을 볼 수 있습니다.",
      close: "마우스 클릭 또는 Space 키로 튜토리얼을 닫을 수 있습니다.",
      skip: "건너뛰기"
    },
    en: {
      steps: [
        ["Choose a battle type.", "2P Battle lets you play with a friend on the same screen. AI Battle lets you challenge the AI alone."],
        ["Choose a game mode.", "Speed Mode is a fast standard match, Item Mode adds variables, and Ghost Mode hides trails and vision."],
        ["Choose colors and get ready.", "Select a color for each player, then ready up to start the game."]
      ],
      next: "Click or press Space to view the next tip.",
      close: "Click or press Space to close the tutorial.",
      skip: "Skip"
    },
    ja: {
      steps: [
        ["対戦方式を選んでください。", "2P対戦は同じ画面で友だちと対戦し、AI対戦は1人でAIに挑戦します。"],
        ["ゲームモードを選んでください。", "スピードモードは高速な基本対戦、アイテムモードはさまざまな変化が加わり、ゴーストモードはラインと視界を隠します。"],
        ["色を選んで準備を完了してください。", "各プレイヤーの色を選び、準備完了にするとゲームが始まります。"]
      ],
      next: "クリックまたはSpaceキーで次の説明を表示します。",
      close: "クリックまたはSpaceキーでチュートリアルを閉じます。",
      skip: "スキップ"
    },
    zh: {
      steps: [
        ["请选择对战方式。", "2P对战可在同一画面与朋友对战，AI对战则由1P单人挑战AI。"],
        ["请选择游戏模式。", "速度模式是高速基础对战，道具模式会加入更多变化，幽灵模式会隐藏轨迹和视野。"],
        ["请选择颜色并完成准备。", "为每位玩家选择颜色并点击准备后，游戏就会开始。"]
      ],
      next: "点击鼠标或按Space键查看下一条说明。",
      close: "点击鼠标或按Space键关闭教程。",
      skip: "跳过"
    }
  };

  function getTutorialLanguage() {
    const lang = typeof currentLang !== "undefined" ? currentLang : "ko";
    return tutorialTranslations[lang] || tutorialTranslations.ko;
  }

  function getTutorialEls() {
    return {
      layer: document.getElementById("degulTutorialLayer"),
      spot: document.getElementById("degulTutorialSpotlight"),
      tip: document.getElementById("degulTutorialTip"),
      progress: document.getElementById("degulTutorialProgress"),
      title: document.getElementById("degulTutorialTitle"),
      text: document.getElementById("degulTutorialText"),
      hint: document.getElementById("degulTutorialHint")
    };
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function getCombinedRect(elements) {
    const rects = elements
      .map(element => element && element.getBoundingClientRect())
      .filter(rect => rect && rect.width > 0 && rect.height > 0);
    if (!rects.length) return null;

    const left = Math.min(...rects.map(rect => rect.left));
    const top = Math.min(...rects.map(rect => rect.top));
    const right = Math.max(...rects.map(rect => rect.right));
    const bottom = Math.max(...rects.map(rect => rect.bottom));
    return {
      left,
      top,
      right,
      bottom,
      width: right - left,
      height: bottom - top
    };
  }

  function getTutorialTargetRect(step, target) {
    const tabletLayout = document.body.classList.contains("tablet-device")
      || document.body.classList.contains("device-layout-forced-tablet");

    // 태블릿 가로 레이아웃에서는 playerSelectWrap이 display: contents이므로
    // 래퍼의 잘못된 좌표 대신 실제 1P·2P 색상 선택 카드 범위를 합쳐 강조한다.
    if (tabletLayout && step.target === ".playerSelectWrap") {
      const colorCards = Array.from(target.querySelectorAll(".playerSelectBox"));
      const combined = getCombinedRect(colorCards);
      if (combined) return combined;
    }

    return target.getBoundingClientRect();
  }

  function updateTutorialStep() {
    const els = getTutorialEls();
    const language = getTutorialLanguage();
    const stepText = language.steps[tutorialStep];
    const step = stepText ? { target: tutorialTargets[tutorialStep], title: stepText[0], text: stepText[1] } : null;
    if (!els.layer || !els.spot || !els.tip || !step) return endDegulTutorial();

    if (typeof window.setLobbyPanel === "function") {
      window.setLobbyPanel("main");
    }

    const target = document.querySelector(step.target);
    if (!target) return endDegulTutorial();

    const rect = getTutorialTargetRect(step, target);
    const pad = window.innerWidth <= 900 ? 8 : 12;
    const left = clamp(rect.left - pad, 10, window.innerWidth - 40);
    const top = clamp(rect.top - pad, 10, window.innerHeight - 40);
    const width = clamp(rect.width + pad * 2, 80, window.innerWidth - 20);
    const height = clamp(rect.height + pad * 2, 54, window.innerHeight - 20);

    els.spot.style.left = left + "px";
    els.spot.style.top = top + "px";
    els.spot.style.width = width + "px";
    els.spot.style.height = height + "px";
    els.spot.style.borderRadius = (step.target === ".playerSelectWrap" ? 30 : 24) + "px";

    const tipRect = els.tip.getBoundingClientRect();
    let tipTop = top + height + 18;
    if (tipTop + tipRect.height > window.innerHeight - 18) {
      tipTop = top - tipRect.height - 18;
    }
    if (tipTop < 18) {
      tipTop = clamp(top + height * 0.5 - tipRect.height * 0.5, 18, window.innerHeight - tipRect.height - 18);
    }
    const tipLeft = clamp(left + width * 0.5, tipRect.width / 2 + 18, window.innerWidth - tipRect.width / 2 - 18);

    els.tip.style.left = tipLeft + "px";
    els.tip.style.top = tipTop + "px";
    els.progress.textContent = (tutorialStep + 1) + " / " + tutorialTargets.length;
    els.title.textContent = step.title;
    els.text.textContent = step.text;
    els.hint.textContent = tutorialStep === tutorialTargets.length - 1 ? language.close : language.next;
    const skip = document.getElementById("degulTutorialSkip");
    if (skip) skip.textContent = language.skip;
  }

  window.startDegulTutorial = function () {
    const els = getTutorialEls();
    if (!els.layer) return;
    tutorialStep = 0;
    tutorialActive = true;
    tutorialClickGuard = Date.now() + 220;
    els.layer.classList.add("show");
    els.layer.setAttribute("aria-hidden", "false");
    window.setTimeout(updateTutorialStep, 80);

    tutorialResizeHandler = function () {
      if (tutorialActive) updateTutorialStep();
    };
    window.addEventListener("resize", tutorialResizeHandler);
    window.addEventListener("orientationchange", tutorialResizeHandler);
  };

  window.nextDegulTutorial = function () {
    if (!tutorialActive) return;
    tutorialStep += 1;
    if (tutorialStep >= tutorialTargets.length) {
      endDegulTutorial();
      return;
    }
    updateTutorialStep();
  };

  window.endDegulTutorial = function () {
    const els = getTutorialEls();
    tutorialActive = false;
    if (els.layer) {
      els.layer.classList.remove("show");
      els.layer.setAttribute("aria-hidden", "true");
    }
    if (tutorialResizeHandler) {
      window.removeEventListener("resize", tutorialResizeHandler);
      window.removeEventListener("orientationchange", tutorialResizeHandler);
      tutorialResizeHandler = null;
    }
  };

  window.replayDegulTutorialFromSiteInfo = function () {
    if (typeof closeSiteInfoPopup === "function") closeSiteInfoPopup();
    const lobby = document.getElementById("lobby");
    if (lobby) lobby.style.display = "flex";
    if (typeof window.setLobbyPanel === "function") window.setLobbyPanel("main");
    if (typeof closePauseMenuVisual === "function") closePauseMenuVisual();
    window.setTimeout(function () {
      if (typeof window.startDegulTutorial === "function") window.startDegulTutorial();
    }, 220);
  };

  document.addEventListener("click", function (event) {
    if (!tutorialActive) return;
    if (Date.now() < tutorialClickGuard) return;
    const layer = document.getElementById("degulTutorialLayer");
    if (!layer || !layer.classList.contains("show")) return;
    if (event.target && event.target.id === "degulTutorialSkip") return;
    event.preventDefault();
    event.stopPropagation();
    nextDegulTutorial();
  }, true);

  document.addEventListener("keydown", function (event) {
    if (!tutorialActive) return;
    if (event.code !== "Space") return;
    event.preventDefault();
    event.stopPropagation();
    nextDegulTutorial();
  }, true);
})();
