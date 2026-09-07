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
    const api={validate,fixtures,tables,qualifiers,bracket,knockout};root.WoeppelCup=api;
    if(typeof module!=='undefined')module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
