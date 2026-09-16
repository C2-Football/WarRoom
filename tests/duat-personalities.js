'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const P=require('../js/duat/personalities'),L=require('../js/duat/lore');
function ruler(factionId,name,controller='ai'){
    const item=L.nameLibrary(factionId).rulers.find(r=>r.name===name);assert(item);
    return {id:factionId,name:L.faction(factionId).name,controller,activeArmyId:factionId+':active',armies:[{id:factionId+':active',rulerId:item.id,rulerName:name,rulerOrigin:item.origin,rulerRealm:item.realm,season:1983,players:[]}]};
}
function fixture(){return {phase:'season',week:3,dynastySeason:1,humanFactionIds:['egypt'],factions:[ruler('egypt','Djoser','human'),ruler('rome','Numa Pompilius'),ruler('china','Wu Zetian')],archaeology:{revealedFactionIds:['egypt','rome','china']},completedWeeks:[{week:1,factions:[{factionId:'egypt',total:90},{factionId:'rome',total:110},{factionId:'china',total:105}]},{week:2,factions:[{factionId:'egypt',total:120},{factionId:'rome',total:75},{factionId:'china',total:110}]}],alliances:[{id:'first',name:'The revealed banner',teamIds:['egypt','rome']}],conquest:{events:[]}};}
const options=campaign=>({campaign,factionId:'rome',viewerFactionId:'egypt',visibleThroughWeek:1,allianceVisible:false});
function message(campaign,id,intent='respect',week=1,extra={}){return {id,cycle:1,week,fromFactionId:'egypt',toFactionId:'rome',rulerId:campaign.factions[1].armies[0].rulerId,rulerName:'Numa Pompilius',intent,prompt:'Offer respect',text:'A saved response.',...extra};}

