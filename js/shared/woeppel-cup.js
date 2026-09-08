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
    const tournament = {
        defaults(league) {
            const teams=(league.rosters||[]).map(r=>String(r.roster_id));
            const size=2**Math.floor(Math.log2(Math.max(2,Math.min(8,teams.length))));
            const end=Math.max(3,Math.min(18,(Number(league.settings?.playoff_week_start)||15)-1));
            const rounds=Math.log2(size), length=Math.min(3,end-rounds);
            return {version:2,name:'League Cup',enabled:false,locked:false,teams,format:'points',startWeek:end-rounds-length+1,groupWeeks:length,knockoutStart:end-rounds+1,qualifierCount:size,drawMargin:0,weeks:{}};
        },
        validate(s) {
            if(!s||s.version!==2||typeof s.name!=='string'||!s.name.trim()||s.name.length>80||typeof s.enabled!=='boolean'||typeof s.locked!=='boolean')throw Error('Enter a tournament name (up to 80 characters).');
            if(!Array.isArray(s.teams)||s.teams.length<2||s.teams.length>64||new Set(s.teams).size!==s.teams.length||s.teams.some(id=>typeof id!=='string'||!id))throw Error('Choose 2–64 different teams.');
            if(!['points','round-robin'].includes(s.format)||!Number.isFinite(s.drawMargin)||s.drawMargin<0||s.drawMargin>100)throw Error('Choose a valid qualifying format and draw margin.');
            if(!Number.isInteger(s.qualifierCount)||s.qualifierCount<2||s.qualifierCount>s.teams.length||!Number.isInteger(Math.log2(s.qualifierCount)))throw Error('Knockout field must be 2, 4, 8, 16, 32 or 64 teams, within the participating field.');
            if(![s.startWeek,s.groupWeeks,s.knockoutStart].every(Number.isInteger)||s.startWeek<1||s.groupWeeks<1||s.knockoutStart<s.startWeek+s.groupWeeks||s.knockoutStart+Math.log2(s.qualifierCount)-1>18)throw Error('Choose non-overlapping qualifying and knockout weeks within Weeks 1–18.');
            const cycle=s.teams.length%2?s.teams.length:s.teams.length-1;
            if(s.format==='round-robin'&&s.groupWeeks%cycle!==0)throw Error('Round robin needs a complete '+cycle+'-week cycle so every team plays equally.');
            if(!s.weeks||typeof s.weeks!=='object'||Array.isArray(s.weeks))throw Error('Invalid score data.');
        },
        schedule(s){return [...Array.from({length:s.groupWeeks},(_,i)=>s.startWeek+i),...Array.from({length:Math.log2(s.qualifierCount)},(_,i)=>s.knockoutStart+i)];},
        fixtures(s){
            tournament.validate(s);if(s.format==='points')return [];
            const ring=[...s.teams];if(ring.length%2)ring.push(null);const out=[];
            for(let i=0;i<s.groupWeeks;i++){
                for(let j=0;j<ring.length/2;j++)if(ring[j]!==null&&ring[ring.length-1-j]!==null)out.push({week:s.startWeek+i,a:ring[j],b:ring[ring.length-1-j]});
                ring.splice(1,0,ring.pop());
            }return out;
        },
        tables(s){
            tournament.validate(s);
            const rows=Object.fromEntries(s.teams.map(id=>[id,{id,played:0,w:0,d:0,l:0,points:0,pf:0}]));
            for(let week=s.startWeek;week<s.startWeek+s.groupWeeks;week++){
                const w=s.weeks[week];if(!w?.final)continue;
                if(s.teams.some(id=>!Number.isFinite(w.scores?.[id])))throw Error('Finalized week has missing scores.');
                for(const id of s.teams)rows[id].pf+=w.scores[id];
                if(s.format==='points')for(const id of s.teams){rows[id].played++;rows[id].points+=w.scores[id];}
            }
            for(const f of tournament.fixtures(s)){
                const w=s.weeks[f.week];if(!w?.final)continue;
                const a=w.scores[f.a],b=w.scores[f.b],draw=Math.abs(Math.round(a*100)-Math.round(b*100))<=Math.round(s.drawMargin*100);
                for(const [id,x,y] of [[f.a,a,b],[f.b,b,a]]){const r=rows[id];r.played++;if(draw){r.d++;r.points++;}else if(x>y){r.w++;r.points+=3;}else r.l++;}
            }
            return Object.values(rows).sort(compare);
        },
        qualifiers(s){
            const rows=tournament.tables(s);
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
            const ids=tournament.qualifiers(s).map(r=>r.id);let order=[1,2];
            while(order.length<ids.length){const sum=order.length*2+1;order=order.flatMap(n=>[n,sum-n]);}
            return Array.from({length:ids.length/2},(_,i)=>[ids[order[i*2]-1],ids[order[i*2+1]-1]]);
        },
        knockout(s){
            let pairs=tournament.bracket(s);const rounds=[];
            for(let i=0;i<Math.log2(s.qualifierCount);i++){
                const week=s.knockoutStart+i,w=s.weeks[week];
                const matches=pairs.map(([a,b])=>{const x=w?.scores[a],y=w?.scores[b],r=s.tieRulings?.[week+':'+a+':'+b];return {week,a,b,x,y,winner:w?.final&&Number.isFinite(x)&&Number.isFinite(y)?x!==y?(x>y?a:b):r?.reason?.trim()&&[a,b].includes(r.winner)?r.winner:null:null};});
                rounds.push(matches);if(matches.some(m=>!m.winner))break;
                pairs=Array.from({length:matches.length/2},(_,j)=>[matches[j*2].winner,matches[j*2+1].winner]);
            }return rounds;
        }
    };
    const api={tournament,...Object.fromEntries(Object.keys(legacy).map(k=>[k,s=>s?.version===2?tournament[k](s):legacy[k](s)]))};root.WoeppelCup=api;
    if(typeof module!=='undefined')module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
