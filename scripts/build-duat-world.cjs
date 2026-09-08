'use strict';
// Rebuild with the already installed geography packages, for example:
// node scripts/build-duat-world.cjs --source-dir="/path/to/The Duat/node_modules"
// Source inputs are read-only. The generated runtime has no package dependency.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const sourceDir = process.argv.find(arg => arg.startsWith('--source-dir='))?.slice('--source-dir='.length);
const resolveSource = name => sourceDir ? require.resolve(path.join(sourceDir, name)) : require.resolve(name);
const topo = require(resolveSource('topojson-client'));
const geo = require(resolveSource('d3-geo'));
const atlasPath = resolveSource('world-atlas/countries-110m.json');
const atlasBytes = fs.readFileSync(atlasPath);
const atlas = JSON.parse(atlasBytes);
const Rules = require(path.join(root, 'js/duat/rules.js'));

// This is a contemporary geographic strategy board for Duat's timeless
// factions. Country boundaries are NOT presented as historical empire borders.
const aliases = {
    '368': 'two-rivers', '818': 'nile-delta', '380': 'latium', '300': 'aegean',
    '578': 'scandinavia', '372': 'ireland', '788': 'carthage', '729': 'upper-nile',
    '156': 'yellow-river', '392': 'yamato', '356': 'ganges', '348': 'pannonia',
    '320': 'maya-lowlands', '250': 'gaul', '826': 'albion', '724': 'iberia',
    '276': 'germania', '100': 'balkans', '012': 'maghreb', '434': 'sahara',
    '231': 'aksum', '706': 'horn-africa', '792': 'anatolia', '760': 'levant',
    '364': 'persia', '804': 'pontic-steppe', '860': 'central-asia', '586': 'indus',
    '764': 'southeast-asia', '410': 'korea', '643': 'siberia', '124': 'vinland',
    '484': 'mexico', '604': 'andes', '076': 'brazil', '784': 'gulf-states',
};
const names = {
    '732': 'Western Sahara', '840': 'United States', '180': 'Democratic Republic of the Congo',
    '214': 'Dominican Republic', '238': 'Falkland Islands', '140': 'Central African Republic',
    '178': 'Republic of the Congo', '226': 'Equatorial Guinea', '748': 'Eswatini',
    '090': 'Solomon Islands', '807': 'North Macedonia', '070': 'Bosnia and Herzegovina', '728': 'South Sudan',
};
const newFactions = [
    ['persia', 'Persia', 'Iranian Plateau', 'Persian', 'The royal road endures', '𐎠', '#bf6647', 'Asia', '364'],
    ['mongols', 'Mongols', 'The Eternal Steppe', 'Mongol', 'Ride beyond the horizon', 'ᠮ', '#719db8', 'Asia', '496'],
    ['korea', 'Korea', 'The Eastern Peninsula', 'Korean', 'Guard the mountain gates', '韓', '#db82b8', 'Asia', '410'],
    ['khmer', 'Khmer Empire', 'The Angkor Plain', 'Khmer', 'The waters sustain the realm', 'អ', '#97ba53', 'Asia', '116'],
    ['siam', 'Siam', 'The Chao Phraya', 'Siamese', 'Hold the river cities', 'ช', '#ae8be4', 'Asia', '764'],
    ['majapahit', 'Majapahit', 'The Java Sea', 'Javanese', 'Across the island roads', 'ꦩ', '#da9460', 'Asia', '360'],
    ['aztecs', 'Aztecs', 'The Valley of Mexico', 'Mexica', 'Raise the city above the lake', '☀', '#3abca7', 'Americas', '484'],
    ['inca', 'Inca', 'The Four Quarters', 'Inca', 'The mountain road unites us', '✺', '#c9aa40', 'Americas', '604'],
    ['mali', 'Mali', 'The Niger Bend', 'Malian', 'Gold follows the river', '◆', '#c58a44', 'Africa', '466'],
    ['aksum', 'Aksum', 'The Red Sea Crown', 'Aksumite', 'Hold the highland crown', '✚', '#c47469', 'Africa', '231'],
    ['zulu', 'Zulu', 'The Southern Grasslands', 'Zulu', 'Stand together on the field', '◈', '#789f83', 'Africa', '710'],
    ['england', 'England', 'The Island Kingdom', 'English', 'Guard the crossing seas', '♜', '#c95362', 'Europe', '826'],
    ['poland', 'Poland', 'The Vistula Plain', 'Polish', 'The eagle keeps the watch', '♕', '#e4a8a0', 'Europe', '616'],
    ['portugal', 'Portugal', 'The Atlantic Coast', 'Portuguese', 'The ocean opens the road', '⚓', '#61ab95', 'Europe', '620'],
];
const codeSet = value => new Set(value.split(' '));
const africa = codeSet('834 732 180 706 404 729 148 710 426 716 072 516 686 466 478 204 562 566 120 768 288 384 324 624 430 694 854 140 178 266 226 894 454 508 748 024 108 450 270 788 012 232 504 818 434 231 262 800 646 728');
const europe = codeSet('578 250 752 112 804 616 040 348 498 642 440 428 233 276 100 300 008 191 756 442 056 528 620 724 372 380 208 826 352 705 246 703 203 070 807 688 499 643');
const americas = codeSet('124 840 032 152 332 214 044 238 304 484 858 076 068 604 170 591 188 558 340 222 320 084 862 328 740 218 630 388 192 600 780');
const oceania = codeSet('242 598 548 540 090 554 036');
const regionOf = feature => africa.has(feature.id) || feature.properties.name === 'Somaliland' ? 'Africa'
    : europe.has(feature.id) || feature.properties.name === 'Kosovo' ? 'Europe'
        : americas.has(feature.id) ? 'Americas' : oceania.has(feature.id) ? 'Oceania' : 'Asia';
