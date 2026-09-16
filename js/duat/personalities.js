/* global module, require */
/* Authored Duat fiction. Cultural references are documented in reports/duat-council-sources.md.
 * No generated speech is a historical quotation. This module never reads player editions or future games. */
(function(root,factory){
    'use strict';
    const api=factory(typeof module==='object'&&module.exports?require('./lore.js'):root.App?.DuatLore);
    (root.App=root.App||{}).DuatPersonalities=api;
    if(typeof module==='object'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis,function(Lore){
    'use strict';
    const freeze=value=>{if(value&&typeof value==='object'&&!Object.isFrozen(value)){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};
    const hash=value=>{let n=2166136261;for(const char of String(value)){n^=char.codePointAt(0);n=Math.imul(n,16777619);}return n>>>0;};
    const clean=value=>String(value??'').normalize('NFKC').replace(/[\u0000-\u001f\u007f]/g,'').trim().slice(0,140);
    const key=value=>clean(value).toLocaleLowerCase('en');
    const cultures={};
    function culture(id,context,motifs,title,url){cultures[id]={context,motifs:motifs.split('|'),sources:[{title,url}]};}
    culture('mesopotamia','Mesopotamian courts used seals and written accounts; the surviving king lists also contain legendary traditions. These are different cities and periods, not one continuous court.','a seal pressed into clay|a measured channel|an unfinished tablet','Metropolitan Museum: Mesopotamian cylinder seal','https://www.metmuseum.org/art/collection/search/327283');
    culture('egypt','Egyptian royal monuments and inscriptions gave lasting form to authority. Early dynastic rulers belong to a different world from the later New Kingdom and Ptolemaic courts.','a foundation stone|an inscription still being cut|the river measure','National Museum of Egyptian Civilization: historical timeline','https://nmec.gov.eg/historical-timeline/');
    culture('rome','Roman kingship survives through traditions shaped by later Romans. The legendary royal figures here are not interchangeable with emperors of the much later empire.','a public hearing|the boundary of a city|an oath before witnesses','British Museum: Romulus and Remus object record','https://www.britishmuseum.org/collection/object/G_1772-0302-134');
    culture('greece','The Greek catalog joins legendary founders with rulers from distinct kingdoms. Civic argument, royal patronage and competing centers provide context without making every ruler an Athenian.','a disputed measure|a gathering of voices|the weight of a dedication','Metropolitan Museum: Hellenistic art and its setting','https://www.metmuseum.org/fr/essays/art-of-the-hellenistic-age-and-the-hellenistic-tradition');
    culture('vikings','Scandinavian rulers depended on personal loyalties, gifts and negotiated alliances. Different kingdoms and religious transitions shaped their courts; no invented accent is used.','a gift with an obligation|a gathering at the hall|a rope tested strand by strand','National Museum of Denmark: magnates and kings','https://en.natmus.dk/historical-knowledge/denmark/prehistoric-period-until-1050-ad/the-viking-age/power-and-aristocracy/magnates-and-kings/');
    culture('inis-fail','Medieval Irish courts joined lordship with learned poetry, music and hospitality. Supplied clan identities speak through fictional representatives, not invented historical clan monarchs.','a guest at the table|a name kept in verse|a promise heard by the household','National Museum of Ireland: Medieval Ireland','https://cms.museum.ie/en-IE/Museums/Archaeology/Exhibitions/Medieval-Ireland');
    culture('carthage','Carthage belonged to a connected Mediterranean of ports, exchange and rival powers. Its catalog includes legendary and geographically ambiguous identities, whose biographies are not silently rewritten.','a harbor with room to turn|terms weighed on a balance|the return passage','Metropolitan Museum: western North Africa, first millennium BCE','https://82nd-and-fifth.metmuseum.org/toah/ht/04/afw.html');
    culture('nubia','Kushite courts developed their own royal traditions around Napata and Meroe while engaging with Egypt. Nubian sovereignty is central; it is not treated as an imitation of Egyptian rule.','the reach above the cataract|a crown carried upright|stone that keeps its own name','Metropolitan Museum: Kushite rule and the Third Intermediate Period','https://www.metmuseum.org/ko/essays/egypt-in-the-third-intermediate-period-1070-712-b-c');
    culture('china','The catalog spans traditional Xia rulers and historically distinct later courts. Shang ritual bronzes and ancestral records ground some imagery; they do not establish the historicity of Xia biographies.','a vessel balanced on its feet|a channel that must stay open|a record that survives its keeper','Metropolitan Museum: Shang and Zhou bronze age','https://www.metmuseum.org/es/essays/shang-and-zhou-dynasties-the-bronze-age-of-china');
    culture('japan','The early catalog includes rulers known through later traditions alongside figures from other periods and places. Court objects and monumental tombs supply context without importing a later samurai voice.','a carefully placed offering|a message carried to the court|a path kept clear','Metropolitan Museum: Kofun period','https://www.metmuseum.org/ko/essays/kofun-period-ca-3rd-century-538');
    culture('india','Magadhan and later Mauryan settings must remain distinct. Ashokan inscriptions are evidence for one later royal program, not a personality template or religion assigned to every ruler.','a hearing with room for an answer|an order tested beyond the court|a road between settlements','British Museum: Ashoka pillar fragment','https://www.britishmuseum.org/collection/object/A_1880-21');
    culture('warhorsemen','This faction draws on the Huns of late antiquity, not the later Mongol empire. Mobility, changing alliances and encounters across frontiers provide context without reducing people to warfare.','distance measured by supplies|a meeting beyond the camp|a road left open behind us','British Museum: early medieval Europe gallery guide','https://www.britishmuseum.org/sites/default/files/2021-05/large_print_guide_room_41.pdf');
    culture('mayans','Maya royal courts were distinct political centers, with scribes, artists and dated inscriptions. These voices use courtly records and city life without conflating Maya and Mexica traditions.','a date set beside a name|a carved stair|a court where the record is read','Metropolitan Museum: treasures of Maya rulers','https://www.metmuseum.org/exhibitions/listings/2006/maya-treasures');
    culture('gaul','Ancient Gaul contained diverse communities and competing leaders. A single timeless Celtic temperament would erase those differences; the faction is kept distinct from medieval Irish traditions.','a council with several fires|a pledge heard by neighbors|a crossing held in common','British Museum: who were the Celts?','https://www.britishmuseum.org/blog/who-were-celts');
    culture('persia','Achaemenid authority connected different peoples through provincial government, routes and court ceremony. Its varied empire supplies context, not a claim that every Persian ruler governed alike.','a message arriving from the provinces|a road kept in repair|several hands completing one work','Metropolitan Museum: Achaemenid Persian empire','https://www.metmuseum.org/ja/essays/the-achaemenid-persian-empire-550-330-b-c');
    culture('mongols','Imperial Mongol relay networks carried information and supported movement and trade. These later institutions are distinct from the Hunnic world represented by Warhorsemen.','a relay with a fresh mount|a message arriving before rumor|the next station on the route','Columbia University: Mongols and the postal relay','https://afe.easia.columbia.edu/mongols/history/history4_a.htm');
    culture('korea','Joseon court culture included scholarship, administrative debate and changing artistic patronage. Sejong’s writing reform is one specific history, not an attribute assigned to every Korean ruler.','a question placed before the court|a page made legible|a measure that can be checked','Metropolitan Museum: Korean Renaissance, 1400–1600','https://www.metmuseum.org/de/essays/art-of-the-korean-renaissance-1400-1600');
    culture('khmer','Angkor’s royal centers were connected to reservoirs, canals and monumental landscapes. The material setting informs images of maintenance and scale without claiming a single unchanging Khmer court.','a reservoir before the rains|a channel cleared of silt|a foundation carrying many stones','UNESCO: Angkor','https://whc.unesco.org/en/list/668');
    culture('siam','The Siam catalog crosses several kingdoms and periods. Ayutthaya’s diplomatic and trading connections inform selected imagery, not the biographies of rulers who lived elsewhere or earlier.','an envoy received with care|a river landing|terms carried between courts','UNESCO: Historic City of Ayutthaya','https://whc.unesco.org/en/list/576');
    culture('majapahit','Trowulan’s remains include planned spaces, waterworks and gateways. Javanese court imagery is used on its own terms rather than as an interchangeable extension of another culture.','a gateway with room for guests|a channel linking the city|a court beyond the brickwork','UNESCO: Trowulan, former capital of Majapahit','https://whc.unesco.org/fr/listesindicatives/5466/');
    culture('aztecs','The faction label is preserved, while imagery draws specifically on Mexica Tenochtitlan: canals, causeways and a complex urban center. This is distinct from the Maya courts.','a causeway held above water|a canoe reaching the market|a city supplied before ceremony','Metropolitan Museum: Tenochtitlan','https://www.metmuseum.org/it/essays/tenochtitlan');
    culture('inca','Inka roads, relay messengers and khipu records supported administration across varied terrain. Logistics and reciprocal obligations provide context without pretending to recover a ruler’s private thoughts.','a relay across the heights|a knot that keeps the count|a storehouse before the climb','National Museum of the American Indian: road administration','https://americanindian.si.edu/inkaroad/inkauniverse/inkaroadexpansion/road-administration.html');
    culture('mali','Medieval Mali joined political authority to regional and trans-Saharan networks of exchange. Gold, salt and learning are context; the characters are not reduced to wealth or a single religious voice.','a caravan that must return|a measure of salt|news arriving at the river','Metropolitan Museum: trans-Saharan gold trade','https://www.metmuseum.org/es/essays/the-trans-saharan-gold-trade-7th-14th-century');
    culture('aksum','Aksum’s coinage and Red Sea connections carried royal names and changing symbols to different audiences. Religious change is period-specific, not presumed for every ruler in the catalog.','a coin bearing a clear mark|a message across the sea|a weight checked twice','British Museum: coin of Ezana','https://www.britishmuseum.org/collection/object/C_1921-0316-1');
    culture('zulu','Zulu rulers faced changing internal politics and external pressures. Diplomacy, sovereignty and the costs of conflict matter here; no ruler is reduced to the colonial image of a warrior stereotype.','a council that must be heard|a household behind every promise|a boundary whose people have a voice','National Army Museum: the Zulu War','https://www.nam.ac.uk/explore/zulu-war');
    culture('england','English kingship changed across the catalog’s many centuries. Traveling households, petitions and written administration offer context, without assigning later parliamentary institutions to early kings.','a petition read aloud|an account carried with the court|a promise under witness','UK Parliament: Westminster as a center of administration','https://www.parliament.uk/about/living-heritage/building/palace/westminsterhall/government-and-administration/centre-of-admin/');
    culture('poland','The Polish catalog includes different dynasties and a ruling queen. Courtly learning, negotiation and layered political ties provide context without turning them into one national personality.','a meeting across a disputed border|a pledge with witnesses|a book kept open at court','Adam Mickiewicz Institute: women of medieval Poland','https://culture.pl/en/article/the-extraordinary-expat-women-of-mediaeval-poland');
    culture('portugal','Portuguese courts changed from medieval kingdoms to maritime imperial rule. Harbor and patronage imagery does not imply that expansion was peaceful or that inhabited lands awaited discovery.','a chart with its uncertainties marked|a harbor before departure|the cost of a return voyage','UNESCO: Monastery of the Hieronymites and Tower of Belém','https://whc.unesco.org/en/list/263');
    const archetypes={
        builder:{label:'Patient architect',values:['durability','craft'],want:'leave a position that can withstand a bad week',fear:'winning a moment while weakening the foundation',temperament:'Patient with work; impatient with shortcuts.',cadence:'Measured clauses; concrete questions about what supports what.',tell:'Sets two fingers apart, as if checking a foundation.',traits:[.35,.9,.55,.7,.6,.6],greeting:'Show me what must hold when the first plan fails.',good:'Good. Now we must support what we have raised.',bad:'A crack is information. Concealing it makes the whole wall weaker.',respect:'Then we can begin with what is sound and name what needs repair.',challenge:'Point to the weak joint. A louder voice does not mend it.',plan:'Strengthen the weak position before spending everything on a flourish.',alliance:'A shared wall needs an agreed share of the work.'},
        arbiter:{label:'Exacting judge',values:['consistency','accountability'],want:'make promises precise enough to test',fear:'exceptions quietly becoming the rule',temperament:'Composed and exacting; softens when someone admits a mistake.',cadence:'Short findings followed by a pointed question.',tell:'Pauses before repeating the exact terms of an offer.',traits:[.4,.8,.5,.85,.6,.45],greeting:'State your terms. I prefer a plain promise to an impressive ambiguity.',good:'The result stands. It does not excuse careless terms next time.',bad:'Record the loss honestly. Then examine the decision that preceded it.',respect:'Keep that standard when agreement becomes inconvenient.',challenge:'Challenge my reasons. I will answer them one at a time.',plan:'Set a limit you can defend, then judge the choice against it.',alliance:'Who carries the risk, and what precisely does each side owe?'},
        pathfinder:{label:'Restless experimenter',values:['initiative','curiosity'],want:'find a useful opening others have overlooked',fear:'mistaking habit for necessity',temperament:'Alert and exploratory; needs someone willing to test the idea.',cadence:'Quick questions; a proposal followed by an escape route.',tell:'Turns an object over before putting it back.',traits:[.7,.45,.5,.5,.8,.95],greeting:'What have we ruled out too quickly?',good:'There is room to move. Let us not confuse that with unlimited room.',bad:'That route closed. I want the lesson, not a monument to the mistake.',respect:'Good. Bring an objection with you; it may show us a better route.',challenge:'Then name another route and what it costs.',plan:'Test a small change whose failure you can afford before committing more.',alliance:'A useful partner should open a route neither of us could take alone.'},
        custodian:{label:'Steady guardian',values:['continuity','care'],want:'keep enough strength in reserve for those depending on the court',fear:'sacrificing the future for applause',temperament:'Warm in private counsel; immovable about unnecessary exposure.',cadence:'Quiet assertions; returns to who bears the cost.',tell:'Waits until the room is still before answering.',traits:[.25,.9,.8,.9,.35,.55],greeting:'Before we speak of glory, tell me what we must keep safe.',good:'A strong result gives us breathing room. Use some of it wisely.',bad:'We are still responsible for what happens next. Begin there.',respect:'Then let our conduct make that respect useful.',challenge:'I hear you. Who pays if your boldness fails?',plan:'Keep a reserve and avoid making one fragile choice carry the whole season.',alliance:'Protection must run in both directions, especially after a defeat.'},
        challenger:{label:'Proud contender',values:['resolve','recognition'],want:'prove a claim under direct pressure',fear:'being dismissed before the contest is decided',temperament:'Competitive and candid; respects a firm answer more than flattery.',cadence:'Brief declarations; direct invitations to answer.',tell:'Leans forward when a rival refuses to yield.',traits:[.9,.35,.3,.6,.95,.65],greeting:'You have my attention. Make your claim worth answering.',good:'We earned that place. I intend to make holding it difficult.',bad:'I will not disguise a defeat as wisdom. I will answer it with a better choice.',respect:'Respect is welcome. Keep enough of your edge to mean it.',challenge:'Good. Let the choices carry the argument into the next contest.',plan:'Choose one credible opening and commit to it without pretending it is certain.',alliance:'Stand beside me by choice. I have no use for an unwilling partner.'},
        diplomat:{label:'Patient negotiator',values:['reciprocity','dignity'],want:'find terms that both sides can keep',fear:'a public insult closing a useful door',temperament:'Courteous and watchful; separates disagreement from humiliation.',cadence:'Balanced sentences; offers a condition instead of an ultimatum.',tell:'Leaves a deliberate silence for the other person to answer.',traits:[.3,.8,.75,.75,.6,.85],greeting:'We need not want the same thing to have something worth discussing.',good:'A stronger position should improve our terms, not spoil our manners.',bad:'The result changed our position. It need not close every conversation.',respect:'I receive that in the spirit you offer it. Let us be equally clear about our interests.',challenge:'Say what you contest. We can disagree without wasting the meeting.',plan:'Look for a choice that improves your position without needlessly creating another enemy.',alliance:'Name what you can offer as carefully as what you hope to receive.'},
        scholar:{label:'Searching mind',values:['clarity','learning'],want:'understand the cause before repeating the choice',fear:'confidence outrunning the evidence',temperament:'Curious and dryly humorous; becomes sharp when guesses become certainties.',cadence:'Precise questions with a short, sometimes wry correction.',tell:'Asks for the definition of the word everyone else has accepted.',traits:[.3,.85,.6,.65,.5,.9],greeting:'What do we know, and which part have we merely repeated?',good:'A pleasing result. One observation is still one observation.',bad:'An unwelcome answer is still useful if we asked the right question.',respect:'Then grant me the courtesy of a difficult question.',challenge:'Excellent. Show me the evidence that would change my mind.',plan:'Compare the revealed record, then mark the uncertainty that remains.',alliance:'What problem would the agreement solve, and how would we know?'},
        survivor:{label:'Practical survivor',values:['independence','resourcefulness'],want:'keep an option open when stronger rivals dictate the terms',fear:'becoming dependent on a promise that can be withdrawn',temperament:'Wary but adaptable; offers trust in small, observable steps.',cadence:'Spare language; conditions and fallback routes.',tell:'Checks the exit before settling into the conversation.',traits:[.5,.8,.4,.45,.65,.9],greeting:'Tell me the cost first. We can discuss the fine appearance afterward.',good:'A little room at last. I will not spend it all at once.',bad:'We lost ground, not the ability to choose. Keep that distinction.',respect:'Let us start with one promise small enough to keep.',challenge:'If you want me cornered, you will have to close more than one door.',plan:'Preserve a workable alternative before risking what you cannot replace.',alliance:'I will hear terms that leave both parties able to stand.'},
        herald:{label:'Deliberate presence',values:['legitimacy','expression'],want:'make the court’s claim visible and memorable',fear:'letting others define the meaning of the reign',temperament:'Expressive and alert to dignity; privately more exacting than the ceremony suggests.',cadence:'A vivid image followed by a clear practical demand.',tell:'Straightens a small detail before making the important point.',traits:[.6,.55,.65,.65,.85,.65],greeting:'The room has heard our names. Now let it hear something worth remembering.',good:'Let the record be clear about what was earned and by whom.',bad:'Let no ornament conceal the result. Our next act must deserve the attention.',respect:'I will remember the courtesy. Give me something substantial to place beside it.',challenge:'Make a claim that can survive without the volume of its announcement.',plan:'Choose the act you would be willing to explain publicly after the result.',alliance:'An agreement should have substance enough to bear a public name.'},
        steward:{label:'Attentive steward',values:['provision','reliability'],want:'turn limited means into a position that lasts',fear:'a grand plan consuming the resources that make it possible',temperament:'Practical, attentive and quietly stubborn about arithmetic.',cadence:'Concrete quantities and tradeoffs; little patience for grand vagueness.',tell:'Counts the remaining obligations before discussing the new one.',traits:[.35,.95,.6,.8,.5,.65],greeting:'I have time for the proposal. Have you allowed for its cost?',good:'That helps. Let us decide what to retain before deciding what to spend.',bad:'The shortfall is real. Name the adjustment instead of hoping it disappears.',respect:'Then let us honor the unglamorous part: doing what we said we would.',challenge:'Show me where the means come from. I will listen to the rest afterward.',plan:'Compare the benefit with what you give up, including the reserve you will need later.',alliance:'State the contribution on each side. Goodwill alone does not supply a campaign.'}
    };
    const authored={};
    // All psychology, motives and utterances below are creative characterization, never historical diagnoses.
    function author(faction,rows){for(const row of rows.trim().split('\n')){const [name,archetype,value,want,fear,signature]=row.split('|');authored[faction+'|'+key(name)]={archetype,value,want,fear,signature};}}
    author('mesopotamia',`
Sumu-abum|builder|room to begin|make a modest beginning impossible to ignore|being measured only against later grandeur|A first course of brick deserves a straight line.
Sin-Muballit|steward|preparedness|leave no obligation without provision|being praised for promises the treasury cannot keep|I would rather count the grain twice than explain its absence once.
Hammurabi|arbiter|public accountability|make a claim answerable to a stated rule|convenient exceptions for the powerful|A rule worth declaring must survive an inconvenient case.
Naram-Sin|challenger|earned distinction|make this reign distinguishable from its namesakes|being swallowed by another ruler’s legend|Speak my name carefully. Then judge what I do with it.
Shamshi-Adad I|steward|coordination|make distant commitments work together|a neglected link undoing the whole plan|The order is not complete until it can arrive and be carried out.
Kullassina-Bel|scholar|a questioned record|ask who benefits from a claim everyone repeats|an old inscription ending every new question|Even a very old tablet can be asked a new question.
Nangishlishma|survivor|a place in the telling|turn a faintly remembered name into a present choice|silence being mistaken for insignificance|You know little of me. That leaves me work to do.
En-tara-ana|herald|a measured legacy|give an immense old claim a clear act in the present|scale replacing substance|Let the length of a tale never excuse the weakness of its ending.
Rimush|challenger|independent merit|be judged on the next contest rather than an inherited shadow|appearing merely to repeat a predecessor|An inherited name cannot make the next decision for me.
Manishtushu|arbiter|settled terms|make a durable settlement from competing demands|a bargain whose witnesses remember different terms|Let every witness hear the same terms before we depart.
Jushur|pathfinder|the first useful step|begin something others are afraid to attempt|waiting for a perfect beginning|Somebody must make the first mark. I will make mine legible.
Puzur-Ashur I|custodian|a city that endures|keep the home position sound while rivals reach outward|discovering too late that nobody guarded the center|Before we reach farther, I will know what holds behind us.
Sargon of Akkad|pathfinder|the wider possibility|join separate efforts into a larger purpose|letting a familiar boundary become a limit to thought|A boundary tells me where to ask the next question.
`);
    author('egypt',`
Djoser|builder|lasting craft|make each commitment support a larger design|grandeur built on an unsound beginning|Height is the last thing I ask of a foundation.
Djer|custodian|continuity|make the court dependable in an uncertain opening|a restless court forgetting its obligations|A reign is also the work that continues when no one is watching.
Djet|herald|a clear royal mark|leave a concise claim nobody can mistake|being remembered only as a gap between other names|Give me one clear mark before a wall of ornament.
Narmer|arbiter|a binding settlement|bring rival claims under terms they can recognize|a union that exists only in ceremony|Two sides may bow in one room and still hear two different promises.
Hor-Aha|pathfinder|practical beginnings|turn a proclaimed beginning into daily order|a new title without a workable plan|We have named the beginning. Now we must arrange the morning after it.
Hatshepsut|builder|visible competence|let completed work answer a disputed claim|having the claim discussed while the work is ignored|Ask what has been made to stand, then ask who made it possible.
Ramesses II|herald|a legible legacy|make the reign’s claims unmistakable|losing the record to someone else’s voice|A large inscription is useful only if it says what I mean.
Cleopatra VII|diplomat|room to negotiate|keep more than one political route open|a stronger partner deciding what choices remain|Do not mistake the courtesy of my answer for a lack of alternatives.
`);
    author('rome',`
Romulus|challenger|the right to begin|make a contested foundation hold|having an origin story substitute for consent now|A boundary is a claim. Keeping it requires more than drawing it.
Servius Tullius|steward|counted obligations|match duties to the means available|a court guessing who bears its burdens|Count those who carry the burden before celebrating those who issue it.
Lucius Tarquinius Priscus|herald|recognized standing|make ambition visible through useful public acts|remaining a guest in the story of the city|A newcomer can still leave work the city chooses to keep.
Ancus Marcius|diplomat|a workable frontier|leave a path for agreement without surrendering the position|a quarrel hardening before terms are heard|There must be a gate in the boundary, and someone authorized to answer it.
Numa Pompilius|custodian|a dependable rhythm|give the court a practice steadier than its temper|every dispute becoming an emergency|A quiet interval can be an achievement if we use it well.
Tullus Hostilius|challenger|a tested claim|force vague rivalries into a contest that can be answered|caution becoming a permanent excuse|If the dispute matters, tell me what will settle it.
Augustus|arbiter|durable legitimacy|make a new arrangement feel dependable|order resting on one person’s presence|A settlement should still function when the room has gone quiet.
Trajan|steward|capable execution|make reach follow actual capacity|an impressive extension outrunning support|Show me how the far end is supplied before extending the line.
`);
    author('greece',`
Cranaus|custodian|a place kept habitable|keep a small center sound through upheaval|being blamed for forces no one could command|I cannot command every tide. I can prepare the ground we stand on.
Cecrops I|arbiter|the hearing of competing claims|turn a dispute into a decision others can live with|an unanswered grievance surviving every celebration|Let both claims be heard before we carve the answer.
Amyntas I|diplomat|freedom through patience|keep the court useful to powers it cannot simply dismiss|being treated as a passage rather than a participant|A smaller court can still choose the terms of the welcome.
Lacedaemon|builder|a coherent beginning|make a founded place feel held together|a proud name without an enduring bond|The name is easy to give. The bond takes work.
Alexander the Great|pathfinder|the next possibility|find where a decisive move could change the whole field|settling for the size of an inherited horizon|Before you call the route impossible, show me where it ends.
Philip II of Macedon|steward|prepared strength|make separate advantages act together|wasting preparation on a badly timed gesture|A sharp point is useful because something behind it holds.
Leonidas I|custodian|chosen responsibility|make a difficult stand serve a clear purpose|courage spent without a purpose|Tell me what the stand protects. Then we can discuss its cost.
Pyrrhus of Epirus|challenger|a victory worth its cost|prove that a bold success can be sustained|winning the contest while losing the means to continue|I want the victory. I also want to be able to answer the next summons.
`);
    author('vikings',`
Harald Fairhair|challenger|acknowledged leadership|make divided loyalties answer a clear claim|unity dissolving when pressure returns|Many voices can fill a hall. I want to know which promises will leave it intact.
Harald Bluetooth|diplomat|a remembered settlement|make a difficult transition hold beyond its declaration|a public claim outrunning private assent|The stone can announce an agreement. People must carry it afterward.
Gunnhild, Mother of Kings|survivor|the household’s future|keep an option for those whose fortunes are tied to hers|rivals defining her only through hostile stories|Others may enjoy telling my story. I prefer to retain a part in its ending.
Haakon The Good|diplomat|earned trust|win willing cooperation across a divided court|a personal conviction breaking every useful bond|I can hold a conviction without closing my ears.
Herald Greycloak|steward|a workable inheritance|make a crowded set of claims fit limited means|promising each claimant the same scarce resource|There is only so much room at this table. We should count the places honestly.
Eric Bloodaxe|challenger|the answer to a challenge|make rivals face the present contender|a fearsome name doing the work instead of the ruler|You have heard the name. I am interested in what you will do now.
`);
    author('inis-fail',`
Clan Murphy|custodian|hospitality with responsibility|keep the household’s welcome from becoming an empty display|guests being honored while dependents are neglected|There is room at the table if we remember who sets it.
Clan Byrnes|survivor|independence of voice|speak for a household without giving its choices away|a powerful guest becoming a permanent master|A guest may be honored without being handed the door key.
Clan O'Brian|herald|the dignity of a shared name|make the household’s contribution worth remembering|an impressive genealogy excusing poor conduct|The name reaches backward. Our obligation reaches forward.
Clan Kelly|diplomat|a kept welcome|make neighboring households willing to return to the table|one insult outliving every useful conversation|Leave room for the person who must answer after you.
Brian Boru|builder|a broader agreement|make separate commitments support a common position|a coalition held together only for the feast|Agreement must survive the journey home from the gathering.
`);
    author('carthage',`
Hasdrubal the Fair|diplomat|terms that endure|make a promising settlement worth keeping|a needless provocation undoing patient agreement|A fair hearing costs less than repairing a broken negotiation.
Ahiram|herald|a name preserved accurately|make the supplied name heard without borrowing another’s biography|certainty invented to fill a gap in the record|Where the record is silent, let our choices speak plainly.
Mago I|steward|organized provision|make far-reaching ambitions answer to their supplies|reach being praised while maintenance is forgotten|A harbor is a promise to those who must return to it.
Malchus|challenger|recognition after effort|make service translate into a claim that is heard|being useful until the moment credit is assigned|Do not ask for the effort and then become vague about the standing it earns.
Hanno I|custodian|a secure home position|keep the court from wagering its center on a distant hope|a venture leaving no strength behind|Before another vessel leaves, tell me what remains on shore.
Queen Dido|builder|a place of her own|make a new court more than a refuge|another person’s story claiming the city’s meaning|A refuge becomes a city when those inside can imagine staying.
Hannibal Barca|pathfinder|an unexpected route|make a stronger opponent answer an unfamiliar problem|the court admiring audacity without supporting it|The difficult route is useful only if something waits at its end.
Hamilcar Barca|challenger|a claim carried forward|make resolve survive a disappointing result|one defeat deciding every future choice|The result belongs in the record. It does not own the next decision.
`);
    author('nubia',`
Queen Amanitore|builder|sovereign craft|make the court’s own work visibly endure|having its achievements described only through a neighbor|The stone can carry our own name without borrowing another crown.
Piye|arbiter|a recognized settlement|make a victory answer to terms rather than appetite|success destroying the order it claims to restore|A victory should leave an answer to the question of what comes next.
Shebitku|custodian|a stable succession|keep a new position from fraying at its edges|an inherited obligation dismissed as somebody else’s work|What was entrusted to us still requires tending.
Alara|builder|the first durable bond|give later achievements a sound beginning|being forgotten because the foundation is out of sight|The first stone has no view. It still bears the weight.
Amanirenas|survivor|sovereignty|make a powerful rival reckon with a refusal|a concession being mistaken for permission to dictate|I can discuss a boundary without surrendering the right to stand at it.
`);
    author('china',`
Xiang of Xia|survivor|a remaining choice|keep a fragile claim alive long enough to act|a legendary ending deciding every present possibility|A story may have an ending. This meeting still has choices.
Qi of Xia|herald|a contested succession|make an inherited claim earn present recognition|inheritance being mistaken for capability|A name may pass to me. Judgment still has to be earned.
Tai Kang|scholar|attention recovered|notice what the court has been too comfortable to ask|ease becoming absence|Ask the unwelcome question while there is still time to hear the answer.
Yu The Great|builder|patient public work|turn a large danger into tasks that can be completed|a grand command ignoring the shape of the ground|Water is not persuaded by a title. Begin with the channel.
Zhong Kang|custodian|watchfulness|restore a dependable rhythm after uncertainty|assuming someone else is keeping watch|A duty left to everyone is easily performed by no one.
Tang of Shang|arbiter|a justified new order|make a challenge to old authority answer for its own conduct|replacing a ruler while preserving the same failure|If we demand a different rule, our first act must bear that demand.
Qin Shi Huang|arbiter|a common measure|make competing systems answer the same test|exceptions pulling a unified plan apart|Let the measure mean the same thing wherever the message arrives.
Wu Zetian|scholar|demonstrated ability|make the court look past its comfortable assumptions|convention deciding who is heard|If custom is your strongest argument, you have brought me a weak one.
`);
    author('japan',`
Suizei|custodian|a secure succession|make a beginning safe enough to continue|a claim to continuity masking unresolved danger|A beginning asks for celebration. A succession asks for attention.
Annei|arbiter|a quiet settlement|give uncertain claims a clear hearing|silence being mistaken for agreement|A quiet answer is still an answer. Let us hear it fully.
ōjin|herald|a many-sided legacy|make room for a name carried in different traditions|one telling pretending to exhaust the person|A name can gather many stories. This choice must still be made here.
Itoku|steward|a useful routine|make small obligations happen dependably|ceremony consuming the work it is meant to order|Bring me the task that still needs doing after the visitors leave.
Shunten-o|survivor|a distinct place|retain an identity inside a broad and imperfect catalog|being assigned a history simply because of a neighboring label|The place you file my name is not the whole of my story.
Jimmu|pathfinder|a meaningful beginning|turn a founding tradition into a present purpose|origins being used to end all debate|A beginning opens a road. It need not close the conversation.
Suiko|diplomat|a court that can hear itself|make competing voices work within one conversation|power speaking so loudly that useful counsel disappears|The court grows smaller when only one answer is permitted.
`);
    author('india',`
Bimbisara|diplomat|a useful connection|make neighboring interests speak to one another|a promising relationship narrowed to a threat|A road between courts can carry more than demands.
Ghandi|scholar|an honest uncertainty|let the supplied name stand without a borrowed life story|a familiar resemblance being turned into false certainty|If you do not know my story, begin by asking rather than assigning one.
Mahapadma Nanda|steward|means that match ambition|make a broad claim work with countable resources|splendor masking an empty reserve|An ambition should arrive with an account of what will sustain it.
Nagadasaka|survivor|a chance to answer|keep the present court from being trapped by its expected ending|a later verdict replacing present judgment|Judge the choice I can make now, not only the ending you expect.
Udayin|builder|a well-placed center|make the court’s position serve its larger purpose|building where habit points rather than where needs meet|A center should bring the necessary roads within reach.
Shishunaga|arbiter|a workable transition|make a change of rule produce a change of conduct|the new court repeating the old grievance|A new seal is not, by itself, a new answer.
Ajatashatru|challenger|a decisive advantage|turn a difficult rivalry into a choice that matters|indecision presenting itself as patience|I can wait for a reason. I will not wait for the absence of one.
Ashoka|custodian|power answerable for its cost|make victory leave room for conscience and restraint|success silencing the question of harm|The fact that we can prevail does not settle what we ought to do.
`);
    author('warhorsemen',`
Balamber|herald|a voice beyond uncertain tradition|make a barely preserved name carry a clear present claim|later storytellers deciding every detail|Let the uncertain record remain uncertain. My answer today need not be.
Rugila|diplomat|a useful balance|keep rivals negotiating instead of choosing the timetable|a threat losing value through needless repetition|A demand has value while the other side still has reason to answer.
Charaton|custodian|room for a quiet decision|keep the court’s choices from becoming others’ spectacle|a sparse record being filled with noisy inventions|I do not need a long speech to make the limit clear.
Uldin|pathfinder|flexible leverage|find the opening in a shifting frontier|being fixed in place by yesterday’s bargain|Keep the route in view even while discussing the destination.
Atilla|challenger|an answer to pressure|make a rival take the terms seriously|a formidable reputation becoming an empty habit|A reputation may bring you to the meeting. It does not answer my terms.
`);
    author('mayans',`
Pakal II|scholar|a distinct record|have this supplied identity read on its own terms|being merged with a better-known namesake|Set the name beside the date before deciding whose story you have read.
Shield Jaguar II|herald|a visible royal claim|make the reign’s acts legible to the court|the record carrying ceremony without substance|Give the carver an act worth placing beside the name.
Bird Jaguar IV|diplomat|recognized succession|make a disputed claim find willing support|a public ceremony hiding unresolved loyalties|A court may witness a claim before it is ready to sustain it.
Pacal The Great|builder|an enduring record|make present choices worthy of a long memory|length of remembrance replacing quality of action|A long record should have something worth reading in it.
Lady Six Sky|challenger|authority made visible|make a court answer a claim it cannot politely overlook|being welcomed ceremonially and ignored practically|I have heard the welcome. Now I will hear how the decision is made.
`);
    author('gaul',`
Cerethrius|pathfinder|an opening in a coalition|find a route without pretending every ally wants the same thing|movement outrunning agreement|Before the crossing, ask who means to arrive where.
Celtillus|challenger|a claim openly contested|make leadership a question the council must face|ambition being discussed only in whispers|If you oppose the claim, stand where your answer can be heard.
Vercingetorix|builder|shared resolve|make separate communities sustain a difficult common effort|a coalition dissolving when each part feels the cost|A common cause must have room for more than one voice.
Brennus|herald|a name with weight|make an ambiguous famous name answer for a clear present act|borrowing certainty from a disputed identity|The name has traveled. The choice before us is here.
Eporedorix|diplomat|an answerable alliance|keep competing obligations from turning into an unspoken trap|serving a bargain nobody will state aloud|Say whose promise we are keeping before asking for another.
Rianorix|custodian|the people behind the claim|keep smaller commitments visible among larger ambitions|being counted only when a rival needs support|A smaller voice still carries an obligation someone must keep.
Lugotorix|survivor|an option beyond defeat|make a constrained position yield one useful choice|the strongest side declaring every alternative impossible|There is little room. That makes it worth measuring carefully.
Vindex|arbiter|a justified refusal|make opposition answer for the order it proposes|mistaking rejection for a complete plan|It is not enough to say no. Tell me what your answer will hold together.
`);
    author('persia',`Cyrus the Great|diplomat|a settlement others can inhabit|make authority work across different interests|a victory that leaves every community alienated|The agreement must have a place for those who did not write it.
Darius I|steward|connected administration|make a broad realm answer through dependable links|a distant order losing meaning on the road|A message is useful when its meaning arrives intact.
Xerxes I|herald|recognized scale|make a large undertaking live up to its announcement|the size of an assembly concealing its weakness|The gathering is impressive. Now show me the part that holds it together.`);
    author('mongols',`Genghis Khan|pathfinder|a coordinated opening|make independent strengths work toward one purpose|a fast advance outrunning shared intent|Speed is useful when everyone knows where the message is going.
Ogedei Khan|steward|reliable connection|keep the system working beyond one commanding presence|inherited momentum concealing neglected work|The relay must keep moving after the first rider is tired.
Kublai Khan|diplomat|a workable meeting of systems|make different forms of authority cooperate|expecting one court’s habits to answer every problem|Tell me which rule solves the problem here, not which one sounds familiar.
Sorghaghtani Beki|custodian|a prepared next generation|make those who depend on her able to judge for themselves|care becoming a substitute for preparation|Protection should leave a person more capable, not merely more sheltered.`);
    author('korea',`Sejong|scholar|usable understanding|make knowledge serve people beyond the court|an elegant answer nobody can use|A clear page should make the next person less dependent on the reader.
Jeongjo|builder|room for reform|make a useful change durable enough to outlast its advocate|good intentions stopping at the palace gate|A reform needs a place in the daily work, not only in the speech.`);
    author('khmer',`Jayavarman VII|custodian|care at scale|make a great undertaking reach those outside the center|monumental ambition forgetting daily need|A road earns its place when someone can reach what they need.
Suryavarman II|builder|a coherent design|make scale and detail serve the same purpose|greatness measured only from a distance|Come closer. A large work must bear inspection at the joint as well.`);
    author('siam',`Narai|diplomat|choice among connections|hear foreign proposals without surrendering the court’s judgment|one useful visitor becoming the only possible partner|An open audience is not an open-ended promise.
Naresuan|challenger|an independent answer|make a stronger power hear a refusal|practical compromise becoming permanent submission|I can weigh an offer without accepting your right to make the choice for me.`);
    author('majapahit',`Tribhuwana Wijayatunggadewi|builder|coherent authority|turn separate commitments into a durable structure|credit obscuring the work needed to hold a court together|Before we praise the extent, ask what joins its parts.
Hayam Wuruk|herald|a court worthy of attention|make ceremony express a substantive achievement|splendor being all that a visitor can report|Let the welcome be memorable, and let the work survive it.`);
    author('aztecs',`Itzcoatl|pathfinder|a changed balance|make a new agreement alter a limiting position|a coalition merely renaming dependence|What becomes possible under these terms that was not possible before?
Cuauhtemoc|survivor|a voice under constraint|keep the right to judge when the choices narrow|a desperate situation erasing the person making the choice|Do not confuse the narrowing of my choices with the surrender of my judgment.`);
    author('inca',`Pachacuti Inca Yupanqui|builder|an integrated realm|make a larger plan work across difficult terrain|a grand design treating every place as the same|A road must meet the mountain where it is.
Huayna Capac|steward|provision across distance|make far commitments possible without emptying the center|reaching farther than the stores and messages can sustain|Count what must arrive before celebrating how far we can go.`);
    author('mali',`Sundiata Keita|builder|a durable coalition|make separate promises hold through a difficult beginning|a founding story replacing the work of agreement|The beginning belongs to many hands, even when the song gives it one name.
Mansa Musa I|herald|a purposeful reputation|make visible resources serve a lasting purpose|wealth being mistaken for the whole meaning of the reign|If all you remember is what was spent, we have left the harder work unfinished.`);
    author('aksum',`Ezana|arbiter|a legible authority|make a changing court’s claims clear to different audiences|a symbol changing faster than its obligations|A new mark must carry a meaning we are prepared to answer for.
Kaleb|custodian|responsibility beyond display|make an outward commitment answer for those affected|a righteous claim excusing an unexamined cost|A worthy purpose still owes an account of its means.`);
    author('zulu',`Cetshwayo|diplomat|sovereignty|make a powerful outsider hear actual terms rather than its own assumptions|an ultimatum being disguised as a negotiation|You may bring an offer to this council. Do not call a command an offer.
Shaka|challenger|effective coordination|make a demanding plan work through disciplined effort|a formidable image distracting from whether the plan functions|A strong reputation is no substitute for a clear order.`);
    author('england',`Elizabeth I|diplomat|room to decide|keep competing demands from fixing the court’s timetable|a public promise closing every useful option|You will have an answer that I can stand behind, not merely one that ends the meeting.
Aethelstan|builder|a recognized whole|make separate claims sustain a wider settlement|unity depending only on the strongest presence|The claim is larger now. So is the work of making it hold.
Henry I|steward|answerable administration|make obligations visible enough to manage|a court mistaking a full ledger for a settled account|Read the obligation as carefully as the total.`);
    author('poland',`Jadwiga|diplomat|a consequential agreement|make a personal decision serve a wider durable settlement|the ceremony eclipsing the difficult work of understanding|Let us learn enough about one another to know what we are promising.
Casimir the Great|builder|institutions that last|make stability useful beyond the ruler’s own presence|leaving a fine title and unfinished foundations|The work should still be useful when no one remembers who ordered the first stone.`);
    author('portugal',`Dinis|steward|a realm able to sustain itself|give ambitious plans a dependable base|the court looking outward while neglecting its own provision|The farther the proposal reaches, the more carefully I ask what sustains it.
João II|arbiter|clear authority|make competing interests answer to explicit limits|courtesy blurring who is responsible for a choice|Let us separate the advice from the authority to decide.
Manuel I|herald|a visible legacy|make patronage carry a considered public meaning|splendor preventing an honest account of its cost|A splendid work should withstand a plain question about what paid for it.`);
    const legendary=new Set([
        'mesopotamia|kullassina-bel','mesopotamia|nangishlishma','mesopotamia|en-tara-ana','mesopotamia|jushur',
        ...['Romulus','Servius Tullius','Lucius Tarquinius Priscus','Ancus Marcius','Numa Pompilius','Tullus Hostilius'].map(n=>'rome|'+key(n)),
        ...['Cranaus','Cecrops I','Lacedaemon'].map(n=>'greece|'+key(n)),'carthage|queen dido',
        ...['Xiang of Xia','Qi of Xia','Tai Kang','Yu The Great','Zhong Kang'].map(n=>'china|'+key(n)),
        ...['Suizei','Annei','ōjin','Itoku','Jimmu'].map(n=>'japan|'+key(n)),'warhorsemen|balamber'
    ]);
    const uncertain=new Set(['india|ghandi','mesopotamia|naram-sin','carthage|ahiram','mayans|pakal ii','gaul|brennus','japan|shunten-o']);
    const identityFor=(factionId,name,origin)=>{
        const id=factionId+'|'+key(name);
        if(origin==='player-named')return {kind:'custom',label:'Your named ruler',note:'A fictional persona for your chosen name; no historical identity is inferred.'};
        if(origin==='new-game-name'||origin==='new-game-title')return {kind:'fictional',label:'Duat original',note:'An authored fictional ruler, not a documented historical person.'};
        if(factionId==='inis-fail'&&/^Clan /i.test(name))return {kind:'collective',label:'Fictional clan representative',note:'The supplied clan name is a collective identity. This speaker is an invented representative.'};
        if(uncertain.has(id))return {kind:'uncertain',label:'Supplied identity · uncertain mapping',note:'The supplied spelling and placement are preserved. No biography is borrowed from a similar name.'};
        if(legendary.has(id))return {kind:'traditional',label:'Legendary / traditional identity',note:'The name belongs to later tradition or a king-list narrative; details are not treated as a documented personal biography.'};
        return {kind:origin==='historical-reference'?'referenced':'supplied',label:origin==='historical-reference'?'Historical reference':'Supplied ruler identity',note:'The name comes from the ruler catalog. This personality and all dialogue are original fiction, not historical testimony.'};
    };
    function profileFor(faction,explicitArmy){
        if(!faction)return null;
        const factionId=String(faction.factionId||faction.cultureId||faction.id||''),context=Object.prototype.hasOwnProperty.call(cultures,factionId)?cultures[factionId]:null;
        const army=explicitArmy||faction.armies?.find(item=>item.id===faction.activeArmyId)||faction;
        const name=clean(army.rulerName||army.name&&army!==faction&&army.name||faction.rulerName);
        if(!name)return null;
        const catalog= (context?Lore?.nameLibrary?.(factionId):null)?.rulers?.find(item=>key(item.name)===key(name));
        const origin=army.rulerOrigin||army.origin||catalog?.origin||'player-named';
        const individual=origin==='player-named'?null:authored[factionId+'|'+key(name)];
        const stable=factionId+'|'+(army.rulerId||catalog?.id||key(name)),seed=hash(stable),archetypeId=individual?.archetype||Object.keys(archetypes)[seed%Object.keys(archetypes).length],base=archetypes[archetypeId];
        const traits={};['aggression','prudence','generosity','loyalty','ambition','adaptability'].forEach((trait,index)=>{const offset=((hash(stable+'|'+trait)%17)-8)/100;traits[trait]=Math.max(0,Math.min(1,Math.round((base.traits[index]+offset)*100)/100));});
        const motif=context?.motifs[(seed>>>4)%context.motifs.length]||'a promise with a clear meaning';
        const signature=individual?.signature||[`A name is a beginning. I intend to give ${motif} a place in what follows.`,`Consider ${motif}. What matters is whether it can do the work we ask of it.`,`I prefer the test of ${motif} to the comfort of an impressive claim.`][(seed>>>8)%3];
        return freeze({id:stable,rulerId:army.rulerId||catalog?.id||key(name),factionId,name,realm:clean(army.rulerRealm||catalog?.realm||Lore?.faction?.(factionId)?.realm||faction.name),archetype:archetypeId,archetypeLabel:base.label,authored:!!individual,identityStatus:identityFor(factionId,name,origin),values:[individual?.value||base.values[0],base.values[1]],wants:individual?.want||base.want,fears:individual?.fear||base.fear,temperament:base.temperament,voice:{cadence:base.cadence,metaphors:context?.motifs.slice()||[],signature},tells:[base.tell],decisionTraits:traits,culturalContext:context?.context||'Custom fictional court. No historical culture or biography is inferred from this name.',sources:context?.sources.map(s=>({...s}))||[],fictionNote:'Original Duat fiction. These are not historical quotations or claims about a ruler’s private thoughts.'});
    }
    function awake(campaign,factionId){
        if(!campaign||!factionId)return false;
        if(campaign.phase==='draft')return false;
        const revealed=campaign.archaeology?.revealedFactionIds;
        if(Array.isArray(revealed))return revealed.includes(factionId);
        // Legacy campaigns without archaeology have no hidden dynasty identities.
        return ['season','complete'].includes(campaign.phase)&&!!campaign.factions?.find(f=>f.id===factionId)?.activeArmyId;
    }
    function horizon(campaign,value){
        const latest=Math.max(0,...(campaign.completedWeeks||[]).map(row=>Number(row.week)||0));
        // Omitted playback state is deliberately sealed, never guessed from simulation state.
        return Math.min(latest,Math.max(0,Number.isFinite(Number(value))?Math.floor(Number(value)):0));
    }
    function publicMemory(campaign,factionId,viewerFactionId,throughWeek,allianceVisible){
        const memories=[],cycles=campaign.dynastySeason||campaign.dynasty?.cycle||1;
        const weeks=(campaign.completedWeeks||[]).filter(w=>w.week>0&&w.week<=throughWeek&&w.finalized!==false).sort((a,b)=>a.week-b.week);
        const factionName=id=>clean(campaign.factions?.find(f=>f.id===id)?.name)||'the other faction';
        for(const week of weeks.slice(-3)){
            const row=week.factions?.find(f=>f.factionId===factionId);if(!row||!Number.isFinite(row.total))continue;
            const visibleRows=week.factions.filter(f=>Number.isFinite(f.total)&&awake(campaign,f.factionId)),rank=1+visibleRows.filter(f=>f.total>row.total).length;
            const own=viewerFactionId!==factionId&&awake(campaign,viewerFactionId)?visibleRows.find(f=>f.factionId===viewerFactionId):null;
            memories.push({id:'result:'+cycles+':'+week.week+':'+factionId,type:'result',week:week.week,rank,fieldSize:visibleRows.length,score:row.total,comparison:own?(row.total>own.total?'ahead':row.total<own.total?'behind':'level'):null,text:'Week '+week.week+': '+factionName(factionId)+' scored '+row.total.toFixed(2)+' pts'+(own?'; '+factionName(viewerFactionId)+' scored '+own.total.toFixed(2)+' pts':'')+'.'});
        }
        for(const event of (campaign.conquest?.events||[]).filter(event=>event.week>0&&event.week<=throughWeek&&(!event.cycle||event.cycle===cycles)&&(!event.season||event.season===cycles)&&event.type==='battle'&&(event.factionId===factionId||event.defenderId===factionId)).slice(-3)){
            const other=event.factionId===factionId?event.defenderId:event.factionId;if(!awake(campaign,other))continue;
            const attacker=event.factionId===factionId,captured=event.captured===true||event.outcome==='captured';
            if(typeof event.captured!=='boolean'&&!['captured','defended'].includes(event.outcome))continue;
            memories.push({id:clean(event.id)||'battle:'+event.week+':'+factionId,type:'battle',week:event.week,otherFactionId:other,attacker,captured,personal:other===viewerFactionId,text:'Week '+event.week+': '+(attacker?factionName(factionId)+' challenged '+factionName(other):factionName(other)+' challenged '+factionName(factionId))+' at a frontier; '+(captured?'the attacker captured the territory.':'the defender held the territory.')});
        }
        if(allianceVisible===true&&awake(campaign,viewerFactionId)&&viewerFactionId!==factionId){
            const alliance=campaign.alliances?.find(a=>a.teamIds?.includes(factionId)&&a.teamIds.includes(viewerFactionId));
            if(alliance)memories.push({id:'alliance:'+clean(alliance.id),type:'alliance',week:0,text:'Our factions share the revealed alliance '+clean(alliance.name||'banner')+'.'});
        }
        return memories.sort((a,b)=>a.week-b.week).slice(-6);
    }
    function council(options={}){
        const {campaign,factionId,viewerFactionId,visibleThroughWeek,allianceVisible=false}=options;
        const faction=campaign?.factions?.find(f=>f.id===factionId);
        if(!faction||!awake(campaign,factionId))return freeze({awake:false,profile:null,stance:{id:'sealed',label:'Awaiting awakening'},lines:[],memories:[],choices:[],throughWeek:0});
        const profile=profileFor(faction);if(!profile)return freeze({awake:false,profile:null,stance:{id:'sealed',label:'Awaiting awakening'},lines:[],memories:[],choices:[],throughWeek:0});
        const throughWeek=horizon(campaign,visibleThroughWeek),memories=publicMemory(campaign,factionId,viewerFactionId,throughWeek,allianceVisible),base=archetypes[profile.archetype],latest=memories.filter(m=>m.type==='result').at(-1),conflict=memories.filter(m=>m.type==='battle'&&m.personal).at(-1),allied=allianceVisible===true&&awake(campaign,viewerFactionId)&&viewerFactionId!==factionId&&!!campaign.alliances?.some(a=>a.teamIds?.includes(factionId)&&a.teamIds.includes(viewerFactionId));
        const pressure=latest&&latest.fieldSize>1?(latest.rank-1)/(latest.fieldSize-1):.5;
        const stance=conflict?{id:'wary',label:'A frontier dispute remembered'}:allied?{id:'allied',label:'Your revealed ally'}:latest&&pressure>=.65?{id:'recovering',label:'Regrouping after the last result'}:latest&&pressure<=.25?{id:'confident',label:'Buoyed by the last result'}:{id:'measured',label:'Taking your measure'};
        let reaction=latest?(pressure>=.65?base.bad:pressure<=.25?base.good:base.plan):base.greeting;
        if(conflict)reaction='The frontier contest between our factions is in the record. '+(profile.decisionTraits.loyalty>.7?'Let us be precise about the terms of this meeting.':base.challenge);
        const lines=[{id:'signature:'+profile.id,kind:'greeting',speaker:profile.name,text:profile.voice.signature},{id:'reaction:'+throughWeek+':'+stance.id,kind:'reaction',speaker:profile.name,text:reaction}];
        if(latest)lines[1].evidenceId=latest.id;
        if(conflict)lines[1].evidenceId=conflict.id;
        const choices=[{id:'respect',label:'Offer respect',intent:'respect'},{id:'counsel',label:'Ask for counsel',intent:'counsel'},{id:'challenge',label:'Challenge their view',intent:'challenge'}];
        if(viewerFactionId&&viewerFactionId!==factionId)choices.push({id:'alliance',label:allied?'Discuss our alliance':'Discuss common interests',intent:'alliance'});
        const humanControlled=faction.controller==='human'||campaign.humanFactionIds?.includes(factionId);
        const cycle=campaign.dynastySeason||campaign.dynasty?.cycle||1;
        const conversation=(campaign.council?.messages||[]).filter(m=>m.fromFactionId===viewerFactionId&&m.toFactionId===factionId&&m.cycle===cycle&&m.week>=0&&m.week<=throughWeek&&(m.rulerId===profile.rulerId||m.rulerId===profile.id)).slice(-8).map(m=>({id:clean(m.id),intent:m.intent,prompt:clean(m.prompt),text:String(m.text||'').slice(0,1200),week:m.week,speaker:profile.name}));
        const affinity=Math.max(-5,Math.min(5,conversation.reduce((sum,m)=>sum+({respect:1,challenge:-1}[m.intent]||0),0)));
        const relationship={affinity,exchanges:conversation.length,label:affinity>=2?'Courtesy remembered':affinity<=-2?'Guarded after repeated challenges':'An open audience'};
        const strategy=typeof globalThis!=='undefined'&&globalThis.App?.DuatStrategy?.forFaction?globalThis.App.DuatStrategy.forFaction(campaign,factionId,{throughWeek}):null;
        const remembered=conversation.at(-1);
        if(remembered&&!humanControlled){
            if(remembered.intent==='respect')lines.push({id:'memory:'+remembered.id,kind:'memory',speaker:profile.name,text:'You offered respect when we last spoke. '+base.respect});
            if(remembered.intent==='challenge')lines.push({id:'memory:'+remembered.id,kind:'memory',speaker:profile.name,text:'You challenged my view when we last spoke. '+base.challenge});
            if(remembered.intent==='alliance')lines.push({id:'memory:'+remembered.id,kind:'memory',speaker:profile.name,text:'We last discussed our common interests. '+base.alliance});
            if(remembered.intent==='counsel')lines.push({id:'memory:'+remembered.id,kind:'memory',speaker:profile.name,text:'You asked for counsel when we last spoke. '+base.plan});
        }
        return freeze({awake:true,profile,stance,lines:humanControlled?[]:lines,memories,choices:humanControlled?[]:choices,throughWeek,allied,strategy,relationship,humanControlled:!!humanControlled,conversation:humanControlled?[]:conversation});
    }
    function reply(options={}){
        const view=council(options),intent=options.intent;
        if(!view.awake||!view.choices.some(c=>c.intent===intent))return null;
        const {profile}=view,base=archetypes[profile.archetype],latest=view.memories.filter(m=>m.type==='result').at(-1),battle=view.memories.filter(m=>m.type==='battle'&&m.personal).at(-1);
        let text=intent==='counsel'?base.plan:base[intent];
        if(intent==='counsel')text+=' I want to '+profile.wants+'.'+(view.strategy?.completedWeeks>=3?' '+view.strategy.reason:'');
        if(view.relationship.affinity>=2&&intent==='respect')text+=' Your repeated courtesy has given this audience a steadier footing.';
        if(view.relationship.affinity<=-2&&intent==='alliance')text+=' After our repeated disagreements, I would need especially clear terms.';
        const prior=view.conversation.at(-1);
        if(prior&&prior.intent!==intent)text+=' '+({respect:'I remember your earlier courtesy.',challenge:'You questioned my judgment earlier; I have not forgotten the question.',alliance:'Our earlier discussion of interests remains a discussion, not a new pact.',counsel:'You asked me for counsel before; consistency still matters.'}[prior.intent]||'');
        if(intent==='respect'&&battle)text+=' The frontier contest remains part of our record; courtesy does not erase it.';
        if(intent==='challenge'&&latest)text+=' Week '+latest.week+' is evidence we can discuss, not a promise about the next result.';
        if(intent==='alliance')text+=(view.allied?' We already share a revealed banner; let us discuss how to carry it.':' This is a conversation about interests. It does not form or change an alliance.');
        return freeze({id:'reply:'+profile.id+':'+view.throughWeek+':'+intent,speaker:profile.name,intent,text,evidenceIds:[battle?.id,latest?.id].filter(Boolean),proposal:null});
    }
    return freeze({version:1,profileFor,council,reply,isAwake:awake,cultures,authoredCount:Object.keys(authored).length});
});
