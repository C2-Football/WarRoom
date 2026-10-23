// ══════════════════════════════════════════════════════════════════
// js/tabs/dashboard.js — Lens workspace and live dashboard canvas
// Build with Alex owns lens editing; legacy sections remain renderable.
// Star-to-dashboard from any card across the app.
// ══════════════════════════════════════════════════════════════════

// ─── Module definitions (v2 — 6 world-class modules) ─────────────
// Each module must pass the test: actionable? leads somewhere? wow?
// Old 9-module registry preserved in comments for reference during migration.
const T = () => window.WrTheme || {};
const WIDGET_DESTINATIONS = {
    league: 'analytics',
    leagueAnalytics: 'analytics',
    analytics: 'analytics',
    roster: 'myteam',
    myteam: 'myteam',
    market: 'trades',
    trades: 'trades',
    waiver: 'fa',
    waivers: 'fa',
    fa: 'fa',
    draft: 'draft',
    trophies: 'trophies',
    calendar: 'calendar',
    fieldNotes: 'alex',
    scout: 'alex',
    intel: 'alex',
    alex: 'alex',
};
function resolveWidgetDestination(target) {
    if (!target) return null;
    return WIDGET_DESTINATIONS[target] || target;
}

// Gate metadata per module (shared seam — dashboard picker AND per-widget
// render both consume it):
//   pro: true       → free users get a compact teaser card, never the widget
//   pro: false      → renders for everyone (splits, if any, live inside the
//                     widget file — e.g. roster-pulse tier badge/action plan)
//   proFeature      → tier.js FEATURES value string driving upgrade copy;
//                     the gate CONDITION is always window.wrIsPro()
//   formatFlag: null → reserved: the dynasty track fills this with the
//                     league-format flag that hides/shows the module
const WIDGET_MODULES = {
    'intel-brief': {
        label: 'Intel Brief',
        icon: '🧠',
        description: "Alex's briefing — greeting, tier read, and action CTAs",
        accent: () => T().color?.('accent') || 'var(--k-d4af37, #d4af37)',
        metrics: [],
        sizes: ['md', 'lg', 'tall', 'xl', 'xxl'],
        clickTarget: {},
        pro: true, proFeature: 'briefing_reasoning', formatFlag: null,
    },
    'roster-pulse': {
        label: 'Roster Pulse',
        icon: '💊',
        description: 'Your roster vital signs — health, elites, aging, window',
        accent: () => T().color?.('positive') || 'var(--k-2ecc71, #2ecc71)',
        metrics: [
            { key: 'health-score', label: 'Health Score' },
            { key: 'elite-count', label: 'Elite Players' },
            { key: 'contender-rank', label: 'Contender Rank' },
        ],
        sizes: ['sm', 'md', 'lg', 'tall', 'xxl'],
        clickTarget: { sm: 'myteam', md: 'myteam' },
        // Split widget: raw KPI numbers free; tier verdict badge + action-plan
        // recs gated inside roster-pulse.js
        pro: false, formatFlag: null,
    },
    'lineup-check': {
        label: 'Lineup Check',
        icon: '🧮',
        description: 'Optimal vs current lineup — points left on your bench this week',
        accent: () => T().color?.('accent') || 'var(--k-d4af37, #d4af37)',
        metrics: [],
        sizes: ['sm', 'md', 'lg'],
        clickTarget: { sm: 'lineup', md: 'lineup', lg: 'lineup' },
        pro: true, proFeature: 'startsit_depth', formatFlag: null,
    },
    'window-forecast': {
        label: 'Window Forecast',
        icon: '⏳',
        description: 'When each position group ages out — cliffs + sell-by list',
        accent: () => T().color?.('warn') || 'var(--k-f0a500, #f0a500)',
        metrics: [],
        sizes: ['sm', 'md', 'lg', 'tall'],
        clickTarget: { sm: 'myteam', md: 'myteam' },
        pro: true, proFeature: 'analytics_depth', formatFlag: null,
    },
    'gap-plan': {
        label: 'Gap Plan',
        icon: '🧩',
        description: 'Positional gaps in player counts vs elite tier teams',
        accent: () => T().color?.('negative') || 'var(--k-e74c3c, #e74c3c)',
        metrics: [],
        sizes: ['sm', 'md', 'lg'],
        clickTarget: { sm: 'myteam' },
        pro: true, proFeature: 'analytics_depth', formatFlag: null,
    },
    'league-landscape': {
        label: 'League Landscape',
        icon: '🌐',
        description: 'Standings, transactions, who is moving',
        accent: () => T().color?.('accent') || 'var(--k-d4af37, #d4af37)',
        metrics: [],
        sizes: ['sm', 'md', 'lg', 'tall', 'xl', 'xxl'],
        clickTarget: { sm: 'analytics', md: 'analytics' },
        // Free widget: tier verdicts/posture-target reads gated inside
        // league-landscape.js
        pro: false, formatFlag: null,
    },
    'weekly-matchups': {
        label: 'Weekly Matchups', icon: '🏈',
        description: 'Your weekly score, opponent, and matchups across the league',
        accent: () => T().color?.('accent') || 'var(--gold, #d4af37)',
        metrics: [], sizes: ['sm', 'md', 'lg'],
        clickTarget: { sm: 'weekly-matchups', md: 'weekly-matchups', lg: 'weekly-matchups' },
        pro: false, formatFlag: null,
    },
    'league-standings': {
        label: 'League Standings', icon: '📊',
        description: 'Your record, points scored, and position in the league',
        accent: () => T().color?.('accent') || 'var(--gold, #d4af37)',
        metrics: [], sizes: ['sm', 'md', 'lg'],
        clickTarget: { sm: 'league-standings', md: 'league-standings', lg: 'league-standings' },
        pro: false, formatFlag: null,
    },
    'league-stats': {
        label: 'League Stats', icon: '📈',
        description: 'Weekly scoring leaders using your league scoring settings',
        accent: () => T().color?.('accent') || 'var(--gold, #d4af37)',
        metrics: [], sizes: ['sm', 'md', 'lg'],
        clickTarget: { sm: 'stats', md: 'stats', lg: 'stats' },
        pro: false, formatFlag: null,
    },
    'league-cup': {
        label: 'League Cup', icon: '🏆',
        description: 'Cup progress, your next round, and the champion',
        accent: () => T().color?.('accent') || 'var(--gold, #d4af37)',
        metrics: [], sizes: ['sm', 'md', 'lg'],
        clickTarget: { sm: 'league-cup', md: 'league-cup', lg: 'league-cup' },
        pro: false, formatFlag: null,
    },
    'transaction-ticker': {
        label: 'Transaction Ticker',
        icon: '📰',
        description: 'Recent adds, drops, waivers, and trade drill-ins',
        accent: () => T().color?.('info') || 'var(--k-3498db, #3498db)',
        metrics: [],
        sizes: ['md', 'lg'],
        clickTarget: {},
        pro: false, formatFlag: null,
    },
    'market-radar': {
        label: 'Market Radar',
        icon: '📡',
        description: 'Trade opportunities, waiver targets, FAAB',
        accent: () => T().color?.('purple') || 'var(--k-7c6bf8, #7c6bf8)',
        metrics: [],
        sizes: ['sm', 'md', 'lg', 'xl', 'xxl'],
        clickTarget: { sm: 'trades', md: 'trades' },
        pro: true, proFeature: 'faab_intelligence', formatFlag: null,
    },
    'faab-command': {
        label: 'FAAB Command',
        icon: '💰',
        description: 'League-aware bid plan for the top add on the wire',
        accent: () => T().color?.('accent') || 'var(--k-d4af37, #d4af37)',
        metrics: [],
        sizes: ['sm', 'md', 'lg'],
        clickTarget: { sm: 'fa', md: 'fa', lg: 'fa' },
        pro: true, proFeature: 'faab_intelligence', formatFlag: null,
    },
    'draft-capital': {
        label: 'Draft Capital',
        icon: '🎯',
        description: 'Pick inventory, values, draft countdown',
        accent: () => T().color?.('warn') || 'var(--k-f0a500, #f0a500)',
        metrics: [],
        sizes: ['sm', 'md', 'lg', 'xxl'],
        clickTarget: { sm: 'draft', md: 'draft' },
        // Free widget: xxl "Pick Strategy" rec panel gated inside
        // draft-capital.js
        pro: false, formatFlag: null,
    },
    'analyst-mock': {
        label: 'Analyst Mock',
        icon: '🧭',
        description: "Alex's projected Round 1 mock — your pick, this league's history",
        accent: () => T().color?.('accent') || 'var(--k-d4af37, #d4af37)',
        metrics: [],
        sizes: ['sm', 'md', 'lg'],
        clickTarget: { sm: 'draft', md: 'draft' },
        pro: true, proFeature: 'draft_analyst_mock', formatFlag: null,
    },
    'field-notes': {
        label: 'Field Notes',
        icon: '📋',
        description: 'Intel logged from Scout sessions',
        accent: () => T().color?.('info') || 'var(--k-00c8b4, #00c8b4)',
        metrics: [],
        sizes: ['slim', 'narrow', 'lg', 'tall'],
        clickTarget: {},
        pro: false, formatFlag: null,
    },
    // Phase 3: League intelligence surfaced to Home (ex-League Map widgets)
    'competitive-tiers': {
        label: 'Competitive Tiers',
        icon: '🏆',
        description: 'Every team grouped into Elite · Contender · Crossroads · Rebuilding',
        accent: () => T().color?.('accent') || 'var(--k-d4af37, #d4af37)',
        metrics: [],
        sizes: ['sm', 'md', 'lg', 'tall', 'xxl'],
        clickTarget: { sm: 'analytics', md: 'analytics' },
        pro: true, proFeature: 'analytics_depth', formatFlag: null,
    },
    'power-rankings': {
        label: 'Power Rankings',
        icon: '📈',
        description: 'Blended health, contender PPG, and value rankings',
        accent: () => T().color?.('positive') || 'var(--k-2ecc71, #2ecc71)',
        metrics: [],
        sizes: ['sm', 'md', 'lg', 'tall', 'xxl'],
        clickTarget: { sm: 'analytics', md: 'analytics' },
        pro: false, formatFlag: null, // ranking, not advice (owner Q7)
    },
    // SI-3: Tag-driven widgets — surface My Roster tags into Home
    'trade-block': {
        label: 'Trade Block',
        icon: '🏷️',
        description: 'Players you\'ve tagged to shop in trades',
        accent: () => T().color?.('warn') || 'var(--k-f0a500, #f0a500)',
        metrics: [],
        sizes: ['sm', 'md', 'lg', 'tall'],
        clickTarget: { sm: 'myteam', md: 'myteam' },
        pro: false, formatFlag: null, // user's own tags
    },
    'cut-candidates': {
        label: 'Cut Candidates',
        icon: '✂️',
        description: 'Players flagged as drop candidates',
        accent: () => T().color?.('negative') || 'var(--k-e74c3c, #e74c3c)',
        metrics: [],
        sizes: ['sm', 'md', 'lg', 'tall'],
        clickTarget: { sm: 'myteam', md: 'myteam' },
        pro: false, formatFlag: null, // user's own tags
    },
    'waiver-targets': {
        label: 'Waiver Targets',
        icon: '🎯',
        description: 'Players you\'re watching for pickup',
        accent: () => T().color?.('info') || 'var(--k-3498db, #3498db)',
        metrics: [],
        sizes: ['sm', 'md', 'lg', 'tall'],
        clickTarget: { sm: 'fa', md: 'fa' },
        pro: false, formatFlag: null, // user's own tags
    },
    // Phase 9: My Trophies widget — surfaces user's championship count + HOF inductees
    'my-trophies': {
        label: 'My Trophies',
        icon: '🏆',
        description: 'Titles, runner-ups, hall of fame — your team\'s legacy',
        accent: () => T().color?.('accent') || 'var(--k-d4af37, #d4af37)',
        metrics: [],
        sizes: ['sm', 'md', 'lg', 'tall', 'xxl'],
        clickTarget: { sm: 'trophies', md: 'trophies' },
        pro: false, formatFlag: null,
    },
    // League Calendar widget — next league date + agenda (draft, deadline,
    // playoffs, waivers), opening the dedicated League Calendar view.
    'league-calendar': {
        label: 'League Calendar',
        icon: '🗓️',
        description: 'Next league date + a running agenda — draft, deadline, playoffs, waivers',
        accent: () => T().color?.('info') || 'var(--k-3498db, #3498db)',
        metrics: [],
        sizes: ['sm', 'md', 'lg', 'tall', 'xl', 'xxl'],
        clickTarget: { sm: 'calendar', md: 'calendar' },
        pro: false, formatFlag: null,
    },
};

