/* First visit flow: privacy notice -> rules -> lobby tutorial. */
(function () {
  const CONSENT_KEY = "degulDegulPrivacyConsent";
  const CONSENT_AT_KEY = "degulDegulPrivacyConsentAt";
  const FLOW_STATE_KEY = "degulDegulFirstVisitFlowDone";

  let pendingRulesToTutorial = false;
  let firstVisitPromptRequested = false;

  function safeGet(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }

  function safeSet(key, value) {
    try { localStorage.setItem(key, value); } catch (e) {}
  }

  function hasConsent() {
    return safeGet(CONSENT_KEY) === "1";
  }

  function isOverlayShown(id) {
    const el = document.getElementById(id);
    return !!(el && el.classList.contains("show"));
  }

  function showLobbyMainPanel() {
    const lobby = document.getElementById("lobby");
    if (lobby) lobby.style.display = "flex";
    if (typeof window.setLobbyPanel === "function") window.setLobbyPanel("main");
    if (typeof window.closeSiteInfoPopup === "function") window.closeSiteInfoPopup();
    if (typeof window.closePauseMenuVisual === "function") window.closePauseMenuVisual();
  }

  function bindPrivacyButtons() {
    const laterButton = document.getElementById("privacyCloseOnlyBtn");
    const agreeButton = document.getElementById("privacyAgreeBtn");
    if (laterButton) laterButton.onclick = window.privacyLaterChoice;
    if (agreeButton) agreeButton.onclick = window.agreePrivacyPolicy;
  }

  function hidePrivacyOverlayOnly() {
    const overlay = document.getElementById("privacyOverlay");
    if (!overlay) return;
    overlay.classList.remove("show");
    overlay.setAttribute("aria-hidden", "true");
  }

  function openPrivacyOverlayOnly(isFirstVisit) {
    const overlay = document.getElementById("privacyOverlay");
    if (!overlay) return;

    overlay.dataset.firstVisit = isFirstVisit ? "1" : "0";
    overlay.classList.add("show");
    overlay.setAttribute("aria-hidden", "false");
    overlay.onclick = function (event) {
      if (event.target === overlay) {
        event.preventDefault();
        event.stopPropagation();
        return false;
      }
      return true;
    };

    const closeButton = document.querySelector(".privacyCloseButton");
    if (closeButton) closeButton.style.display = isFirstVisit ? "none" : "";
    bindPrivacyButtons();
  }

  function startTutorialAfterRulesClosed() {
    if (!pendingRulesToTutorial) return;
    pendingRulesToTutorial = false;
    window.__degulStartTutorialAfterRules = false;
    showLobbyMainPanel();

    window.setTimeout(function () {
      if (typeof window.startDegulTutorial === "function") {
        window.startDegulTutorial();
      }
      safeSet(FLOW_STATE_KEY, "1");
    }, 180);
  }

  function openRulesThenTutorial() {
    showLobbyMainPanel();
    pendingRulesToTutorial = true;
    window.__degulStartTutorialAfterRules = true;

    window.setTimeout(function () {
      if (typeof window.openHelpPopup === "function") {
        window.openHelpPopup();
      } else {
        startTutorialAfterRulesClosed();
      }
    }, 160);
  }

  window.__degulBeginFirstVisitRulesTutorial = openRulesThenTutorial;

  window.openPrivacyPopup = function (isFirstVisit) {
    if (isFirstVisit) showLobbyMainPanel();
    openPrivacyOverlayOnly(!!isFirstVisit);
  };

  window.closePrivacyPopup = function (event) {
    const overlay = document.getElementById("privacyOverlay");
    if (event && overlay && event.target === overlay) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    hidePrivacyOverlayOnly();
  };

  window.privacyLaterChoice = function () {
    const overlay = document.getElementById("privacyOverlay");
    const isFirstVisit = overlay && overlay.dataset.firstVisit === "1";
    hidePrivacyOverlayOnly();
    if (isFirstVisit) openRulesThenTutorial();
  };

  window.agreePrivacyPolicy = function () {
    const overlay = document.getElementById("privacyOverlay");
    const isFirstVisit = overlay && overlay.dataset.firstVisit === "1";
    safeSet(CONSENT_KEY, "1");
    safeSet(CONSENT_AT_KEY, new Date().toISOString());
    hidePrivacyOverlayOnly();
    if (isFirstVisit) openRulesThenTutorial();
  };

  const previousCloseHelpPopup = window.closeHelpPopup;
  window.closeHelpPopup = function (event) {
    if (typeof previousCloseHelpPopup === "function") previousCloseHelpPopup(event);

    const helpOverlay = document.getElementById("helpOverlay");
    const isClosed = !helpOverlay || !helpOverlay.classList.contains("show");
    if (isClosed && (pendingRulesToTutorial || window.__degulStartTutorialAfterRules)) {
      startTutorialAfterRulesClosed();
    }
  };

  function enforceFirstVisitFlow() {
    bindPrivacyButtons();
    if (firstVisitPromptRequested) return;
    if (hasConsent()) return;
    if (isOverlayShown("privacyOverlay") || isOverlayShown("helpOverlay") || isOverlayShown("degulTutorialLayer")) return;

    firstVisitPromptRequested = true;
    showLobbyMainPanel();
    window.setTimeout(function () {
      window.openPrivacyPopup(true);
    }, 180);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      window.setTimeout(enforceFirstVisitFlow, 300);
    });
  } else {
    window.setTimeout(enforceFirstVisitFlow, 300);
  }

  window.addEventListener("load", function () {
    window.setTimeout(enforceFirstVisitFlow, 520);
  });
})();
