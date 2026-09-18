'use strict';
const assert=require('node:assert/strict'),path=require('node:path'),net=require('node:net');
const {spawn}=require('node:child_process');
const root=path.resolve(__dirname,'..');
const port=()=>new Promise((resolve,reject)=>{const server=net.createServer();server.once('error',reject);server.listen(0,'127.0.0.1',()=>{const chosen=server.address().port;server.close(()=>resolve(chosen));});});
const {chromium}=require('@playwright/test');
const {installReadOnlyRoutes}=require('./helpers/browser-readonly.cjs');
const {createLeagueSkinFixture}=require('./helpers/league-skin-fixture.cjs');
(async()=>{
const serverPort=await port();
const server=spawn(process.execPath,['scripts/serve-static.cjs','--host=127.0.0.1','--port='+serverPort],{cwd:root,stdio:['ignore','pipe','pipe']});
let browser;
try{
await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Preview server did not start')),10000);server.stdout.on('data',chunk=>{if(String(chunk).includes('Serving')){clearTimeout(timer);resolve();}});server.once('exit',()=>{clearTimeout(timer);reject(new Error('Preview server exited'));});});
browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
const context=await browser.newContext({viewport:{width:390,height:844}});
const blocked=await installReadOnlyRoutes(context,{fixture:createLeagueSkinFixture({redraftId:'qa-redraft',dynastyId:'qa-dynasty',user:'readiness-fixture'})});
await context.addInitScript(()=>{if(!localStorage.getItem('fw_session_v1')){
localStorage.setItem('fw_session_v1',JSON.stringify({token:'isolated-browser-fixture',user:{id:'isolated-browser-fixture',email:'qa@example.invalid'}}));
localStorage.setItem('od_auth_v1',JSON.stringify({username:'readiness-fixture'}));
localStorage.setItem('od_profile_v1',JSON.stringify({onboardingComplete:true}));
localStorage.setItem('wr_active_connection_owner_v1','account:isolated-browser-fixture');}
window.__saveFail=false;const original=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){if(window.__saveFail&&key.includes('empire_decisions_v1'))throw new DOMException('Full','QuotaExceededError');return original.call(this,key,value);};});
const page=await context.newPage();
await page.goto('http://127.0.0.1:'+serverPort+'/index.html?dev=true&user=readiness-fixture',{waitUntil:'domcontentloaded'});
await page.locator('.hub-experience-card.empire-hero').click({timeout:60000});
await page.waitForFunction(()=>!!window.App?.EmpireDecisions,{timeout:30000});
await page.evaluate(()=>window.App.EmpireDecisions.track({title:'Readiness save recovery',leagueId:'qa-dynasty',leagueName:'Fixture',type:'sell'}));
await page.getByRole('button',{name:'Back to hub',exact:true}).click();
// A previous league entry is a real same-document back transition that would
// otherwise mount LeagueDetail and destroy the unsaved journal state.
await page.evaluate(()=>{history.pushState({view:'league',leagueId:'qa-dynasty',tab:'dashboard'},'',location.pathname+location.search+'#league=qa-dynasty&tab=dashboard');history.pushState({view:'hub'},'',location.pathname+location.search);});
await page.locator('.hub-experience-card.empire-hero').click({timeout:60000});
await page.getByRole('button',{name:'Actions',exact:true}).click();
await page.getByRole('button',{name:'Decision journal',exact:true}).click();
const note=page.getByRole('textbox',{name:'Decision note for Readiness save recovery',exact:true});
await note.waitFor();await page.evaluate(()=>{window.__saveFail=true;});
await note.fill('Keep this note through a failed save');await note.press('Tab');
await page.getByTestId('empire-decision-save-error').waitFor();
assert.equal(await note.inputValue(),'Keep this note through a failed save');
assert.equal(await page.evaluate(()=>window.App.EmpireDecisions.list()[0].note),'');
await page.getByRole('button',{name:'Back to Empire',exact:true}).click();
await page.getByRole('button',{name:'Back to hub',exact:true}).click();
assert.equal(await note.inputValue(),'Keep this note through a failed save');
const protectedUrl=page.url();
await page.evaluate(()=>history.back());
await page.waitForFunction(()=>history.state?.view==='hub');
assert.equal(page.url(),protectedUrl);
assert.equal(await note.inputValue(),'Keep this note through a failed save');
await page.evaluate(()=>{window.__saveFail=false;});
await page.getByRole('button',{name:'Retry saving decision',exact:true}).click();
await page.getByTestId('empire-decision-save-error').waitFor({state:'hidden'});
assert.equal(await page.evaluate(()=>window.App.EmpireDecisions.list()[0].note),'Keep this note through a failed save');
await page.reload({waitUntil:'domcontentloaded'});
await page.locator('.hub-experience-card.empire-hero').click({timeout:60000});
await page.getByRole('button',{name:'Actions',exact:true}).click();await page.getByRole('button',{name:'Decision journal',exact:true}).click();
assert.equal(await page.getByRole('textbox',{name:'Decision note for Readiness save recovery',exact:true}).inputValue(),'Keep this note through a failed save');

console.log(JSON.stringify({status:'passed',viewport:'390x844',checks:['failed save visible','draft retained','saved record unchanged','hub navigation preserves unsaved draft','browser back preserves draft and URL','retry persists','reload restores'],externalWriteGuard:true,blockedExternalWrites:blocked.length}));
}finally{if(browser)await browser.close();server.kill();}
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
