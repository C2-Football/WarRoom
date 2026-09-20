#!/usr/bin/env node
'use strict';
// Isolated regression fixtures, never real accounts or hosted room mutations.
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
global.window = globalThis; global.App = {};
for (const name of ['roster','helmet','rules','draft-room','era-rules','types','season','engine','ai','actions','ui','public-state']) require('../js/shared/time-league-'+name+'.js');
const league = App.TimeLeagueEngine.createTimeLeague({name:'Fixture recovery room',seed:'fixture-only',createdAt:'2026-09-20T12:00:00Z',
  seats:[{name:'Fixture Host',manager:'human'},{name:'Fixture Member',manager:'human'}],settings:{rosterSlots:{QB:1},maxQuarterbacks:1,regularSeasonWeeks:13,playoffTeams:2,
  scoring:{passTd:4,reception:.5,rushRecYd:.1,passingYd:.04,turnover:-2},eraRules:{mode:'any-era',decades:[]},tradesEnabled:false}});
league.phase='season'; league.weekStage='ready';
const row={id:'fixture-auth-room',version:4,seatTeamId:'t1',role:'commissioner',draft_started:true,state:App.TimeLeaguePublicState.projectPublicState(league,'t1',[],new Map(),new Date().toISOString())};
const session={token:'fixture-rejected-token',user:{id:'fixture-host',email:'fixture@example.test',displayName:'Fixture Host'}};
(async()=>{
 let browser,server;
 try {
  const url=await new Promise((resolve,reject)=>{
   server=spawn(process.execPath,['scripts/serve-static.cjs','--port=0','--host=127.0.0.1'],{cwd:root,stdio:['ignore','pipe','pipe']});
   server.once('error',reject);server.once('exit',code=>reject(new Error('Preview server exited '+code)));
   server.stdout.on('data',chunk=>{const match=String(chunk).match(/http:\/\/127\.0\.0\.1:\d+/);if(match)resolve(match[0]);});
  });
  console.log('Fixture server ready; launching Chrome');
  browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,timeout:30000});
  const context=await browser.newContext({viewport:{width:320,height:740}});
  await context.addInitScript(({session,rowId})=>{
   if(!localStorage.getItem('fw_session_v1'))localStorage.setItem('fw_session_v1',JSON.stringify(session));
   if(!localStorage.getItem('wr-time-league-ui-v1'))localStorage.setItem('wr-time-league-ui-v1',JSON.stringify({onlineRowId:rowId,tab:'home'}));
  },{session,rowId:row.id});
  let rejectSession=false,loads=0,unauthorized=0,signins=0,mutations=0;
  await context.route('**/*',async route=>{
   const req=route.request(),target=new URL(req.url());
   const json=(status,body)=>route.fulfill({status,contentType:'application/json',headers:{'access-control-allow-origin':'*','access-control-allow-methods':'POST,GET,OPTIONS','access-control-allow-headers':req.headers()['access-control-request-headers']||'authorization,content-type,apikey,x-client-info'},body:JSON.stringify(body)});
   if(target.pathname==='/functions/v1/time-league'){
    if(req.method()==='OPTIONS')return json(200,{});
    const body=req.postDataJSON();
    if(body.op==='load'){
     assert.equal(body.rowId,row.id);loads++;
     if(rejectSession&&req.headers().authorization==='Bearer '+session.token){unauthorized++;return json(401,{ok:false,error:'Sign in to play with friends.'});}
     return json(200,{ok:true,row});
    }
    if(body.op==='list')return json(200,{ok:true,leagues:[]});
    if(body.op==='profile-get')return json(200,{ok:true,profile:null});
    mutations++;return json(403,{ok:false,error:'Fixture has no writes'});
   }
   if(target.pathname==='/functions/v1/fw-signin'){
    if(req.method()==='OPTIONS')return json(200,{});
    signins++;return json(200,{...session,token:'fixture-fresh-token'});
   }
   if(['POST','PUT','PATCH','DELETE'].includes(req.method()))return json(403,{error:'External writes blocked in fixture QA'});
   return route.continue();
  });
  const page=await context.newPage();page.setDefaultTimeout(30000);
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(url+'/dist-preview/?vault=1',{waitUntil:'domcontentloaded'});
  await page.locator('.tl-league-name').filter({hasText:league.name}).waitFor();
  await page.getByRole('status',{name:'Online',exact:true}).waitFor();
  console.log('Fixture authenticated room opened');
  rejectSession=true;
  await page.getByRole('status',{name:'Sign-in required',exact:true}).waitFor();
  const stopped=loads;
  await page.evaluate(()=>{dispatchEvent(new Event('focus'));dispatchEvent(new Event('online'));});
  await new Promise(resolve=>setTimeout(resolve,9500));
  assert.equal(loads,stopped,'401 must stop repeated polls and focus/online retries');
  assert.equal(unauthorized,1);
  assert(!await page.getByText(/Reconnecting automatically/).count());
  const link=page.locator('.tl-week-action-buttons').getByRole('link',{name:'Sign in again',exact:true});
  await link.scrollIntoViewIfNeeded();
  assert(await link.evaluate(el=>{const r=el.getBoundingClientRect();return r.height>=44&&r.x>=0&&r.right<=innerWidth&&el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));}),'320px recovery action must be reachable and44px tall');
  console.log('320px401 recovery is reachable and polling stopped');
  await Promise.all([page.waitForURL('**/login.html?vault=1&reauth=1',{waitUntil:'domcontentloaded'}),link.click()]);
  await page.locator('#identifier').waitFor();
  assert(new URL(page.url()).searchParams.has('reauth'));
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('fw_session_v1')).token),session.token,'Entering recovery must preserve the old account until successful sign-in');
  await page.locator('#identifier').fill('fixture@example.test');await page.locator('#password').fill('fixture-password');
  await page.locator('#btnSignin').click();
  await page.waitForURL('**/index.html?vault=1',{waitUntil:'commit'});
  assert.equal(signins,1);
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('fw_session_v1')).token),'fixture-fresh-token');
  await page.goto(url+'/dist-preview/?vault=1',{waitUntil:'domcontentloaded'});
  await page.locator('.tl-league-name').filter({hasText:league.name}).waitFor();
  await page.getByRole('status',{name:'Online',exact:true}).waitFor();
  assert.equal(mutations,0);assert.deepEqual(errors,[]);
  console.log('PASS Vault401 browser recovery: saved room, stopped retries,320px hit target, explicit real form flow, fresh-credential reopen; isolated fixtures only');
 } finally {if(browser)await browser.close();if(server)server.kill('SIGTERM');}
})().catch(error=>{console.error(error);process.exitCode=1;});
