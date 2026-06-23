(function () {
  const SESSION_KEY = "degulDegulGuestSessionV1";
  const CONSENT_KEY = "degulDegulPrivacyConsent";
  const apiBase = String(
    window.DEGUL_API_BASE
      || document.querySelector('meta[name="degul-api-base"]')?.content
      || window.location.origin
  ).replace(/\/+$/, "");

  let sessionToken = "";
  let currentUser = null;
  let sessionPromise = null;
  let busy = false;
  let modalMode = "loading";
  let modalReason = "profile";
  let pendingAction = null;
  let pendingAllowLocalFallback = false;
  let selectedProfileColor = "#64beff";

  const texts = {
    ko: {
      title: "플레이어 닉네임 설정",
      purpose: {
        ai: "AI 대전 기록과 랭킹에 사용할 닉네임을 설정해주세요.",
        ranking: "AI 랭킹에 참여하고 내 기록을 확인하려면 닉네임이 필요합니다.",
        online: "온라인 대전에 사용할 대표 닉네임을 설정해주세요.",
        profile: "AI 기록과 랭킹, 온라인 대전에 사용하는 대표 프로필입니다."
      },
      connecting: "로그인 정보를 준비하고 있습니다.",
      nicknameNeeded: "닉네임 등록 필요",
      ready: "프로필 등록 완료",
      placeholder: "닉네임 2~12자",
      submit: "닉네임 등록",
      colorLabel: "프로필 블록 색상",
      saveColor: "색상 저장",
      colorSaved: "프로필 색상을 저장했습니다.",
      hint: "닉네임은 2~12자이며 다른 사용자와 중복할 수 없습니다.",
      loggedIn: "AI 기록과 온라인 프로필에 사용됩니다.",
      unavailable: "로그인 서버에 연결할 수 없습니다. 잠시 후 다시 시도해주세요.",
      invalidLength: "닉네임은 2자 이상 12자 이하로 입력해주세요.",
      profileAria: "온라인 프로필 열기",
      closeAria: "닉네임 설정 닫기"
    },
    en: {
      title: "Set player nickname",
      purpose: {
        ai: "Set a nickname for AI match records and rankings.",
        ranking: "A nickname is required to join AI rankings and view your records.",
        online: "Set the nickname you will use for online matches.",
        profile: "This profile is used for AI records, rankings, and online matches."
      },
      connecting: "Preparing your sign-in.",
      nicknameNeeded: "Nickname required",
      ready: "Profile ready",
      placeholder: "Nickname, 2–12 characters",
      submit: "Save nickname",
      colorLabel: "Profile block color",
      saveColor: "Save color",
      colorSaved: "Profile color saved.",
      hint: "Nicknames must be 2–12 characters and unique.",
      loggedIn: "Used for AI records and your online profile.",
      unavailable: "The login server is unavailable. Please try again shortly.",
      invalidLength: "Enter a nickname between 2 and 12 characters.",
      profileAria: "Open online profile",
      closeAria: "Close nickname setup"
    },
    ja: {
      title: "プレイヤーニックネーム設定",
      purpose: {
        ai: "AI対戦の記録とランキングに使うニックネームを設定してください。",
        ranking: "AIランキングへの参加と記録確認にはニックネームが必要です。",
        online: "オンライン対戦で使う代表ニックネームを設定してください。",
        profile: "AI記録、ランキング、オンライン対戦で使うプロフィールです。"
      },
      connecting: "ログイン情報を準備しています。",
      nicknameNeeded: "ニックネーム登録が必要",
      ready: "プロフィール登録完了",
      placeholder: "ニックネーム 2～12文字",
      submit: "ニックネーム登録",
      colorLabel: "プロフィールブロックの色",
      saveColor: "色を保存",
      colorSaved: "プロフィールカラーを保存しました。",
      hint: "2～12文字で、他のユーザーと同じ名前は使えません。",
      loggedIn: "AI記録とオンラインプロフィールに使用されます。",
      unavailable: "ログインサーバーに接続できません。しばらくしてから再試行してください。",
      invalidLength: "ニックネームは2～12文字で入力してください。",
      profileAria: "オンラインプロフィールを開く",
      closeAria: "ニックネーム設定を閉じる"
    },
    zh: {
      title: "设置玩家昵称",
      purpose: {
        ai: "请设置用于AI对战记录和排行榜的昵称。",
        ranking: "参加AI排行榜和查看记录需要设置昵称。",
        online: "请设置在线对战使用的代表昵称。",
        profile: "此资料用于AI记录、排行榜和在线对战。"
      },
      connecting: "正在准备登录信息。",
      nicknameNeeded: "需要设置昵称",
      ready: "资料设置完成",
      placeholder: "昵称，2至12个字符",
      submit: "保存昵称",
      colorLabel: "资料方块颜色",
      saveColor: "保存颜色",
      colorSaved: "资料颜色已保存。",
      hint: "昵称须为2至12个字符，且不能与他人重复。",
      loggedIn: "用于AI记录和在线资料。",
      unavailable: "无法连接登录服务器，请稍后重试。",
      invalidLength: "请输入2至12个字符的昵称。",
      profileAria: "打开在线资料",
      closeAria: "关闭昵称设置"
    }
  };

  function language() {
    const lang = document.documentElement.lang || "ko";
    return texts[lang] ? lang : "ko";
  }

  function text() {
    return texts[language()];
  }

  function elements() {
    return {
      overlay: document.getElementById("guestAuthOverlay"),
      title: document.getElementById("guestAuthTitle"),
      purpose: document.getElementById("guestAuthPurpose"),
      state: document.getElementById("guestAuthState"),
      form: document.getElementById("guestAuthForm"),
      input: document.getElementById("guestNicknameInput"),
      submit: document.getElementById("guestNicknameSubmit"),
      close: document.getElementById("guestAuthCloseButton"),
      message: document.getElementById("guestAuthMessage"),
      user: document.getElementById("guestAuthUser"),
      avatar: document.getElementById("guestAuthAvatar"),
      nickname: document.getElementById("guestAuthNickname"),
      userHint: document.getElementById("guestAuthUserHint"),
      profile: document.getElementById("lobbyAuthProfileButton"),
      profileAvatar: document.getElementById("lobbyAuthProfileAvatar"),
      characterPreview: document.getElementById("guestAuthCharacterPreview"),
      colorInput: document.getElementById("guestProfileColorInput"),
      colorLabel: document.getElementById("guestAuthColorLabel"),
      colorSave: document.getElementById("guestAuthColorSaveButton")
    };
  }

  function hasConsent() {
    try {
      return localStorage.getItem(CONSENT_KEY) === "1";
    } catch {
      return false;
    }
  }

  function readStoredToken() {
    try {
      return localStorage.getItem(SESSION_KEY) || "";
    } catch {
      return "";
    }
  }

  function storeToken(token) {
    sessionToken = token || "";
    try {
      if (sessionToken) localStorage.setItem(SESSION_KEY, sessionToken);
      else localStorage.removeItem(SESSION_KEY);
    } catch {}
  }

  async function api(path, options = {}) {
    const headers = new Headers(options.headers || {});
    headers.set("Accept", "application/json");
    if (options.body) headers.set("Content-Type", "application/json");
    if (sessionToken) headers.set("Authorization", `Bearer ${sessionToken}`);

    const response = await fetch(`${apiBase}${path}`, {
      ...options,
      headers,
      cache: "no-store"
    });
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      const error = new Error(data?.error?.message || `HTTP ${response.status}`);
      error.code = data?.error?.code || "request_failed";
      error.status = response.status;
      throw error;
    }

    return data;
  }

  function setMessage(message, isError) {
    const element = elements().message;
    if (!element) return;
    element.textContent = message || "";
    element.classList.toggle("error", Boolean(isError));
  }

  function updateProfileButton() {
    const el = elements();
    const nickname = currentUser?.nickname || "";
    const profileColor = currentUser?.profileColor || selectedProfileColor;
    if (!el.profile) return;
    el.profile.hidden = !nickname;
    el.profile.setAttribute("aria-label", text().profileAria);
    el.profile.title = nickname;
    if (el.profileAvatar) el.profileAvatar.style.setProperty("--profile-color", profileColor);
  }

  function updateCharacterColors(color) {
    selectedProfileColor = color || "#64beff";
    const el = elements();
    el.characterPreview?.style.setProperty("--profile-color", selectedProfileColor);
    el.avatar?.style.setProperty("--profile-color", selectedProfileColor);
    if (el.colorInput && el.colorInput.value !== selectedProfileColor) {
      el.colorInput.value = selectedProfileColor;
    }
  }

  function renderModal(mode) {
    modalMode = mode;
    const el = elements();
    if (!el.overlay) return;
    const copy = text();
    const nickname = currentUser?.nickname || "";

    el.title.textContent = copy.title;
    el.purpose.textContent = copy.purpose[modalReason] || copy.purpose.profile;
    el.close.setAttribute("aria-label", copy.closeAria);
    el.input.placeholder = copy.placeholder;
    el.submit.textContent = copy.submit;
    el.colorLabel.textContent = copy.colorLabel;
    el.colorSave.textContent = copy.saveColor;
    el.submit.disabled = busy || mode === "loading";
    el.colorSave.disabled = busy || mode === "loading";
    el.input.disabled = busy || mode === "loading";
    el.form.hidden = mode !== "nickname";
    el.user.hidden = mode !== "ready";
    el.colorSave.hidden = mode !== "ready";
    el.state.classList.toggle("ready", mode === "ready");
    updateCharacterColors(currentUser?.profileColor || selectedProfileColor);

    if (mode === "loading") {
      el.state.textContent = copy.connecting;
      setMessage("", false);
    } else if (mode === "nickname") {
      el.state.textContent = copy.nicknameNeeded;
      setMessage(copy.hint, false);
    } else if (mode === "ready") {
      el.state.textContent = copy.ready;
      el.nickname.textContent = nickname;
      el.userHint.textContent = copy.loggedIn;
      setMessage("", false);
    } else {
      el.state.textContent = "";
      setMessage(copy.unavailable, true);
    }

    updateProfileButton();
  }

  function showModal(reason) {
    modalReason = reason || "profile";
    const overlay = elements().overlay;
    if (!overlay) return;
    overlay.classList.add("show");
    overlay.setAttribute("aria-hidden", "false");
    renderModal(currentUser?.nickname ? "ready" : (sessionPromise ? "loading" : "nickname"));
    if (!currentUser?.nickname) {
      window.setTimeout(() => elements().input?.focus(), 80);
    }
  }

  function closeModal(clearPending = true) {
    const overlay = elements().overlay;
    if (!overlay) return;
    overlay.classList.remove("show");
    overlay.setAttribute("aria-hidden", "true");
    if (clearPending) {
      pendingAction = null;
      pendingAllowLocalFallback = false;
    }
  }

  function announceReady() {
    window.dispatchEvent(new CustomEvent("degul:auth-ready", {
      detail: { nickname: currentUser?.nickname || null }
    }));
  }

  async function ensureSession() {
    if (!hasConsent()) return null;
    if (currentUser) return currentUser;
    if (sessionPromise) return sessionPromise;

    sessionPromise = (async () => {
      sessionToken = readStoredToken();

      if (sessionToken) {
        try {
          const data = await api("/api/auth/session", { method: "GET" });
          currentUser = data.user;
          updateProfileButton();
          if (currentUser?.nickname) announceReady();
          return currentUser;
        } catch (error) {
          if (error.status !== 401) throw error;
          storeToken("");
        }
      }

      const data = await api("/api/auth/guest", { method: "POST" });
      if (data.sessionToken) storeToken(data.sessionToken);
      currentUser = data.user;
      selectedProfileColor = currentUser?.profileColor || selectedProfileColor;
      updateProfileButton();
      return currentUser;
    })();

    try {
      return await sessionPromise;
    } finally {
      sessionPromise = null;
    }
  }

  function runPendingAction() {
    const action = pendingAction;
    pendingAction = null;
    pendingAllowLocalFallback = false;
    if (typeof action === "function") action();
  }

  async function requireNickname(reason, action, options = {}) {
    if (currentUser?.nickname) {
      if (typeof action === "function") action();
      return true;
    }

    pendingAction = typeof action === "function" ? action : null;
    pendingAllowLocalFallback = options.allowLocalFallback === true;
    modalReason = reason || "profile";

    if (!hasConsent()) {
      if (typeof window.openPrivacyPopup === "function") window.openPrivacyPopup(false);
      return false;
    }

    showModal(modalReason);
    renderModal("loading");

    try {
      await ensureSession();
      if (currentUser?.nickname) {
        closeModal(false);
        runPendingAction();
        return true;
      }
      renderModal("nickname");
      return false;
    } catch (error) {
      console.warn("[DegulAuth] login unavailable", error);
      if (pendingAllowLocalFallback) {
        closeModal(false);
        runPendingAction();
        return true;
      }
      renderModal("error");
      return false;
    }
  }

  async function submitNickname(event) {
    event.preventDefault();
    if (busy) return;

    const el = elements();
    const nickname = String(el.input.value || "").normalize("NFC").trim().replace(/\s+/gu, " ");
    const length = Array.from(nickname).length;

    if (length < 2 || length > 12) {
      setMessage(text().invalidLength, true);
      el.input.focus();
      return;
    }

    busy = true;
    renderModal("nickname");
    try {
      await ensureSession();
      const data = await api("/api/auth/nickname", {
        method: "POST",
        body: JSON.stringify({
          nickname,
          profileColor: selectedProfileColor
        })
      });
      currentUser = data.user;
      el.input.value = "";
      updateProfileButton();
      announceReady();
      closeModal(false);
      runPendingAction();
    } catch (error) {
      if (error.status === 401) {
        storeToken("");
        currentUser = null;
      }
      setMessage(error.message || text().unavailable, true);
    } finally {
      busy = false;
      if (elements().overlay?.classList.contains("show")) renderModal(currentUser?.nickname ? "ready" : "nickname");
    }
  }

  async function saveProfileColor() {
    if (busy || !currentUser?.nickname) return;
    busy = true;
    let saved = false;
    let errorMessage = "";
    renderModal("ready");
    try {
      const data = await api("/api/auth/profile", {
        method: "POST",
        body: JSON.stringify({ profileColor: selectedProfileColor })
      });
      currentUser = data.user;
      updateCharacterColors(currentUser.profileColor);
      updateProfileButton();
      saved = true;
    } catch (error) {
      errorMessage = error.message || text().unavailable;
    } finally {
      busy = false;
      renderModal("ready");
      if (saved) setMessage(text().colorSaved, false);
      else if (errorMessage) setMessage(errorMessage, true);
    }
  }

  function installFeatureGuards() {
    const originalSetMatchMode = window.setMatchMode;
    if (typeof originalSetMatchMode === "function" && !originalSetMatchMode.__degulAuthWrapped) {
      const wrapped = function (mode) {
        if (mode !== "ai") return originalSetMatchMode.apply(this, arguments);
        return requireNickname("ai", () => originalSetMatchMode.call(this, mode), {
          allowLocalFallback: true
        });
      };
      wrapped.__degulAuthWrapped = true;
      window.setMatchMode = wrapped;
    }

    const originalOpenAiRankingPopup = window.openAiRankingPopup;
    if (typeof originalOpenAiRankingPopup === "function" && !originalOpenAiRankingPopup.__degulAuthWrapped) {
      const wrapped = function () {
        const args = arguments;
        const context = this;
        return requireNickname("ranking", () => originalOpenAiRankingPopup.apply(context, args));
      };
      wrapped.__degulAuthWrapped = true;
      window.openAiRankingPopup = wrapped;
    }

    const originalSetAiRecordPopupTab = window.setAiRecordPopupTab;
    if (typeof originalSetAiRecordPopupTab === "function" && !originalSetAiRecordPopupTab.__degulAuthWrapped) {
      const wrapped = function (tab) {
        if (tab !== "ranking") return originalSetAiRecordPopupTab.apply(this, arguments);
        const args = arguments;
        const context = this;
        return requireNickname("ranking", () => originalSetAiRecordPopupTab.apply(context, args));
      };
      wrapped.__degulAuthWrapped = true;
      window.setAiRecordPopupTab = wrapped;
    }

    const originalSetLobbyPanel = window.setLobbyPanel;
    if (typeof originalSetLobbyPanel === "function" && !originalSetLobbyPanel.__degulAuthWrapped) {
      const wrapped = function (panel) {
        if (panel !== "online") return originalSetLobbyPanel.apply(this, arguments);
        const args = arguments;
        const context = this;
        return requireNickname("online", () => originalSetLobbyPanel.apply(context, args));
      };
      wrapped.__degulAuthWrapped = true;
      window.setLobbyPanel = wrapped;
    }
  }

  function handlePrivacyAgreement() {
    window.setTimeout(() => {
      if (!hasConsent()) return;
      ensureSession().catch(error => console.warn("[DegulAuth] silent login unavailable", error));
      if (pendingAction) requireNickname(modalReason, pendingAction, {
        allowLocalFallback: pendingAllowLocalFallback
      });
    }, 0);
  }

  function updateLanguage() {
    updateProfileButton();
    if (elements().overlay?.classList.contains("show")) renderModal(modalMode);
  }

  function init() {
    const el = elements();
    if (!el.overlay || !el.form) return;

    el.form.addEventListener("submit", submitNickname);
    el.close.addEventListener("click", () => closeModal(true));
    el.profile?.addEventListener("click", () => requireNickname("profile"));
    el.colorInput?.addEventListener("input", event => updateCharacterColors(event.target.value));
    el.colorSave?.addEventListener("click", saveProfileColor);
    document.getElementById("privacyAgreeBtn")?.addEventListener("click", handlePrivacyAgreement, true);
    document.addEventListener("keydown", event => {
      if (event.key === "Escape" && el.overlay.classList.contains("show")) closeModal(true);
    });
    new MutationObserver(updateLanguage).observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["lang"]
    });

    installFeatureGuards();
    if (hasConsent()) {
      ensureSession().catch(error => console.warn("[DegulAuth] silent login unavailable", error));
    }
  }

  window.DegulAuth = {
    getUser: () => currentUser ? {
      nickname: currentUser.nickname,
      profileColor: currentUser.profileColor
    } : null,
    refresh: ensureSession,
    request: api,
    requireNickname,
    openProfile: () => requireNickname("profile")
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
