// ══════════════════════════════════════════════════════════════════
// js/tabs/flash-brief.js — IntelligenceBriefWidget + FieldNotesWidget
// These are dashboard widget components, consumed by DashboardPanel
// in js/tabs/dashboard.js via window.IntelligenceBriefWidget /
// window.FieldNotesWidget. The old FlashBriefPanel 2×2 tab was
// removed — ticker/standings now render only from dashboard.js.
// ══════════════════════════════════════════════════════════════════

function ordinal(n) { const s = ['th','st','nd','rd']; const v = n % 100; return n + (s[(v-20)%10] || s[v] || s[0]); }

// The four tier-message keys (elite/contender/crossroads/rebuilding) are
// POOLS — AlexVoice.pick chooses one per league+week seed, so the read is
// stable across re-renders but the phrasing rolls when the week does.
// Greeting/waiver/trade/draft/rank stay single-variant by design (owner
// call, de-busying plan Q4 — wider seeding waits for the hybrid-AI voice).
const BRIEF_PERSONALITY = {
    default: {
        greeting: (t, name) => (t < 12 ? 'Good morning' : t < 17 ? 'Good afternoon' : 'Good evening') + ', ' + name + '.',
        elite: [
            (rank, hs) => "Your roster is elite — top of the food chain right now.",
            (rank, hs) => "This roster is the class of the league — the target's on your back now.",
            (rank, hs) => "Elite territory. Everyone else is chasing you.",
        ],
        contender: [
            (rank, hs) => "Your roster's sitting in solid shape — " + ordinal(rank) + " in the league with a health score of " + hs + ". You're right in the mix.",
            (rank, hs) => "You're a legit contender — " + ordinal(rank) + " with a health score of " + hs + ", well within striking distance.",
            (rank, hs) => "Sitting " + ordinal(rank) + " with a health score of " + hs + " — one sharp move could tip this your way.",
        ],
        crossroads: [
            (rank, hs) => "You're at a crossroads — ranked " + ordinal(rank) + " with a health score of " + hs + ". Some decisions coming up that'll define your direction.",
            (rank, hs) => "Ranked " + ordinal(rank) + ", health score " + hs + " — you could push in or pull back, and I'd rather we choose than drift.",
            (rank, hs) => "This is a fork-in-the-road roster — " + ordinal(rank) + ", health score " + hs + ". The next move sets your direction.",
        ],
        rebuilding: [
            (rank, hs) => "Rebuilding mode — ranked " + ordinal(rank) + ". Health score is " + hs + ". But that's where the opportunity is.",
            (rank, hs) => "You're rebuilding from " + ordinal(rank) + " with a health score of " + hs + " — the goal right now is assets, not wins.",
            (rank, hs) => "Ranked " + ordinal(rank) + ", health score " + hs + ". Rebuilds reward patience — stack picks and youth.",
        ],
        waiver: (name, pos, dhq) => "I've been watching the wire — " + name + " is sitting out there unclaimed.",
        trade: (count) => "I've mapped out the owners in your league. A few look ripe for a deal.",
        draft: (days, date) => "Draft is " + days + " day" + (days !== 1 ? 's' : '') + " out. Time to sharpen your board.",
        rank: (rank, tier) => "You're #" + rank + " in the league pecking order right now.",
    },
    general: {
        greeting: (t, name) => name + ". Listen up.",
        elite: [
            (rank, hs) => "Health score " + hs + ". That's dominance. Don't get comfortable — maintain that edge.",
            (rank, hs) => "Top of the league at " + hs + " health. Champions get hunted — stay sharp.",
            (rank, hs) => "Elite roster. Dominance is rented, and the rent's due every week.",
        ],
        contender: [
            (rank, hs) => "Ranked " + ordinal(rank) + ". Health score " + hs + ". Solid, but solid doesn't win championships. Push harder.",
            (rank, hs) => ordinal(rank) + " place, health score " + hs + ". Close only counts in horseshoes. Close the gap.",
            (rank, hs) => "You're " + ordinal(rank) + " at " + hs + " health. Contender status — now act like one.",
        ],
        crossroads: [
            (rank, hs) => "Ranked " + ordinal(rank) + ". Health score " + hs + ". You're at a crossroads and I need you to make a decision. Now.",
            (rank, hs) => ordinal(rank) + ", health score " + hs + ". Sitting on the fence loses championships. Pick a side.",
            (rank, hs) => "Ranked " + ordinal(rank) + " at " + hs + ". Indecision is a decision — and it's the wrong one.",
        ],
        rebuilding: [
            (rank, hs) => "Ranked " + ordinal(rank) + ". Health score " + hs + ". We're in rebuild mode. That means discipline, not panic.",
            (rank, hs) => ordinal(rank) + " place, health " + hs + ". Rebuilds are won with discipline. Stick to the plan.",
            (rank, hs) => "Health score " + hs + ", ranked " + ordinal(rank) + ". Tear it down right and you only do it once.",
        ],
        waiver: (name, pos, dhq) => name + " is available on the wire. Pick him up before your opponents wake up.",
        trade: (count) => "I've profiled every owner in this league. Time to exploit their weaknesses.",
        draft: (days, date) => days + " days until the draft. You better have your board locked in.",
        rank: (rank, tier) => "You're " + ordinal(rank) + ". " + (rank <= 3 ? "Good. Stay hungry." : "Not good enough. Let's fix it."),
    },
    enthusiast: {
        greeting: (t, name) => "Hey! " + (t < 12 ? 'Good morning' : t < 17 ? 'Good afternoon' : 'Good evening') + "! LET'S GO, " + name + "!",
        elite: [
            (rank, hs) => "ELITE! Man, you are COOKING right now! Health score " + hs + " — that's what I'm talking about!",
            (rank, hs) => "Health score " + hs + " — this roster is LOADED! Keep your foot on the gas!",
            (rank, hs) => "ELITE ROSTER ALERT! You're the team everybody else is scared of right now!",
        ],
        contender: [
            (rank, hs) => "Dude, " + ordinal(rank) + " in the league! Health score " + hs + "! You've got JUICE right now, let's keep it rolling!",
            (rank, hs) => ordinal(rank) + " place with a " + hs + " health score — you are RIGHT THERE! One move away!",
            (rank, hs) => "Health score " + hs + ", sitting " + ordinal(rank) + " — I LOVE this team's ceiling!",
        ],
        crossroads: [
            (rank, hs) => "Okay okay okay — ranked " + ordinal(rank) + ", health score " + hs + ". We're at a CROSSROADS but that's where the MAGIC happens!",
            (rank, hs) => "Ranked " + ordinal(rank) + ", health " + hs + " — big decisions ahead, and honestly? I'm PUMPED about the options!",
            (rank, hs) => ordinal(rank) + " place, health score " + hs + ". Crossroads time — pick a lane and FLOOR IT!",
        ],
        rebuilding: [
            (rank, hs) => "Alright, " + ordinal(rank) + " place, health score " + hs + " — REBUILDING BABY! This is where you lay the foundation for something SPECIAL!",
            (rank, hs) => "Health score " + hs + ", ranked " + ordinal(rank) + " — every dynasty started somewhere! Let's stack some assets!",
            (rank, hs) => "REBUILD SZN! " + ordinal(rank) + " now, health " + hs + " — but the future? OH, it's bright!",
        ],
        waiver: (name, pos, dhq) => "OH MAN — " + name + " is just sitting there on the wire! You GOTTA grab this guy!",
        trade: (count) => "I've been studying every owner in this league and I am FIRED UP about some trade targets!",
        draft: (days, date) => "DRAFT IN " + days + " DAYS! Oh man I love this time of year! Let's get your board DIALED IN!",
        rank: (rank, tier) => "You're #" + rank + "! " + (rank <= 3 ? "TOP THREE BABY!" : "Let's CLIMB!"),
    },
    bayou: {
        greeting: (t, name) => "Mornin', cher. How we doin' today, " + name + "?",
        elite: [
            (rank, hs) => "Boy I tell you what, this roster is NASTY good. Health score " + hs + ". Ain't nobody touchin' us right now.",
            (rank, hs) => "Cher, this roster's the best gumbo in the parish — health score " + hs + ". Don't let it burn.",
            (rank, hs) => "Health score " + hs + ". We eatin' good at the top — but gators circle the fattest boat.",
        ],
        contender: [
            (rank, hs) => "We sittin' at " + ordinal(rank) + ", health score " + hs + ". That's a good gumbo right there — just need a little more seasoning.",
            (rank, hs) => ordinal(rank) + " place, health " + hs + ". Roux's almost ready, cher — one more ingredient.",
            (rank, hs) => "We " + ordinal(rank) + " with a " + hs + " health score. Close enough to smell the crawfish boil.",
        ],
        crossroads: [
            (rank, hs) => "We at a crossroads, " + ordinal(rank) + " place, health score " + hs + ". Time to fish or cut bait, ya heard me?",
            (rank, hs) => ordinal(rank) + " place, health score " + hs + ". Current's pullin' both ways — pick a channel and paddle.",
            (rank, hs) => "We sittin' " + ordinal(rank) + " at " + hs + ". Can't stand in the middle of the river forever, cher.",
        ],
        rebuilding: [
            (rank, hs) => "Look, we " + ordinal(rank) + " right now. Health score " + hs + ". But down here we know how to build somethin' from nothin'.",
            (rank, hs) => ordinal(rank) + " place, health " + hs + ". Swamp teaches patience — plant now, feast later.",
            (rank, hs) => "Health score " + hs + ", cher. We lettin' the pot simmer — good gumbo don't rush.",
        ],
        waiver: (name, pos, dhq) => name + " just fell off somebody's bayou boat and landed right on the wire. Go get 'em.",
        trade: (count) => "I been watchin' these owners real close. Got a few that's ready to make a deal.",
        draft: (days, date) => "Draft's " + days + " days out. Time to set them trotlines and see what we catch.",
        rank: (rank, tier) => "We #" + rank + " in the peckin' order. " + (rank <= 3 ? "Top of the food chain, baby!" : "We comin' for 'em."),
    },
    wit: {
        greeting: (t, name) => (t < 12 ? 'Morning' : t < 17 ? 'Afternoon' : 'Evening') + ", " + name + ". Your opponents didn't get any smarter overnight.",
        elite: [
            (rank, hs) => "Elite tier. Health score " + hs + ". Try not to let it go to your head — though I suppose your leaguemates already have.",
            (rank, hs) => "Health score " + hs + ". Elite. Your leaguemates are drafting their consolation speeches as we speak.",
            (rank, hs) => "Elite roster, health score " + hs + ". The hard part now is pretending it was all skill. It mostly was.",
        ],
        contender: [
            (rank, hs) => ordinal(rank) + " place, health score " + hs + ". Solid enough to be dangerous, not quite good enough to be cocky about it.",
            (rank, hs) => ordinal(rank) + " with a health score of " + hs + ". Contender — a word that means 'good, with homework'.",
            (rank, hs) => "Health score " + hs + ", ranked " + ordinal(rank) + ". One smart move from scary. Or one dumb one from average.",
        ],
        crossroads: [
            (rank, hs) => "Ranked " + ordinal(rank) + ", health score " + hs + ". You're at a crossroads — which, historically, is where people make their worst decisions. Let's not do that.",
            (rank, hs) => ordinal(rank) + ", health score " + hs + ". Crossroads teams either commit or collect regrets. Your call.",
            (rank, hs) => "Health " + hs + ", ranked " + ordinal(rank) + ". Two roads diverged; Robert Frost wasn't in a dynasty league.",
        ],
        rebuilding: [
            (rank, hs) => ordinal(rank) + " place. Health score " + hs + ". Rebuilding. The good news? It's hard to get worse. The bad news? Your leaguemates know it too.",
            (rank, hs) => ordinal(rank) + " place, health score " + hs + ". Rebuilding — a marathon your leaguemates keep mistaking for a nap.",
            (rank, hs) => "Health score " + hs + ", ranked " + ordinal(rank) + ". The rebuild is on schedule, which is more than most can say.",
        ],
        waiver: (name, pos, dhq) => name + " is sitting on the waiver wire like a forgotten lunch. Someone's going to eat eventually — might as well be you.",
        trade: (count) => "I've studied every owner in your league. Some of them actually think they're good at this.",
        draft: (days, date) => days + " days to the draft. Plenty of time for your opponents to overthink their boards.",
        rank: (rank, tier) => "#" + rank + " in the league. " + (rank <= 3 ? "Not bad. Almost impressive." : "Room for improvement, as they say diplomatically."),
    },
    closer: {
        greeting: (t, name) => "Let's go to work, " + name + ".",
        elite: [
            (rank, hs) => "Elite. Period. Health score " + hs + ". Now protect it.",
            (rank, hs) => "Health score " + hs + ". Elite. Champions defend. Defend.",
            (rank, hs) => "Elite roster. Nobody remembers who almost held the title. Hold it.",
        ],
        contender: [
            (rank, hs) => ordinal(rank) + " place. Health score " + hs + ". You play to win the game.",
            (rank, hs) => ordinal(rank) + ". Health " + hs + ". Contender. Contenders who wait become spectators.",
            (rank, hs) => "Health score " + hs + ", " + ordinal(rank) + " place. One move separates you. Find it.",
        ],
        crossroads: [
            (rank, hs) => ordinal(rank) + ". Health score " + hs + ". Crossroads. Make a decision and commit. No half-measures.",
            (rank, hs) => ordinal(rank) + " place. Health " + hs + ". Pick a direction. Today.",
            (rank, hs) => "Health score " + hs + ", " + ordinal(rank) + ". Crossroads. Coffee is for closers — close something.",
        ],
        rebuilding: [
            (rank, hs) => ordinal(rank) + ". Health score " + hs + ". Rebuilding. You don't build a house by wishing — you lay bricks. Let's go.",
            (rank, hs) => ordinal(rank) + ". Health " + hs + ". Rebuild. Every asset. Every edge. No days off.",
            (rank, hs) => "Health score " + hs + ", " + ordinal(rank) + " place. Rebuilding is a job. Show up. Do the work.",
        ],
        waiver: (name, pos, dhq) => name + " is on the wire. Go get him. Done.",
        trade: (count) => "Owners profiled. Weaknesses identified. Time to make moves.",
        draft: (days, date) => days + " days. Draft. Be ready.",
        rank: (rank, tier) => "#" + rank + ". " + (rank <= 3 ? "Keep it." : "Change it."),
    },
    strategist: {
        greeting: (t, name) => (t < 12 ? 'Good morning' : t < 17 ? 'Good afternoon' : 'Good evening') + ", " + name + ". Let's review the board.",
        elite: [
            (rank, hs) => "Health score " + hs + ". Elite positioning. Portfolio is optimized — focus shifts to sustaining competitive advantage.",
            (rank, hs) => "Health score " + hs + ". Elite classification. Priority: retain leverage, avoid overpaying at the margins.",
            (rank, hs) => "Elite-tier portfolio, health " + hs + ". Optimal play: consolidate strengths, sell surplus into demand.",
        ],
        contender: [
            (rank, hs) => "Position: " + ordinal(rank) + ". Health score: " + hs + ". Contender-class roster. Key variable: positional gaps and trade leverage.",
            (rank, hs) => ordinal(rank) + " position, health score " + hs + ". Contender profile — marginal upgrades carry outsized playoff value.",
            (rank, hs) => "Health " + hs + " at " + ordinal(rank) + ". Window open. Allocate capital toward the weakest starting slot.",
        ],
        crossroads: [
            (rank, hs) => "Position: " + ordinal(rank) + ". Health score: " + hs + ". Crossroads classification. Decision matrix: commit to competing or pivot to accumulation.",
            (rank, hs) => ordinal(rank) + " at health " + hs + ". Crossroads profile — expected value favors committing to one direction this window.",
            (rank, hs) => "Position " + ordinal(rank) + ", health score " + hs + ". Two viable paths; hedging between them erodes both.",
        ],
        rebuilding: [
            (rank, hs) => "Position: " + ordinal(rank) + ". Health score: " + hs + ". Rebuild phase. Optimal strategy: maximize asset acquisition, minimize win-now spending.",
            (rank, hs) => ordinal(rank) + ", health " + hs + ". Rebuild horizon is 2+ seasons — trade present production for future capital.",
            (rank, hs) => "Health score " + hs + ", position " + ordinal(rank) + ". Accumulation phase — draft capital compounds faster than veteran value decays.",
        ],
        waiver: (name, pos, dhq) => "Waiver wire analysis: " + name + " at " + pos + " (DHQ " + dhq.toLocaleString() + ") available. Addresses your positional deficit.",
        trade: (count) => count > 0
            ? "Owner analysis complete. " + count + " owner profile" + (count === 1 ? "" : "s") + " analyzed for trade leverage."
            : "Owner analysis queued. Profiles build as league data syncs.",
        draft: (days, date) => "T-minus " + days + " days to draft. Board calibration recommended.",
        rank: (rank, tier) => "League position: " + ordinal(rank) + ". Classification: " + tier + ".",
    },
};

