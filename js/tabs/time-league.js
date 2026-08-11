// ══════════════════════════════════════════════════════════════════
// js/tabs/time-league.js — window.TimeLeague, the Time League mode
// orchestrator. Mirrors js/tabs/commissioner-office.js's shape: a
// top-level mode (not a per-league tab) that owns all state and calls the
// ported engine (js/shared/time-league-*.js) directly.
//
// Ported from The Duat's app/TimeLeagueView.tsx — localStorage read/write,
// bundled-dataset fetch caching, and the shell/lobby/tab-bar. The four
// content tabs (draft / team-roster-waivers-trades / standings / activity)
// and the gameday/gamecast tab render via the sibling panel components in
// js/components/time-league-*.js.
// ══════════════════════════════════════════════════════════════════
(function () {
    'use strict';
    const { useState, useEffect, useCallback, useMemo } = React;
    const h = React.createElement;

    const Types = window.App.TimeLeagueTypes;
    const Season = window.App.TimeLeagueSeason;
    const PlayerCards = window.App.TimeLeaguePlayerCards;
    const Engine = window.App.TimeLeagueEngine;
    const EraRules = window.App.TimeLeagueEraRules;

    const UI_PREFS_KEY = 'wr-time-league-ui-v1';
    const REGULAR_SEASON_WEEKS = 14;
    const MAX_QUARTERBACKS = 2;

    const TAB_IDS = ['home', 'draft', 'gameday', 'roster', 'waivers', 'trades', 'standings', 'activity'];
    const TAB_LABELS = {
        home: 'HOME', draft: 'DRAFT', gameday: 'GAMEDAY', roster: 'ROSTER', waivers: 'WAIVERS',
        trades: 'TRADES', standings: 'STANDINGS', activity: 'ACTIVITY',
    };

    const PERSONA_IDS = ['warlord', 'archivist', 'gambler', 'steward'];
    const defaultSeats = () => [
        { name: 'Commander', manager: 'human', aiPersona: 'warlord' },
        { name: 'Warlord Kade', manager: 'ai', aiPersona: 'warlord' },
        { name: 'The Archivist', manager: 'ai', aiPersona: 'archivist' },
        { name: 'Riverboat Sol', manager: 'ai', aiPersona: 'gambler' },
        { name: 'Steward Vance', manager: 'ai', aiPersona: 'steward' },
        { name: 'Iron Ledger', manager: 'ai', aiPersona: 'archivist' },
    ];

    // ── storage (all reads guarded; wall-clock timestamps live only in this UI layer) ──
    function readIndexEntries() {
        try {
            const raw = JSON.parse(window.localStorage.getItem(Types.TIME_LEAGUE_INDEX_KEY) ?? 'null');
            if (!Array.isArray(raw)) return [];
            return raw.flatMap((item) => {
                if (!item || typeof item !== 'object' || typeof item.leagueId !== 'string' || typeof item.name !== 'string') return [];
                const phase = item.phase === 'season' || item.phase === 'complete' ? item.phase : 'draft';
                return [{
                    leagueId: item.leagueId, name: item.name, phase,
                    teamCount: typeof item.teamCount === 'number' ? item.teamCount : 0,
                    currentWeek: typeof item.currentWeek === 'number' ? item.currentWeek : 1,
                    createdAt: typeof item.createdAt === 'string' ? item.createdAt : '',
                }];
            });
        } catch { return []; }
    }
    function writeIndexEntries(entries) {
        try { window.localStorage.setItem(Types.TIME_LEAGUE_INDEX_KEY, JSON.stringify(entries)); } catch { /* in-memory only */ }
    }
    function readLeague(leagueId) {
        try { return Engine.normalizeTimeLeague(JSON.parse(window.localStorage.getItem(Types.timeLeagueStorageKey(leagueId)) ?? 'null')); }
        catch { return null; }
    }
    function writeLeague(state) {
        try { window.localStorage.setItem(Types.timeLeagueStorageKey(state.leagueId), JSON.stringify(state)); } catch { /* in-memory only */ }
    }
    function removeLeagueRecord(leagueId) {
        try { window.localStorage.removeItem(Types.timeLeagueStorageKey(leagueId)); } catch { /* nothing to clean up */ }
    }
    const indexEntryOf = (state) => ({
        leagueId: state.leagueId, name: state.name, phase: state.phase,
        teamCount: state.teams.length, currentWeek: state.currentWeek, createdAt: state.createdAt,
    });
    function readUiPrefs() {
        try {
            const raw = JSON.parse(window.localStorage.getItem(UI_PREFS_KEY) ?? 'null');
            const tab = TAB_IDS.includes(String(raw?.tab)) ? raw.tab : 'home';
            return { leagueId: typeof raw?.leagueId === 'string' ? raw.leagueId : null, tab, teamId: typeof raw?.teamId === 'string' ? raw.teamId : '' };
        } catch { return { leagueId: null, tab: 'home', teamId: '' }; }
    }
    function writeUiPrefs(prefs) {
        try { window.localStorage.setItem(UI_PREFS_KEY, JSON.stringify(prefs)); } catch { /* convenience only */ }
    }

    // ── bundled dataset caches (module scope so remounts reuse the heavy parse) ──
    let logIndexPromise = null;
    const fetchLogIndex = () => {
        logIndexPromise ??= fetch('data/time-league/nflverse-game-logs.csv')
            .then(async (response) => {
                if (!response.ok) return null;
                const { logs } = Season.parseGameLogCsv(await response.text());
                return logs.length ? Season.buildGameLogIndex(logs) : null;
            })
            .catch(() => null);
        return logIndexPromise;
    };
    let eraFactorsPromise = null;
    const fetchEraFactors = () => {
        eraFactorsPromise ??= fetch('data/time-league/era-factors.json')
            .then(async (response) => {
                if (!response.ok) return null;
                const payload = await response.json();
                if (!payload?.factors) return null;
                return new Map(Object.entries(payload.factors).flatMap(([key, value]) =>
                    (typeof value === 'number' && Number.isFinite(value) ? [[key, value]] : [])));
            })
            .catch(() => null);
        return eraFactorsPromise;
    };
    let cardsPromise = null;
    const fetchCards = () => { cardsPromise ??= PlayerCards.loadPlayerCards(); return cardsPromise; };

    // ── shared bits ──
    function EraChipRail({ label, chips }) {
        return h('div', { className: 'tl-rail' },
            h('span', { className: 'tl-label' }, label),
            chips.map((chip, position) => h('span', { key: `${chip}:${position}`, className: `tl-pill${position === 0 ? ' gold' : ''}` }, chip)));
    }
    window.TimeLeagueEraChipRail = EraChipRail;
    window.TimeLeagueUtils = {
        REGULAR_SEASON_WEEKS, MAX_QUARTERBACKS, TAB_LABELS, PERSONA_IDS, defaultSeats,
        indexEntryOf, readLeague, writeLeague, removeLeagueRecord,
    };

    function TimeLeagueStyles() {
        return h('style', null, `
            .tl-root { max-width: 1180px; margin: 0 auto; }
            .tl-root .tabular { font-variant-numeric: tabular-nums; }
            .tl-card { background: var(--black); border: 1px solid rgba(212,175,55,0.18); border-radius: var(--card-radius, 10px); padding: 14px 16px; }
            .tl-card + .tl-card { margin-top: 14px; }
            .tl-card-title { font-family: var(--font-title); font-weight: 600; font-size: 13.5px; letter-spacing: .04em; text-transform: uppercase; color: var(--text-secondary); margin-bottom: 12px; display: flex; align-items: center; justify-content: space-between; gap: 10px; }
            .tl-card-title small { font-family: var(--font-mono); font-weight: 500; font-size: 11px; color: var(--text-muted); text-transform: none; letter-spacing: 0; }
            .tl-label { font-family: var(--font-mono); font-size: 10.5px; letter-spacing: .08em; text-transform: uppercase; color: var(--text-muted); }
            .tl-pill { display: inline-flex; align-items: center; gap: 4px; font-family: var(--font-mono); font-size: 10px; font-weight: 700; letter-spacing: .05em; text-transform: uppercase; padding: 2px 8px; border-radius: 100px; background: rgba(255,255,255,0.06); color: var(--text-secondary); }
            .tl-pill.gold { background: rgba(212,175,55,0.14); color: var(--gold); }
            .tl-pill.info { background: rgba(93,173,226,0.14); color: var(--info); }
            .tl-pill.warn { background: rgba(240,165,0,0.14); color: var(--warn); }
            .tl-pill.good { background: rgba(46,204,113,0.14); color: var(--good); }
            .tl-pill.bad { background: rgba(231,76,60,0.14); color: var(--bad); }
            .tl-grid-2 { display: grid; grid-template-columns: 1.3fr 1fr; gap: 16px; align-items: start; }
            .tl-grid-2.even { grid-template-columns: 1fr 1fr; }
            @media (max-width: 900px) { .tl-grid-2, .tl-grid-2.even { grid-template-columns: 1fr; } }
            .tl-btn { font-family: var(--font-mono); font-size: 11px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; padding: 7px 13px; border-radius: 7px; background: rgba(255,255,255,0.04); color: var(--text-secondary); border: 1px solid rgba(255,255,255,0.1); cursor: pointer; display: inline-flex; align-items: center; gap: 6px; }
            .tl-btn:hover:not(:disabled) { border-color: rgba(212,175,55,0.4); color: var(--white); }
            .tl-btn:disabled { opacity: .4; cursor: default; }
            .tl-btn.primary { background: var(--gold); color: var(--page-bg); border: none; }
            .tl-btn.primary:hover:not(:disabled) { background: var(--dark-gold); }
            .tl-btn.danger { border-color: rgba(231,76,60,0.4); color: var(--bad); }
            .tl-btn.icon { padding: 6px 8px; }
            .tl-input, .tl-select { font-family: var(--font-body); font-size: 13px; padding: 7px 10px; border-radius: 7px; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.1); color: var(--white); width: 100%; }
            .tl-input:focus, .tl-select:focus { outline: none; border-color: var(--gold); }
            .tl-field { display: flex; flex-direction: column; gap: 6px; margin-bottom: 16px; }
            .tl-field:last-child { margin-bottom: 0; }
            .tl-hint { font-size: 11.5px; color: var(--text-muted); margin: 0; }
            .tl-chip-row { display: flex; flex-wrap: wrap; gap: 7px; }
            .tl-opt-chip { font-size: 12px; padding: 6px 12px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.09); background: rgba(255,255,255,0.02); color: var(--text-secondary); cursor: pointer; text-align: left; }
            .tl-opt-chip.selected { border-color: var(--gold); background: rgba(212,175,55,0.1); color: var(--gold); font-weight: 600; }
            .tl-opt-detail { display: block; font-family: var(--font-mono); font-size: 10.5px; color: var(--text-faint, rgba(189,184,173,0.5)); margin-top: 2px; }
            .tl-seat-row { display: grid; grid-template-columns: 28px 1fr 90px 130px 28px; align-items: center; gap: 8px; padding: 7px 0; border-bottom: 1px solid rgba(255,255,255,0.04); }
            .tl-seat-row:last-child { border-bottom: none; }
            .tl-toggle { display: flex; align-items: flex-start; gap: 10px; padding: 10px 0; cursor: pointer; }
            .tl-tbl { width: 100%; border-collapse: collapse; font-size: 12.5px; }
            .tl-tbl th { text-align: left; font-family: var(--font-mono); font-size: 10px; letter-spacing: .06em; text-transform: uppercase; color: var(--text-muted); padding: 6px 8px; border-bottom: 1px solid var(--charcoal); font-weight: 500; }
            .tl-tbl td { padding: 8px; border-bottom: 1px solid rgba(255,255,255,0.04); vertical-align: middle; }
            .tl-tbl tr:last-child td { border-bottom: none; }
            .tl-tbl td.num, .tl-tbl th.num { text-align: right; }
            .tl-tbl tr.selected td { background: rgba(212,175,55,0.06); }
            .tl-tbl tr.clickable { cursor: pointer; }
            .tl-tbl tr.clickable:hover td { background: rgba(255,255,255,0.02); }
            .tl-empty { font-size: 12.5px; color: var(--text-muted); padding: 10px 2px; margin: 0; }
            .tl-feedrow { display: flex; gap: 10px; padding: 8px 2px; border-bottom: 1px solid rgba(255,255,255,0.04); font-size: 12px; }
            .tl-feedrow:last-child { border-bottom: none; }
            .tl-feedrow time { font-family: var(--font-mono); font-size: 10px; color: var(--text-muted); flex: none; padding-top: 1px; white-space: nowrap; }
            .tl-feedrow p { margin: 0; color: var(--text-secondary); }
            .tl-feedrow.caution { background: rgba(240,165,0,0.05); }
            .tl-feedrow.caution time { color: var(--warn); }
            .tl-feedrow.urgent time { color: var(--bad); }
            .tl-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; padding: 14px 16px; margin-bottom: 16px; flex-wrap: wrap; }
            .tl-header-title { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
            .tl-header-title strong { font-family: var(--font-title); font-weight: 700; font-size: 22px; letter-spacing: .01em; }
            .tl-header-tools { display: flex; align-items: center; gap: 8px; margin-left: auto; }
            .tl-rail { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-top: 10px; }
            .tl-tabbar { display: flex; gap: 2px; margin-bottom: 18px; border-bottom: 1px solid var(--charcoal); overflow-x: auto; }
            .tl-tabbtn { font-family: var(--font-mono); font-size: 12px; font-weight: 600; letter-spacing: .05em; text-transform: uppercase; color: var(--text-muted); background: none; border: none; border-bottom: 2px solid transparent; padding: 10px 16px; cursor: pointer; white-space: nowrap; }
            .tl-tabbtn:hover { color: var(--text-secondary); }
            .tl-tabbtn.active { color: var(--gold); border-bottom-color: var(--gold); }
            .tl-pos-badge { font-family: var(--font-mono); font-size: 10px; font-weight: 700; padding: 2px 6px; border-radius: 4px; }
            .tl-pos-QB { background: rgba(96,165,250,0.16); color: #60a5fa; }
            .tl-pos-RB { background: rgba(46,204,113,0.16); color: var(--good); }
            .tl-pos-WR { background: rgba(212,175,55,0.18); color: var(--gold); }
            .tl-pos-TE { background: rgba(251,191,36,0.16); color: #fbbf24; }
            .tl-pos-K  { background: rgba(168,172,184,0.16); color: #a8acb8; }
            .tl-pos-DEF, .tl-pos-DL, .tl-pos-LB, .tl-pos-DB { background: rgba(248,113,113,0.16); color: #f87171; }

            /* ── Avatars ── */
            .tl-avatar { width: 32px; height: 32px; border-radius: 50%; display: inline-grid; place-items: center; flex: none; font-family: var(--font-title); font-weight: 700; font-size: 12px; color: var(--page-bg, #08080B); }
            .tl-avatar.sm { width: 22px; height: 22px; font-size: 9.5px; }
            .tl-avatar.lg { width: 56px; height: 56px; font-size: 20px; border: 2px solid rgba(255,255,255,0.15); }

            /* ── Player tile — era-coded, replaces table rows in Roster/Waivers ── */
            .tl-tile-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; }
            @media (max-width: 700px) { .tl-tile-grid { grid-template-columns: 1fr; } }
            .tl-player-tile { display: flex; align-items: center; gap: 12px; background: var(--off-black); border: 1px solid rgba(255,255,255,0.06); border-radius: var(--card-radius, 10px); padding: 10px 12px; position: relative; overflow: hidden; }
            .tl-player-tile::before { content: ''; position: absolute; inset: 0; opacity: .10; background: radial-gradient(circle at 100% 0%, var(--era-color, var(--gold)), transparent 65%); pointer-events: none; }
            .tl-era-badge { width: 40px; height: 40px; border-radius: 10px; display: grid; place-items: center; flex: none; font-size: 17px; border: 2px solid var(--era-color, var(--gold)); background: color-mix(in srgb, var(--era-color, var(--gold)) 16%, var(--black)); box-shadow: 0 0 12px -2px var(--era-color, var(--gold)); }
            .tl-player-tile .tl-p-body { flex: 1; min-width: 0; }
            .tl-player-tile .tl-p-name { font-weight: 700; font-size: 13px; }
            .tl-player-tile .tl-p-meta { display: flex; align-items: center; gap: 6px; margin-top: 3px; }
            .tl-player-tile .tl-p-era { font-family: var(--font-mono); font-size: 10px; color: var(--era-color, var(--text-muted)); font-weight: 700; }
            .tl-player-tile .tl-p-pts { font-family: var(--font-title); font-weight: 700; font-size: 19px; color: var(--gold); flex: none; text-align: right; }
            .tl-player-tile .tl-p-pts small { display: block; font-family: var(--font-mono); font-weight: 400; font-size: 9.5px; color: var(--text-muted); }
            .tl-top-pick-badge { font-family: var(--font-mono); font-size: 9px; font-weight: 700; color: var(--gold); background: rgba(212,175,55,0.14); border-radius: 4px; padding: 1px 5px; margin-left: 6px; }

            /* ── League Home ── */
            .tl-home-hero { background: linear-gradient(135deg, rgba(212,175,55,0.10), transparent 55%), var(--black); border: 1px solid rgba(212,175,55,0.18); border-radius: 14px; padding: 20px 22px; margin-bottom: 16px; }
            .tl-home-hero-top { display: flex; align-items: center; gap: 16px; }
            .tl-home-hero-top .tl-h-info { flex: 1; }
            .tl-home-hero-top .tl-h-league { font-family: var(--font-title); font-weight: 700; font-size: 20px; }
            .tl-home-hero-top .tl-h-sub { font-size: 12.5px; color: var(--text-secondary); margin-top: 2px; }
            .tl-mini-matchup { display: flex; align-items: center; justify-content: space-between; margin-top: 18px; padding-top: 16px; border-top: 1px solid var(--charcoal); }
            .tl-mini-matchup .tl-mm-side { display: flex; align-items: center; gap: 10px; }
            .tl-mini-matchup .tl-mm-pts { font-family: var(--font-title); font-weight: 700; font-size: 24px; }
            .tl-mini-matchup .tl-mm-vs { font-family: var(--font-mono); font-size: 10px; color: var(--text-faint, rgba(189,184,173,0.5)); text-align: center; }
            .tl-quick-actions { display: flex; gap: 8px; margin-top: 16px; flex-wrap: wrap; }
            .tl-home-row { display: flex; align-items: center; gap: 10px; padding: 8px 0; border-bottom: 1px solid rgba(255,255,255,0.04); font-size: 12.5px; }
            .tl-home-row:last-child { border-bottom: none; }

            /* ── Scoreboard strip + hero matchup (Gameday) ── */
            .tl-scoreboard-strip { display: flex; gap: 10px; overflow-x: auto; padding-bottom: 4px; margin-bottom: 16px; }
            .tl-score-chip { flex: none; min-width: 180px; background: var(--black); border: 1px solid rgba(212,175,55,0.18); border-radius: var(--card-radius, 10px); padding: 10px 12px; }
            .tl-score-chip.mine { border-color: var(--gold); background: linear-gradient(135deg, rgba(212,175,55,0.08), transparent); }
            .tl-score-chip .tl-sc-tag { font-family: var(--font-mono); font-size: 9.5px; letter-spacing: .08em; color: var(--text-muted); display: flex; align-items: center; gap: 4px; margin-bottom: 6px; }
            .tl-sc-dot { width: 5px; height: 5px; border-radius: 50%; background: var(--bad); animation: tlPulse 1.4s infinite; }
            .tl-sc-row { display: flex; align-items: center; justify-content: space-between; padding: 2px 0; gap: 8px; }
            .tl-sc-row .tl-sc-team { display: flex; align-items: center; gap: 6px; font-size: 12px; min-width: 0; }
            .tl-sc-row .tl-sc-team span:last-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
            .tl-sc-row.winning .tl-sc-team { color: var(--white); font-weight: 700; }
            .tl-sc-row:not(.winning) .tl-sc-team { color: var(--text-muted); }
            .tl-sc-row .tl-sc-pts { font-family: var(--font-mono); font-size: 13px; flex: none; }
            @keyframes tlPulse { 0%,100% { opacity: 1; } 50% { opacity: .25; } }
            .tl-hero-matchup { background: var(--black); border: 1px solid rgba(212,175,55,0.18); border-radius: 14px; padding: 20px 24px; margin-bottom: 16px; }
            .tl-hero-top { display: flex; align-items: center; justify-content: center; gap: 24px; }
            .tl-hero-side { text-align: center; flex: 1; min-width: 0; }
            .tl-hero-side .tl-h-name { font-size: 13px; color: var(--text-secondary); margin-top: 8px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
            .tl-hero-side .tl-h-name.leading { color: var(--white); font-weight: 700; }
            .tl-hero-side .tl-h-pts { font-family: var(--font-title); font-weight: 700; font-size: 38px; line-height: 1; margin-top: 4px; }
            .tl-hero-side .tl-h-pts.leading { color: var(--gold); }
            .tl-hero-mid { text-align: center; flex: none; width: 80px; }
            .tl-hero-mid .tl-h-vs { font-family: var(--font-mono); font-size: 10.5px; color: var(--text-faint, rgba(189,184,173,0.5)); letter-spacing: .1em; }
            .tl-hero-mid .tl-h-clock { font-family: var(--font-mono); font-size: 11.5px; color: var(--gold); margin-top: 6px; }
            .tl-score-bar { height: 6px; border-radius: 100px; background: rgba(255,255,255,0.08); overflow: hidden; margin: 18px 0 4px; display: flex; }
            .tl-score-bar .tl-fill { background: var(--gold); }
            .tl-score-bar .tl-fill.against { background: var(--charcoal); }
            .tl-win-prob { display: flex; justify-content: space-between; font-family: var(--font-mono); font-size: 10.5px; color: var(--text-muted); margin-bottom: 4px; }

            /* ── Draft: pick clock + queue strip ── */
            .tl-clock-ring { width: 30px; height: 30px; border-radius: 50%; border: 3px solid rgba(212,175,55,0.25); border-top-color: var(--gold); flex: none; animation: tlSpin 3s linear infinite; }
            @keyframes tlSpin { to { transform: rotate(360deg); } }
            .tl-queue-strip { display: flex; gap: 8px; overflow-x: auto; padding: 2px 0 4px; }
            .tl-queue-chip { flex: none; display: flex; align-items: center; gap: 6px; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); border-radius: 100px; padding: 5px 10px 5px 5px; font-size: 11.5px; cursor: pointer; }
            .tl-queue-chip .tl-qnum { width: 16px; height: 16px; border-radius: 50%; background: var(--gold); color: var(--page-bg, #08080B); font-family: var(--font-mono); font-size: 9px; font-weight: 700; display: grid; place-items: center; flex: none; }

            /* ── Trades: fairness scale ── */
            .tl-fairness { display: flex; align-items: center; gap: 10px; margin: 10px 0 4px; }
            .tl-fairness-track { flex: 1; height: 8px; border-radius: 100px; background: linear-gradient(90deg, var(--bad), var(--charcoal) 48%, var(--charcoal) 52%, var(--good)); position: relative; }
            .tl-fairness-marker { position: absolute; top: -4px; width: 16px; height: 16px; border-radius: 50%; background: var(--white); border: 2px solid var(--page-bg, #08080B); transform: translateX(-50%); transition: left .15s; }

            /* ── Standings streaks ── */
            .tl-streak { font-family: var(--font-mono); font-size: 10.5px; font-weight: 700; padding: 2px 6px; border-radius: 4px; }
            .tl-streak.W { background: rgba(46,204,113,0.14); color: var(--good); }
            .tl-streak.L { background: rgba(231,76,60,0.14); color: var(--bad); }
            .tl-streak.T { background: rgba(255,255,255,0.08); color: var(--text-secondary); }

            /* ── Gazette (Home tab newspaper front page) — dark "midnight edition":
               the rest of the mode stays dark, so this is a front page printed on
               dark stock rather than a light page dropped into a dark app. Serif is
               Georgia/Times — no new font dependency to load. */
            .tl-gazette { --tl-paper: #EDE6D3; }
            .tl-masthead { text-align: center; padding: 4px 0 12px; }
            .tl-masthead .tl-kicker { font-family: var(--font-mono); font-size: 10px; letter-spacing: .25em; color: var(--gold); text-transform: uppercase; }
            .tl-masthead .tl-name { font-family: Georgia, 'Times New Roman', serif; font-weight: 700; font-size: 38px; letter-spacing: .01em; margin: 4px 0 2px; color: var(--tl-paper); }
            .tl-masthead .tl-name em { font-style: italic; color: var(--gold); }
            .tl-masthead .tl-dateline { display: flex; align-items: center; justify-content: center; gap: 10px; font-family: var(--font-mono); font-size: 10px; color: var(--text-muted); text-transform: uppercase; letter-spacing: .06em; flex-wrap: wrap; }
            .tl-gazette-rule { height: 3px; background: var(--gold); margin: 8px 0 3px; }
            .tl-gazette-rule.thin { height: 1px; background: rgba(212,175,55,0.35); margin: 3px 0 18px; }
            .tl-gazette-grid { display: grid; grid-template-columns: 1.4fr 1fr; gap: 24px; }
            @media (max-width: 860px) { .tl-gazette-grid { grid-template-columns: 1fr; } }
            .tl-col-rule { border-right: 1px solid rgba(212,175,55,0.2); padding-right: 24px; }
            @media (max-width: 860px) { .tl-col-rule { border-right: none; padding-right: 0; } }
            .tl-section-label { font-family: var(--font-mono); font-size: 10px; letter-spacing: .16em; text-transform: uppercase; color: var(--gold); border-bottom: 1px solid rgba(212,175,55,0.3); padding-bottom: 4px; margin-bottom: 10px; }
            .tl-gaz-headline { font-family: Georgia, 'Times New Roman', serif; font-weight: 700; font-size: 24px; line-height: 1.15; color: var(--tl-paper); margin-bottom: 8px; }
            .tl-gaz-byline { font-family: var(--font-mono); font-size: 10px; letter-spacing: .08em; color: var(--text-muted); text-transform: uppercase; margin-bottom: 12px; }
            .tl-gaz-lede { font-family: Georgia, 'Times New Roman', serif; font-size: 14.5px; line-height: 1.55; color: var(--text-secondary); margin-bottom: 6px; }
            .tl-gaz-lede.drop::first-letter { font-size: 38px; font-weight: 700; float: left; line-height: .82; padding: 2px 5px 0 0; color: var(--gold); }
            .tl-boxscore { border: 1px solid rgba(212,175,55,0.3); margin-top: 14px; }
            .tl-boxscore-head { background: rgba(212,175,55,0.1); padding: 7px 12px; font-family: Georgia, 'Times New Roman', serif; font-weight: 700; font-size: 12.5px; color: var(--tl-paper); border-bottom: 1px solid rgba(212,175,55,0.3); }
            .tl-boxscore-row { display: flex; align-items: center; justify-content: space-between; padding: 7px 12px; border-bottom: 1px solid rgba(255,255,255,0.05); font-family: var(--font-mono); font-size: 12px; }
            .tl-boxscore-row:last-child { border-bottom: none; }
            .tl-boxscore-row.winner { color: var(--gold); font-weight: 700; }
            .tl-wire-item { font-family: var(--font-mono); font-size: 11px; color: var(--text-secondary); padding: 5px 0; border-bottom: 1px solid rgba(255,255,255,0.04); }
            .tl-wire-item:last-child { border-bottom: none; }
            .tl-wire-item b { color: var(--tl-paper); }
            .tl-kpi-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 18px; }
            .tl-gazette-kpi { border: 1px solid rgba(212,175,55,0.18); border-radius: 4px; padding: 9px 11px; }
            .tl-gazette-kpi .k-label { font-family: var(--font-mono); font-size: 9.5px; letter-spacing: .08em; text-transform: uppercase; color: var(--text-muted); margin-bottom: 4px; }
            .tl-gazette-kpi .k-value { font-family: Georgia, 'Times New Roman', serif; font-weight: 700; font-size: 21px; color: var(--gold); line-height: 1; }
            .tl-gazette-kpi .k-sub { font-family: var(--font-mono); font-size: 10px; color: var(--text-secondary); margin-top: 3px; }
            .tl-brief { padding: 7px 0; border-bottom: 1px dotted rgba(255,255,255,0.1); font-size: 12px; color: var(--text-secondary); }
            .tl-brief:last-child { border-bottom: none; }
            .tl-brief b { font-family: Georgia, 'Times New Roman', serif; color: var(--tl-paper); }
            .tl-issue-bar { display: flex; align-items: center; gap: 0; margin-top: 24px; padding-top: 12px; border-top: 3px double rgba(212,175,55,0.4); flex-wrap: wrap; }
            .tl-issue-bar button { font-family: var(--font-mono); font-size: 11px; letter-spacing: .06em; text-transform: uppercase; color: var(--tl-paper); background: none; border: none; border-right: 1px solid rgba(212,175,55,0.25); padding: 6px 14px; cursor: pointer; }
            .tl-issue-bar button:first-child { padding-left: 0; }
            .tl-issue-bar button:last-child { border-right: none; }
            .tl-issue-bar button:hover { color: var(--gold); }
            .tl-issue-bar button.primary { color: var(--gold); font-weight: 700; }
        `);
    }

    // ── shell ──
    function TimeLeagueMode({ onClose }) {
        const [index, setIndex] = useState([]);
        const [league, setLeague] = useState(null);
        const [tab, setTab] = useState('home');
        const [activeTeamId, setActiveTeamId] = useState('');
        const [cards, setCards] = useState(null);
        const [logIndex, setLogIndex] = useState(null);
        const [logsMissing, setLogsMissing] = useState(false);
        const [eraFactors, setEraFactors] = useState(null);
        const [booted, setBooted] = useState(false);

        useEffect(() => {
            const prefs = readUiPrefs();
            setIndex(readIndexEntries());
            if (prefs.leagueId) {
                const stored = readLeague(prefs.leagueId);
                if (stored) {
                    setLeague(stored);
                    setTab(prefs.tab);
                    if (prefs.teamId) setActiveTeamId(prefs.teamId);
                }
            }
            setBooted(true);
        }, []);

        useEffect(() => {
            let cancelled = false;
            fetchLogIndex().then((result) => { if (!cancelled) { if (result) setLogIndex(result); else setLogsMissing(true); } });
            fetchEraFactors().then((result) => { if (!cancelled) setEraFactors(result); });
            fetchCards().then((result) => { if (!cancelled) setCards(result); });
            return () => { cancelled = true; };
        }, []);

        useEffect(() => {
            if (!booted) return;
            writeUiPrefs({ leagueId: league?.leagueId ?? null, tab, teamId: activeTeamId });
        }, [booted, league, tab, activeTeamId]);

        const persistLeague = useCallback((state) => {
            writeLeague(state);
            setIndex((prev) => {
                const entry = indexEntryOf(state);
                const next = prev.some((item) => item.leagueId === state.leagueId)
                    ? prev.map((item) => (item.leagueId === state.leagueId ? entry : item))
                    : [...prev, entry];
                writeIndexEntries(next);
                return next;
            });
        }, []);

        const handleUpdate = useCallback((next) => {
            const safe = Engine.normalizeTimeLeague(next) ?? next;
            persistLeague(safe);
            setLeague(safe);
        }, [persistLeague]);

        const createLeague = useCallback((input) => {
            const createdAt = new Date().toISOString();
            const slug = input.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'time-league';
            const state = Engine.createTimeLeague({ name: input.name, seed: `${slug}:${createdAt}`, createdAt, settings: input.settings, seats: input.seats });
            persistLeague(state);
            setLeague(state);
            setTab('draft');
        }, [persistLeague]);

        const openLeague = useCallback((leagueId) => {
            const stored = readLeague(leagueId);
            if (!stored) return;
            setLeague(stored);
            setTab(stored.phase === 'draft' ? 'draft' : 'home');
        }, []);

        const deleteLeague = useCallback((leagueId) => {
            removeLeagueRecord(leagueId);
            setIndex((prev) => { const next = prev.filter((item) => item.leagueId !== leagueId); writeIndexEntries(next); return next; });
            setLeague((prev) => (prev?.leagueId === leagueId ? null : prev));
        }, []);

        const SetupPanel = window.WrTimeLeagueSetupPanel;
        const DraftPanel = window.WrTimeLeagueDraftPanel;
        const TeamPanel = window.WrTimeLeagueTeamPanel;
        const StandingsPanel = window.WrTimeLeagueStandingsPanel;
        const ActivityPanel = window.WrTimeLeagueActivityPanel;
        const GamecastPanel = window.WrTimeLeagueGamecastPanel;
        const HomePanel = window.WrTimeLeagueHomePanel;

        if (!league) {
            return h('div', { className: 'tl-root' },
                h(TimeLeagueStyles, null),
                h('div', { className: 'tl-header' },
                    h('div', { className: 'tl-header-title' }, h('strong', null, 'The Vault')),
                    h('button', { type: 'button', className: 'tl-btn', onClick: onClose }, '← BACK')),
                SetupPanel ? h(SetupPanel, { index, onOpen: openLeague, onDelete: deleteLeague, onCreate: createLeague }) : null);
        }

        const tabs = league.phase === 'draft'
            ? ['draft', 'activity']
            : ['home', 'gameday', 'roster', 'waivers', 'trades', 'standings', 'draft', 'activity'];
        const activeTab = tabs.includes(tab) ? tab : tabs[0];
        const activeTeam = league.teams.some((team) => team.teamId === activeTeamId)
            ? activeTeamId
            : (league.teams.find((team) => team.manager === 'human')?.teamId ?? league.teams[0]?.teamId ?? 't1');
        const phaseTone = league.phase === 'draft' ? 'warn' : league.phase === 'season' ? 'info' : 'gold';
        const cardsReady = cards !== null && cards.size > 0;
        const loadingNotice = cards === null
            ? h('div', { className: 'tl-card' }, h('p', { className: 'tl-empty' }, 'Loading player cards…'))
            : h('div', { className: 'tl-card' }, h('p', { className: 'tl-empty tl-pill bad' }, 'Player cards missing — check data/time-league/.'));

        return h('div', { className: 'tl-root' },
            h(TimeLeagueStyles, null),
            h('div', { className: 'tl-card tl-header' },
                h('div', null,
                    h('div', { className: 'tl-header-title' },
                        h('strong', null, league.name),
                        h('span', { className: `tl-pill ${phaseTone}` }, league.phase.toUpperCase())),
                    h(EraChipRail, { label: 'Era of Play', chips: EraRules.eraRuleChips(league.settings.eraRules) })),
                h('div', { className: 'tl-header-tools' },
                    league.phase !== 'draft' ? h('span', { className: 'tl-pill' }, `WK ${Math.min(league.currentWeek, league.settings.regularSeasonWeeks)}/${league.settings.regularSeasonWeeks}`) : null,
                    h('span', { className: 'tl-pill' }, `${league.teams.length} MGRS`),
                    h('button', { type: 'button', className: 'tl-btn', onClick: () => setLeague(null) }, 'SWITCH LEAGUE'),
                    h('button', { type: 'button', className: 'tl-btn', onClick: onClose }, '← DASHBOARD'))),
            h('nav', { className: 'tl-tabbar' },
                tabs.map((item) => h('button', {
                    key: item, type: 'button', className: `tl-tabbtn${item === activeTab ? ' active' : ''}`, onClick: () => setTab(item),
                }, item === 'draft' && league.phase !== 'draft' ? 'DRAFT RECAP' : TAB_LABELS[item]))),
            activeTab === 'home' && HomePanel ? h(HomePanel, { league, onNavigate: setTab }) : null,
            activeTab === 'draft' ? (cardsReady && DraftPanel ? h(DraftPanel, { league, cards, onUpdate: handleUpdate }) : loadingNotice) : null,
            activeTab === 'gameday' && GamecastPanel ? h(GamecastPanel, {
                league, cards, logIndex, logsMissing, eraFactors, onUpdate: handleUpdate, onGoRoster: () => setTab('roster'),
            }) : null,
            (activeTab === 'roster' || activeTab === 'waivers' || activeTab === 'trades')
                ? (cardsReady && TeamPanel
                    ? h(TeamPanel, { league, cards, section: activeTab, activeTeamId: activeTeam, onSelectTeam: setActiveTeamId, onUpdate: handleUpdate })
                    : loadingNotice)
                : null,
            activeTab === 'standings' && StandingsPanel ? h(StandingsPanel, { league }) : null,
            activeTab === 'activity' && ActivityPanel ? h(ActivityPanel, { league }) : null);
    }

    window.TimeLeague = TimeLeagueMode;
})();
