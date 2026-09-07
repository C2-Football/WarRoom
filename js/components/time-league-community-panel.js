(function () {
    'use strict';
    const h = React.createElement;
    function useAccountText(userId) {
        const [state, setState] = React.useState(() => ({ userId, text: '' }));
        return [state.userId === userId ? state.text : '', value => setState(previous => ({
            userId, text: typeof value === 'function' ? value(previous.userId === userId ? previous.text : '') : value,
        }))];
    }
    function CommunityPanel({ onOpenOnline, onProfile }) {
        const Remote = window.App.TimeLeagueRemote;
        const userId = window.App.OD?.getCurrentUserId?.();
        const [view, setView] = React.useState('leaderboard');
        const [query, setQuery] = React.useState('');
        const [search, setSearch] = React.useState('');
        const [lookingOnly, setLookingOnly] = React.useState(false);
        const [page, setPage] = React.useState(0);
        const [directory, setDirectory] = React.useState({ userId: null, profiles: [], hasMore: false });
        const [inbox, setInbox] = React.useState({ userId: null, incoming: [], outgoing: [] });
        const [loading, setLoading] = React.useState(false);
        const [error, setError] = useAccountText(userId);
        const [notice, setNotice] = useAccountText(userId);
        const [target, setTarget] = React.useState(null);
        const [seats, setSeats] = React.useState({ userId: null, rows: [] });
        const [seat, setSeat] = React.useState('');
        const [busy, setBusy] = React.useState(false);
        const [refresh, setRefresh] = React.useState(0);
        const rows = directory.userId === userId ? directory.profiles : [];
        const incoming = inbox.userId === userId ? inbox.incoming : [];
        const outgoing = inbox.userId === userId ? inbox.outgoing : [];
        const availableSeats = seats.userId === userId ? seats.rows : [];
        React.useEffect(() => {
            let cancelled = false;
            if (!userId || !Remote) { setLoading(false); setDirectory({userId:null,profiles:[],hasMore:false}); setInbox({userId:null,incoming:[],outgoing:[]}); return undefined; }
            setLoading(true); setError('');
            Promise.allSettled([Remote.listCommunity({view:view==='invitations'?'players':view,q:search,page,limit:20,lookingOnly}),Remote.listCommunityInvites()]).then(results => {
                if (cancelled || window.App.OD?.getCurrentUserId?.() !== userId) return;
                const [listing, mail] = results;
                if (listing.status === 'fulfilled' && listing.value.ok) setDirectory({userId,profiles:listing.value.profiles || [],hasMore:Boolean(listing.value.hasMore)});
                else { setDirectory({userId,profiles:[],hasMore:false}); setError(listing.value?.error || 'The directory could not load. Try again.'); }
                if (mail.status === 'fulfilled' && mail.value.ok) setInbox({userId,incoming:mail.value.incoming || [],outgoing:mail.value.outgoing || []});
                else setError(previous => previous || mail.value?.error || 'Invitations could not refresh.');
            }).finally(() => { if (!cancelled) setLoading(false); });
            return () => { cancelled = true; };
        },[userId,view,search,page,lookingOnly,refresh]);
        React.useEffect(() => { setTarget(null); setSeats({userId:null,rows:[]}); setNotice(''); },[userId]);
        React.useEffect(() => {
            if (target?.userId !== userId) return;
            const composer = window.document?.getElementById('vault-community-invite');
            composer?.scrollIntoView({ block: 'center', behavior: 'auto' });
            composer?.focus({ preventScroll: true });
        }, [target, userId]);
        const beginInvite = async profile => {
            setTarget({userId,profile}); setSeat(''); setBusy(true); setError('');
            try {
                const owned = (await Remote.listMyOnlineLeagues()).filter(row => row.role === 'commissioner' && row.phase === 'draft');
                const options = [];
                for (const item of owned) {
                    const row = await Remote.loadOnlineLeague(item.rowId);
                    if (row.draft_started) continue;
                    for (const member of row.members || []) {
                        if (!member.joined) options.push({rowId:row.id,seatTeamId:member.seat_team_id,label:`${row.state.name} · ${row.state.teams.find(team=>team.teamId===member.seat_team_id)?.name || 'Open seat'}`});
                    }
                }
                if (window.App.OD?.getCurrentUserId?.() !== userId) return;
                setSeats({userId,rows:options});
                if (!options.length) setNotice('Create a friends league with an open human seat first. Invitations are available before the draft starts.');
            } catch (err) { if(window.App.OD?.getCurrentUserId?.()===userId)setError(err.message || 'Open seats could not load.'); }
            finally { setBusy(false); }
        };
        const sendInvite = async () => {
            const option = availableSeats[Number(seat)];
            if (!option || !target || target.userId !== userId || seat === '') return;
            setBusy(true);setError('');
            try {
                const result=await Remote.sendCommunityInvite({...option,profileId:target.profile.profileId});
                if(window.App.OD?.getCurrentUserId?.()!==userId)return;
                if(!result.ok)throw Error(result.error || 'Invitation could not be sent.');
                setNotice(`Invitation sent to ${target.profile.displayName}.`);setTarget(null);setRefresh(value=>value+1);
            }catch(err){if(window.App.OD?.getCurrentUserId?.()===userId)setError(err.message);}finally{setBusy(false);}
        };
        const respond = async (invite,accept) => {
            setBusy(true);setError('');
            try {
                const result=await Remote.respondCommunityInvite(invite.inviteId,accept);
                if(window.App.OD?.getCurrentUserId?.()!==userId)return;
                if(!result.ok)throw Error(result.error || 'Your response could not be saved.');
                setRefresh(value=>value+1);setNotice(accept?'You joined the league.':'Invitation declined.');
                if(accept && result.rowId)onOpenOnline(result.rowId);
            }catch(err){if(window.App.OD?.getCurrentUserId?.()===userId)setError(err.message);}finally{setBusy(false);}
        };
        const helmet = (profile,size=64) => h(window.TimeLeagueHelmetIcon,{helmet:profile.helmet,letter:window.App.TimeLeagueHelmet.monogramFor(profile.teamName || profile.displayName),size});
        return h('section',{className:'tl-community'},
            h('header',{className:'tl-community-hero'},h('small',null,'THE VAULT · COMMUNITY'),h('h1',null,'Find your next rivalry.'),h('p',null,'Meet managers, recruit your league and climb the shared-game standings.'),h('button',{className:'tl-btn',onClick:onProfile},'Edit my public profile'),userId&&h('button',{className:'tl-btn',disabled:loading,onClick:()=>setRefresh(value=>value+1)},'Refresh community')),
            !userId ? h('div',{className:'tl-card'},h('h2',null,'Join the community'),h('p',null,'Sign in to find players and manage invitations. You choose whether your profile appears publicly.'),h('a',{className:'tl-btn primary',href:'login.html'},'Sign in')) : h(React.Fragment,null,
                h('nav',{className:'tl-community-tabs','aria-label':'Community views'},[['leaderboard','Global leaderboard'],['players','Find players'],['invitations','Invitations']].map(([id,label])=>h('button',{key:id,className:'tl-btn'+(view===id?' primary':''),'aria-pressed':view===id,onClick:()=>{setView(id);setPage(0);setTarget(null);}},label,id==='invitations'&&incoming.filter(invite=>invite.status==='pending').length?` (${incoming.filter(invite=>invite.status==='pending').length})`:''))),
                view!=='invitations'&&h('form',{className:'tl-community-search',onSubmit:event=>{event.preventDefault();setSearch(query.trim());setPage(0);}},h('input',{className:'tl-input',value:query,onChange:event=>setQuery(event.target.value),placeholder:'Search manager or team','aria-label':'Search community',maxLength:60}),h('button',{className:'tl-btn',type:'submit'},'Search'),h('label',null,h('input',{type:'checkbox',checked:lookingOnly,onChange:event=>{setLookingOnly(event.target.checked);setPage(0);}}),' Looking for a league')),
                view==='leaderboard'&&h('p',{className:'tl-hint'},'Verified head-to-head: completed shared games between joined human managers. Ranked by championships, then wins and fewer losses. Solo and AI-opponent results stay in your career profile. Points use each league’s scoring rules.'),
                loading&&h('p',{role:'status'},'Loading community…'),error&&h('p',{className:'tl-card',role:'alert'},error,h('button',{className:'tl-btn',onClick:()=>setRefresh(value=>value+1)},'Retry')),notice&&h('p',{role:'status'},notice),
                view==='invitations'?h('div',{className:'tl-community-invites'},h('h2',null,'Your invitations'),!incoming.length&&!loading&&h('p',null,'No invitations yet. Publish your profile and select “Looking for a league” to be discoverable.'),incoming.map(invite=>h('article',{className:'tl-card',key:invite.inviteId},h('h3',null,invite.leagueName),h('p',null,`${invite.from?.displayName || 'A commissioner'} invited you to take ${invite.teamName || 'an open seat'}.`),h('small',null,invite.status),invite.status==='pending'&&h('div',null,h('button',{className:'tl-btn primary',disabled:busy||invite.available===false,onClick:()=>respond(invite,true)},invite.available===false?'Seat no longer available':'Accept & join league'),h('button',{className:'tl-btn',disabled:busy,onClick:()=>respond(invite,false)},'Decline')))),h('h2',null,'Invitations you sent'),!outgoing.length&&h('p',null,'Your invitations will appear here.'),outgoing.map(invite=>h('article',{className:'tl-card',key:invite.inviteId},h('strong',null,invite.leagueName),h('p',null,`${invite.to?.displayName || 'Manager'} · ${invite.status}`)))):
                h(React.Fragment,null,!rows.length&&!loading&&h('div',{className:'tl-card'},h('h2',null,'The field is open'),h('p',null,'No matching managers yet. Public profiles appear in Find players; leaderboard entries need a completed game against another human manager.')),
                    h('div',{className:'tl-community-grid'},rows.map((profile,i)=>h('article',{key:profile.profileId,className:`tl-community-player tl-backdrop-${['midnight','stadium','gridiron','heritage','aurora'].includes(profile.backdrop)?profile.backdrop:'midnight'}`,style:{'--club-primary':/^#[0-9a-f]{6}$/i.test(profile.primaryColor)?profile.primaryColor:'#87eed0','--club-secondary':/^#[0-9a-f]{6}$/i.test(profile.secondaryColor)?profile.secondaryColor:'#bfaaff'}},view==='leaderboard'&&h('span',{className:'tl-community-rank'},`#${page*20+i+1}`),helmet(profile),h('h2',null,profile.teamName),h('h3',null,profile.displayName),h('p',null,`${profile.stats?.wins||0}–${profile.stats?.losses||0}–${profile.stats?.ties||0} · ${profile.stats?.championships||0} titles`),h('small',null,`${Number(profile.stats?.pointsFor||0).toFixed(1)} points · ${profile.stats?.games||0} verified games`),profile.lookingForLeague&&h('span',{className:'tl-pill good'},'Looking for a league'),view==='players'&&profile.lookingForLeague&&profile.profileId!==window.App.TimeLeagueProfile?.readLocal()?.profileId&&h('button',{className:'tl-btn primary',disabled:busy,onClick:()=>beginInvite(profile)},'Invite to my league')))),
                    h('div',{className:'tl-community-pages'},h('button',{className:'tl-btn',disabled:page===0||loading,onClick:()=>setPage(value=>value-1)},'Previous'),h('span',null,`Page ${page+1}`),h('button',{className:'tl-btn',disabled:!directory.hasMore||loading,onClick:()=>setPage(value=>value+1)},'Next'))),
                target?.userId===userId&&h('section',{id:'vault-community-invite',tabIndex:-1,className:'tl-card tl-community-compose','aria-label':'Compose league invitation'},h('h2',null,`Invite ${target.profile.displayName}`),h('p',null,'Choose the league and open seat this invitation will offer.'),h('select',{className:'tl-select','aria-label':'Choose an open league seat',value:seat,onChange:event=>setSeat(event.target.value),disabled:busy},h('option',{value:''},'Select an open seat'),availableSeats.map((option,i)=>h('option',{key:`${option.rowId}:${option.seatTeamId}`,value:String(i)},option.label))),h('button',{className:'tl-btn primary',disabled:busy||seat==='',onClick:sendInvite},'Send invitation'),h('button',{className:'tl-btn',disabled:busy,onClick:()=>setTarget(null)},'Cancel'))));
    }
    window.WrTimeLeagueCommunityPanel=CommunityPanel;
})();