test('every supplied ruler is individually authored; every catalog name and culture has bounded consistent traits and sources',()=>{
    let supplied=0,catalog=0;const signatures=new Set();
    for(const f of L.FACTIONS){assert(P.cultures[f.id]);for(const r of L.nameLibrary(f.id).rulers){
        const profile=P.profileFor({id:f.id}, {rulerId:r.id,rulerName:r.name,rulerOrigin:r.origin,rulerRealm:r.realm});catalog++;
        assert.equal(profile.name,r.name);assert.equal(profile.factionId,f.id);assert(profile.sources.every(s=>s.url.startsWith('https://')));assert(profile.wants&&profile.fears&&profile.temperament&&profile.tells[0]);
        assert.equal(Object.keys(profile.decisionTraits).length,6);assert(Object.values(profile.decisionTraits).every(v=>v>=0&&v<=1));assert(Object.isFrozen(profile));
        if(r.origin.startsWith('supplied')){supplied++;assert(profile.authored,`${f.id}: ${r.name}`);assert(!signatures.has(profile.voice.signature),r.name+' should have an individual signature');signatures.add(profile.voice.signature);}
    }}
    assert.equal(catalog,338);assert.equal(supplied,86);assert.equal(Object.keys(P.cultures).length,28);assert(P.authoredCount>=135);
});
test('historical framing distinguishes traditional, ambiguous, collective, new fiction and custom names',()=>{
    assert.equal(P.profileFor(ruler('rome','Romulus')).identityStatus.kind,'traditional');
    assert.equal(P.profileFor(ruler('india','Ghandi')).identityStatus.kind,'uncertain');
    assert.equal(P.profileFor(ruler('mesopotamia','Naram-Sin')).identityStatus.kind,'uncertain');
    assert.equal(P.profileFor(ruler('inis-fail','Clan Murphy')).identityStatus.kind,'collective');
    assert.equal(P.profileFor(ruler('egypt','Keeper of the Black Stela')).identityStatus.kind,'fictional');
    const custom=P.profileFor({id:'egypt',rulerName:'A name I chose',rulerOrigin:'player-named'});assert.equal(custom.identityStatus.kind,'custom');assert.equal(custom.authored,false);
    const unknown=P.profileFor({id:'imaginary-culture',rulerName:'A custom visitor'});assert.deepEqual(unknown.sources,[]);assert.match(unknown.culturalContext,/No historical culture/);
});
test('individual profile stays stable across save reload, year changes and hidden data changes',()=>{
    const f=ruler('egypt','Djoser'),before=JSON.stringify(f),profile=P.profileFor(f);assert.equal(JSON.stringify(f),before);
    const next=JSON.parse(before);next.armies[0].season=2024;next.armies[0].players=[{id:'secret',hiddenYear:1996}];next.favorBalance=9999;
    assert.deepEqual(P.profileFor(next),profile);assert.notDeepEqual(P.profileFor(ruler('egypt','Narmer')).decisionTraits,profile.decisionTraits);
    const generated={id:'egypt',rulerName:'New title 72',rulerId:'egypt:title:72',rulerOrigin:'new-game-title'};assert.deepEqual(P.profileFor(generated),P.profileFor({...generated}));assert.equal(P.profileFor(generated).identityStatus.kind,'fictional');
});
test('sealed rulers and player-controlled rulers never generate NPC speech',()=>{
    const c=fixture();c.archaeology.revealedFactionIds=['egypt'];const sealed=P.council(options(c));assert.equal(sealed.profile,null);assert.deepEqual(sealed.lines,[]);assert.equal(P.reply({...options(c),intent:'respect'}),null);
    const human=P.council({...options(fixture()),factionId:'egypt'});assert(human.profile);assert.equal(human.humanControlled,true);assert.deepEqual(human.lines,[]);assert.deepEqual(human.choices,[]);assert.equal(P.reply({...options(fixture()),factionId:'egypt',intent:'respect'}),null);
});
test('playback cutoffs do not reveal future results, hidden years, undeclared plans or unpresented alliances',()=>{
    const c=fixture(),before=JSON.stringify(c),view=P.council(options(c));assert(view.memories.some(m=>m.text.includes('110.00')));assert(!JSON.stringify(view).includes('75.00'));assert.equal(view.allied,false);
    const changed=JSON.parse(before);changed.completedWeeks[1].factions[1].total=1000000;changed.hiddenYears={assignments:{secret:'DO NOT LEAK'}};changed.alliances[0].name='DO NOT LEAK';changed.factions[1].declaredFavors=[{favorId:'DO NOT LEAK'}];changed.conquest.events.push({id:'hidden',type:'battle',week:2,factionId:'egypt',defenderId:'rome',captured:true});
    assert.deepEqual(P.council(options(changed)),view);assert.equal(JSON.stringify(c),before);
    const omitted=P.council({campaign:c,factionId:'rome',viewerFactionId:'egypt'});assert.equal(omitted.throughWeek,0);assert.equal(omitted.memories.length,0);
    assert(P.council({...options(c),allianceVisible:true}).allied);
});
test('actual frontier outcomes carry source IDs; arbitrary event prose and unresolved outcomes are never repeated',()=>{
    const c=fixture();c.conquest.events=[{id:'known-battle',type:'battle',week:1,factionId:'egypt',defenderId:'rome',captured:false,narrative:'INVENTED PRIVATE SECRET'},{id:'no-outcome',type:'battle',week:1,factionId:'egypt',defenderId:'rome'}];
    const view=P.council(options(c)),memory=view.memories.find(m=>m.type==='battle');assert.equal(memory.id,'known-battle');assert.match(memory.text,/defender held/);assert.equal(view.lines[1].evidenceId,memory.id);assert(!JSON.stringify(view).includes('INVENTED PRIVATE'));assert.equal(view.memories.filter(m=>m.type==='battle').length,1);
});
test('saved exchanges remember only this pair, ruler, dynasty cycle and visible week',()=>{
    const c=fixture();c.council={messages:[message(c,'first'),message(c,'second'),message(c,'foreign','challenge',1,{fromFactionId:'china',text:'OTHER HUMAN SECRET'}),message(c,'future','challenge',2,{text:'FUTURE SECRET'}),message(c,'old','challenge',1,{cycle:2,text:'OTHER CYCLE SECRET'}),message(c,'predecessor','challenge',1,{rulerId:'old-ruler',text:'DEAD RULER SECRET'})]};
    const view=P.council(options(c));assert.equal(view.conversation.length,2);assert.equal(view.relationship.affinity,2);assert.match(view.lines.at(-1).text,/offered respect/);assert(!JSON.stringify(view).includes('SECRET'));
    const response=P.reply({...options(c),intent:'respect'});assert.match(response.text,/repeated courtesy/);assert.equal(response.proposal,null);assert.equal(P.reply({...options(c),intent:'spend-favor'}),null);
});
test('replies are distinct, bounded, deterministic and never mutate campaign actions',()=>{
    const c=fixture(),before=JSON.stringify(c),opts=options(c);for(const intent of ['respect','counsel','challenge','alliance']){const reply=P.reply({...opts,intent});assert(reply.text.length<=1200);assert.deepEqual(reply,P.reply({...opts,intent}));assert.equal(reply.proposal,null);}
    assert.match(P.reply({...opts,intent:'alliance'}).text,/does not form or change an alliance/);assert.equal(JSON.stringify(c),before);
    const one=P.reply({...opts,intent:'counsel'}),two=P.reply({...opts,factionId:'china',intent:'counsel'});assert.notEqual(one.text,two.text);
});
test('long campaign histories and repeat audiences remain bounded without trusting relationship counters',()=>{
    const c=fixture();c.completedWeeks=Array.from({length:17},(_,i)=>({week:i+1,factions:c.completedWeeks[0].factions}));c.council={relationships:{'egypt:rome':999},messages:Array.from({length:400},(_,i)=>message(c,'m'+i,i%2?'respect':'challenge',i%17))};
    const view=P.council({...options(c),visibleThroughWeek:17});assert(view.memories.length<=6);assert(view.conversation.length<=8);assert(view.lines.length<=3);assert(view.relationship.affinity>=-5&&view.relationship.affinity<=5);
});
