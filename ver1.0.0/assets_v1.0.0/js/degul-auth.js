(function () {
  const SESSION_KEY = "degulDegulGuestSessionV1";
  const apiBase = String(
    window.DEGUL_API_BASE
      || document.querySelector('meta[name="degul-api-base"]')?.content
      || window.location.origin
  ).replace(/\/+$/, "");

  let sessionToken = "";
  let currentUser = null;
  let busy = false;

  const texts = {
    ko: {
      title: "게스트 로그인",
      connecting: "서버 연결 중",
      nicknameNeeded: "닉네임 등록 필요",
      ready: "자동 로그인 완료",
      placeholder: "닉네임 2~12자",
      submit: "등록",
      hint: "닉네임은 중복 사용할 수 없습니다.",
      loggedIn: "재접속 시 자동으로 로그인됩니다.",
      unavailable: "로그인 서버에 연결할 수 없습니다. 로컬 게임은 계속 이용할 수 있습니다.",
      invalidLength: "닉네임은 2자 이상 12자 이하로 입력해주세요."
    },
    en: {
      title: "Guest login",
      connecting: "Connecting",
      nicknameNeeded: "Nickname required",
      ready: "Signed in",
      placeholder: "Nickname, 2–12 characters",
      submit: "Save",
      hint: "Nicknames must be unique.",
      loggedIn: "You will be signed in automatically next time.",
      unavailable: "The login server is unavailable. Local play is still available.",
      invalidLength: "Enter a nickname between 2 and 12 characters."
    },
    ja: {
      title: "ゲストログイン",
      connecting: "接続中",
      nicknameNeeded: "ニックネーム登録が必要",
      ready: "自動ログイン完了",
      placeholder: "ニックネーム 2～12文字",
      submit: "登録",
      hint: "同じニックネームは使用できません。",
      loggedIn: "次回から自動でログインします。",
      unavailable: "ログインサーバーに接続できません。ローカルゲームは利用できます。",
      invalidLength: "ニックネームは2～12文字で入力してください。"
    },
    zh: {
      title: "游客登录",
      connecting: "正在连接",
      nicknameNeeded: "需要设置昵称",
      ready: "已自动登录",
      placeholder: "昵称，2至12个字符",
      submit: "保存",
      hint: "昵称不能重复。",
      loggedIn: "下次访问时将自动登录。",
      unavailable: "无法连接登录服务器，仍可继续本地游戏。",
      invalidLength: "请输入2至12个字符的昵称。"
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
      panel: document.getElementById("guestAuthPanel"),
      title: document.getElementById("guestAuthTitle"),
      state: document.getElementById("guestAuthState"),
      form: document.getElementById("guestAuthForm"),
      input: document.getElementById("guestNicknameInput"),
      submit: document.getElementById("guestNicknameSubmit"),
      message: document.getElementById("guestAuthMessage"),
      user: document.getElementById("guestAuthUser"),
      avatar: document.getElementById("guestAuthAvatar"),
      nickname: document.getElementById("guestAuthNickname"),
      userHint: document.getElementById("guestAuthUserHint")
    };
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
    const { message: element } = elements();
    if (!element) return;
    element.textContent = message || "";
    element.classList.toggle("error", Boolean(isError));
  }

  function render(mode) {
    const el = elements();
    if (!el.panel) return;
    const copy = text();

    el.title.textContent = copy.title;
    el.form.hidden = mode !== "nickname";
    el.user.hidden = mode !== "ready";
    el.input.placeholder = copy.placeholder;
    el.submit.textContent = copy.submit;
    el.submit.disabled = busy;
    el.input.disabled = busy;
    el.state.classList.toggle("ready", mode === "ready");

    if (mode === "loading") {
      el.state.textContent = copy.connecting;
      setMessage("", false);
    } else if (mode === "nickname") {
      el.state.textContent = copy.nicknameNeeded;
      if (!el.message.textContent || el.message.classList.contains("error") === false) {
        setMessage(copy.hint, false);
      }
    } else if (mode === "ready") {
      el.state.textContent = copy.ready;
      el.nickname.textContent = currentUser?.nickname || "";
      el.avatar.textContent = Array.from(currentUser?.nickname || "?")[0] || "?";
      el.userHint.textContent = copy.loggedIn;
      setMessage("", false);
    } else {
      el.state.textContent = "";
      setMessage(copy.unavailable, true);
    }
  }

  function announceReady() {
    window.dispatchEvent(new CustomEvent("degul:auth-ready", {
      detail: { nickname: currentUser?.nickname || null }
    }));
  }

  async function ensureSession() {
    render("loading");
    sessionToken = readStoredToken();

    if (sessionToken) {
      try {
        const data = await api("/api/auth/session", { method: "GET" });
        currentUser = data.user;
        render(data.needsNickname ? "nickname" : "ready");
        if (!data.needsNickname) announceReady();
        return;
      } catch (error) {
        if (error.status !== 401) throw error;
        storeToken("");
      }
    }

    const data = await api("/api/auth/guest", { method: "POST" });
    if (data.sessionToken) storeToken(data.sessionToken);
    currentUser = data.user;
    render("nickname");
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
    render("nickname");
    try {
      const data = await api("/api/auth/nickname", {
        method: "POST",
        body: JSON.stringify({ nickname })
      });
      currentUser = data.user;
      el.input.value = "";
      render("ready");
      announceReady();
    } catch (error) {
      if (error.status === 401) {
        storeToken("");
        await ensureSession();
        return;
      }
      setMessage(error.message || text().unavailable, true);
    } finally {
      busy = false;
      render(currentUser?.nickname ? "ready" : "nickname");
    }
  }

  function updateLanguage() {
    render(currentUser?.nickname ? "ready" : (sessionToken ? "nickname" : "loading"));
  }

  function init() {
    const el = elements();
    if (!el.panel) return;
    el.form.addEventListener("submit", submitNickname);
    new MutationObserver(updateLanguage).observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["lang"]
    });

    ensureSession().catch(error => {
      console.warn("[DegulAuth] login unavailable", error);
      render("error");
    });
  }

  window.DegulAuth = {
    getUser: () => currentUser ? { nickname: currentUser.nickname } : null,
    refresh: ensureSession
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
