# Historical Duat assets

`nflverse-game-logs.csv` and `player-cards.json` contain 127,055 real weekly
QB/RB/WR/TE records and 3,271 distinct player identities, 2002–2025, NFL regular
season weeks 1–17. `manifest.json` records source URLs, SHA-256 hashes, coverage,
identity aliases and scoring. Data is from nflverse under CC BY 4.0; attribution
is displayed in the game. Week 18 and NFL postseason games are excluded. A
missing player record in a covered week scores zero, without diagnosing its cause.

Regenerate with `python3 scripts/build-duat-data.py --cache-dir <download-cache>`.
The builder downloads missing nflverse release files and rejects incomplete weeks
or colliding player identities. It does not change the Vault's archive.

`land.svg` comes from Natural Earth 4.1.0 land boundaries at 1:110m, distributed by
world-atlas 2.0.2 (https://github.com/topojson/world-atlas). It uses an equirectangular
projection with correct antimeridian clipping. Geography is real; territory nodes
and routes are the original Duat game catalog. It does not represent elevation.

Optional regeneration: `node scripts/build-duat-map.cjs <node_modules-directory>`
using an existing directory containing world-atlas@2, topojson-client and d3-geo.
These packages are only asset-building tools and are not runtime dependencies.
