# Final-candidate diagnostics before the focus-reveal fix

Chromium passed 320px, then 390px failed a real full-heading visibility check. Season Setup remained at x129..241 while the pinned league column ended at x173, including after a 2-second native-scroll settling window. The harness never scrolls or reveals the reverse-focused target. This requires a source fix.

WebKit completed all eight portrait-iPad journeys, then failed the unchanged zero-page-error assertion because an unrelated live `gm_strategy` GET hit a CORS error. The fixture now returns a valid empty account result for this read. This is fixture isolation, not suppression of page errors.

Both full-matrix attempts closed their browser contexts and exited 1. Their logs and result JSON are retained here; neither is final acceptance. A preceding WebKit 3 run passed all task and two-context scenarios and is retained separately under `sync-webkit-pre-teardown-log`.
