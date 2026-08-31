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
    const Remote = window.App.TimeLeagueRemote;

    const UI_PREFS_KEY = 'wr-time-league-ui-v1';
    const REGULAR_SEASON_WEEKS = 14;
    const MAX_QUARTERBACKS = 2;

    const TAB_IDS = ['home', 'draft', 'gameday', 'roster', 'waivers', 'trades', 'achievements', 'standings', 'activity'];
    const TAB_LABELS = {
        home: 'HOME', draft: 'DRAFT', gameday: 'GAMEDAY', roster: 'ROSTER', waivers: 'WAIVERS',
        trades: 'TRADES', achievements: 'ACHIEVEMENTS', standings: 'STANDINGS', activity: 'ACTIVITY',
    };

    const PERSONA_IDS = ['warlord', 'archivist', 'gambler', 'steward'];
    // Helmet defaults are deterministic per name (see time-league-helmet.js) so
    // the same roster of default seats always looks the same, not reshuffled
    // on every "Found a League" mount.
    const seatWithHelmet = (seat) => ({ ...seat, helmet: window.App.TimeLeagueHelmet.defaultHelmet(seat.name) });
    const defaultSeats = () => [
        seatWithHelmet({ name: 'Commander', manager: 'human', aiPersona: 'warlord' }),
        seatWithHelmet({ name: 'Warlord Kade', manager: 'ai', aiPersona: 'warlord' }),
        seatWithHelmet({ name: 'The Archivist', manager: 'ai', aiPersona: 'archivist' }),
        seatWithHelmet({ name: 'Riverboat Sol', manager: 'ai', aiPersona: 'gambler' }),
        seatWithHelmet({ name: 'Steward Vance', manager: 'ai', aiPersona: 'steward' }),
        seatWithHelmet({ name: 'Iron Ledger', manager: 'ai', aiPersona: 'archivist' }),
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
            return {
                leagueId: typeof raw?.leagueId === 'string' ? raw.leagueId : null, tab,
                teamId: typeof raw?.teamId === 'string' ? raw.teamId : '',
                onlineRowId: typeof raw?.onlineRowId === 'string' ? raw.onlineRowId : null,
            };
        } catch { return { leagueId: null, tab: 'home', teamId: '', onlineRowId: null }; }
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
            .tl-root .tabular { font-variant-numeric: tabular-nums; }
            .tl-lobby-wrap { max-width: 1180px; margin: 0 auto; }
            .tl-main-inner { max-width: 1180px; margin: 0 auto; }

            /* ── Left sidenav — mirrors js/league-detail.js's wr-sidebar: fixed
               column, gold left-border active state, collapses to a horizontal
               bar below the same 1023px breakpoint that file uses. ── */
            .tl-sidenav { position: fixed; left: 0; top: 0; bottom: 0; width: 176px; background: var(--black); border-right: 1px solid rgba(212,175,55,0.2); display: flex; flex-direction: column; padding: 16px 0; z-index: 100; overflow-y: auto; }
            .tl-sidenav-brand { padding: 0 20px 14px; margin-bottom: 8px; border-bottom: 1px solid rgba(255,255,255,0.06); }
            .tl-sidenav-brand strong { font-family: var(--font-title); font-weight: 700; font-size: 15px; letter-spacing: .04em; color: var(--gold); }
            .tl-sidenav .tl-tabbtn { width: 100%; min-height: 40px; padding: 9px 16px 9px 20px; border: none; border-left: 3px solid transparent; border-bottom: none; background: transparent; display: flex; align-items: center; justify-content: flex-start; text-align: left; color: var(--text-secondary); font-weight: 400; }
            .tl-sidenav .tl-tabbtn:hover { color: var(--white); background: rgba(255,255,255,0.03); }
            .tl-sidenav .tl-tabbtn.active { background: rgba(212,175,55,0.12); border-left-color: var(--gold); color: var(--gold); font-weight: 700; }
            .tl-main { padding: 28px 20px 80px; }
            @media (min-width: 1024px) { .tl-main { margin-left: 176px; } }
            @media (max-width: 1023px) {
                .tl-sidenav { position: static; width: 100%; height: auto; flex-direction: row; overflow-x: auto; overflow-y: visible; border-right: none; border-bottom: 1px solid rgba(212,175,55,0.2); padding: 0; margin-bottom: 18px; }
                .tl-sidenav-brand { display: none; }
                .tl-sidenav .tl-tabbtn { width: auto; min-height: auto; white-space: nowrap; border-left: none; border-bottom: 2px solid transparent; padding: 12px 16px; }
                .tl-sidenav .tl-tabbtn.active { border-left-color: transparent; border-bottom-color: var(--gold); }
                .tl-main { margin-left: 0; padding-top: 0; }
            }
            .tl-card { background: var(--black); border: 1px solid rgba(212,175,55,0.18); border-radius: var(--card-radius, 10px); padding: 14px 16px; }
            .tl-card + .tl-card { margin-top: 14px; }
            .tl-card-title { font-family: var(--font-title); font-weight: 600; font-size: 13.5px; letter-spacing: .04em; text-transform: uppercase; color: var(--text-secondary); margin-bottom: 12px; display: flex; align-items: center; justify-content: space-between; gap: 10px; }
            .tl-card-title small { font-family: var(--font-mono); font-weight: 500; font-size: 11px; color: var(--text-muted); text-transform: none; letter-spacing: 0; }
            .tl-label { font-family: var(--font-mono); font-size: var(--text-label, 0.75rem); letter-spacing: .08em; text-transform: uppercase; color: var(--text-muted); }
            .tl-pill { display: inline-flex; align-items: center; gap: 4px; font-family: var(--font-mono); font-size: var(--text-label, 0.75rem); font-weight: 700; letter-spacing: .05em; text-transform: uppercase; padding: 2px 8px; border-radius: 100px; background: rgba(255,255,255,0.06); color: var(--text-secondary); }
            .tl-pill.gold { background: rgba(212,175,55,0.14); color: var(--gold); }
            .tl-pill.info { background: rgba(93,173,226,0.14); color: var(--info); }
            .tl-pill.warn { background: rgba(240,165,0,0.14); color: var(--warn); }
            .tl-pill.good { background: rgba(46,204,113,0.14); color: var(--good); }
            .tl-pill.bad { background: rgba(231,76,60,0.14); color: var(--bad); }
            .tl-grid-2 { display: grid; grid-template-columns: 1.3fr 1fr; gap: 16px; align-items: start; }
            .tl-grid-2.even { grid-template-columns: 1fr 1fr; }
            @media (max-width: 900px) { .tl-grid-2, .tl-grid-2.even { grid-template-columns: 1fr; } }
            .tl-btn { font-family: var(--font-mono); font-size: 11px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; padding: 7px 13px; border-radius: var(--card-radius-sm, 8px); background: rgba(255,255,255,0.04); color: var(--text-secondary); border: 1px solid rgba(255,255,255,0.1); cursor: pointer; display: inline-flex; align-items: center; gap: 6px; }
            .tl-btn:hover:not(:disabled) { border-color: rgba(212,175,55,0.4); color: var(--white); }
            .tl-btn:disabled { opacity: .4; cursor: default; }
            .tl-btn.primary { background: var(--gold); color: var(--page-bg); border: none; }
            .tl-btn.primary:hover:not(:disabled) { background: var(--dark-gold); }
            .tl-btn.danger { border-color: rgba(231,76,60,0.4); color: var(--bad); }
            .tl-btn.icon { padding: 6px 8px; }
            .tl-input, .tl-select { font-family: var(--font-body); font-size: 13px; padding: 7px 10px; border-radius: var(--card-radius-sm, 8px); background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.1); color: var(--white); width: 100%; }
            .tl-input:focus, .tl-select:focus { outline: none; border-color: var(--gold); }
            .tl-field { display: flex; flex-direction: column; gap: 6px; margin-bottom: 16px; }
            .tl-field:last-child { margin-bottom: 0; }
            .tl-hint { font-size: 11.5px; color: var(--text-muted); margin: 0; }
            .tl-chip-row { display: flex; flex-wrap: wrap; gap: 7px; }
            .tl-opt-chip { font-size: 12px; padding: 6px 12px; border-radius: var(--card-radius-sm, 8px); border: 1px solid rgba(255,255,255,0.09); background: rgba(255,255,255,0.02); color: var(--text-secondary); cursor: pointer; text-align: left; }
            .tl-opt-chip.selected { border-color: var(--gold); background: rgba(212,175,55,0.1); color: var(--gold); font-weight: 600; }
            .tl-opt-detail { display: block; font-family: var(--font-mono); font-size: var(--text-label, 0.75rem); color: var(--text-faint, rgba(189,184,173,0.5)); margin-top: 2px; }
            .tl-seat-row { display: grid; grid-template-columns: 28px 36px 1fr 90px 130px 28px; align-items: center; gap: 8px; padding: 7px 0; border-bottom: 1px solid rgba(255,255,255,0.04); }
            .tl-seat-row:last-child { border-bottom: none; }
            .tl-helmet-picker { position: relative; display: inline-flex; }
            .tl-helmet-editor { position: absolute; top: 100%; left: 0; z-index: 20; margin-top: 4px; padding: 9px; background: var(--co-page, #0c0c10); border: 1px solid rgba(255,255,255,0.14); border-radius: var(--card-radius-sm, 8px); box-shadow: 0 10px 28px rgba(0,0,0,0.55); display: flex; flex-direction: column; gap: 8px; width: 190px; }
            .tl-helmet-swatches { display: flex; flex-wrap: wrap; gap: 4px; }
            .tl-helmet-swatch { width: 18px; height: 18px; border-radius: var(--card-radius-xs, 5px); border: 2px solid transparent; cursor: pointer; padding: 0; }
            .tl-helmet-swatch.selected { border-color: var(--gold); }
            .tl-helmet-swatch.small { width: 14px; height: 14px; border-radius: 50%; }
            .tl-helmet-row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
            .tl-helmet-stripe-toggle { display: flex; align-items: center; gap: 4px; font-size: 11px; color: var(--text-secondary); white-space: nowrap; }
            .tl-toggle { display: flex; align-items: flex-start; gap: 10px; padding: 10px 0; cursor: pointer; }
            .tl-tbl { width: 100%; border-collapse: collapse; font-size: 12.5px; }
            .tl-tbl th { text-align: left; font-family: var(--font-mono); font-size: var(--text-label, 0.75rem); letter-spacing: .06em; text-transform: uppercase; color: var(--text-muted); padding: 6px 8px; border-bottom: 1px solid var(--charcoal); font-weight: 500; }
            .tl-tbl td { padding: 8px; border-bottom: 1px solid rgba(255,255,255,0.04); vertical-align: middle; }
            .tl-tbl tr:last-child td { border-bottom: none; }
            .tl-tbl td.num, .tl-tbl th.num { text-align: right; }
            .tl-tbl tr.selected td { background: rgba(212,175,55,0.06); }
            .tl-tbl tr.clickable { cursor: pointer; }
            .tl-tbl tr.clickable:hover td { background: rgba(255,255,255,0.02); }
            .tl-empty { font-size: 12.5px; color: var(--text-muted); padding: 10px 2px; margin: 0; }
            .tl-feedrow { display: flex; gap: 10px; padding: 8px 2px; border-bottom: 1px solid rgba(255,255,255,0.04); font-size: 12px; }
            .tl-feedrow:last-child { border-bottom: none; }
            .tl-feedrow time { font-family: var(--font-mono); font-size: var(--text-label, 0.75rem); color: var(--text-muted); flex: none; padding-top: 1px; white-space: nowrap; }
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
            .tl-pos-badge { font-family: var(--font-mono); font-size: var(--text-label, 0.75rem); font-weight: 700; padding: 2px 6px; border-radius: var(--card-radius-xs, 5px); }
            .tl-pos-QB { background: rgba(96,165,250,0.16); color: #60a5fa; }
            .tl-pos-RB { background: rgba(46,204,113,0.16); color: var(--good); }
            .tl-pos-WR { background: rgba(212,175,55,0.18); color: var(--gold); }
            .tl-pos-TE { background: rgba(251,191,36,0.16); color: #fbbf24; }
            .tl-pos-K  { background: rgba(168,172,184,0.16); color: #a8acb8; }
            .tl-pos-DEF, .tl-pos-DL, .tl-pos-LB, .tl-pos-DB { background: rgba(248,113,113,0.16); color: #f87171; }

            /* ── Avatars ── */
            .tl-avatar { width: 32px; height: 32px; border-radius: 50%; display: inline-grid; place-items: center; flex: none; font-family: var(--font-title); font-weight: 700; font-size: 12px; color: var(--page-bg, #08080B); }
            .tl-avatar.sm { width: 22px; height: 22px; font-size: var(--text-label, 0.75rem); }
            .tl-avatar.lg { width: 56px; height: 56px; font-size: 20px; border: 2px solid rgba(255,255,255,0.15); }

            /* ── Player tile — era-coded, replaces table rows in Roster/Waivers ── */
            .tl-tile-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; }
            @media (max-width: 700px) { .tl-tile-grid { grid-template-columns: 1fr; } }
            .tl-player-tile { display: flex; align-items: center; gap: 12px; background: var(--off-black); border: 1px solid rgba(255,255,255,0.06); border-radius: var(--card-radius, 10px); padding: 10px 12px; position: relative; overflow: hidden; }
            .tl-player-tile::before { content: ''; position: absolute; inset: 0; opacity: .10; background: radial-gradient(circle at 100% 0%, var(--era-color, var(--gold)), transparent 65%); pointer-events: none; }
            .tl-era-badge { width: 40px; height: 40px; border-radius: var(--card-radius, 10px); display: grid; place-items: center; flex: none; font-size: 17px; border: 2px solid var(--era-color, var(--gold)); background: color-mix(in srgb, var(--era-color, var(--gold)) 16%, var(--black)); box-shadow: 0 0 12px -2px var(--era-color, var(--gold)); }
            .tl-player-tile .tl-p-body { flex: 1; min-width: 0; }
            .tl-player-tile .tl-p-name { font-weight: 700; font-size: 13px; }
            .tl-player-tile .tl-p-meta { display: flex; align-items: center; gap: 6px; margin-top: 3px; }
            .tl-player-tile .tl-p-era { font-family: var(--font-mono); font-size: var(--text-label, 0.75rem); color: var(--era-color, var(--text-muted)); font-weight: 700; }
            .tl-player-tile .tl-p-pts { font-family: var(--font-title); font-weight: 700; font-size: 19px; color: var(--gold); flex: none; text-align: right; }
            .tl-player-tile .tl-p-pts small { display: block; font-family: var(--font-mono); font-weight: 400; font-size: var(--text-label, 0.75rem); color: var(--text-muted); }
            .tl-top-pick-badge { font-family: var(--font-mono); font-size: var(--text-label, 0.75rem); font-weight: 700; color: var(--gold); background: rgba(212,175,55,0.14); border-radius: var(--card-radius-xs, 5px); padding: 1px 5px; margin-left: 6px; }

            /* ── League Home ── */
            .tl-home-hero { background: linear-gradient(135deg, rgba(212,175,55,0.10), transparent 55%), var(--black); border: 1px solid rgba(212,175,55,0.18); border-radius: var(--card-radius-lg, 14px); padding: 20px 22px; margin-bottom: 16px; }
            .tl-home-hero-top { display: flex; align-items: center; gap: 16px; }
            .tl-home-hero-top .tl-h-info { flex: 1; }
            .tl-home-hero-top .tl-h-league { font-family: var(--font-title); font-weight: 700; font-size: 20px; }
            .tl-home-hero-top .tl-h-sub { font-size: 12.5px; color: var(--text-secondary); margin-top: 2px; }
            .tl-mini-matchup { display: flex; align-items: center; justify-content: space-between; margin-top: 18px; padding-top: 16px; border-top: 1px solid var(--charcoal); }
            .tl-mini-matchup .tl-mm-side { display: flex; align-items: center; gap: 10px; }
            .tl-mini-matchup .tl-mm-pts { font-family: var(--font-title); font-weight: 700; font-size: 24px; }
            .tl-mini-matchup .tl-mm-vs { font-family: var(--font-mono); font-size: var(--text-label, 0.75rem); color: var(--text-faint, rgba(189,184,173,0.5)); text-align: center; }
            .tl-quick-actions { display: flex; gap: 8px; margin-top: 16px; flex-wrap: wrap; }
            .tl-home-row { display: flex; align-items: center; gap: 10px; padding: 8px 0; border-bottom: 1px solid rgba(255,255,255,0.04); font-size: 12.5px; }
            .tl-home-row:last-child { border-bottom: none; }

            /* ── Scoreboard strip + hero matchup (Gameday) ── */
            .tl-scoreboard-strip { display: flex; gap: 10px; overflow-x: auto; padding-bottom: 4px; margin-bottom: 16px; }
            .tl-score-chip { flex: none; min-width: 180px; background: var(--black); border: 1px solid rgba(212,175,55,0.18); border-radius: var(--card-radius, 10px); padding: 10px 12px; }
            .tl-score-chip.mine { border-color: var(--gold); background: linear-gradient(135deg, rgba(212,175,55,0.08), transparent); }
            .tl-score-chip .tl-sc-tag { font-family: var(--font-mono); font-size: var(--text-label, 0.75rem); letter-spacing: .08em; color: var(--text-muted); display: flex; align-items: center; gap: 4px; margin-bottom: 6px; }
            .tl-sc-dot { width: 5px; height: 5px; border-radius: 50%; background: var(--bad); animation: tlPulse 1.4s infinite; }
            .tl-sc-row { display: flex; align-items: center; justify-content: space-between; padding: 2px 0; gap: 8px; }
            .tl-sc-row .tl-sc-team { display: flex; align-items: center; gap: 6px; font-size: 12px; min-width: 0; }
            .tl-sc-row .tl-sc-team span:last-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
            .tl-sc-row.winning .tl-sc-team { color: var(--white); font-weight: 700; }
            .tl-sc-row:not(.winning) .tl-sc-team { color: var(--text-muted); }
            .tl-sc-row .tl-sc-pts { font-family: var(--font-mono); font-size: 13px; flex: none; }
            @keyframes tlPulse { 0%,100% { opacity: 1; } 50% { opacity: .25; } }
            .tl-hero-matchup { background: var(--black); border: 1px solid rgba(212,175,55,0.18); border-radius: var(--card-radius-lg, 14px); padding: 20px 24px; margin-bottom: 16px; }
            .tl-hero-top { display: flex; align-items: center; justify-content: center; gap: 24px; }
            .tl-hero-side { text-align: center; flex: 1; min-width: 0; }
            .tl-hero-side .tl-h-name { font-size: 13px; color: var(--text-secondary); margin-top: 8px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
            .tl-hero-side .tl-h-name.leading { color: var(--white); font-weight: 700; }
            .tl-hero-side .tl-h-pts { font-family: var(--font-title); font-weight: 700; font-size: 38px; line-height: 1; margin-top: 4px; }
            .tl-hero-side .tl-h-pts.leading { color: var(--gold); }
            .tl-hero-mid { text-align: center; flex: none; width: 80px; }
            .tl-hero-mid .tl-h-vs { font-family: var(--font-mono); font-size: var(--text-label, 0.75rem); color: var(--text-faint, rgba(189,184,173,0.5)); letter-spacing: .1em; }
            .tl-hero-mid .tl-h-clock { font-family: var(--font-mono); font-size: 11.5px; color: var(--gold); margin-top: 6px; }
            .tl-score-bar { height: 6px; border-radius: 100px; background: rgba(255,255,255,0.08); overflow: hidden; margin: 18px 0 4px; display: flex; }
            .tl-score-bar .tl-fill { background: var(--gold); }
            .tl-score-bar .tl-fill.against { background: var(--charcoal); }
            .tl-win-prob { display: flex; justify-content: space-between; font-family: var(--font-mono); font-size: var(--text-label, 0.75rem); color: var(--text-muted); margin-bottom: 4px; }

            /* ── Draft: pick clock + queue strip ── */
            .tl-clock-ring { width: 30px; height: 30px; border-radius: 50%; border: 3px solid rgba(212,175,55,0.25); border-top-color: var(--gold); flex: none; animation: tlSpin 3s linear infinite; }
            @keyframes tlSpin { to { transform: rotate(360deg); } }
            .tl-queue-strip { display: flex; gap: 8px; overflow-x: auto; padding: 2px 0 4px; }
            .tl-queue-chip { flex: none; display: flex; align-items: center; gap: 6px; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); border-radius: 100px; padding: 5px 10px 5px 5px; font-size: 11.5px; cursor: pointer; }
            .tl-queue-chip .tl-qnum { width: 16px; height: 16px; border-radius: 50%; background: var(--gold); color: var(--page-bg, #08080B); font-family: var(--font-mono); font-size: var(--text-label, 0.75rem); font-weight: 700; display: grid; place-items: center; flex: none; }

            /* ── Trades: fairness scale ── */
            /* ── Trade fairness — mirrors War Room's real trade-engine.js
               fairnessGrade tile (A+ Steal .. F Bad Trade) plus the per-player
               value bar from trade-calculator.html's ta-val-bar-fill, instead
               of the plain +/- swing number this used to show. ── */
            .tl-fairness-grade { display: flex; align-items: center; gap: 14px; padding: 12px 16px; border-radius: var(--card-radius, 10px); border: 1px solid rgba(212,175,55,0.25); background: rgba(255,255,255,0.02); margin: 10px 0; }
            .tl-fairness-grade .fg-letter { font-family: var(--font-title); font-weight: 700; font-size: 34px; line-height: 1; flex: none; width: 60px; text-align: center; }
            .tl-fairness-grade .fg-letter.good { color: var(--good); }
            .tl-fairness-grade .fg-letter.gold { color: var(--gold); }
            .tl-fairness-grade .fg-letter.warn { color: var(--warn); }
            .tl-fairness-grade .fg-letter.bad { color: var(--bad); }
            .tl-fairness-grade .fg-label { font-family: var(--font-title); font-weight: 700; font-size: 14px; }
            .tl-fairness-grade .fg-sub { font-family: var(--font-mono); font-size: var(--text-label, 0.75rem); color: var(--text-muted); margin-top: 2px; }
            .tl-val-bar { height: 4px; border-radius: 100px; background: rgba(255,255,255,0.08); overflow: hidden; margin-top: 5px; }
            .tl-val-bar-fill { height: 100%; border-radius: 100px; }

            /* ── Achievements — mirrors War Room's real achievements.js chip-grid
               pattern (js/tabs/trophy-room.js renderAchievementsCard): tier-tinted
               border + full-opacity icon when earned, greyscale + dim + a thin
               progress bar when not, grouped under a tier label. ── */
            .tl-badge-tier-label { font-family: var(--font-mono); font-size: var(--text-label, 0.75rem); letter-spacing: .12em; text-transform: uppercase; color: var(--text-muted); margin: 18px 0 8px; }
            .tl-badge-tier-label:first-child { margin-top: 0; }
            .tl-badge-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 10px; }
            .tl-badge-chip { display: flex; align-items: center; gap: 10px; padding: 10px 12px; border-radius: var(--card-radius, 10px); border: 1px solid rgba(255,255,255,0.08); background: rgba(255,255,255,0.02); }
            .tl-badge-chip.earned { border-color: var(--tier-color, var(--gold)); background: color-mix(in srgb, var(--tier-color, var(--gold)) 10%, transparent); }
            .tl-badge-chip .tl-badge-icon { font-size: 21px; flex: none; width: 32px; text-align: center; filter: grayscale(1); opacity: .5; }
            .tl-badge-chip.earned .tl-badge-icon { filter: none; opacity: 1; }
            .tl-badge-chip .tl-badge-body { flex: 1; min-width: 0; }
            .tl-badge-chip .tl-badge-label { font-weight: 700; font-size: 12.5px; display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
            .tl-badge-chip .tl-badge-desc { font-size: var(--text-label, 0.75rem); color: var(--text-muted); margin-top: 2px; }
            .tl-badge-chip .tl-badge-progress { height: 3px; border-radius: 100px; background: rgba(255,255,255,0.08); overflow: hidden; margin-top: 6px; }
            .tl-badge-chip .tl-badge-progress-fill { height: 100%; background: var(--tier-color, var(--gold)); }

            /* ── Standings streaks ── */
            .tl-streak { font-family: var(--font-mono); font-size: var(--text-label, 0.75rem); font-weight: 700; padding: 2px 6px; border-radius: var(--card-radius-xs, 5px); }
            .tl-streak.W { background: rgba(46,204,113,0.14); color: var(--good); }
            .tl-streak.L { background: rgba(231,76,60,0.14); color: var(--bad); }
            .tl-streak.T { background: rgba(255,255,255,0.08); color: var(--text-secondary); }

            /* ── Roster Central — mirrors War Room's real Game Day Central
               (js/tabs/lineup.js): a gold-bordered status hero above a unified
               CSS-grid lineup table, in place of Game Day's Slot/Player/Proj/
               Mtch/Form/Hi/Lo columns (which don't apply to fixed historical
               stat lines — no weekly projection uncertainty to show). ── */
            .tl-lineup-hero { background: var(--black); border: 1px solid rgba(212,175,55,0.35); border-radius: var(--card-radius, 10px); padding: 16px 18px; margin-bottom: 14px; }
            .tl-lineup-hero .lh-kicker { font-family: var(--font-mono); font-size: var(--text-label, 0.75rem); letter-spacing: .12em; text-transform: uppercase; color: var(--gold); margin-bottom: 6px; }
            .tl-lineup-hero .lh-headline { font-family: var(--font-title); font-weight: 700; font-size: 19px; margin-bottom: 4px; color: var(--white); }
            .tl-lineup-hero .lh-headline.good { color: var(--good); }
            .tl-lineup-hero .lh-headline.warn { color: var(--warn); }
            .tl-lineup-hero .lh-sub { font-size: 12px; color: var(--text-secondary); margin-bottom: 12px; }
            .tl-lineup-table { border: 1px solid rgba(255,255,255,0.08); border-radius: var(--card-radius, 10px); overflow: hidden; margin-bottom: 14px; }
            .tl-lineup-table-title { font-family: var(--font-mono); font-size: var(--text-label, 0.75rem); letter-spacing: .1em; text-transform: uppercase; color: var(--text-muted); padding: 10px 14px; background: rgba(255,255,255,0.02); border-bottom: 1px solid rgba(255,255,255,0.06); }
            .tl-lineup-head { display: grid; padding: 6px 14px; font-family: var(--font-mono); font-size: var(--text-label, 0.75rem); letter-spacing: .06em; text-transform: uppercase; color: var(--text-muted); border-bottom: 1px solid rgba(255,255,255,0.06); }
            .tl-lineup-row { display: grid; align-items: center; gap: 8px; padding: 9px 14px; border-bottom: 1px solid rgba(255,255,255,0.04); }
            .tl-lineup-row:last-child { border-bottom: none; }
            .tl-lineup-row.open-slot { color: var(--text-faint, rgba(189,184,173,0.5)); font-size: 12px; font-style: italic; }
            .tl-lineup-slot { font-family: var(--font-mono); font-weight: 700; font-size: 11px; color: var(--gold); }
            .tl-lineup-player { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
            .tl-lineup-player .name { font-weight: 600; font-size: 12.5px; }
            .tl-lineup-player .meta { color: var(--text-muted); font-size: var(--text-label, 0.75rem); margin-left: 6px; font-family: var(--font-mono); }
            .tl-lineup-pts { text-align: right; font-family: var(--font-title); font-weight: 700; font-size: 16px; color: var(--gold); }
            .tl-lineup-pts small { display: block; font-family: var(--font-mono); font-weight: 400; font-size: var(--text-label, 0.75rem); color: var(--text-muted); letter-spacing: .04em; }

            /* ── Gazette (Home tab newspaper front page) — dark "midnight edition":
               the rest of the mode stays dark, so this is a front page printed on
               dark stock rather than a light page dropped into a dark app. Serif is
               Georgia/Times — no new font dependency to load. */
            .tl-gazette { --tl-paper: #EDE6D3; }
            .tl-masthead { text-align: center; padding: 4px 0 12px; }
            .tl-masthead .tl-kicker { font-family: var(--font-mono); font-size: var(--text-label, 0.75rem); letter-spacing: .25em; color: var(--gold); text-transform: uppercase; }
            .tl-masthead .tl-name { font-family: Georgia, 'Times New Roman', serif; font-weight: 700; font-size: 38px; letter-spacing: .01em; margin: 4px 0 2px; color: var(--tl-paper); }
            .tl-masthead .tl-name em { font-style: italic; color: var(--gold); }
            .tl-masthead .tl-dateline { display: flex; align-items: center; justify-content: center; gap: 10px; font-family: var(--font-mono); font-size: var(--text-label, 0.75rem); color: var(--text-muted); text-transform: uppercase; letter-spacing: .06em; flex-wrap: wrap; }
            .tl-gazette-rule { height: 3px; background: var(--gold); margin: 8px 0 3px; }
            .tl-gazette-rule.thin { height: 1px; background: rgba(212,175,55,0.35); margin: 3px 0 18px; }
            .tl-gazette-grid { display: grid; grid-template-columns: 1.4fr 1fr; gap: 24px; }
            @media (max-width: 860px) { .tl-gazette-grid { grid-template-columns: 1fr; } }
            .tl-col-rule { border-right: 1px solid rgba(212,175,55,0.2); padding-right: 24px; }
            @media (max-width: 860px) { .tl-col-rule { border-right: none; padding-right: 0; } }
            .tl-section-label { font-family: var(--font-mono); font-size: var(--text-label, 0.75rem); letter-spacing: .16em; text-transform: uppercase; color: var(--gold); border-bottom: 1px solid rgba(212,175,55,0.3); padding-bottom: 4px; margin-bottom: 10px; }
            .tl-gaz-headline { font-family: Georgia, 'Times New Roman', serif; font-weight: 700; font-size: 24px; line-height: 1.15; color: var(--tl-paper); margin-bottom: 8px; }
            .tl-gaz-byline { font-family: var(--font-mono); font-size: var(--text-label, 0.75rem); letter-spacing: .08em; color: var(--text-muted); text-transform: uppercase; margin-bottom: 12px; }
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
            .tl-gazette-kpi { border: 1px solid rgba(212,175,55,0.18); border-radius: var(--card-radius-xs, 5px); padding: 9px 11px; }
            .tl-gazette-kpi .k-label { font-family: var(--font-mono); font-size: var(--text-label, 0.75rem); letter-spacing: .08em; text-transform: uppercase; color: var(--text-muted); margin-bottom: 4px; }
            .tl-gazette-kpi .k-value { font-family: Georgia, 'Times New Roman', serif; font-weight: 700; font-size: 21px; color: var(--gold); line-height: 1; }
            .tl-gazette-kpi .k-sub { font-family: var(--font-mono); font-size: var(--text-label, 0.75rem); color: var(--text-secondary); margin-top: 3px; }
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
    function TimeLeagueMode({ onClose, pendingInvite, onInviteConsumed }) {
        const [index, setIndex] = useState([]);
        const [league, setLeague] = useState(null);
        const [tab, setTab] = useState('home');
        const [activeTeamId, setActiveTeamId] = useState('');
        const [cards, setCards] = useState(null);
        const [logIndex, setLogIndex] = useState(null);
        const [logsMissing, setLogsMissing] = useState(false);
        const [eraFactors, setEraFactors] = useState(null);
        const [booted, setBooted] = useState(false);
        // Online bookkeeping deliberately lives OUTSIDE `league` — Engine.normalizeTimeLeague()
        // rebuilds `league` from an explicit key allowlist on every handleUpdate, so anything
        // attached to the league object itself would be silently stripped on the very next update.
        const [onlineMeta, setOnlineMeta] = useState(null); // null = local league, else {rowId, version, role}
        const [onlineIndex, setOnlineIndex] = useState([]);
        const [onlineIndexState, setOnlineIndexState] = useState('idle'); // idle | signed-out | ready
        const [conflictNotice, setConflictNotice] = useState(null);
        const [claimingInvite, setClaimingInvite] = useState(false);
        const [inviteError, setInviteError] = useState(null);

        const refreshOnlineIndex = useCallback(() => {
            if (!Remote) return;
            if (!(window.App.OD && window.App.OD.getCurrentUserId && window.App.OD.getCurrentUserId())) {
                setOnlineIndex([]); setOnlineIndexState('signed-out'); return;
            }
            Remote.listMyOnlineLeagues().then((rows) => { setOnlineIndex(rows); setOnlineIndexState('ready'); });
        }, []);

        useEffect(() => {
            const prefs = readUiPrefs();
            setIndex(readIndexEntries());
            refreshOnlineIndex();
            if (prefs.onlineRowId && Remote) {
                Remote.loadOnlineLeague(prefs.onlineRowId).then((row) => {
                    const safe = row && Engine.normalizeTimeLeague(row.state);
                    if (!safe) { setBooted(true); return; }
                    setLeague(safe);
                    setOnlineMeta({ rowId: row.id, version: row.version });
                    setTab(prefs.tab);
                    if (prefs.teamId) setActiveTeamId(prefs.teamId);
                    setBooted(true);
                });
                return;
            }
            if (prefs.leagueId) {
                const stored = readLeague(prefs.leagueId);
                if (stored) {
                    setLeague(stored);
                    setTab(prefs.tab);
                    if (prefs.teamId) setActiveTeamId(prefs.teamId);
                }
            }
            setBooted(true);
        }, [refreshOnlineIndex]);

        // Consumes a ?tl_invite link once — app.js only opens the Vault this way once a
        // real account session already exists, but this checks again in case someone
        // mounts this component directly with a code and no session (defensive, not load-bearing).
        useEffect(() => {
            if (!pendingInvite || !Remote) return;
            if (!(window.App.OD && window.App.OD.getCurrentUserId && window.App.OD.getCurrentUserId())) return;
            setClaimingInvite(true);
            Remote.claimInvite(pendingInvite).then((result) => {
                setClaimingInvite(false);
                if (onInviteConsumed) onInviteConsumed();
                if (!result.ok) { setInviteError(result.error || 'That invite link no longer works — ask your commissioner for a fresh one.'); return; }
                Remote.loadOnlineLeague(result.rowId).then((row) => {
                    const safe = row && Engine.normalizeTimeLeague(row.state);
                    if (!safe) return;
                    setLeague(safe);
                    setOnlineMeta({ rowId: row.id, version: row.version });
                    setTab(safe.phase === 'draft' ? 'draft' : 'home');
                    refreshOnlineIndex();
                });
            });
        }, [pendingInvite]);

        useEffect(() => {
            let cancelled = false;
            fetchLogIndex().then((result) => { if (!cancelled) { if (result) setLogIndex(result); else setLogsMissing(true); } });
            fetchEraFactors().then((result) => { if (!cancelled) setEraFactors(result); });
            fetchCards().then((result) => { if (!cancelled) setCards(result); });
            return () => { cancelled = true; };
        }, []);

        useEffect(() => {
            if (!booted) return;
            writeUiPrefs({ leagueId: league?.leagueId ?? null, tab, teamId: activeTeamId, onlineRowId: onlineMeta?.rowId ?? null });
        }, [booted, league, tab, activeTeamId, onlineMeta]);

        // Live sync: another member's write lands here without a refresh. Keyed on the row id
        // (not the whole onlineMeta object, which changes identity on every version bump) so a
        // write from THIS tab doesn't tear down and resubscribe the channel every time.
        useEffect(() => {
            if (!onlineMeta?.rowId || !Remote) return undefined;
            const unsubscribe = Remote.subscribeToLeague(onlineMeta.rowId, (row) => {
                const safe = Engine.normalizeTimeLeague(row.state);
                if (!safe) return;
                setLeague(safe);
                setOnlineMeta((prev) => (prev?.rowId === row.id ? { ...prev, version: row.version } : prev));
            });
            return unsubscribe;
        }, [onlineMeta?.rowId]);

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
            if (onlineMeta) {
                setLeague(safe); // optimistic — instant feedback while the write is in flight
                Remote.writeOnlineLeague(onlineMeta.rowId, safe, onlineMeta.version).then((result) => {
                    if (result.ok) {
                        setOnlineMeta((prev) => (prev?.rowId === onlineMeta.rowId ? { ...prev, version: result.version } : prev));
                        return;
                    }
                    if (result.conflict) {
                        setConflictNotice('Someone else acted first — reloading the latest state.');
                        Remote.loadOnlineLeague(onlineMeta.rowId).then((row) => {
                            const latest = row && Engine.normalizeTimeLeague(row.state);
                            if (!latest) return;
                            setLeague(latest);
                            setOnlineMeta((prev) => (prev?.rowId === onlineMeta.rowId ? { ...prev, version: row.version } : prev));
                        });
                    } else {
                        setConflictNotice('Could not save — check your connection and try again.');
                    }
                });
                return;
            }
            persistLeague(safe);
            setLeague(safe);
        }, [persistLeague, onlineMeta]);

        const createLeague = useCallback((input) => {
            const createdAt = new Date().toISOString();
            const slug = input.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'time-league';
            const state = Engine.createTimeLeague({ name: input.name, seed: `${slug}:${createdAt}`, createdAt, settings: input.settings, seats: input.seats });
            persistLeague(state);
            setLeague(state);
            setOnlineMeta(null);
            setTab('draft');
        }, [persistLeague]);

        const createOnlineLeague = useCallback(async (input) => {
            if (!Remote) return { ok: false, error: 'not_configured' };
            const createdAt = new Date().toISOString();
            const slug = input.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'time-league';
            const state = Engine.createTimeLeague({ name: input.name, seed: `${slug}:${createdAt}`, createdAt, settings: input.settings, seats: input.seats });
            const result = await Remote.createOnlineLeague({ state, seats: input.seats });
            if (!result.ok) return result;
            // Deliberately does NOT set `league`/`tab` here — the caller (Found a League)
            // shows an invite-links screen first and enters the league via onOpenOnline once
            // the founder is done sharing invites, rather than yanking them straight to the draft.
            refreshOnlineIndex();
            return result;
        }, [refreshOnlineIndex]);

        const openLeague = useCallback((leagueId) => {
            const stored = readLeague(leagueId);
            if (!stored) return;
            setOnlineMeta(null);
            setLeague(stored);
            setTab(stored.phase === 'draft' ? 'draft' : 'home');
        }, []);

        const openOnlineLeague = useCallback((rowId) => {
            if (!Remote) return;
            Remote.loadOnlineLeague(rowId).then((row) => {
                const safe = row && Engine.normalizeTimeLeague(row.state);
                if (!safe) return;
                setLeague(safe);
                setOnlineMeta({ rowId: row.id, version: row.version });
                setTab(safe.phase === 'draft' ? 'draft' : 'home');
            });
        }, []);

        const switchLeague = useCallback(() => {
            setLeague(null);
            setOnlineMeta(null);
            setConflictNotice(null);
            refreshOnlineIndex();
        }, [refreshOnlineIndex]);

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
                h('div', { className: 'tl-lobby-wrap' },
                    h('div', { className: 'tl-header' },
                        h('div', { className: 'tl-header-title' }, h('strong', null, 'The Vault')),
                        h('button', { type: 'button', className: 'tl-btn', onClick: onClose }, '← BACK')),
                    claimingInvite && h('div', { className: 'tl-card', style: { marginBottom: 14 } }, h('p', { className: 'tl-empty' }, 'Claiming your invite…')),
                    inviteError && h('div', { className: 'tl-card', style: { borderColor: 'rgba(240,165,0,0.4)', marginBottom: 14 } },
                        h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 } },
                            h('span', { style: { fontSize: 12.5, color: 'var(--warn)' } }, `⚠ ${inviteError}`),
                            h('button', { type: 'button', className: 'tl-btn icon', onClick: () => setInviteError(null) }, '✕'))),
                    SetupPanel ? h(SetupPanel, {
                        index, onOpen: openLeague, onDelete: deleteLeague, onCreate: createLeague,
                        onlineIndex, onlineIndexState, onOpenOnline: openOnlineLeague, onCreateOnline: createOnlineLeague,
                    }) : null));
        }

        const tabs = league.phase === 'draft'
            ? ['draft', 'activity']
            : ['home', 'gameday', 'roster', 'waivers', 'trades', 'achievements', 'standings', 'draft', 'activity'];
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
            h('nav', { className: 'tl-sidenav' },
                h('div', { className: 'tl-sidenav-brand' }, h('strong', null, 'THE VAULT')),
                tabs.map((item) => h('button', {
                    key: item, type: 'button', className: `tl-tabbtn${item === activeTab ? ' active' : ''}`, onClick: () => setTab(item),
                }, item === 'draft' && league.phase !== 'draft' ? 'DRAFT RECAP' : TAB_LABELS[item]))),
            h('div', { className: 'tl-main' }, h('div', { className: 'tl-main-inner' },
                h('div', { className: 'tl-card tl-header' },
                    h('div', null,
                        h('div', { className: 'tl-header-title' },
                            h('strong', null, league.name),
                            h('span', { className: `tl-pill ${phaseTone}` }, league.phase.toUpperCase()),
                            onlineMeta ? h('span', { className: 'tl-pill info' }, '🌐 ONLINE') : null),
                        h(EraChipRail, { label: 'Era of Play', chips: EraRules.eraRuleChips(league.settings.eraRules) })),
                    h('div', { className: 'tl-header-tools' },
                        league.phase !== 'draft' ? h('span', { className: 'tl-pill' }, `WK ${Math.min(league.currentWeek, league.settings.regularSeasonWeeks)}/${league.settings.regularSeasonWeeks}`) : null,
                        h('span', { className: 'tl-pill' }, `${league.teams.length} MGRS`),
                        h('button', { type: 'button', className: 'tl-btn', onClick: switchLeague }, 'SWITCH LEAGUE'),
                        h('button', { type: 'button', className: 'tl-btn', onClick: onClose }, '← DASHBOARD'))),
                conflictNotice && h('div', { className: 'tl-card', style: { borderColor: 'rgba(240,165,0,0.4)', marginBottom: 14 } },
                    h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 } },
                        h('span', { style: { fontSize: 12.5, color: 'var(--warn)' } }, `⚠ ${conflictNotice}`),
                        h('button', { type: 'button', className: 'tl-btn icon', onClick: () => setConflictNotice(null) }, '✕'))),
                activeTab === 'home' && HomePanel ? h(HomePanel, { league, onNavigate: setTab }) : null,
                activeTab === 'draft' ? (cardsReady && DraftPanel ? h(DraftPanel, { league, cards, onUpdate: handleUpdate }) : loadingNotice) : null,
                activeTab === 'gameday' && GamecastPanel ? h(GamecastPanel, {
                    league, cards, logIndex, logsMissing, eraFactors, onUpdate: handleUpdate, onGoRoster: () => setTab('roster'),
                }) : null,
                (activeTab === 'roster' || activeTab === 'waivers' || activeTab === 'trades' || activeTab === 'achievements')
                    ? (cardsReady && TeamPanel
                        ? h(TeamPanel, { league, cards, section: activeTab, activeTeamId: activeTeam, onSelectTeam: setActiveTeamId, onUpdate: handleUpdate })
                        : loadingNotice)
                    : null,
                activeTab === 'standings' && StandingsPanel ? h(StandingsPanel, { league }) : null,
                activeTab === 'activity' && ActivityPanel ? h(ActivityPanel, { league }) : null)));
    }

    window.TimeLeague = TimeLeagueMode;
})();
