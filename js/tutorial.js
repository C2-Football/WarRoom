// ============================================================================
// js/tutorial.js - War Room first-launch GM briefing config.
// Shared engine lives in ReconAI shared/assistant-tutorial.js.
// ============================================================================

const WR_TUTORIAL_CONFIG = {
    productKey: 'warroom',
    version: 'gm-brief-v2',
    legacyKeys: ['wr_tutorial_done_v1'],
    accent: 'var(--k-d4af37, #d4af37)',
    alexPicker: true,
    alexAvatar: true,
    title: "I'm Alex. Let's build a winner.",
    kicker: 'Alex Ingram / Your AI GM',
    intro: "I'm your AI general manager — I read your roster, scout the market, and pressure-test every move before you make it. Two quick questions and I'll have your war room set up. First: how do you want me to talk to you?",
    openingChips: ['90 seconds', 'Set it once', 'Replay anytime in Settings'],
    openingBoard: {
        label: 'How this works',
        title: "Pick a voice, set our mode, see the room",
        body: "Tap a style above to hear how I'll sound. Then I'll ask what we're building, walk you through the desks, and put three real moves on the board.",
    },
    steps: [
        {
            key: 'gm-mode',
            position: 'center',
            title: "What are we building?",
            desc: "This is the one call everything else hangs on. Pick where this team is right now — I'll tune every recommendation, trade read, and draft grade to match. Change it anytime from the badge up top.",
            kicker: 'Set the mission',
            choicePrompt: 'Choose your mode',
            choiceKey: 'wr_tutorial_gm_mode',
            choiceGroup: 'gmMode',
            choices: [
                { value: 'win_now', label: 'Win Now', desc: "Window's open. Spend picks and youth for proven starters." },
                { value: 'compete', label: 'Compete', desc: 'Stay dangerous now, keep building for the next two years.' },
                { value: 'rebuild', label: 'Rebuild', desc: 'Youth, picks, patience. Tear it down, stack the future.' },
            ],
            board: {
                label: 'Why it matters',
                title: 'I argue your side',
                body: "In Win Now I'll push aggressive. In Rebuild I'll talk you off panic trades. Same data, your timeline.",
            },
        },
        {
            key: 'command-center',
            tabToOpen: 'dashboard',
            target: '[data-tab="dashboard"],.sidebar-item:first-child',
            title: 'Home base',
            desc: "Start every session here. My briefing, your team's pressure points, and the signals worth watching all land on this board.",
            kicker: 'Command Center',
            chips: ['My briefing', 'Pressure points', 'Live signals'],
            board: {
                label: 'GM habit',
                title: 'Open here first',
                body: "Read the briefing, then go to the desk that fixes whatever I flagged.",
            },
        },
        {
            key: 'roster-room',
            tabToOpen: 'myteam',
            target: '[data-tab="myteam"]',
            title: 'Your roster',
            desc: "Every player gets a job. DHQ value, age and value windows, depth, and tags tell you who to ride, who to flip, and who's quietly bleeding value.",
            kicker: 'Personnel',
            chips: ['DHQ value', 'Value windows', 'Tap any player'],
            board: {
                label: 'The read',
                title: 'Value is contextual',
                body: "A player is only worth what he's worth to your window and your position room. I score it that way.",
            },
        },
        {
            key: 'deal-room',
            tabToOpen: 'trades',
            target: '[data-tab="trades"]',
            title: 'The deal desk',
            desc: "Where we find the trade before it's obvious. I profile every owner's DNA, match your surplus to their pressure point, and grade the deal before you send it.",
            kicker: 'Negotiation',
            chips: ['Owner DNA', 'Partner fit', 'Deal grade'],
            board: {
                label: 'Leverage',
                title: 'Trade the owner, not the player',
                body: "The best deals come from knowing who's desperate. I track that so you don't have to.",
            },
        },
        {
            key: 'waiver-desk',
            tabToOpen: 'fa',
            target: '[data-tab="fa"]',
            title: 'Waiver desk',
            desc: "I turn waiver chaos into a bid plan — who's worth real FAAB, who's a trap, and exactly how much to spend before someone else does.",
            kicker: 'Acquisitions',
            chips: ['FAAB plan', 'Real targets', 'Bid amounts'],
            board: {
                label: 'The rule',
                title: 'Budget is leverage',
                body: 'Spend when a player raises your weekly ceiling or patches a hole that could sink you.',
            },
        },
        {
            key: 'draft-league-ops',
            tabToOpen: 'draft',
            target: '[data-tab="draft"]',
            title: 'Draft & the long game',
            desc: "Draft Command, League Map, Analytics, Trophy Room — the offices where the season is really won. Pick value, market history, owner tendencies, and league legacy, all in your corner.",
            kicker: 'Season office',
            chips: ['Draft Command', 'League Map', 'Analytics'],
            board: {
                label: 'Long game',
                title: 'I remember the league',
                body: 'Draft capital and owner behavior compound. I keep that history visible so you always know the board.',
            },
        },
    ],
    finishTitle: "You're set. Watch this.",
    finishText: "Voice picked, mode locked, room mapped. Now let me earn it — I'll put the three moves this roster should make right now on the board. Hit finish and I'll meet you in the chat.",
    finishChips: ['Three moves, live', "I'm bottom-right anytime", 'Cmd+K to call me'],
    finishBoard: {
        label: 'First call',
        title: 'I go to work now',
        body: "The second you finish, I'll open up and lay out your top three moves before the rest of the league catches up.",
    },
};

async function shouldShowWRTutorial() {
    if (window.App?.AssistantTutorial?.shouldShow) {
        return window.App.AssistantTutorial.shouldShow(WR_TUTORIAL_CONFIG);
    }
    return !localStorage.getItem('wr_tutorial_done_v1');
}

function startWRTutorial(options) {
    if (!window.App?.AssistantTutorial?.start) return false;
    return window.App.AssistantTutorial.start(WR_TUTORIAL_CONFIG, options || {});
}

function replayWRTutorial() {
    return startWRTutorial({ force: true });
}

// When the user picks a GM Mode inside the tutorial, apply it for real so every
// downstream engine (Alex prompts, trade proposer, draft) is already tuned by the
// time the briefing ends.
window.addEventListener('dhq:tutorial-choice', (e) => {
    try {
        const d = e.detail || {};
        if (d.group !== 'gmMode' || !d.value) return;
        const leagueId = (window.S && window.S.currentLeagueId) || window._wrCurrentLeagueId || null;
        if (window.WR && window.WR.GmMode && typeof window.WR.GmMode.applyPreset === 'function') {
            window.WR.GmMode.applyPreset(leagueId, d.value);
        }
    } catch (err) { if (window.wrLog) window.wrLog('tutorial.gmModeChoice', err); }
});

window.WR_TUTORIAL_CONFIG = WR_TUTORIAL_CONFIG;
window.startWRTutorial = startWRTutorial;
window.shouldShowWRTutorial = shouldShowWRTutorial;
window.replayWRTutorial = replayWRTutorial;
