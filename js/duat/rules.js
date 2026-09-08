/**
 * Original Duat rules for Dynasty HQ. Pure browser/Node module with no runtime
 * dependency on The Duat checkout, React, storage, or a scoring data provider.
 *
 * Heptad and Heavenly Battle preserve the original engines and their calendars.
 * Every tournament receives scores from its caller; absent/non-finite scores
 * pause play. Historical archive standings and example player totals are not
 * part of this game's initial state. FAVORS describes canon, not implemented effects.
 */
(function (root) {
    'use strict';
    const App = root.App = root.App || {};

    function deepFreeze(value) {
        if (value && typeof value === 'object' && !Object.isFrozen(value)) {
            Object.values(value).forEach(deepFreeze);
            Object.freeze(value);
        }
        return value;
    }

    const SACRED_WEEKS = Object.freeze([5,7,10,14,15,16,17]);
    const DUAT_ORIGINAL_ARMY_COUNT = 4;
    const DUAT_ORIGINAL_D20_BANDS = deepFreeze([
        { min: 1, max: 5, label: '1–5' },
        { min: 6, max: 10, label: '6–10' },
        { min: 11, max: 15, label: '11–15' },
        { min: 16, max: 20, label: '16–20' }
    ]);
    const ORIGINAL_DEFAULTS = deepFreeze({
        teamCount: 14,
        rosterSlots: { QB: 1, FLEX: 4, BN: 3 },
        historyCount: DUAT_ORIGINAL_ARMY_COUNT,
        rulerCount: DUAT_ORIGINAL_ARMY_COUNT,
        d20Bands: DUAT_ORIGINAL_D20_BANDS,
        matchupFormat: 'all-play',
        regularSeasonWeeks: 14,
        playoffStartWeek: 15,
        playoffTeams: 7,
        sacredWeeks: SACRED_WEEKS,
        heptad: { allianceSize: 2, scoring: 'best-ball', startWeek: 2 }
    });

    // Identity and world catalog from The Duat app/historical-worlds.ts.
    // Restrict this original preset to the original fourteen factions and world.
    const FACTIONS = deepFreeze([
        {"id":"mesopotamia","name":"Mesopotamia","realm":"The Land Between Rivers","culture":"Sumerian","motto":"What is buried shall return","sigil":"𒀭","color":"#df8e39","secondaryColor":"#d8ad4a","region":"Asia","anchorFactionId":"mesopotamia","homeTerritoryId":"two-rivers"},
        {"id":"egypt","name":"Egypt","realm":"The Black Land","culture":"Egyptian","motto":"The sun returns after every night","sigil":"𓂀","color":"#d4ae3d","secondaryColor":"#236b73","region":"Africa","anchorFactionId":"egypt","homeTerritoryId":"nile-delta"},
        {"id":"rome","name":"Rome","realm":"The Seven Hills","culture":"Roman","motto":"Fortune favors the bold","sigil":"SPQR","color":"#8e67b4","secondaryColor":"#bb8b55","region":"Europe","anchorFactionId":"rome","homeTerritoryId":"latium"},
        {"id":"greece","name":"Greece","realm":"The Aegean","culture":"Greek","motto":"Glory is earned in contest","sigil":"Λ","color":"#56a7a8","secondaryColor":"#d8ad4a","region":"Europe","anchorFactionId":"greece","homeTerritoryId":"aegean"},
        {"id":"vikings","name":"Vikings","realm":"The Northern Sea","culture":"Norse","motto":"The saga crosses every shore","sigil":"ᛉ","color":"#a8b2b8","secondaryColor":"#4e77a8","region":"Europe","anchorFactionId":"vikings","homeTerritoryId":"scandinavia"},
        {"id":"inis-fail","name":"Inis Fáil","realm":"The Emerald Isle","culture":"Celtic","motto":"The hill remembers every king","sigil":"ᚐ","color":"#4e77a8","secondaryColor":"#5f9b63","region":"Europe","anchorFactionId":"inis-fail","homeTerritoryId":"ireland"},
        {"id":"carthage","name":"Carthage","realm":"The Western Sea","culture":"Punic","motto":"The sea is our road","sigil":"𐤕","color":"#8f4050","secondaryColor":"#d4ae3d","region":"Africa","anchorFactionId":"carthage","homeTerritoryId":"carthage"},
        {"id":"nubia","name":"Nubia","realm":"The Upper Nile","culture":"Kushite","motto":"Gold guards the southern river","sigil":"𓃭","color":"#8a6849","secondaryColor":"#d4ae3d","region":"Africa","anchorFactionId":"nubia","homeTerritoryId":"upper-nile"},
        {"id":"china","name":"China","realm":"The Yellow River","culture":"Han–Tang","motto":"Order beneath heaven","sigil":"龍","color":"#e0b948","secondaryColor":"#d55d55","region":"Asia","anchorFactionId":"china","homeTerritoryId":"yellow-river"},
        {"id":"japan","name":"Japan","realm":"The Rising Sun","culture":"Japanese","motto":"Honor holds the eastern gate","sigil":"日","color":"#d55d55","secondaryColor":"#d8d0bc","region":"Asia","anchorFactionId":"japan","homeTerritoryId":"yamato"},
        {"id":"india","name":"India","realm":"The Ganges Plain","culture":"Mauryan","motto":"The wheel turns again","sigil":"☸","color":"#4f7eb8","secondaryColor":"#d47a45","region":"Asia","anchorFactionId":"india","homeTerritoryId":"ganges"},
        {"id":"warhorsemen","name":"Warhorsemen","realm":"The Steppe","culture":"Steppe Confederation","motto":"The horizon has no wall","sigil":"弓","color":"#c66c32","secondaryColor":"#8a6849","region":"Europe","anchorFactionId":"warhorsemen","homeTerritoryId":"pannonia"},
        {"id":"mayans","name":"Mayans","realm":"The Rainforest Cities","culture":"Classic Maya","motto":"The count continues","sigil":"AJAW","color":"#d9799c","secondaryColor":"#5f9b63","region":"Americas","anchorFactionId":"mayans","homeTerritoryId":"maya-lowlands"},
        {"id":"gaul","name":"Gaul","realm":"The Western Forest","culture":"Celtic Gaul","motto":"The forest line holds","sigil":"☼","color":"#5f9b63","secondaryColor":"#d4ae3d","region":"Europe","anchorFactionId":"gaul","homeTerritoryId":"gaul"}
    ]);
    const TERRITORIES = deepFreeze([
        {"id":"albion","name":"Albion","subtitle":"Tin islands wrapped in mist","longitude":-2,"latitude":54,"region":"Europe"},
        {"id":"ireland","name":"Inis Fáil","subtitle":"The hill of Tara","longitude":-8,"latitude":53,"region":"Europe","homelandOf":"inis-fail"},
        {"id":"scandinavia","name":"The Northern Sea","subtitle":"Halls beneath the aurora","longitude":11,"latitude":61,"region":"Europe","homelandOf":"vikings"},
        {"id":"gaul","name":"The Western Forest","subtitle":"Groves of the tribes","longitude":2.5,"latitude":47,"region":"Europe","homelandOf":"gaul"},
        {"id":"iberia","name":"The Pillars","subtitle":"Gate of the setting sun","longitude":-4,"latitude":40,"region":"Europe"},
        {"id":"germania","name":"Beyond the Rhine","subtitle":"The unconquered wood","longitude":10,"latitude":51,"region":"Europe"},
        {"id":"latium","name":"The Seven Hills","subtitle":"The eternal city","longitude":12.5,"latitude":42,"region":"Europe","homelandOf":"rome"},
        {"id":"pannonia","name":"The Horse Frontier","subtitle":"Grass road of the riders","longitude":20,"latitude":47,"region":"Europe","homelandOf":"warhorsemen"},
        {"id":"balkans","name":"Thrace","subtitle":"Mountain marches of the north","longitude":22,"latitude":44,"region":"Europe"},
        {"id":"aegean","name":"The Aegean","subtitle":"Sea of poleis and contests","longitude":24,"latitude":38.5,"region":"Europe","homelandOf":"greece"},
        {"id":"carthage","name":"Qart-ḥadašt","subtitle":"The new city of the western sea","longitude":10.3,"latitude":36.8,"region":"Africa","homelandOf":"carthage"},
        {"id":"maghreb","name":"Numidia","subtitle":"Kingdoms of the western horse","longitude":3,"latitude":32,"region":"Africa"},
        {"id":"nile-delta","name":"Kemet","subtitle":"The black land","longitude":30,"latitude":26,"region":"Africa","homelandOf":"egypt"},
        {"id":"upper-nile","name":"Kush","subtitle":"Gold above the cataracts","longitude":32,"latitude":18,"region":"Africa","homelandOf":"nubia"},
        {"id":"sahara","name":"Garamantia","subtitle":"Chariot roads of the sand sea","longitude":15,"latitude":24,"region":"Africa"},
        {"id":"aksum","name":"Aksum","subtitle":"Crown of the Red Sea","longitude":39,"latitude":14,"region":"Africa"},
        {"id":"horn-africa","name":"Punt","subtitle":"Land of incense","longitude":45,"latitude":8,"region":"Africa"},
        {"id":"anatolia","name":"The Crossroads","subtitle":"Bronze gates between worlds","longitude":34,"latitude":39,"region":"Asia"},
        {"id":"levant","name":"The Coastal Gates","subtitle":"Harbors of the purple dye","longitude":36,"latitude":32,"region":"Asia"},
        {"id":"two-rivers","name":"The Land Between Rivers","subtitle":"Uruk and Babylon","longitude":44,"latitude":33,"region":"Asia","homelandOf":"mesopotamia"},
        {"id":"persia","name":"The Royal Road","subtitle":"Highland seat of kings","longitude":53,"latitude":32,"region":"Asia"},
        {"id":"pontic-steppe","name":"The Sea of Grass","subtitle":"Riders under an open sky","longitude":37,"latitude":48,"region":"Asia"},
        {"id":"central-asia","name":"Sogdiana","subtitle":"Silk crossroads of the oases","longitude":67,"latitude":42,"region":"Asia"},
        {"id":"indus","name":"Meluhha","subtitle":"Cities of the river","longitude":70,"latitude":28,"region":"Asia"},
        {"id":"ganges","name":"The Ganges Plain","subtitle":"Turning of the wheel","longitude":78,"latitude":23,"region":"Asia","homelandOf":"india"},
        {"id":"deccan","name":"The Deccan","subtitle":"Southern kingdoms of stone","longitude":77,"latitude":16,"region":"Asia"},
        {"id":"tibet","name":"The Roof of the World","subtitle":"Thin air and hidden monasteries","longitude":88,"latitude":32,"region":"Asia"},
        {"id":"yellow-river","name":"The Central Plain","subtitle":"Dragon courts of the river","longitude":104,"latitude":35,"region":"Asia","homelandOf":"china"},
        {"id":"southeast-asia","name":"Suvarnabhumi","subtitle":"The golden lands","longitude":105,"latitude":15,"region":"Asia"},
        {"id":"korea","name":"The Eastern Peninsula","subtitle":"Kingdoms between two seas","longitude":127,"latitude":38,"region":"Asia"},
        {"id":"manchuria","name":"The Northern Frontier","subtitle":"Forests beyond the wall","longitude":125,"latitude":47,"region":"Asia"},
        {"id":"yamato","name":"Yamato","subtitle":"Land of the rising sun","longitude":138,"latitude":36,"region":"Asia","homelandOf":"japan"},
        {"id":"siberia","name":"The Taiga Passage","subtitle":"Frozen road of the drum","longitude":96,"latitude":56,"region":"Asia"},
        {"id":"vinland","name":"Vinland","subtitle":"The western shore of the sagas","longitude":-57,"latitude":50,"region":"Americas"},
        {"id":"great-lakes","name":"The Inland Seas","subtitle":"Freshwater kingdoms","longitude":-84,"latitude":45,"region":"Americas"},
        {"id":"mississippi","name":"The Mound Cities","subtitle":"Earthworks of the great river","longitude":-90,"latitude":33,"region":"Americas"},
        {"id":"pacific-northwest","name":"The Cedar Coast","subtitle":"Totems facing the mirror sea","longitude":-123,"latitude":47,"region":"Americas"},
        {"id":"mexico","name":"Anahuac","subtitle":"The highland basin","longitude":-102,"latitude":23,"region":"Americas"},
        {"id":"maya-lowlands","name":"The Rainforest Cities","subtitle":"Keepers of the Long Count","longitude":-89,"latitude":17,"region":"Americas","homelandOf":"mayans"},
        {"id":"caribbean","name":"The Antilles","subtitle":"Island passage of the hurricane","longitude":-72,"latitude":19,"region":"Americas"},
        {"id":"andes","name":"The Mountain Road","subtitle":"Four quarters of the sun","longitude":-74,"latitude":-14,"region":"Americas"},
        {"id":"amazon","name":"Amazonia","subtitle":"The river forest","longitude":-61,"latitude":-5,"region":"Americas"},
        {"id":"brazil","name":"The Southern Coast","subtitle":"Atlantic gate of the south","longitude":-47,"latitude":-16,"region":"Americas"},
        {"id":"sicily","name":"Thrinacia","subtitle":"Isle of the sun's cattle","longitude":14.3,"latitude":37.5,"region":"Europe"},
        {"id":"cyrenaica","name":"The Hesperides","subtitle":"Gardens at the world's edge","longitude":21.5,"latitude":31.5,"region":"Africa"},
        {"id":"atlantic-isles","name":"The Fortunate Isles","subtitle":"Harbors beyond the sunset","longitude":-20,"latitude":30,"region":"Africa"},
        {"id":"gulf-states","name":"Dilmun","subtitle":"The pure land of the lower sea","longitude":48,"latitude":25,"region":"Asia"}
    ]);
    const ROUTES = deepFreeze([
        {"from":"ireland","to":"albion","type":"sea","name":"Irish Sea"},
        {"from":"albion","to":"gaul","type":"land"},
        {"from":"albion","to":"scandinavia","type":"sea","name":"North Sea"},
        {"from":"gaul","to":"iberia","type":"land"},
        {"from":"gaul","to":"germania","type":"land"},
        {"from":"gaul","to":"latium","type":"land"},
        {"from":"germania","to":"scandinavia","type":"land"},
        {"from":"germania","to":"pannonia","type":"land"},
        {"from":"latium","to":"pannonia","type":"land"},
        {"from":"latium","to":"carthage","type":"sea","name":"Tyrrhenian Sea"},
        {"from":"latium","to":"aegean","type":"sea","name":"Ionian Sea"},
        {"from":"pannonia","to":"balkans","type":"land"},
        {"from":"balkans","to":"aegean","type":"land"},
        {"from":"balkans","to":"anatolia","type":"land"},
        {"from":"pannonia","to":"pontic-steppe","type":"land"},
        {"from":"aegean","to":"anatolia","type":"sea","name":"Aegean crossing"},
        {"from":"iberia","to":"carthage","type":"sea","name":"Pillars route"},
        {"from":"carthage","to":"maghreb","type":"land"},
        {"from":"maghreb","to":"sahara","type":"land"},
        {"from":"sahara","to":"nile-delta","type":"land"},
        {"from":"nile-delta","to":"upper-nile","type":"land"},
        {"from":"nile-delta","to":"levant","type":"land"},
        {"from":"upper-nile","to":"aksum","type":"land"},
        {"from":"aksum","to":"horn-africa","type":"land"},
        {"from":"horn-africa","to":"deccan","type":"sea","name":"Monsoon road"},
        {"from":"anatolia","to":"levant","type":"land"},
        {"from":"anatolia","to":"two-rivers","type":"land"},
        {"from":"anatolia","to":"pontic-steppe","type":"land"},
        {"from":"levant","to":"two-rivers","type":"land"},
        {"from":"two-rivers","to":"persia","type":"land"},
        {"from":"persia","to":"central-asia","type":"land"},
        {"from":"persia","to":"indus","type":"land"},
        {"from":"pontic-steppe","to":"central-asia","type":"land"},
        {"from":"central-asia","to":"indus","type":"land"},
        {"from":"central-asia","to":"tibet","type":"land"},
        {"from":"central-asia","to":"siberia","type":"land"},
        {"from":"indus","to":"ganges","type":"land"},
        {"from":"indus","to":"deccan","type":"land"},
        {"from":"ganges","to":"deccan","type":"land"},
        {"from":"ganges","to":"tibet","type":"land"},
        {"from":"ganges","to":"southeast-asia","type":"land"},
        {"from":"tibet","to":"yellow-river","type":"land"},
        {"from":"yellow-river","to":"southeast-asia","type":"land"},
        {"from":"yellow-river","to":"korea","type":"land"},
        {"from":"yellow-river","to":"manchuria","type":"land"},
        {"from":"manchuria","to":"korea","type":"land"},
        {"from":"manchuria","to":"siberia","type":"land"},
        {"from":"korea","to":"yamato","type":"sea","name":"Eastern Sea"},
        {"from":"great-lakes","to":"mississippi","type":"land"},
        {"from":"mississippi","to":"mexico","type":"land"},
        {"from":"mexico","to":"maya-lowlands","type":"land"},
        {"from":"maya-lowlands","to":"caribbean","type":"land"},
        {"from":"mexico","to":"andes","type":"land"},
        {"from":"andes","to":"amazon","type":"land"},
        {"from":"amazon","to":"brazil","type":"land"},
        {"from":"great-lakes","to":"vinland","type":"sea","name":"St. Lawrence road"},
        {"from":"scandinavia","to":"vinland","type":"passage","name":"Raven Route"},
        {"from":"iberia","to":"caribbean","type":"passage","name":"Sunset Passage"},
        {"from":"maghreb","to":"brazil","type":"passage","name":"Southern Star Route"},
        {"from":"yamato","to":"pacific-northwest","type":"passage","name":"Mirror Sea Passage"},
        {"from":"southeast-asia","to":"maya-lowlands","type":"passage","name":"Duat Passage"},
        {"from":"pacific-northwest","to":"great-lakes","type":"land"},
        {"from":"sicily","to":"latium","type":"sea","name":"Tyrrhenian crossing"},
        {"from":"sicily","to":"carthage","type":"sea","name":"Strait of Sicily"},
        {"from":"sicily","to":"aegean","type":"sea","name":"Ionian crossing"},
        {"from":"cyrenaica","to":"nile-delta","type":"land"},
        {"from":"cyrenaica","to":"sahara","type":"land"},
        {"from":"cyrenaica","to":"carthage","type":"sea","name":"Gulf of Sirte"},
        {"from":"cyrenaica","to":"aegean","type":"sea","name":"Libyan Sea"},
        {"from":"iberia","to":"maghreb","type":"sea","name":"Strait of Gibraltar"},
        {"from":"gulf-states","to":"two-rivers","type":"land"},
        {"from":"gulf-states","to":"persia","type":"sea","name":"Persian Gulf"},
        {"from":"gulf-states","to":"indus","type":"sea","name":"Gulf of Oman"},
        {"from":"gulf-states","to":"horn-africa","type":"sea","name":"Arabian Sea"},
        {"from":"atlantic-isles","to":"iberia","type":"sea","name":"Canary current"},
        {"from":"atlantic-isles","to":"caribbean","type":"sea","name":"Trade winds"},
        {"from":"atlantic-isles","to":"brazil","type":"sea","name":"Volta do mar"},
        {"from":"central-asia","to":"yellow-river","type":"land"},
        {"from":"yellow-river","to":"yamato","type":"sea","name":"East China Sea"}
    ]);
    const FAVORS = deepFreeze([
        {"id":"kratos-1","name":"Kratos’ Wrath I","deity":"Kratos","tier":"Pious","cost":10,"timing":"Sacred week","effect":"Double one starter’s total points.","detail":"Available to every faction with enough favor remaining."},
        {"id":"horus-1","name":"Horus’ Defense I","deity":"Horus","tier":"Pious","cost":10,"timing":"Sacred week","effect":"Give one starter a 15-point floor.","detail":"The target cannot be injured or on a bye."},
        {"id":"patecatl-1","name":"Patecatl’s Embrace I","deity":"Patecatl","tier":"Pious","cost":10,"timing":"Sacred week","effect":"Protect an injured starter with the lower of average points or preseason projection.","detail":"Uses half-PPR preseason projections; without a projection the favor cannot work."},
        {"id":"kratos-2","name":"Kratos’ Wrath II","deity":"Kratos","tier":"Devout","cost":20,"timing":"Sacred week","effect":"Score 2.5× one starter’s total points.","detail":"The middle rung of the Wrath, between the Pious double and the Divine 3.5×."},
        {"id":"horus-2","name":"Horus’ Defense II","deity":"Horus","tier":"Devout","cost":20,"timing":"Sacred week","effect":"Give one starter a 20-point floor.","detail":"The target cannot be injured or on a bye."},
        {"id":"patecatl-2","name":"Patecatl’s Embrace II","deity":"Patecatl","tier":"Devout","cost":20,"timing":"Sacred week","effect":"Protect an injured starter with the greater of average points or preseason projection.","detail":"If the player has not played all season, double the preseason projection."},
        {"id":"nyx","name":"Nyx’s Guidance","deity":"Nyx","tier":"Devout","cost":20,"timing":"Sacred week","effect":"Score 2.5× points for a player in a primetime game.","detail":"The player must be in the starting five."},
        {"id":"janus-2","name":"Janus’ Recollection II","deity":"Janus","tier":"Devout","cost":20,"timing":"Sacred week","effect":"Import a player’s points from the most recent week.","detail":"A controlled way to borrow from the immediate past."},
        {"id":"kratos-3","name":"Kratos’ Wrath III","deity":"Kratos","tier":"Divine","cost":30,"timing":"Sacred week","effect":"Score 3.5× one starter’s total points.","detail":"A premium swing reserved for the most important weeks."},
        {"id":"janus-3","name":"Janus’ Recollection III","deity":"Janus","tier":"Divine","cost":30,"timing":"Sacred week","effect":"Import a player’s score from any previous week this season.","detail":"Choose the week before the declaration deadline."},
        {"id":"midas","name":"Midas’ Touch","deity":"Midas","tier":"Legendary","cost":"Free","timing":"Any sacred week","effect":"Discard a player and turn their season value into favor.","detail":"Payout by positional percentile: $50 top 5%, $25 to 25%, $13 to 50%, $5 to 75%, $1 below.","risk":"The player is gone from this ruler’s army."},
        {"id":"ebisu","name":"Ebisu’s Good Fortune","deity":"Ebisu","tier":"Legendary","cost":"Variable","timing":"Any sacred week","effect":"Wager team points on a d20 result.","detail":"100 needs a 5 or 7 · 75 needs 5, 7, 10, or 14 · 50 needs 1–8 · 25 needs an even roll · 10 needs 7–20.","risk":"A score pushed below zero also costs the shortfall in favor. One roll per team per sacred week."},
        {"id":"mahdi-2","name":"The Mahdi II","deity":"Mahdi","tier":"Legendary","cost":"Free","timing":"Any sacred week","effect":"Add an undrafted player from your ruler’s original season.","detail":"The d20 picks from that year’s Mahdi list; one reroll is allowed for $20. Order goes by inverse standings.","risk":"One-year cooldown from the week invoked."},
        {"id":"super-mahdi","name":"The Super Mahdi","deity":"Mahdi","tier":"Legendary","cost":"Free","timing":"Any sacred week","effect":"Add a top performer from the current fantasy season, any year of team.","detail":"The d20 picks by current rank; a preferred position may be named. Order goes by inverse standings.","risk":"One-year cooldown — and a player is lost at random from one of your buried rosters."},
        {"id":"anubis","name":"Free Them, Anubis!","deity":"Anubis","tier":"Mythic","cost":"Free","timing":"Preseason","effect":"Swap one active player for one on a buried roster.","detail":"Once a season, in the declared window. The buried player is permanently removed from that tomb.","risk":"The replaced player can never return to your faction."},
        {"id":"shiva","name":"Shiva the Destroyer","deity":"Shiva","tier":"Mythic","cost":"Free","timing":"Preseason","effect":"Destroy the active ruler and randomly unearth another.","detail":"This can be invoked annually.","risk":"The destroyed ruler is gone forever; your faction falls to three rulers in perpetuity."},
        {"id":"summon-mahdi","name":"Summon the Mahdi","deity":"Mahdi","tier":"Mythic","cost":"Free","timing":"Preseason","effect":"Add an undrafted player from your team’s specific year before the season starts.","detail":"The d20 picks from that year’s Mahdi list; one reroll is allowed for $20.","risk":"One-year cooldown per use."},
        {"id":"amun","name":"Amun’s Spoils","deity":"Amun","tier":"Throne","cost":1,"timing":"Champion only","effect":"Claim a player at the start of the next ruler auction for $1.","detail":"Requires a 5 or 7 on one d20 roll; extra rolls cost $10 favor each."},
        {"id":"plutus","name":"Plutus’ Wealth","deity":"Plutus","tier":"Throne","cost":"Free","timing":"Champion only","effect":"Roll leftover favor budget over into the new season.","detail":"One d20 roll; succeeds on 5, 7, or any multiple or sum of them — 5, 7, 10, 12, 14, 15, 17."}
    ]);
    const WORLD = deepFreeze({
        "id": "duat-eternal",
        "label": "The True Duat",
        "mapTitle": "The Duat Between Worlds",
        "description": "The original fourteen factions, every ancient theater, and mythic transition passages connecting the whole league world.",
        "palette": {
            "water": "#08080a",
            "land": "#2b241a",
            "border": "#8e7040",
            "road": "rgba(184,148,78,.34)",
            "sea": "rgba(92,142,155,.6)",
            "accent": "#d8ad4a"
        },
        "terms": {
            "territory": "realm",
            "territories": "realms",
            "route": "ancient road",
            "passage": "Duat passage",
            "claim": "conquest",
            "homeland": "sacred homeland"
        }
    });

    // Exact FNV-1a/Mulberry32 generator used by the original army and alliance draws.
    function createSeededRandom(seed) {
        const text = String(seed);
        let state = 0x811c9dc5;
        for (let index = 0; index < text.length; index += 1) {
            state ^= text.charCodeAt(index);
            state = Math.imul(state, 0x01000193);
        }
        state >>>= 0;
        return () => {
            state = (state + 0x6d2b79f5) >>> 0;
            let value = state;
            value = Math.imul(value ^ (value >>> 15), value | 1);
            value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
            return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
        };
    }

    // Ported from The Duat app/heptad.ts; score input remains caller-owned.
    const heptad = (() => {
        const MIN_ALLIANCE_SIZE = 2;
        const MAX_ALLIANCE_SIZE = 5;
        /** Two alliances is the smallest field that can hold a gauntlet. */
        const MIN_ALLIANCES = 2;
        /**
         * The largest field a 17-week season can hold: the gauntlet needs
         * count + 1 weeks plus the rematch in reserve, so from the earliest start
         * (week 1) the rematch of a 15-alliance field lands exactly on week 17.
         */
        const MAX_ALLIANCES = 15;
        const clampInt = (value, min, max) => Math.min(max, Math.max(min, Math.floor(Number(value) || 0)));
        const round2 = (value) => Math.round(value * 100) / 100;
        function defaultHeptadSettings(teamCount) {
            return { allianceSize: defaultAllianceSize(teamCount), scoring: "best-ball", startWeek: 2 };
        }
        /**
         * Sizes this league can actually field: at least two alliances, and few
         * enough that the gauntlet fits inside the season. A ten-team league can
         * pair or run trios; a four-team league can only pair; a forty-team league
         * cannot pair (twenty alliances would run past week 17) but can run trios.
         */
        function allianceSizeOptions(teamCount) {
            const teams = clampInt(teamCount, 0, 64);
            const options = [];
            for (let size = MIN_ALLIANCE_SIZE; size <= MAX_ALLIANCE_SIZE; size += 1) {
                const count = Math.floor(teams / size);
                if (count >= MIN_ALLIANCES && count <= MAX_ALLIANCES)
                    options.push(size);
            }
            return options;
        }
        /** Prefers whatever size lands the league on a true seven-alliance Heptad. */
        function defaultAllianceSize(teamCount) {
            const options = allianceSizeOptions(teamCount);
            if (!options.length)
                return MIN_ALLIANCE_SIZE;
            return options.find((size) => Math.floor(clampInt(teamCount, 0, 64) / size) === 7) ?? options[0];
        }
        /**
         * How a league of this size divides. Remainders join existing alliances rather
         * than sitting out, so an odd league never benches a faction: thirteen teams in
         * pairs becomes six alliances, one of them a trio.
         */
        function heptadShape(teamCount, allianceSize) {
            const teams = clampInt(teamCount, 0, 64);
            const size = clampInt(allianceSize, MIN_ALLIANCE_SIZE, MAX_ALLIANCE_SIZE);
            const allianceCount = Math.floor(teams / size);
            if (allianceCount < MIN_ALLIANCES)
                return { allianceCount: 0, sizes: [], isTrueHeptad: false, even: false };
            const remainder = teams % size;
            const sizes = Array.from({ length: allianceCount }, (_, index) => size + (index < remainder ? 1 : 0));
            return { allianceCount, sizes, isTrueHeptad: allianceCount === 7, even: remainder === 0 };
        }
        function canRunHeptad(teamCount, allianceSize) {
            return heptadShape(teamCount, allianceSize).allianceCount >= MIN_ALLIANCES;
        }
        /** One plain line the builder can show under the controls. */
        function describeHeptad(teamCount, allianceSize) {
            const shape = heptadShape(teamCount, allianceSize);
            if (!shape.allianceCount)
                return `${teamCount} teams cannot field two alliances at this size.`;
            const spread = shape.even
                ? `${shape.allianceCount} alliances of ${shape.sizes[0]}`
                : `${shape.allianceCount} alliances — ${shape.sizes.filter((size) => size > allianceSize).length} of ${allianceSize + 1}, the rest of ${allianceSize}`;
            return shape.isTrueHeptad ? `${spread}. A true Heptad.` : spread + ".";
        }
        /**
         * The gauntlet calendar for a field of this size.
         *
         * With A alliances entering one per round: the top bracket runs A−1 rounds
         * from the start week; the bottom bracket opens two weeks later, one round
         * behind, and runs A−2 rounds; the championship follows the bottom bracket,
         * with a rematch week held in reserve because the top-bracket survivor must
         * lose twice. Canon (A = 7, start week 2): top W2–7, bottom W4–8,
         * championship W9, rematch W10, Pinnacle W11 — exactly the workbook.
         */
        function heptadSchedule(allianceCount, startWeek) {
            const count = Math.max(0, Math.floor(allianceCount));
            const start = clampInt(startWeek, 1, 18);
            const fixtures = [];
            for (let round = 1; round <= count - 1; round += 1)
                fixtures.push({ bracket: "top", round, week: start + round - 1 });
            for (let round = 1; round <= count - 2; round += 1)
                fixtures.push({ bracket: "bottom", round, week: start + round + 1 });
            const championshipWeek = start + count;
            fixtures.push({ bracket: "championship", round: 1, week: championshipWeek });
            return {
                fixtures,
                topWeeks: count >= 2 ? [start, start + count - 2] : null,
                bottomWeeks: count >= 3 ? [start + 2, start + count - 1] : null,
                championshipWeek,
                rematchWeek: championshipWeek + 1,
                pinnacleWeek: championshipWeek + 2,
            };
        }
        /**
         * Draws the alliances and their order of entry at the league's founding —
         * the seeded stand-in for the commissioner's dice. One draw per season;
         * partners stand until the gauntlet ends.
         */
        function buildHeptadAlliances(teamIds, settings, seed, nameOf = (teamId) => teamId) {
            const teams = teamIds.filter(Boolean);
            const shape = heptadShape(teams.length, settings.allianceSize);
            if (!shape.allianceCount)
                return [];
            const random = createSeededRandom(`${seed}:heptad-games`);
            const pool = [...teams];
            for (let index = pool.length - 1; index > 0; index -= 1) {
                const swap = Math.floor(random() * (index + 1));
                [pool[index], pool[swap]] = [pool[swap], pool[index]];
            }
            const alliances = [];
            let cursor = 0;
            shape.sizes.forEach((size, index) => {
                const members = pool.slice(cursor, cursor + size);
                cursor += size;
                alliances.push({ id: `h${index + 1}`, name: members.map(nameOf).join(" & "), teamIds: members, entry: index + 1 });
            });
            return alliances;
        }
        /**
         * Scores one Heptad week for an alliance.
         *
         * best-ball fields a single lineup per alliance: at every slot the alliance
         * keeps as many players as one roster starts, taking the highest scorers among
         * the partners — an alliance never fields more quarterbacks than a team would.
         * combined simply adds the members' weekly totals.
         */
        function scoreHeptadWeek(alliances, weeks, scoring) {
            const byTeam = new Map(weeks.map((entry) => [entry.teamId, entry]));
            const results = alliances.map((alliance) => {
                const members = alliance.teamIds.map((teamId) => byTeam.get(teamId)).filter((entry) => Boolean(entry));
                if (scoring === "combined") {
                    return {
                        allianceId: alliance.id,
                        name: alliance.name,
                        total: round2(members.reduce((sum, member) => sum + member.total, 0)),
                        members: members.map((member) => ({ teamId: member.teamId, total: round2(member.total), counted: member.starters.length })),
                    };
                }
                const capacity = new Map();
                for (const member of members) {
                    const counts = new Map();
                    for (const starter of member.starters)
                        counts.set(starter.slot, (counts.get(starter.slot) ?? 0) + 1);
                    for (const [slot, count] of counts)
                        capacity.set(slot, Math.max(capacity.get(slot) ?? 0, count));
                }
                const pool = new Map();
                for (const member of members) {
                    for (const starter of member.starters) {
                        const list = pool.get(starter.slot) ?? [];
                        list.push({ teamId: member.teamId, points: starter.points });
                        pool.set(starter.slot, list);
                    }
                }
                const countedBy = new Map();
                let total = 0;
                for (const [slot, entries] of pool) {
                    const keep = capacity.get(slot) ?? 0;
                    entries
                        .sort((left, right) => right.points - left.points || left.teamId.localeCompare(right.teamId))
                        .slice(0, keep)
                        .forEach((entry) => {
                        total += entry.points;
                        countedBy.set(entry.teamId, (countedBy.get(entry.teamId) ?? 0) + 1);
                    });
                }
                return {
                    allianceId: alliance.id,
                    name: alliance.name,
                    total: round2(total),
                    members: members.map((member) => ({
                        teamId: member.teamId,
                        total: round2(member.total),
                        counted: countedBy.get(member.teamId) ?? 0,
                    })),
                };
            });
            return results.sort((left, right) => right.total - left.total || left.allianceId.localeCompare(right.allianceId));
        }
        /**
         * Runs the gauntlet as far as the scores on record allow.
         *
         * `totalFor(allianceId, week)` returns the alliance's score for a week, or
         * null when that week has not been played — the state stops there and reports
         * the fixture in `next` so the UI can show what's coming.
         *
         * Bracket flow, exactly as the workbook tracks it: entries 1 and 2 open the
         * top bracket; each loser drops down; the bottom bracket pairs the first two
         * drops, then its survivor meets each later drop in turn. The championship
         * pits the two survivors, and if the bottom side wins, a rematch decides it —
         * the top-bracket team holds one life.
         */
        function runHeptadGauntlet(alliances, totalFor, startWeek) {
            const entries = [...alliances].sort((left, right) => left.entry - right.entry);
            const matches = [];
            const losses = new Map(entries.map((alliance) => [alliance.id, 0]));
            const stopped = (fixture, homeId, awayId) => finalize(matches, losses, null, null, entries, { ...fixture, homeId, awayId });
            const play = (fixture, homeId, awayId) => {
                const homeScore = totalFor(homeId, fixture.week);
                const awayScore = totalFor(awayId, fixture.week);
                if (!Number.isFinite(homeScore) || !Number.isFinite(awayScore))
                    return null;
                // A tie holds the gauntlet; the workbook has the commissioner re-stage it.
                // Deterministic fallback: the earlier entrant survived longer to get here.
                const homeWins = homeScore !== awayScore ? homeScore > awayScore : true;
                const match = {
                    ...fixture,
                    homeId,
                    awayId,
                    homeScore: round2(homeScore),
                    awayScore: round2(awayScore),
                    winnerId: homeWins ? homeId : awayId,
                    loserId: homeWins ? awayId : homeId,
                };
                matches.push(match);
                losses.set(match.loserId, (losses.get(match.loserId) ?? 0) + 1);
                return match;
            };
            if (entries.length < MIN_ALLIANCES)
                return finalize(matches, losses, null, null, entries, null);
            // The brackets interleave on the calendar: top round r plays week
            // start+r−1, bottom round r plays week start+r+1, and bottom round r's
            // late entrant is the loser of top round r+1 — always decided one week
            // earlier. Walking in week order means a pause on an unscored week still
            // shows every game already played in BOTH brackets up to that week; the
            // old two-pass walk silently hid finished bottom-bracket games whenever
            // the top bracket stalled first.
            let topSurvivor = entries[0].id;
            let bottomSurvivor = null;
            const drops = [];
            const topRounds = entries.length - 1;
            const bottomRounds = entries.length - 2;
            for (let week = startWeek; week < startWeek + entries.length; week += 1) {
                const topRound = week - startWeek + 1;
                if (topRound >= 1 && topRound <= topRounds) {
                    const fixture = { bracket: "top", round: topRound, week };
                    const challenger = entries[topRound].id;
                    const match = play(fixture, topSurvivor, challenger);
                    if (!match)
                        return stopped(fixture, topSurvivor, challenger);
                    drops.push(match.loserId);
                    topSurvivor = match.winnerId;
                }
                const bottomRound = week - startWeek - 1;
                if (bottomRound >= 1 && bottomRound <= bottomRounds) {
                    // Round 1 pairs the first two drops; later rounds feed the newest drop
                    // to the survivor. All participants exist: their top games are behind us.
                    const home = bottomRound === 1 ? drops[0] : bottomSurvivor;
                    const challenger = drops[bottomRound];
                    const fixture = { bracket: "bottom", round: bottomRound, week };
                    const match = play(fixture, home, challenger);
                    if (!match)
                        return stopped(fixture, home, challenger);
                    bottomSurvivor = match.winnerId;
                }
            }
            // A two-alliance field has no bottom bracket: the lone drop fights back
            // directly in the championship.
            if (bottomSurvivor === null)
                bottomSurvivor = drops[0];
            // Championship: the top side must lose twice.
            const championshipWeek = startWeek + entries.length;
            const first = { bracket: "championship", round: 1, week: championshipWeek };
            const firstMatch = play(first, topSurvivor, bottomSurvivor);
            if (!firstMatch)
                return stopped(first, topSurvivor, bottomSurvivor);
            if (firstMatch.winnerId === topSurvivor)
                return finalize(matches, losses, topSurvivor, bottomSurvivor, entries, null);
            const rematch = { bracket: "rematch", round: 1, week: championshipWeek + 1 };
            const rematchMatch = play(rematch, topSurvivor, bottomSurvivor);
            if (!rematchMatch)
                return stopped(rematch, topSurvivor, bottomSurvivor);
            return finalize(matches, losses, rematchMatch.winnerId, rematchMatch.loserId, entries, null);
        }
        function finalize(matches, losses, championId, runnerUpId, entries, next) {
            const record = new Map(entries.map((alliance) => [alliance.id, { wins: 0, points: 0 }]));
            for (const match of matches) {
                const winner = record.get(match.winnerId);
                if (winner)
                    winner.wins += 1;
                const home = record.get(match.homeId);
                if (home)
                    home.points = round2(home.points + match.homeScore);
                const away = record.get(match.awayId);
                if (away)
                    away.points = round2(away.points + match.awayScore);
            }
            // The challenger the champion may face in the Pinnacle Battle: the best team
            // that missed the finals, judged by wins then points scored (the workbook
            // also lists team name and use of GIFs; those are left to the league).
            const pinnacleChallengerId = championId
                ? entries
                    .map((alliance) => alliance.id)
                    .filter((id) => id !== championId && id !== runnerUpId)
                    .sort((left, right) => {
                    const a = record.get(left) ?? { wins: 0, points: 0 };
                    const b = record.get(right) ?? { wins: 0, points: 0 };
                    return b.wins - a.wins || b.points - a.points || left.localeCompare(right);
                })[0] ?? null
                : null;
            return {
                matches,
                next,
                championId,
                runnerUpId,
                pinnacleChallengerId,
                eliminatedIds: [...losses.entries()].filter(([, count]) => count >= 2).map(([id]) => id),
                complete: championId !== null,
            };
        }
        function normalizeHeptadSettings(value, teamCount) {
            const defaults = defaultHeptadSettings(teamCount);
            // Every path — including the defaults themselves — flows through the same
            // clamps, so the function agrees with itself for any given league.
            const raw = value && typeof value === "object" ? value : defaults;
            const options = allianceSizeOptions(teamCount);
            const size = clampInt(raw.allianceSize ?? defaults.allianceSize, MIN_ALLIANCE_SIZE, MAX_ALLIANCE_SIZE);
            const allianceSize = options.includes(size) ? size : defaults.allianceSize;
            // The gauntlet needs alliances + 1 weeks, plus a rematch week in reserve —
            // clamp the start so even the rematch stays inside a 17-week season. The
            // options filter caps the field at MAX_ALLIANCES, so a legal start exists.
            const allianceCount = Math.max(MIN_ALLIANCES, heptadShape(teamCount, allianceSize).allianceCount);
            const latestStart = Math.max(1, 16 - allianceCount);
            return {
                allianceSize,
                scoring: raw.scoring === "combined" ? "combined" : "best-ball",
                startWeek: clampInt(raw.startWeek ?? defaults.startWeek, 1, latestStart),
            };
        }

        return { MIN_ALLIANCE_SIZE, MAX_ALLIANCE_SIZE, MIN_ALLIANCES, MAX_ALLIANCES, defaultHeptadSettings, allianceSizeOptions, defaultAllianceSize, heptadShape, canRunHeptad, describeHeptad, heptadSchedule, buildHeptadAlliances, scoreHeptadWeek, runHeptadGauntlet, normalizeHeptadSettings };
    })();

    // Ported from The Duat app/heavenly-battle.ts; score input remains caller-owned.
    const heavenly = (() => {
        /**
         * The Heavenly Battle — the Duat playoff.
         *
         * Canon, from the league rules: the all-play regular season concludes after
         * week 14, and weeks 15–17 hold a seven-team single-elimination bracket
         * "designed to resemble the NFL playoffs, focusing on a single conference".
         * Week 15: the top seed rests on a bye while 2v7, 3v6, and 4v5 play. Week 16:
         * semifinals with NFL-style re-seeding — the best remaining seed meets the
         * worst remaining seed and the other two pair off. Week 17: the championship,
         * plus a third-place game between the semifinal losers, because third is a
         * paid finish (the annals call the trophy the Camel). The winner is crowned
         * Lord of the Duat. Every playoff week is a sacred week.
         *
         * Nothing here assumes seven. Any field of 2–8 seeds runs, under one
         * principled rule: the bracket always narrows to FOUR semifinalists after its
         * first playable round, and byes go to the top seeds.
         *   - 8 teams: no byes — 1v8, 2v7, 3v6, 4v5.
         *   - 7 teams: one bye (seed 1) — 2v7, 3v6, 4v5. The canon shape.
         *   - 6 teams: two byes (seeds 1–2) — 3v6, 4v5.
         *   - 5 teams: three byes (seeds 1–3) — 4v5.
         *   - 4 teams: the quarterfinal week vanishes entirely; the semifinals play
         *     the start week and the championship + third-place land the week after —
         *     the bracket compresses to two weeks rather than idling one.
         *   - 3 teams: seed 1 byes straight to the championship; 2v3 is the lone
         *     semifinal at the start week and its loser takes third outright — a
         *     third-place game needs two semifinal losers, and there is only one.
         *   - 2 teams: a single championship game at the start week. No third place.
         *
         * Pure and deterministic, in the house style of runHeptadGauntlet: the runner
         * walks the fixtures with a caller-supplied totalFor(teamId, week); a null
         * score pauses the bracket and reports the waiting fixture in `next` — the
         * battle never runs on invented results. Ties resolve to the better
         * (lower-number) seed: the regular-season table is the standing tiebreak, so
         * the outcome never needs dice. No Date, no Math.random, no imports.
         */
        const HEAVENLY_START_WEEK = 15;
        /** Canon field: the top seven of the all-play table through week 14. */
        const HEAVENLY_FIELD_SIZE = 7;
        const MIN_HEAVENLY_FIELD = 2;
        const MAX_HEAVENLY_FIELD = 8;
        const HEAVENLY_CHAMPION_TITLE = "Lord of the Duat";
        const HEAVENLY_THIRD_TROPHY = "the Camel";
        /** Canon payouts, in dollars — original-style leagues only. */
        const HEAVENLY_PAYOUTS = { champion: 135, runnerUp: 60, third: 35 };
        const HEAVENLY_ROUND_LABELS = {
            quarterfinal: "Quarterfinals",
            semifinal: "Semifinals",
            championship: "The Championship",
            "third-place": "The Camel",
        };
        /** Lowercase phrase for call-to-action copy ("…to play the semifinals"). */
        const HEAVENLY_ROUND_PHRASES = {
            quarterfinal: "quarterfinals",
            semifinal: "semifinals",
            championship: "championship",
            "third-place": "third-place game",
        };
        const round2 = (value) => Math.round(value * 100) / 100;
        const clampFieldSize = (fieldSize) => Math.min(MAX_HEAVENLY_FIELD, Math.floor(Number(fieldSize) || 0));
        /**
         * How many top seeds skip the first playable week. With five or more teams the
         * semifinal field must be exactly four, so 8 − N seeds rest; a three-team
         * bracket rests only its top seed (straight to the championship).
         */
        function heavenlyByeCount(fieldSize) {
            const n = clampFieldSize(fieldSize);
            if (n >= 5)
                return MAX_HEAVENLY_FIELD - n;
            if (n === 3)
                return 1;
            return 0;
        }
        /**
         * The bracket calendar for a field of this size — which rounds land on which
         * weeks, before any result is known. Canon (7 teams, start week 15):
         * quarterfinals W15, semifinals W16, championship and third place both W17.
         */
        function heavenlyBattleSchedule(fieldSize, startWeek = HEAVENLY_START_WEEK) {
            const n = clampFieldSize(fieldSize);
            if (n < MIN_HEAVENLY_FIELD)
                return [];
            if (n === 2)
                return [{ round: "championship", week: startWeek, games: 1 }];
            if (n === 3)
                return [
                    { round: "semifinal", week: startWeek, games: 1 },
                    { round: "championship", week: startWeek + 1, games: 1 },
                ];
            const semifinalWeek = n === 4 ? startWeek : startWeek + 1;
            const entries = [];
            if (n > 4)
                entries.push({ round: "quarterfinal", week: startWeek, games: n - 4 });
            entries.push({ round: "semifinal", week: semifinalWeek, games: 2 });
            entries.push({ round: "championship", week: semifinalWeek + 1, games: 1 });
            entries.push({ round: "third-place", week: semifinalWeek + 1, games: 1 });
            return entries;
        }
        /** One frozen no-op state; every invalid field gets the same reference back. */
        const EMPTY_BATTLE = Object.freeze({
            field: Object.freeze([]),
            matches: Object.freeze([]),
            next: null,
            championId: null,
            runnerUpId: null,
            thirdPlaceId: null,
            complete: false,
        });
        /**
         * Runs the Heavenly Battle as far as the scores on record allow.
         *
         * `field` is the seeded entrants in seed order — index 0 is the one seed —
         * normally the top seven of the all-play table through week 14. The field
         * clamps to at most eight; fewer than two teams cannot hold a battle and
         * return the shared empty state unchanged.
         *
         * `totalFor(teamId, week)` returns a team's score for a week, or null when the
         * week has not been recorded — the state stops there and names the fixture in
         * `next`. Within a shared week (the parallel quarterfinals, the two
         * semifinals, and the championship-plus-Camel finale) every playable game is
         * played and the first unplayable one is reported, so a recorded championship
         * still crowns its winner while the third-place game waits.
         */
        function runHeavenlyBattle(field, totalFor, startWeek = HEAVENLY_START_WEEK) {
            const entrants = field
                .filter(Boolean)
                .slice(0, MAX_HEAVENLY_FIELD)
                .map((teamId, index) => ({ teamId, seed: index + 1 }));
            if (entrants.length < MIN_HEAVENLY_FIELD)
                return EMPTY_BATTLE;
            const n = entrants.length;
            const bySeat = new Map(entrants.map((entry) => [entry.teamId, entry]));
            const asSeed = (teamId) => bySeat.get(teamId);
            const matches = [];
            const fixtureOf = (round, week, home, away) => ({
                round, week, homeId: home.teamId, awayId: away.teamId, homeSeed: home.seed, awaySeed: away.seed,
            });
            const play = (round, week, home, away) => {
                const homeScore = totalFor(home.teamId, week);
                const awayScore = totalFor(away.teamId, week);
                if (!Number.isFinite(homeScore) || !Number.isFinite(awayScore))
                    return null;
                // A tie advances the better (lower-number) seed: the regular-season table
                // already ranked them, so the call is deterministic and never re-staged.
                const homeWins = homeScore !== awayScore ? homeScore > awayScore : home.seed < away.seed;
                const match = {
                    round, week,
                    homeId: home.teamId, awayId: away.teamId, homeSeed: home.seed, awaySeed: away.seed,
                    homeScore: round2(homeScore), awayScore: round2(awayScore),
                    winnerId: homeWins ? home.teamId : away.teamId,
                    loserId: homeWins ? away.teamId : home.teamId,
                };
                matches.push(match);
                return match;
            };
            const state = (over) => ({
                field: entrants, matches, next: null,
                championId: null, runnerUpId: null, thirdPlaceId: null, complete: false,
                ...over,
            });
            // 2 teams: the whole battle is one championship game at the start week.
            if (n === 2) {
                const final = play("championship", startWeek, entrants[0], entrants[1]);
                if (!final)
                    return state({ next: fixtureOf("championship", startWeek, entrants[0], entrants[1]) });
                return state({ championId: final.winnerId, runnerUpId: final.loserId, complete: true });
            }
            // 3 teams: seed 1 byes to the championship; 2v3 is the lone semifinal and
            // its loser takes third outright — no third-place game with one semi loser.
            if (n === 3) {
                const semi = play("semifinal", startWeek, entrants[1], entrants[2]);
                if (!semi)
                    return state({ next: fixtureOf("semifinal", startWeek, entrants[1], entrants[2]) });
                const thirdPlaceId = semi.loserId;
                const finalist = asSeed(semi.winnerId);
                const final = play("championship", startWeek + 1, entrants[0], finalist);
                if (!final)
                    return state({ thirdPlaceId, next: fixtureOf("championship", startWeek + 1, entrants[0], finalist) });
                return state({ championId: final.winnerId, runnerUpId: final.loserId, thirdPlaceId, complete: true });
            }
            // 4+ teams: reach exactly four semifinalists, playing quarterfinals at the
            // start week when the field is larger than four (byes to the top seeds).
            let semifinalists;
            let semifinalWeek;
            if (n === 4) {
                semifinalists = entrants;
                semifinalWeek = startWeek;
            }
            else {
                const byes = MAX_HEAVENLY_FIELD - n;
                const games = n - 4;
                const winners = [];
                let pending = null;
                // Standard ladder pairing over the non-bye seeds: best vs worst inward —
                // with 7 teams that is 2v7, 3v6, 4v5, the canon week 15.
                for (let game = 0; game < games; game += 1) {
                    const home = entrants[byes + game];
                    const away = entrants[n - 1 - game];
                    const match = play("quarterfinal", startWeek, home, away);
                    if (!match) {
                        pending ?? (pending = fixtureOf("quarterfinal", startWeek, home, away));
                        continue;
                    }
                    winners.push(asSeed(match.winnerId));
                }
                if (pending)
                    return state({ next: pending });
                semifinalists = [...entrants.slice(0, byes), ...winners];
                semifinalWeek = startWeek + 1;
            }
            // Semifinals, NFL-style re-seeding: sort the four survivors by seed; the
            // best remaining plays the worst remaining, the middle two meet.
            const seededFour = [...semifinalists].sort((left, right) => left.seed - right.seed);
            const semiPairs = [
                [seededFour[0], seededFour[3]],
                [seededFour[1], seededFour[2]],
            ];
            const semiWinners = [];
            const semiLosers = [];
            let pendingSemi = null;
            for (const [home, away] of semiPairs) {
                const match = play("semifinal", semifinalWeek, home, away);
                if (!match) {
                    pendingSemi ?? (pendingSemi = fixtureOf("semifinal", semifinalWeek, home, away));
                    continue;
                }
                semiWinners.push(asSeed(match.winnerId));
                semiLosers.push(asSeed(match.loserId));
            }
            if (pendingSemi)
                return state({ next: pendingSemi });
            // The final week holds both games: the championship between the semifinal
            // winners and the Camel between the losers; better seed is home in each.
            const finalWeek = semifinalWeek + 1;
            const [finalHome, finalAway] = [...semiWinners].sort((left, right) => left.seed - right.seed);
            const [thirdHome, thirdAway] = [...semiLosers].sort((left, right) => left.seed - right.seed);
            const final = play("championship", finalWeek, finalHome, finalAway);
            const third = play("third-place", finalWeek, thirdHome, thirdAway);
            const next = !final
                ? fixtureOf("championship", finalWeek, finalHome, finalAway)
                : !third
                    ? fixtureOf("third-place", finalWeek, thirdHome, thirdAway)
                    : null;
            return state({
                championId: final ? final.winnerId : null,
                runnerUpId: final ? final.loserId : null,
                thirdPlaceId: third ? third.winnerId : null,
                next,
                complete: Boolean(final && third),
            });
        }

        return { HEAVENLY_START_WEEK, HEAVENLY_FIELD_SIZE, MIN_HEAVENLY_FIELD, MAX_HEAVENLY_FIELD, HEAVENLY_CHAMPION_TITLE, HEAVENLY_THIRD_TROPHY, HEAVENLY_PAYOUTS, HEAVENLY_ROUND_LABELS, HEAVENLY_ROUND_PHRASES, heavenlyByeCount, heavenlyBattleSchedule, runHeavenlyBattle };
    })();

    const api = Object.freeze({
        ORIGINAL_DEFAULTS, SACRED_WEEKS, DUAT_ORIGINAL_ARMY_COUNT,
        DUAT_ORIGINAL_D20_BANDS, FACTIONS, TERRITORIES, ROUTES, FAVORS, WORLD,
        createSeededRandom, ...heptad, ...heavenly
    });
    App.DuatRules = api;
    /* global module */
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
