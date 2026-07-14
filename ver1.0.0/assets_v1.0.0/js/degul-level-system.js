(function () {
  "use strict";

  const PROFILE_KEY = "degulDegulAiLevelProfileV1";
  const MAX_LEVEL = 100;
  const MAX_RECENT_MATCHES = 30;
  const DIFFICULTY_MULTIPLIERS = {
    easy: 0.8,
    normal: 1.0,
    hard: 1.2,
    superhard: 1.4,
    extreme: 1.6,
    hell: 1.8,
    chaos: 2.0
  };
  const XP_ANCHORS = [
    [1, 0], [2, 800], [3, 1900], [4, 3300], [5, 5000],
    [6, 7200], [7, 10000], [8, 13500], [9, 17500], [10, 22500],
    [20, 70000], [30, 140000], [40, 250000], [50, 380000],
    [60, 550000], [70, 750000], [80, 980000], [90, 1250000], [100, 1600000]
  ];

  let activeSession = null;
  let lastAward = null;

  function readGlobal(getter, fallback) {
    try {
      const value = getter();
      return value === undefined ? fallback : value;
    } catch {
      return fallback;
    }
  }

  function isTestMode() {
    try {
      return window.DegulTestGuard?.isTestMode?.() === true;
    } catch {
      return false;
    }
  }

  function safeGet(key, fallback = "") {
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
    } catch {}
  }

  function currentAccountId() {
    try {
      return String(window.DegulAuth?.getUser?.()?.id || "").trim();
    } catch {
      return "";
    }
  }

  function profileKey(accountId = currentAccountId()) {
    const scope = accountId ? encodeURIComponent(accountId) : "signed-out";
    return `${PROFILE_KEY}:${scope}`;
  }

  function makeSessionId() {
    try {
      if (crypto?.randomUUID) return crypto.randomUUID();
    } catch {}
    return `level-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }

  function loadProfile(accountId) {
    try {
      const parsed = JSON.parse(safeGet(profileKey(accountId), ""));
      const matches = Array.isArray(parsed?.recentMatches) ? parsed.recentMatches : [];
      return {
        version: 1,
        totalXp: Math.max(0, Math.min(1600000, Math.round(Number(parsed?.totalXp) || 0))),
        recentMatches: matches.map(normalizeRecent).filter(Boolean).slice(0, MAX_RECENT_MATCHES),
        updatedAt: typeof parsed?.updatedAt === "string" ? parsed.updatedAt : null
      };
    } catch {
      return { version: 1, totalXp: 0, recentMatches: [], updatedAt: null };
    }
  }

  function normalizeRecent(match) {
    if (!match || typeof match !== "object") return null;
    return {
      id: String(match.id || makeSessionId()),
      result: ["win", "loss", "draw", "quit"].includes(match.result) ? match.result : "loss",
      difficulty: String(match.difficulty || "normal"),
      xp: Math.max(0, Math.round(Number(match.xp) || 0)),
      playTimeMs: Math.max(0, Math.round(Number(match.playTimeMs) || 0)),
      moves: Math.max(0, Math.round(Number(match.moves) || 0)),
      directionChanges: Math.max(0, Math.round(Number(match.directionChanges) || 0)),
      claimedTiles: Math.max(0, Math.round(Number(match.claimedTiles) || 0)),
      flags: Array.isArray(match.flags) ? match.flags.slice(0, 8).map(String) : [],
      playedAt: String(match.playedAt || new Date().toISOString())
    };
  }

  function saveProfile(profile, accountId) {
    const normalized = {
      version: 1,
      totalXp: Math.max(0, Math.min(1600000, Math.round(Number(profile.totalXp) || 0))),
      recentMatches: Array.isArray(profile.recentMatches)
        ? profile.recentMatches.map(normalizeRecent).filter(Boolean).slice(0, MAX_RECENT_MATCHES)
        : [],
      updatedAt: new Date().toISOString()
    };
    safeSet(profileKey(accountId), JSON.stringify(normalized));
    return normalized;
  }

  function getXpForLevel(level) {
    const target = Math.max(1, Math.min(MAX_LEVEL, Math.floor(Number(level) || 1)));
    for (let i = 0; i < XP_ANCHORS.length - 1; i++) {
      const [fromLevel, fromXp] = XP_ANCHORS[i];
      const [toLevel, toXp] = XP_ANCHORS[i + 1];
      if (target === fromLevel) return fromXp;
      if (target > fromLevel && target < toLevel) {
        return Math.round(fromXp + ((toXp - fromXp) * (target - fromLevel)) / (toLevel - fromLevel));
      }
    }
    return target >= MAX_LEVEL ? 1600000 : 0;
  }

  function getLevelInfo(totalXp) {
    const xp = Math.max(0, Math.min(1600000, Math.round(Number(totalXp) || 0)));
    let level = 1;
    for (let candidate = 2; candidate <= MAX_LEVEL; candidate++) {
      if (xp >= getXpForLevel(candidate)) level = candidate;
      else break;
    }
    const currentLevelXp = getXpForLevel(level);
    const nextLevelXp = level >= MAX_LEVEL ? currentLevelXp : getXpForLevel(level + 1);
    const span = Math.max(1, nextLevelXp - currentLevelXp);
    const gained = Math.max(0, xp - currentLevelXp);
    return {
      level,
      totalXp: xp,
      currentLevelXp,
      nextLevelXp,
      xpIntoLevel: gained,
      xpToNext: level >= MAX_LEVEL ? 0 : Math.max(0, nextLevelXp - xp),
      progress: level >= MAX_LEVEL ? 1 : Math.max(0, Math.min(1, gained / span))
    };
  }

  function isPlayerActor(actor) {
    return !!(actor && actor.landId === readGlobal(() => P1_LAND, 1) && actor.isAI !== true);
  }

  function getOutcome(winner) {
    if (!winner) return "draw";
    if (winner.landId === readGlobal(() => P1_LAND, 1)) return "win";
    if (winner.landId === readGlobal(() => P2_LAND, 2)) return "loss";
    return "draw";
  }

  function getPlayTimeMs() {
    const ended = Number(readGlobal(() => matchEndedAt, 0));
    const started = Number(readGlobal(() => matchStartedAt, 0));
    if (Number.isFinite(ended) && Number.isFinite(started) && ended > started) return ended - started;
    if (Number.isFinite(started) && started > 0) return performance.now() - started;
    return activeSession ? performance.now() - activeSession.startedAtMs : 0;
  }

  function beginSession() {
    if (isTestMode() || readGlobal(() => matchMode, "") !== "ai") return null;
    const difficulty = String(readGlobal(() => aiDifficulty, "normal"));
    if (!Object.prototype.hasOwnProperty.call(DIFFICULTY_MULTIPLIERS, difficulty)) return null;
    const accountId = currentAccountId();
    if (!accountId) return null;
    activeSession = {
      id: makeSessionId(),
      accountId,
      difficulty,
      startedAtMs: performance.now(),
      moves: 0,
      directionChanges: 0,
      claimedTiles: 0,
      lastDirectionKey: ""
    };
    lastAward = null;
    return activeSession;
  }

  function clearSession() {
    activeSession = null;
  }

  function getSurvivalMultiplier(playTimeMs) {
    const seconds = playTimeMs / 1000;
    if (seconds < 20) return 0;
    if (seconds < 40) return 0.3;
    if (seconds < 60) return 0.6;
    return 1;
  }

  function getActivityMultiplier(stats) {
    if (stats.moves < 5 || stats.directionChanges < 2 || stats.claimedTiles < 2) return 0;
    if (stats.moves >= 20 && stats.directionChanges >= 5 && stats.claimedTiles >= 10) return 1;
    return 0.5;
  }

  function getRecentPenalty(profile, flags, result) {
    const recent = profile.recentMatches || [];
    const withCurrent = [{ flags, result }, ...recent];
    if (result === "loss" && withCurrent.slice(0, 3).length >= 3 && withCurrent.slice(0, 3).every((match) => match.flags.includes("shortDeath"))) return 0;
    let penalty = 1;
    const first5 = withCurrent.slice(0, 5);
    if (first5.length >= 5 && first5.every((match) => match.flags.includes("lowClaim"))) penalty *= 0.5;
    if (first5.length >= 5 && first5.every((match) => match.flags.includes("lowMove"))) penalty *= 0.5;
    return penalty;
  }

  function calculateAward(winner) {
    if (!activeSession) return null;
    const result = getOutcome(winner);
    const playTimeMs = getPlayTimeMs();
    const multiplier = DIFFICULTY_MULTIPLIERS[activeSession.difficulty] || 1;
    const stats = {
      moves: activeSession.moves,
      directionChanges: activeSession.directionChanges,
      claimedTiles: activeSession.claimedTiles
    };
    const flags = [];
    if (playTimeMs < 30000) flags.push("shortDeath");
    if (stats.claimedTiles < 10) flags.push("lowClaim");
    if (stats.moves < 20) flags.push("lowMove");

    let rawXp = 0;
    if (result === "win") {
      let winMultiplier = 1;
      if (playTimeMs <= 5000 || stats.moves < 3) {
        winMultiplier = 0;
        flags.push("abnormalWin");
      } else if (playTimeMs <= 20000) {
        winMultiplier = 0.5;
        flags.push("quickWin");
      }
      rawXp = 1000 * multiplier * winMultiplier;
    } else {
      const survivalMultiplier = getSurvivalMultiplier(playTimeMs);
      const activityMultiplier = getActivityMultiplier(stats);
      if (survivalMultiplier === 0) flags.push("tooFast");
      if (activityMultiplier === 0) flags.push("inactive");
      else if (activityMultiplier < 1) flags.push("lowActivity");
      rawXp = 500 * multiplier * survivalMultiplier * activityMultiplier;
    }

    const profile = loadProfile(activeSession.accountId);
    const recentPenalty = getRecentPenalty(profile, flags, result);
    if (recentPenalty === 0) flags.push("repeatLimited");
    else if (recentPenalty < 1) flags.push("repeatReduced");

    return {
      id: activeSession.id,
      result,
      difficulty: activeSession.difficulty,
      xp: Math.max(0, Math.round(rawXp * recentPenalty)),
      playTimeMs: Math.round(playTimeMs),
      moves: stats.moves,
      directionChanges: stats.directionChanges,
      claimedTiles: stats.claimedTiles,
      flags,
      playedAt: new Date().toISOString()
    };
  }

  function applyAward(winner) {
    if (isTestMode() || !activeSession) {
      clearSession();
      return null;
    }
    const accountId = activeSession.accountId;
    const award = calculateAward(winner);
    activeSession = null;
    if (!award) return null;

    const beforeProfile = loadProfile(accountId);
    const before = getLevelInfo(beforeProfile.totalXp);
    const nextTotal = Math.min(1600000, beforeProfile.totalXp + award.xp);
    const after = getLevelInfo(nextTotal);
    saveProfile({ ...beforeProfile, totalXp: nextTotal, recentMatches: [award, ...beforeProfile.recentMatches] }, accountId);
    lastAward = { ...award, before, after, totalXp: nextTotal };
    updateLevelPanel();
    window.dispatchEvent(new CustomEvent("degul:ai-level-updated", { detail: lastAward }));
    return lastAward;
  }

  function recordQuitIfNeeded() {
    if (!activeSession) return;
    const accountId = activeSession.accountId;
    const profile = loadProfile(accountId);
    saveProfile({
      ...profile,
      recentMatches: [{
        id: activeSession.id,
        result: "quit",
        difficulty: activeSession.difficulty,
        xp: 0,
        playTimeMs: getPlayTimeMs(),
        moves: activeSession.moves,
        directionChanges: activeSession.directionChanges,
        claimedTiles: activeSession.claimedTiles,
        flags: ["quit"],
        playedAt: new Date().toISOString()
      }, ...profile.recentMatches]
    }, accountId);
    activeSession = null;
    lastAward = null;
    updateLevelPanel();
  }

  function formatNumber(value) {
    return Math.max(0, Math.round(Number(value) || 0)).toLocaleString();
  }

  function text(key) {
    const lang = readGlobal(() => currentLang, "ko") || "ko";
    const packs = {
      ko: {
        title: "AI 레벨",
        next: "다음 레벨까지",
        max: "최대 레벨",
        total: "누적 XP",
        recent: "최근 획득",
        noRecent: "아직 AI 대전 XP가 없습니다.",
        result: (xp, level) => `+${formatNumber(xp)} XP · Lv.${level}`,
        limited: "0 XP",
        levelUp: (level) => `레벨 업! Lv.${level}`
      },
      en: {
        title: "AI Level",
        next: "To next level",
        max: "Max level",
        total: "Total XP",
        recent: "Last XP",
        noRecent: "No AI match XP yet.",
        result: (xp, level) => `+${formatNumber(xp)} XP · Lv.${level}`,
        limited: "0 XP",
        levelUp: (level) => `Level up! Lv.${level}`
      }
    };
    return (packs[lang] || packs.ko)[key];
  }

  function updateLevelPanel() {
    const profile = loadProfile();
    const info = getLevelInfo(profile.totalXp);
    updateProfileLevelBadge(info);

    const panel = document.getElementById("aiLevelPanel");
    if (!panel) return;
    const recent = profile.recentMatches.find((match) => match.result !== "quit") || null;
    const setText = (id, value) => {
      const el = document.getElementById(id);
      if (el) el.textContent = value;
    };
    setText("aiLevelTitle", text("title"));
    setText("aiLevelValue", `Lv.${info.level}`);
    setText("aiLevelTotalXp", `${text("total")} ${formatNumber(info.totalXp)}`);
    setText("aiLevelNextXp", info.level >= MAX_LEVEL ? text("max") : `${text("next")} ${formatNumber(info.xpToNext)} XP`);
    setText("aiLevelRecentXp", recent ? `${text("recent")} +${formatNumber(recent.xp)} XP` : text("noRecent"));
    const fill = document.getElementById("aiLevelProgressFill");
    if (fill) fill.style.width = `${Math.round(info.progress * 100)}%`;
  }

  function updateProfileLevelBadge(info = getLevelInfo(loadProfile().totalXp)) {
    const badge = document.getElementById("guestAuthLevelBadge");
    if (!badge) return;
    badge.textContent = `Lv.${info.level}`;
    badge.title = `${text("title")} Lv.${info.level}`;
  }

  function appendResultXpLine() {
    if (!lastAward) return;
    const reasonBox = document.getElementById("resultText")?.querySelector(".resultReasonBox");
    if (!reasonBox || reasonBox.querySelector(".aiLevelResultXp")) return;
    const line = document.createElement("div");
    line.className = "aiLevelResultXp";
    line.textContent = lastAward.after.level > lastAward.before.level
      ? text("levelUp")(lastAward.after.level)
      : (lastAward.xp > 0 ? text("result")(lastAward.xp, lastAward.after.level) : text("limited"));
    reasonBox.appendChild(line);
  }

  function wrapGlobalFunction(name, wrapper, flag) {
    const original = window[name];
    if (typeof original !== "function" || original[flag]) return;
    const wrapped = wrapper(original);
    wrapped[flag] = true;
    window[name] = wrapped;
  }

  function installHooks() {
    wrapGlobalFunction("startCountdown", (original) => function (...args) {
      const shouldBegin = readGlobal(() => matchMode, "") === "ai";
      const result = original.apply(this, args);
      const countdownStarted = !!readGlobal(() => isCountingDown, false)
        || readGlobal(() => gamePhase, "") === readGlobal(() => GAME_PHASE.COUNTDOWN, "countdown");
      if (shouldBegin && countdownStarted) beginSession();
      return result;
    }, "__degulLevelStartWrapped");

    wrapGlobalFunction("setNextDirection", (original) => function (actor, dx, dz, ...rest) {
      if (activeSession && isPlayerActor(actor)) {
        const key = `${dx},${dz}`;
        if (key !== activeSession.lastDirectionKey) {
          activeSession.directionChanges += 1;
          activeSession.lastDirectionKey = key;
        }
      }
      return original.call(this, actor, dx, dz, ...rest);
    }, "__degulLevelDirectionWrapped");

    wrapGlobalFunction("tryMove", (original) => function (actor, dx, dz, ...rest) {
      if (activeSession && isPlayerActor(actor)) activeSession.moves += Math.max(1, readGlobal(() => getActorStepDistance(actor), 1));
      return original.call(this, actor, dx, dz, ...rest);
    }, "__degulLevelMoveWrapped");

    wrapGlobalFunction("claimArea", (original) => function (actor, ...args) {
      const before = activeSession && isPlayerActor(actor) && typeof countLand === "function" ? countLand(actor.landId) : 0;
      const result = original.call(this, actor, ...args);
      if (activeSession && isPlayerActor(actor) && typeof countLand === "function") {
        activeSession.claimedTiles += Math.max(0, countLand(actor.landId) - before);
      }
      return result;
    }, "__degulLevelClaimWrapped");

    wrapGlobalFunction("claimLineSurgeStep", (original) => function (actor, ...args) {
      const before = activeSession && isPlayerActor(actor) && typeof countLand === "function" ? countLand(actor.landId) : 0;
      const result = original.call(this, actor, ...args);
      if (activeSession && isPlayerActor(actor) && typeof countLand === "function") {
        activeSession.claimedTiles += Math.max(0, countLand(actor.landId) - before);
      }
      return result;
    }, "__degulLevelSurgeWrapped");

    wrapGlobalFunction("endGame", (original) => function (winner, reasonText, ...rest) {
      const alreadyLocked = !!readGlobal(() => gameResultLocked, false);
      const result = original.call(this, winner, reasonText, ...rest);
      if (!alreadyLocked) applyAward(winner);
      return result;
    }, "__degulLevelEndWrapped");

    wrapGlobalFunction("showResultPopup", (original) => function (...args) {
      const result = original.apply(this, args);
      appendResultXpLine();
      return result;
    }, "__degulLevelResultWrapped");

    wrapGlobalFunction("resetMatch", (original) => function (...args) {
      recordQuitIfNeeded();
      return original.apply(this, args);
    }, "__degulLevelResetWrapped");

    wrapGlobalFunction("returnToLobby", (original) => function (...args) {
      recordQuitIfNeeded();
      return original.apply(this, args);
    }, "__degulLevelLobbyWrapped");

    wrapGlobalFunction("openAiRankingPopup", (original) => function (...args) {
      const result = original.apply(this, args);
      updateLevelPanel();
      return result;
    }, "__degulLevelRankingWrapped");

    wrapGlobalFunction("selectLanguage", (original) => function (...args) {
      const result = original.apply(this, args);
      updateLevelPanel();
      return result;
    }, "__degulLevelLangWrapped");

    updateLevelPanel();
    window.addEventListener("degul:auth-ready", updateLevelPanel);
    window.addEventListener("degul:auth-logout", updateLevelPanel);
  }

  window.DegulLevelSystem = {
    loadProfile,
    saveProfile,
    getLevelInfo,
    getXpForLevel,
    updatePanel: updateLevelPanel,
    getLastAward: () => lastAward,
    beginSession,
    clearSession
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", installHooks, { once: true });
  } else {
    installHooks();
  }
})();
