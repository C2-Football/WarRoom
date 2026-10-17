/* global module */
(function(root) {
    const groups = ['A', 'B', 'C'];
    function validate(state) {
        const ids = groups.flatMap(g => state.groups[g] || []);
        if (ids.length !== 12 || new Set(ids).size !== 12 || groups.some(g => state.groups[g]?.length !== 4)) throw Error('Assign 12 different teams to three groups of four.');
        if (![0, 4].includes(state.drawMargin)) throw Error('Choose exact-score or four-point group draws.');
    }
    function fixtures(state) {
        validate(state);
        const rounds = [[[0,3],[1,2]], [[0,2],[3,1]], [[0,1],[2,3]]];
        return Array.from({length:6}, (_,i) => groups.flatMap(g => rounds[i%3].map(([a,b]) => ({week:6+i, group:g, a:state.groups[g][a], b:state.groups[g][b]})))).flat();
    }
    const compare = (a,b) => b.points-a.points || b.pf-a.pf;
    function tables(state) {
        const rows = Object.fromEntries(groups.flatMap(g => state.groups[g].map(id => [id,{id,group:g,played:0,w:0,d:0,l:0,points:0,pf:0,pa:0}])));
        fixtures(state).forEach(f => {
            const week = state.weeks[f.week];
            if (!week?.final) return;
            const a = week.scores[f.a], b = week.scores[f.b];
            if (!Number.isFinite(a) || !Number.isFinite(b)) throw Error('Finalized week has missing scores.');
            const draw = Math.abs(Math.round(a*100)-Math.round(b*100)) <= state.drawMargin*100;
            [[f.a,a,b],[f.b,b,a]].forEach(([id,pf,pa]) => { const r=rows[id]; r.played++;r.pf+=pf;r.pa+=pa;if(draw){r.d++;r.points++;}else if(pf>pa){r.w++;r.points+=3;}else r.l++; });
        });
        return Object.fromEntries(groups.map(g => [g,state.groups[g].map(id=>rows[id]).sort(compare)]));
    }
    // PF ties require an explicit commissioner ruling; never invent Max PF.
    function qualifiers(state) {
        const t=tables(state);
        if (Object.values(t).flat().some(r=>r.played!==6)) throw Error('Finalize all six group weeks before seeding.');
        if(state.seedRuling?.reason?.trim() && Array.isArray(state.seedRuling.ids)) {
            const ids=state.seedRuling.ids;const all=Object.values(t).flat();
            if(ids.length!==8||new Set(ids).size!==8||ids.some(id=>!all.some(r=>r.id===id)))throw Error('Choose eight different teams for the seeding ruling.');
            return ids.map(id=>all.find(r=>r.id===id));
        }
        if(Object.values(t).some(rs=>rs.some((r,i)=>i>0&&compare(r,rs[i-1])===0))) throw Error('A group tiebreak remains unresolved. Export the standings for a commissioner ruling before creating a bracket.');
        const thirds=groups.map(g=>t[g][2]).sort(compare);
        if(compare(thirds[1],thirds[2])===0) throw Error('The last wildcard is tied on Cup points and PF; commissioner ruling required.');
        return [...groups.map(g=>t[g][0]).sort(compare),...groups.map(g=>t[g][1]).sort(compare),...thirds.slice(0,2)];
    }
    function bracket(state) {
        const seeds=qualifiers(state); const top=seeds.slice(0,4);const low=seeds.slice(4).reverse();
        function match(i,rest){if(i===4)return [];for(let j=0;j<rest.length;j++){if(top[i].group===rest[j].group)continue;const tail=match(i+1,rest.filter((_,k)=>k!==j));if(tail)return [[top[i].id,rest[j].id],...tail];}return null;}
        const pairs=match(0,low);if(!pairs)throw Error('Unable to avoid group rematches.');return pairs;
    }
    function knockout(state) {
        const rounds=[];let pairs=bracket(state);
        for(let week=15;week<=17;week++) {
            const results=pairs.map(([a,b])=>{const w=state.weeks[week];const x=w?.scores[a],y=w?.scores[b];const ruling=state.tieRulings?.[week+':'+a+':'+b];const manual=ruling?.reason?.trim()&&[a,b].includes(ruling.winner)?ruling.winner:null;return {a,b,week,x,y,winner:w?.final&&Number.isFinite(x)&&Number.isFinite(y)?(x!==y?(x>y?a:b):manual):null};});rounds.push(results);
            if(results.some(r=>!r.winner))break;
            const wins=results.map(r=>r.winner);pairs=[];for(let i=0;i<wins.length-1;i+=2)pairs.push([wins[i],wins[i+1]]);
        }return rounds;
    }
    const legacy={validate,fixtures,tables,qualifiers,bracket,knockout};
    const formats = [
        {id:'points',name:'Total points',tagline:'Every point counts',description:'Add weekly fantasy scores, then send the top teams into a knockout bracket.'},
        {id:'round-robin',name:'Round robin',tagline:'Everyone gets a matchup',description:'Play complete head-to-head cycles for Cup points, then advance to knockouts.'},
        {id:'all-play',name:'All-play',tagline:'Face the whole field',description:'Each week earn one point per opponent beaten and half a point per tied opponent, then qualify for knockouts.'},
        {id:'median',name:'Beat the median',tagline:'Clear the weekly midpoint',description:'Earn one point above the weekly median and half a point when tied with it, then qualify for knockouts.'},
        {id:'knockout',name:'Knockout',tagline:'Win and advance',description:'Go straight into a seeded elimination bracket. Participant order sets the seeds; top seeds receive any byes.'},
        {id:'survivor',name:'Survivor',tagline:'Stay above the cut',description:'Cut the lowest scores each week until one team remains. Ties at the cut require a commissioner ruling.'},
        {id:'round-robin-double',name:'Round robin + double elimination',tagline:'Qualify, then get a second chance',description:'Play complete round-robin cycles for Cup points. Qualifiers enter upper and lower brackets; a second loss eliminates a team. An undefeated finalist must be beaten twice.'}
    ];
    const qualifyingFormats = new Set(['points','round-robin','all-play','median','round-robin-double']);
    const isDoubleElimination = s => (typeof s === 'string' ? s : s?.format) === 'round-robin-double';
    const isRoundRobin = s => s.format === 'round-robin' || isDoubleElimination(s);
    const cents = value => Math.round(value * 100);
    function roundCount(s) {
        return s.format === 'survivor' ? 0 : s.format === 'knockout' ? Math.ceil(Math.log2(Math.max(2,s.teams.length))) : isDoubleElimination(s) ? 2 * Math.log2(s.qualifierCount) + 1 : Math.log2(s.qualifierCount);
    }
    function stageLabel(s, week) {
        if (!isDoubleElimination(s)) return null;
        const offset = Number(week) - s.knockoutStart, upperRounds = Math.log2(s.qualifierCount);
        if (offset < 0) return Number(week) >= s.startWeek && Number(week) < s.startWeek + s.groupWeeks ? 'Round-robin qualifying' : null;
        if (offset === upperRounds * 2 - 1) return 'Championship';
        if (offset === upperRounds * 2) return 'Championship reset · if needed';
        const labels = [];
        if (offset < upperRounds) labels.push('Upper round ' + (offset + 1));
        if (offset >= 1 && offset <= upperRounds * 2 - 2) labels.push('Lower round ' + offset);
        return labels.join(' + ') || null;
    }
    // Each array is one fantasy week. Upper and lower matches can share a
    // week, but their participants are disjoint: a team never uses one score
    // for two games. Lower-bracket entrants cross adjacent upper branches to
    // avoid an immediate rematch where the field permits it.
    function doubleElimination(s) {
        if (!isDoubleElimination(s)) return [];
        const initial = tournament.bracket(s), count = Math.log2(s.qualifierCount);
        const upperWins = {}, upperLosses = {}, lowerWins = {}, rounds = [];
        let championship = null;
        const pair = ids => Array.from({ length: ids.length / 2 }, (_, i) => [ids[i * 2], ids[i * 2 + 1]]);
        const play = (pairs, week, bracket, round, label, conditional = false) => pairs.map(([a, b]) => {
            const record = s.weeks[week], x = record?.scores?.[a], y = record?.scores?.[b];
            const ruling = s.tieRulings?.[week + ':' + a + ':' + b];
            const complete = record?.final && Number.isFinite(x) && Number.isFinite(y);
            const winner = complete ? x !== y ? (x > y ? a : b) : ruling?.reason?.trim() && [a, b].includes(ruling.winner) ? ruling.winner : null : null;
            return { week, a, b, x, y, winner, loser: winner ? winner === a ? b : a : null, bye: false,
                bracket, round, stageLabel: label, conditional, blocked: !winner,
                reason: winner ? null : !record?.final ? 'Finalize this week before advancing.'
                    : !Number.isFinite(x) || !Number.isFinite(y) ? 'Finalized week has missing scores.' : 'The match is tied. Record a commissioner tiebreak ruling.' };
        });
        for (let offset = 0; offset < roundCount(s); offset++) {
            const week = s.knockoutStart + offset, matches = [];
            if (offset < count) {
                const round = offset + 1;
                const upper = play(round === 1 ? initial : pair(upperWins[round - 1]), week, 'upper', round, 'Upper bracket · Round ' + round);
                matches.push(...upper);
                upperWins[round] = upper.map(match => match.winner);
                upperLosses[round] = upper.map(match => match.loser);
            }
            if (offset >= 1 && offset <= count * 2 - 2) {
                const round = offset;
                let pairs;
                if (round === 1) pairs = pair(upperLosses[1]);
                else if (round % 2 === 1) pairs = pair(lowerWins[round - 1]);
                else {
                    const entrants = upperLosses[round / 2 + 1], waiting = lowerWins[round - 1];
                    pairs = entrants.map((id, i) => [id, waiting[waiting.length > 1 ? i ^ 1 : i]]);
                }
                const lower = play(pairs, week, 'lower', round, 'Lower bracket · Round ' + round);
                matches.push(...lower);
                lowerWins[round] = lower.map(match => match.winner);
            }
            if (offset === count * 2 - 1) {
                const upper = upperWins[count][0], lower = count === 1 ? upperLosses[1][0] : lowerWins[count * 2 - 2][0];
                championship = play([[upper, lower]], week, 'final', 1, 'Championship')[0];
                matches.push(championship);
            }
            if (offset === count * 2) {
                // The upper finalist arrived undefeated. Only its first loss
                // opens the reserved reset week; otherwise the Cup is complete.
                if (championship.winner === championship.a) break;
                matches.push(...play([[championship.a, championship.b]], week, 'reset', 2, 'Championship reset', true));
            }
            rounds.push(matches);
            if (matches.some(match => !match.winner)) break;
        }
        return rounds;
    }
    function survivorStages(s) {
        const stages = [], usedRulings = new Set();
        let active = [...s.teams];
        for (let i=0;i<s.groupWeeks && active.length>1;i++) {
            const week=s.startWeek+i, record=s.weeks[week];
            const cutCount=Math.ceil((active.length-1)/(s.groupWeeks-i));
            const requiredSurvivors=active.length-cutCount;
            const ranked=active.map(id=>({id,score:record?.scores?.[id]})).sort((a,b)=>{
                const av=Number.isFinite(a.score),bv=Number.isFinite(b.score);
                return av&&bv?b.score-a.score:av?-1:bv?1:0;
            });
            const stage={week,active:[...active],ranked,cutCount,requiredSurvivors,eliminated:[],survivors:[],aboveCutoff:[],pendingTie:null,final:false,blocked:false};
            stages.push(stage);
            if(!record?.final || ranked.some(r=>!Number.isFinite(r.score))) {
                stage.blocked=true;stage.reason=!record?.final?'Finalize this week before advancing.':'Finalized week has missing active-team scores.';break;
            }
            const cutoff=ranked[requiredSurvivors-1].score;
            const above=ranked.filter(r=>r.score>cutoff).map(r=>r.id);
            const tied=ranked.filter(r=>r.score===cutoff).map(r=>r.id);
            const places=requiredSurvivors-above.length;
            stage.aboveCutoff=above;
            let survivors=ranked.slice(0,requiredSurvivors).map(r=>r.id);
            const ruling=s.survivorRulings?.[week];
            if(tied.length>places) {
                stage.pendingTie={ids:tied,places};
                if(!ruling) {stage.blocked=true;stage.reason='The survivor cutoff is tied. Record a commissioner ruling.';break;}
                const ids=ruling.ids;
                if(!ruling.reason?.trim()||!Array.isArray(ids)||ids.length!==requiredSurvivors||new Set(ids).size!==ids.length||ids.some(id=>!above.includes(id)&&!tied.includes(id))||above.some(id=>!ids.includes(id)))throw Error('Survivor ruling must select every team above the cutoff and exactly '+places+' of the tied teams.');
                survivors=[...ids];usedRulings.add(String(week));stage.pendingTie=null;stage.ruled=true;
            } else if(ruling) throw Error('A survivor ruling is only valid for a tied cutoff.');
            stage.survivors=survivors;stage.eliminated=active.filter(id=>!survivors.includes(id));stage.final=true;
            active=survivors;
        }
        if(Object.keys(s.survivorRulings||{}).some(week=>!usedRulings.has(String(week))))throw Error('A survivor ruling targets an unresolved or inactive week.');
        return stages;
    }
    const tournament = {
        formats, roundCount, isDoubleElimination, doubleElimination, stageLabel,
        configure(league,format,existing) {
            if(!formats.some(f=>f.id===format))throw Error('Choose a tournament format.');
            const all=(league.rosters||[]).map(r=>String(r.roster_id));
            const selected=Array.isArray(existing?.teams)?existing.teams.filter(id=>all.includes(id)):[];
            const teams=Array.isArray(existing?.teams)?selected:all;
            let size=2**Math.floor(Math.log2(Math.max(2,Math.min(8,teams.length))));
            const cycleWeeks=Math.max(1,teams.length%2?teams.length:teams.length-1);
            // Prefer the largest practical final field, keeping the full RR
            // cycle and a possible reset. Even two qualifiers cannot make an
            // oversized participating field fit; validation explains that case.
            if(isDoubleElimination(format))while(size>2&&cycleWeeks+2*Math.log2(size)+1>18)size/=2;
            const end=Math.max(3,Math.min(18,(Number(league.settings?.playoff_week_start)||15)-1));
            const s={version:2,name:existing?.name||'League Cup',enabled:existing?.enabled===true,locked:false,teams,format,startWeek:1,groupWeeks:3,knockoutStart:1,qualifierCount:size,drawMargin:Number.isFinite(existing?.drawMargin)?existing.drawMargin:0,weeks:{}};
            if(format==='knockout') {s.groupWeeks=0;s.qualifierCount=teams.length;s.startWeek=Math.max(1,end-Math.ceil(Math.log2(Math.max(2,teams.length)))+1);s.knockoutStart=s.startWeek;}
            else if(format==='survivor') {s.qualifierCount=1;s.groupWeeks=Math.max(1,Math.min(3,teams.length-1,end));s.startWeek=end-s.groupWeeks+1;s.knockoutStart=s.startWeek;}
            else {const rounds=isDoubleElimination(format)?2*Math.log2(size)+1:Math.log2(size);s.groupWeeks=isRoundRobin(s)?cycleWeeks:Math.min(3,end-rounds);s.startWeek=Math.max(1,end-rounds-s.groupWeeks+1);s.knockoutStart=s.startWeek+s.groupWeeks;}
            return s;
        },
        defaults(league) {return tournament.configure(league,'points');},
        validate(s) {
            if(!s||s.version!==2||typeof s.name!=='string'||!s.name.trim()||s.name.length>80||typeof s.enabled!=='boolean'||typeof s.locked!=='boolean')throw Error('Enter a tournament name (up to 80 characters).');
            if(!Array.isArray(s.teams)||s.teams.length<2||s.teams.length>64||new Set(s.teams).size!==s.teams.length||s.teams.some(id=>typeof id!=='string'||!id))throw Error('Choose 2–64 different teams.');
            if(!formats.some(f=>f.id===s.format)||!Number.isFinite(s.drawMargin)||s.drawMargin<0||s.drawMargin>100)throw Error('Choose a valid tournament format and draw margin.');
            if(!s.weeks||typeof s.weeks!=='object'||Array.isArray(s.weeks))throw Error('Invalid score data.');
            if(![s.startWeek,s.groupWeeks,s.knockoutStart].every(Number.isInteger))throw Error('Choose whole-number tournament weeks within Weeks 1–18.');
            if(s.format==='knockout') {
                if(s.qualifierCount!==s.teams.length||s.groupWeeks!==0||s.startWeek!==s.knockoutStart||s.startWeek<1||s.startWeek+roundCount(s)-1>18)throw Error('Direct knockout uses all participating teams, zero qualifying weeks, and one round per week within Weeks 1–18.');
            } else if(s.format==='survivor') {
                if(s.qualifierCount!==1||s.groupWeeks<1||s.startWeek<1||s.startWeek+s.groupWeeks-1>18||s.knockoutStart!==s.startWeek)throw Error('Survivor needs one winner and a weekly elimination schedule within Weeks 1–18.');
                if(s.survivorRulings && (typeof s.survivorRulings!=='object'||Array.isArray(s.survivorRulings)))throw Error('Invalid survivor rulings.');
                for(const [week,r] of Object.entries(s.survivorRulings||{}))if(!/^\d+$/.test(week)||Number(week)<s.startWeek||Number(week)>=s.startWeek+s.groupWeeks||!r||typeof r.reason!=='string'||!r.reason.trim()||!Array.isArray(r.ids)||new Set(r.ids).size!==r.ids.length||r.ids.some(id=>!s.teams.includes(id)))throw Error('Invalid survivor ruling: choose participating survivors and provide a reason for a scheduled week.');
                survivorStages(s);
            } else {
                if(!Number.isInteger(s.qualifierCount)||s.qualifierCount<2||s.qualifierCount>s.teams.length||!Number.isInteger(Math.log2(s.qualifierCount)))throw Error('Knockout field must be 2, 4, 8, 16, 32 or 64 teams, within the participating field.');
                if(isDoubleElimination(s)&&s.groupWeeks+roundCount(s)>18)throw Error('This round robin + double-elimination field needs '+(s.groupWeeks+roundCount(s))+' weeks, including a possible championship reset. Choose fewer teams or fewer qualifiers to fit Weeks 1–18.');
                if(s.startWeek<1||s.groupWeeks<1||s.knockoutStart<s.startWeek+s.groupWeeks||s.knockoutStart+roundCount(s)-1>18)throw Error(isDoubleElimination(s)?'Choose non-overlapping round-robin and double-elimination weeks, including a possible championship reset, within Weeks 1–18.':'Choose non-overlapping qualifying and knockout weeks within Weeks 1–18.');
                const cycle=s.teams.length%2?s.teams.length:s.teams.length-1;
                if(isRoundRobin(s)&&s.groupWeeks%cycle!==0)throw Error('Round robin needs a complete '+cycle+'-week cycle so every team plays equally.');
            }
        },
        schedule(s){return s.format==='survivor'?Array.from({length:s.groupWeeks},(_,i)=>s.startWeek+i):s.format==='knockout'?Array.from({length:roundCount(s)},(_,i)=>s.startWeek+i):[...Array.from({length:s.groupWeeks},(_,i)=>s.startWeek+i),...Array.from({length:roundCount(s)},(_,i)=>s.knockoutStart+i)];},
        fixtures(s){
            tournament.validate(s);if(!isRoundRobin(s))return s.format==='knockout'?tournament.bracket(s).map(([a,b])=>({week:s.startWeek,a,b,bye:b===null})):[];
            const ring=[...s.teams];if(ring.length%2)ring.push(null);const out=[];
            for(let i=0;i<s.groupWeeks;i++){
                for(let j=0;j<ring.length/2;j++)if(ring[j]!==null&&ring[ring.length-1-j]!==null)out.push({week:s.startWeek+i,a:ring[j],b:ring[ring.length-1-j]});
                ring.splice(1,0,ring.pop());
            }return out;
        },
        tables(s){
            tournament.validate(s);
            const rows=Object.fromEntries(s.teams.map((id,i)=>[id,{id,seed:i+1,played:0,w:0,d:0,l:0,points:0,pf:0}]));
            if(!qualifyingFormats.has(s.format))return s.teams.map(id=>rows[id]);
            for(let week=s.startWeek;week<s.startWeek+s.groupWeeks;week++){
                const w=s.weeks[week];if(!w?.final)continue;
                if(s.teams.some(id=>!Number.isFinite(w.scores?.[id])))throw Error('Finalized week has missing scores.');
                for(const id of s.teams)rows[id].pf+=w.scores[id];
                if(s.format==='points')for(const id of s.teams){rows[id].played++;rows[id].points+=w.scores[id];}
                if(s.format==='all-play')for(const id of s.teams){const r=rows[id];r.played++;for(const other of s.teams){if(id===other)continue;const delta=w.scores[id]-w.scores[other];if(delta>0){r.w++;r.points++;}else if(delta===0){r.d++;r.points+=0.5;}else r.l++;}}
                if(s.format==='median'){
                    const scores=s.teams.map(id=>w.scores[id]).sort((a,b)=>a-b),mid=Math.floor(scores.length/2),median=scores.length%2?scores[mid]:(scores[mid-1]+scores[mid])/2;
                    for(const id of s.teams){const r=rows[id];r.played++;const delta=w.scores[id]-median;if(delta>0){r.w++;r.points++;}else if(delta===0){r.d++;r.points+=0.5;}else r.l++;}
                }
            }
            for(const f of tournament.fixtures(s)){
                const w=s.weeks[f.week];if(!w?.final)continue;
                const a=w.scores[f.a],b=w.scores[f.b],draw=Math.abs(cents(a)-cents(b))<=Math.round(s.drawMargin*100);
                for(const [id,x,y] of [[f.a,a,b],[f.b,b,a]]){const r=rows[id];r.played++;if(draw){r.d++;r.points++;}else if(x>y){r.w++;r.points+=3;}else r.l++;}
            }
            return Object.values(rows).sort(compare);
        },
        qualifiers(s){
            const rows=tournament.tables(s);
            if(s.format==='knockout')return rows;
            if(s.format==='survivor')throw Error('Survivor has no qualifying stage or knockout bracket.');
            if(Array.from({length:s.groupWeeks},(_,i)=>s.startWeek+i).some(w=>!s.weeks[w]?.final))throw Error('Finalize all qualifying weeks before seeding.');
            if(s.seedRuling?.reason?.trim()){
                const ids=s.seedRuling.ids;
                if(!Array.isArray(ids)||ids.length!==s.qualifierCount||new Set(ids).size!==ids.length||ids.some(id=>!s.teams.includes(id)))throw Error('Select a different participating team for each seed.');
                return ids.map(id=>rows.find(r=>r.id===id));
            }
            if(rows.some((r,i)=>i>0&&i<=s.qualifierCount&&compare(r,rows[i-1])===0))throw Error('Qualifying standings are tied. Record a commissioner seeding ruling.');
            return rows.slice(0,s.qualifierCount);
        },
        bracket(s){
            if(s.format==='survivor'){tournament.validate(s);return [];}
            const ids=tournament.qualifiers(s).map(r=>r.id);let order=[1,2];
            const size=2**Math.ceil(Math.log2(ids.length));
            while(order.length<size){const sum=order.length*2+1;order=order.flatMap(n=>[n,sum-n]);}
            return Array.from({length:size/2},(_,i)=>{const a=ids[order[i*2]-1]||null,b=ids[order[i*2+1]-1]||null;return a?[a,b]:[b,a];});
        },
        knockout(s){
            if(s.format==='survivor'){tournament.validate(s);return [];}
            if(isDoubleElimination(s))return doubleElimination(s);
            let pairs=tournament.bracket(s);const rounds=[];
            for(let i=0;i<roundCount(s);i++){
                const week=s.knockoutStart+i,w=s.weeks[week];
                const matches=pairs.map(([a,b])=>{
                    if(b===null)return {week,a,b,x:w?.scores?.[a],y:null,winner:a,bye:true};
                    const x=w?.scores?.[a],y=w?.scores?.[b],r=s.tieRulings?.[week+':'+a+':'+b];
                    return {week,a,b,x,y,bye:false,winner:w?.final&&Number.isFinite(x)&&Number.isFinite(y)?x!==y?(x>y?a:b):r?.reason?.trim()&&[a,b].includes(r.winner)?r.winner:null:null};
                });
                rounds.push(matches);if(matches.some(m=>!m.winner))break;
                pairs=Array.from({length:Math.floor(matches.length/2)},(_,j)=>[matches[j*2].winner,matches[j*2+1].winner]);
            }return rounds;
        },
        survivor(s){tournament.validate(s);return s.format==='survivor'?survivorStages(s):[];},
        requiredScoreIds(s,week){
            tournament.validate(s);week=Number(week);
            if(!tournament.schedule(s).includes(week))throw Error('This week is not on the tournament schedule.');
            if(qualifyingFormats.has(s.format)&&week<s.startWeek+s.groupWeeks)return [...s.teams];
            if(s.format==='survivor'){
                const stage=survivorStages(s).find(r=>r.week===week);
                if(!stage)throw Error('Resolve prior survivor weeks before finalizing this week.');
                return [...stage.active];
            }
            const matches=tournament.knockout(s).flat().filter(m=>m.week===week);
            if(!matches.length)throw Error(isDoubleElimination(s)&&tournament.result(s)?'This Cup is complete; no championship reset is needed.':'Resolve prior knockout rounds before finalizing this week.');
            return matches.filter(m=>!m.bye).flatMap(m=>[m.a,m.b]);
        },
        result(s){
            tournament.validate(s);
            if(s.format==='survivor'){
                const stage=survivorStages(s).at(-1);if(!stage?.final||stage.survivors.length!==1)return null;
                const champion=stage.survivors[0],eliminated=stage.ranked.filter(r=>stage.eliminated.includes(r.id));
                const runner=eliminated[0],runnerUp=runner&&(!eliminated[1]||runner.score!==eliminated[1].score)?runner.id:null;
                return {champion,runnerUp,winnerScore:runnerUp?s.weeks[stage.week].scores[champion]:null,runnerScore:runnerUp?runner.score:null,week:stage.week};
            }
            let rounds;try{rounds=tournament.knockout(s);}catch(e){if(/Finalize|tied|missing scores/.test(e.message))return null;throw e;}
            const final=rounds.at(-1)?.[0];
            if(isDoubleElimination(s)){
                if(!final?.winner||!['final','reset'].includes(final.bracket))return null;
                if(final.bracket==='final'&&final.winner!==final.a)return null;
                const runnerUp=final.winner===final.a?final.b:final.a;
                return {champion:final.winner,runnerUp,winnerScore:final.winner===final.a?final.x:final.y,runnerScore:final.winner===final.a?final.y:final.x,week:final.week};
            }
            if(rounds.length!==roundCount(s)||rounds.at(-1).length!==1||!final?.winner)return null;
            const runnerUp=final.winner===final.a?final.b:final.a;
            return {champion:final.winner,runnerUp,winnerScore:final.winner===final.a?final.x:final.y,runnerScore:final.winner===final.a?final.y:final.x,week:final.week};
        }
    };
    const api={tournament,formats,configure:tournament.configure,roundCount,isDoubleElimination,doubleElimination,stageLabel,survivor:tournament.survivor,result:tournament.result,schedule:tournament.schedule,requiredScoreIds:tournament.requiredScoreIds,...Object.fromEntries(Object.keys(legacy).map(k=>[k,s=>s?.version===2?tournament[k](s):legacy[k](s)]))};root.WoeppelCup=api;
    if(typeof module!=='undefined')module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
