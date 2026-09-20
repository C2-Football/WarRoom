'use strict';
const assert=require('node:assert/strict');
const {chromium}=require('@playwright/test');
const {spawn}=require('node:child_process');
const path=require('node:path');
const {installReadOnlyRoutes}=require('./helpers/browser-readonly.cjs');
const {createLeagueSkinFixture}=require('./helpers/league-skin-fixture.cjs');
(async()=>{
 let browser,server;
 try{
  const origin=await new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>reject(Error('Preview server did not start')),10000);
   server=spawn(process.execPath,['scripts/serve-static.cjs','--host=127.0.0.1','--port=0'],{cwd:path.resolve(__dirname,'..'),stdio:['ignore','pipe','pipe']});
   server.once('error',error=>{clearTimeout(timer);reject(error);});
   server.once('exit',code=>{clearTimeout(timer);reject(Error('Preview exited '+code));});
   server.stdout.on('data',chunk=>{const match=String(chunk).match(/http:\/\/127\.0\.0\.1:\d+/);if(match){clearTimeout(timer);resolve(match[0]);}});
  });
  const base=origin+'/dist-preview/';
  browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
  for(const viewport of [{width:320,height:740},{width:390,height:844},{width:844,height:390}]){
   const context=await browser.newContext({viewport});
   const blocked=await installReadOnlyRoutes(context,{fixture:createLeagueSkinFixture({redraftId:'qa-redraft',dynastyId:'qa-dynasty',user:'readiness-fixture'})});
   let calls=0,response='wrong',held;
   await context.route('**/functions/v1/fw-change-password',async route=>{
    if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*','Access-Control-Allow-Methods':'POST, OPTIONS'}});
    calls++;assert.equal(route.request().method(),'POST');assert.deepEqual(route.request().postDataJSON(),{currentPassword:'CurrentPassword1!',password:'NewPassword2!'});
    if(response==='hold')await new Promise(r=>held=r);
    const success=response==='success';await route.fulfill({status:success?200:400,contentType:'application/json',headers:{'Access-Control-Allow-Origin':'*'},body:JSON.stringify(success?{ok:true,signInRequired:true}:{error:'Current password is incorrect.'})});
   });
   await context.addInitScript(()=>{if(!sessionStorage.getItem('seeded')){
    localStorage.setItem('fw_session_v1',JSON.stringify({token:'isolated-password-fixture',user:{id:'isolated-password-fixture',email:'qa@example.invalid'}}));
    localStorage.setItem('od_auth_v1',JSON.stringify({username:'readiness-fixture'}));
    localStorage.setItem('od_profile_v1',JSON.stringify({onboardingComplete:true}));
    localStorage.setItem('wr_active_connection_owner_v1','account:isolated-password-fixture');
    localStorage.setItem('duat-offline-password-fixture','keep');sessionStorage.setItem('seeded','1');}});
   const page=await context.newPage();await page.goto(base+'index.html?dev=true&user=readiness-fixture',{waitUntil:'domcontentloaded'});
   await page.getByRole('button',{name:'Account & settings',exact:true}).first().click({timeout:60000});
   await page.getByRole('button',{name:'Change password',exact:true}).click();
   await page.getByLabel('Current password',{exact:true}).fill('CurrentPassword1!');
   await page.getByLabel('New password',{exact:true}).fill('NewPassword2!');
   await page.getByLabel('Confirm new password',{exact:true}).fill('NewPassword2!');
   const update=page.getByRole('button',{name:'Update password',exact:true});await update.click();
   await page.getByRole('status').filter({hasText:'Current password is incorrect.'}).waitFor();
   assert.equal(calls,1);assert.equal(await page.getByLabel('New password',{exact:true}).inputValue(),'NewPassword2!');
   response='hold';await update.click();await page.getByRole('button',{name:'Updating…',exact:true}).waitFor();
   assert(await page.getByRole('button',{name:'Updating…',exact:true}).isDisabled());assert.equal(calls,2);
   response='success';held();await page.waitForURL(/login\.html\?password=changed/,{timeout:20000});
   assert.equal(await page.evaluate(()=>localStorage.getItem('fw_session_v1')),null);
   assert.equal(await page.evaluate(()=>localStorage.getItem('duat-offline-password-fixture')),'keep');
   await page.waitForLoadState('domcontentloaded');
   await page.getByText('Password changed. Sign in with your new password.',{exact:true}).waitFor();
   assert(!(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)));
   await page.screenshot({path:'reports/public-readiness/evidence/password-changed-'+viewport.width+'.png'});
   console.log(JSON.stringify({viewport,calls,checks:['real hub account entry','actual password inputs','wrong-password retains fields','retry disabled while pending','acknowledged change signs out','offline save retained','login success guidance'],externalMutationGuard:true,blockedOtherWrites:blocked.length}));
   await context.close();
  }
 }finally{if(browser)await browser.close();if(server)server.kill('SIGTERM');}
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
