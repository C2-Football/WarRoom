# Fragment contract — DHQ module gallery screens

Each screen is ONE file at `mockups/_gallery/screens/scr-<slug>.html`. It is
concatenated into the viewer by `assemble.cjs`, which HARD-FAILS on any
violation below.

## Structure (mandatory)

```html
<section class="screen" id="scr-<slug>" data-title="..." data-nav="<tab>" data-group="...">
  <div class="phone-only">
    ...iPhone layout (390px frame; viewer renders status bar, league header,
       and PhoneDock around you — do NOT render those)...
  </div>
  <div class="tablet-only">
    ...iPad layout = the DESKTOP module layout at 940px content width
       (viewer renders the 240px desktop sidebar next to you — do NOT
       render a sidebar). Start with <div class="gv-mh">MODULE NAME</div>
       + <span class="gv-mmeta">context</span>...
  </div>
  <div class="notes">
    <div class="note"><b>IMPL CONTRACT</b> — which shipped primitives the real
    module composes (WR.Sheet config, WR.AssetRow slots, seg items, ActionBar
    content), and any intentional delta from current code.</div>
    <div class="note">...design rationale notes (1-3 more)...</div>
  </div>
</section>
```

## Hard rules

1. NO `<script>` or `<style>` tags. Styling = the design-system classes +
   inline `style=""` only.
2. Every `id` inside the fragment must be prefixed `scr-<slug>-`. Avoid ids
   entirely unless necessary.
3. Data comes from `canon.json` ONLY. No lorem, no invented players, no
   values off the DHQ scale (7000+ = elite). Dollar amounts like `$37` are
   fine (assembly uses function replacers).
4. Text floor 11px (`--text-micro`). Uppercase micro-labels are mono with
   letter-spacing. Numbers are always JetBrains Mono.
5. Gold = structure/active/decision accents ONLY. Tables/rows stay calm
   monochrome. One CTA per hero. Semantic color only on the one decision
   column/chip per row.
6. Free/Pro: where a surface is Pro-gated in the real app, show the Pro state
   and add a `.note` naming the gate — do not design new paywalls.
7. Annotate load-bearing elements with `data-spec="short label"` (dashed
   outline when annotations are on).

## Component library (design-system.css)

- Hero: `.gv-hero` > `.gv-kick` + `.gv-head` + `.gv-facts` + `.gv-cta`
  (`.gv-cta.ghost` for secondary)
- KPI snap strip: `.gv-kpis` > `.gv-kpi` (`.l`/`.v`/`.d`)
- Segmented sub-nav: `.gv-seg` > `<span>` (+`.on`)
- Group divider: `.gv-gdiv`
- Asset row: `.gv-row` (+`.hot` gold / `.risk` amber) > `.gv-pos.(qb|rb|wr|te|pk|df)`
  + `<div>` with `.gv-nm`/`.gv-tag` + `.gv-slots` > `.gv-slot` (`.l`/`.v`)
  + `.gv-chip.(g|w|b|i|au|p)` + `.gv-chev` (›)
- Filter pills: `.gv-pills` > `.gv-pill` (gold value inside `<b>`)
- Cards: `.gv-card` (+`.ins` gold left rule) > `.gv-body`
- Meters: `.gv-drow` > `.dl` + `.gv-bar > i` + `.dv`; standalone `.gv-bar`
- Action bar: `.gv-abar` (sticky above dock) — put `<span class="go">… ▸</span>` last
- Sheet (open overlay): `.gv-scrim` > `.dimmed` (background content) then
  `.gv-sheet` > `.gv-grab` (> `.gv-sheet-title` + `.gv-sheet-x` ✕) + `.gv-sheet-body`
- Sticky-col table: `.gv-stw` > `table.gv-st` (first col sticks)
- Tablet: `.gv-mh`, `.gv-mmeta`, `.gv-cols` (set `grid-template-columns`
  inline, use `minmax(0,1fr)`), `.gv-panel` > `.gv-ptitle`,
  `.gv-tblh`/`.gv-tblr` (set `grid-template-columns` inline; `.p` = player name),
  `.product-card`
- Text utils: `.mono .rj .gl .up .dn .wn .inf .mu`

## Voice

Alex copy is terse scouting-report register: active voice, specific, one
thought per line ("Counter with McConkey out, 2027 2nd in."). Never templated
filler. UI labels UPPERCASE mono; body copy DM Sans sentence case.
