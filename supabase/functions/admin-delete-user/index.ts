/** POST {email,force?}: role-protected support deletion with verified outcomes. */
import {createClient} from 'npm:@supabase/supabase-js@2';
import {auditEvent, handleOptions, hasAdminRole, json, normalizeEmail, requireActiveAppSession, resolveAppUserId} from '../_shared/security.ts';
import {AccountDeletionError, performAccountDeletion} from '../_shared/account-deletion.ts';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const STRIPE_SECRET_KEY = Deno.env.get('STRIPE_SECRET_KEY') || '';
Deno.serve(async req => {
  const options = handleOptions(req); if (options) return options;
  if (req.method !== 'POST') return json(req,{error:'Method not allowed'},405);
  const admin=createClient(SUPABASE_URL,SERVICE_KEY);
  // Capture a validated app version before any await can observe a reset.
  // Confirmed OAuth administrators retain the established compatibility path.
  const appSession=await requireActiveAppSession(admin,req);
  const session=appSession || await resolveAppUserId(admin,req);
  if (!session || !await hasAdminRole(admin,session.userId)) return json(req,{error:'Unauthorized'},401);
  try {
    const body=await req.json().catch(()=>null);
    const email=normalizeEmail(body?.email);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json(req,{error:'A valid email is required'},400);
    const {data:actor,error}=await admin.from('app_users').select('id,email,session_version').eq('id',session.userId).maybeSingle();
    if (error) return json(req,{error:'Account authorization is temporarily unavailable. Try again.'},503);
    if (!actor || (appSession && actor.session_version!==appSession.sessionVersion)) return json(req,{error:'Your session changed. Sign in again.'},401);
    const version=appSession?.sessionVersion || actor.session_version;
    const result=await performAccountDeletion({admin,actorId:actor.id,actorVersion:version,email,self:false,force:body?.force===true,stripeSecret:STRIPE_SECRET_KEY,
      revalidate:async()=>{
        const fresh=appSession ? await requireActiveAppSession(admin,req) : await resolveAppUserId(admin,req);
        return fresh?.userId===actor.id && (!appSession || (fresh as any).sessionVersion===version);
      },
    });
    await auditEvent(admin,req,'admin_delete_user','success',{userId:actor.id},{targetEmail:email,deletedAppUser:result.deletedAppUser,deletedAuthUsers:result.deletedAuthUsers,canceledStripeSubscriptions:result.canceledStripeSubscriptions,managedSubscriptions:result.managedSubscriptions});
    return json(req,result);
  } catch(error) {
    const failure=error instanceof AccountDeletionError ? error : new AccountDeletionError('Deletion was not confirmed. Try again.');
    await auditEvent(admin,req,'admin_delete_user','error',{userId:session.userId},{reason:failure.message,...failure.details});
    return json(req,{error:failure.message,...failure.details},failure.status);
  }
});
