import { createClient } from 'npm:@supabase/supabase-js@2';
import { verifyJwtPayload, requireActiveAppSession, hasAdminRole } from '../_shared/security.ts';
const headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST,OPTIONS','Content-Type':'application/json'};
const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers});
Deno.serve(async req=>{
 if(req.method==='OPTIONS')return new Response('ok',{headers});
 if(req.method!=='POST')return reply({error:'Method not allowed'},405);
 try {
 const payload=await verifyJwtPayload(req);if(!payload)return reply({error:'Sign in to view the shared Cup.'},401);
 const db=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
 const raw=await req.text();if(raw.length>150000)return reply({error:'Cup is too large.'},413);
 const {leagueId,season,action,state,revision}=JSON.parse(raw);
 if(!/^\d{10,25}$/.test(leagueId)||!/^20\d{2}$/.test(season))return reply({error:'Invalid league or season'},400);
 const metadata=payload.app_metadata||{};let actor='';let siteAdmin=false;let sleeperId='';
 if(metadata.user_id){const session=await requireActiveAppSession(db,req);if(!session)return reply({error:'Sign in again.'},401);actor='app:'+session.userId;siteAdmin=await hasAdminRole(db,session.userId);}
 else if(metadata.sleeper_username){actor='sleeper:'+metadata.sleeper_username;const r=await fetch('https://api.sleeper.app/v1/user/'+encodeURIComponent(metadata.sleeper_username));if(!r.ok)throw Error('Sleeper identity unavailable');sleeperId=String((await r.json()).user_id||'');}
 else return reply({error:'A member sign-in is required.'},401);
 const response=await fetch('https://api.sleeper.app/v1/league/'+leagueId+'/users');if(!response.ok)throw Error('Could not verify league permissions.');const users=await response.json();if(!Array.isArray(users))throw Error('League permissions unavailable.');
 const canManage=siteAdmin||users.some((u:Record<string,unknown>)=>String(u.user_id)===sleeperId&&u.is_owner===true);
 if(action==='load'){const {data,error}=await db.from('league_cups').select('state,revision,updated_at').eq('league_id',leagueId).eq('season',season).maybeSingle();if(error)throw error;return reply({cup:data,canManage});}
 if(action!=='save')return reply({error:'Unknown action'},400);
 if(!canManage)return reply({error:'Only a verified league commissioner or site administrator can edit the Cup.'},403);
 if(!state?.groups||!state.weeks||![0,4].includes(state.drawMargin)||typeof state.locked!=='boolean')return reply({error:'Invalid Cup state'},400);
 const groups=['A','B','C'].map(g=>state.groups[g]);if(groups.some(g=>!Array.isArray(g)||g.length>4))return reply({error:'Invalid groups'},400);
 const ids=groups.flat();if(new Set(ids).size!==ids.length)return reply({error:'Invalid teams'},400);
 if(state.locked&&ids.length!==12)return reply({error:'Twelve teams required'},400);
 const rosterResponse=await fetch('https://api.sleeper.app/v1/league/'+leagueId+'/rosters');if(!rosterResponse.ok)throw Error('Roster verification unavailable');const rosters=await rosterResponse.json();if(ids.some(id=>!rosters.some((r:Record<string,unknown>)=>String(r.roster_id)===id)))return reply({error:'Unknown roster'},400);
 for(const [week,value] of Object.entries(state.weeks)){const w=value as {scores:Record<string,number>;final:boolean};if(![6,7,8,9,10,11,15,16,17].includes(Number(week))||!w.scores||typeof w.final!=='boolean'||Object.values(w.scores).some(x=>typeof x!=='number'||!Number.isFinite(x))||(w.final&&ids.some(id=>!Number.isFinite(w.scores[id]))))return reply({error:'Invalid week scores'},400);}
 const record={league_id:leagueId,season,state,revision:Number(revision)+1,updated_by:actor,updated_at:new Date().toISOString()};
 if(!Number.isInteger(revision)||revision<0)return reply({error:'Invalid revision'},400);
 const query=revision===0?db.from('league_cups').insert(record):db.from('league_cups').update(record).eq('league_id',leagueId).eq('season',season).eq('revision',revision);
 const {data,error}=await query.select('state,revision,updated_at').maybeSingle();if(error?.code==='23505'||(!error&&!data))return reply({error:'The Cup changed in another session. Refresh before editing.'},409);if(error)throw error;return reply({cup:data,canManage:true});
 }catch(e){console.error('league-cup',e);return reply({error:'Cup service unavailable. Your local backup is unchanged.'},503);}
});