// Legacy module keys → new keys (for migration of saved widget configs)
const LEGACY_MODULE_MAP = {
    'roster': 'roster-pulse',
    'competitive': 'roster-pulse',
    'trading': 'market-radar',
    'waivers': 'market-radar',
    'draft': 'draft-capital',
    'transaction-ticker': 'league-landscape',
    'intelligence-brief': 'intel-brief',
    // field-notes stays as-is
};

// ─── Star widget utilities (exposed globally) ─────────────────────
(function() {
    const STAR_KEY = 'wr_starred_widgets';
    const WrSt = () => window.App?.WrStorage || { get: (k,f) => { try { const v = localStorage.getItem(k); return v === null ? f : JSON.parse(v); } catch { return f; } }, set: (k,v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} } };
    window.WrStarWidget = {
        getAll() { return WrSt().get(STAR_KEY, []); },
        isStarred(id) { return WrSt().get(STAR_KEY, []).some(s => s.id === id); },
        toggle(item) {
            const all = WrSt().get(STAR_KEY, []);
            const idx = all.findIndex(s => s.id === item.id);
            const next = idx >= 0 ? all.filter((_, i) => i !== idx) : [...all, { ...item, ts: Date.now() }];
            WrSt().set(STAR_KEY, next);
            window.dispatchEvent(new CustomEvent('wr_starred_changed', { detail: next }));
            return idx < 0; // returns true if now starred
        },
        remove(id) {
            const all = WrSt().get(STAR_KEY, []).filter(s => s.id !== id);
            WrSt().set(STAR_KEY, all);
            window.dispatchEvent(new CustomEvent('wr_starred_changed', { detail: all }));
        },
    };
})();

// Lenses own persistence and editing; the canvas only renders their contents.
function legacyDashboardLensLayout(layout, catalog) {
    const builder = window.WR.DashboardBuilder;
    const available = new Map(catalog.map(item => [item.key, item]));
    const source = Array.isArray(layout) ? layout : [];
    const validId = value => typeof value === 'string' && /^[a-zA-Z0-9_.:-]{1,100}$/.test(value);
    const originalIds = new Set(source.filter(item => validId(item?.id)).map(item => item.id));
    const imported = [], ids = new Set();
    for (const [index, item] of source.entries()) {
        if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
        const key = available.has(item.key) ? item.key : LEGACY_MODULE_MAP[item.key];
        const definition = available.get(key);
        // Old preferences can contain retired modules or detail levels. Import
        // the supported content without rewriting that recoverable archive.
        if (!definition || imported.length >= builder.MAX_SECTIONS) continue;
        let id = validId(item.id) ? item.id : null;
        if (!id || ids.has(id)) {
            const base = 'legacy_lens_' + index;
            id = base;
            let suffix = 1;
            while (ids.has(id) || originalIds.has(id)) id = base + '_' + suffix++;
        }
        const size = definition.sizes.includes(item.size) ? item.size
            : definition.sizes.includes('md') ? 'md' : definition.sizes[0];
        const candidate = { id, key, size };
        if (key === 'custom-view') {
            candidate.title = item.title;
            candidate.view = item.view;
        } else if (item.primaryMetric != null || key !== item.key) {
            const metric = definition.metrics.find(value => value.key === item.primaryMetric) || definition.metrics[0];
            if (metric) candidate.primaryMetric = metric.key;
        }
        try {
            const normalized = builder.validateLayout([candidate], catalog)[0];
            imported.push(normalized); ids.add(normalized.id);
        } catch (_) { /* A malformed legacy item must not block every lens. */ }
    }
    return imported;
}

function DashboardPanel(props) {
    if (props.readOnly) return <DashboardCanvas {...props} />;
    const builder = window.WR.DashboardBuilder;
    const scope = builder.scopeFor(window.App.DashboardLeagueLayout.leagueId(props.currentLeague), props.sleeperUserId);
    const catalog = builder.catalog(WIDGET_MODULES);
    const legacyLayout = legacyDashboardLensLayout(props.selectedWidgets, catalog);
    return <window.WR.DashboardLenses key={scope} scope={scope} legacyLayout={legacyLayout}
        catalog={catalog} league={props.currentLeague}
        assertCurrentScope={() => {
            if (builder.scopeFor(window.App.DashboardLeagueLayout.leagueId(props.currentLeague), props.sleeperUserId) !== scope) {
                throw new Error('Your account changed. Reload your lenses before saving.');
            }
        }}
        renderCanvas={(layout, lens) => <DashboardCanvas {...props} selectedWidgets={layout} includeLegacyExtras={lens?.id === 'lens_home'} />}
        renderPreview={layout => <DashboardCanvas {...props} selectedWidgets={layout} readOnly={true} setActiveTab={() => {}} />} />;
}

