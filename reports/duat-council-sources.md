# Duat royal council: characterization and source brief

Written dialogue implementation, 15 September 2026. Owner: `js/duat/personalities.js` and `js/components/duat-council.js`.

## What the player gets

All 338 catalog names resolve to a stable individual profile. All 86 supplied original identities have individually authored values, wants, fears and signature speech; 49 additional reference identities receive the same treatment. Remaining reference names, authored epithets, exhausted-catalog titles and custom names receive deterministic individual traits. Individual temperament is selected by identity, **never by culture**. Culture provides material context and possible metaphors, not an ethnic personality score.

The court presents one ruler at a time, two short opening lines and four bounded conversational intentions. Character details, historical framing and supporting records are collapsed initially. An audience saves through the existing campaign action flow. It does not itself form alliances, spend favors, trade, or send a message to another human. Human-controlled courts expose a character profile but no fabricated speaker or reply buttons.

Original fiction is explicitly labeled. Values, fears, private motives, gestures and every line of dialogue are creative choices. The references below support the cultural setting; they do **not** establish those psychological details or authenticate a quotation. A documented name is not a documented personality.

## Provenance decisions

- Preserve supplied spellings and placements. `Ghandi` is not silently converted into Mohandas Gandhi, `Naram-Sin` in the Assyrian supplied slot is not assigned the Akkadian namesake’s biography, and `Pakal II` is not merged with `Pacal The Great`.
- `Ahiram`, `Shunten-o` and `Brennus` retain uncertain mapping rather than gaining an invented definitive biography.
- Early Sumerian king-list figures, Rome’s kings, several Greek founders, Xia rulers, early Japanese traditional identities, Dido and Balamber are flagged as legendary or traditional, rather than treated as equally documented contemporaries. This flag is conservative; “supplied ruler identity” elsewhere is not an independent authentication claim.
- Clan Murphy, Clan Byrnes, Clan O’Brian and Clan Kelly are collective supplied identities. Their fictional speakers are labeled clan representatives, not fabricated historical clan monarchs.
- Referenced identities retain their catalog identity. Newly authored epithets and generated fallback titles are explicitly fictional. A custom name has no inferred real biography.
- The catalog spans centuries. Court context states those boundaries; no fake accents, flattened national character, medieval samurai voice for early Japan, or interchange of Huns/Mongols, Maya/Mexica, Gaul/medieval Ireland is used.
- The National Army Museum’s Zulu account is an institutional source with a British military perspective. Characterization centers sovereignty, negotiation and the costs borne by people, rather than adopting a colonial warrior caricature. Maritime Portuguese material is not framed as peaceful discovery of empty lands.

