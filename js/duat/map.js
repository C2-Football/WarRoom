/* global module */
(function (root, factory) {
    'use strict';
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else { root.App = root.App || {}; root.App.DuatMap = factory(); }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';
    const WORLD_VIEW = Object.freeze({x:0,y:0,w:1000,h:500});
    const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
    const finite = (value, fallback) => Number.isFinite(value) ? value : fallback;
    function boundView(view, minWidth = 16) {
        const w = clamp(finite(view.w,1000),minWidth,1000), h = w / 2;
        return {x:clamp(finite(view.x,0),0,1000-w),y:clamp(finite(view.y,0),0,500-h),w,h};
    }
    function zoomAt(view, factor, anchor = {x:.5,y:.5}, minWidth = 16) {
        const w = clamp(view.w * finite(factor,1),minWidth,1000), h = w / 2;
        return boundView({x:view.x+anchor.x*(view.w-w),y:view.y+anchor.y*(view.h-h),w,h},minWidth);
    }
    function moveView(view, dx, dy, minWidth = 16) {
        return boundView({...view,x:view.x+dx*view.w,y:view.y+dy*view.h},minWidth);
    }
    // SVG preserves a2:1 viewBox inside its CSS rectangle. Account for any
    // letterboxing so touch, trackpad and wheel anchors refer to visible land.
    function pointInMap(clientX, clientY, rect) {
        const scale=Math.max(.0001,Math.min(rect.width/1000,rect.height/500));
        const width=1000*scale,height=500*scale;
        return {x:(clientX-rect.left-(rect.width-width)/2)/width,
            y:(clientY-rect.top-(rect.height-height)/2)/height,clientX,clientY};
    }
    const center = points => ({x:points.reduce((n,p)=>n+p.x,0)/points.length,y:points.reduce((n,p)=>n+p.y,0)/points.length});
    const distance = points => Math.hypot(points[1].clientX-points[0].clientX,points[1].clientY-points[0].clientY);
    function gestureStart(previous, point, view, targetId = '') {
        const points=[...(previous?.points || []).filter(p=>p.id!==point.id),point].slice(0,2);
        return {points,origin:points.map(p=>({...p})),view:{...view},targetId:points.length===1?targetId:'',
            moved:Boolean(previous?.moved)||points.length>1};
    }
    function gestureMove(previous, point, minWidth = 16) {
        if (!previous?.points.some(p=>p.id===point.id)) return {gesture:previous,view:null};
        const points=previous.points.map(p=>p.id===point.id?point:p);
        const origin=previous.origin, moved=previous.moved || points.some(p=>{
            const start=origin.find(o=>o.id===p.id);
            return start && Math.hypot(p.clientX-start.clientX,p.clientY-start.clientY)>6;
        });
        const start=center(origin), current=center(points), base=previous.view;
        const factor=points.length===2?distance(origin)/Math.max(1,distance(points)):1;
        const w=clamp(base.w*factor,minWidth,1000),h=w/2;
        const view=boundView({x:base.x+start.x*base.w-current.x*w,y:base.y+start.y*base.h-current.y*h,w,h},minWidth);
        return {gesture:{...previous,points,moved},view};
    }
    function gestureEnd(previous, pointerId, view, cancelled = false) {
        if (!previous?.points.some(p=>p.id===pointerId)) return {gesture:previous,selectedId:''};
        const remaining=previous.points.filter(p=>p.id!==pointerId);
        const selectedId=!cancelled&&!previous.moved&&previous.points.length===1?previous.targetId:'';
        return {gesture:remaining.length?{...previous,points:remaining,origin:remaining.map(p=>({...p})),view:{...view},targetId:'',moved:true}:null,selectedId};
    }
    const pointOf = t => ({x:(t.longitude+180)/360*1000,y:(90-t.latitude)/180*500});
    function focusView(territories, minWidth = 60) {
        if (!territories.length) return {...WORLD_VIEW};
        const points=territories.map(pointOf), xs=points.map(p=>p.x),ys=points.map(p=>p.y);
        // Widely separated islands retain the global frame instead of jumping
        // across the antimeridian to an empty midpoint.
        const spreadX=Math.max(...xs)-Math.min(...xs),spreadY=Math.max(...ys)-Math.min(...ys);
        if(spreadX>650)return {...WORLD_VIEW};
        const w=clamp(Math.max(minWidth,spreadX*1.6+30,spreadY*3.2+30),minWidth,1000);
        return boundView({x:(Math.min(...xs)+Math.max(...xs))/2-w/2,y:(Math.min(...ys)+Math.max(...ys))/2-w/4,w},16);
    }
    const overviewIndexes = new WeakMap();
    function overviewIndex(source, countries) {
        if(overviewIndexes.has(source))return overviewIndexes.get(source);
        const countryById=new Map(countries.TERRITORIES.map(t=>[t.id,t])),groups=new Map();
        for(const territory of source.TERRITORIES) {
            const parent=countryById.get(territory.parentTerritoryId),id=parent?.id || 'overview-'+territory.countryCode;
            if(!groups.has(id))groups.set(id,{id,name:parent?.name || territory.countryName,region:territory.region,
                path:parent?.path || '',longitude:parent?.longitude,latitude:parent?.latitude,members:[]});
            groups.get(id).members.push(territory);
        }
        for(const group of groups.values()) {
            if(!Number.isFinite(group.longitude)) {
                const largest=[...group.members].sort((a,b)=>(b.areaKm2||0)-(a.areaKm2||0))[0];
                group.longitude=largest.longitude;group.latitude=largest.latitude;
            }
        }
        const result=[...groups.values()];overviewIndexes.set(source,result);return result;
    }
    function countryOverview(source, countries, owners, factionId, claimIds = [], attackIds = []) {
        const claims=new Set(claimIds),attacks=new Set(attackIds);
        return overviewIndex(source,countries).map(group=>{
            const ownerCounts={},ownerAreas={},claimable=[],attackable=[];
            let unclaimed=0,areaKm2=0;
            for(const t of group.members) {
                const owner=owners[t.id],size=t.areaKm2||0;areaKm2+=size;
                if(owner){ownerCounts[owner]=(ownerCounts[owner]||0)+1;ownerAreas[owner]=(ownerAreas[owner]||0)+size;}else unclaimed++;
                if(claims.has(t.id))claimable.push(t.id);if(attacks.has(t.id))attackable.push(t.id);
            }
            const ownerIds=Object.keys(ownerCounts).sort((a,b)=>ownerAreas[b]-ownerAreas[a]||a.localeCompare(b));
            const status=ownerIds.length>1?'contested':ownerIds.length===0?'unclaimed':unclaimed?'partial':'owned';
            return {...group,ownerCounts,ownerAreas,ownerIds,unclaimed,areaKm2,claimIds:claimable,attackIds:attackable,
                total:group.members.length,mine:ownerCounts[factionId]||0,status,owner:status==='owned'?ownerIds[0]:null};
        });
    }
    function suggestedClaims(source, owners, factionId, legalIds, limit = 3) {
        const allowed=new Set(legalIds),byId=new Map(source.TERRITORIES.map(t=>[t.id,t])),support=new Map();
        for(const route of source.ROUTES)for(const [from,to] of [[route.from,route.to],[route.to,route.from]]) {
            if(owners[from]===factionId&&allowed.has(to))support.set(to,(support.get(to)||0)+1);
        }
        return legalIds.map(id=>byId.get(id)).filter(t=>t&&!owners[t.id])
            .sort((a,b)=>(support.get(b.id)||0)-(support.get(a.id)||0)||(b.areaKm2||0)-(a.areaKm2||0)||a.id.localeCompare(b.id)).slice(0,limit);
    }
    return Object.freeze({WORLD_VIEW,boundView,zoomAt,moveView,pointInMap,gestureStart,gestureMove,gestureEnd,pointOf,focusView,countryOverview,suggestedClaims});
});
