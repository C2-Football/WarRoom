'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {fixture,recruits,harness,nodes,text}=require('./helpers/duat-favor-harness.cjs');
const event=(key,target={closest:()=>null},extra={})=>({key,target,preventDefault(){this.prevented=true;},...extra});
function sacred(){const c=fixture();c.week=5;return c;}

test('opening is presentation-only, traps keyboard focus, locks the background and restores the invoking card on Escape',()=>{
    const page=harness({campaign:sacred()}),opener=nodes(page.draw()).find(n=>n.props['aria-label']?.startsWith('Kratos ·'));page.open('Kratos');let d=page.dialog();assert.equal(d.props['aria-modal'],'true');assert.equal(d.props['aria-labelledby'],'duat-favor-title');assert(page.background.inert);assert.equal(page.document.body.style.overflow,'hidden');assert.equal(page.document.documentElement.style.overflow,'hidden');
    const focusables=d.dom.querySelectorAll(),first=focusables[0],last=focusables.at(-1);assert.equal(page.document.activeElement,first);const back=event('Tab',undefined,{shiftKey:true});d.props.onKeyDown(back);assert(back.prevented);assert.equal(page.document.activeElement,last);const forward=event('Tab');d.props.onKeyDown(forward);assert(forward.prevented);assert.equal(page.document.activeElement,first);
    d.props.onKeyDown(event('Escape'));assert(!page.dialog());assert.equal(page.document.activeElement,opener.dom);assert(!page.background.inert);assert.equal(page.document.body.style.overflow,'auto');assert.equal(page.document.documentElement.style.overflow,'scroll');assert.equal(page.actions.length,0);
});

test('arrows and deliberate horizontal swipes browse gods without invoking, while vertical scroll, cancellation and input gestures are ignored',()=>{
    const page=harness({campaign:sacred()});page.open('Kratos');const title=()=>text(nodes(page.dialog()).find(n=>n.props.id==='duat-favor-title'));
    const before=title();page.click('Next god');assert.notEqual(title(),before);page.click('Previous god');assert.equal(title(),before);
    const p=(x,y,id=1,interactive=false)=>({pointerId:id,clientX:x,clientY:y,target:{closest:()=>interactive?{}:null}});
    let d=page.dialog();d.props.onPointerDown(p(100,100));d.props.onPointerUp(p(20,105));assert.notEqual(title(),before);page.click('Previous god');
    for(const kind of ['vertical','small','cancelled','interactive','wrong-pointer']){d=page.dialog();d.props.onPointerDown(p(100,100,1,kind==='interactive'));if(kind==='cancelled')d.props.onPointerCancel();d.props.onPointerUp(p(kind==='small'?80:20,kind==='vertical'?250:105,kind==='wrong-pointer'?2:1));assert.equal(title(),before,kind+' must not browse');}
    const inputArrow=event('ArrowRight',{closest:()=>({})});page.dialog().props.onKeyDown(inputArrow);assert.equal(title(),before);assert(!inputArrow.prevented);
    page.dialog().props.onKeyDown(event('ArrowRight'));assert.notEqual(title(),before);assert.equal(page.actions.length,0);
});

test('closing and reopening preserves selected tier and player while changing the god clears permanent confirmations',()=>{
    const page=harness({campaign:sacred()});page.open('Kratos');page.click('Kratos’ Wrath II');let select=nodes(page.dialog()).find(n=>n.type==='select');select.props.onChange({target:{value:'p1'}});page.click('Close favor details');page.open('Kratos');assert.match(text(nodes(page.dialog()).find(n=>n.props.id==='duat-favor-title')),/Wrath II/);assert.equal(nodes(page.dialog()).find(n=>n.type==='select').props.value,'p1');
    page.open('Midas');let checkbox=nodes(page.dialog()).find(n=>n.type==='input');checkbox.props.onChange({target:{checked:true}});assert(!page.button('Invoke Midas').props.disabled);page.click('Next god');page.click('Previous god');assert(page.button('Invoke Midas').props.disabled);assert.equal(page.actions.length,0);
});

