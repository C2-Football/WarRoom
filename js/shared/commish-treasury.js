// ══════════════════════════════════════════════════════════════════
// js/shared/commish-treasury.js — window.App.Commish.Treasury
// The Treasury: dues BOOKKEEPING across the commissioner's leagues.
//
// ⚠ MONEY RULE — DHQ never handles, collects, or moves money. Ever. This
// module tracks WHO HAS BEEN MARKED PAID, nothing more. LeagueSafe (or
// wherever the league's money actually lives) stays the system of record;
// the Treasury just remembers the commissioner's bookkeeping and links out.
//
// Storage: 'commish_treasury_<leagueId>' →
//   { leagueSafeUrl: string|null, sheetUrl: string|null,
//     entries: { [userId]: { paid: bool, note: string, ts } }, updatedAt }
//
//   getLedger(leagueId)                → stored ledger (defaults filled)
//   setLeagueSafeUrl(leagueId, url)    → true/false. Only https URLs on
//       leaguesafe.com (or a subdomain, e.g. www) are stored; anything else
//       returns false and stores NOTHING. null/'' clears the link.
//   setSheetUrl(leagueId, url)         → same, host must be docs.google.com.
//   markPaid(leagueId, userId, { paid, note, nowMs }) → upserts an entry.
//   buildTreasury({ graph, leagueId, ledger }) → PURE: one row per member
//       of that league (unmarked members appear paid:false), sorted
//       unpaid-first then name, plus summary { paid, total, pct } and the
//       two links.
//   parseDuesCsv(csvText, graphPeopleOfLeague) → PURE tolerant CSV mapper:
//       finds a name-ish and a paid-ish column, matches rows to members by
//       exact display name then containment. NEVER guesses an ambiguous
//       match — a row that could be two members lands in `unmatched`.
//   applyCsv(leagueId, parsed, { nowMs }) → marks all matched, returns count.
//   fetchPublishedSheet(url) → impure: pulls the CSV a published-to-web
//       Google Sheet serves publicly (no OAuth). Cross-origin behavior
//       varies by browser/deploy, so the office ALWAYS offers paste-CSV as
//       the fallback path — this helper returning null is a normal outcome,
//       not an error state.
//
// Pure compute split from storage/fetch helpers. No Date.now() in pure
// paths — callers pass nowMs. Warroom-local (direct <script> tag),
// Node-testable via the internal Map fallback.
// ══════════════════════════════════════════════════════════════════
(function (root) {
    'use strict';
    const App = root.App = root.App || {};

    const KEY = lid => 'commish_treasury_' + lid;

    // ── Storage ──────────────────────────────────────────────────────
    // Browser: the shared DhqStorage localStorage wrapper. Node tests: an
    // in-memory Map that JSON round-trips values so it keeps localStorage's
    // exact semantics (same pattern as commish-drift.js).
    const _mem = new Map();
    const memStore = {
        get(key, fallback) { return _mem.has(key) ? JSON.parse(_mem.get(key)) : (fallback !== undefined ? fallback : null); },
        set(key, value) { _mem.set(key, JSON.stringify(value)); return true; },
    };
    function store() { return (App.DhqStorage) || memStore; }

    function getLedger(leagueId) {
        const lid = String(leagueId || '');
        const rec = store().get(KEY(lid), null) || {};
        return {
            leagueSafeUrl: rec.leagueSafeUrl || null,
            sheetUrl: rec.sheetUrl || null,
            entries: rec.entries || {},
            updatedAt: rec.updatedAt != null ? rec.updatedAt : null,
        };
    }

    // ── URL validation ───────────────────────────────────────────────
    // https only, and the host must BE the trusted domain or a subdomain of
    // it ('www.leaguesafe.com' yes, 'evilleaguesafe.com' no — a bare
    // endsWith check would wave the lookalike through).
    function parseHttps(url) {
        try {
            const u = new URL(String(url));
            return u.protocol === 'https:' ? u : null;
        } catch (e) { return null; }
    }
    function hostIs(host, domain) {
        return host === domain || host.endsWith('.' + domain);
    }

    // Shared setter: validate → store, or reject → false with NOTHING stored.
    // null/'' clears the field (that's a bookkeeping act, not a bad URL).
    function setUrlField(leagueId, url, field, domain, opts) {
        const lid = String(leagueId || '');
        if (!lid) return false;
        let value = null;
        if (url != null && String(url).trim() !== '') {
            const u = parseHttps(String(url).trim());
            if (!u || !hostIs(u.hostname, domain)) return false;
            value = String(url).trim();
        }
        const rec = getLedger(lid);
        rec[field] = value;
        rec.updatedAt = (opts && opts.nowMs != null) ? Number(opts.nowMs) : Date.now();
        store().set(KEY(lid), rec);
        return true;
    }
    function setLeagueSafeUrl(leagueId, url, opts) {
        return setUrlField(leagueId, url, 'leagueSafeUrl', 'leaguesafe.com', opts);
    }
    function setSheetUrl(leagueId, url, opts) {
        return setUrlField(leagueId, url, 'sheetUrl', 'docs.google.com', opts);
    }

    // ── Marking (storage upsert) ─────────────────────────────────────
    // Upsert one member's bookkeeping entry. Omitted fields keep their
    // previous value so "add a note" never silently un-marks someone.
    function markPaid(leagueId, userId, opts) {
        const lid = String(leagueId || '');
        const uid = String(userId != null ? userId : '');
        if (!lid || !uid) return null;
        const nowMs = (opts && opts.nowMs != null) ? Number(opts.nowMs) : Date.now();
        const rec = getLedger(lid);
        const prev = rec.entries[uid] || { paid: false, note: '', ts: null };
        const entry = {
            paid: (opts && opts.paid !== undefined) ? !!opts.paid : prev.paid,
            note: (opts && opts.note != null) ? String(opts.note) : prev.note,
            ts: nowMs,
        };
        rec.entries[uid] = entry;
        rec.updatedAt = nowMs;
        store().set(KEY(lid), rec);
        return entry;
    }

    // ── The treasury view (pure) ─────────────────────────────────────
    // One row for EVERY member of the league in the member graph — unmarked
    // members show paid:false so nobody silently falls off the books.
    function buildTreasury(opts) {
        const graph = (opts && opts.graph) || {};
        const lid = String((opts && opts.leagueId) || '');
        const ledger = (opts && opts.ledger) || {};
        const entries = ledger.entries || {};
        const people = graph.people || {};

        const rows = [];
        for (const uid of Object.keys(people)) {
            const p = people[uid];
            if (!p || !(p.leagueIds || []).includes(lid)) continue;
            const e = entries[uid];
            rows.push({
                userId: uid,
                name: p.name || 'Unknown',
                paid: !!(e && e.paid),
                note: (e && e.note) || '',
                ts: (e && e.ts != null) ? e.ts : null,
            });
        }
        rows.sort((a, b) => (a.paid === b.paid) ? a.name.localeCompare(b.name) : (a.paid ? 1 : -1));

        const paidCount = rows.filter(r => r.paid).length;
        const total = rows.length;
        return {
            rows,
            summary: { paid: paidCount, total, pct: total ? Math.round((paidCount / total) * 100) : 0 },
            leagueSafeUrl: ledger.leagueSafeUrl || null,
            sheetUrl: ledger.sheetUrl || null,
        };
    }

    // ── CSV import (pure) ────────────────────────────────────────────
    // Commissioners keep dues in wildly different spreadsheets; be tolerant
    // of theirs instead of demanding ours.
    const NAME_HEADER = /name|team|member|owner/i;
    const PAID_HEADER = /paid|status|dues/i;
    const PAID_TRUTHY = /^(paid|yes|y|true|x|✓|1|\$?\d+(\.\d+)?)$/i;

    // Minimal quoted-field CSV splitter ("Smith, John" stays one cell).
    function splitCsvLine(line) {
        const out = [];
        let cur = '', inQ = false;
        for (let i = 0; i < line.length; i++) {
            const ch = line[i];
            if (inQ) {
                if (ch === '"') {
                    if (line[i + 1] === '"') { cur += '"'; i++; } else inQ = false;
                } else cur += ch;
            } else if (ch === '"') inQ = true;
            else if (ch === ',') { out.push(cur); cur = ''; }
            else cur += ch;
        }
        out.push(cur);
        return out.map(s => s.trim());
    }

    // Candidate members for a CSV name: exact display-name match first
    // (case-insensitive), else containment in either direction. The CALLER
    // decides what to do with 0 or 2+ candidates — this never guesses.
    function candidatesFor(rawName, people) {
        const lower = String(rawName || '').trim().toLowerCase();
        if (!lower) return [];
        const exact = people.filter(p => String(p.name || '').toLowerCase() === lower);
        if (exact.length) return exact;
        return people.filter(p => {
            const mn = String(p.name || '').toLowerCase();
            return mn && (lower.includes(mn) || mn.includes(lower));
        });
    }

    function parseDuesCsv(csvText, graphPeopleOfLeague) {
        const people = Array.isArray(graphPeopleOfLeague)
            ? graphPeopleOfLeague
            : Object.values(graphPeopleOfLeague || {});
        const lines = String(csvText || '').split(/\r\n|\r|\n/).filter(l => l.trim() !== '');
        const matched = [];
        const unmatched = [];

        // Header detection: a first row with a name-ish or paid-ish label is
        // a header — UNLESS its name cell already resolves to a member, in
        // which case it's data (a headerless "Jake,paid" row must not be
        // eaten as a header just because a cell literally says "paid").
        let nameCol = 0, paidCol = 1, start = 0;
        if (lines.length) {
            const head = splitCsvLine(lines[0]);
            const nIdx = head.findIndex(h => NAME_HEADER.test(h));
            const pIdx = head.findIndex(h => PAID_HEADER.test(h));
            const headNameCell = head[nIdx >= 0 ? nIdx : 0];
            if ((nIdx >= 0 || pIdx >= 0) && candidatesFor(headNameCell, people).length === 0) {
                start = 1;
                if (nIdx >= 0) nameCol = nIdx;
                if (pIdx >= 0) paidCol = pIdx;
            }
        }

        for (let i = start; i < lines.length; i++) {
            const cells = splitCsvLine(lines[i]);
            const rawName = (cells[nameCol] || '').trim();
            if (!rawName) continue;
            const rawPaid = (cells[paidCol] != null ? cells[paidCol] : '').trim();
            const cands = candidatesFor(rawName, people);
            if (cands.length === 1) {
                matched.push({
                    userId: cands[0].userId,
                    name: cands[0].name,
                    paid: PAID_TRUTHY.test(rawPaid),
                    note: rawPaid,
                });
            } else {
                // 0 = unknown, 2+ = ambiguous. Either way: never guess.
                unmatched.push(rawName);
            }
        }
        return { matched, unmatched, headerUsed: { nameCol, paidCol } };
    }

    // Write every matched row into the ledger. Returns how many were marked.
    function applyCsv(leagueId, parsed, opts) {
        const list = (parsed && parsed.matched) || [];
        let count = 0;
        for (const m of list) {
            if (!m || m.userId == null) continue;
            if (markPaid(leagueId, m.userId, { paid: m.paid, note: m.note, nowMs: opts && opts.nowMs })) count++;
        }
        return count;
    }

    // ── Published-sheet fetch (impure helper) ────────────────────────
    // Published-to-web Google Sheets serve CSV publicly — no OAuth. Only
    // docs.google.com https URLs are ever fetched. Returns the text, or
    // null on ANY failure (bad host, network, CORS, non-200) — the office
    // falls back to paste-CSV, so null is routine.
    async function fetchPublishedSheet(url) {
        const u = parseHttps(url);
        if (!u || u.hostname !== 'docs.google.com') return null;
        let target = u.href;
        if (target.indexOf('output=csv') === -1 && /\/(pub|export)(\/|$)/.test(u.pathname)) {
            u.searchParams.set('output', 'csv');
            target = u.href;
        }
        try {
            const fetchFn = root.fetch;
            if (typeof fetchFn !== 'function') return null;
            const res = await fetchFn(target);
            if (!res || !res.ok) return null;
            return await res.text();
        } catch (e) { return null; }
    }

    App.Commish = App.Commish || {};
    App.Commish.Treasury = {
        getLedger, setLeagueSafeUrl, setSheetUrl, markPaid,
        buildTreasury, parseDuesCsv, applyCsv, fetchPublishedSheet,
        _mem,
    };
    /* global module */
    if (typeof module !== 'undefined' && module.exports) module.exports = App.Commish.Treasury;
})(typeof window !== 'undefined' ? window : globalThis);
