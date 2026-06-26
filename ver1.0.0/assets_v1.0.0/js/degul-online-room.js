(function () {
  "use strict";

  const API_BASE = window.location.protocol === "file:" ? "https://deguldegul.net/api/online" : "/api/online";
  const SESSION_KEY = "degulDegulOnlineRoomSessionV1";
  const DEFAULT_SKIN = "sky";
  let session = loadSession();
  let onlineMode = !!session;
  let pollTimer = null;
  let selectedSkin = session?.skin || DEFAULT_SKIN;

  function $(id) {
    return document.getElementById(id);
  }

  function getNickname() {
    try {
      const user = window.DegulAuth?.getUser?.();
      if (user?.nickname) return user.nickname;
    } catch {}
    return "Player";
  }

  function normalizeCode(value) {
    return String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
  }

  function normalizeSkin(choice) {
    if (!choice) return DEFAULT_SKIN;
    return String(choice.skin || choice.name || DEFAULT_SKIN).toLowerCase().replace(/[^a-z0-9_-]/g, "") || DEFAULT_SKIN;
  }

  function getSkinChoices() {
    try {
      if (Array.isArray(COLOR_CHOICES)) return COLOR_CHOICES;
    } catch {}
    return [
      { name: "Sky", actor: 0x7dc7ff },
      { name: "Pink", actor: 0xff92b8 },
      { name: "Mint", actor: 0x62e6b7 },
      { name: "Yellow", actor: 0xffd166 }
    ];
  }

  function getLobbyCard() {
    return document.querySelector("#lobby .lobbyCard");
  }

  function getCurrentSelectedSkin() {
    try {
      if (selectedColors?.[1]) return normalizeSkin(selectedColors[1]);
    } catch {}
    return selectedSkin || DEFAULT_SKIN;
  }

  function isChoiceLocked(choice) {
    try {
      return !!choice.skin && typeof isSkinUnlocked === "function" && !isSkinUnlocked(choice.skin);
    } catch {
      return false;
    }
  }

  function loadSession() {
    try {
      const parsed = JSON.parse(sessionStorage.getItem(SESSION_KEY) || "null");
      if (parsed?.roomCode && parsed?.playerId) return parsed;
    } catch {}
    return null;
  }

  function saveSession(next) {
    session = next;
    try {
      if (next) sessionStorage.setItem(SESSION_KEY, JSON.stringify(next));
      else sessionStorage.removeItem(SESSION_KEY);
    } catch {}
  }

  async function api(path, options = {}) {
    const response = await fetch(`${API_BASE}${path}`, {
      method: options.method || "GET",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json"
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
      cache: "no-store"
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data?.ok === false) {
      const error = new Error(data?.message || "온라인 방 요청에 실패했습니다.");
      error.code = data?.error || "request_failed";
      throw error;
    }
    return data;
  }

  function setStatus(message, isError = false) {
    const status = $("onlineMatchStatus");
    if (!status) return;
    status.textContent = message || "";
    status.classList.toggle("error", !!isError);
  }

  function applyOnlineRoomText() {
    const button = $("onlineModeBtn");
    const title = $("onlineRoomTitle");
    const lead = $("onlineRoomLead");
    if (button) {
      const strong = button.querySelector("strong");
      const span = button.querySelector("span");
      if (strong) strong.textContent = "온라인 매칭";
      if (span) span.textContent = "방 코드로 입장";
      button.setAttribute("aria-pressed", onlineMode ? "true" : "false");
    }
    if (title) title.textContent = "온라인 매칭";
    if (lead) lead.textContent = "방을 만들거나 6자리 코드로 친구 방에 입장하세요.";
    if (onlineMode && !session) setStatus("방을 만들거나 코드로 입장하세요.");
    if (!session) updateOpponentPanel(null);
    applyOnlineRoomLayout();
  }

  function applyOnlineRoomLayout() {
    const card = getLobbyCard();
    const compact = $("onlineRoomCompact");
    const opponent = $("onlineOpponentPanel");
    const onlineButton = $("onlineModeBtn");
    const pvpButton = $("pvpModeBtn");
    const aiButton = $("aiModeBtn");

    if (card) card.classList.toggle("online-room-active", !!onlineMode);
    if (compact) compact.hidden = !onlineMode;
    if (opponent) opponent.hidden = !onlineMode;
    if (onlineButton) {
      onlineButton.classList.toggle("selected", !!onlineMode);
      onlineButton.setAttribute("aria-pressed", onlineMode ? "true" : "false");
    }
    if (onlineMode) {
      pvpButton?.classList.remove("selected");
      aiButton?.classList.remove("selected");
      try {
        window.setLobbyPanel?.("online");
      } catch {}
    }
  }

  function updateOpponentPanel(room) {
    const panel = $("onlineOpponentPanel");
    if (!panel) return;
    panel.hidden = !onlineMode;

    const slotLabel = $("onlineLocalSlot");
    const name = $("onlineOpponentName");
    const state = $("onlineOpponentState");
    const localSlot = Number(session?.slot) || 1;
    const opponentSlot = localSlot === 1 ? 2 : 1;
    const opponent = room?.players?.[String(opponentSlot)] || room?.players?.[opponentSlot] || null;

    if (slotLabel) slotLabel.textContent = session ? `${localSlot}P 온라인` : "ONLINE";
    if (name) name.textContent = opponent ? opponent.nickname || `${opponentSlot}P` : "상대 대기 중";
    if (state) {
      if (!session) state.textContent = "방을 만들거나 코드로 입장하세요.";
      else if (opponent) state.textContent = opponent.ready ? "상대 준비 완료" : "상대 입장 완료";
      else state.textContent = "초대한 상대를 기다리는 중";
    }
  }

  function setOnlineMode(enabled) {
    onlineMode = !!enabled;
    applyOnlineRoomLayout();
    if (onlineMode) {
      if (session) refreshRoom();
      else {
        renderRoom(null);
        setStatus("방을 만들거나 코드로 입장하세요.");
      }
    } else {
      try {
        window.setLobbyPanel?.("main");
      } catch {}
      try {
        window.updateGameModeUI?.();
      } catch {}
    }
  }

  function setBusy(isBusy) {
    ["onlineCreateRoomButton", "onlineJoinRoomButton", "onlineReadyButton", "onlineLeaveRoomButton"].forEach((id) => {
      const button = $(id);
      if (button) button.disabled = !!isBusy;
    });
  }

  function renderSkins() {
    const grid = $("onlineRoomSkinGrid");
    if (!grid) return;
    grid.innerHTML = "";
    getSkinChoices().forEach((choice) => {
      if (choice.hidden) return;
      const skin = normalizeSkin(choice);
      const button = document.createElement("button");
      button.type = "button";
      button.className = "onlineRoomSkinButton";
      button.style.setProperty("--skin-color", `#${Number(choice.actor || 0x64beff).toString(16).padStart(6, "0")}`);
      button.title = choice.name || skin;
      button.setAttribute("aria-label", choice.name || skin);
      button.classList.toggle("selected", selectedSkin === skin);
      const locked = isChoiceLocked(choice);
      button.classList.toggle("locked", locked);
      button.disabled = locked;
      button.addEventListener("click", () => selectSkin(skin));
      grid.appendChild(button);
    });
  }

  function renderRoom(room) {
    const inRoom = !!session && !!room;
    const entry = $("onlineRoomEntry");
    const lobby = $("onlineRoomLobby");
    applyOnlineRoomLayout();
    if (entry) entry.hidden = inRoom;
    if (lobby) lobby.hidden = !inRoom;
    updateOpponentPanel(room);
    if (!inRoom) return;

    $("onlineRoomCode").textContent = room.code || session.roomCode || "------";
    const localSlot = Number(session.slot);
    [1, 2].forEach((slot) => {
      const card = $(`onlineRoomPlayer${slot}`);
      if (!card) return;
      const player = room.players?.[String(slot)] || room.players?.[slot] || null;
      card.classList.toggle("is-local", slot === localSlot);
      card.classList.toggle("ready", !!player?.ready);
      const name = card.querySelector(".onlineRoomPlayerName");
      const ready = card.querySelector(".onlineRoomPlayerReady");
      if (name) name.textContent = player ? player.nickname || `${slot}P` : (slot === 1 ? "1P 대기 중" : "상대 대기 중");
      if (ready) ready.textContent = player ? (player.ready ? "준비 완료" : "준비 전") : "빈 자리";
    });

    const me = room.players?.[String(localSlot)] || room.players?.[localSlot] || null;
    if (me?.skin) selectedSkin = me.skin;
    const readyButton = $("onlineReadyButton");
    if (readyButton) readyButton.textContent = me?.ready ? "준비 취소" : "준비";
    renderSkins();

    const opponentSlot = localSlot === 1 ? 2 : 1;
    const opponent = room.players?.[String(opponentSlot)] || room.players?.[opponentSlot] || null;
    if (opponent) {
      setStatus(opponent.ready ? "상대가 준비 완료했습니다." : "상대가 입장했습니다.");
    } else {
      setStatus("상대 입장을 기다리는 중입니다.");
    }
  }

  async function refreshRoom() {
    if (!session?.roomCode || !session?.playerId) return;
    try {
      const data = await api(`/rooms/${encodeURIComponent(session.roomCode)}?playerId=${encodeURIComponent(session.playerId)}`);
      renderRoom(data.room);
    } catch (error) {
      stopPolling();
      saveSession(null);
      renderRoom(null);
      setStatus(error.code === "room_not_found" ? "방이 사라졌습니다." : error.message, true);
    }
  }

  function startPolling() {
    stopPolling();
    if (!session) return;
    pollTimer = window.setInterval(refreshRoom, 1800);
  }

  function stopPolling() {
    if (pollTimer) window.clearInterval(pollTimer);
    pollTimer = null;
  }

  async function createRoom() {
    setBusy(true);
    try {
      selectedSkin = getCurrentSelectedSkin();
      const data = await api("/rooms", {
        method: "POST",
        body: { nickname: getNickname(), skin: selectedSkin }
      });
      saveSession({
        roomCode: data.room.code,
        playerId: data.playerId,
        slot: data.slot,
        skin: selectedSkin
      });
      onlineMode = true;
      renderRoom(data.room);
      startPolling();
      setStatus("방을 만들었습니다. 코드를 친구에게 공유하세요.");
    } catch (error) {
      setStatus(error.message, true);
    } finally {
      setBusy(false);
    }
  }

  async function joinRoom() {
    const input = $("onlineRoomCodeInput");
    const code = normalizeCode(input?.value);
    if (input) input.value = code;
    if (code.length !== 6) {
      setStatus("6자리 방 코드를 입력하세요.", true);
      return;
    }
    setBusy(true);
    try {
      selectedSkin = getCurrentSelectedSkin();
      const data = await api(`/rooms/${encodeURIComponent(code)}/join`, {
        method: "POST",
        body: { nickname: getNickname(), skin: selectedSkin }
      });
      saveSession({
        roomCode: data.room.code,
        playerId: data.playerId,
        slot: data.slot,
        skin: selectedSkin
      });
      onlineMode = true;
      renderRoom(data.room);
      startPolling();
      setStatus(`${data.slot}P로 입장했습니다.`);
    } catch (error) {
      setStatus(error.message, true);
    } finally {
      setBusy(false);
    }
  }

  async function toggleReady() {
    if (!session) return;
    const localCard = $(`onlineRoomPlayer${session.slot}`);
    const ready = !localCard?.classList.contains("ready");
    setBusy(true);
    try {
      const data = await api(`/rooms/${encodeURIComponent(session.roomCode)}/ready`, {
        method: "POST",
        body: { playerId: session.playerId, ready }
      });
      renderRoom(data.room);
    } catch (error) {
      setStatus(error.message, true);
    } finally {
      setBusy(false);
    }
  }

  async function selectSkin(skin) {
    selectedSkin = skin || DEFAULT_SKIN;
    if (session) session.skin = selectedSkin;
    saveSession(session);
    renderSkins();
    if (!session) return;
    try {
      const data = await api(`/rooms/${encodeURIComponent(session.roomCode)}/skin`, {
        method: "POST",
        body: { playerId: session.playerId, skin: selectedSkin }
      });
      renderRoom(data.room);
    } catch (error) {
      setStatus(error.message, true);
    }
  }

  async function leaveRoom() {
    if (!session) return;
    setBusy(true);
    try {
      await api(`/rooms/${encodeURIComponent(session.roomCode)}/leave`, {
        method: "POST",
        body: { playerId: session.playerId }
      });
    } catch {}
    stopPolling();
    saveSession(null);
    onlineMode = true;
    renderRoom(null);
    setStatus("방에서 나갔습니다.");
    setBusy(false);
  }

  function bind() {
    applyOnlineRoomText();
    $("onlineCreateRoomButton")?.addEventListener("click", createRoom);
    $("onlineJoinRoomButton")?.addEventListener("click", joinRoom);
    $("onlineReadyButton")?.addEventListener("click", toggleReady);
    $("onlineLeaveRoomButton")?.addEventListener("click", leaveRoom);
    $("onlineCopyRoomCodeButton")?.addEventListener("click", async () => {
      const code = session?.roomCode || $("onlineRoomCode")?.textContent || "";
      try {
        await navigator.clipboard.writeText(code);
        setStatus("방 코드를 복사했습니다.");
      } catch {
        setStatus(code);
      }
    });
    $("onlineRoomCodeInput")?.addEventListener("input", (event) => {
      event.target.value = normalizeCode(event.target.value);
    });
    $("onlineRoomCodeInput")?.addEventListener("keydown", (event) => {
      if (event.key === "Enter") joinRoom();
    });
    renderSkins();
    if (session) {
      onlineMode = true;
      applyOnlineRoomLayout();
      refreshRoom();
      startPolling();
    } else {
      applyOnlineRoomLayout();
      renderRoom(null);
    }
  }

  window.DegulOnlineRoom = {
    createRoom,
    joinRoom,
    leaveRoom,
    refreshRoom,
    setOnlineMode,
    applyOnlineRoomText
  };

  const previousUpdateSiteInfoLanguage = window.updateSiteInfoLanguage;
  if (typeof previousUpdateSiteInfoLanguage === "function" && !previousUpdateSiteInfoLanguage.__degulOnlineRoomWrapped) {
    const wrapped = function (...args) {
      const result = previousUpdateSiteInfoLanguage.apply(this, args);
      applyOnlineRoomText();
      return result;
    };
    wrapped.__degulOnlineRoomWrapped = true;
    window.updateSiteInfoLanguage = wrapped;
  }

  const previousUpdateGameModeUI = window.updateGameModeUI;
  if (typeof previousUpdateGameModeUI === "function" && !previousUpdateGameModeUI.__degulOnlineRoomWrapped) {
    const wrapped = function (...args) {
      const result = previousUpdateGameModeUI.apply(this, args);
      if (onlineMode) applyOnlineRoomLayout();
      return result;
    };
    wrapped.__degulOnlineRoomWrapped = true;
    window.updateGameModeUI = wrapped;
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bind, { once: true });
  } else {
    bind();
  }
})();
