# Duat province geography

`js/duat/provinces.js` is generated from [Natural Earth 10m admin-1 states and provinces, edition 5.1.1](https://www.naturalearthdata.com/downloads/10m-cultural-vectors/10m-admin-1-states-provinces/). Natural Earth data is [public domain](https://www.naturalearthdata.com/about/terms-of-use/). The pinned input is the project's [5.1.1 GeoJSON](https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.1/geojson/ne_10m_admin_1_states_provinces.geojson), SHA-256 `22d0e3ad85eb3e27f17cabf8ba2d50e554fbc27a87796ff891d958185da62fb5`.

The playing board contains 4,594 source administrative regions, excluding Antarctica. The regions are generalized modern administrative geography from that source edition, not historical empire borders, a current legal boundary authority, or elevation data. Administrative names can reflect the source's older snapshot. Unnamed source features are labeled as unnamed regions instead of inventing local names.

The build preserves shared boundary topology, quantizes at 100,000 units and retains roughly the most significant 7% of finite-weight points, plus required arc endpoints. Ring orientation is normalized per polygon before and after simplification to prevent a small island from rendering a globe-sized complement. The same polygons generate the 1,000×500 equirectangular SVG paths. Approximate area uses unsimplified spherical source polygons with mean Earth radius 6,371.0088 km, rounded to the nearest km² with a minimum of one. The resulting global board area is approximately 134.46 million km². There is no terrain or elevation inference.

The static atlas has 10,764 shared-boundary land routes and 350 declared game navigation links. Natural Earth shared arcs determine land adjacency. Named crossings inherited from the country game and nearest-component navigation links keep islands and isolated regions accessible. A navigation link is a game rule, not a claim that two regions share a boundary or that a historical route existed there.

Province **combat** campaigns additionally start every faction with three contiguous provinces and link the outer fronts of each selected faction to its two closest selected rivals. These state-specific routes have `origin: 'declared-campaign-passage'`; `Conquest.catalogFor(state)` includes them. They are explicitly labeled campaign passages in the game. Capitals remain protected. This adaptation creates contested fronts in the opening season instead of requiring dozens of country-scale steps to reach a rival. Province **Original conquest** campaigns retain one-region starts and blocked-frontier score wars. All pre-expansion country campaigns retain their existing behavior.

The source map workbook's cross-map rule leaves interactions incomplete. The Original software adaptation permits first place to spend one earned claim on a declared sea route from an owned endpoint; tied weekly scores hold for the defender. A weekly opportunity funds either a neutral claim or a score war and expires when the next week's result arrives. In a top-half confrontation, the defender also loses one unspent claim opportunity when available; a previously spent claim is not rewound. These are explicit software completions, not quotations from a fully specified source rule.

## Rebuild

Use Node with build-only packages `d3-geo@3.1.1`, `topojson-server@3.0.1`, `topojson-client@3.1.0`, and `topojson-simplify@3.0.3`. The runtime has no package dependency. Download the pinned GeoJSON to a working directory, then run:

```sh
node scripts/build-duat-provinces.cjs --source=/absolute/path/ne_10m_admin_1_states_provinces.geojson --source-dir=/absolute/path/build/node_modules
```

Repeat with `--check` to verify deterministic output. The browser/global export is `App.DuatProvinces`; CommonJS may require the file directly. `WORLD_ID` is `earth-provinces-v1`. Existing country geography remains `App.DuatWorld`.
