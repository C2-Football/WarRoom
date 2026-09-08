'use strict';
// Reproducible build from Natural Earth's pinned, public-domain admin-1 data.
// node scripts/build-duat-provinces.cjs --source=PATH.geojson --source-dir=PATH/node_modules
// Build-only packages: d3-geo@3.1.1, topojson-server@3.0.1,
// topojson-client@3.1.0, topojson-simplify@3.0.3. No runtime dependency.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const argument = key => process.argv.find(value => value.startsWith('--' + key + '='))?.slice(key.length + 3);
const source = argument('source');
if (!source) throw new Error('Supply the pinned ne_10m_admin_1_states_provinces.geojson with --source=.');
const sourceDir = argument('source-dir'), library = name => require(sourceDir ? path.join(sourceDir, name) : name);
const geo = library('d3-geo'), topo = library('topojson-client'), server = library('topojson-server'), simplify = library('topojson-simplify');
const World = require(path.join(root, 'js/duat/world.js'));
const bytes = fs.readFileSync(source), original = JSON.parse(bytes), sha = crypto.createHash('sha256').update(bytes).digest('hex');
const pinnedUrl = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.1/geojson/ne_10m_admin_1_states_provinces.geojson';
const countryAliases = { 'United Republic of Tanzania':'Tanzania','United States of America':'United States','The Bahamas':'Bahamas',
    'East Timor':'Timor-Leste','Ivory Coast':"Côte d'Ivoire",'Guinea Bissau':'Guinea-Bissau','Swaziland':'Eswatini',
    'Gaza Strip':'Palestine','West Bank':'Palestine','Czech Republic':'Czechia','Northern Cyprus':'N. Cyprus',
    Macedonia:'North Macedonia','Republic of Serbia':'Serbia','S. Sudan':'South Sudan' };
