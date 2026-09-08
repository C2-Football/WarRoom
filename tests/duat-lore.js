'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Lore = require('../js/duat/lore.js');
const World = require('../js/duat/world.js');

test('all 28 factions have distinct identity catalogs and the fourteen supplied crests are actual 256px PNG assets', () => {
    assert.deepEqual(Lore.FACTIONS.map(f=>f.id).sort(),World.FACTIONS.map(f=>f.id).sort());
    assert.equal(new Set(Lore.FACTIONS.map(f=>f.id)).size,28);
    assert.equal(Object.keys(Lore.CRESTS).length,14);
    for (const faction of Lore.FACTIONS) {
        const selected=Lore.chooseRuler({factionId:faction.id});
        assert.ok(selected.name && selected.id && selected.origin);
        if (faction.origin==='original-faction') assert.ok(faction.source && faction.rulers.length);
        if (faction.crest) {
            const png=fs.readFileSync(path.join(__dirname,'..',faction.crest));
            assert.equal(png.subarray(1,4).toString(),'PNG');
            assert.equal(png.readUInt32BE(16),256);assert.equal(png.readUInt32BE(20),256);
        }
        for (const ruler of faction.rulers) assert.ok(ruler.source?.file && (ruler.source.cell || ruler.source.chapter));
    }
    assert.equal(Lore.faction('not-a-faction'),null);
    assert.throws(()=>Lore.chooseRuler({factionId:'not-a-faction'}),{code:'UNKNOWN_FACTION'});
});

test('source catalog and runtime data agree and contain no private filesystem paths or applicant data', () => {
    const catalog=JSON.parse(fs.readFileSync(path.join(__dirname,'../data/duat/lore-catalog.json'),'utf8'));
    assert.deepEqual(catalog.factions,Lore.FACTIONS);
    assert.deepEqual(catalog.originalHistory,Lore.ORIGINAL_HISTORY);
    assert.doesNotMatch(JSON.stringify(catalog),/\/Users\/|@|Form Responses|Email Address/);
    assert.equal(Object.isFrozen(Lore.FACTIONS[0].rulers[0].source),true);
});

test('retired rulers and occupied names remain unavailable across many dynasty cycles', () => {
    const factionId='japan', retired=[];
    for (let cycle=1;cycle<=50;cycle++) {
        const selected=Lore.chooseRuler({factionId,ordinal:cycle,retiredNames:retired});
        assert.equal(retired.some(item=>item.rulerName===selected.name),false);
        retired.push({factionId,rulerName:selected.name,rulerId:selected.id,retiredCycle:cycle});
    }
    assert.equal(new Set(retired.map(item=>item.rulerName)).size,50);
    assert.match(retired.at(-1).rulerName,/Ruler of Japan/);
    const first=Lore.chooseRuler({factionId:'rome'});
    assert.notEqual(Lore.chooseRuler({factionId:'rome',retiredRulerIds:[first.id]}).id,first.id);
    assert.notEqual(Lore.chooseRuler({factionId:'rome',usedNames:[`  ${first.name.toUpperCase()}  `]}).name,first.name);
});

test('player names are plain text, unique within a dynasty, and cannot reuse a retired identity', () => {
    assert.equal(Lore.chooseRuler({factionId:'mali',customName:'  Keeper   of the Reed  '}).name,'Keeper of the Reed');
    assert.throws(()=>Lore.chooseRuler({factionId:'mali',customName:'Keeper',retiredNames:[{factionId:'mali',rulerName:'keeper'}]}),{code:'RULER_RETIRED_OR_USED'});
    assert.equal(Lore.chooseRuler({factionId:'mali',customName:'Keeper',retiredNames:[{factionId:'japan',rulerName:'Keeper'}]}).name,'Keeper');
    for (const name of ['', 'A', 'x'.repeat(65),'<b>King</b>','King\nName']) assert.throws(()=>Lore.validateName(name),{code:'INVALID_RULER_NAME'});
});

test('naming armies preserves custom identities and destroyed tombs without mutating campaign input', () => {
    const faction={id:'inis-fail',armies:[
        {id:'a',season:2024,rulerName:'2024 Ruler',players:[]},
        {id:'b',season:2023,rulerName:'My Returning Clan',players:[]},
        {id:'c',season:2022,rulerName:'A Fallen Ruler',destroyed:true,players:[]},
        {id:'d',season:2021,rulerName:'2021 Ruler',players:[]},
        {id:'e',season:2020,rulerName:'2020 Ruler',players:[]}
    ]};
    const before=structuredClone(faction);
    const named=Lore.nameArmies(faction,{retiredNames:[{factionId:'inis-fail',rulerName:'Clan Murphy'}]});
    assert.deepEqual(faction,before);
    assert.equal(named[1].rulerName,'My Returning Clan');assert.equal(named[2].rulerName,'A Fallen Ruler');
    assert.equal(named.some(army=>army.rulerName==='Clan Murphy'),false);
    assert.equal(new Set(named.map(army=>army.rulerName)).size,named.length);
    named[0].players.push({name:'Different'});assert.equal(faction.armies[0].players.length,0);
});

