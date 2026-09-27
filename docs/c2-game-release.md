# C2 game release preparation

The manual backend workflow releases only games named in one committed reviewed
manifest. A normal push validates and cannot deploy. Database migrations use a
separate reviewed process; this workflow never applies SQL.

Use the official **Node 20.20.2** binary, which bundles **zlib 1.3.1-e00f703**, for
manifest preparation and runtime builds. CI uses that exact Node release. A
different Node or zlib can emit different compressed bytes for identical game
data, so `prepare` rejects other toolchains before building or contacting the
host. Both builders normalize gzip's OS byte to 255 (unknown), allowing macOS
and Linux to produce the same artifacts with the pinned compressor.

The npm-distributed official binary can be placed first in `PATH` for one
preparation command without changing the user's default Node:

```sh
release_node=$(npx --yes node@20.20.2 -p 'process.execPath')
PATH="$(dirname "$release_node"):$PATH" python3 scripts/c2-edge-release.py prepare \
  --head <exact-candidate-commit> --base <reviewed-released-base-commit> \
  --functions duat,time-league --manifest .github/c2-releases/<new-name>.json
```

Commit all intended source changes before preparing. Preparation rebuilds the
selected runtimes, records exact candidate/build-input and generated-byte
hashes, and reads complete hosted source/version and schema evidence. Review
the new manifest, commit it without changing other source, and run `plan` at
that final commit before dispatching the manual workflow. Keep the same pinned
Node first in `PATH` for any intervening runtime builds.

Hosted source inspection first uses Supabase's API download. If Vault's large
bundle cannot be unbundled by the API, the strict read-only ESZIP parser recovers
its original source in a fresh directory. Source inspection never uses Docker;
the Vault deployment itself still uses Docker. Complete dependency closure and
before/after hosted version checks apply to either download path.

Run `npm run test:c2-release` with the pinned Node to check the release boundary
and both actual builders' platform-neutral gzip outputs. The artifact test
simulates the Linux and Darwin gzip headers in memory, compares the complete
generated modules, and roundtrips every embedded data block without writing
runtime files. It does not substitute for CI's exact generated-hash gate.

If that gate reports a mismatch, stop. Diagnose the toolchain or source change,
rebuild, and prepare a **new** reviewed manifest. Never replace an expected hash
with an unreviewed CI value or weaken source, closure, schema, or version checks.
