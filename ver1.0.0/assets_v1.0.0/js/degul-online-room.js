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
  let onlineEntryMode = "quick";
  let onlineGameMode = "speed";
  let realtimeSocket = null;
  let realtimeInputSeq = 0;
  let realtimeLastSentDirection = "";
  let realtimePingTimer = null;
  let realtimeRttMs = 0;
  let realtimeSnapshotTick = -1;
  let pendingRealtimeSnapshotPacket = null;
  let realtimeSnapshotFrame = 0;
  let realtimeStarted = false;
  let realtimeResultKey = "";
  let onlineInputPatched = false;
  let currentRoom = null;
  let selectedSkin = session?.skin || DEFAULT_SKIN;
  let selectedSolidSkin = session?.skin || DEFAULT_SKIN;
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
      onlineTitle: "온라인 대전",
      onlineBadge: "online battle",
      onlineLead: "원하는 방식으로 상대와 실시간 대전을 시작하세요.",
      onlineButtonTitle: "온라인 대전",
      backToLobby: "로비로 돌아가기",
      quick: "빠른 대전",
      quickStart: "빠른 대전 시작",
      quickCardTitle: "빠른대전",
      quickCardSub: "상대 자동 찾기",
      quickCancel: "매칭 취소",
      quickSub: "상대 자동 찾기",
      quickCancelSub: "탭해서 취소",
      quickWaiting: "상대를 찾는 중입니다.",
      quickWaitingLead: "비슷한 시간에 접속한 플레이어와 자동으로 연결합니다.",
      quickMatched: "상대를 찾았습니다. 곧 시작합니다.",
      quickMatchedLead: "매칭되었습니다. 서버 카운트다운을 준비합니다.",
      quickCanceled: "빠른 대전을 취소했습니다.",
      createCardTitle: "방만들기",
      createCardSub: "코드로 초대",
      createButton: "방 만들기",
      createHint: "방을 만든 뒤 6자리 코드를 친구에게 공유하세요.",
      joinCardTitle: "코드입장",
      joinCardSub: "친구 방 참가",
      joinButton: "입장",
      joinHint: "친구가 공유한 6자리 방 코드를 입력하세요.",
      roomCodePlaceholder: "방 코드",
      speedModeTitle: "스피드 모드",
      speedModeSub: "스피드 부스트 속도가 기본인 빠른 모드",
      itemModeTitle: "아이템 모드",
      itemModeSub: "아이템을 활용해 변수를 만드는 모드",
      roomCodeLabel: "방 코드",
      copyButton: "복사",
      readyButton: "준비",
      unreadyButton: "준비 취소",
      leaveButton: "방 나가기",
      waitingP1: "1P 대기 중",
      waitingOpponent: "상대 대기 중",
      seatEmpty: "빈 자리",
      readyDone: "준비 완료",
      readyBefore: "준비 전",
      localOnlineSlot: slot => `${slot}P 온라인`,
      opponentNone: "방을 만들거나 코드로 입장하세요.",
      opponentReady: "상대 준비 완료",
      opponentJoined: "상대 입장 완료",
      opponentWaiting: "초대한 상대를 기다리는 중",
      roomCreated: "방을 만들었습니다. 코드를 친구에게 공유하세요.",
      roomJoined: slot => `${slot}P로 입장했습니다.`,
      roomLeft: "방에서 나갔습니다.",
      roomCodeCopied: "방 코드를 복사했습니다.",
      roomMissing: "방이 사라졌습니다.",
      opponentReadyStatus: "상대가 준비 완료했습니다.",
      opponentJoinedStatus: "상대가 입장했습니다.",
      waitingOpponentStatus: "상대 입장을 기다리는 중입니다.",
      requestFailed: "온라인 방 요청에 실패했습니다.",
      enterRoomCode: "6자리 방 코드를 입력하세요.",
      previousSolid: "이전 단색",
      nextSolid: "다음 단색",
      previousSkin: "이전 스킨",
      nextSkin: "다음 스킨"
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
      onlineTitle: "Online Battle",
      onlineBadge: "online battle",
      onlineLead: "Choose how to start a realtime match.",
      onlineButtonTitle: "Online Battle",
      backToLobby: "Back to lobby",
      quick: "Quick Match",
      quickStart: "Start Quick Match",
      quickCardTitle: "Quick Match",
      quickCardSub: "Auto-find opponent",
      quickCancel: "Cancel Match",
      quickSub: "Find opponent",
      quickCancelSub: "Tap to cancel",
      quickWaiting: "Finding an opponent.",
      quickWaitingLead: "You will be paired with a player who joins around the same time.",
      quickMatched: "Opponent found. Starting soon.",
      quickMatchedLead: "Matched. Preparing the server countdown.",
      quickCanceled: "Quick match canceled.",
      createCardTitle: "Create Room",
      createCardSub: "Invite by code",
      createButton: "Create Room",
      createHint: "Create a room, then share the 6-character code with a friend.",
      joinCardTitle: "Enter Code",
      joinCardSub: "Join a friend",
      joinButton: "Join",
      joinHint: "Enter the 6-character room code your friend shared.",
      roomCodePlaceholder: "Room Code",
      speedModeTitle: "Speed Mode",
      speedModeSub: "Fast standard mode with speed boost pacing.",
      itemModeTitle: "Item Mode",
      itemModeSub: "Use items to create match-changing moments.",
      roomCodeLabel: "Room Code",
      copyButton: "Copy",
      readyButton: "Ready",
      unreadyButton: "Cancel Ready",
      leaveButton: "Leave Room",
      waitingP1: "Waiting for 1P",
      waitingOpponent: "Waiting for opponent",
      seatEmpty: "Empty",
      readyDone: "Ready",
      readyBefore: "Not ready",
      localOnlineSlot: slot => `${slot}P Online`,
      opponentNone: "Create a room or enter a code.",
      opponentReady: "Opponent ready",
      opponentJoined: "Opponent joined",
      opponentWaiting: "Waiting for invited opponent",
      roomCreated: "Room created. Share the code with a friend.",
      roomJoined: slot => `Joined as ${slot}P.`,
      roomLeft: "Left the room.",
      roomCodeCopied: "Room code copied.",
      roomMissing: "The room disappeared.",
      opponentReadyStatus: "Opponent is ready.",
      opponentJoinedStatus: "Opponent joined.",
      waitingOpponentStatus: "Waiting for opponent to join.",
      requestFailed: "Online room request failed.",
      enterRoomCode: "Enter the 6-character room code.",
      previousSolid: "Previous solid color",
      nextSolid: "Next solid color",
      previousSkin: "Previous skin",
      nextSkin: "Next skin"
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
      onlineTitle: "オンライン対戦",
      onlineBadge: "online battle",
      onlineLead: "好きな方法でリアルタイム対戦を始めましょう。",
      onlineButtonTitle: "オンライン対戦",
      backToLobby: "ロビーに戻る",
      quick: "クイック対戦",
      quickStart: "クイック対戦開始",
      quickCardTitle: "クイック対戦",
      quickCardSub: "相手を自動検索",
      quickCancel: "マッチング取消",
      quickSub: "相手を自動検索",
      quickCancelSub: "タップして取消",
      quickWaiting: "相手を探しています。",
      quickWaitingLead: "同じ時間帯に接続したプレイヤーと自動でつなぎます。",
      quickMatched: "相手が見つかりました。まもなく開始します。",
      quickMatchedLead: "マッチしました。サーバーカウントダウンを準備します。",
      quickCanceled: "クイック対戦をキャンセルしました。",
      createCardTitle: "部屋作成",
      createCardSub: "コードで招待",
      createButton: "部屋を作成",
      createHint: "部屋を作成したら、6桁のコードを友だちに共有してください。",
      joinCardTitle: "コード入場",
      joinCardSub: "友だちの部屋へ",
      joinButton: "入場",
      joinHint: "友だちから共有された6桁の部屋コードを入力してください。",
      roomCodePlaceholder: "部屋コード",
      speedModeTitle: "スピードモード",
      speedModeSub: "スピードブーストの速度が基本の高速モード",
      itemModeTitle: "アイテムモード",
      itemModeSub: "アイテムで展開を変えるモード",
      roomCodeLabel: "部屋コード",
      copyButton: "コピー",
      readyButton: "準備",
      unreadyButton: "準備取消",
      leaveButton: "部屋を出る",
      waitingP1: "1P待機中",
      waitingOpponent: "相手待機中",
      seatEmpty: "空き",
      readyDone: "準備完了",
      readyBefore: "準備前",
      localOnlineSlot: slot => `${slot}P オンライン`,
      opponentNone: "部屋を作成するかコードで入場してください。",
      opponentReady: "相手準備完了",
      opponentJoined: "相手入場完了",
      opponentWaiting: "招待した相手を待っています",
      roomCreated: "部屋を作成しました。コードを友だちに共有してください。",
      roomJoined: slot => `${slot}Pで入場しました。`,
      roomLeft: "部屋から退出しました。",
      roomCodeCopied: "部屋コードをコピーしました。",
      roomMissing: "部屋がなくなりました。",
      opponentReadyStatus: "相手が準備完了しました。",
      opponentJoinedStatus: "相手が入場しました。",
      waitingOpponentStatus: "相手の入場を待っています。",
      requestFailed: "オンライン部屋リクエストに失敗しました。",
      enterRoomCode: "6桁の部屋コードを入力してください。",
      previousSolid: "前の単色",
      nextSolid: "次の単色",
      previousSkin: "前のスキン",
      nextSkin: "次のスキン"
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
      onlineTitle: "在线对战",
      onlineBadge: "online battle",
      onlineLead: "选择一种方式开始实时对战。",
      onlineButtonTitle: "在线对战",
      backToLobby: "返回大厅",
      quick: "快速对战",
      quickStart: "开始快速对战",
      quickCardTitle: "快速对战",
      quickCardSub: "自动寻找对手",
      quickCancel: "取消匹配",
      quickSub: "自动寻找对手",
      quickCancelSub: "点击取消",
      quickWaiting: "正在寻找对手。",
      quickWaitingLead: "系统会自动连接同一时间加入的玩家。",
      quickMatched: "已找到对手，即将开始。",
      quickMatchedLead: "匹配成功，正在准备服务器倒计时。",
      quickCanceled: "已取消快速对战。",
      createCardTitle: "创建房间",
      createCardSub: "用代码邀请",
      createButton: "创建房间",
      createHint: "创建房间后，将6位代码分享给朋友。",
      joinCardTitle: "输入代码",
      joinCardSub: "加入好友房间",
      joinButton: "进入",
      joinHint: "请输入朋友分享的6位房间代码。",
      roomCodePlaceholder: "房间代码",
      speedModeTitle: "速度模式",
      speedModeSub: "以速度加成为基础的快速模式",
      itemModeTitle: "道具模式",
      itemModeSub: "使用道具制造变化的模式",
      roomCodeLabel: "房间代码",
      copyButton: "复制",
      readyButton: "准备",
      unreadyButton: "取消准备",
      leaveButton: "离开房间",
      waitingP1: "等待1P",
      waitingOpponent: "等待对手",
      seatEmpty: "空位",
      readyDone: "已准备",
      readyBefore: "未准备",
      localOnlineSlot: slot => `${slot}P 在线`,
      opponentNone: "请创建房间或输入代码。",
      opponentReady: "对手已准备",
      opponentJoined: "对手已加入",
      opponentWaiting: "正在等待邀请的对手",
      roomCreated: "房间已创建，请把代码分享给朋友。",
      roomJoined: slot => `已作为${slot}P进入。`,
      roomLeft: "已离开房间。",
      roomCodeCopied: "房间代码已复制。",
      roomMissing: "房间已不存在。",
      opponentReadyStatus: "对手已准备。",
      opponentJoinedStatus: "对手已加入。",
      waitingOpponentStatus: "正在等待对手加入。",
      requestFailed: "在线房间请求失败。",
      enterRoomCode: "请输入6位房间代码。",
      previousSolid: "上一种纯色",
      nextSolid: "下一种纯色",
      previousSkin: "上一个皮肤",
      nextSkin: "下一个皮肤"
    }
  };

  function $(id) {
    return document.getElementById(id);
  }

  function getLang() {
    try {
      if (typeof currentLang === "string" && ONLINE_TEXT[currentLang]) return currentLang;
    } catch {}
    const documentLang = document.documentElement.lang;
    if (ONLINE_TEXT[documentLang]) return documentLang;
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

  const ONLINE_COLOR_NAMES = {
    Sky: { ko: "하늘색", en: "Sky Blue", ja: "空色", zh: "天蓝色" },
    Pink: { ko: "분홍색", en: "Pink", ja: "ピンク", zh: "粉色" },
    Mint: { ko: "민트색", en: "Mint", ja: "ミント", zh: "薄荷色" },
    Yellow: { ko: "노란색", en: "Yellow", ja: "イエロー", zh: "黄色" },
    Purple: { ko: "보라색", en: "Purple", ja: "パープル", zh: "紫色" },
    Coral: { ko: "코랄색", en: "Coral", ja: "コーラル", zh: "珊瑚色" },
    "Gift Box": { ko: "선물 스킨", en: "Gift Skin", ja: "ギフトスキン", zh: "礼物皮肤" },
    Ice: { ko: "얼음 스킨", en: "Ice Skin", ja: "アイススキン", zh: "冰雪皮肤" },
    Rainbow: { ko: "무지개 스킨", en: "Rainbow Skin", ja: "レインボースキン", zh: "彩虹皮肤" },
    Chocolate: { ko: "초콜릿 스킨", en: "Chocolate Skin", ja: "チョコレートスキン", zh: "巧克力皮肤" },
    Knight: { ko: "나이트 스킨", en: "Knight Skin", ja: "ナイトスキン", zh: "骑士皮肤" },
    Extreme: { ko: "익스트림 AI 스킨", en: "Extreme AI Skin", ja: "エクストリームAIスキン", zh: "极限AI皮肤" },
    Hell: { ko: "지옥 AI 스킨", en: "Hell AI Skin", ja: "ヘルAIスキン", zh: "地狱AI皮肤" },
    Chaos: { ko: "카오스 AI 스킨", en: "Chaos AI Skin", ja: "カオスAIスキン", zh: "混沌AI皮肤" },
    Ghost: { ko: "유령 스킨", en: "Ghost Skin", ja: "ゴーストスキン", zh: "幽灵皮肤" }
  };

  function getChoiceDisplayName(choice) {
    if (!choice) return "";
    try {
      if (typeof getColorDisplayName === "function") return getColorDisplayName(choice);
    } catch {}
    const names = ONLINE_COLOR_NAMES[choice.name];
    return names?.[getLang()] || names?.ko || names?.en || choice.name || normalizeSkin(choice);
  }

  function getLobbyCard() {
    return document.querySelector("#lobby .lobbyCard");
  }

  function getCurrentSelectedSkin() {
    return getOnlineBattleSkin();
  }

  function isChoiceLocked(choice) {
    try {
      return !!choice.skin && typeof isSkinUnlocked === "function" && !isSkinUnlocked(choice.skin);
    } catch {
      return false;
    }
  }

  function getSkinColor(skin, slot = 1) {
    const normalized = normalizeSkin({ skin });
    const choice = getSkinChoices().find(item => normalizeSkin(item) === normalized);
    const fallback = slot === 1 ? 0x7dc7ff : 0xff92b8;
    const value = Number(choice?.actor);
    return `#${(Number.isFinite(value) ? value : fallback).toString(16).padStart(6, "0")}`;
  }

  function getSelectedSkinChoice() {
    return getSelectedSpecialChoice() || getSkinChoices()[0] || { name: "Gift Box", actor: 0xff3b6b, skin: "gift" };
  }

  function getSelectableSkinChoices() {
    return getSkinChoices().filter(choice => !choice.hidden && !isChoiceLocked(choice));
  }

  function getSolidChoices() {
    return getSkinChoices().filter(choice => !choice.hidden && !choice.skin && !isChoiceLocked(choice));
  }

  function getSpecialSkinChoices() {
    return getSkinChoices().filter(choice => !choice.hidden && !!choice.skin && !isChoiceLocked(choice));
  }

  function getChoiceByKey(key) {
    const normalized = normalizeSkin({ skin: key });
    return getSkinChoices().find(choice => normalizeSkin(choice) === normalized) || null;
  }

  function getSelectedSolidChoice() {
    const choices = getSolidChoices();
    return choices.find(choice => normalizeSkin(choice) === selectedSolidSkin) || choices[0] || getSkinChoices()[0] || null;
  }

  function getSelectedSpecialChoice() {
    const choices = getSpecialSkinChoices();
    return choices.find(choice => normalizeSkin(choice) === selectedSkin) || choices[0] || getChoiceByKey(selectedSkin) || getSkinChoices()[0] || null;
  }

  function getOnlineBattleSkin() {
    return selectedSkin || normalizeSkin(getSelectedSolidChoice()) || selectedSolidSkin || DEFAULT_SKIN;
  }

  function syncOnlineSelectionDefaults() {
    const solid = getSelectedSolidChoice();
    if (solid) selectedSolidSkin = normalizeSkin(solid);
    selectedSkin = normalizeSkin(getChoiceByKey(selectedSkin) || solid || { skin: selectedSkin });
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
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
      const error = new Error(data?.message || onlineText("requestFailed"));
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
    const badge = document.querySelector(".onlineMatchBadge");
    const backButton = $("onlineRoomBackButton");
    if (button) {
      const strong = button.querySelector("strong");
      const span = button.querySelector("span");
      if (strong) strong.textContent = onlineText("onlineButtonTitle");
      if (span) span.textContent = onlineText("quick");
      button.setAttribute("aria-pressed", onlineMode ? "true" : "false");
    }
    if (badge) badge.textContent = onlineText("onlineBadge");
    if (backButton) {
      backButton.textContent = "←";
      backButton.title = onlineText("backToLobby");
      backButton.setAttribute("aria-label", onlineText("backToLobby"));
    }
    if (title) title.textContent = onlineText("onlineTitle");
    if (lead) lead.textContent = onlineText("onlineLead");
    setCardText("onlineQuickCard", onlineText("quickCardTitle"), onlineText("quickCardSub"));
    setCardText("onlineCreateCard", onlineText("createCardTitle"), onlineText("createCardSub"));
    setCardText("onlineJoinCard", onlineText("joinCardTitle"), onlineText("joinCardSub"));
    setModeCardText("onlineSpeedModeButton", onlineText("speedModeTitle"), onlineText("speedModeSub"));
    setModeCardText("onlineItemModeButton", onlineText("itemModeTitle"), onlineText("itemModeSub"));
    setText("onlineCreateRoomButton", onlineText("createButton"));
    setText("onlineJoinRoomButton", onlineText("joinButton"));
    setText("onlineCopyRoomCodeButton", onlineText("copyButton"));
    setText("onlineLeaveRoomButton", onlineText("leaveButton"));
    setText("onlineCreatePanel", onlineText("createHint"), ".onlineEntryHint");
    setText("onlineJoinPanel", onlineText("joinHint"), ".onlineEntryHint");
    setText("onlineRoomLobby", onlineText("roomCodeLabel"), ".onlineRoomHeader span");
    const codeInput = $("onlineRoomCodeInput");
    if (codeInput) codeInput.placeholder = onlineText("roomCodePlaceholder");
    setButtonLabel("onlineSolidPrevButton", onlineText("previousSolid"));
    setButtonLabel("onlineSolidCurrentButton", onlineText("nextSolid"));
    setButtonLabel("onlineSolidNextButton", onlineText("nextSolid"));
    setButtonLabel("onlineSkinPrevButton", onlineText("previousSkin"));
    setButtonLabel("onlineSkinCurrentButton", onlineText("nextSkin"));
    setButtonLabel("onlineSkinNextButton", onlineText("nextSkin"));
    applyOnlineEntryMode();
    updateQuickMatchUI();
    if (onlineMode && !session && !quickMatching) setStatus(onlineText("onlineTitle"));
    if (!session) updateOpponentPanel(null);
    updateLocalProfileCard();
    applyOnlineRoomLayout();
  }

  function setText(id, text, selector = null) {
    const target = selector ? $(id)?.querySelector(selector) : $(id);
    if (target) target.textContent = text;
  }

  function setCardText(id, titleText, subText) {
    const card = $(id);
    if (!card) return;
    const title = card.querySelector(".onlineEntryCopy strong");
    const sub = card.querySelector(".onlineEntryCopy > span");
    if (title) title.textContent = titleText;
    if (sub) sub.textContent = subText;
  }

  function setModeCardText(id, titleText, subText) {
    const card = $(id);
    if (!card) return;
    const title = card.querySelector(".onlineModeCopy strong");
    const sub = card.querySelector(".onlineModeCopy span");
    if (title) title.textContent = titleText;
    if (sub) sub.textContent = subText;
  }

  function setButtonLabel(id, label) {
    const button = $(id);
    if (!button) return;
    button.title = label;
    button.setAttribute("aria-label", label);
  }

  function applyOnlineEntryMode() {
    const compact = $("onlineRoomCompact");
    if (compact) {
      compact.classList.toggle("online-entry-quick", onlineEntryMode === "quick");
      compact.classList.toggle("online-entry-create", onlineEntryMode === "create");
      compact.classList.toggle("online-entry-join", onlineEntryMode === "join");
    }
    document.querySelectorAll("[data-online-entry]").forEach((button) => {
      const selected = button.dataset.onlineEntry === onlineEntryMode;
      button.classList.toggle("selected", selected);
      button.setAttribute("aria-selected", selected ? "true" : "false");
    });
    document.querySelectorAll("[data-online-panel]").forEach((panel) => {
      const selected = panel.dataset.onlinePanel === onlineEntryMode;
      panel.hidden = !selected;
      panel.classList.toggle("active", selected);
    });
  }

  function updateOnlineGameModeUI() {
    document.querySelectorAll("[data-online-game-mode]").forEach((button) => {
      const selected = button.dataset.onlineGameMode === onlineGameMode;
      button.classList.toggle("selected", selected);
      button.setAttribute("aria-pressed", selected ? "true" : "false");
    });
  }

  function setOnlineGameMode(mode) {
    onlineGameMode = mode === "item" ? "item" : "speed";
    updateOnlineGameModeUI();
  }

  function setOnlineEntryMode(mode) {
    onlineEntryMode = ["quick", "create", "join"].includes(mode) ? mode : "quick";
    applyOnlineEntryMode();
    updateQuickMatchUI();
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
      if (quickText) quickText.textContent = isWaiting ? onlineText("quickCancel") : onlineText("quickStart");
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

    if (slotLabel) slotLabel.textContent = session ? onlineText("localOnlineSlot", localSlot) : "ONLINE";
    if (name) name.textContent = opponent ? opponent.nickname || `${opponentSlot}P` : onlineText("waitingOpponent");
    if (state) {
      if (!session) state.textContent = onlineText("opponentNone");
      else if (opponent) state.textContent = opponent.ready ? onlineText("opponentReady") : onlineText("opponentJoined");
      else state.textContent = onlineText("opponentWaiting");
    }
  }

  function setOnlineMode(enabled) {
    onlineMode = !!enabled;
    suppressPanelSync = false;
    if (onlineMode) prepareLocalLobbyForOnlineMode();
    applyOnlineRoomLayout();
    if (onlineMode) {
      if (session) refreshRoom();
      else {
        renderRoom(null);
        setStatus(onlineText("onlineTitle"));
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

  function prepareLocalLobbyForOnlineMode() {
    try {
      if (typeof setMatchMode === "function" && typeof matchMode !== "undefined" && matchMode === "ai") {
        setMatchMode("pvp");
      }
    } catch {}
    try {
      if (typeof clearLobbyReadyStartTimer === "function") clearLobbyReadyStartTimer();
    } catch {}
    try {
      if (typeof readyState !== "undefined") readyState = { 1: false, 2: false };
      if (typeof updateReadyUI === "function") updateReadyUI();
    } catch {}
  }

  function patchLocalReadyGuard() {
    try {
      if (typeof canAcceptLobbyReadyInput !== "function" || canAcceptLobbyReadyInput.__degulOnlineGuarded) return;
      const originalCanAcceptLobbyReadyInput = canAcceptLobbyReadyInput;
      const guarded = function (...args) {
        if (onlineMode) return false;
        return originalCanAcceptLobbyReadyInput.apply(this, args);
      };
      guarded.__degulOnlineGuarded = true;
      canAcceptLobbyReadyInput = guarded;
    } catch {}
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
    const colorTrack = $("onlineColorTrack");
    const specialTrack = $("onlineSpecialTrack");
    if (!colorTrack && !specialTrack) {
      updateLocalProfileCard();
      return;
    }
    syncOnlineSelectionDefaults();
    renderOnlineChoiceTrack(colorTrack, getSolidChoices());
    renderOnlineChoiceTrack(specialTrack, getSpecialSkinChoices());
    updateLocalProfileCard();
  }

  function renderOnlineChoiceTrack(track, choices) {
    if (!track) return;
    track.innerHTML = "";
    choices.forEach((choice) => {
      const skin = normalizeSkin(choice);
      const button = document.createElement("button");
      button.type = "button";
      button.className = "skinChoiceButton";
      button.dataset.skin = skin;
      button.style.setProperty("--chip-color", getSkinColor(skin, 1));
      const label = getChoiceDisplayName(choice) || skin;
      button.textContent = label;
      button.title = label;
      button.setAttribute("aria-label", label);
      button.classList.toggle("selected", selectedSkin === skin);
      button.setAttribute("aria-pressed", selectedSkin === skin ? "true" : "false");
      button.addEventListener("click", () => selectSkin(skin));
      track.appendChild(button);
    });
  }

  function updateLocalProfileCard() {
    syncOnlineSelectionDefaults();
    const nickname = $("onlineLocalNickname");
    const avatar = $("onlineLocalAvatar");
    const swatch = $("onlineSkinSwatch");
    const name = $("onlineSkinName");
    const colorTrack = $("onlineColorTrack");
    const specialTrack = $("onlineSpecialTrack");
    const solidChoices = getSolidChoices();
    const specialChoices = getSpecialSkinChoices();
    const solidChoice = getSelectedSolidChoice() || solidChoices[0] || getSkinChoices()[0];
    const selectedChoice = getChoiceByKey(selectedSkin) || solidChoice;
    const selectedKey = normalizeSkin(selectedChoice);
    const solidKey = normalizeSkin(solidChoice);
    const color = getSkinColor(selectedKey, 1);

    if (nickname) nickname.textContent = getNickname();
    if (avatar) {
      avatar.style.setProperty("--online-profile-color", "#7dc7ff");
      avatar.style.setProperty("--preview-color", "#7dc7ff");
      avatar.dataset.skin = "";
    }
    if (swatch) {
      swatch.style.setProperty("--online-profile-color", color);
      swatch.style.setProperty("--preview-color", color);
      swatch.style.setProperty("--chip-color", color);
      swatch.dataset.skin = selectedChoice?.skin || "";
      swatch.classList.add("selectedPreview");
      if (!swatch.querySelector("i")) swatch.innerHTML = "<i></i><i></i>";
    }
    if (name) name.textContent = getChoiceDisplayName(selectedChoice) || selectedKey;
    updateOnlineChoiceCarousel("onlineColor", colorTrack, solidChoices, selectedKey);
    updateOnlineChoiceCarousel("onlineSpecial", specialTrack, specialChoices, selectedKey);
  }

  function updateOnlineChoiceCarousel(prefix, track, choices, selectedKey) {
    const fallbackIndex = prefix === "onlineColor" ? choices.findIndex(choice => normalizeSkin(choice) === selectedSolidSkin) : 0;
    const selectedIndex = choices.findIndex(choice => normalizeSkin(choice) === selectedKey);
    const activeIndex = Math.max(0, selectedIndex >= 0 ? selectedIndex : fallbackIndex);
    const dots = $(`${prefix}Dots`);
    const prevButton = $(`${prefix}PrevButton`);
    const nextButton = $(`${prefix}NextButton`);
    if (track) track.style.transform = `translateX(${-100 * activeIndex}%)`;
    document.querySelectorAll(`#${prefix}Track .skinChoiceButton`).forEach((button) => {
      const active = button.dataset.skin === selectedKey;
      button.classList.toggle("selected", active);
      button.setAttribute("aria-pressed", active ? "true" : "false");
    });
    if (dots) {
      dots.innerHTML = choices.map((choice, index) => `<span class="skinDot${index === activeIndex ? " active" : ""}"></span>`).join("");
    }
    if (prevButton) prevButton.disabled = choices.length < 2;
    if (nextButton) nextButton.disabled = choices.length < 2;
  }

  function shiftOnlineSolidColor(direction) {
    const choices = getSolidChoices();
    if (!choices.length) return;
    const current = choices.findIndex(choice => normalizeSkin(choice) === selectedSolidSkin);
    const next = (Math.max(0, current) + direction + choices.length) % choices.length;
    selectSkin(normalizeSkin(choices[next]));
  }

  function shiftOnlineSkin(direction) {
    shiftOnlineChoice(getSelectableSkinChoices(), direction);
  }

  function shiftOnlineSpecialSkin(direction) {
    shiftOnlineChoice(getSpecialSkinChoices(), direction);
  }

  function shiftOnlineChoice(choices, direction) {
    if (!choices.length) return;
    const current = choices.findIndex(choice => normalizeSkin(choice) === selectedSkin);
    const next = (Math.max(0, current) + direction + choices.length) % choices.length;
    selectSkin(normalizeSkin(choices[next]));
  }

  function renderRoom(room) {
    currentRoom = room || null;
    const inRoom = !!session && !!room;
    const sessionEntryMode = session?.entryMode || onlineEntryMode || "quick";
    const entry = $("onlineRoomEntry");
    const lobby = $("onlineRoomLobby");
    const compact = $("onlineRoomCompact");
    applyOnlineRoomLayout();
    if (compact) {
      compact.classList.toggle("online-session-quick", inRoom && sessionEntryMode === "quick");
      compact.classList.toggle("online-session-room", inRoom && sessionEntryMode !== "quick");
    }
    if (entry) entry.hidden = inRoom;
    if (lobby) lobby.hidden = !inRoom || sessionEntryMode === "quick";
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
      if (name) name.textContent = player ? player.nickname || `${slot}P` : (slot === 1 ? onlineText("waitingP1") : onlineText("waitingOpponent"));
      if (ready) ready.textContent = player ? (player.ready ? onlineText("readyDone") : onlineText("readyBefore")) : onlineText("seatEmpty");
    });

    const me = room.players?.[String(localSlot)] || room.players?.[localSlot] || null;
    if (me?.skin) {
      selectedSkin = me.skin;
      const meChoice = getChoiceByKey(me.skin);
      if (meChoice && !meChoice.skin) selectedSolidSkin = me.skin;
    }
    const readyButton = $("onlineReadyButton");
    if (readyButton) readyButton.textContent = me?.ready ? onlineText("unreadyButton") : onlineText("readyButton");
    renderSkins();

    const opponentSlot = localSlot === 1 ? 2 : 1;
    const opponent = room.players?.[String(opponentSlot)] || room.players?.[opponentSlot] || null;
    if (opponent) {
      setStatus(opponent.ready ? onlineText("opponentReadyStatus") : onlineText("opponentJoinedStatus"));
    } else {
      setStatus(onlineText("waitingOpponentStatus"));
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
      setStatus(error.code === "room_not_found" ? onlineText("roomMissing") : error.message, true);
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

  function clearOnlineCountdownUi() {
    const countdown = $("countdownOverlay");
    if (countdown) countdown.classList.remove("online-countdown");
    const players = $("onlineCountdownPlayers");
    if (players) players.remove();
  }

  function getOnlineCountdownPlayer(slot) {
    const player = currentRoom?.players?.[String(slot)] || currentRoom?.players?.[slot] || null;
    return {
      slot,
      nickname: player?.nickname || `${slot}P`,
      skin: player?.skin || (slot === Number(session?.slot) ? selectedSkin : DEFAULT_SKIN)
    };
  }

  function renderOnlineCountdownPlayers() {
    const countdown = $("countdownOverlay");
    if (!countdown) return;
    let wrap = $("onlineCountdownPlayers");
    if (!wrap) {
      wrap = document.createElement("div");
      wrap.id = "onlineCountdownPlayers";
      wrap.className = "onlineCountdownPlayers";
      countdown.appendChild(wrap);
    }
    wrap.innerHTML = [1, 2].map(slot => {
      const player = getOnlineCountdownPlayer(slot);
      const color = getSkinColor(player.skin, slot);
      return `
        <div class="onlineCountdownProfile p${slot}" style="--online-player-color:${color}">
          <div class="onlineCountdownSlot">${slot}P</div>
          <div class="onlineCountdownAvatar" aria-hidden="true"><i></i><i></i></div>
          <strong>${escapeHtml(player.nickname)}</strong>
        </div>
      `;
    }).join("");
  }

  function hasActiveOnlineMatchState() {
    return !!(onlineMode && (session || realtimeStarted || realtimeResultKey || quickMatching || quickTicket));
  }

  function resetOnlineLobbyState(message = onlineText("onlineTitle")) {
    stopPolling();
    stopQuickPolling();
    stopRealtimePing();
    if (realtimeSocket) {
      try {
        realtimeSocket.close(1000, "reset");
      } catch {}
    }
    realtimeSocket = null;
    realtimeInputSeq = 0;
    realtimeRttMs = 0;
    realtimeSnapshotTick = -1;
    pendingRealtimeSnapshotPacket = null;
    if (realtimeSnapshotFrame) window.cancelAnimationFrame(realtimeSnapshotFrame);
    realtimeSnapshotFrame = 0;
    realtimeStarted = false;
    realtimeResultKey = "";
    currentRoom = null;
    quickMatching = false;
    quickMatchState = "idle";
    saveQuickTicket("");
    saveSession(null);
    onlineMode = true;
    onlineEntryMode = "quick";
    renderRoom(null);
    applyOnlineRoomText();
    setStatus(message);
    clearOnlineCountdownUi();
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
      realtimeLastSentDirection = "";
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
      queueServerSnapshot(message);
    }
  }

  function queueServerSnapshot(packet) {
    const snapshot = packet?.state;
    if (!snapshot || snapshot.tick < realtimeSnapshotTick) return;
    const pendingTick = pendingRealtimeSnapshotPacket?.state?.tick ?? -1;
    if (snapshot.tick < pendingTick) return;
    pendingRealtimeSnapshotPacket = packet;
    if (realtimeSnapshotFrame) return;
    realtimeSnapshotFrame = window.requestAnimationFrame(() => {
      realtimeSnapshotFrame = 0;
      const nextPacket = pendingRealtimeSnapshotPacket;
      pendingRealtimeSnapshotPacket = null;
      if (nextPacket) applyServerSnapshot(nextPacket);
    });
  }

  function sendDirection(direction) {
    if (!realtimeSocket || realtimeSocket.readyState !== WebSocket.OPEN) return;
    if (direction === realtimeLastSentDirection) return;
    realtimeLastSentDirection = direction;
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
      countdown.classList.add("online-countdown");
      countdown.classList.toggle("classic-mode", true);
      countdown.classList.toggle("item-mode", false);
      countdown.classList.toggle("ghost-mode", false);
      renderOnlineCountdownPlayers();
    }
    const left = Number(packet.countdownRemainingMs || 0);
    const value = left > 1000 ? Math.ceil(left / 1000) : (left > 0 ? (typeof tr === "function" ? tr("start") : "START") : "");
    if (countNumber) countNumber.textContent = value;
    try { setGamePhase(GAME_PHASE.COUNTDOWN); } catch {}
  }

  function showServerPlaying(snapshot) {
    const countdown = $("countdownOverlay");
    if (countdown) {
      countdown.style.display = "none";
      countdown.classList.remove("online-countdown");
    }
    try { setGamePhase(GAME_PHASE.PLAYING); } catch {}
    try {
      if (!matchStartedAt) matchStartedAt = performance.now() - Math.max(0, Date.now() - Number(snapshot.startAt || Date.now()));
      playIngameBgm();
    } catch {}
  }

  function applyAuthoritativeState(snapshot) {
    try {
      const changedCells = [];
      if (Array.isArray(snapshot.land) && Array.isArray(land)) {
        for (let z = 0; z < snapshot.land.length; z++) {
          const snapshotRow = snapshot.land[z];
          if (!Array.isArray(snapshotRow)) continue;
          if (!Array.isArray(land[z])) land[z] = [];
          for (let x = 0; x < snapshotRow.length; x++) {
            const nextOwner = snapshotRow[x];
            if (land[z][x] === nextOwner) continue;
            land[z][x] = nextOwner;
            changedCells.push({ x, z });
          }
        }
      }
      if (Array.isArray(snapshot.landDelta) && Array.isArray(land)) {
        for (const cell of snapshot.landDelta) {
          const x = Number(cell.x);
          const z = Number(cell.z);
          const owner = Number(cell.owner);
          if (!Number.isInteger(x) || !Number.isInteger(z) || !Number.isFinite(owner)) continue;
          if (!Array.isArray(land[z])) land[z] = [];
          if (land[z][x] === owner) continue;
          land[z][x] = owner;
          changedCells.push({ x, z });
        }
      }
      if (changedCells.length) {
        if (typeof refreshBoardCells === "function") refreshBoardCells(changedCells);
        else refreshBoardColors();
      }
      syncActorFromSnapshot(p1, snapshot.players?.[1] || snapshot.players?.["1"]);
      syncActorFromSnapshot(p2, snapshot.players?.[2] || snapshot.players?.["2"]);
      updateScoreUIThrottled(false);
    } catch (error) {
      console.warn("Failed to apply online snapshot", error);
    }
  }

  function getTrailSignature(points) {
    if (!Array.isArray(points) || !points.length) return "";
    return `${points.length}:${points[0].x},${points[0].z}:${points[points.length - 1].x},${points[points.length - 1].z}`;
  }

  function syncActorFromSnapshot(actor, data) {
    if (!actor || !data) return;
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
    const nextTrailKey = getTrailSignature(data.trail);
    if (actor.onlineTrailKey !== nextTrailKey) {
      actor.onlineTrailKey = nextTrailKey;
      if (typeof clearTrail === "function") clearTrail(actor);
      if (Array.isArray(data.trail)) {
        for (const point of data.trail) addTrail(actor, point.x, point.z);
      }
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
        skin: selectedSkin,
        entryMode: "create"
      });
      onlineMode = true;
      renderRoom(data.room);
      startPolling();
      setStatus(onlineText("roomCreated"));
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
      setStatus(onlineText("enterRoomCode"), true);
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
        skin: selectedSkin,
        entryMode: "join"
      });
      onlineMode = true;
      renderRoom(data.room);
      startPolling();
      setStatus(onlineText("roomJoined", data.slot));
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
          mode: onlineGameMode,
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
            skin: selectedSkin,
            entryMode: "quick"
          });
          onlineMode = true;
          renderRoom(data.room);
          updateQuickMatchUI("idle");
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
    const nextSkin = skin || DEFAULT_SKIN;
    const choice = getChoiceByKey(nextSkin);
    if (choice && !choice.skin) selectedSolidSkin = nextSkin;
    selectedSkin = nextSkin;
    if (session) session.skin = selectedSkin;
    saveSession(session);
    renderSkins();
    updateLocalProfileCard();
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
    setStatus(onlineText("roomLeft"));
    setBusy(false);
  }

  function patchResultLobbyReset() {
    const originalCloseResultToLobby = window.closeResultToLobby;
    if (typeof originalCloseResultToLobby === "function" && !originalCloseResultToLobby.__degulOnlineRoomWrapped) {
      const wrapped = function (...args) {
        const shouldResetOnline = hasActiveOnlineMatchState();
        const result = originalCloseResultToLobby.apply(this, args);
        if (shouldResetOnline) {
          window.setTimeout(() => resetOnlineLobbyState(), 240);
        }
        return result;
      };
      wrapped.__degulOnlineRoomWrapped = true;
      window.closeResultToLobby = wrapped;
    }
  }

  function bind() {
    patchLocalReadyGuard();
    patchResultLobbyReset();
    applyOnlineRoomText();
    document.querySelectorAll("[data-online-entry]").forEach((button) => {
      button.addEventListener("click", () => setOnlineEntryMode(button.dataset.onlineEntry));
    });
    document.querySelectorAll("[data-online-game-mode]").forEach((button) => {
      button.addEventListener("click", () => setOnlineGameMode(button.dataset.onlineGameMode));
    });
    $("onlineCreateRoomButton")?.addEventListener("click", createRoom);
    $("onlineQuickMatchButton")?.addEventListener("click", () => requestQuickMatch(false));
    $("onlineJoinRoomButton")?.addEventListener("click", joinRoom);
    $("onlineReadyButton")?.addEventListener("click", toggleReady);
    $("onlineLeaveRoomButton")?.addEventListener("click", leaveRoom);
    $("onlineSolidPrevButton")?.addEventListener("click", () => shiftOnlineSolidColor(-1));
    $("onlineSolidNextButton")?.addEventListener("click", () => shiftOnlineSolidColor(1));
    $("onlineSolidCurrentButton")?.addEventListener("click", () => shiftOnlineSolidColor(1));
    $("onlineSkinPrevButton")?.addEventListener("click", () => shiftOnlineSkin(-1));
    $("onlineSkinNextButton")?.addEventListener("click", () => shiftOnlineSkin(1));
    $("onlineSkinCurrentButton")?.addEventListener("click", () => shiftOnlineSkin(1));
    $("onlineColorPrevButton")?.addEventListener("click", () => shiftOnlineSolidColor(-1));
    $("onlineColorNextButton")?.addEventListener("click", () => shiftOnlineSolidColor(1));
    $("onlineSpecialPrevButton")?.addEventListener("click", () => shiftOnlineSpecialSkin(-1));
    $("onlineSpecialNextButton")?.addEventListener("click", () => shiftOnlineSpecialSkin(1));
    $("onlineCopyRoomCodeButton")?.addEventListener("click", async () => {
      const code = session?.roomCode || $("onlineRoomCode")?.textContent || "";
      try {
        await navigator.clipboard.writeText(code);
        setStatus(onlineText("roomCodeCopied"));
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
    updateLocalProfileCard();
    updateOnlineGameModeUI();
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
    resetLobbyState: resetOnlineLobbyState,
    setOnlineGameMode,
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