test('distinct source cultures remain distinct when applying names and expedition motifs', () => {
    assert.equal(Lore.CHAPTERS.length,15);
    assert.equal(Lore.CHAPTERS.find(ch=>ch.sourceFaction==='Mixtec').gameFactionId,null);
    assert.equal(Lore.CHAPTERS.find(ch=>ch.chapter===15).gameFactionId,null);
    assert.equal(Lore.faction('mayans').rulers.some(r=>/Four Deer|Harvester Mountain/.test(r.name)),false);
    assert.equal(Lore.faction('inis-fail').rulers.some(r=>r.name==='Fergus Mor'),false);
    assert.equal(Lore.expedition({factionId:'inis-fail'}).origin,'new-expedition');
    assert.equal(Lore.expedition({factionId:'mayans'}).source,null);
    assert.equal(Lore.expedition({factionId:'mongols'}).origin,'new-expedition');
    assert.equal(Lore.expedition({factionId:'warhorsemen'}).source.sourceFaction,'The Huns');
    assert.equal(Lore.expedition({factionId:'mali'}).source.chapter,3);
    assert.equal(Lore.chooseRuler({factionId:'mali'}).name,'Sundiata Keita');
    assert.equal(Lore.chooseRuler({factionId:'persia'}).origin,'new-game-title');
});

test('discovery stages disclose no hidden ruler, count, year or player data', () => {
    for (const faction of Lore.FACTIONS) {
        const before=Lore.expedition({factionId:faction.id});
        const hidden=Lore.expedition({factionId:faction.id,rulerName:'SECRET RULER',playerCount:59,season:2099,futurePoints:9000,players:['SECRET PLAYER']});
        assert.deepEqual(hidden,before);
        assert.doesNotMatch(JSON.stringify(before),/SECRET|2099|9000/);
        const shown=Lore.expedition({factionId:faction.id,stage:'ruler',rulerName:'The Returning Captain',playerCount:13,season:2020});
        assert.match(shown.text,/The Returning Captain/);assert.match(shown.text,/13/);
        assert.equal(shown.scoringSeason,2020);
    }
    assert.throws(()=>Lore.expedition({factionId:'japan',stage:'ruler'}),{code:'INVALID_RULER_NAME'});
    assert.throws(()=>Lore.expedition({factionId:'japan',stage:'ruler',rulerName:'Itoku',playerCount:0}),{code:'INVALID_REVEAL_ROSTER'});
});

test('journal entries are deterministic, persist all reveal stages and distinguish original adaptation from new writing', () => {
    const input={factionId:'japan',rulerId:'japan:1',rulerName:'Itoku',playerCount:11,season:2019,cycle:3,createdAt:'2026-09-08T12:00:00Z'};
    const entry=Lore.journalEntry(input);
    assert.deepEqual(entry,Lore.journalEntry(input));
    assert.equal(entry.paragraphs.length,4);assert.equal(entry.cycle,3);assert.equal(entry.scoringSeason,2019);
    assert.equal(entry.origin,'adapted-original');assert.match(entry.paragraphs.at(-1),/T\.A\./);
    assert(entry.paragraphs[0].startsWith(Lore.journey({factionId:'japan'}).paragraphs[0]),'New journal records retain the full first-person arrival');
    assert.equal(Lore.journalEntry({...input,factionId:'portugal'}).origin,'new-expedition');
    assert.throws(()=>Lore.journalEntry({...input,createdAt:'bad'}),{code:'INVALID_JOURNAL'});
});

test('all cultures have distinct illustrated first-person journeys with an explicit pre-reveal boundary',()=>{
    const paths=new Set(),arrivals=new Set();
    for(const faction of Lore.FACTIONS){
        const scene=Lore.journey({factionId:faction.id});paths.add(scene.image);arrivals.add(scene.paragraphs[0]);
        assert.equal(scene.image,`images/duat/expeditions/${faction.id}.webp`);assert(scene.alt.length>50);
        assert(scene.paragraphs.every(p=>p.length>50));assert.match(scene.paragraphs[0],/\bI\b/);
        assert.deepEqual(Lore.journey({factionId:faction.id,rulerName:'SECRET RULER',playerCount:59,season:2099}),scene);
        const known=Lore.journey({factionId:faction.id,awakened:true,rulerName:'The Returned Captain',playerCount:8,season:2024});
        assert(known.paragraphs[0].includes('The Returned Captain'));assert(known.paragraphs[0].includes('8'));assert.equal(known.scoringSeason,2024);
        assert.equal(known.image,scene.image);assert.equal(known.origin,scene.origin);
    }
    assert.equal(paths.size,28);assert.equal(arrivals.size,28);
    assert.throws(()=>Lore.journey({factionId:'egypt',awakened:true}),{code:'INVALID_RULER_NAME'});
});

