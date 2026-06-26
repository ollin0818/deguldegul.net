(function () {
  "use strict";

  const API_BASE = window.location.protocol === "file:" ? "https://deguldegul.net/api/online" : "/api/online";
  const SESSION_KEY = "degulDegulOnlineRoomSessionV1";
  const QUICK_TICKET_KEY = "degulDegulQuickMatchTicketV1";
  const DEFAULT_SKIN = "sky";
  let session = loadSession();
  let onlineMode = false;
  let pollTimer = null;
  let quickPollTimer = null;
  let quickTicket = loadQuickTicket();
  let quickMatching = !!quickTicket;
  let quickMatchState = quickMatching ? "waiting" : "idle";
  let realtimeSocket = null;
  let realtimeInputSeq = 0;
  let realtimePingTimer = null;
  let realtimeRttMs = 0;
  let realtimeSnapshotTick = -1;
  let realtimeStarted = false;
  let realtimeResultKey = "";
  let onlineInputPatched = false;
  let selectedSkin = session?.skin || DEFAULT_SKIN;
  let suppressPanelSync = false;
  const ONLINE_TEXT = {
    ko: {
      wsOpen: "실시간 서버에 연결했습니다.",
      wsClosed: "실시간 연결이 끊겼습니다. 재접속 중입니다.",
      wsError: "실시간 연결 오류가 발생했습니다.",
      forfeited: "상대 연결이 끊겨 경기가 종료되었습니다.",
      wall: "경계 밖으로 이동했습니다.",
      selfTrail: "자기 흔적을 밟았습니다.",
      opponentTrail: "상대 흔적을 밟았습니다.",
      collision: "두 플레이어가 충돌했습니다. 무승부!",
      land: "서버가 60% 이상 점령을 확인했습니다.",
      draw: "무승부",
      winner: slot => `${slot}P 승리`,
      quick: "빠른 대전",
      quickCancel: "매칭 취소",
      quickSub: "상대 자동 찾기",
      quickCancelSub: "탭해서 취소",
      quickWaiting: "상대를 찾는 중입니다.",
      quickWaitingLead: "비슷한 시간에 접속한 플레이어와 자동으로 연결합니다.",
      quickMatched: "상대를 찾았습니다. 곧 시작합니다.",
      quickMatchedLead: "매칭되었습니다. 서버 카운트다운을 준비합니다.",
      quickCanceled: "빠른 대전을 취소했습니다."
    },
    en: {
      wsOpen: "Connected to the realtime server.",
      wsClosed: "Realtime connection lost. Reconnecting.",
      wsError: "Realtime connection error.",
      forfeited: "The match ended because the opponent disconnected.",
      wall: "Moved outside the board.",
      selfTrail: "Stepped on own trail.",
      opponentTrail: "Cut the opponent trail.",
      collision: "Both players collided. Draw!",
      land: "The server confirmed 60% territory capture.",
      draw: "Draw",
      winner: slot => `${slot}P Win`,
      quick: "Quick Match",
      quickCancel: "Cancel Match",
      quickSub: "Find opponent",
      quickCancelSub: "Tap to cancel",
      quickWaiting: "Finding an opponent.",
      quickWaitingLead: "You will be paired with a player who joins around the same time.",
      quickMatched: "Opponent found. Starting soon.",
      quickMatchedLead: "Matched. Preparing the server countdown.",
      quickCanceled: "Quick match canceled."
    },
    ja: {
      wsOpen: "リアルタイムサーバーに接続しました。",
      wsClosed: "リアルタイム接続が切れました。再接続します。",
      wsError: "リアルタイム接続エラーが発生しました。",
      forfeited: "相手の切断により試合が終了しました。",
      wall: "ボード外へ移動しました。",
      selfTrail: "自分の軌跡を踏みました。",
      opponentTrail: "相手の軌跡を切りました。",
      collision: "2人のプレイヤーが衝突しました。引き分け！",
      land: "サーバーが60%以上の占領を確認しました。",
      draw: "引き分け",
      winner: slot => `${slot}P 勝利`,
      quick: "クイック対戦",
      quickCancel: "マッチング取消",
      quickSub: "相手を自動検索",
      quickCancelSub: "タップして取消",
      quickWaiting: "相手を探しています。",
      quickWaitingLead: "同じ時間帯に接続したプレイヤーと自動でつなぎます。",
      quickMatched: "相手が見つかりました。まもなく開始します。",
      quickMatchedLead: "マッチしました。サーバーカウントダウンを準備します。",
      quickCanceled: "クイック対戦をキャンセルしました。"
    },
    zh: {
      wsOpen: "已连接实时服务器。",
      wsClosed: "实时连接已断开，正在重连。",
      wsError: "实时连接发生错误。",
      forfeited: "对手断线，比赛已结束。",
      wall: "移动到了棋盘外。",
      selfTrail: "踩到了自己的轨迹。",
      opponentTrail: "切断了对手轨迹。",
      collision: "两名玩家相撞。平局！",
      land: "服务器确认占领超过60%。",
      draw: "平局",
      winner: slot => `${slot}P 胜利`,
      quick: "快速对战",
      quickCancel: "取消匹配",
      quickSub: "自动寻找对手",
      quickCancelSub: "点击取消",
      quickWaiting: "正在寻找对手。",
      quickWaitingLead: "系统会自动连接同一时间加入的玩家。",
      quickMatched: "已找到对手，即将开始。",
      quickMatchedLead: "匹配成功，正在准备服务器倒计时。",
      quickCanceled: "已取消快速对战。"
    }
  };

  function $(id) {
    return document.getElementById(id);
  }

  function getLang() {
    try {
      if (typeof currentLang === "string" && ONLINE_TEXT[currentLang]) return currentLang;
    } catch {}
    return "ko";
  }

  function onlineText(key, ...args) {
    const value = (ONLINE_TEXT[getLang()] || ONLINE_TEXT.ko)[key] || ONLINE_TEXT.ko[key] || key;
    return typeof value === "function" ? value(...args) : value;
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

  function loadQuickTicket() {
    try {
      return sessionStorage.getItem(QUICK_TICKET_KEY) || "";
    } catch {
      return "";
    }
  }

  function saveQuickTicket(ticket) {
    quickTicket = ticket || "";
    try {
      if (quickTicket) sessionStorage.setItem(QUICK_TICKET_KEY, quickTicket);
      else sessionStorage.removeItem(QUICK_TICKET_KEY);
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
      if (span) span.textContent = "빠른 대전";
      button.setAttribute("aria-pressed", onlineMode ? "true" : "false");
    }
    if (title) title.textContent = onlineText("quick");
    if (lead) lead.textContent = getLang() === "ko"
      ? "모드와 색상을 고른 뒤 바로 상대를 찾아 대전하세요."
      : "Choose your mode and color, then find an opponent instantly.";
    updateQuickMatchUI();
    if (onlineMode && !session && !quickMatching) setStatus(getLang() === "ko" ? "빠른 대전 또는 방 코드로 시작하세요." : "Start with Quick Match or a room code.");
    if (!session) updateOpponentPanel(null);
    applyOnlineRoomLayout();
  }

  function updateQuickMatchUI(state = quickMatchState) {
    const compact = $("onlineRoomCompact");
    const quickButton = $("onlineQuickMatchButton");
    const quickText = quickButton?.querySelector(".onlineQuickText");
    const quickSubtext = quickButton?.querySelector(".onlineQuickSubtext");
    const searchingPanel = $("onlineQuickSearchingPanel");
    const searchingTitle = $("onlineQuickSearchingTitle");
    const searchingLead = $("onlineQuickSearchingLead");
    const isWaiting = state === "waiting";
    const isMatched = state === "matched";

    if (compact) {
      compact.classList.toggle("quick-matching", isWaiting || isMatched);
      compact.classList.toggle("quick-matched", isMatched);
    }
    if (quickButton) {
      quickButton.setAttribute("aria-busy", isWaiting ? "true" : "false");
      quickButton.disabled = isMatched;
      quickButton.classList.toggle("matching", isWaiting || isMatched);
      if (quickText) quickText.textContent = isWaiting ? onlineText("quickCancel") : onlineText("quick");
      if (quickSubtext) quickSubtext.textContent = isWaiting ? onlineText("quickCancelSub") : onlineText("quickSub");
    }
    if (searchingPanel) searchingPanel.hidden = !(isWaiting || isMatched);
    if (searchingTitle) searchingTitle.textContent = isMatched ? onlineText("quickMatched") : onlineText("quickWaiting");
    if (searchingLead) searchingLead.textContent = isMatched ? onlineText("quickMatchedLead") : onlineText("quickWaitingLead");
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
      if (!suppressPanelSync) {
        try {
          window.setLobbyPanel?.("online");
        } catch {}
      }
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
    suppressPanelSync = false;
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
    const quickButton = $("onlineQuickMatchButton");
    if (quickButton) quickButton.disabled = !!isBusy && !quickMatching;
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
    maybeConnectRealtime(room);
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

  function startQuickPolling() {
    stopQuickPolling();
    if (!quickTicket) return;
    quickPollTimer = window.setInterval(() => requestQuickMatch(true), 1400);
  }

  function stopQuickPolling() {
    if (quickPollTimer) window.clearInterval(quickPollTimer);
    quickPollTimer = null;
  }

  function getRealtimeUrl() {
    if (!session?.roomCode || !session?.playerId) return "";
    const path = `/rooms/${encodeURIComponent(session.roomCode)}/play?playerId=${encodeURIComponent(session.playerId)}`;
    if (window.location.protocol === "file:") return `wss://deguldegul.net/api/online${path}`;
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${protocol}//${window.location.host}/api/online${path}`;
  }

  function maybeConnectRealtime(room) {
    if (!onlineMode || !session || !room) return;
    const p1Ready = !!(room.players?.[1] || room.players?.["1"])?.ready;
    const p2Ready = !!(room.players?.[2] || room.players?.["2"])?.ready;
    if (!p1Ready || !p2Ready) return;
    connectRealtime();
  }

  function connectRealtime() {
    if (!session || realtimeSocket && (realtimeSocket.readyState === WebSocket.OPEN || realtimeSocket.readyState === WebSocket.CONNECTING)) return;
    patchOnlineInput();
    const url = getRealtimeUrl();
    if (!url) return;
    realtimeSocket = new WebSocket(url);
    realtimeSocket.addEventListener("open", () => {
      setStatus(onlineText("wsOpen"));
      startRealtimePing();
    });
    realtimeSocket.addEventListener("message", event => {
      const message = JSON.parse(event.data || "{}");
      handleRealtimeMessage(message);
    });
    realtimeSocket.addEventListener("close", () => {
      stopRealtimePing();
      if (onlineMode && session) {
        setStatus(onlineText("wsClosed"), true);
        window.setTimeout(connectRealtime, 1200);
      }
    });
    realtimeSocket.addEventListener("error", () => setStatus(onlineText("wsError"), true));
  }

  function startRealtimePing() {
    stopRealtimePing();
    realtimePingTimer = window.setInterval(() => {
      if (!realtimeSocket || realtimeSocket.readyState !== WebSocket.OPEN) return;
      realtimeSocket.send(JSON.stringify({ type: "ping", clientNow: performance.now() }));
    }, 1200);
  }

  function stopRealtimePing() {
    if (realtimePingTimer) window.clearInterval(realtimePingTimer);
    realtimePingTimer = null;
  }

  function handleRealtimeMessage(message) {
    if (message.type === "pong") {
      realtimeRttMs = Math.max(0, Math.round(performance.now() - Number(message.clientNow || 0)));
      return;
    }
    if (message.type === "room") {
      renderRoom(message.room);
      return;
    }
    if (message.type === "snapshot") {
      applyServerSnapshot(message);
    }
  }

  function sendDirection(direction) {
    if (!realtimeSocket || realtimeSocket.readyState !== WebSocket.OPEN) return;
    realtimeInputSeq += 1;
    realtimeSocket.send(JSON.stringify({
      type: "input",
      seq: realtimeInputSeq,
      direction,
      clientNow: performance.now()
    }));
  }

  function patchOnlineInput() {
    if (onlineInputPatched) return;
    onlineInputPatched = true;
    const previousHandleInput = typeof handleInput === "function" ? handleInput : null;
    if (previousHandleInput) {
      handleInput = function () {
        if (window.DegulOnlineRoom?.isRealtimeActive?.()) return;
        return previousHandleInput.apply(this, arguments);
      };
    }
    window.addEventListener("keydown", event => {
      if (!window.DegulOnlineRoom?.isRealtimeActive?.()) return;
      const key = event.key;
      if (key === "w" || key === "W" || key === "ArrowUp") sendDirection("up");
      else if (key === "s" || key === "S" || key === "ArrowDown") sendDirection("down");
      else if (key === "a" || key === "A" || key === "ArrowLeft") sendDirection("left");
      else if (key === "d" || key === "D" || key === "ArrowRight") sendDirection("right");
    }, true);
  }

  function applyServerSnapshot(packet) {
    const snapshot = packet.state;
    if (!snapshot || snapshot.tick < realtimeSnapshotTick) return;
    realtimeSnapshotTick = snapshot.tick;
    if (snapshot.phase === "countdown") showServerCountdown(packet);
    if (snapshot.phase === "playing") showServerPlaying(snapshot);
    applyAuthoritativeState(snapshot);
    if (snapshot.phase === "ended") showServerResult(snapshot.result);
  }

  function showServerCountdown(packet) {
    if (!realtimeStarted) {
      realtimeStarted = true;
      realtimeResultKey = "";
      try { matchMode = "pvp"; } catch {}
      try { resetMatch(); } catch {}
      try { pauseLobbyBgm(); } catch {}
    }
    const lobby = $("lobby");
    const countdown = $("countdownOverlay");
    const countNumber = $("countNumber");
    if (lobby) lobby.style.display = "none";
    if (countdown) {
      countdown.style.display = "flex";
      countdown.classList.toggle("classic-mode", true);
      countdown.classList.toggle("item-mode", false);
    }
    const left = Number(packet.countdownRemainingMs || 0);
    const value = left > 1000 ? Math.ceil(left / 1000) : (left > 0 ? (typeof tr === "function" ? tr("start") : "START") : "");
    if (countNumber) countNumber.textContent = value;
    try { setGamePhase(GAME_PHASE.COUNTDOWN); } catch {}
  }

  function showServerPlaying(snapshot) {
    const countdown = $("countdownOverlay");
    if (countdown) countdown.style.display = "none";
    try { setGamePhase(GAME_PHASE.PLAYING); } catch {}
    try {
      if (!matchStartedAt) matchStartedAt = performance.now() - Math.max(0, Date.now() - Number(snapshot.startAt || Date.now()));
      playIngameBgm();
    } catch {}
  }

  function applyAuthoritativeState(snapshot) {
    try {
      if (Array.isArray(snapshot.land) && Array.isArray(land)) {
        for (let z = 0; z < snapshot.land.length; z++) {
          for (let x = 0; x < snapshot.land[z].length; x++) land[z][x] = snapshot.land[z][x];
        }
        refreshBoardColors();
      }
      syncActorFromSnapshot(p1, snapshot.players?.[1] || snapshot.players?.["1"]);
      syncActorFromSnapshot(p2, snapshot.players?.[2] || snapshot.players?.["2"]);
      updateScoreUIThrottled(true);
    } catch (error) {
      console.warn("Failed to apply online snapshot", error);
    }
  }

  function syncActorFromSnapshot(actor, data) {
    if (!actor || !data) return;
    if (typeof clearTrail === "function") clearTrail(actor);
    actor.x = data.x;
    actor.z = data.z;
    actor.dir = data.dir || actor.dir;
    actor.nextDir = data.nextDir || actor.nextDir;
    actor.alive = data.alive !== false;
    if (actor.mesh) {
      const y = actor.mesh.userData?.baseY || 0.42;
      actor.mesh.position.set(toWorld(actor.x), y, toWorld(actor.z));
      actor.mesh.visible = actor.alive;
    }
    if (Array.isArray(data.trail)) {
      for (const point of data.trail) addTrail(actor, point.x, point.z);
    }
  }

  function showServerResult(result) {
    if (!result) return;
    const key = `${result.endedAt || 0}:${result.tick || 0}:${result.reason || ""}`;
    if (realtimeResultKey === key) return;
    realtimeResultKey = key;
    try {
      setGamePhase(GAME_PHASE.ENDED);
      matchEndedAt = performance.now();
      pauseIngameBgm(true);
    } catch {}
    const winner = Number(result.winnerSlot) === 1 ? p1 : Number(result.winnerSlot) === 2 ? p2 : null;
    const reason = getResultReasonText(result);
    if (typeof showResultPopup === "function") showResultPopup(winner, reason);
  }

  function getResultReasonText(result) {
    if (!result) return "";
    if (result.reason === "forfeit") return onlineText("forfeited");
    if (result.reason === "wall") return onlineText("wall");
    if (result.reason === "self_trail") return onlineText("selfTrail");
    if (result.reason === "opponent_trail") return onlineText("opponentTrail");
    if (result.reason === "collision") return onlineText("collision");
    if (result.reason === "land") return onlineText("land");
    return result.winnerSlot ? onlineText("winner", result.winnerSlot) : onlineText("draw");
  }

  async function createRoom() {
    await cancelQuickMatch(false);
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
    await cancelQuickMatch(false);
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

  async function requestQuickMatch(isPoll = false) {
    if (session) return;
    if (!isPoll && quickMatching) {
      await cancelQuickMatch(true);
      return;
    }
    quickMatching = true;
    quickMatchState = "waiting";
    applyOnlineRoomText();
    setBusy(true);
    try {
      selectedSkin = getCurrentSelectedSkin();
      const data = await api("/quick", {
        method: "POST",
        body: {
          nickname: getNickname(),
          skin: selectedSkin,
          ticket: quickTicket || undefined
        }
      });
      if (data.status === "waiting") {
        saveQuickTicket(data.ticket);
        quickMatchState = "waiting";
        updateQuickMatchUI("waiting");
        setStatus(onlineText("quickWaiting"));
        startQuickPolling();
        return;
      }
      if (data.status === "matched") {
        stopQuickPolling();
        saveQuickTicket("");
        quickMatchState = "matched";
        updateQuickMatchUI("matched");
        setStatus(onlineText("quickMatched"));
        window.setTimeout(() => {
          quickMatching = false;
          quickMatchState = "idle";
          saveSession({
            roomCode: data.roomCode || data.room?.code,
            playerId: data.playerId,
            slot: data.slot,
            skin: selectedSkin
          });
          onlineMode = true;
          renderRoom(data.room);
          startPolling();
          maybeConnectRealtime(data.room);
        }, 720);
      }
    } catch (error) {
      if (!isPoll) setStatus(error.message, true);
      if (!isPoll) {
        quickMatching = false;
        quickMatchState = "idle";
        saveQuickTicket("");
        stopQuickPolling();
      }
    } finally {
      setBusy(false);
      applyOnlineRoomText();
    }
  }

  async function cancelQuickMatch(showStatus = true) {
    stopQuickPolling();
    if (quickTicket) {
      try {
        await api("/quick/cancel", {
          method: "POST",
          body: { ticket: quickTicket }
        });
      } catch {}
    }
    saveQuickTicket("");
    quickMatching = false;
    quickMatchState = "idle";
    applyOnlineRoomText();
    if (showStatus) setStatus(onlineText("quickCanceled"));
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
    stopRealtimePing();
    if (realtimeSocket) realtimeSocket.close(1000, "leave");
    realtimeSocket = null;
    realtimeStarted = false;
    realtimeResultKey = "";
    saveSession(null);
    onlineMode = true;
    renderRoom(null);
    setStatus("방에서 나갔습니다.");
    setBusy(false);
  }

  function bind() {
    applyOnlineRoomText();
    $("onlineCreateRoomButton")?.addEventListener("click", createRoom);
    $("onlineQuickMatchButton")?.addEventListener("click", () => requestQuickMatch(false));
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
      onlineMode = false;
      suppressPanelSync = true;
      applyOnlineRoomLayout();
      suppressPanelSync = false;
      refreshRoom();
      startPolling();
    } else {
      applyOnlineRoomLayout();
      renderRoom(null);
      if (quickTicket) {
        quickMatching = true;
        applyOnlineRoomText();
        setStatus(onlineText("quickWaiting"));
        startQuickPolling();
      }
    }
  }

  window.DegulOnlineRoom = {
    createRoom,
    joinRoom,
    leaveRoom,
    refreshRoom,
    setOnlineMode,
    applyOnlineRoomText,
    isRealtimeActive: () => !!(onlineMode && session && realtimeSocket && realtimeSocket.readyState === WebSocket.OPEN && realtimeStarted)
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
