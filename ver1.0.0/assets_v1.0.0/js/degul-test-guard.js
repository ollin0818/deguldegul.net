(function () {
  "use strict";

  const TEST_FLAG_KEY = "degulDegulTestMode";
  const AUTH_SESSION_KEY = "degulDegulGuestSessionV1";
  const AI_HISTORY_KEY = "degulDegulAiMatchHistoryV1";
  const AI_USED_SESSIONS_KEY = "degulDegulAiUsedSessionsV1";
  const params = new URLSearchParams(window.location.search || "");

  function isLocalFile() {
    return window.location.protocol === "file:";
  }

  function isLocalHost() {
    return /^(localhost|127\.0\.0\.1|\[::1\])$/i.test(window.location.hostname || "");
  }

  function readFlag() {
    try {
      return localStorage.getItem(TEST_FLAG_KEY) === "1";
    } catch {
      return false;
    }
  }

  function writeFlag(enabled) {
    try {
      if (enabled) localStorage.setItem(TEST_FLAG_KEY, "1");
      else localStorage.removeItem(TEST_FLAG_KEY);
    } catch {}
  }

  if (params.has("degul_test")) {
    writeFlag(params.get("degul_test") !== "0");
  }

  function isTestMode() {
    return isLocalFile() || isLocalHost() || readFlag();
  }

  function clearLogin() {
    try {
      localStorage.removeItem(AUTH_SESSION_KEY);
    } catch {}
    return true;
  }

  function clearAiTestRecords() {
    try {
      localStorage.removeItem(AI_HISTORY_KEY);
      localStorage.removeItem(AI_USED_SESSIONS_KEY);
    } catch {}
    if (window.DegulAiHistory?.updatePanel) window.DegulAiHistory.updatePanel();
    return true;
  }

  if (params.get("clearLogin") === "1") clearLogin();
  if (params.get("clearAiHistory") === "1") clearAiTestRecords();

  function openRankingPopupWithoutAuth() {
    const overlay = document.getElementById("aiRecordOverlay");
    if (!overlay) return false;
    if (typeof window.updateAiRecordPanel === "function") window.updateAiRecordPanel();
    if (typeof window.DegulAiRanking?.refresh === "function") {
      window.DegulAiRanking.refresh();
    }
    if (typeof window.DegulAiHistory?.updatePanel === "function") {
      window.DegulAiHistory.updatePanel();
    }
    overlay.classList.add("show");
    overlay.setAttribute("aria-hidden", "false");
    return true;
  }

  function installRankingFallback() {
    const original = window.openAiRankingPopup;
    if (typeof original !== "function" || original.__degulTestGuardWrapped) return;
    const wrapped = function (...args) {
      if (isTestMode()) {
        const opened = openRankingPopupWithoutAuth();
        if (opened) return true;
      }
      return original.apply(this, args);
    };
    wrapped.__degulTestGuardWrapped = true;
    window.openAiRankingPopup = wrapped;
  }

  function installNoSubmitGuard() {
    if (!isTestMode()) return;
    const ranking = window.DegulAiRanking;
    if (ranking && !ranking.__degulTestGuardNoSubmit) {
      ranking.__degulTestGuardNoSubmit = true;
      ranking.beginMatch = function () {};
      ranking.finishMatch = async function () {};
      ranking.cancelMatch = function () {};
    }

    const history = window.DegulAiHistory;
    if (history && !history.__degulTestGuardNoSubmit) {
      history.__degulTestGuardNoSubmit = true;
      history.beginSession = function () { return null; };
      history.recordResult = function () { return false; };
      history.clearSession = function () {};
    }
  }

  function install() {
    installRankingFallback();
    installNoSubmitGuard();
  }

  window.DegulTestGuard = {
    isTestMode,
    enableTestMode() {
      writeFlag(true);
      install();
      return true;
    },
    disableTestMode() {
      writeFlag(false);
      return true;
    },
    clearLogin,
    clearAiTestRecords
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", install, { once: true });
  } else {
    install();
  }
})();