function season(cycle,championId='japan') {
    const final={round:'championship',week:17,homeId:'japan',awayId:'rome',winnerId:championId};
    return {cycle,championId,thirdPlaceId:'egypt',standings:[{factionId:'japan',wins:100.5,losses:81.5,ties:1}],
        rulers:[],alliances:[{id:'h1',teamIds:['japan','egypt']}],heptad:{championId:'h1'},
        completedWeeks:[{week:17,heavenly:{matches:[final]},factions:[
            {factionId:'japan',season:2024,players:[
                {id:`allen:${cycle}`,identity:'josh-allen',name:'Josh Allen',position:'QB',starter:true,basePoints:20+cycle,effectivePoints:1000},
                {id:'bench',identity:'bench',name:'Bench Champion',position:'RB',starter:false,basePoints:200,effectivePoints:200}
            ]},
            {factionId:'rome',season:2023,players:[{id:'rival',identity:'rival',name:'Final Rival',position:'WR',starter:true,basePoints:30-cycle,effectivePoints:30-cycle}]},
            {factionId:'egypt',season:2022,players:[{id:'third',identity:'third',name:'Third Place Scorer',position:'WR',starter:true,basePoints:900,effectivePoints:900}]}
        ]}]};
}
test('campaign honors use actual finalists and base points, deduplicate athlete identities and require distinct winning seasons', () => {
    const first=season(1),second=season(2),before=structuredClone([first,second]);
    const result=Lore.honors([first,first,second]);
    assert.deepEqual([first,second],before);
    assert.deepEqual(result.chosenFive.map(p=>p.name),['Final Rival','Josh Allen']);
    assert.equal(result.chosenFive.find(p=>p.name==='Josh Allen').points,22);
    assert.equal(result.chosenFive.find(p=>p.name==='Final Rival').points,29);
    assert.equal(result.allTimeTeam.find(p=>p.name==='Josh Allen').titles.length,2);
    assert.equal(result.allTimeTeam.find(p=>p.name==='Bench Champion').titles.length,2);
    assert.equal(result.allTimeTeam.some(p=>p.name==='Final Rival'),false);
    assert.equal(result.chosenFive.some(p=>/Bench|Third/.test(p.name)),false);
});
test('honors retain a transferred athlete’s actual NFL scoring year',()=>{
    const first=season(1),second=season(2);first.completedWeeks[0].factions[0].players[0].season=2012;second.completedWeeks[0].factions[0].players[0].season=2015;
    const result=Lore.honors([first,second]);assert.equal(result.chosenFive.find(p=>p.name==='Josh Allen').scoringSeason,2015);
    assert.deepEqual(result.allTimeTeam.find(p=>p.name==='Josh Allen').titles.map(t=>t.scoringSeason),[2012,2015]);
});

test('missing championship data cannot create honors and real zero scores remain valid', () => {
    assert.deepEqual(Lore.honors([null,{cycle:1,championId:'japan',completedWeeks:[]}]),{chosenFive:[],allTimeTeam:[]});
    const s=season(1);s.completedWeeks[0].factions[0].players[0].basePoints=0;
    assert.equal(Lore.honors([s]).chosenFive.find(p=>p.name==='Josh Allen').points,0);
});

test('dynasty summaries preserve accumulated records and show only that faction’s private tomb history and journal', () => {
    const campaign={dynasty:{cycle:3,seasons:[season(1),season(2)],retiredRulers:[{factionId:'japan',rulerName:'Itoku'},{factionId:'rome',rulerName:'Romulus'}],journal:[{id:'j',factionId:'japan'},{id:'r',factionId:'rome'}]}};
    const summary=Lore.dynastySummary(campaign,'japan');
    assert.equal(summary.record.titles,2);assert.equal(summary.record.heptadTitles,2);
    assert.equal(summary.record.wins,201);assert.equal(summary.record.losses,163);assert.equal(summary.record.ties,2);
    assert.deepEqual(summary.retired.map(r=>r.rulerName),['Itoku']);assert.deepEqual(summary.journal.map(j=>j.id),['j']);
    assert.equal(Lore.ORIGINAL_HISTORY.finals[0].year,2021);
    assert.equal(Lore.dynastySummary({dynasty:{}},'japan').record.titles,0,'Original archive wins never become campaign awards');
});

test('lore publishes a dependency-free browser UMD API with deterministic parity', () => {
    const context={window:{App:{preserved:true}}};
    vm.runInNewContext(fs.readFileSync(require.resolve('../js/duat/lore.js'),'utf8'),context);
    const browser=context.window.App.DuatLore;
    assert.equal(context.window.App.preserved,true);assert.equal(browser.FACTIONS.length,28);
    assert.deepEqual(JSON.parse(JSON.stringify(browser.chooseRuler({factionId:'japan'}))),Lore.chooseRuler({factionId:'japan'}));
    assert.equal(browser.expedition({factionId:'mali'}).text,Lore.expedition({factionId:'mali'}).text);
});
