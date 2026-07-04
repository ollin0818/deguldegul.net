(function () {
  const SESSION_KEY = "degulDegulGuestSessionV1";
  const CONSENT_KEY = "degulDegulPrivacyConsent";
  const TEST_FLAG_KEY = "degulDegulTestMode";
  const params = new URLSearchParams(window.location.search || "");
  const TEST_RANKING_API_BASE = "https://degul-ai-ranking-proxy.astro-step.workers.dev";
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
  let localAuthAnnounced = false;
  let googleClientId = "";
  let googleInitialized = false;
  let googleButtonRendered = false;

  const LOCAL_TEST_USER = {
    id: "local-operator",
    nickname: "운영자",
    profileColor: "#64beff",
    role: "operator",
    localTest: true
  };

  function isOperatorTestHost() {
    const host = String(window.location.hostname || "").toLowerCase();
    return host === "operator-test.deguldegul.pages.dev"
      || /^[a-f0-9]{8}\.deguldegul\.pages\.dev$/.test(host);
  }

  function canUseLocalTestMode() {
    const { protocol, hostname } = window.location;
    return protocol === "file:"
      || /^(localhost|127\.0\.0\.1|\[::1\])$/i.test(hostname || "")
      || isOperatorTestHost();
  }

  if (!canUseLocalTestMode()) {
    try {
      localStorage.removeItem(TEST_FLAG_KEY);
    } catch {}
  }

  if (canUseLocalTestMode() && params.has("degul_test")) {
    try {
      if (params.get("degul_test") !== "0") localStorage.setItem(TEST_FLAG_KEY, "1");
      else localStorage.removeItem(TEST_FLAG_KEY);
    } catch {}
  }

  const texts = {
    ko: {
      title: "플레이어 닉네임 설정",
      purpose: {
        ai: "AI 대전 기록과 랭킹에 사용할 닉네임을 설정해주세요.",
        ranking: "AI 랭킹에 참여하고 내 기록을 확인하려면 닉네임이 필요합니다.",
        online: "AI 랭킹에 사용할 닉네임을 설정해주세요.",
        profile: "AI 기록과 랭킹에 사용하는 대표 프로필입니다."
      },
      connecting: "로그인 정보를 준비하고 있습니다.",
      nicknameNeeded: "닉네임 등록 필요",
      ready: "프로필 등록 완료",
      chooseMethod: "로그인 방법 선택",
      placeholder: "닉네임 2~12자",
      submit: "닉네임 등록",
      guestButton: "게스트로 시작",
      colorLabel: "프로필 블록 색상",
      saveColor: "색상 저장",
      colorSaved: "프로필 색상을 저장했습니다.",
      hint: "닉네임은 2~12자이며 다른 사용자와 중복할 수 없습니다.",
      loggedIn: "AI 랭킹 프로필에 사용됩니다.",
      unavailable: "로그인 서버에 연결할 수 없습니다. 잠시 후 다시 시도해주세요.",
      invalidLength: "닉네임은 2자 이상 12자 이하로 입력해주세요.",
      googleButton: "Google 계정으로 계속",
      googleLinked: "Google 계정이 연결되었습니다.",
      profileAria: "AI 프로필 열기",
      closeAria: "닉네임 설정 닫기"
    },
    en: {
      title: "Set player nickname",
      purpose: {
        ai: "Set a nickname for AI match records and rankings.",
        ranking: "A nickname is required to join AI rankings and view your records.",
        online: "Set the nickname you will use for AI rankings.",
        profile: "This profile is used for AI records and rankings."
      },
      connecting: "Preparing your sign-in.",
      nicknameNeeded: "Nickname required",
      ready: "Profile ready",
      chooseMethod: "Choose sign-in method",
      placeholder: "Nickname, 2–12 characters",
      submit: "Save nickname",
      guestButton: "Continue as guest",
      colorLabel: "Profile block color",
      saveColor: "Save color",
      colorSaved: "Profile color saved.",
      hint: "Nicknames must be 2–12 characters and unique.",
      loggedIn: "Used for your AI ranking profile.",
      unavailable: "The login server is unavailable. Please try again shortly.",
      invalidLength: "Enter a nickname between 2 and 12 characters.",
      googleButton: "Continue with Google",
      googleLinked: "Google account connected.",
      profileAria: "Open AI profile",
      closeAria: "Close nickname setup"
    },
    ja: {
      title: "プレイヤーニックネーム設定",
      purpose: {
        ai: "AI対戦の記録とランキングに使うニックネームを設定してください。",
        ranking: "AIランキングへの参加と記録確認にはニックネームが必要です。",
        online: "AIランキングで使うニックネームを設定してください。",
        profile: "AI記録とランキングで使うプロフィールです。"
      },
      connecting: "ログイン情報を準備しています。",
      nicknameNeeded: "ニックネーム登録が必要",
      ready: "プロフィール登録完了",
      chooseMethod: "ログイン方法を選択",
      placeholder: "ニックネーム 2～12文字",
      submit: "ニックネーム登録",
      guestButton: "ゲストで始める",
      colorLabel: "プロフィールブロックの色",
      saveColor: "色を保存",
      colorSaved: "プロフィールカラーを保存しました。",
      hint: "2～12文字で、他のユーザーと同じ名前は使えません。",
      loggedIn: "AIランキングプロフィールに使用されます。",
      unavailable: "ログインサーバーに接続できません。しばらくしてから再試行してください。",
      invalidLength: "ニックネームは2～12文字で入力してください。",
      googleButton: "Googleアカウントで続行",
      googleLinked: "Googleアカウントを連携しました。",
      profileAria: "AIプロフィールを開く",
      closeAria: "ニックネーム設定を閉じる"
    },
    zh: {
      title: "设置玩家昵称",
      purpose: {
        ai: "请设置用于AI对战记录和排行榜的昵称。",
        ranking: "参加AI排行榜和查看记录需要设置昵称。",
        online: "请设置用于AI排行榜的昵称。",
        profile: "此资料用于AI记录和排行榜。"
      },
      connecting: "正在准备登录信息。",
      nicknameNeeded: "需要设置昵称",
      ready: "资料设置完成",
      chooseMethod: "选择登录方式",
      placeholder: "昵称，2至12个字符",
      submit: "保存昵称",
      guestButton: "以访客身份继续",
      colorLabel: "资料方块颜色",
      saveColor: "保存颜色",
      colorSaved: "资料颜色已保存。",
      hint: "昵称须为2至12个字符，且不能与他人重复。",
      loggedIn: "用于AI排行榜资料。",
      unavailable: "无法连接登录服务器，请稍后重试。",
      invalidLength: "请输入2至12个字符的昵称。",
      googleButton: "使用 Google 账号继续",
      googleLinked: "已连接 Google 账号。",
      profileAria: "打开AI资料",
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
      choice: document.getElementById("guestAuthChoice"),
      guestButton: document.getElementById("guestAuthGuestButton"),
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
      colorSave: document.getElementById("guestAuthColorSaveButton"),
      googleButtonMount: document.getElementById("guestGoogleButtonMount")
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

  function isLocalTestMode() {
    if (!canUseLocalTestMode()) return false;
    try {
      if (localStorage.getItem(TEST_FLAG_KEY) === "1") return true;
    } catch {}
    try {
      if (window.DegulTestGuard?.isTestMode?.() === true) return true;
    } catch {}
    const { protocol, hostname } = window.location;
    return protocol === "file:" || /^(localhost|127\.0\.0\.1|\[::1\])$/i.test(hostname || "") || isOperatorTestHost();
  }

  function ensureLocalTestUser() {
    if (!isLocalTestMode()) return null;
    currentUser = {
      ...LOCAL_TEST_USER,
      profileColor: currentUser?.profileColor || selectedProfileColor || LOCAL_TEST_USER.profileColor
    };
    selectedProfileColor = currentUser.profileColor;
    updateProfileButton();
    if (!localAuthAnnounced) {
      localAuthAnnounced = true;
      announceReady();
    }
    return currentUser;
  }

  async function api(path, options = {}) {
    const { remoteInTest, ...fetchOptions } = options;
    const localUser = ensureLocalTestUser();
    const isPagesPreview = /\.pages\.dev$/i.test(window.location.hostname || "");
    if (remoteInTest === true && isPagesPreview && path.startsWith("/api/ai/rankings")) {
      return remoteTestApi(path, fetchOptions);
    }
    if (localUser && remoteInTest !== true) {
      if (path.startsWith("/api/auth/")) {
        return { user: localUser, sessionToken: "" };
      }
      if (path.startsWith("/api/ai/rankings")) {
        return { top: [], me: null };
      }
      if (path.startsWith("/api/ai/sessions")) {
        return { sessionId: "local-test-session", submissionToken: "local-test-token" };
      }
      if (path.startsWith("/api/ai/results")) {
        return { ok: true, skipped: true, localTest: true };
      }
    }

    const headers = new Headers(fetchOptions.headers || {});
    headers.set("Accept", "application/json");
    if (fetchOptions.body) headers.set("Content-Type", "application/json");
    if (sessionToken) headers.set("Authorization", `Bearer ${sessionToken}`);

    const response = await fetch(`${apiBase}${path}`, {
      ...fetchOptions,
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

  async function remoteTestApi(path, fetchOptions) {
    const headers = new Headers(fetchOptions.headers || {});
    headers.set("Accept", "application/json");
    if (fetchOptions.body) headers.set("Content-Type", "application/json");
    const response = await fetch(`${TEST_RANKING_API_BASE}${path}`, {
      ...fetchOptions,
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
    el.profile.hidden = false;
    el.profile.setAttribute("aria-label", text().profileAria);
    el.profile.title = nickname || text().title;
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
    if (el.guestButton) el.guestButton.textContent = copy.guestButton;
    el.colorLabel.textContent = copy.colorLabel;
    el.colorSave.textContent = copy.saveColor;
    el.submit.disabled = busy || mode === "loading";
    el.colorSave.disabled = busy || mode === "loading";
    el.input.disabled = busy || mode === "loading";
    if (el.guestButton) el.guestButton.disabled = busy || mode === "loading";
    el.choice.hidden = mode !== "choice";
    el.form.hidden = mode !== "nickname";
    el.user.hidden = mode !== "ready";
    el.colorSave.hidden = mode !== "ready";
    el.state.classList.toggle("ready", mode === "ready");
    updateCharacterColors(selectedProfileColor || currentUser?.profileColor);

    if (mode === "choice") {
      el.state.textContent = copy.chooseMethod;
      setMessage("", false);
    } else if (mode === "loading") {
      el.state.textContent = copy.connecting;
      setMessage("", false);
    } else if (mode === "nickname") {
      el.state.textContent = copy.nicknameNeeded;
      setMessage(copy.hint, false);
    } else if (mode === "ready") {
      el.state.textContent = copy.ready;
      el.nickname.textContent = nickname;
      el.userHint.textContent = currentUser?.googleLinked ? `${copy.loggedIn} · Google` : copy.loggedIn;
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
    renderModal(currentUser?.nickname ? "ready" : (currentUser ? "nickname" : "choice"));
    window.requestAnimationFrame(renderGoogleButton);
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
      detail: {
        id: currentUser?.id || null,
        nickname: currentUser?.nickname || null,
        role: currentUser?.role || null
      }
    }));
    if (typeof window.updateGameModeUI === "function") window.updateGameModeUI();
  }

  async function ensureSession() {
    const localUser = ensureLocalTestUser();
    if (localUser) return localUser;

    if (!hasConsent()) return null;
    if (currentUser) return currentUser;
    if (sessionPromise) return sessionPromise;

    sessionPromise = (async () => {
      sessionToken = readStoredToken();

      if (sessionToken) {
        try {
          const data = await api("/api/auth/session", { method: "GET" });
          currentUser = data.user;
          selectedProfileColor = currentUser?.profileColor || selectedProfileColor;
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

  function waitForGoogle() {
    if (window.google?.accounts?.id) return Promise.resolve(window.google);
    return new Promise(resolve => {
      let tries = 0;
      const timer = window.setInterval(() => {
        tries += 1;
        if (window.google?.accounts?.id || tries > 80) {
          window.clearInterval(timer);
          resolve(window.google || null);
        }
      }, 100);
    });
  }

  async function configureGoogleSignIn() {
    const el = elements();
    if (!el.googleButtonMount) return;
    el.googleButtonMount.hidden = true;
    el.googleButtonMount.replaceChildren();
    googleButtonRendered = false;
    try {
      const data = await api("/api/auth/google/config", { method: "GET" });
      googleClientId = data?.enabled ? String(data.clientId || "") : "";
    } catch (error) {
      console.warn("[DegulAuth] google config unavailable", error);
      googleClientId = "";
    }
    if (!googleClientId) return;
    const google = await waitForGoogle();
    if (!google?.accounts?.id) return;
    if (!googleInitialized) {
      google.accounts.id.initialize({
        client_id: googleClientId,
        callback: handleGoogleCredential,
        use_fedcm_for_prompt: true,
        auto_select: false,
        cancel_on_tap_outside: true
      });
      googleInitialized = true;
    }
    renderGoogleButton();
  }

  function renderGoogleButton() {
    const el = elements();
    if (!googleClientId || !googleInitialized || !window.google?.accounts?.id || !el.googleButtonMount) return;
    if (!el.overlay?.classList.contains("show")) return;
    if (googleButtonRendered && el.googleButtonMount.childElementCount > 0) return;
    el.googleButtonMount.hidden = false;
    el.googleButtonMount.replaceChildren();
    google.accounts.id.renderButton(el.googleButtonMount, {
      type: "standard",
      theme: "outline",
      size: "large",
      text: "continue_with",
      shape: "rectangular",
      logo_alignment: "left",
      width: Math.min(400, Math.max(260, el.googleButtonMount.clientWidth || 360))
    });
    googleButtonRendered = true;
  }

  async function handleGoogleCredential(response) {
    if (!response?.credential || busy) return;
    busy = true;
    renderModal("loading");
    try {
      const data = await api("/api/auth/google", {
        method: "POST",
        body: JSON.stringify({ credential: response.credential })
      });
      if (data.sessionToken) storeToken(data.sessionToken);
      currentUser = data.user;
      selectedProfileColor = currentUser?.profileColor || selectedProfileColor;
      updateProfileButton();
      if (currentUser?.nickname) {
        announceReady();
        closeModal(false);
        runPendingAction();
      } else {
        renderModal("nickname");
        setMessage(text().googleLinked, false);
        window.setTimeout(() => elements().input?.focus(), 80);
      }
    } catch (error) {
      console.warn("[DegulAuth] google sign-in failed", error);
      setMessage(error.message || text().unavailable, true);
    } finally {
      busy = false;
      if (elements().overlay?.classList.contains("show")) {
        renderModal(currentUser?.nickname ? "ready" : (currentUser ? "nickname" : "choice"));
      }
    }
  }

  async function startGuestSignIn() {
    if (busy) return;
    if (!hasConsent()) {
      if (typeof window.openPrivacyPopup === "function") window.openPrivacyPopup(false);
      return;
    }
    busy = true;
    renderModal("loading");
    try {
      await ensureSession();
      renderModal(currentUser?.nickname ? "ready" : "nickname");
      if (!currentUser?.nickname) window.setTimeout(() => elements().input?.focus(), 80);
    } catch (error) {
      console.warn("[DegulAuth] guest sign-in unavailable", error);
      renderModal("choice");
      setMessage(error.message || text().unavailable, true);
    } finally {
      busy = false;
    }
  }

  function runPendingAction() {
    const action = pendingAction;
    pendingAction = null;
    pendingAllowLocalFallback = false;
    if (typeof action === "function") action();
  }

  async function requireNickname(reason, action, options = {}) {
    const localUser = ensureLocalTestUser();
    if (localUser?.nickname) {
      closeModal(false);
      if (typeof action === "function") action();
      else if (reason === "profile") showModal("profile");
      return true;
    }

    if (currentUser?.nickname) {
      if (typeof action === "function") action();
      else if (reason === "profile") showModal("profile");
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
    return false;
  }

  async function submitNickname(event) {
    event.preventDefault();
    if (busy) return;
    if (ensureLocalTestUser()) {
      closeModal(false);
      runPendingAction();
      return;
    }

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
    const requestedColor = selectedProfileColor;
    const el = elements();
    if (isLocalTestMode()) {
      currentUser = {
        ...currentUser,
        profileColor: requestedColor
      };
      updateCharacterColors(requestedColor);
      updateProfileButton();
      renderModal("ready");
      setMessage(text().colorSaved, false);
      return;
    }

    busy = true;
    let saved = false;
    let errorMessage = "";
    el.colorSave.disabled = true;
    el.colorInput.disabled = true;
    setMessage("", false);
    try {
      const data = await api("/api/auth/profile", {
        method: "POST",
        body: JSON.stringify({ profileColor: requestedColor })
      });
      currentUser = data.user;
      updateCharacterColors(currentUser.profileColor);
      updateProfileButton();
      saved = true;
    } catch (error) {
      errorMessage = error.message || text().unavailable;
      updateCharacterColors(requestedColor);
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
      if (pendingAction) requireNickname(modalReason, pendingAction, {
        allowLocalFallback: pendingAllowLocalFallback
      });
    }, 0);
  }

  function updateLanguage() {
    updateProfileButton();
    if (elements().overlay?.classList.contains("show")) renderModal(modalMode);
  }

  function openProfileEditor() {
    modalReason = "profile";
    if (currentUser?.nickname) {
      selectedProfileColor = currentUser.profileColor || selectedProfileColor;
      showModal("profile");
      return true;
    }
    return requireNickname("profile");
  }

  function init() {
    const el = elements();
    if (!el.overlay || !el.form) return;

    el.form.addEventListener("submit", submitNickname);
    el.close.addEventListener("click", () => closeModal(true));
    el.colorInput?.addEventListener("input", event => updateCharacterColors(event.target.value));
    el.colorSave?.addEventListener("click", saveProfileColor);
    el.guestButton?.addEventListener("click", startGuestSignIn);
    document.getElementById("privacyAgreeBtn")?.addEventListener("click", handlePrivacyAgreement, true);
    document.addEventListener("keydown", event => {
      if (event.key === "Escape" && el.overlay.classList.contains("show")) closeModal(true);
    });
    new MutationObserver(updateLanguage).observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["lang"]
    });

    installFeatureGuards();
    configureGoogleSignIn();
    if (ensureLocalTestUser()) return;
    if (hasConsent() && readStoredToken()) {
      ensureSession().catch(error => console.warn("[DegulAuth] silent login unavailable", error));
    }
  }

  window.DegulAuth = {
    getUser: () => currentUser ? {
      id: currentUser.id,
      nickname: currentUser.nickname,
      profileColor: currentUser.profileColor,
      role: currentUser.role || null,
      localTest: currentUser.localTest === true
    } : null,
    refresh: ensureSession,
    request: api,
    requireNickname,
    openProfile: openProfileEditor
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