Additional primary/curatorial context for legendary lists: [Oxford ETCSL: Sumerian King List](https://etcsl.orinst.ox.ac.uk/cgi-bin/etcsl.cgi?charenc=j&text=t.2.1.1), [Ashmolean: Sumerian King List](https://www.ashmolean.org/node/178641). These texts supply evidence about a tradition, not proof of its extraordinary reign lengths or private character.

## Cultural reference map

Each link is also available inside that court’s collapsed character panel. The wording is a deliberately broad period-aware context, not a claim that every selected ruler lived in the cited object’s exact time or location.

| Catalog court | Context used | Institutional source |
| --- | --- | --- |
| Mesopotamia | Mesopotamian courts used seals and written accounts; the surviving king lists also contain legendary traditions. These are different cities and periods, not one continuous court. | [Metropolitan Museum: Mesopotamian cylinder seal](https://www.metmuseum.org/art/collection/search/327283) |
| Egypt | Egyptian royal monuments and inscriptions gave lasting form to authority. Early dynastic rulers belong to a different world from the later New Kingdom and Ptolemaic courts. | [National Museum of Egyptian Civilization: historical timeline](https://nmec.gov.eg/historical-timeline/) |
| Rome | Roman kingship survives through traditions shaped by later Romans. The legendary royal figures here are not interchangeable with emperors of the much later empire. | [British Museum: Romulus and Remus object record](https://www.britishmuseum.org/collection/object/G_1772-0302-134) |
| Greece | The Greek catalog joins legendary founders with rulers from distinct kingdoms. Civic argument, royal patronage and competing centers provide context without making every ruler an Athenian. | [Metropolitan Museum: Hellenistic art and its setting](https://www.metmuseum.org/fr/essays/art-of-the-hellenistic-age-and-the-hellenistic-tradition) |
| Vikings | Scandinavian rulers depended on personal loyalties, gifts and negotiated alliances. Different kingdoms and religious transitions shaped their courts; no invented accent is used. | [National Museum of Denmark: magnates and kings](https://en.natmus.dk/historical-knowledge/denmark/prehistoric-period-until-1050-ad/the-viking-age/power-and-aristocracy/magnates-and-kings/) |
| Inis Fáil | Medieval Irish courts joined lordship with learned poetry, music and hospitality. Supplied clan identities speak through fictional representatives, not invented historical clan monarchs. | [National Museum of Ireland: Medieval Ireland](https://cms.museum.ie/en-IE/Museums/Archaeology/Exhibitions/Medieval-Ireland) |
| Carthage | Carthage belonged to a connected Mediterranean of ports, exchange and rival powers. Its catalog includes legendary and geographically ambiguous identities, whose biographies are not silently rewritten. | [Metropolitan Museum: western North Africa, first millennium BCE](https://82nd-and-fifth.metmuseum.org/toah/ht/04/afw.html) |
| Nubia | Kushite courts developed their own royal traditions around Napata and Meroe while engaging with Egypt. Nubian sovereignty is central; it is not treated as an imitation of Egyptian rule. | [Metropolitan Museum: Kushite rule and the Third Intermediate Period](https://www.metmuseum.org/ko/essays/egypt-in-the-third-intermediate-period-1070-712-b-c) |
| China | The catalog spans traditional Xia rulers and historically distinct later courts. Shang ritual bronzes and ancestral records ground some imagery; they do not establish the historicity of Xia biographies. | [Metropolitan Museum: Shang and Zhou bronze age](https://www.metmuseum.org/es/essays/shang-and-zhou-dynasties-the-bronze-age-of-china) |
| Japan | The early catalog includes rulers known through later traditions alongside figures from other periods and places. Court objects and monumental tombs supply context without importing a later samurai voice. | [Metropolitan Museum: Kofun period](https://www.metmuseum.org/ko/essays/kofun-period-ca-3rd-century-538) |
| India | Magadhan and later Mauryan settings must remain distinct. Ashokan inscriptions are evidence for one later royal program, not a personality template or religion assigned to every ruler. | [British Museum: Ashoka pillar fragment](https://www.britishmuseum.org/collection/object/A_1880-21) |
| Warhorsemen | This faction draws on the Huns of late antiquity, not the later Mongol empire. Mobility, changing alliances and encounters across frontiers provide context without reducing people to warfare. | [British Museum: early medieval Europe gallery guide](https://www.britishmuseum.org/sites/default/files/2021-05/large_print_guide_room_41.pdf) |
| Mayans | Maya royal courts were distinct political centers, with scribes, artists and dated inscriptions. These voices use courtly records and city life without conflating Maya and Mexica traditions. | [Metropolitan Museum: treasures of Maya rulers](https://www.metmuseum.org/exhibitions/listings/2006/maya-treasures) |
| Gaul | Ancient Gaul contained diverse communities and competing leaders. A single timeless Celtic temperament would erase those differences; the faction is kept distinct from medieval Irish traditions. | [British Museum: who were the Celts?](https://www.britishmuseum.org/blog/who-were-celts) |
| Persia | Achaemenid authority connected different peoples through provincial government, routes and court ceremony. Its varied empire supplies context, not a claim that every Persian ruler governed alike. | [Metropolitan Museum: Achaemenid Persian empire](https://www.metmuseum.org/ja/essays/the-achaemenid-persian-empire-550-330-b-c) |
| Mongols | Imperial Mongol relay networks carried information and supported movement and trade. These later institutions are distinct from the Hunnic world represented by Warhorsemen. | [Columbia University: Mongols and the postal relay](https://afe.easia.columbia.edu/mongols/history/history4_a.htm) |
| Korea | Joseon court culture included scholarship, administrative debate and changing artistic patronage. Sejong’s writing reform is one specific history, not an attribute assigned to every Korean ruler. | [Metropolitan Museum: Korean Renaissance, 1400–1600](https://www.metmuseum.org/de/essays/art-of-the-korean-renaissance-1400-1600) |
| Khmer Empire | Angkor’s royal centers were connected to reservoirs, canals and monumental landscapes. The material setting informs images of maintenance and scale without claiming a single unchanging Khmer court. | [UNESCO: Angkor](https://whc.unesco.org/en/list/668) |
| Siam | The Siam catalog crosses several kingdoms and periods. Ayutthaya’s diplomatic and trading connections inform selected imagery, not the biographies of rulers who lived elsewhere or earlier. | [UNESCO: Historic City of Ayutthaya](https://whc.unesco.org/en/list/576) |
| Majapahit | Trowulan’s remains include planned spaces, waterworks and gateways. Javanese court imagery is used on its own terms rather than as an interchangeable extension of another culture. | [UNESCO: Trowulan, former capital of Majapahit](https://whc.unesco.org/fr/listesindicatives/5466/) |
| Aztecs | The faction label is preserved, while imagery draws specifically on Mexica Tenochtitlan: canals, causeways and a complex urban center. This is distinct from the Maya courts. | [Metropolitan Museum: Tenochtitlan](https://www.metmuseum.org/it/essays/tenochtitlan) |
| Inca | Inka roads, relay messengers and khipu records supported administration across varied terrain. Logistics and reciprocal obligations provide context without pretending to recover a ruler’s private thoughts. | [National Museum of the American Indian: road administration](https://americanindian.si.edu/inkaroad/inkauniverse/inkaroadexpansion/road-administration.html) |
| Mali | Medieval Mali joined political authority to regional and trans-Saharan networks of exchange. Gold, salt and learning are context; the characters are not reduced to wealth or a single religious voice. | [Metropolitan Museum: trans-Saharan gold trade](https://www.metmuseum.org/es/essays/the-trans-saharan-gold-trade-7th-14th-century) |
| Aksum | Aksum’s coinage and Red Sea connections carried royal names and changing symbols to different audiences. Religious change is period-specific, not presumed for every ruler in the catalog. | [British Museum: coin of Ezana](https://www.britishmuseum.org/collection/object/C_1921-0316-1) |
| Zulu | Zulu rulers faced changing internal politics and external pressures. Diplomacy, sovereignty and the costs of conflict matter here; no ruler is reduced to the colonial image of a warrior stereotype. | [National Army Museum: the Zulu War](https://www.nam.ac.uk/explore/zulu-war) |
| England | English kingship changed across the catalog’s many centuries. Traveling households, petitions and written administration offer context, without assigning later parliamentary institutions to early kings. | [UK Parliament: Westminster as a center of administration](https://www.parliament.uk/about/living-heritage/building/palace/westminsterhall/government-and-administration/centre-of-admin/) |
| Poland | The Polish catalog includes different dynasties and a ruling queen. Courtly learning, negotiation and layered political ties provide context without turning them into one national personality. | [Adam Mickiewicz Institute: women of medieval Poland](https://culture.pl/en/article/the-extraordinary-expat-women-of-mediaeval-poland) |
| Portugal | Portuguese courts changed from medieval kingdoms to maritime imperial rule. Harbor and patronage imagery does not imply that expansion was peaceful or that inhabited lands awaited discovery. | [UNESCO: Monastery of the Hieronymites and Tower of Belém](https://whc.unesco.org/en/list/263) |

## Campaign memory and simulation boundary

`profileFor(faction, optionalArmy)` is a pure identity lookup. `council({campaign, factionId, viewerFactionId, visibleThroughWeek, allianceVisible})` requires the target to be awakened, and returns a profile, bounded current lines, revealed-event memories, saved pair conversation and allowed reply choices. Omitting the visible week conservatively exposes no results. `reply({...options, intent})` returns fictional text, evidence IDs and a null proposal. Neither function changes the save.

Only structured completed faction totals and resolved conquest outcomes at or before the explicit playback cutoff are read. Arbitrary activity or event narrative is never quoted as a fact. Battle events must belong to the current dynasty cycle. No player edition, hidden year assignment, buried reserve, future game, private favor declaration or outcome prediction is read. Revealed alliance context requires an explicit flag. Saved audience memory is filtered to the viewer/target pair, active ruler, current dynasty cycle and visible cutoff. The history display is capped at eight exchanges, event memory at six and opening lines at three.

Personality traits use 0–1 values. The strategy module may combine them with standings derived from completed results to decide AI offerings. The council can show that same bounded standings reason. It never presents an invented probability. A risk appetite changes a choice, not a game result.

Retries retain one message ID until a save succeeds. Failed saves show an error and do not optimistically insert a reply. Relationship tone is derived from actual retained exchanges rather than trusting an unbounded counter. Recurring disagreement is remembered as disagreement, not treated as a broken pact. A successor does not inherit the former ruler’s personal conversations.

## Contrasting authored voices

- Djoser, patient architect: “Height is the last thing I ask of a foundation.” Wants commitments to support a larger design; fears an unsound beginning.
- Narmer, exacting judge: “Two sides may bow in one room and still hear two different promises.” Wants a binding settlement; fears unity existing only as ceremony.
- Wu Zetian, searching mind: “If custom is your strongest argument, you have brought me a weak one.” Wants ability to be heard beyond comfortable assumptions.
- Cetshwayo, patient negotiator: “You may bring an offer to this council. Do not call a command an offer.” Wants sovereign negotiation; fears an ultimatum disguised as terms.

These sample lines are original game writing, not attributed historical quotations.

## Verification

`node --test tests/duat-personalities.js tests/duat-council-ui.js` covers complete catalog resolution, authored original coverage, immutable stable profiles, identity provenance, hidden-data invariance, actual event evidence, human-controlled silence, pair/ruler/cycle filtering, bounded histories, explicit action payloads, retry ID reuse and no optimistic save. Browser verification is recorded separately with the release evidence.