const byCountry = new Map(World.TERRITORIES.map(territory => [territory.name,territory]));
const rawFeatures = original.features.filter(feature=>feature.properties.admin !== 'Antarctica');
const represented = new Set(rawFeatures.map(feature=>countryAliases[feature.properties.admin] || feature.properties.admin));
const fallback = World.TERRITORIES.filter(territory=>!represented.has(territory.name));
const metadata = new Map(), features = [];
function prepare(geometry) {
    const result = JSON.parse(JSON.stringify(geometry));
    const orient = polygon => polygon.forEach((ring, index) => {
        const area = geo.geoArea({type:'Polygon',coordinates:[ring]});
        // D3 uses clockwise exteriors. Orient each polygon independently:
        // one reversed island must never invert an entire multipolygon.
        if ((index === 0 && area > Math.PI * 2) || (index > 0 && area > 0 && area < Math.PI * 2)) ring.reverse();
    });
    if (result.type === 'Polygon') orient(result.coordinates);
    else result.coordinates.forEach(orient);
    return result;
}
for (const feature of rawFeatures) {
    const p = feature.properties, id = 'province-' + String(p.adm1_code || p.ne_id).toLowerCase();
    if (metadata.has(id)) throw new Error('Duplicate source province '+id);
    const geometry = prepare(feature.geometry), centroid = geo.geoCentroid(geometry);
    const country = byCountry.get(countryAliases[p.admin] || p.admin);
    // Tiny islands outside the coarse country atlas inherit only a broad display
    // continent from their nearest atlas territory; source boundaries stay intact.
    const near = country || [...World.TERRITORIES].sort((a,b)=>geo.geoDistance(centroid,[a.longitude,a.latitude])-geo.geoDistance(centroid,[b.longitude,b.latitude]))[0];
    metadata.set(id,{id,sourceId:p.adm1_code || String(p.ne_id),name:p.name_en || p.name || p.gn_name || `Unnamed region (${p.admin})`,
        countryName:p.admin,countryCode:p.adm0_a3,parentTerritoryId:country?.id || null,region:near.region,
        subtitle:p.type_en || 'Administrative playing region',longitude:Math.round(centroid[0]*10000)/10000,latitude:Math.round(centroid[1]*10000)/10000,
        areaKm2:Math.max(1,Math.round(geo.geoArea(geometry)*6371.0088**2))});
    features.push({type:'Feature',id,properties:{},geometry});
}
for (const territory of fallback) {
    const id='province-country-'+territory.id;
    metadata.set(id,{id,sourceId:territory.countryCode || territory.id,name:territory.name,countryName:territory.name,
        countryCode:territory.countryCode,parentTerritoryId:territory.id,region:territory.region,subtitle:'Country without admin-1 coverage',
        longitude:territory.longitude,latitude:territory.latitude,areaKm2:territory.areaKm2,fallback:true});
    features.push({type:'Feature',id,properties:{},geometry:territory.geometry});
}
features.sort((a,b)=>a.id.localeCompare(b.id));
const topology = server.topology({provinces:{type:'FeatureCollection',features}},100000);
const geometries = topology.objects.provinces.geometries;
const neighbors = topo.neighbors(geometries);
const weighted = simplify.presimplify(topology);
const threshold = simplify.quantile(weighted,0.07);
const generalized = simplify.simplify(weighted,threshold);
const projection=geo.geoEquirectangular().scale(1000/(2*Math.PI)).translate([500,250]);
const pathFor=geo.geoPath(projection).digits(2);
const territories=topo.feature(generalized,generalized.objects.provinces).features.map(feature=>{
    const row=metadata.get(feature.id), geometry=prepare(feature.geometry);
    // Keep small provinces that simplification would collapse as source outlines.
    const safeGeometry=geo.geoArea(geometry)>0 && pathFor(geometry) ? geometry : features.find(f=>f.id===feature.id).geometry;
    const rounded=prepare(JSON.parse(JSON.stringify(safeGeometry,(_key,value)=>typeof value==='number'?Math.round(value*100000)/100000:value)));
    return {...row,geometry:rounded,path:pathFor(rounded)};
});
const byId=new Map(territories.map(t=>[t.id,t]));
const gameHomes={mesopotamia:'Babylon',egypt:'Cairo',rome:'Rome',greece:'Attica',vikings:'Hordaland','inis-fail':'Meath',
    carthage:'Tunis',nubia:'Northern',china:'Henan',japan:'Nara Prefecture',india:'Bihar',warhorsemen:'Pest',mayans:'Petén',gaul:'Puy-de-Dôme',
    persia:'Fars',mongols:'Övörkhangai',korea:'Gyeonggi',khmer:'Siem Reap',siam:'Phra Nakhon Si Ayutthaya',majapahit:'East Java',aztecs:'Mexico',inca:'Cusco Departament',
    mali:'Koulikoro',aksum:'Tigray',zulu:'KwaZulu-Natal',england:'Essex',poland:'Greater Poland Voivodeship',portugal:'Lisbon'};
