# Vault helmet artwork

These are complete, unmodified SVG downloads by their credited artists. The app renders the whole artwork, including its original paths, masks, gradients, hardware, transforms and layer order.

| File | Artist and source | License |
| --- | --- | --- |
| `cyberscooty.svg` | [cyberscooty — American Football Helmet](https://openclipart.org/detail/212653/american-football-helmet) | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) |
| `simanek.svg` | [Simanek — Football Helmet](https://commons.wikimedia.org/wiki/File:FootballHelmet.svg), [original Openclipart entry](https://openclipart.org/detail/86827/football-helmet) | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) |

The [Openclipart licensing FAQ](https://openclipart.org/share) permits modification and commercial reuse. Original download URLs, sizes and SHA-256 checksums are recorded in `manifest.json`.

## Rendering

Original artwork uses the source file directly. Team colors replace only explicitly mapped fill or gradient-stop color values on existing elements. All source geometry and other SVG content are retained. No shell, mask, visor, logo or paint shape is reconstructed or overlaid.

`node scripts/build-time-league-helmet-sources.cjs` packages the exact source text for color previews in the direct-file app, where fetching SVG files at runtime would be blocked by browser origin rules. The generated module is checked in. `--check` verifies that the bundle is current and the source checksums match.