// ══════════════════════════════════════════════════════════════════
// IntelligenceBriefWidget — Alex's greeting + action CTAs
// Renders as a dashboard widget at md / lg / xl sizes. The xl size
// spans the full dashboard grid width for the premium landing look.
// ══════════════════════════════════════════════════════════════════
function IntelligenceBriefWidget({
  size = 'xl',
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
	}) {
    // GM Strategy is the single source of truth — drives Alex's brief voice
    // (alexPersonality) and the fallback waiver filters (faFilters).
    const gm = window.WR.GmMode.useGmEffects(currentLeague);

    const rosterState = window.App?.getRosterDataState?.({ roster: myRoster, currentLeague, rosters: currentLeague?.rosters }) || { isUsable: true };
    const myAssess = typeof window.assessTeamFromGlobal === 'function' ? window.assessTeamFromGlobal(myRoster?.roster_id) : null;
    const tier = (myAssess?.tier || 'UNKNOWN').toUpperCase();
    const hs = myAssess?.healthScore || 0;
    const needs = rosterState.isUsable ? (myAssess?.needs || []) : [];
    const elites = rosterState.isUsable && typeof window.App?.countElitePlayers === 'function' ? window.App.countElitePlayers(myRoster?.players || []) : 0;
    const myRank = rosterState.isUsable ? ((rankedTeams || []).findIndex(t => t.userId === sleeperUserId) + 1) : 0;
    const scores = window.App?.LI?.playerScores || {};
    const ownerProfiles = window.App?.LI?.ownerProfiles || {};

    // FAAB
    const budget = currentLeague?.settings?.waiver_budget || 0;
    const spent = myRoster?.settings?.waiver_budget_used || 0;
    const faabRemaining = Math.max(0, budget - spent);

	    // free-agency.js is a deferred module group (see js/module-loader.js); it owns
	    // getFreeAgencyBriefTarget. Kick off the load and recompute once it lands so the
	    // brief upgrades from the rough waiver heuristic to the real action target.
	    const [faModuleTick, setFaModuleTick] = useState(0);
	    useEffect(() => {
	        if (typeof window.App?.getFreeAgencyBriefTarget === 'function') return;
	        if (!window.wrLoadModuleGroup) return;
	        let alive = true;
	        window.wrLoadModuleGroup('fa').then(() => { if (alive) setFaModuleTick(1); }).catch(() => {});
	        return () => { alive = false; };
	    }, []);

	    // Best waiver target
	    const waiverTarget = useMemo(() => {
	        if (!rosterState.isUsable) return null;
	        const hasActionTargetHelper = typeof window.App?.getFreeAgencyBriefTarget === 'function';
	        const actionTarget = hasActionTargetHelper ? window.App.getFreeAgencyBriefTarget({
	            playersData,
	            statsData,
	            prevStatsData,
	            myRoster,
	            currentLeague,
	            briefDraftInfo,
	            rosterState,
	        }) : null;
	        if (actionTarget) {
	            return {
	                pid: actionTarget.pid,
	                name: actionTarget.name || actionTarget.p?.full_name || '',
	                dhq: actionTarget.dhq || 0,
	                pos: actionTarget.pos || '',
	                team: actionTarget.p?.team || actionTarget.team || '',
	                why: actionTarget.why,
	                faab: actionTarget.faab,
	            };
	        }
	        if (hasActionTargetHelper) return null;
	        if (!needs.length) return null;
	        const normPos = window.App?.normPos || (p => p);
        const rostered = new Set();
        (currentLeague?.rosters || []).forEach(r => (r.players || []).concat(r.taxi || [], r.reserve || []).forEach(pid => rostered.add(String(pid))));
        // GM Strategy FA filters — keep this rough fallback consistent with the FA tab.
        const faF = gm.faFilters || null;
        const faMinDhq = Number(faF?.minDhq) || 0;
        const faMaxAge = Number(faF?.maxAge) || 0;
        const faExclude = new Set((Array.isArray(faF?.excludePositions) ? faF.excludePositions : [])
            .map(x => String(normPos(x) || x).toUpperCase()).filter(Boolean));
        const passesGmFa = (pid, p, pos) => {
            if (faMinDhq && (scores[pid] || 0) < faMinDhq) return false;
            if (faExclude.has(String(pos).toUpperCase())) return false;
            if (faMaxAge && Number(p.age) && Number(p.age) > faMaxAge) return false;
            return true;
        };
        const needPos = typeof needs[0] === 'string' ? needs[0] : needs[0]?.pos;
        if (!needPos) return null;
        const candidates = Object.entries(playersData || {})
            .filter(([pid, p]) => !rostered.has(pid) && normPos(p.position) === needPos && p.team && p.active !== false && (scores[pid] || 0) >= 1500 && passesGmFa(pid, p, needPos))
            .map(([pid, p]) => ({ pid, name: p.full_name || '', dhq: scores[pid] || 0, pos: needPos, team: p.team }))
            .sort((a, b) => b.dhq - a.dhq);
        if (!candidates.length && needs.length > 1) {
            for (let i = 1; i < Math.min(needs.length, 4); i++) {
                const altPos = typeof needs[i] === 'string' ? needs[i] : needs[i]?.pos;
                if (!altPos) continue;
                const alt = Object.entries(playersData || {})
                    .filter(([pid, p]) => !rostered.has(pid) && normPos(p.position) === altPos && p.team && p.active !== false && (scores[pid] || 0) >= 1500 && passesGmFa(pid, p, altPos))
                    .map(([pid, p]) => ({ pid, name: p.full_name || '', dhq: scores[pid] || 0, pos: altPos, team: p.team }))
                    .sort((a, b) => b.dhq - a.dhq);
                if (alt.length) return alt[0];
            }
        }
        return candidates[0] || null;
	    }, [rosterState.isUsable, needs, playersData, statsData, prevStatsData, myRoster, currentLeague, briefDraftInfo, scores, timeRecomputeTs, faModuleTick, gm.faFilters]);

    // Sell-rule trips — rostered players whose position/age trips a GM sell
    // rule or sell-position (untouchables excluded). Feeds the 'GM plan says
    // move them' action below; same parse the My Roster nudge uses.
    const sellRuleTrips = useMemo(() => {
        if (!gm.hasStrategy || !rosterState.isUsable) return [];
        const normPos = window.App?.normPos || (p => p);
        const parseRule = window.GMStrategy?.parseSellRule;
        const rules = (gm.sellRules || [])
            .map(r => { try { return parseRule ? parseRule(r) : null; } catch (_) { return null; } })
            .filter(r => r && (r.pos || r.ageAbove));
        const sellPos = gm.sellPositions instanceof Set ? gm.sellPositions : new Set();
        const unt = gm.untouchable instanceof Set ? gm.untouchable : new Set();
        if (!rules.length && !sellPos.size) return [];
        return (myRoster?.players || []).map(pid => {
            if (unt.has(String(pid))) return null;
            const p = playersData?.[pid];
            if (!p) return null;
            const pos = normPos(p.position) || p.position;
            const trips = sellPos.has(pos) || rules.some(r => (!r.pos || r.pos === pos) && (!r.ageAbove || (Number(p.age) && Number(p.age) >= r.ageAbove)));
            if (!trips) return null;
            return { pid, name: p.full_name || pid, pos, dhq: scores[pid] || 0 };
        }).filter(Boolean).sort((a, b) => b.dhq - a.dhq).slice(0, 3);
    }, [gm.hasStrategy, gm.sellRules, gm.sellPositions, gm.untouchable, myRoster, playersData, scores, rosterState.isUsable]);

    // Key drops (high-value players dropped in last 3 weeks)
    const keyDrops = useMemo(() => {
        const drops = [];
        const transactions = window.S?.transactions || {};
        const curWeek = window.S?.currentWeek || 1;
        for (let w = curWeek; w >= Math.max(1, curWeek - 2); w--) {
            ((transactions['w' + w]) || []).forEach(t => {
                if (t.type !== 'free_agent' && t.type !== 'waiver') return;
                Object.keys(t.drops || {}).forEach(pid => {
                    const dhq = scores[pid] || 0;
                    if (dhq >= 1500) drops.push({ pid, name: playersData?.[pid]?.full_name || '?', dhq, pos: playersData?.[pid]?.position || '?' });
                });
            });
        }
        return drops.sort((a, b) => b.dhq - a.dhq).slice(0, 3);
    }, [scores, playersData]);

    // Draft countdown
    const draftCountdown = useMemo(() => {
        if (!briefDraftInfo?.start_time || briefDraftInfo.status !== 'pre_draft') return null;
        const diff = briefDraftInfo.start_time - Date.now();
        if (diff <= 0) return null;
        const days = Math.floor(diff / 86400000);
        const hours = Math.floor((diff % 86400000) / 3600000);
        return { days, hours, date: new Date(briefDraftInfo.start_time).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) };
    }, [briefDraftInfo]);

    // Active trades in league — the brief says "recently", so window to the
    // last ~3 week buckets and skip DHQ-merged historical trades (_fromDHQ),
    // which can span prior seasons.
    const activeTrades = useMemo(() => {
        const txns = window.S?.transactions || {};
        const curWeek = window.S?.currentWeek || 1;
        let n = 0;
        for (let w = curWeek; w >= Math.max(0, curWeek - 2); w--) {
            ((txns['w' + w]) || []).forEach(t => { if (t.type === 'trade' && !t._fromDHQ) n++; });
        }
        return n;
    }, []);

    // Greeting based on time of day + personality
    const hour = new Date().getHours();
    const userName = window.S?.user?.display_name || window.S?.user?.username || 'Commander';
    // GM Strategy's alexPersonality wins over the legacy wr_alex_style key.
    // Map the strategy voice to the closest BRIEF_PERSONALITY preset; fall back
    // to wr_alex_style / default only when the user has no GM Strategy yet.
    const GM_VOICE_TO_BRIEF = { aggressive: 'closer', value_hunter: 'strategist', balanced: 'default' };
    const alexStyle = (gm.hasStrategy && GM_VOICE_TO_BRIEF[gm.alexPersonality])
        || localStorage.getItem('wr_alex_style')
        || 'default';
    const p = BRIEF_PERSONALITY[alexStyle] || BRIEF_PERSONALITY.default;
    const greetingText = p.greeting(hour, userName);

    // Build Alex's conversational briefing
    const needPos = needs.length ? (typeof needs[0] === 'string' ? needs[0] : needs[0]?.pos) : '';
    // Seeded tier read: stable within a league+week (no flicker across
    // re-renders), fresh phrasing when the week rolls over.
    const tierSeed = String(currentLeague?.league_id || currentLeague?.id || 'wr') + ':w' + (window.S?.currentWeek || 0) + ':' + tier;
    const pickTier = (pool) => {
        const arr = Array.isArray(pool) ? pool : [pool];
        const fn = (window.AlexVoice && typeof window.AlexVoice.pick === 'function') ? window.AlexVoice.pick(tierSeed, arr) : arr[0];
        return typeof fn === 'function' ? fn(myRank, hs) : String(fn || '');
    };
    // UNKNOWN tier = assessment hasn't loaded — never let it fall through to
    // the rebuilding copy ('ranked 0th, health score 0' as fact). Same for a
    // known tier with no rank yet: don't interpolate ordinal(0).
    const tierMsg = !rosterState.isUsable ? (rosterState.brief || 'Roster sync incomplete. I paused roster, trade, waiver, and league-rank recommendations until player IDs finish loading.')
        : (!myAssess || tier === 'UNKNOWN') ? 'Still syncing your league read — I’ll have your tier, rank, and health score once the data lands.'
        : tier === 'ELITE' ? pickTier(p.elite)
        : myRank <= 0 ? ('Your roster reads ' + tier + ' with a health score of ' + hs + ' — league rank is still syncing.')
        : tier === 'CONTENDER' ? pickTier(p.contender)
        : tier === 'CROSSROADS' ? pickTier(p.crossroads)
        : pickTier(p.rebuilding);

    // AlexSettings focus areas — the narrative fragments are gated by whichever
    // areas the user has enabled, so turning off "trades" or "waivers" in
    // Alex Insights quiets those lines here too.
    const alexFocus = (window.WR?.AlexSettings?.get?.()?.focus) || { trades: true, waivers: true, gmStyle: true };

    // ONE strategy-frame lead sentence (owner rule: frame only — never restate
    // adjacent KPIs). Built from the committed GM plan, not the roster grade.
    const TIMELINE_FRAME = { '1_year': 'all-in on this season', '2_3_years': 'building for a 2-3 year window', 'dynasty_long': 'playing the long game' };
    const strategyFrame = gm.hasStrategy
        ? 'Your plan: ' + (gm.modeLabel || gm.mode) + ', ' + (TIMELINE_FRAME[gm.timeline] || 'on your timeline') + ' — everything below is read against that.'
        : '';

    // Brief prose at tall/xl/default: strategy frame (lead) + tier read, and
    // nothing else. Elites, gaps, trades, and FAAB all render as KPIs or
    // action rows on this same widget — never narrated twice (de-busying
    // rule: prose is a lead, not a summary).
    const briefText = strategyFrame ? strategyFrame + ' ' + tierMsg : tierMsg;

    // Three-sentence summary — fits a 160px-tall md row, no scroll
    const threeSentence = (() => {
        if (!rosterState.isUsable) return tierMsg + ' ' + rosterState.message;
        const parts = [];
        if (strategyFrame) parts.push(strategyFrame);
        parts.push(tierMsg);
        if (needPos && alexFocus.gmStyle !== false) parts.push(`Biggest gap: ${needPos}.`);
        else if (elites > 0) parts.push(`${elites} elite anchor${elites > 1 ? 's' : ''}.`);
        if (waiverTarget && alexFocus.waivers !== false) parts.push(`${waiverTarget.name} (${waiverTarget.pos}) sitting on the wire.`);
        else if (draftCountdown) parts.push(draftCountdown.days === 0 ? 'Draft is today.' : `Draft in ${draftCountdown.days} day${draftCountdown.days !== 1 ? 's' : ''}.`);
        else if (activeTrades > 0 && alexFocus.trades !== false) parts.push(`${activeTrades} recent trade${activeTrades > 1 ? 's' : ''} in your league.`);
        else if (myRank > 0) parts.push(`Ranked ${ordinal(myRank)} in the league.`);
        else parts.push('League rank still syncing.');
        return parts.slice(0, 3).join(' ');
    })();

    // One-sentence headline — used at lg
    const oneSentence = tierMsg;

    const alexAvatar = (() => {
        const key = localStorage.getItem('wr_alex_avatar') || 'brain';
        const map = { brain:'\u{1F9E0}', target:'\u{1F3AF}', chart:'\u{1F4CA}', football:'\u{1F3C8}', bolt:'\u26A1', fire:'\u{1F525}', medal:'\u{1F396}\uFE0F', trophy:'\u{1F3C6}' };
        return map[key] || '\u{1F9E0}';
    })();

    const cardStyle = { background: 'var(--black)', border: 'var(--card-border, 1px solid var(--acc-line1, rgba(212,175,55,0.2)))', borderRadius: 'var(--card-radius, 10px)', height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' };
    const goTo = (target) => {
        if (navigateWidget) navigateWidget(target);
        else if (setActiveTab) setActiveTab(target);
    };

    // ── Action list (priority-ordered, focus-gated) ─────────────────
    let actions = [];
    if (!rosterState.isUsable) {
        const rosterCopy = rosterState.leagueSkin?.copy?.rosterData || {};
        const isPreDraftEmpty = !!rosterState.isPreDraftRosterEmpty;
        actions.push({
            icon: isPreDraftEmpty ? '📋' : '↻',
            tab: rosterCopy.actionTarget === 'draft' ? 'draft' : 'myteam',
            title: isPreDraftEmpty ? 'Open draft prep while rosters are empty.' : 'Re-sync roster data before making a move.',
            detail: rosterState.message + ' ' + rosterState.detail,
        });
    } else {
    // GM Strategy annotation: flag the waiver target when it fills a position
    // the plan says to acquire (same tag FA's priority adds compute).
    const waiverIsGmTarget = !!(waiverTarget && gm.hasStrategy && gm.targetPositions instanceof Set && gm.targetPositions.has(String(waiverTarget.pos)));
    if (alexFocus.waivers !== false && waiverTarget) {
        actions.push({
            icon: '🎯', tab: 'fa',
	            title: p.waiver(waiverTarget.name, waiverTarget.pos, waiverTarget.dhq),
	            detail: [
	                React.createElement('span', { key: 'n', style: { color: 'var(--gold)', cursor: 'pointer', textDecoration: 'underline', textUnderlineOffset: '2px' }, onClick: e => { e.stopPropagation(); if (typeof window.openPlayerModal === 'function' && waiverTarget.pid) window.openPlayerModal(waiverTarget.pid); } }, waiverTarget.name),
	                ` · ${waiverTarget.pos} · DHQ ${waiverTarget.dhq.toLocaleString()} · ${waiverTarget.why || ('Fills your ' + waiverTarget.pos + ' gap.')}${waiverIsGmTarget ? ' · GM plan: target position' : ''}`,
	            ],
	        });
    }
    if (alexFocus.waivers !== false && keyDrops.length > 0) {
        actions.push({
            icon: '⚠️', tab: 'fa',
            title: `Heads up — ${keyDrops.length > 1 ? 'some high-value players hit' : 'a high-value player hit'} the wire recently.`,
            detail: [
                ...keyDrops.map((d, i) => [
                    i > 0 ? ', ' : '',
                    React.createElement('span', { key: d.pid || i, style: { color: 'var(--gold)', cursor: 'pointer', textDecoration: 'underline', textUnderlineOffset: '2px' }, onClick: e => { e.stopPropagation(); if (typeof window.openPlayerModal === 'function' && d.pid) window.openPlayerModal(d.pid); } }, `${d.name} (${d.pos}, ${d.dhq.toLocaleString()})`),
                ]).flat(),
                '. Might be worth scooping up before someone else does.',
            ],
        });
    }
    // Sell-rule action — the GM plan's own move. Rebuild / sell-high plans
    // act on sells FIRST (front of the queue); otherwise it slots ahead of
    // the generic trade CTA.
    if (alexFocus.trades !== false && sellRuleTrips.length > 0) {
        const sellAction = {
            icon: '📉', tab: 'myteam',
            title: sellRuleTrips.length + ' rostered player' + (sellRuleTrips.length > 1 ? 's trip' : ' trips') + ' your sell rules.',
            detail: sellRuleTrips.map(t => t.name + ' (' + t.pos + ')').join(', ') + ' — your GM plan says move ' + (sellRuleTrips.length > 1 ? 'them' : 'him') + ' while the value holds.',
        };
        if (gm.mode === 'rebuild' || gm.marketPosture === 'sell_high') actions.unshift(sellAction);
        else actions.push(sellAction);
    }
    if (alexFocus.trades !== false) {
        actions.push({
            icon: '🔄', tab: 'trades',
            title: p.trade(Object.keys(ownerProfiles).length),
            detail: 'Let me show you who needs what — and what you could get in return.',
        });
    }
    if (alexFocus.draft !== false && draftCountdown) {
        actions.push({
            icon: '📋', tab: 'draft',
            // '0 days out' reads wrong — inside 24h the draft is today.
            title: draftCountdown.days === 0 ? 'Draft is today. Time to lock in your board.' : p.draft(draftCountdown.days, draftCountdown.date),
            detail: `${draftCountdown.date} · I've got your scouting report ready when you are.`,
        });
    }
    actions.push({
        icon: '🏆', tab: 'analytics',
        // No rank/tier claims until the assessment has actually landed.
        title: (myRank > 0 && tier !== 'UNKNOWN') ? p.rank(myRank, tier) : 'League standings still syncing — see how the field stacks up.',
        detail: (tier !== 'UNKNOWN' ? `${tier} tier · ` : '') + 'See where everyone else stands.',
    });
    }

    // ── Reusable action button ───────────────────────────────────────
    const baseBtn = { background: 'var(--acc-fill1, rgba(212,175,55,0.05))', border: '1px solid var(--acc-fill3, rgba(212,175,55,0.15))', borderRadius: '10px', color: 'var(--gold)', cursor: 'pointer', fontFamily: 'var(--font-body)', fontWeight: 500, textAlign: 'left', display: 'flex', alignItems: 'flex-start', gap: '10px', transition: 'all 0.15s', lineHeight: 1.4 };
    function renderActionBtn(a, key, opts = {}) {
        const compact = !!opts.compact;
        const btnStyle = {
            ...baseBtn,
            padding: compact ? '6px 10px' : '12px 16px',
            minHeight: '44px',
            fontSize: compact ? '0.72rem' : '0.82rem',
            ...(opts.style || {}),
        };
        return React.createElement('button', {
            key,
            onClick: () => goTo(a.tab), style: btnStyle,
            onMouseEnter: e => e.currentTarget.style.background = 'var(--acc-fill3, rgba(212,175,55,0.15))',
            onMouseLeave: e => e.currentTarget.style.background = 'var(--acc-fill1, rgba(212,175,55,0.05))',
        },
            React.createElement('span', { style: { fontSize: compact ? '0.85rem' : '1rem', flexShrink: 0 } }, a.icon),
            React.createElement('div', { style: { minWidth: 0, flex: 1 } },
                React.createElement('div', { style: { fontWeight: 600, color: 'var(--white)', fontSize: compact ? '0.74rem' : '0.85rem' } }, a.title),
                !compact && React.createElement('div', { style: { fontSize: 'var(--text-label, 0.75rem)', color: 'var(--silver)', marginTop: '2px' } },
                    Array.isArray(a.detail) ? a.detail : a.detail
                ),
            ),
        );
    }

    // ── Reusable header ─────────────────────────────────────────────
    function header(opts = {}) {
        const tight = !!opts.tight;
        return React.createElement('div', { style: { padding: tight ? '8px 14px 6px' : '20px 20px 0', borderBottom: '1px solid var(--acc-fill2, rgba(212,175,55,0.1))', paddingBottom: tight ? '6px' : '12px', flexShrink: 0 } },
            React.createElement('div', { style: { fontFamily: 'Rajdhani, sans-serif', fontSize: tight ? '0.62rem' : '0.72rem', color: 'var(--gold)', letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: tight ? '2px' : '4px', display: 'flex', alignItems: 'center', gap: '6px' } },
                React.createElement('span', { style: { fontSize: tight ? '0.8rem' : '0.9rem' } }, alexAvatar),
                'INTELLIGENCE BRIEFING',
            ),
            React.createElement('div', { style: { fontSize: tight ? '0.92rem' : '1.2rem', fontWeight: 700, color: 'var(--white)' } }, greetingText),
        );
    }

    // ── FREE TEASER (all sizes) — Scout Today-brief precedent ────────
    // Free sees the greeting + section titles with counts only: the tier
    // read (tierMsg/briefText) and the action recs (waiver target, trade
    // steers, CTAs) never reach the DOM. Defense-in-depth behind the
    // dashboard registry gate (WIDGET_MODULES['intel-brief'].pro).
    const briefPro = typeof window.wrIsPro !== 'function' || window.wrIsPro();
    if (!briefPro) {
        const tight = size === 'md' || size === 'lg' || size === 'xl';
        const teaserRows = [
            { label: "Alex's read", count: '1 briefing' },
            { label: 'Action items', count: actions.length + ' queued' },
        ];
        return React.createElement('div', { style: cardStyle },
            header({ tight }),
            React.createElement('div', { style: { padding: tight ? '10px 14px' : '14px 20px', flex: 1, display: 'flex', flexDirection: 'column', gap: '6px', overflow: 'hidden' } },
                ...teaserRows.map((r, i) => React.createElement('div', { key: i, style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', padding: '7px 10px', background: 'var(--ov-1, rgba(255,255,255,0.02))', border: '1px solid var(--ov-4, rgba(255,255,255,0.06))', borderRadius: '2px', flexShrink: 0 } },
                    React.createElement('span', { style: { fontSize: 'var(--text-label, 0.75rem)', fontWeight: 700, color: 'var(--silver)', textTransform: 'uppercase', letterSpacing: '0.06em' } }, r.label),
                    React.createElement('span', { style: { fontSize: 'var(--text-label, 0.75rem)', color: 'var(--silver)', opacity: 0.6, fontFamily: "'JetBrains Mono', monospace" } }, r.count),
                )),
                typeof window.WrGatedMoreRow === 'function'
                    ? React.createElement(window.WrGatedMoreRow, {
                        title: 'Unlock the full brief',
                        sub: "Alex's roster read + " + actions.length + ' prioritized action' + (actions.length === 1 ? '' : 's'),
                        feature: 'briefing_reasoning',
                    })
                    : null,
            ),
        );
    }

    // ── md (2×1, 160px tall) — 3 sentences, no scroll ────────────────
    if (size === 'md') {
        return React.createElement('div', { onClick: () => goTo('alex'), style: { ...cardStyle, cursor: 'pointer' } },
            header({ tight: true }),
            React.createElement('div', { style: { padding: '10px 14px', flex: 1, display: 'flex', alignItems: 'center', overflow: 'hidden' } },
                React.createElement('div', { style: { fontSize: 'var(--text-body, 1rem)', color: 'var(--silver)', lineHeight: 1.5, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical' } }, threeSentence),
            ),
        );
    }

    // ── lg (2×2, 320px tall) — 1 sentence + 3 actions, no scroll ─────
    if (size === 'lg') {
        const top3 = actions.slice(0, 3);
        return React.createElement('div', { style: cardStyle },
            header({ tight: true }),
            React.createElement('div', { style: { padding: '10px 14px', flex: 1, display: 'flex', flexDirection: 'column', gap: '8px', overflow: 'hidden' } },
                React.createElement('div', { style: { fontSize: 'var(--text-body, 1rem)', color: 'var(--silver)', lineHeight: 1.5, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', flexShrink: 0 } }, oneSentence),
                React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '5px', flex: 1, minHeight: 0 } },
                    ...top3.map((a, i) => renderActionBtn(a, 'lg-' + i, { compact: true, titleClamp: 1 })),
                ),
            ),
        );
    }

    // ── tall (2×4, 640px tall) — full vertical layout ────────────────
    if (size === 'tall') {
        return React.createElement('div', { style: cardStyle },
            header(),
            React.createElement('div', { style: { padding: '16px 20px', flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' } },
                React.createElement('div', { style: { fontSize: 'var(--text-body, 1rem)', color: 'var(--silver)', lineHeight: 1.75, marginBottom: '20px', overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 6, WebkitBoxOrient: 'vertical', flexShrink: 0 } }, briefText),
                React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px' } },
                    ...actions.slice(0, 5).map((a, i) => renderActionBtn(a, 'tall-' + i)),
                ),
            ),
        );
    }

    // ── xl (4×2, 320×640) — split columns, no scroll ─────────────────
    if (size === 'xl') {
        const top4 = actions.slice(0, 4);
        return React.createElement('div', { style: cardStyle },
            header({ tight: true }),
            React.createElement('div', { style: { padding: '10px 14px', flex: 1, display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: '14px', overflow: 'hidden' } },
                React.createElement('div', { style: { fontSize: 'var(--text-body, 1rem)', color: 'var(--silver)', lineHeight: 1.65, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 9, WebkitBoxOrient: 'vertical' } }, briefText),
                React.createElement('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px', minHeight: 0 } },
                    ...top4.map((a, i) => renderActionBtn(a, 'xl-' + i, { compact: true, titleClamp: 2 })),
                ),
            ),
        );
    }

    // ── xxl (4×4, ~640×640) — full real-estate dashboard ─────────────
    if (size === 'xxl') {
        const posBars = (window.App?.calcPosGrades?.(myRoster?.roster_id, currentLeague?.rosters, playersData) || []);

        const myDHQ = (myRoster?.players || []).reduce((s, pid) => s + (window.App?.LI?.playerScores?.[pid] || 0), 0);
        const kpis = [
            { label: 'HEALTH', value: hs, col: hs >= 80 ? 'var(--good)' : hs >= 60 ? 'var(--gold)' : hs >= 40 ? 'var(--warn)' : 'var(--bad)' },
            { label: 'RANK', value: '#' + (myRank || '—'), col: 'var(--gold)' },
            { label: 'TIER', value: tier, col: tier === 'ELITE' ? 'var(--good)' : tier === 'CONTENDER' ? 'var(--gold)' : tier === 'CROSSROADS' ? 'var(--warn)' : 'var(--bad)' },
            { label: 'ELITES', value: elites, col: 'var(--good)' },
            { label: 'DHQ', value: myDHQ >= 1000 ? Math.round(myDHQ / 1000) + 'k' : myDHQ, col: 'var(--gold)' },
            { label: 'FAAB', value: budget > 0 ? '$' + faabRemaining : '—', col: 'var(--k-7c6bf8, #7c6bf8)' },
        ];

        return React.createElement('div', { style: cardStyle },
            header(),
            React.createElement('div', { style: { padding: '14px 20px', flex: 1, display: 'flex', flexDirection: 'column', gap: '12px', overflow: 'hidden' } },
                React.createElement('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: '6px', flexShrink: 0 } },
                    ...kpis.map((k, i) => React.createElement('div', {
                        key: i,
                        style: { background: 'var(--ov-1, rgba(255,255,255,0.02))', border: '1px solid var(--ov-4, rgba(255,255,255,0.06))', borderRadius: '6px', padding: '8px 6px', textAlign: 'center' },
                    },
                        React.createElement('div', { style: { fontFamily: 'JetBrains Mono, monospace', fontSize: '1.1rem', fontWeight: 700, color: k.col, lineHeight: 1.1 } }, String(k.value)),
                        React.createElement('div', { style: { fontSize: 'var(--text-label, 0.75rem)', color: 'var(--silver)', textTransform: 'uppercase', letterSpacing: '0.06em', marginTop: '3px' } }, k.label),
                    )),
                ),
                React.createElement('div', { style: { flexShrink: 0 } },
                    React.createElement('div', { style: { fontSize: 'var(--text-label, 0.75rem)', fontWeight: 700, color: 'var(--gold)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '6px' } }, 'Position Health'),
                    React.createElement('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(8, 1fr)', gap: '6px' } },
                        ...posBars.map((pb, i) => React.createElement('div', { key: i, style: { textAlign: 'center' } },
                            React.createElement('div', { style: { fontSize: 'var(--text-label, 0.75rem)', fontWeight: 700, color: 'var(--silver)' } }, pb.pos),
                            React.createElement('div', { style: { fontFamily: 'JetBrains Mono, monospace', fontSize: '1rem', fontWeight: 700, color: pb.col, lineHeight: 1, margin: '2px 0' } }, pb.grade),
                            React.createElement('div', { style: { height: 4, background: 'var(--ov-4, rgba(255,255,255,0.06))', borderRadius: 2, overflow: 'hidden' } },
                                React.createElement('div', { style: { width: pb.pct + '%', height: '100%', background: pb.col } }),
                            ),
                            React.createElement('div', { style: { fontSize: 'var(--text-label, 0.75rem)', color: 'var(--silver)', opacity: 0.6, marginTop: '2px', fontFamily: 'JetBrains Mono, monospace' } }, '#' + pb.rank + '/' + pb.totalTeams),
                        )),
                    ),
                ),
                // "Alex's Read" column dropped (de-busying Q2): its prose only
                // restated the KPI row above. Actions stand alone, full width,
                // non-compact so the detail lines carry the specifics.
                React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px', flex: 1, minHeight: 0, overflow: 'hidden' } },
                    React.createElement('div', { style: { fontSize: 'var(--text-label, 0.75rem)', fontWeight: 700, color: 'var(--gold)', textTransform: 'uppercase', letterSpacing: '0.08em' } }, 'Action Items'),
                    ...actions.slice(0, 5).map((a, i) => renderActionBtn(a, 'xxl-' + i)),
                ),
            ),
        );
    }

    // Default: tall layout
    return React.createElement('div', { style: cardStyle },
        header(),
        React.createElement('div', { style: { padding: '16px 20px', flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' } },
            React.createElement('div', { style: { fontSize: 'var(--text-body, 1rem)', color: 'var(--silver)', lineHeight: 1.75, marginBottom: '20px', overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 6, WebkitBoxOrient: 'vertical', flexShrink: 0 } }, briefText),
            React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px' } },
                ...actions.slice(0, 5).map((a, i) => renderActionBtn(a, 'def-' + i)),
            ),
        ),
    );
}

// ══════════════════════════════════════════════════════════════════
// FieldNotesWidget — Scout/War Room session log feed (v2)
// Groups entries by type (icon-derived) so users see a clear breakdown.
// All sizes are no-scroll: smaller sizes show counts/last entry, larger
// sizes show grouped sections with cap on entries per group.
// ══════════════════════════════════════════════════════════════════
function FieldNotesWidget({ size = 'lg', navigateWidget }) {
    const [fieldEntries, setFieldEntries] = useState([]);
    useEffect(() => {
        const fallback = () => {
            try {
                const raw = localStorage.getItem('scout_field_log_v1');
                if (raw) { const parsed = JSON.parse(raw); if (Array.isArray(parsed)) setFieldEntries(parsed.slice(0, 30)); }
            } catch {}
        };
        if (window.OD?.loadFieldLog) {
            window.OD.loadFieldLog(null, 30).then(data => {
                if (data && data.length) setFieldEntries(data);
                else fallback();
            }).catch(fallback);
        } else {
            fallback();
        }
    }, []);

    // Group entries by their `category` field (set when the action is logged).
    // Fall back to source-based grouping when category is missing.
    const CATEGORY_META = {
        roster:    { label: 'Roster moves',  color: 'var(--good)' },
        trade:     { label: 'Trade activity', color: 'var(--k-7c6bf8, #7c6bf8)' },
        waiver:    { label: 'Waiver moves',  color: 'var(--k-00c8b4, #00c8b4)' },
        draft:     { label: 'Draft prep',     color: 'var(--warn)' },
        research:  { label: 'Research',       color: 'var(--gold)' },
        league:    { label: 'League intel',   color: 'var(--info)' },
        scout:     { label: 'Scout sessions', color: 'var(--k-00c8b4, #00c8b4)' },
        warroom:   { label: 'War Room',       color: 'var(--gold)' },
    };
    const classify = (e) => {
        const cat = (e.category || '').toLowerCase();
        if (cat && CATEGORY_META[cat]) return { key: cat, ...CATEGORY_META[cat] };
        // Fallback by source
        const fallback = e.source === 'warroom' ? 'warroom' : 'scout';
        return { key: fallback, ...CATEGORY_META[fallback] };
    };

    // Group entries by type, sorted by recency within
    const groups = useMemo(() => {
        const out = {};
        (fieldEntries || []).forEach(e => {
            const r = classify(e);
            if (!out[r.key]) out[r.key] = { key: r.key, label: r.label, color: r.color, entries: [] };
            out[r.key].entries.push(e);
        });
        Object.values(out).forEach(g => g.entries.sort((a, b) => (b.ts || 0) - (a.ts || 0)));
        return Object.values(out).sort((a, b) => b.entries.length - a.entries.length);
    }, [fieldEntries]);

    const totalCount = fieldEntries.length;
    const monoFont = "'JetBrains Mono', monospace";
    const cardStyle = { background: 'var(--black)', border: 'var(--card-border, 1px solid var(--acc-line1, rgba(212,175,55,0.2)))', borderRadius: 'var(--card-radius, 10px)', height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' };
    const openNotes = () => navigateWidget && navigateWidget('fieldNotes');
    const noteCardStyle = { ...cardStyle, cursor: navigateWidget ? 'pointer' : 'default' };

    function fmtTime(ts) {
        if (!ts) return '';
        const d = new Date(ts);
        return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    }

    function renderEntry(e, i) {
        return React.createElement('div', { key: e.id || i, style: { display: 'flex', alignItems: 'center', gap: '6px', padding: '3px 0', fontSize: 'var(--text-label, 0.75rem)', fontFamily: monoFont, borderBottom: '1px solid var(--ov-2, rgba(255,255,255,0.03))' } },
            React.createElement('span', { style: { fontSize: 'var(--text-label, 0.75rem)' } }, e.icon || '📋'),
            React.createElement('span', { style: { flex: 1, color: 'var(--silver)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, e.text || ''),
            React.createElement('span', { style: { fontSize: 'var(--text-label, 0.75rem)', color: 'var(--ov-8, rgba(255,255,255,0.4))' } }, fmtTime(e.ts)),
        );
    }

	    function emptyState(opts = {}) {
	        const tight = !!opts.tight;
	        return React.createElement('div', { style: { textAlign: 'center', padding: tight ? '12px 0' : '28px 16px', color: 'var(--silver)', fontFamily: monoFont, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: tight ? '4px' : '8px', height: '100%', boxSizing: 'border-box' } },
	            React.createElement('div', { style: { fontSize: tight ? '1.1rem' : '1.8rem', opacity: 0.55 } }, '📋'),
	            React.createElement('div', { style: { fontSize: tight ? '0.68rem' : '0.82rem', fontWeight: 800, color: 'var(--white)' } }, 'No decisions logged yet'),
	            React.createElement('div', { style: { fontSize: tight ? '0.58rem' : '0.7rem', lineHeight: 1.45, maxWidth: '24ch', opacity: 0.72 } },
	                tight ? 'Notes appear after saved GM actions.' : 'Saved trade, waiver, draft, and Alex decisions will appear here.'),
	            !tight && React.createElement('button', {
	                type: 'button',
	                onClick: e => { e.stopPropagation(); openNotes(); },
	                style: { marginTop: '4px', border: '1px solid var(--acc-line2, rgba(212,175,55,0.35))', background: 'var(--acc-fill2, rgba(212,175,55,0.08))', color: 'var(--gold)', borderRadius: '6px', padding: '7px 10px', minHeight: '44px', fontSize: 'var(--text-label, 0.75rem)', fontFamily: monoFont, fontWeight: 800, letterSpacing: '0.04em', cursor: navigateWidget ? 'pointer' : 'default' },
	            }, 'OPEN GM OFFICE'),
	        );
	    }

    // ── SLIM (1×2, ~80×160): big number + proportional category bars ──
    if (size === 'slim') {
        const maxCount = Math.max(...groups.map(g => g.entries.length), 1);
        return React.createElement('div', { onClick: openNotes, title: 'Open GM\'s Office', style: noteCardStyle },
            React.createElement('div', { style: { padding: '8px 8px 4px', textAlign: 'center', flexShrink: 0, borderBottom: '1px solid var(--acc-fill2, rgba(212,175,55,0.08))' } },
                React.createElement('div', { style: { fontFamily: monoFont, fontSize: 'var(--text-label, 0.75rem)', color: 'var(--gold)', letterSpacing: '0.08em', textTransform: 'uppercase', fontWeight: 700, marginBottom: '1px' } }, 'NOTES'),
                React.createElement('div', { style: { fontSize: '1.5rem', fontWeight: 700, color: 'var(--white)', fontFamily: monoFont, lineHeight: 1 } }, totalCount),
            ),
            React.createElement('div', { style: { flex: 1, padding: '6px 6px', display: 'flex', flexDirection: 'column', gap: '4px', overflow: 'hidden' } },
                groups.length === 0
                    ? React.createElement('div', { style: { textAlign: 'center', color: 'var(--silver)', opacity: 0.5, fontSize: 'var(--text-label, 0.75rem)', fontFamily: monoFont, padding: '8px 0' } }, 'No notes yet')
                    : groups.slice(0, 5).map(g => {
                        const pct = (g.entries.length / maxCount) * 100;
                        return React.createElement('div', { key: g.key, style: { display: 'flex', flexDirection: 'column', gap: '2px' } },
                            React.createElement('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 'var(--text-label, 0.75rem)', fontFamily: monoFont } },
                                React.createElement('span', { style: { color: g.color, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, g.label.split(' ')[0]),
                                React.createElement('span', { style: { color: 'var(--white)', fontWeight: 700 } }, g.entries.length),
                            ),
                            React.createElement('div', { style: { height: 4, background: 'var(--ov-4, rgba(255,255,255,0.06))', borderRadius: 2, overflow: 'hidden' } },
                                React.createElement('div', { style: { width: pct + '%', height: '100%', background: g.color, transition: '0.3s' } }),
                            ),
                        );
                    }),
            ),
        );
    }

    // ── NARROW (1×4): vertical type counts + a few latest entries ──
    if (size === 'narrow') {
        const latest = fieldEntries.slice(0, 5);
        return React.createElement('div', { onClick: openNotes, title: 'Open GM\'s Office', style: noteCardStyle },
            React.createElement('div', { style: { padding: '8px 8px 6px', borderBottom: '1px solid var(--acc-fill2, rgba(212,175,55,0.1))', flexShrink: 0 } },
                React.createElement('div', { style: { fontFamily: monoFont, fontSize: 'var(--text-label, 0.75rem)', color: 'var(--gold)', letterSpacing: '0.06em', textTransform: 'uppercase', fontWeight: 700 } }, 'FIELD NOTES'),
                React.createElement('div', { style: { fontSize: 'var(--text-label, 0.75rem)', color: 'var(--silver)', marginTop: '1px', fontFamily: monoFont } }, totalCount + ' total'),
            ),
            React.createElement('div', { style: { flex: 1, padding: '6px 8px', display: 'flex', flexDirection: 'column', gap: '6px', overflow: 'hidden' } },
                groups.length === 0 ? emptyState({ tight: true }) : React.createElement(React.Fragment, null,
                    React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '3px' } },
                        ...groups.slice(0, 6).map(g => React.createElement('div', { key: g.key, style: { display: 'flex', alignItems: 'center', gap: '4px', fontSize: 'var(--text-label, 0.75rem)', fontFamily: monoFont } },
                            React.createElement('div', { style: { width: 4, height: 4, borderRadius: 2, background: g.color, flexShrink: 0 } }),
                            React.createElement('span', { style: { color: 'var(--silver)', flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, g.label),
                            React.createElement('span', { style: { fontWeight: 700, color: 'var(--white)' } }, g.entries.length),
                        )),
                    ),
                    React.createElement('div', { style: { borderTop: '1px solid var(--ov-4, rgba(255,255,255,0.06))', paddingTop: '4px', flex: 1, minHeight: 0, overflow: 'hidden' } },
                        React.createElement('div', { style: { fontSize: 'var(--text-label, 0.75rem)', color: 'var(--gold)', letterSpacing: '0.05em', textTransform: 'uppercase', fontWeight: 700, marginBottom: '3px', fontFamily: monoFont } }, 'Recent'),
                        ...latest.map((e, i) => React.createElement('div', { key: i, style: { fontSize: 'var(--text-label, 0.75rem)', color: 'var(--silver)', fontFamily: monoFont, padding: '1px 0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, (e.icon || '·') + ' ' + (e.text || ''))),
                    ),
                ),
            ),
        );
    }

    // ── LG (2×2): grouped sections — top 2 groups, top 3 each ──
    if (size === 'lg') {
        return React.createElement('div', { onClick: openNotes, title: 'Open GM\'s Office', style: noteCardStyle },
            React.createElement('div', { style: { padding: '12px 16px 8px', borderBottom: '1px solid var(--acc-fill2, rgba(212,175,55,0.1))', flexShrink: 0 } },
                React.createElement('div', { style: { fontFamily: monoFont, fontSize: '1rem', color: 'var(--gold)', letterSpacing: '0.08em', textTransform: 'uppercase', fontWeight: 700 } }, 'FIELD NOTES'),
                React.createElement('div', { style: { fontSize: 'var(--text-label, 0.75rem)', color: 'var(--silver)', fontFamily: monoFont, marginTop: '2px' } }, totalCount + ' entries · ' + groups.length + ' types'),
            ),
            React.createElement('div', { style: { padding: '8px 14px', flex: 1, display: 'flex', flexDirection: 'column', gap: '6px', overflow: 'hidden' } },
                groups.length === 0 ? emptyState() :
                    groups.slice(0, 3).map(g => React.createElement('div', { key: g.key, style: { borderLeft: '2px solid ' + g.color, paddingLeft: '8px' } },
                        React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '2px' } },
                            React.createElement('span', { style: { fontSize: 'var(--text-label, 0.75rem)', fontWeight: 700, color: g.color, textTransform: 'uppercase', letterSpacing: '0.06em', fontFamily: monoFont } }, g.label),
                            React.createElement('span', { style: { fontSize: 'var(--text-label, 0.75rem)', color: 'var(--ov-8, rgba(255,255,255,0.4))', fontFamily: monoFont } }, g.entries.length),
                        ),
                        ...g.entries.slice(0, 2).map((e, i) => renderEntry(e, i)),
                    )),
            ),
        );
    }

    // ── TALL (2×4): all groups, more entries each, no scroll ──
    if (size === 'tall') {
        return React.createElement('div', { onClick: openNotes, title: 'Open GM\'s Office', style: noteCardStyle },
            React.createElement('div', { style: { padding: '14px 18px 10px', borderBottom: '1px solid var(--acc-fill2, rgba(212,175,55,0.1))', flexShrink: 0 } },
                React.createElement('div', { style: { fontFamily: monoFont, fontSize: '1.1rem', color: 'var(--gold)', letterSpacing: '0.08em', textTransform: 'uppercase', fontWeight: 700 } }, 'FIELD NOTES'),
                React.createElement('div', { style: { fontSize: 'var(--text-label, 0.75rem)', color: 'var(--silver)', fontFamily: monoFont, marginTop: '2px' } }, 'Intel grouped by type · ' + totalCount + ' entries'),
            ),
            React.createElement('div', { style: { padding: '10px 16px', flex: 1, display: 'flex', flexDirection: 'column', gap: '8px', overflow: 'hidden' } },
                groups.length === 0 ? emptyState() :
                    groups.slice(0, 5).map(g => React.createElement('div', { key: g.key, style: { borderLeft: '2px solid ' + g.color, paddingLeft: '8px' } },
                        React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '3px' } },
                            React.createElement('span', { style: { fontSize: 'var(--text-label, 0.75rem)', fontWeight: 700, color: g.color, textTransform: 'uppercase', letterSpacing: '0.06em', fontFamily: monoFont } }, g.label),
                            React.createElement('span', { style: { fontSize: 'var(--text-label, 0.75rem)', color: 'var(--ov-8, rgba(255,255,255,0.4))', fontFamily: monoFont } }, g.entries.length),
                        ),
                        ...g.entries.slice(0, 3).map((e, i) => renderEntry(e, i)),
                    )),
            ),
        );
    }

    return null;
}

// Expose globally so dashboard.js can render them as widgets
window.IntelligenceBriefWidget = IntelligenceBriefWidget;
window.FieldNotesWidget = FieldNotesWidget;
