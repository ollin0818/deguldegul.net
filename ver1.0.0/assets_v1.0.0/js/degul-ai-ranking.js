(function () {
  let activeMatch = null;
  let matchGeneration = 0;
  let rankingMode = "speed";
  let refreshGeneration = 0;

  const texts = {
    ko: {
      title: "AI 랭킹",
      tab: "AI 랭킹",
      description: "난이도와 모드별 전 세계 TOP 100",
      loading: "불러오는 중",
      ready: "TOP 100",
      unavailable: "랭킹을 불러오지 못했습니다.",
      empty: "아직 등록된 승리 기록이 없습니다.",
      speed: "스피드 모드",
      item: "아이템 모드",
      rank: "순위",
      player: "닉네임",
      time: "클리어 시간",
      territory: "점령률",
      myRank: "내 순위",
      myBest: "내 기록",
      unranked: "미등록",
      ghost: "고스트 모드 적용 기록"
    },
    en: {
      title: "AI Ranking",
      tab: "AI Ranking",
      description: "Global TOP 100 by difficulty and mode",
      loading: "Loading",
      ready: "TOP 100",
      unavailable: "Could not load the ranking.",
      empty: "No winning records have been submitted yet.",
      speed: "Speed Mode",
      item: "Item Mode",
      rank: "Rank",
      player: "Nickname",
      time: "Clear Time",
      territory: "Territory",
      myRank: "My Rank",
      myBest: "My Record",
      unranked: "Unranked",
      ghost: "Ghost mode record"
    },
    ja: {
      title: "AIランキング",
      tab: "AIランキング",
      description: "難易度・モード別 世界TOP 100",
      loading: "読み込み中",
      ready: "TOP 100",
      unavailable: "ランキングを読み込めませんでした。",
      empty: "登録された勝利記録はまだありません。",
      speed: "スピードモード",
      item: "アイテムモード",
      rank: "順位",
      player: "ニックネーム",
      time: "クリアタイム",
      territory: "占領率",
      myRank: "自分の順位",
      myBest: "自分の記録",
      unranked: "未登録",
      ghost: "ゴーストモード記録"
    },
    zh: {
      title: "AI排行榜",
      tab: "AI排行榜",
      description: "按难度和模式划分的全球TOP 100",
      loading: "加载中",
      ready: "TOP 100",
      unavailable: "无法加载排行榜。",
      empty: "暂无已提交的胜利记录。",
      speed: "速度模式",
      item: "道具模式",
      rank: "排名",
      player: "昵称",
      time: "通关时间",
      territory: "占领率",
      myRank: "我的排名",
      myBest: "我的记录",
      unranked: "未上榜",
      ghost: "幽灵模式记录"
    }
  };

  function copy() {
    return texts[document.documentElement.lang] || texts.ko;
  }

  function auth() {
    return window.DegulAuth;
  }

  function isLocalTestMode() {
    try {
      return window.DegulTestGuard?.isTestMode?.() === true;
    } catch {}
    const { protocol, hostname } = window.location;
    return protocol === "file:" || /^(localhost|127\.0\.0\.1|\[::1\])$/i.test(hostname || "");
  }

  function isOperatorUser(user = auth()?.getUser?.()) {
    return user?.role === "operator" || user?.id === "local-operator";
  }

  function formatTime(ms) {
    if (!Number.isFinite(ms) || ms < 0) return "--:--.-";
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    const tenths = Math.floor((ms % 1000) / 100);
    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${tenths}`;
  }

  function formatTerritory(basisPoints) {
    const value = Math.max(0, Math.min(10000, Number(basisPoints) || 0)) / 100;
    return `${value.toFixed(value % 1 ? 2 : 0)}%`;
  }

  function getDifficulty() {
    if (typeof window.getAiRecordDifficultyForView === "function") {
      return window.getAiRecordDifficultyForView();
    }
    return "easy";
  }

  function beginMatch(config) {
    if (isLocalTestMode()) {
      activeMatch = null;
      return;
    }
    matchGeneration += 1;
    const generation = matchGeneration;
    const normalized = {
      difficulty: String(config?.difficulty || ""),
      mode: config?.mode === "item" ? "item" : "speed",
      ghostMode: config?.ghostMode === true
    };

    activeMatch = {
      generation,
      config: normalized,
      promise: (async () => {
        const api = auth();
        if (!api?.request) return null;
        const user = await api.refresh();
        if (!user?.nickname || generation !== matchGeneration) return null;
        return api.request("/api/ai/sessions", {
          method: "POST",
          body: JSON.stringify(normalized)
        });
      })().catch(error => {
        console.warn("[DegulAiRanking] game session unavailable", error);
        return null;
      })
    };
  }

  async function finishMatch(result) {
    if (isLocalTestMode()) {
      activeMatch = null;
      return;
    }
    const match = activeMatch;
    activeMatch = null;
    if (!match || match.generation !== matchGeneration || result?.won !== true) return;

    const session = await match.promise;
    if (!session || match.generation !== matchGeneration) return;

    try {
      await auth().request("/api/ai/results", {
        method: "POST",
        body: JSON.stringify({
          sessionId: session.sessionId,
          submissionToken: session.submissionToken,
          clearTimeMs: Math.round(Number(result.clearTimeMs) || 0),
          territoryBasisPoints: Math.round(Number(result.territoryBasisPoints) || 0)
        })
      });
      window.dispatchEvent(new CustomEvent("degul:ai-ranking-updated", {
        detail: {
          difficulty: match.config.difficulty,
          mode: match.config.mode
        }
      }));
    } catch (error) {
      if (error?.code !== "duplicate_submission") {
        console.warn("[DegulAiRanking] result submission failed", error);
      }
    }
  }

  function cancelMatch() {
    matchGeneration += 1;
    activeMatch = null;
  }

  function appendPlayerCell(rowElement, row, text) {
    const player = document.createElement("span");
    player.className = "aiRankingPlayer";

    const avatar = document.createElement("i");
    avatar.className = "aiRankingAvatar";
    avatar.style.setProperty("--ranking-profile-color", row.profileColor || "#64beff");
    avatar.setAttribute("aria-hidden", "true");
    player.appendChild(avatar);

    const nickname = document.createElement("b");
    nickname.textContent = row.nickname || "-";
    player.appendChild(nickname);

    if (row.ghostMode) {
      const ghost = document.createElement("em");
      ghost.className = "aiRankingGhost";
      ghost.textContent = "👻";
      ghost.title = text.ghost;
      ghost.setAttribute("aria-label", text.ghost);
      player.appendChild(ghost);
    }

    rowElement.appendChild(player);
  }

  function renderRanking(data) {
    const text = copy();
    const list = document.getElementById("aiRankingList");
    const status = document.getElementById("aiRankingStatus");
    const myRank = document.getElementById("aiRankingMyRank");
    const myBest = document.getElementById("aiRankingMyBest");
    if (!list) return;

    if (status) status.textContent = text.ready;
    if (myRank) myRank.textContent = data.me ? `#${data.me.rank}` : text.unranked;
    if (myBest) {
      myBest.textContent = data.me
        ? `${formatTime(data.me.clearTimeMs)} · ${formatTerritory(data.me.territoryBasisPoints)}`
        : text.unranked;
    }

    list.replaceChildren();
    if (!data.top?.length) {
      const empty = document.createElement("div");
      empty.className = "aiRankingEmpty";
      empty.textContent = text.empty;
      list.appendChild(empty);
      return;
    }

    data.top.slice(0, 100).forEach(row => {
      const item = document.createElement("div");
      item.className = "aiRankingRow";
      if (row.rank <= 3) item.classList.add(`rank-${row.rank}`);
      if (data.me && row.rank === data.me.rank && row.nickname === data.me.nickname) {
        item.classList.add("mine");
      }

      const rank = document.createElement("strong");
      rank.className = "aiRankingRank";
      rank.textContent = `#${row.rank}`;
      item.appendChild(rank);
      appendPlayerCell(item, row, text);

      const time = document.createElement("span");
      time.className = "aiRankingTime";
      time.textContent = formatTime(row.clearTimeMs);
      item.appendChild(time);

      const territory = document.createElement("span");
      territory.className = "aiRankingTerritory";
      territory.textContent = formatTerritory(row.territoryBasisPoints);
      item.appendChild(territory);
      list.appendChild(item);
    });
  }

  function renderLoading() {
    const text = copy();
    const status = document.getElementById("aiRankingStatus");
    const list = document.getElementById("aiRankingList");
    if (status) status.textContent = text.loading;
    if (list) {
      const loading = document.createElement("div");
      loading.className = "aiRankingEmpty";
      loading.textContent = text.loading;
      list.replaceChildren(loading);
    }
  }

  function renderError() {
    const text = copy();
    const status = document.getElementById("aiRankingStatus");
    const list = document.getElementById("aiRankingList");
    if (status) status.textContent = text.unavailable;
    if (list) {
      const error = document.createElement("div");
      error.className = "aiRankingEmpty error";
      error.textContent = text.unavailable;
      list.replaceChildren(error);
    }
  }

  async function refresh() {
    const panel = document.getElementById("aiRankingPanel");
    if (!panel || panel.hidden) return;

    const generation = ++refreshGeneration;
    renderLoading();
    updateLabels();

    try {
      const api = auth();
      const user = await api?.refresh?.();
      if (!api?.request || !user?.nickname) throw new Error("nickname_required");
      if (isLocalTestMode() && !isOperatorUser(user)) {
        if (generation !== refreshGeneration) return;
        renderRanking({ top: [], me: null });
        return;
      }
      const difficulty = getDifficulty();
      const data = await api.request(
        `/api/ai/rankings?difficulty=${encodeURIComponent(difficulty)}&mode=${encodeURIComponent(rankingMode)}`,
        { method: "GET", remoteInTest: isOperatorUser(user) }
      );
      if (generation !== refreshGeneration) return;
      renderRanking(data);
    } catch (error) {
      if (generation !== refreshGeneration) return;
      console.warn("[DegulAiRanking] ranking load failed", error);
      renderError();
    }
  }

  function setMode(mode) {
    rankingMode = mode === "item" ? "item" : "speed";
    document.getElementById("aiRankingSpeedMode")?.classList.toggle("active", rankingMode === "speed");
    document.getElementById("aiRankingItemMode")?.classList.toggle("active", rankingMode === "item");
    refresh();
  }

  function updateLabels() {
    const text = copy();
    const labels = {
      aiRankingTitle: text.title,
      aiRecordRankingTab: text.tab,
      aiRankingDescription: text.description,
      aiRankingSpeedMode: text.speed,
      aiRankingItemMode: text.item,
      aiRankingMyRankLabel: text.myRank,
      aiRankingMyBestLabel: text.myBest,
      aiRankingHeadRank: text.rank,
      aiRankingHeadPlayer: text.player,
      aiRankingHeadTime: text.time,
      aiRankingHeadTerritory: text.territory
    };
    Object.entries(labels).forEach(([id, value]) => {
      const element = document.getElementById(id);
      if (element) element.textContent = value;
    });
  }

  function init() {
    updateLabels();
    new MutationObserver(() => {
      updateLabels();
      refresh();
    }).observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["lang"]
    });
    window.addEventListener("degul:auth-ready", refresh);
    window.addEventListener("degul:ai-ranking-updated", refresh);
  }

  window.setAiRankingMode = setMode;
  window.DegulAiRanking = {
    beginMatch,
    finishMatch,
    cancelMatch,
    refresh,
    setMode
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