const factions=World.FACTIONS.map(faction=>{
    const candidates=territories.filter(t=>t.parentTerritoryId===faction.homeTerritoryId);
    const desired=gameHomes[faction.id], homeland=candidates.find(t=>t.name===desired);
    if(!homeland)throw new Error('Choose exact province home for '+faction.id+': '+desired+'; options '+candidates.map(t=>t.name).join(' / '));
    homeland.homelandOf=faction.id;
    return {...faction,homeTerritoryId:homeland.id};
});
const routes=[],keys=new Set(),adj=new Map(territories.map(t=>[t.id,new Set()]));
function addRoute(from,to,type,name,origin) {
    const [left,right]=[from,to].sort(),key=left+':'+right;
    if(left===right||keys.has(key))return;
    keys.add(key);adj.get(left).add(right);adj.get(right).add(left);
    routes.push({from:left,to:right,type,...(name?{name}:{}),origin});
}
neighbors.forEach((list,index)=>list.forEach(other=>addRoute(geometries[index].id,geometries[other].id,'land',null,'shared-source-boundary')));
function nearestPair(left,right) {
    let best=null;
    for(const a of left)for(const b of right){const distance=geo.geoDistance([a.longitude,a.latitude],[b.longitude,b.latitude]);if(!best||distance<best.distance)best={a,b,distance};}
    return best;
}
for(const crossing of World.ROUTES.filter(route=>route.type==='sea')) {
    const pair=nearestPair(territories.filter(t=>t.parentTerritoryId===crossing.from),territories.filter(t=>t.parentTerritoryId===crossing.to));
    if(pair)addRoute(pair.a.id,pair.b.id,'sea',crossing.name || 'Sea crossing','declared-game-navigation');
}
function components() {
    const remaining=new Set(byId.keys()),groups=[];
    while(remaining.size){const first=remaining.values().next().value,queue=[first],group=new Set([first]);remaining.delete(first);
        for(const id of queue)for(const next of adj.get(id))if(remaining.has(next)){remaining.delete(next);group.add(next);queue.push(next);}groups.push(group);}
    return groups.sort((a,b)=>b.size-a.size);
}
for(let groups=components();groups.length>1;groups=components()) {
    for(const group of groups.slice(1)) {
        const pair=nearestPair(territories.filter(t=>group.has(t.id)),territories.filter(t=>!group.has(t.id)));
        addRoute(pair.a.id,pair.b.id,'sea','Open-water passage','declared-game-navigation');
    }
}
routes.sort((a,b)=>a.from.localeCompare(b.from)||a.to.localeCompare(b.to));
const data={WORLD_ID:'earth-provinces-v1',SOURCE:{name:'Natural Earth 10m admin-1 states and provinces',version:'5.1.1',
    url:'https://www.naturalearthdata.com/downloads/10m-cultural-vectors/10m-admin-1-states-provinces/',downloadUrl:pinnedUrl,
    license:'Public domain',licenseUrl:'https://www.naturalearthdata.com/about/terms-of-use/',sourceSha256:sha,
    mapLabel:'Natural Earth administrative regions · timeless historical factions',
    boundaryNote:'Generalized source administrative regions from the 5.1.1 edition; not historical empire borders, current legal boundaries, or elevation data.',
    routeNote:'Land routes share source boundary arcs. Sea routes are explicit gameplay navigation links; nearest-region links keep islands playable.',
    areaNote:'Approximate spherical area from the source polygons before visual simplification; small regions rounded to at least 1 km².',
    homeNote:'Starting provinces are declared game locations within each faction’s country board homeland, not a claim about historical political boundaries.',
    simplification:{topologyQuantization:100000,retainedPointQuantile:0.07,sharedArcs:true},fallbackCountries:fallback.map(t=>t.name)},FACTIONS:factions,TERRITORIES:territories,ROUTES:routes};
const runtime=`// Generated by scripts/build-duat-provinces.cjs from pinned Natural Earth v5.1.1.\n/* global module */\n(function(root){'use strict';const data=${JSON.stringify(data)};const territories=new Map(data.TERRITORIES.map(t=>[t.id,t]));const factions=new Map(data.FACTIONS.map(f=>[f.id,f]));data.territoryById=id=>territories.get(id)||null;data.factionById=id=>factions.get(id)||null;function freeze(value){if(value&&typeof value==='object'&&!Object.isFrozen(value)){Object.values(value).forEach(freeze);Object.freeze(value);}return value;}const api=freeze(data);(root.App=root.App||{}).DuatProvinces=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;})(typeof window!=='undefined'?window:globalThis);\n`;
const destination=path.join(root,'js/duat/provinces.js');
if(process.argv.includes('--check')){if(fs.readFileSync(destination,'utf8')!==runtime)throw new Error('Province data is stale.');}else fs.writeFileSync(destination,runtime);
console.log(JSON.stringify({territories:territories.length,routes:routes.length,seaRoutes:routes.filter(r=>r.type==='sea').length,bytes:Buffer.byteLength(runtime),sha,fallbackCountries:fallback.map(t=>t.name)}));
