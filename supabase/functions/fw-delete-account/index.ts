/** POST {confirm:true}: verified, user-initiated account deletion. */
import {createClient} from 'npm:@supabase/supabase-js@2';
import {auditEvent, handleOptions, json, requireActiveAppSession} from '../_shared/security.ts';
import {AccountDeletionError, performAccountDeletion} from '../_shared/account-deletion.ts';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const STRIPE_SECRET_KEY = Deno.env.get('STRIPE_SECRET_KEY') || '';
Deno.serve(async req => {
  const options = handleOptions(req); if (options) return options;
  if (req.method !== 'POST') return json(req, {error:'Method not allowed'}, 405);
  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const session = await requireActiveAppSession(admin, req);
  if (!session) return json(req, {error:'Unauthorized'}, 401);
  const body = await req.json().catch(() => null);
  if (body?.confirm !== true) return json(req, {error:'Deletion not confirmed'}, 400);
  try {
    // JWT email can be older than the current profile. Always use the verified
    // app row's email and reject a session-version change after validation.
    const {data: actor,error} = await admin.from('app_users').select('id,email,session_version').eq('id',session.userId).maybeSingle();
    if (error) return json(req,{error:'Account details are temporarily unavailable. Try again.'},503);
    if (!actor || actor.session_version !== session.sessionVersion) return json(req,{error:'Your session changed. Sign in again before deleting the account.'},401);
    const result = await performAccountDeletion({admin,actorId:actor.id,actorVersion:session.sessionVersion,email:actor.email,self:true,force:true,stripeSecret:STRIPE_SECRET_KEY,
      revalidate:async()=>{const fresh=await requireActiveAppSession(admin,req);return fresh?.userId===actor.id && fresh?.sessionVersion===session.sessionVersion;},
    });
    await auditEvent(admin,req,'fw_delete_account','success',{userId:actor.id,email:actor.email},{deletedAuthUsers:result.deletedAuthUsers,canceledStripeSubscriptions:result.canceledStripeSubscriptions,managedSubscriptions:result.managedSubscriptions});
    return json(req,result);
  } catch(error) {
    const failure=error instanceof AccountDeletionError ? error : new AccountDeletionError('Deletion was not confirmed. Try again.');
    await auditEvent(admin,req,'fw_delete_account','error',{userId:session.userId},{reason:failure.message,...failure.details});
    return json(req,{error:failure.message,...failure.details},failure.status);
  }
});
