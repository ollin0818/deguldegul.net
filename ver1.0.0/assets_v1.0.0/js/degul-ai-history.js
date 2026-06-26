(function () {
  "use strict";

  const HISTORY_KEY = "degulDegulAiMatchHistoryV1";
  const USED_SESSIONS_KEY = "degulDegulAiUsedSessionsV1";
  const MAX_MATCHES = 300;
  const MAX_USED_SESSIONS = 600;
  const MIN_PLAY_MS = 3000;
  const VALID_RESULTS = new Set(["win", "loss", "draw"]);
  let activeSession = null;

  function isTestMode() {
    try {
      return window.DegulTestGuard?.isTestMode?.() === true;
    } catch {
      return false;
    }
  }

  function readGlobal(getter, fallback) {
    try {
      const value = getter();
      return value === undefined ? fallback : value;
    } catch {
      return fallback;
    }
  }

  function getAllowedDifficulties() {
    const order = readGlobal(() => AI_DIFFICULTY_ORDER, null);
    return Array.isArray(order) ? order.slice() : ["easy", "normal", "hard", "superhard", "extreme", "hell", "chaos"];
  }

  function isAllowedDifficulty(level) {
    return getAllowedDifficulties().includes(level);
  }

  function safeGet(key, fallback = null) {
    try {
      if (typeof safeLocalStorageGet === "function") return safeLocalStorageGet(key, fallback);
    } catch {}
    try {
      const value = localStorage.getItem(key);
      return value === null ? fallback : value;
    } catch {
      return fallback;
    }
  }

  function safeSet(key, value) {
    try {
      if (typeof safeLocalStorageSet === "function") return safeLocalStorageSet(key, value);
    } catch {}
    try {
      localStorage.setItem(key, value);
      return true;
    } catch {
      return false;
    }
  }

  function loadHistory() {
    try {
      const raw = safeGet(HISTORY_KEY, "");
      const parsed = raw ? JSON.parse(raw) : null;
      const matches = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.matches) ? parsed.matches : [];
      return {
        version: 1,
        matches: matches.filter(isValidStoredMatch).slice(0, MAX_MATCHES)
      };
    } catch {
      return { version: 1, matches: [] };
    }
  }

  function saveHistory(history) {
    const matches = Array.isArray(history?.matches) ? history.matches.slice(0, MAX_MATCHES) : [];
    safeSet(HISTORY_KEY, JSON.stringify({ version: 1, matches }));
  }

  function loadUsedSessions() {
    try {
      const raw = safeGet(USED_SESSIONS_KEY, "[]");
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed.filter((id) => typeof id === "string" && id.length > 0) : [];
    } catch {
      return [];
    }
  }

  function saveUsedSessions(ids) {
    safeSet(USED_SESSIONS_KEY, JSON.stringify(ids.slice(0, MAX_USED_SESSIONS)));
  }

  function markSessionUsed(sessionId) {
    if (!sessionId) return;
    const ids = loadUsedSessions().filter((id) => id !== sessionId);
    ids.unshift(sessionId);
    saveUsedSessions(ids);
  }

  function isSessionUsed(sessionId) {
    return !!sessionId && loadUsedSessions().includes(sessionId);
  }

  function isValidStoredMatch(match) {
    if (!match || typeof match !== "object") return false;
    if (typeof match.game_session_id !== "string" || !match.game_session_id) return false;
    if (!VALID_RESULTS.has(match.result)) return false;
    if (!isAllowedDifficulty(match.difficulty)) return false;
    if (!Number.isFinite(match.playTimeMs) || match.playTimeMs < MIN_PLAY_MS) return false;
    const player = Number(match.territory?.playerPercent);
    const ai = Number(match.territory?.aiPercent);
    return Number.isFinite(player) && Number.isFinite(ai) && player >= 0 && player <= 100 && ai >= 0 && ai <= 100;
  }

  function makeSessionId() {
    try {
      if (crypto?.randomUUID) return crypto.randomUUID();
    } catch {}
    return `ai-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }

  function beginAiHistorySession() {
    if (isTestMode()) {
      activeSession = null;
      return null;
    }
    const mode = readGlobal(() => matchMode, "");
    const difficulty = readGlobal(() => aiDifficulty, "");
    if (mode !== "ai" || !isAllowedDifficulty(difficulty)) {
      activeSession = null;
      return null;
    }
    activeSession = {
      id: makeSessionId(),
      difficulty,
      mode: readGlobal(() => gameMode, "") === "item" ? "item" : "speed",
      ghostMode: !!readGlobal(() => ghostModeEnabled, false),
      createdAtMs: readGlobal(() => performance.now(), Date.now()),
      createdAt: new Date().toISOString()
    };
    return activeSession;
  }

  function clearAiHistorySession() {
    activeSession = null;
  }

  function round1(value) {
    return Math.round(value * 10) / 10;
  }

  function getTerritorySnapshot() {
    const total = Math.max(1, Number(readGlobal(() => GRID_SIZE, 31)) ** 2);
    const p1Land = readGlobal(() => P1_LAND, 1);
    const p2Land = readGlobal(() => P2_LAND, 2);
    const count = typeof readGlobal(() => countLand, null) === "function" ? readGlobal(() => countLand, null) : null;
    const playerCount = count ? Number(count(p1Land)) : 0;
    const aiCount = count ? Number(count(p2Land)) : 0;
    const playerPercent = (playerCount / total) * 100;
    const aiPercent = (aiCount / total) * 100;
    return {
      playerCount,
      aiCount,
      playerPercent,
      aiPercent,
      total
    };
  }

  function isValidTerritory(snapshot) {
    if (!snapshot) return false;
    const { playerPercent, aiPercent } = snapshot;
    if (!Number.isFinite(playerPercent) || !Number.isFinite(aiPercent)) return false;
    if (playerPercent < 0 || playerPercent > 100 || aiPercent < 0 || aiPercent > 100) return false;
    return playerPercent + aiPercent <= 100.5;
  }

  function getOutcome(winner) {
    if (!winner) return "draw";
    const p1Land = readGlobal(() => P1_LAND, 1);
    const p2Land = readGlobal(() => P2_LAND, 2);
    if (winner.landId === p1Land) return "win";
    if (winner.landId === p2Land) return "loss";
    return "draw";
  }

  function getReasonType(reasonText) {
    const classifier = readGlobal(() => classifyAiWinType, null);
    if (typeof classifier === "function") return classifier(reasonText);
    const text = String(reasonText || "").toLowerCase();
    if (text.includes("60") || text.includes("영역") || text.includes("territory")) return "land";
    if (text.includes("line") || text.includes("라인")) return "lineCut";
    if (text.includes("out") || text.includes("벽")) return "wall";
    return "survival";
  }

  function getPlayTimeMs() {
    const ended = Number(readGlobal(() => matchEndedAt, 0));
    const started = Number(readGlobal(() => matchStartedAt, 0));
    if (Number.isFinite(ended) && Number.isFinite(started) && ended > started) return ended - started;
    if (Number.isFinite(started) && started > 0) return readGlobal(() => performance.now(), Date.now()) - started;
    return 0;
  }

  function buildMatchRecord(winner, reasonText) {
    if (readGlobal(() => matchMode, "") !== "ai") return { ok: false, reason: "not-ai" };
    if (!activeSession?.id) return { ok: false, reason: "missing-session" };
    if (isSessionUsed(activeSession.id)) return { ok: false, reason: "session-reused", consume: false };

    const currentDifficulty = readGlobal(() => aiDifficulty, "");
    if (!isAllowedDifficulty(currentDifficulty) || !isAllowedDifficulty(activeSession.difficulty)) {
      return { ok: false, reason: "invalid-difficulty", consume: true };
    }
    if (currentDifficulty !== activeSession.difficulty) {
      return { ok: false, reason: "difficulty-mismatch", consume: true };
    }

    const playTimeMs = getPlayTimeMs();
    if (!Number.isFinite(playTimeMs) || playTimeMs < MIN_PLAY_MS) {
      return { ok: false, reason: "too-short", consume: true };
    }

    const territory = getTerritorySnapshot();
    if (!isValidTerritory(territory)) {
      return { ok: false, reason: "invalid-territory", consume: true };
    }

    return {
      ok: true,
      record: {
        game_session_id: activeSession.id,
        result: getOutcome(winner),
        difficulty: activeSession.difficulty,
        mode: activeSession.mode,
        ghostMode: activeSession.ghostMode,
        playTimeMs: Math.round(playTimeMs),
        territory: {
          playerPercent: round1(territory.playerPercent),
          aiPercent: round1(territory.aiPercent),
          playerBasisPoints: Math.round(territory.playerPercent * 100),
          aiBasisPoints: Math.round(territory.aiPercent * 100)
        },
        reasonType: getReasonType(reasonText),
        reason: String(reasonText || "").slice(0, 160),
        playedAt: new Date().toISOString()
      }
    };
  }

  function recordAiMatchHistory(winner, reasonText) {
    if (isTestMode()) {
      activeSession = null;
      return false;
    }
    const result = buildMatchRecord(winner, reasonText);
    const sessionId = activeSession?.id || "";
    activeSession = null;

    if (!result.ok) {
      if (result.consume && sessionId) markSessionUsed(sessionId);
      return false;
    }

    const history = loadHistory();
    if (history.matches.some((match) => match.game_session_id === result.record.game_session_id)) {
      markSessionUsed(result.record.game_session_id);
      return false;
    }

    history.matches.unshift(result.record);
    history.matches = history.matches.slice(0, MAX_MATCHES);
    saveHistory(history);
    markSessionUsed(result.record.game_session_id);
    updateAiMatchHistoryPanel();
    return true;
  }

  function getLang() {
    return readGlobal(() => currentLang, "ko") || "ko";
  }

  function text(key) {
    const packs = {
      ko: {
        title: "전체 AI 전적",
        recent: "최근 20경기",
        total: "총 전적",
        winRate: "승률",
        totalValue: (s) => `${s.total}전 ${s.win}승 ${s.loss}패 ${s.draw}무`,
        empty: "최근 AI 전적이 없습니다.",
        noDifficulty: "난이도별 기록 없음",
        win: "승",
        loss: "패",
        draw: "무",
        speed: "스피드",
        item: "아이템",
        ghost: "고스트",
        reasons: { land: "점령", lineCut: "라인", wall: "충돌", survival: "생존" }
      },
      en: {
        title: "All AI Matches",
        recent: "Last 20",
        total: "Total",
        winRate: "Win Rate",
        totalValue: (s) => `${s.total}G ${s.win}W ${s.loss}L ${s.draw}D`,
        empty: "No recent AI matches.",
        noDifficulty: "No difficulty records",
        win: "Win",
        loss: "Loss",
        draw: "Draw",
        speed: "Speed",
        item: "Item",
        ghost: "Ghost",
        reasons: { land: "Territory", lineCut: "Line", wall: "Crash", survival: "Survival" }
      },
      ja: {
        title: "AI総合戦績",
        recent: "直近20戦",
        total: "総戦績",
        winRate: "勝率",
        totalValue: (s) => `${s.total}戦 ${s.win}勝 ${s.loss}敗 ${s.draw}分`,
        empty: "最近のAI戦績がありません。",
        noDifficulty: "難易度別記録なし",
        win: "勝",
        loss: "敗",
        draw: "分",
        speed: "スピード",
        item: "アイテム",
        ghost: "ゴースト",
        reasons: { land: "占領", lineCut: "ライン", wall: "衝突", survival: "生存" }
      },
      zh: {
        title: "AI总战绩",
        recent: "最近20场",
        total: "总战绩",
        winRate: "胜率",
        totalValue: (s) => `${s.total}场 ${s.win}胜 ${s.loss}负 ${s.draw}平`,
        empty: "暂无最近AI战绩。",
        noDifficulty: "暂无难度记录",
        win: "胜",
        loss: "负",
        draw: "平",
        speed: "速度",
        item: "道具",
        ghost: "幽灵",
        reasons: { land: "占领", lineCut: "路线", wall: "碰撞", survival: "生存" }
      }
    };
    return (packs[getLang()] || packs.ko)[key];
  }

  function formatPercent(value) {
    if (!Number.isFinite(value)) return "0%";
    const rounded = Math.round(value * 10) / 10;
    return `${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1)}%`;
  }

  function formatTime(ms) {
    const formatter = readGlobal(() => formatResultTime, null);
    if (typeof formatter === "function") return formatter(ms);
    const seconds = Math.max(0, Math.floor(ms / 1000));
    const min = Math.floor(seconds / 60);
    const sec = seconds % 60;
    return `${min}:${String(sec).padStart(2, "0")}`;
  }

  function getDifficultyLabel(level) {
    const labeler = readGlobal(() => getAiDifficultyLabel, null);
    if (typeof labeler === "function") return labeler(level);
    return level;
  }

  function summarize(matches) {
    const stats = { total: matches.length, win: 0, loss: 0, draw: 0 };
    const byDifficulty = new Map();
    for (const match of matches) {
      stats[match.result] += 1;
      const bucket = byDifficulty.get(match.difficulty) || { total: 0, win: 0 };
      bucket.total += 1;
      if (match.result === "win") bucket.win += 1;
      byDifficulty.set(match.difficulty, bucket);
    }
    return { stats, byDifficulty };
  }

  function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  }

  function updateAiMatchHistoryPanel() {
    const title = document.getElementById("aiMatchHistoryTitle");
    if (!title) return;

    const matches = loadHistory().matches;
    const { stats, byDifficulty } = summarize(matches);
    const winRate = stats.total ? (stats.win / stats.total) * 100 : 0;

    setText("aiMatchHistoryTitle", text("title"));
    setText("aiMatchHistoryRecentLabel", text("recent"));
    setText("aiHistoryTotalLabel", text("total"));
    setText("aiHistoryWinRateLabel", text("winRate"));
    setText("aiHistoryTotal", text("totalValue")(stats));
    setText("aiHistoryWinRate", formatPercent(winRate));

    const difficultyRates = document.getElementById("aiHistoryDifficultyRates");
    if (difficultyRates) {
      difficultyRates.innerHTML = "";
      const allowed = getAllowedDifficulties();
      let rendered = 0;
      for (const difficulty of allowed) {
        const bucket = byDifficulty.get(difficulty);
        if (!bucket?.total) continue;
        const chip = document.createElement("div");
        chip.className = "aiMatchDifficultyRate";
        chip.textContent = `${getDifficultyLabel(difficulty)} ${formatPercent((bucket.win / bucket.total) * 100)} (${bucket.win}/${bucket.total})`;
        difficultyRates.appendChild(chip);
        rendered += 1;
      }
      if (!rendered) {
        const empty = document.createElement("div");
        empty.className = "aiMatchHistoryEmpty";
        empty.textContent = text("noDifficulty");
        difficultyRates.appendChild(empty);
      }
    }

    const recent = document.getElementById("aiHistoryRecentList");
    if (!recent) return;
    recent.innerHTML = "";
    if (!matches.length) {
      const empty = document.createElement("div");
      empty.className = "aiMatchHistoryEmpty";
      empty.textContent = text("empty");
      recent.appendChild(empty);
      return;
    }

    const reasonLabels = text("reasons");
    for (const match of matches.slice(0, 20)) {
      const row = document.createElement("div");
      row.className = "aiMatchRecentRow";

      const result = document.createElement("span");
      result.className = `aiMatchRecentResult ${match.result}`;
      result.textContent = text(match.result);

      const date = document.createElement("span");
      date.className = "aiMatchRecentMeta";
      const playedAt = new Date(match.playedAt);
      date.textContent = Number.isNaN(playedAt.getTime()) ? "-" : playedAt.toLocaleDateString();

      const meta = document.createElement("span");
      meta.className = "aiMatchRecentMeta";
      meta.textContent = `${getDifficultyLabel(match.difficulty)} · ${text(match.mode === "item" ? "item" : "speed")}${match.ghostMode ? ` · ${text("ghost")}` : ""}`;

      const details = document.createElement("span");
      details.className = "aiMatchRecentMeta";
      details.textContent = `${formatTime(match.playTimeMs)} · ${formatPercent(match.territory.playerPercent)} · ${reasonLabels[match.reasonType] || match.reasonType || "-"}`;

      row.append(result, date, meta, details);
      recent.appendChild(row);
    }
  }

  function wrapGlobalFunction(name, wrapper) {
    const original = window[name];
    if (typeof original !== "function" || original.__aiHistoryWrapped) return;
    const wrapped = wrapper(original);
    wrapped.__aiHistoryWrapped = true;
    window[name] = wrapped;
  }

  function installHooks() {
    wrapGlobalFunction("startCountdown", (original) => function (...args) {
      const shouldBegin = readGlobal(() => matchMode, "") === "ai" && isAllowedDifficulty(readGlobal(() => aiDifficulty, ""));
      const result = original.apply(this, args);
      if (shouldBegin) beginAiHistorySession();
      return result;
    });

    wrapGlobalFunction("endGame", (original) => function (winner, reasonText, ...rest) {
      const alreadyLocked = !!readGlobal(() => gameResultLocked, false);
      const result = original.call(this, winner, reasonText, ...rest);
      if (!alreadyLocked) recordAiMatchHistory(winner, reasonText);
      return result;
    });

    wrapGlobalFunction("resetMatch", (original) => function (...args) {
      clearAiHistorySession();
      return original.apply(this, args);
    });

    wrapGlobalFunction("returnToLobby", (original) => function (...args) {
      clearAiHistorySession();
      return original.apply(this, args);
    });

    wrapGlobalFunction("updateAiRecordPanel", (original) => function (...args) {
      const result = original.apply(this, args);
      updateAiMatchHistoryPanel();
      return result;
    });

    wrapGlobalFunction("openAiRankingPopup", (original) => function (...args) {
      const result = original.apply(this, args);
      updateAiMatchHistoryPanel();
      return result;
    });

    wrapGlobalFunction("selectLanguage", (original) => function (...args) {
      const result = original.apply(this, args);
      updateAiMatchHistoryPanel();
      return result;
    });

    updateAiMatchHistoryPanel();
  }

  window.DegulAiHistory = {
    beginSession: beginAiHistorySession,
    clearSession: clearAiHistorySession,
    recordResult: recordAiMatchHistory,
    updatePanel: updateAiMatchHistoryPanel,
    loadHistory,
    loadUsedSessions
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", installHooks, { once: true });
  } else {
    installHooks();
  }
})();