function DashboardCanvas(props) {
    const {
        selectedWidgets,
        computeKpiValue,
        rankedTeams,
        sleeperUserId,
        setActiveTab,
        transactions,
        standings,
        currentLeague,
        leagueSkin,
        playersData,
        statsData,
        prevStatsData,
        myRoster,
        getOwnerName,
        getPlayerName,
        timeAgo,
        briefDraftInfo,
        timeRecomputeTs,
        viewPlayersData = playersData,
        readOnly = false,
        includeLegacyExtras = false,
    } = props;
    const resolvedLeagueSkin = leagueSkin || window.App?.LeagueSkin?.getCurrent?.() || null;
    const valueShortLabel = resolvedLeagueSkin?.vocabulary?.valueShortLabel || 'DHQ';
    const [starredWidgets, setStarredWidgets] = React.useState(() => window.WrStarWidget?.getAll() || []);
    const navigateWidget = React.useCallback((target) => {
        if (readOnly) return;
        const layout = window.App.DashboardLeagueLayout;
        const tab = layout.request(target, layout.leagueId(currentLeague)) ? 'central' : resolveWidgetDestination(target);
        if (tab && setActiveTab) setActiveTab(tab);
    }, [setActiveTab, currentLeague?.id, currentLeague?.league_id, readOnly]);
    // Redraft → build ROS values so dashboard rankings/tiers/widgets reflect
    // rest-of-season production (no-op → DHQ for dynasty/keeper).
    React.useMemo(() => {
        try { window.App?.PlayerValue?.ensureRos?.({ leagueId: currentLeague?.league_id || currentLeague?.id, league: currentLeague, playersData, statsData, priorData: prevStatsData, skin: resolvedLeagueSkin }); }
        catch (e) { if (window.wrLog) window.wrLog('dashboard.ensureRos', e); }
        return null;
    }, [currentLeague, playersData, statsData, prevStatsData]);

    React.useEffect(() => {
        const handler = () => setStarredWidgets(window.WrStarWidget?.getAll() || []);
        window.addEventListener('wr_starred_changed', handler);
        return () => window.removeEventListener('wr_starred_changed', handler);
    }, []);

    // ── Listen for theme changes to re-render ──
    const [themeKey, setThemeKey] = React.useState(() => window.WrTheme?.current || 'default');
    React.useEffect(() => {
        const handler = () => setThemeKey(window.WrTheme?.current || 'default');
        window.addEventListener('wr_theme_changed', handler);
        return () => window.removeEventListener('wr_theme_changed', handler);
    }, []);

    const widgets = selectedWidgets || [];

    // ── Shared style tokens (theme-aware) ──
    const theme = window.WrTheme?.get?.() || {};
    const G = theme.colors?.accent || 'var(--gold)';
    const W = theme.colors?.text || 'var(--white)';
    const S = theme.colors?.textMuted || 'var(--silver)';
    const BK = theme.colors?.card || 'var(--black)';
    const cardBase = window.WrTheme?.cardStyle?.() || { background: BK, border: 'var(--card-border)', borderRadius: 'var(--card-radius)', overflow: 'hidden', height: '100%' };
    const monoFont = theme.fonts?.mono || 'JetBrains Mono, monospace';
    const rajFont = theme.fonts?.display || 'Rajdhani, sans-serif';
    const dmFont = theme.fonts?.ui || 'DM Sans, sans-serif';

    // ── Free/Pro gate (fail-open) — consumed by renderWidget + KPI annotations ──
    const wrPro = typeof window.wrIsPro !== 'function' || window.wrIsPro();

    // ── KPI value helper ──
    function kv(key) {
        try { return computeKpiValue(key); } catch { return { value: '—', sub: '', color: S }; }
    }

    // KPI annotations phrase interpretations/recs ("Championship caliber",
    // "sell aging assets") — Pro only; the raw value keeps rendering.
    function kpiAnn(key, value) {
        return (wrPro && typeof getKpiAnnotation === 'function') ? getKpiAnnotation(key, value) : '';
    }

    // ── Module accent resolver — WIDGET_MODULES.accent is a function,
    // passing it raw into a style prop silently drops the declaration ──
    function modAccent(mod) {
        const a = mod?.accent;
        return (typeof a === 'function' ? a() : a) || G;
    }

    // ── Trend arrow from spark data ──
    function trendArrow(sparkData, color) {
        if (!sparkData || sparkData.length < 2) return null;
        const first = sparkData[0], last = sparkData[sparkData.length - 1];
        if (!first) return null;
        const pct = Math.round((last - first) / Math.abs(first) * 100);
        if (Math.abs(pct) < 2) return <span style={{ color: S, fontSize: 'var(--text-label, 0.75rem)' }}> →</span>;
        return <span style={{ color: pct > 0 ? 'var(--good)' : 'var(--bad)', fontSize: 'var(--text-label, 0.75rem)', fontWeight: 700 }}> {pct > 0 ? '↑' : '↓'}</span>;
    }

    // ── Percentile badge from rank string like "#3/12" ──
    function percentileBadge(valueStr, accent) {
        if (!valueStr) return null;
        const m = String(valueStr).match(/#?(\d+)\s*(?:\/|of)\s*(\d+)/i);
        if (!m) return null;
        const rank = parseInt(m[1]), total = parseInt(m[2]);
        if (!total || rank > total) return null;
        const pct = Math.round((rank / total) * 100);
        const label = pct <= 25 ? 'Top 25%' : pct <= 50 ? 'Top 50%' : pct <= 75 ? 'Top 75%' : 'Bottom 25%';
        const col = pct <= 25 ? 'var(--k-2ecc71, #2ecc71)' : pct <= 50 ? G : pct <= 75 ? 'var(--k-f0a500, #f0a500)' : 'var(--k-e74c3c, #e74c3c)';
        const bg = typeof wrAlpha === 'function' ? wrAlpha(col, '18') : 'var(--ov-2, rgba(255,255,255,0.03))';
        return <span style={{ fontSize: 'var(--text-label, 0.75rem)', padding: '1px 5px', borderRadius: '3px', background: bg, color: col, fontWeight: 700, marginLeft: '4px', fontFamily: dmFont }}>{label}</span>;
    }

    // ══════════════════════════════════════════════════════════════
    // SMALL CARD — generic 1×1 KPI
    // ══════════════════════════════════════════════════════════════
    function SmallKpiCard({ kpiKey, primaryMetric }) {
        const key = primaryMetric || kpiKey;
        const val = kv(key);
        const ann = kpiAnn(key, val.value);
        const mod = WIDGET_MODULES[kpiKey];
        const accentColor = modAccent(mod);
        return (
            <div style={{ ...cardBase, padding: 'var(--card-pad, 14px 16px)', display: 'flex', flexDirection: 'column', gap: '6px', position: 'relative' }}>
                {/* Module badge */}
                <div style={{ fontSize: 'var(--text-label, 0.75rem)', color: accentColor, fontFamily: dmFont, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', opacity: 0.9 }}>
                    {mod?.icon} {mod?.label || key}
                </div>
                {/* Big value */}
                <div style={{ fontFamily: monoFont, fontSize: '1.4rem', fontWeight: 700, color: val.color || W, lineHeight: 1.1, marginTop: '2px' }}>
                    {val.value}
                    {trendArrow(val.sparkData, val.color)}
                </div>
                {/* Percentile */}
                {percentileBadge(val.value, accentColor)}
                {/* Sub label */}
                <div style={{ fontSize: 'var(--text-label, 0.75rem)', color: S, fontFamily: dmFont, opacity: 0.75, marginTop: '1px' }}>{val.sub}</div>
                {/* Annotation */}
                {ann && <div style={{ fontSize: 'var(--text-label, 0.75rem)', color: G, fontWeight: 600, fontFamily: dmFont, lineHeight: 1.3, borderTop: '1px solid var(--acc-fill2, rgba(212,175,55,0.12))', paddingTop: '4px', marginTop: 'auto' }}>{ann}</div>}
            </div>
        );
    }

    // ══════════════════════════════════════════════════════════════
    // MEDIUM CARD — 2×1 — stat + sparkline + insight
    // ══════════════════════════════════════════════════════════════
    function MediumModuleCard({ moduleKey, primaryMetric }) {
        const mod = WIDGET_MODULES[moduleKey];
        if (!mod) return null;

        // Custom renderers for non-KPI modules
        if (moduleKey === 'league-standings') return renderStandings('md');
        if (moduleKey === 'transaction-ticker') return renderTransactionTicker('md');
        if (moduleKey === 'intel-brief') return renderIntelligenceBrief('md');
        if (moduleKey === 'field-notes') return renderFieldNotes('md');

        const key = primaryMetric || mod.metrics?.[0]?.key;
        if (!key) return null;
        const accent = modAccent(mod);
        const val = kv(key);
        const ann = kpiAnn(key, val.value);
        const metaLabel = mod.metrics.find(m => m.key === key)?.label || key;

        // Secondary metrics for context
        const secondary = mod.metrics.filter(m => m.key !== key).slice(0, 2).map(m => ({ ...m, val: kv(m.key) }));

        return (
            <div style={{ ...cardBase, padding: 'var(--card-pad, 14px 16px)', display: 'flex', flexDirection: 'column' }}>
                {/* Header */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
                    <div style={{ fontFamily: rajFont, fontSize: 'var(--text-body, 1rem)', fontWeight: 700, color: accent, letterSpacing: '0.07em', textTransform: 'uppercase' }}>
                        {mod.icon} {mod.label}
                    </div>
                    <div style={{ fontSize: 'var(--text-label, 0.75rem)', color: S, opacity: 0.5, fontFamily: dmFont }}>{metaLabel}</div>
                </div>

                {/* Primary stat row */}
                <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', marginBottom: '6px' }}>
                    <span style={{ fontFamily: monoFont, fontSize: '1.8rem', fontWeight: 700, color: val.color || W, lineHeight: 1 }}>{val.value}</span>
                    {trendArrow(val.sparkData, val.color)}
                    {percentileBadge(val.value, accent)}
                </div>

                {/* Sparkline */}
                {typeof Sparkline !== 'undefined' && val.sparkData && val.sparkData.length > 2 && (
                    <div style={{ marginBottom: '6px' }}>
                        {React.createElement(Sparkline, { data: val.sparkData, width: 200, height: 28, color: val.color || accent })}
                    </div>
                )}

                {/* Insight / annotation */}
                {ann && (
                    <div style={{ fontSize: 'var(--text-label, 0.75rem)', color: G, fontFamily: dmFont, fontWeight: 600, lineHeight: 1.4, marginBottom: '8px' }}>{ann}</div>
                )}
                {!ann && val.sub && (
                    <div style={{ fontSize: 'var(--text-label, 0.75rem)', color: S, fontFamily: dmFont, opacity: 0.75, lineHeight: 1.4, marginBottom: '8px' }}>{val.sub}</div>
                )}

                {/* Secondary metrics */}
                {secondary.length > 0 && (
                    <div style={{ display: 'flex', gap: '12px', marginTop: 'auto', paddingTop: '8px', borderTop: '1px solid var(--ov-4, rgba(255,255,255,0.06))' }}>
                        {secondary.map(s => (
                            <div key={s.key}>
                                <div style={{ fontSize: 'var(--text-label, 0.75rem)', color: S, opacity: 0.6, fontFamily: dmFont, marginBottom: '1px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{s.label}</div>
                                <div style={{ fontFamily: monoFont, fontSize: 'var(--text-body, 1rem)', fontWeight: 600, color: s.val.color || W }}>{s.val.value}</div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        );
    }

    // ══════════════════════════════════════════════════════════════
    // LARGE CARD — 2×2 — mini-panel with multiple stats + list
    // ══════════════════════════════════════════════════════════════
    function LargeModuleCard({ moduleKey, primaryMetric }) {
        const mod = WIDGET_MODULES[moduleKey];
        if (!mod) return null;

        if (moduleKey === 'league-standings') return renderStandings('lg');
        if (moduleKey === 'transaction-ticker') return renderTransactionTicker('lg');
        if (moduleKey === 'intel-brief') return renderIntelligenceBrief('lg');
        if (moduleKey === 'field-notes') return renderFieldNotes('lg');

        const accent = modAccent(mod);
        const allMetrics = mod.metrics.map(m => ({ ...m, val: kv(m.key) }));
        const primaryKey = primaryMetric || mod.metrics?.[0]?.key;
        const primaryVal = kv(primaryKey);
        const ann = kpiAnn(primaryKey, primaryVal.value);

        // League context for bar chart — find roster value for comparison
        const allDHQs = (() => {
            const LI = window.App?.LI || {};
            const scores = window.App?.PlayerValue?.valueMap ? window.App.PlayerValue.valueMap() : (LI.playerScores || {});
            return (currentLeague?.rosters || []).map(r => ({
                rid: r.roster_id,
                dhq: (r.players || []).reduce((s, pid) => s + (scores[pid] || 0), 0),
                isMe: r.owner_id === sleeperUserId,
            })).sort((a, b) => b.dhq - a.dhq);
        })();
        const maxDHQ = allDHQs[0]?.dhq || 1;

        return (
            <div style={{ ...cardBase, padding: 'var(--card-pad, 14px 16px)', display: 'flex', flexDirection: 'column', overflow: 'auto' }}>
                {/* Header */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
                    <span style={{ fontSize: '1.1rem' }}>{mod.icon}</span>
                    <span style={{ fontFamily: rajFont, fontSize: '1rem', fontWeight: 700, color: accent, letterSpacing: '0.07em', textTransform: 'uppercase' }}>{mod.label}</span>
                </div>

                {/* Primary stat hero */}
                <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', marginBottom: '4px' }}>
                    <span style={{ fontFamily: monoFont, fontSize: '2rem', fontWeight: 700, color: primaryVal.color || W, lineHeight: 1 }}>{primaryVal.value}</span>
                    {trendArrow(primaryVal.sparkData, primaryVal.color)}
                    {percentileBadge(primaryVal.value, accent)}
                </div>
                {ann && <div style={{ fontSize: 'var(--text-label, 0.75rem)', color: G, fontFamily: dmFont, fontWeight: 600, lineHeight: 1.4, marginBottom: '10px' }}>{ann}</div>}

                {/* Stats grid */}
                {allMetrics.length > 1 && (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '8px', marginBottom: '12px' }}>
                        {allMetrics.map(m => (
                            <div key={m.key} style={{ background: 'var(--ov-2, rgba(255,255,255,0.03))', borderRadius: 'var(--card-radius-sm, 8px)', padding: '8px 10px' }}>
                                <div style={{ fontSize: 'var(--text-label, 0.75rem)', color: S, opacity: 0.6, fontFamily: dmFont, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '2px' }}>{m.label}</div>
                                <div style={{ fontFamily: monoFont, fontSize: 'var(--text-body, 1rem)', fontWeight: 600, color: m.val.color || W }}>{m.val.value}</div>
                                <div style={{ fontSize: 'var(--text-label, 0.75rem)', color: S, opacity: 0.5, fontFamily: dmFont, marginTop: '1px' }}>{m.val.sub}</div>
                            </div>
                        ))}
                    </div>
                )}

                {/* Mini bar chart: league value comparison */}
                <div style={{ marginTop: 'auto' }}>
                    <div style={{ fontSize: 'var(--text-label, 0.75rem)', color: S, opacity: 0.5, textTransform: 'uppercase', letterSpacing: '0.06em', fontFamily: dmFont, marginBottom: '6px' }}>League {valueShortLabel}</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                        {allDHQs.slice(0, 6).map(t => (
                            <div key={t.rid} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <div style={{ flex: 1, height: '6px', background: 'var(--ov-4, rgba(255,255,255,0.06))', borderRadius: '3px', overflow: 'hidden' }}>
                                    <div style={{ height: '100%', width: `${(t.dhq / maxDHQ) * 100}%`, background: t.isMe ? accent : 'var(--ov-7, rgba(255,255,255,0.2))', borderRadius: '3px', transition: 'width 0.3s' }} />
                                </div>
                                <div style={{ fontSize: 'var(--text-label, 0.75rem)', fontFamily: monoFont, color: t.isMe ? accent : S, opacity: t.isMe ? 1 : 0.6, minWidth: '32px', textAlign: 'right' }}>{(t.dhq / 1000).toFixed(0)}k</div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        );
    }

    // ══════════════════════════════════════════════════════════════
    // INTELLIGENCE BRIEF — delegates to window.IntelligenceBriefWidget
    // defined in js/tabs/flash-brief.js
    // ══════════════════════════════════════════════════════════════
    function renderIntelligenceBrief(size) {
        if (typeof window.IntelligenceBriefWidget !== 'function') {
            return <div style={{ ...cardBase, padding: 'var(--card-pad, 14px 16px)' }}>Intelligence brief unavailable</div>;
        }
        return React.createElement(window.IntelligenceBriefWidget, {
            size, readOnly,
            myRoster,
            rankedTeams,
            sleeperUserId,
            currentLeague,
            briefDraftInfo,
            playersData,
            statsData,
            prevStatsData,
            timeRecomputeTs,
            setActiveTab,
            navigateWidget,
        });
    }

    // ══════════════════════════════════════════════════════════════
    // FIELD NOTES — delegates to window.FieldNotesWidget
    // defined in js/tabs/flash-brief.js
    // ══════════════════════════════════════════════════════════════
    function renderFieldNotes(size) {
        if (typeof window.FieldNotesWidget !== 'function') {
            return <div style={{ ...cardBase, padding: 'var(--card-pad, 14px 16px)' }}>Field notes unavailable</div>;
        }
        return React.createElement(window.FieldNotesWidget, { size, navigateWidget });
    }

    // ══════════════════════════════════════════════════════════════
    // TRANSACTION TICKER
    // ══════════════════════════════════════════════════════════════
    function renderTransactionTicker(size) {
        // Row budget per size: each entry is ~46px (2 lines). md = 1 grid row
        // (160px) fits 2 entries after the header; lg (2 rows, ~330px) fits 5.
        const transactionLimit = size === 'lg' ? 5 : 2;
        let visibleTransactions = (transactions || []).slice(0, transactionLimit);
        if (size === 'lg' && !visibleTransactions.some(t => t.type === 'trade')) {
            const firstTrade = (transactions || []).find(t => t.type === 'trade');
            if (firstTrade && !visibleTransactions.includes(firstTrade)) {
                visibleTransactions = [...visibleTransactions.slice(0, transactionLimit - 1), firstTrade];
            }
        }
        function openTickerPlayer(pid) {
            if (!pid) return;
            if (window.WR?.openPlayerCard) {
                window.WR.openPlayerCard(pid);
                return;
            }
            if (typeof window._wrSelectPlayer === 'function') {
                window._wrSelectPlayer(pid);
                return;
            }
            if (typeof window.openPlayerModal === 'function') {
                window.openPlayerModal(pid);
            }
        }
        function tickerPlayerProps(pid) {
            return {
                role: 'button',
                tabIndex: 0,
                title: 'Open player card',
                onClick: e => { e.stopPropagation(); openTickerPlayer(pid); },
                onKeyDown: e => {
                    if (e.key !== 'Enter' && e.key !== ' ') return;
                    e.preventDefault();
                    e.stopPropagation();
                    openTickerPlayer(pid);
                },
            };
        }
        function buildTickerTradeContext(txn) {
            const rosterIds = txn?.roster_ids || [];
            const owners = rosterIds.map(rid => ({ rosterId: rid, name: getOwnerName(rid) || ('Team ' + rid) }));
            const adds = Object.keys(txn?.adds || {}).map(pid => ({ pid, name: getPlayerName(pid) }));
            const drops = Object.keys(txn?.drops || {}).map(pid => ({ pid, name: getPlayerName(pid) }));
            const pickCount = txn?.draft_picks?.length || 0;
            const assetSummary = [
                adds.length ? adds.slice(0, 3).map(p => '+' + p.name).join(', ') : null,
                drops.length ? drops.slice(0, 3).map(p => '-' + p.name).join(', ') : null,
                pickCount ? pickCount + ' pick' + (pickCount === 1 ? '' : 's') : null,
            ].filter(Boolean).join(' | ');
            return {
                context: 'transaction_ticker_trade',
                transactionId: txn?.transaction_id || txn?.transactionId || txn?.created || null,
                created: txn?.created || null,
                rosterIds,
                owners,
                adds,
                drops,
                pickCount,
                summary: owners.map(o => o.name).join(' vs ') + (assetSummary ? ': ' + assetSummary : ''),
                transaction: txn,
            };
        }
        function openTickerTrade(txn) {
            if (txn?.type !== 'trade') return;
            const detail = buildTickerTradeContext(txn);
            window._wrTradeContext = detail;
            try { window.dispatchEvent(new CustomEvent('wr:open-trade-context', { detail })); } catch (_) {}
            if (navigateWidget) navigateWidget('trades');
            else if (setActiveTab) setActiveTab('trades');
            else if (typeof window.wrNavigateTab === 'function') window.wrNavigateTab('trades');
        }
        function tickerTradeProps(txn) {
            if (txn?.type !== 'trade') return {};
            return {
                role: 'button',
                tabIndex: 0,
                title: 'Open trade context',
                onClick: () => openTickerTrade(txn),
                onKeyDown: e => {
                    if (e.key !== 'Enter' && e.key !== ' ') return;
                    e.preventDefault();
                    openTickerTrade(txn);
                },
            };
        }
        // Sleeper trades carry every traded player in BOTH adds{} (keyed to the
        // receiving roster) and drops{} (keyed to the sending roster) — without
        // a side split a 2-for-2 renders '+A +B -A -B'. Render the trade from
        // roster_ids[0]'s perspective (the owner named on the row): + what they
        // received, - what they sent. Non-trades are one-sided already.
        function tickerAddPids(txn) {
            const pids = Object.keys(txn.adds || {});
            if (txn.type !== 'trade' || txn.roster_ids?.[0] == null) return pids;
            return pids.filter(pid => String(txn.adds[pid]) === String(txn.roster_ids[0]));
        }
        function tickerDropPids(txn) {
            const pids = Object.keys(txn.drops || {});
            if (txn.type !== 'trade' || txn.roster_ids?.[0] == null) return pids;
            return pids.filter(pid => String(txn.drops[pid]) === String(txn.roster_ids[0]));
        }
        const hiddenCount = Math.max(0, (transactions || []).length - visibleTransactions.length);
        return (
            <div style={{ ...cardBase, padding: 'var(--card-pad, 14px 16px)', maxHeight: '100%', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                <div style={{ fontFamily: rajFont, fontSize: 'var(--text-title, 1.125rem)', fontWeight: 700, color: 'var(--k-34d399, #34d399)', letterSpacing: '0.07em', marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    📰 TRANSACTION TICKER
                    {hiddenCount > 0 && (
                        <span role="button" tabIndex={0} title="Open League Analytics"
                            onClick={() => navigateWidget && navigateWidget('analytics')}
                            onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigateWidget && navigateWidget('analytics'); } }}
                            style={{ marginLeft: 'auto', fontSize: 'var(--text-label, 0.75rem)', fontWeight: 600, color: S, opacity: 0.7, fontFamily: dmFont, letterSpacing: 0, textTransform: 'none', cursor: 'pointer' }}>
                            +{hiddenCount} more →
                        </span>
                    )}
                </div>
                <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
                {(!transactions || transactions.length === 0) ? (
                    <SkeletonRows count={size === 'lg' ? 5 : 2} />
                ) : visibleTransactions.map((txn, ti) => (
                    <div key={ti} {...tickerTradeProps(txn)} style={{ padding: '8px 0', borderBottom: '1px solid var(--ov-3, rgba(255,255,255,0.05))', cursor: txn.type === 'trade' ? 'pointer' : 'default', outline: 'none' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '3px', flexWrap: 'wrap' }}>
                            <span style={{ fontSize: 'var(--text-label, 0.75rem)', color: S, opacity: 0.55, minWidth: '36px' }}>{timeAgo(txn.created)}</span>
                            <span style={{ fontSize: 'var(--text-label, 0.75rem)', fontWeight: 700, padding: '1px 5px', borderRadius: '3px',
                                background: txn.type === 'trade' ? 'var(--acc-fill3, rgba(212,175,55,0.15))' : txn.type === 'waiver' ? 'rgba(52,211,153,0.15)' : 'rgba(96,165,250,0.15)',
                                color: txn.type === 'trade' ? G : txn.type === 'waiver' ? 'var(--k-34d399, #34d399)' : 'var(--k-60a5fa, #60a5fa)',
                            }}>{(txn.type === 'free_agent' ? 'FA' : txn.type || '').toUpperCase()}</span>
                            <span style={{ fontSize: 'var(--text-label, 0.75rem)', color: S }}>{getOwnerName(txn.roster_ids?.[0])}</span>
                            {txn.type === 'trade' && txn.roster_ids?.[1] && (
                                <span style={{ fontSize: 'var(--text-label, 0.75rem)', color: S, opacity: 0.6 }}>↔ {getOwnerName(txn.roster_ids[1])}</span>
                            )}
                        </div>
                        <div style={{ fontSize: 'var(--text-label, 0.75rem)', color: W, paddingLeft: '42px' }}>
                            {tickerAddPids(txn).map(pid => (
                                <span key={'a'+pid} style={{ color: 'var(--good)', cursor: 'pointer', marginRight: '5px' }}
                                    {...tickerPlayerProps(pid)}>
                                    +{getPlayerName(pid)}
                                </span>
                            ))}
                            {tickerDropPids(txn).map(pid => (
                                <span key={'d'+pid} style={{ color: 'var(--bad)', cursor: 'pointer', marginRight: '5px' }}
                                    {...tickerPlayerProps(pid)}>
                                    -{getPlayerName(pid)}
                                </span>
                            ))}
                            {txn.settings?.waiver_bid > 0 && <span style={{ color: 'var(--warn)', marginLeft: '2px' }}>${txn.settings.waiver_bid}</span>}
                            {txn.type === 'trade' && txn.draft_picks?.length > 0 && (
                                <span style={{ color: G, fontSize: 'var(--text-label, 0.75rem)', marginLeft: '4px' }}>+{txn.draft_picks.length} pick{txn.draft_picks.length !== 1 ? 's' : ''}</span>
                            )}
                        </div>
                    </div>
                ))}
                </div>
            </div>
        );
    }

    // ══════════════════════════════════════════════════════════════
    // LEAGUE STANDINGS
    // ══════════════════════════════════════════════════════════════
    function renderStandings(size) {
        const isOffseason = currentLeague?.status === 'complete' || currentLeague?.status === 'pre_draft';
        const isCompact = size === 'md';
        // Flat, budget-aware list: division grouping can't fit a fixed-height
        // card (4 divisions × 5+ rows used to render ~740px into 160px and
        // hard-clip). Rank globally, cap rows to the card budget, and always
        // include the user's row. Full division standings live in Analytics.
        const sorted = [...(standings || [])].sort((a, b) => {
            if (isOffseason) {
                const ra = currentLeague?.rosters?.find(r => r.owner_id === a.userId);
                const rb = currentLeague?.rosters?.find(r => r.owner_id === b.userId);
                const ha = window.assessTeamFromGlobal?.(ra?.roster_id)?.healthScore || 0;
                const hb = window.assessTeamFromGlobal?.(rb?.roster_id)?.healthScore || 0;
                return hb !== ha ? hb - ha : b.pointsFor - a.pointsFor;
            }
            if (b.wins !== a.wins) return b.wins - a.wins;
            if (a.losses !== b.losses) return a.losses - b.losses;
            return b.pointsFor - a.pointsFor;
        }).map((team, idx) => ({ team, rank: idx + 1 }));
        const budget = isCompact ? 4 : 10;
        const myIdx = sorted.findIndex(({ team }) => team.userId === sleeperUserId);
        let visible = sorted.slice(0, budget);
        if (myIdx >= budget) visible = [...sorted.slice(0, budget - 1), sorted[myIdx]];
        const hiddenCount = sorted.length - visible.length;

        return (
            <div style={{ ...cardBase, padding: 'var(--card-pad, 14px 16px)', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                <div style={{ fontFamily: rajFont, fontSize: 'var(--text-title, 1.125rem)', fontWeight: 700, color: G, letterSpacing: '0.07em', marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    📊 LEAGUE STANDINGS
                    {hiddenCount > 0 && (
                        <span role="button" tabIndex={0} title="Open League Analytics"
                            onClick={() => navigateWidget && navigateWidget('analytics')}
                            onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigateWidget && navigateWidget('analytics'); } }}
                            style={{ marginLeft: 'auto', fontSize: 'var(--text-label, 0.75rem)', fontWeight: 600, color: S, opacity: 0.7, fontFamily: dmFont, letterSpacing: 0, textTransform: 'none', cursor: 'pointer' }}>
                            +{hiddenCount} more →
                        </span>
                    )}
                </div>
                <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: isCompact ? '16px 1fr 44px 50px' : '16px 24px 1fr 44px 44px 50px', gap: '4px', padding: '3px 6px', fontSize: 'var(--text-label, 0.75rem)', fontWeight: 700, color: G, fontFamily: dmFont, textTransform: 'uppercase', letterSpacing: '0.04em', borderBottom: '1px solid var(--acc-fill2, rgba(212,175,55,0.12))' }}>
                        <span>#</span>
                        {!isCompact && <span/>}
                        <span>Team</span>
                        <span style={{ textAlign: 'right' }}>{isOffseason ? 'HP' : 'W-L'}</span>
                        {!isCompact && <span style={{ textAlign: 'right' }}>PF</span>}
                        <span style={{ textAlign: 'right' }}>{valueShortLabel}</span>
                    </div>
                    {visible.map(({ team, rank }) => {
                        const idx = rank - 1;
                            const isMe = team.userId === sleeperUserId;
                            const roster = currentLeague?.rosters?.find(r => r.owner_id === team.userId);
                            const totalDHQ = roster?.players?.reduce((s, pid) => s + ((window.App?.PlayerValue?.getValue ? window.App.PlayerValue.getValue(pid) : (window.App?.LI?.playerScores?.[pid] || 0))), 0) || 0;
                            const user = (currentLeague?.users || []).find(u => u.user_id === team.userId);
                            const avatarId = user?.avatar;
                            const avatarUrl = avatarId ? `https://sleepercdn.com/avatars/thumbs/${avatarId}` : null;
                            const hs = isOffseason ? (window.assessTeamFromGlobal?.(roster?.roster_id)?.healthScore || 0) : 0;
                            return (
                                <div key={team.rosterId} style={{
                                    display: 'grid', gridTemplateColumns: isCompact ? '16px 1fr 44px 50px' : '16px 24px 1fr 44px 44px 50px', gap: '4px',
                                    padding: '5px 6px', borderBottom: '1px solid var(--ov-3, rgba(255,255,255,0.04))',
                                    background: isMe ? 'var(--acc-fill1, rgba(212,175,55,0.07))' : 'transparent',
                                    fontSize: 'var(--text-label, 0.75rem)', alignItems: 'center',
                                }}>
                                    <span style={{ fontFamily: rajFont, fontSize: 'var(--text-label, 0.75rem)', color: idx === 0 ? 'var(--k-d4af37, #d4af37)' : idx === 1 ? 'var(--k-c0c0c0, #c0c0c0)' : idx === 2 ? 'var(--k-cd7f32, #cd7f32)' : S }}>{idx + 1}</span>
                                    {!isCompact && (
                                        <div style={{ width: 22, height: 22 }}>
                                            {avatarUrl
                                                ? <img src={avatarUrl} alt="" style={{ width: 22, height: 22, borderRadius: '50%', objectFit: 'cover', border: isMe ? '1.5px solid var(--gold)' : '1px solid var(--ov-6, rgba(255,255,255,0.1))' }} />
                                                : <div style={{ width: 22, height: 22, borderRadius: '50%', background: 'var(--ov-4, rgba(255,255,255,0.07))', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 'var(--text-label, 0.75rem)', color: S }}>{(team.displayName || '?').charAt(0).toUpperCase()}</div>
                                            }
                                        </div>
                                    )}
                                    <div style={{ overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis', fontWeight: isMe ? 700 : 400, color: isMe ? G : W }}>
                                        {isCompact ? team.displayName : (team.teamName ? `${team.teamName} (${team.displayName})` : team.displayName)}
                                        {isMe && <span style={{ fontSize: 'var(--text-label, 0.75rem)', color: G, marginLeft: '3px' }}>YOU</span>}
                                    </div>
                                    <span style={{ textAlign: 'right', fontFamily: dmFont, fontWeight: 600, color: W, fontSize: 'var(--text-label, 0.75rem)' }}>{isOffseason ? (hs > 0 ? hs.toFixed(0) : '—') : `${team.wins}-${team.losses}`}</span>
                                    {!isCompact && <span style={{ textAlign: 'right', fontSize: 'var(--text-label, 0.75rem)', color: S }}>{team.pointsFor > 0 ? team.pointsFor.toFixed(0) : '—'}</span>}
                                    <span style={{ textAlign: 'right', fontSize: 'var(--text-label, 0.75rem)', fontFamily: dmFont, color: totalDHQ >= 80000 ? 'var(--good)' : totalDHQ >= 50000 ? G : S }}>{totalDHQ > 0 ? (totalDHQ / 1000).toFixed(0) + 'k' : '—'}</span>
                                </div>
                            );
                        })}
                </div>
            </div>
        );
    }

    // ══════════════════════════════════════════════════════════════
    // WIDGET SHELL — wrapper with gear button + drag handle
    // ══════════════════════════════════════════════════════════════
    function WidgetShell({ widget, children, compact = false }) {
        const sizeSpan = { sm: 'span 1', slim: 'span 1', narrow: 'span 1', md: 'span 2', lg: 'span 2', tall: 'span 2', xl: 'span 4', xxl: 'span 4' };
        const rowSpan = { sm: 'span 1', slim: 'span 2', narrow: 'span 4', md: 'span 1', lg: 'span 2', tall: 'span 4', xl: 'span 2', xxl: 'span 4' };
        return <div className="wr-widget" data-widget-id={widget.id || ''} data-widget-key={widget.key || ''} data-widget-size={widget.size || ''}
            style={{ gridColumn: sizeSpan[widget.size] || 'span 1', gridRow: widget.key === 'custom-view' ? (widget.size === 'md' ? 'span 2' : 'span 3') : rowSpan[widget.size] || 'span 1', position: 'relative', minWidth: 0, minHeight: compact ? '142px' : widget.size === 'sm' ? '160px' : undefined }}>
            {children}
        </div>;
    }

    // ══════════════════════════════════════════════════════════════
    // PRO TEASER CARD — rendered in place of a Pro widget for free
    // users: title + lock + one-line what-you-get + upgrade CTA.
    // Lives inside WidgetShell so layout editing stays free.
    // ══════════════════════════════════════════════════════════════
    function WidgetProTeaser({ moduleKey }) {
        const mod = WIDGET_MODULES[moduleKey];
        const openUpsell = () => {
            if (window.showProLaunchPage) window.showProLaunchPage();
            else if (window.showUpgradePrompt) window.showUpgradePrompt(mod?.proFeature || '');
        };
        return (
            <div style={{ ...cardBase, borderLeft: '3px solid var(--gold)', padding: 'var(--card-pad, 14px 16px)', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0 }}>
                    <span style={{ fontSize: '1rem', flexShrink: 0 }}>{mod?.icon}</span>
                    <span style={{ flex: 1, minWidth: 0, fontFamily: rajFont, fontSize: 'var(--text-body, 1rem)', fontWeight: 700, color: W, letterSpacing: '0.06em', textTransform: 'uppercase', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{mod?.label || moduleKey}</span>
                    <span aria-hidden="true" style={{ fontSize: '0.85rem', flexShrink: 0 }}>🔒</span>
                    <span style={{ fontFamily: monoFont, fontSize: 'var(--text-label, 0.75rem)', letterSpacing: '0.08em', textTransform: 'uppercase', color: G, border: '1px solid var(--acc-line3, rgba(212,175,55,0.4))', borderRadius: '2px', padding: '1px 6px', flexShrink: 0 }}>Pro</span>
                </div>
                <div style={{ fontSize: 'var(--text-label, 0.75rem)', color: S, lineHeight: 1.4, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>{mod?.description}</div>
                <button onClick={openUpsell} style={{ marginTop: 'auto', alignSelf: 'flex-start', padding: '6px 12px', minHeight: '32px', background: 'var(--gold)', color: 'var(--k-1a1000, #1a1000)', border: 'none', borderRadius: '2px', fontFamily: monoFont, fontSize: 'var(--text-label, 0.75rem)', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', cursor: 'pointer' }}>
                    Unlock with Pro
                </button>
            </div>
        );
    }

    // ── Render a single widget based on module + size ──
    function renderWidget(widget, idx) {
        if (!widget?.key) return null;
        const { key, size, primaryMetric } = widget;
        if (key === 'custom-view') return <WidgetShell key={widget.id} widget={widget} idx={idx}>
            <window.WR.DashboardDataView widget={widget} context={{ currentLeague, myRoster, playersData: viewPlayersData, standings, rankedTeams, transactions, getPlayerName, getOwnerName }} />
        </WidgetShell>;

        // Navigate on click for SM widgets
        // v2 click targets use the module's clickTarget map; fall back to legacy
        const mod = WIDGET_MODULES[key];
        const clickTab = resolveWidgetDestination(mod?.clickTarget?.[size] || mod?.clickTarget?.sm || null);

        // ── Free/Pro gate (WIDGET_MODULES.pro) — teaser card, never blank ──
        if (mod?.pro && !wrPro) {
            return (
                <WidgetShell key={widget.id || key + idx} widget={widget} idx={idx}>
                    <WidgetProTeaser moduleKey={key} />
                </WidgetShell>
            );
        }

        // ── Delegate to module-specific external widgets if available ──
        const externalWidget = resolveExternalWidget(key, size, primaryMetric);
        if (externalWidget !== null) {
            return (
                <WidgetShell key={widget.id || key + idx} widget={widget} idx={idx}>
                    {externalWidget}
                </WidgetShell>
            );
        }

        // ── Fallback: generic KPI renderers for modules with metrics ──
        if (size === 'sm') {
            return (
                <WidgetShell key={widget.id || key + idx} widget={widget} idx={idx}>
                    <div onClick={() => clickTab && navigateWidget(clickTab)} style={{ cursor: clickTab ? 'pointer' : 'default', height: '100%' }}>
                        <SmallKpiCard kpiKey={key} primaryMetric={primaryMetric} />
                    </div>
                </WidgetShell>
            );
        }
        if (size === 'md') {
            return (
                <WidgetShell key={widget.id || key + idx} widget={widget} idx={idx}>
                    <MediumModuleCard moduleKey={key} primaryMetric={primaryMetric} />
                </WidgetShell>
            );
        }
        if (size === 'lg' || size === 'tall') {
            return (
                <WidgetShell key={widget.id || key + idx} widget={widget} idx={idx}>
                    <LargeModuleCard moduleKey={key} primaryMetric={primaryMetric} />
                </WidgetShell>
            );
        }
        if (size === 'xl' || size === 'xxl') {
            return (
                <WidgetShell key={widget.id || key + idx} widget={widget} idx={idx}>
                    <LargeModuleCard moduleKey={key} primaryMetric={primaryMetric} />
                </WidgetShell>
            );
        }
        return null;
    }

    // ── External widget resolver ─────────────────────────────────
    // Each module can have an external widget component (loaded via
    // <script> tags). If one exists, it takes priority over the
    // generic KPI renderers.
    function resolveExternalWidget(moduleKey, size, primaryMetric) {
        if (window.App.DashboardLeagueLayout.keys.includes(moduleKey) && window.LeagueProgressWidget) {
            return React.createElement(window.LeagueProgressWidget, {
                kind: moduleKey, size, currentLeague, myRoster, playersData, getOwnerName, navigateWidget, setActiveTab,
            });
        }
        // Intel Brief → IntelligenceBriefWidget (flash-brief.js)
        if (moduleKey === 'intel-brief') {
            return renderIntelligenceBrief(size);
        }
        // Field Notes → FieldNotesWidget (flash-brief.js)
        if (moduleKey === 'field-notes') {
            return renderFieldNotes(size);
        }
        // Roster Pulse → RosterPulseWidget (js/widgets/roster-pulse.js)
        if (moduleKey === 'roster-pulse' && typeof window.RosterPulseWidget === 'function') {
            const RPW = window.RosterPulseWidget;
            return React.createElement(RPW, {
                size, primaryMetric, myRoster, rankedTeams, sleeperUserId, currentLeague,
                playersData, computeKpiValue, setActiveTab, navigateWidget,
            });
        }
        // Lineup Check → LineupCheckWidget (js/widgets/lineup-check.js)
        if (moduleKey === 'lineup-check' && typeof window.LineupCheckWidget === 'function') {
            return React.createElement(window.LineupCheckWidget, {
                size, myRoster, currentLeague, playersData, statsData, prevStatsData, setActiveTab, navigateWidget,
            });
        }
        // Window Forecast → WindowForecastWidget (js/widgets/window-forecast.js)
        if (moduleKey === 'window-forecast' && typeof window.WindowForecastWidget === 'function') {
            return React.createElement(window.WindowForecastWidget, {
                size, myRoster, currentLeague, playersData, sleeperUserId, setActiveTab, navigateWidget,
            });
        }
        // Gap Plan → GapPlanWidget (js/widgets/gap-plan.js)
        if (moduleKey === 'gap-plan' && typeof window.GapPlanWidget === 'function') {
            return React.createElement(window.GapPlanWidget, {
                size, myRoster, currentLeague, playersData, sleeperUserId, setActiveTab, navigateWidget,
            });
        }
        // League Landscape → LeagueLandscapeWidget (js/widgets/league-landscape.js)
        if (moduleKey === 'league-landscape' && typeof window.LeagueLandscapeWidget === 'function') {
            const LLW = window.LeagueLandscapeWidget;
            return React.createElement(LLW, {
                size, standings, transactions, rankedTeams, sleeperUserId,
                currentLeague, playersData, setActiveTab, getOwnerName, getPlayerName, timeAgo,
                navigateWidget,
            });
        }
        // Market Radar → MarketRadarWidget (js/widgets/market-radar.js)
        if (moduleKey === 'market-radar' && typeof window.MarketRadarWidget === 'function') {
            const MRW = window.MarketRadarWidget;
            return React.createElement(MRW, {
                size, myRoster, rankedTeams, sleeperUserId, currentLeague,
                playersData, setActiveTab, navigateWidget,
            });
        }
        // FAAB Command → FaabCommandWidget (js/widgets/faab-command.js)
        if (moduleKey === 'faab-command' && typeof window.FaabCommandWidget === 'function') {
            return React.createElement(window.FaabCommandWidget, {
                size, myRoster, currentLeague, playersData, setActiveTab, navigateWidget,
            });
        }
        // Draft Capital → DraftCapitalWidget (js/widgets/draft-capital.js)
        if (moduleKey === 'draft-capital' && typeof window.DraftCapitalWidget === 'function') {
            const DCW = window.DraftCapitalWidget;
            return React.createElement(DCW, {
                size, myRoster, currentLeague, playersData, briefDraftInfo,
                setActiveTab, navigateWidget,
            });
        }
        // Analyst Mock → AnalystMockWidget (js/widgets/analyst-mock.js)
        if (moduleKey === 'analyst-mock' && typeof window.AnalystMockWidget === 'function') {
            return React.createElement(window.AnalystMockWidget, {
                size, readOnly, myRoster, currentLeague, setActiveTab, navigateWidget,
            });
        }
        // Phase 3: Competitive Tiers widget (js/widgets/competitive-tiers.js)
        if (moduleKey === 'competitive-tiers' && typeof window.CompetitiveTiersWidget === 'function') {
            return React.createElement(window.CompetitiveTiersWidget, { size, sleeperUserId, currentLeague, playersData, setActiveTab, navigateWidget });
        }
        // Phase 3: Power Rankings widget (js/widgets/power-rankings.js)
        if (moduleKey === 'power-rankings' && typeof window.PowerRankingsWidget === 'function') {
            return React.createElement(window.PowerRankingsWidget, { readOnly, size, sleeperUserId, currentLeague, playersData, setActiveTab, navigateWidget });
        }
        // SI-3: Tag-driven widgets (js/widgets/player-tags.js)
        if (moduleKey === 'trade-block' && typeof window.TradeBlockWidget === 'function') {
            return React.createElement(window.TradeBlockWidget, { size, playersData, setActiveTab, navigateWidget });
        }
        if (moduleKey === 'cut-candidates' && typeof window.CutCandidatesWidget === 'function') {
            return React.createElement(window.CutCandidatesWidget, { size, playersData, setActiveTab, navigateWidget });
        }
        if (moduleKey === 'waiver-targets' && typeof window.WaiverTargetsWidget === 'function') {
            return React.createElement(window.WaiverTargetsWidget, { size, playersData, setActiveTab, navigateWidget });
        }
        // Phase 9: My Trophies widget
        if (moduleKey === 'my-trophies' && typeof window.MyTrophiesWidget === 'function') {
            return React.createElement(window.MyTrophiesWidget, { size, myRoster, currentLeague, setActiveTab, navigateWidget });
        }
        // League Calendar widget (js/widgets/league-calendar.js)
        if (moduleKey === 'league-calendar' && typeof window.LeagueCalendarWidget === 'function') {
            return React.createElement(window.LeagueCalendarWidget, { size, currentLeague, leagueSkin, myRoster, setActiveTab, navigateWidget });
        }
        // No external widget — fall through to generic renderers
        return null;
    }

    // ══════════════════════════════════════════════════════════════
    // PINNED SECTION — starred items
    // ══════════════════════════════════════════════════════════════
    function PinnedSection() {
        if (readOnly || !includeLegacyExtras || starredWidgets.length === 0) return null;
        return (
            <div style={{ padding: '0 20px 20px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px', paddingTop: '16px', borderTop: '1px solid var(--acc-fill2, rgba(212,175,55,0.12))' }}>
                    <span style={{ color: G, fontSize: 'var(--text-body, 1rem)' }}>★</span>
                    <span style={{ fontFamily: rajFont, fontSize: 'var(--text-title, 1.125rem)', fontWeight: 700, color: G, letterSpacing: '0.08em' }}>PINNED</span>
                    <span style={{ fontSize: 'var(--text-label, 0.75rem)', color: S, opacity: 0.5, fontFamily: dmFont }}>Starred from across the app</span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '10px' }}>
                    {starredWidgets.map(item => (
                        <div key={item.id} style={{ background: 'var(--acc-fill1, rgba(212,175,55,0.05))', border: '1px solid var(--acc-line1, rgba(212,175,55,0.2))', borderRadius: 'var(--card-radius, 10px)', padding: '12px 14px', position: 'relative' }}>
                            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '8px', marginBottom: '6px' }}>
                                <div style={{ fontFamily: dmFont, fontSize: 'var(--text-body, 1rem)', fontWeight: 600, color: W, lineHeight: 1.3 }}>{item.title}</div>
                                <button onClick={() => window.WrStarWidget?.remove(item.id)} title="Unpin" style={{ background: 'none', border: 'none', cursor: 'pointer', color: G, fontSize: 'var(--text-body, 1rem)', flexShrink: 0, padding: 0, lineHeight: 1, minWidth: '44px', minHeight: '44px', margin: '-12px -14px -12px 0', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>★</button>
                            </div>
                            {item.content && <div style={{ fontSize: 'var(--text-label, 0.75rem)', color: S, fontFamily: dmFont, opacity: 0.75, lineHeight: 1.4 }}>{item.content}</div>}
                            {item.sourceModule && <div style={{ fontSize: 'var(--text-label, 0.75rem)', color: S, opacity: 0.4, fontFamily: dmFont, marginTop: '6px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{item.sourceModule}</div>}
                        </div>
                    ))}
                </div>
            </div>
        );
    }

    // Preserve old Home extras without inserting them into a new lens or preview.
    const chopBlockEl = (!readOnly && includeLegacyExtras && resolvedLeagueSkin?.features?.showElimination && window.WrChopBlock)
        ? <div style={{ padding: '14px 16px 0' }}><window.WrChopBlock active compact currentLeague={currentLeague} myRoster={myRoster} onOpenLeague={() => navigateWidget('central')} /></div>
        : null;

    // ══════════════════════════════════════════════════════════════
    // MAIN RENDER
    // ══════════════════════════════════════════════════════════════
    return (
        <React.Fragment>
            {chopBlockEl}
            <style>{`
                @media(max-width:767px){
                    .wr-dashboard-grid{
                        grid-template-columns:minmax(0,1fr) !important;
                        grid-auto-rows:minmax(160px,auto) !important;
                        padding:var(--space-md) !important;
                        gap:var(--space-md) !important;
                        overflow-x:hidden;
                    }
                    .wr-dashboard-grid>.wr-widget{
                        grid-column:1 / -1 !important;
                        grid-row:auto !important;
                        min-width:0;
                    }
                    .wr-dashboard-grid>.wr-add-widget{
                        grid-column:1 / -1 !important;
                    }
                }
                @media(min-width:768px) and (max-width:1023px){
                    .wr-dashboard-grid{
                        grid-template-columns:repeat(2,minmax(140px,1fr)) !important;
                    }
                    .wr-dashboard-grid>.wr-widget{
                        min-width:0;
                    }
                    /* Target full-width sizes by data attribute — [style*="span 4"]
                       also matches grid-ROW spans (tall/narrow), stretching them wrong */
                    .wr-dashboard-grid>.wr-widget[data-widget-size="xl"],
                    .wr-dashboard-grid>.wr-widget[data-widget-size="xxl"]{
                        grid-column:span 2 !important;
                    }
                }
                @media(min-width:1024px) and (max-width:1279px){
                    .wr-dashboard-grid{
                        grid-template-columns:repeat(2,minmax(0,1fr)) !important;
                    }
                    .wr-dashboard-grid>.wr-widget,
                    .wr-dashboard-grid>.wr-add-widget{
                        min-width:0;
                    }
                    .wr-dashboard-grid>.wr-widget[data-widget-size="xl"],
                    .wr-dashboard-grid>.wr-widget[data-widget-size="xxl"]{
                        grid-column:span 2 !important;
                    }
                }
                @media(min-width:1280px) and (max-width:1439px){
                    .wr-dashboard-grid{
                        grid-template-columns:repeat(3,minmax(0,1fr)) !important;
                    }
                    .wr-dashboard-grid>.wr-widget,
                    .wr-dashboard-grid>.wr-add-widget{
                        min-width:0;
                    }
                    .wr-dashboard-grid>.wr-widget[data-widget-size="xl"],
                    .wr-dashboard-grid>.wr-widget[data-widget-size="xxl"]{
                        grid-column:span 3 !important;
                    }
                }
                @media(min-width:1440px){
                    .wr-dashboard-grid{
                        grid-template-columns:repeat(4,minmax(0,1fr)) !important;
                    }
                    .wr-dashboard-grid>.wr-widget,
                    .wr-dashboard-grid>.wr-add-widget{
                        min-width:0;
                    }
                }
            `}</style>

            {/* Widget grid */}
            <div className="wr-dashboard-grid" style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(4, minmax(140px, 1fr))',
                gridAutoRows: '160px',
                gap: 'var(--space-md)',
                padding: 'var(--space-lg) var(--space-xl)',
                background: BK,
                borderBottom: '1px solid ' + (theme.colors?.border || 'var(--acc-fill2, rgba(212,175,55,0.12))'),
                minWidth: 0,
                maxWidth: '100%',
                overflowX: 'hidden',
            }}>
                {widgets.map((widget, idx) => renderWidget(widget, idx))}


            </div>

            {/* Pinned / starred section */}
            <PinnedSection />


        </React.Fragment>
    );
}
