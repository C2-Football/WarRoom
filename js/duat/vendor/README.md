# Duat storage dependency

`lz-string-1.5.0.js` is an unmodified copy of `libs/lz-string.js` from the upstream `pieroxy/lz-string` Git tag `1.5.0`, retrieved 2026-09-08. It supplies synchronous, lossless UTF-16 compression for browser storage; campaign backup exports remain ordinary JSON. No network service is involved in compression.

- Source: https://github.com/pieroxy/lz-string/blob/1.5.0/libs/lz-string.js
- Raw source: https://raw.githubusercontent.com/pieroxy/lz-string/1.5.0/libs/lz-string.js
- License: MIT, copyright 2013 pieroxy; exact text in `lz-string-LICENSE.txt`.
- JavaScript SHA-256: `550034b821027008776cb9bcd1700bb5d31e8b3de224cb130fc966a75dab0e5e`
- License SHA-256: `433fc9dfe659dbfb1e91eed8351f13651e97bfa3ac6d03394c3d63f61d4bbc80`

The storage wrapper uses a `DUAT4:LZ16:` format prefix and a checksum to detect accidental damage, not as an authentication or anti-cheating mechanism. Existing uncompressed campaign records are still readable.
