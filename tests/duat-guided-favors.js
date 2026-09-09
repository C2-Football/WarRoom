'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {fixture,recruits,harness,nodes,text}=require('./helpers/duat-favor-harness.cjs');
test('guided favors retain the complete browsable pantheon while unavailable variants explain their timing',async()=>{
    const page=harness({campaign:fixture(),guided:true,eligibleIds:['summon-mahdi']});assert.equal(nodes(page.draw()).filter(n=>n.props.className?.includes('duat-divinity-card')).length,12);assert(!page.dialog());
    page.open('Mahdi');assert.match(text(page.dialog()),/Summon the Mahdi/);assert.match(text(page.dialog()),/The Mahdi II/);assert(!page.button('Invoke Mahdi').props.disabled);await page.click('Invoke Mahdi');assert.equal(page.actions[0].ritualId,'summon-mahdi');
    page.click('The Mahdi II');assert(page.button('Invoke Mahdi').props.disabled);assert.match(text(page.dialog()),/sacred weeks/);assert(!text(page.draw()).includes('The ledger of offerings'));
});
test('pending recruit opens directly with legal release choices and preserves the draw when closed',async()=>{
    const c=fixture();c.factions[0].rituals.pendingMahdi={ritualId:'summon-mahdi',player:recruits()[0],position:'WR',season:2025,poolIds:['new'],roll:8,rerolls:0};
    const page=harness({campaign:c,guided:true});assert.match(text(page.dialog()),/New Recruit/);assert(page.button('Accept recruit').props.disabled);
    page.click('Close favor details');assert(!page.dialog());assert.equal(page.actions.length,0);page.click('Return to Mahdi');
    let select=nodes(page.dialog()).find(n=>n.type==='select');assert(!nodes(select).some(n=>n.type==='option'&&n.props.value==='p0'));select.props.onChange({target:{value:'p1'}});assert(page.button('Accept recruit').props.disabled);
    nodes(page.dialog()).find(n=>n.type==='input'&&n.props.type==='checkbox').props.onChange({target:{checked:true}});await page.click('Accept recruit');assert.equal(page.actions[0].ritualId,'mahdi-accept');assert.equal(page.actions[0].replacementId,'p1');assert(page.actions[0].confirmed);
});
test('sacred-week treasury dims higher tiers and wagers without hiding their rules',async()=>{
    const c=fixture();c.week=5;c.factions[0].favorBalance=20;const page=harness({campaign:c,guided:true});page.open('Kratos');assert.match(text(page.dialog()),/Kratos’ Wrath III/);page.click('Kratos’ Wrath III');assert(page.button('Reserve favor').props.disabled);
    page.click('Kratos’ Wrath I');await page.click('Reserve favor');assert.equal(page.actions[0].playerId,'p0');assert.equal(page.actions[0].favorId,'kratos-1');page.open('Ebisu');const wagers=nodes(page.dialog()).filter(n=>n.type==='button'&&text(n).includes('win chance'));assert.equal(wagers.length,5);assert.equal(wagers.filter(n=>!n.props.disabled).length,1);
});