const slug = name => name.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const geometries = atlas.objects.countries.geometries.filter(item => !['010', '260'].includes(item.id));
const projection = geo.geoEquirectangular().scale(1000 / (2 * Math.PI)).translate([500, 250]);
const pathFor = geo.geoPath(projection).digits(2);
const territories = geometries.map(geometry => {
    const feature = topo.feature(atlas, geometry), center = geo.geoCentroid(feature);
    return {
        id: aliases[feature.id] || slug(feature.properties.name),
        name: names[feature.id] || feature.properties.name,
        subtitle: 'Geographic territory', countryCode: feature.id || null,
        longitude: Math.round(center[0] * 10000) / 10000, latitude: Math.round(center[1] * 10000) / 10000,
        region: regionOf(feature), areaKm2: Math.round(geo.geoArea(feature) * 6371.0088 ** 2),
        geometry: feature.geometry, path: pathFor(feature),
    };
});
const byCode = new Map(territories.filter(item => item.countryCode).map(item => [item.countryCode, item]));
const factions = [...Rules.FACTIONS.map(faction => ({ ...faction })), ...newFactions.map(([id, name, realm, culture, motto, sigil, color, region, code]) => ({
    id, name, realm, culture, motto, sigil, color, secondaryColor: '#dcc997', region,
    anchorFactionId: id, homeTerritoryId: byCode.get(code).id,
}))];
for (const faction of factions) {
    const home = territories.find(item => item.id === faction.homeTerritoryId);
    if (!home || home.homelandOf) throw new Error('Missing or duplicate homeland for ' + faction.id);
    home.homelandOf = faction.id;
}
const routes = [], routeIds = new Set();
function addRoute(from, to, type, name) {
    const key = [from, to].sort().join(':');
    if (from === to || routeIds.has(key)) return;
    routeIds.add(key); routes.push({ from, to, type, ...(name ? { name } : {}) });
}
topo.neighbors(geometries).forEach((neighbors, index) => neighbors.forEach(other => {
    addRoute(territories[index].id, territories[other].id, 'land');
}));
// These are explicitly gameplay navigation routes across real bodies of water,
// not claims that every timeless faction used a particular historical route.
const seaCrossings = [
    ['826', '372', 'Irish Sea'], ['826', '250', 'English Channel'], ['826', '578', 'North Sea'],
    ['826', '352', 'North Atlantic'], ['352', '304', 'Denmark Strait'], ['304', '124', 'Davis Strait'],
    ['724', '504', 'Strait of Gibraltar'], ['380', '788', 'Sicily Channel'], ['300', '818', 'Eastern Mediterranean'],
    ['262', '887', 'Bab el-Mandeb'], ['450', '508', 'Mozambique Channel'], ['356', '144', 'Palk Strait'],
    ['392', '410', 'Korea Strait'], ['158', '156', 'Taiwan Strait'], ['608', '158', 'Luzon Strait'],
    ['608', '458', 'Sulu Sea'], ['360', '458', 'Strait of Malacca'], ['360', '598', 'Arafura passage'],
    ['360', '036', 'Timor Sea'], ['036', '554', 'Tasman Sea'], ['554', '242', 'South Pacific'],
    ['242', '548', 'South Pacific'], ['548', '090', 'Coral Sea'], ['090', '598', 'Solomon Sea'],
    ['036', '540', 'Coral Sea'], ['840', '192', 'Florida Strait'], ['840', '044', 'Gulf Stream'],
    ['192', '388', 'Caribbean Sea'], ['192', '332', 'Windward Passage'], ['214', '630', 'Mona Passage'],
    ['780', '862', 'Gulf of Paria'], ['238', '032', 'South Atlantic'], ['076', '686', 'Atlantic crossing'],
    ['196', '792', 'Eastern Mediterranean'], ['729', '682', 'Red Sea'],
];
for (const [left, right, name] of seaCrossings) addRoute(byCode.get(left).id, byCode.get(right).id, 'sea', name);
// Connect any remaining isolated island component with its shortest geographic
// navigation link. This is a declared game rule; no invented land bridge.
function components() {
    const remaining = new Set(territories.map(item => item.id)), groups = [];
    while (remaining.size) {
        const group = new Set([remaining.values().next().value]), queue = [...group];
        for (const id of queue) for (const route of routes) {
            const next = route.from === id ? route.to : route.to === id ? route.from : null;
            if (next && !group.has(next)) { group.add(next); queue.push(next); }
        }
        group.forEach(id => remaining.delete(id)); groups.push(group);
    }
    return groups;
}
for (let groups = components(); groups.length > 1; groups = components()) {
    const group = groups[0]; let nearest;
    for (const left of territories.filter(item => group.has(item.id))) for (const right of territories.filter(item => !group.has(item.id))) {
        const distance = geo.geoDistance([left.longitude, left.latitude], [right.longitude, right.latitude]);
        if (!nearest || distance < nearest.distance) nearest = { left, right, distance };
    }
    addRoute(nearest.left.id, nearest.right.id, 'sea', 'Open-water passage');
}
routes.sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to));
const world = {
    WORLD_ID: 'earth-countries-v1',
    SOURCE: {
        name: 'Natural Earth / world-atlas countries-110m', url: 'https://github.com/topojson/world-atlas',
        license: 'ISC; underlying Natural Earth geography is public domain',
        sourceSha256: crypto.createHash('sha256').update(atlasBytes).digest('hex'),
        worldAtlasVersion: JSON.parse(fs.readFileSync(resolveSource('world-atlas/package.json'), 'utf8')).version,
        mapLabel: 'Modern geographic board · timeless historical factions',
        boundaryNote: 'Source country boundaries are geographic playing regions, not historical empire borders or a statement on disputed sovereignty.',
        routeNote: 'Land routes share Natural Earth boundary arcs. Sea routes are game navigation connections.',
        areaNote: 'Approximate spherical land area derived from the generalized 1:110m country polygons.',
    },
    FACTIONS: factions, TERRITORIES: territories, ROUTES: routes,
};
const runtime = `// Generated by scripts/build-duat-world.cjs. Do not hand-edit geometry.
/* global module */
(function(root){
    'use strict';
    const world=${JSON.stringify(world)};
    function freeze(value){if(value&&typeof value==='object'&&!Object.isFrozen(value)){Object.values(value).forEach(freeze);Object.freeze(value);}return value;}
    const territories=new Map(world.TERRITORIES.map(item=>[item.id,item]));
    const factions=new Map(world.FACTIONS.map(item=>[item.id,item]));
    world.territoryById=id=>territories.get(id)||null;
    world.factionById=id=>factions.get(id)||null;
    const api=freeze(world);(root.App=root.App||{}).DuatWorld=api;
    if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
`;
const destination = path.join(root, 'js/duat/world.js');
if (process.argv.includes('--check')) {
    if (fs.readFileSync(destination, 'utf8') !== runtime) throw new Error('World runtime is stale. Rebuild from the documented geography inputs.');
} else fs.writeFileSync(destination, runtime);
console.log(JSON.stringify({ factions: factions.length, territories: territories.length, routes: routes.length, bytes: Buffer.byteLength(runtime), sourceSha256: world.SOURCE.sourceSha256 }));