test('a failed shared save stays in the dialog, preserves selections, shows the actual error and rejects duplicate submission',async()=>{
    let resolveRequest;const actions=[];const page=harness({campaign:sacred(),onAction:action=>{actions.push(action);return new Promise(resolve=>{resolveRequest=resolve;});}});page.open('Kratos');nodes(page.dialog()).find(n=>n.type==='select').props.onChange({target:{value:'p1'}});
    const invoke=page.button('Reserve favor').props.onClick,promise=invoke();invoke();assert.equal(actions.length,1);assert(page.button('Recording your offering').props.disabled);page.update({actionError:'Your room changed. Reload before making this offering.'});resolveRequest(false);await promise;assert(page.dialog());assert.match(text(page.dialog()),/Your room changed/);assert.equal(nodes(page.dialog()).find(n=>n.type==='select').props.value,'p1');assert(!page.button('Reserve favor').props.disabled);
    page.click('Next god');assert(!text(page.dialog()).includes('Your room changed'),'A rejected action must not become an unrelated god’s message');
});

test('ready, read-only and unsaved-lineup controllers can explore but cannot submit or clear reservations',()=>{
    for(const flag of ['ready','readOnly','dirty','busy']){const c=sacred();c.factions[0].declaredFavors=[{favorId:'kratos-1',playerId:'p0',cost:10}];const page=harness({campaign:c,[flag]:true});page.open('Kratos');assert(page.dialog());assert(page.button('Replace reserved favor').props.disabled);assert(page.button('Remove').props.disabled);page.click('Next god');assert.equal(page.actions.length,0);}
});

test('legacy campaigns browse only their three gods and retain exact single-favor action payloads',async()=>{
    for(const version of [1,2,3]){const c=sacred();c.version=version;delete c.expansionVersion;c.factions[0].favorBalance=20;c.factions[0].declaredFavor={favorId:'kratos-2',playerId:'p0',cost:20};const page=harness({campaign:c});assert.equal(nodes(page.draw()).filter(n=>n.props.className?.includes('duat-divinity-card')).length,3);page.open('Kratos');page.click('Kratos’ Wrath II');nodes(page.dialog()).find(n=>n.type==='select').props.onChange({target:{value:'p1'}});await page.click('Replace reserved favor');assert.deepEqual(JSON.parse(JSON.stringify(page.actions[0])),{type:'declare-favor',favorId:'kratos-2',playerId:'p1'});page.click('Close favor details');await page.click('Remove');assert.deepEqual(JSON.parse(JSON.stringify(page.actions[1])),{type:'clear-favor'});}
});

test('pending Mahdi preserves its exact recruit through browsing and exposes clear declarations without accepting or redrawing',async()=>{
    const c=sacred();c.factions[0].declaredFavors=[{favorId:'kratos-1',playerId:'p0',cost:10}];c.factions[0].rituals.pendingMahdi={ritualId:'mahdi',player:recruits()[0],position:'WR',season:2025,poolIds:['new'],roll:8,rerolls:0};const page=harness({campaign:c});assert.match(text(page.dialog()),/New Recruit/);assert(page.button('Accept recruit').props.disabled);assert.match(text(page.dialog()),/Clear starter favors/);await page.click('Remove Kratos');assert.equal(page.actions[0].type,'clear-favor');assert.equal(page.actions[0].playerId,'p0');page.click('Next god');page.click('Close favor details');page.click('Return to Mahdi');assert.match(text(page.dialog()),/New Recruit/);assert.equal(page.actions.length,1);
});

test('waiting Mahdi and Super Mahdi keep their exact tier and consequences through swipe and reopen',()=>{
    for(const ritualId of ['mahdi','super-mahdi']){
    const c=sacred();c.factions[0].rituals.pendingMahdi={ritualId,player:recruits()[0],position:'WR',season:2025,poolIds:['new'],roll:8,rerolls:0};const page=harness({campaign:c});
    function check(){const d=page.dialog();assert.match(text(nodes(d).find(n=>n.props.id==='duat-favor-title')),ritualId==='super-mahdi'?/The Super Mahdi/:/The Mahdi II/);assert.match(text(d),ritualId==='super-mahdi'?/One random player is lost from a buried army/:/One reroll costs 20 favor/);assert.match(text(d),/New Recruit/);assert(page.button('Accept recruit').props.disabled);assert(!nodes(d).some(n=>n.type==='button'&&/Summon the Mahdi|The Mahdi II/.test(text(n))));assert.equal(page.actions.length,0);}
    check();page.click('Next god');page.click('Previous god');check();page.click('Next god');page.click('Close favor details');page.click('Return to Mahdi');check();page.click('Close favor details');page.open('Mahdi');check();
    }
});
