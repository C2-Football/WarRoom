#!/usr/bin/env node
// Optional asset regeneration. Pass a directory containing world-atlas,
// topojson-client and d3-geo; these are not required by the deployed game.
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
async function main() {
    const modules = process.argv[2];
    if (!modules) throw new Error('Pass the path to a node_modules directory with world-atlas@2, topojson-client and d3-geo.');
    const resolve = name => require.resolve(name, { paths: [path.resolve(modules)] });
    const { feature } = await import(pathToFileURL(resolve('topojson-client')).href);
    const { geoEquirectangular, geoPath } = await import(pathToFileURL(resolve('d3-geo')).href);
    const topology = JSON.parse(fs.readFileSync(resolve('world-atlas/land-110m.json'), 'utf8'));
    // Spherical projection clips land at the antimeridian; raw longitude paths
    // draw false horizontal lines across Eurasia and Antarctica.
    const projection = geoEquirectangular().scale(1000 / (2 * Math.PI)).translate([500, 250]);
    const d = geoPath(projection)(feature(topology, topology.objects.land));
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 500"><title>Natural Earth land boundaries</title><path fill="#223636" stroke="#365250" stroke-width=".6" d="' + d + '"/></svg>\n';
    fs.writeFileSync(path.resolve(__dirname, '../data/duat/land.svg'), svg);
    console.log('Built Duat map from Natural Earth 1:110m land geometry.');
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
