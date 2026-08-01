// ══════════════════════════════════════════════════════════════════
// js/shared/commish-bylaws.js — window.App.Commish.Bylaws
// The Bylaws Desk: the league constitution as a LIVING document, not a dead
// PDF. Pure structural parsing of pasted constitution text into addressable
// clauses, dependency-free ranked search over them, a grounded context block
// for one-shot AI ruling cards (the office feeds it to AlexVoice.enhance —
// this module only builds the string), and an amendment ledger so Drift
// acknowledgments become constitutional history.
//
//   parseClauses(docText)
//     → [{ id ('art-1' | 'art-1.2' | 'sec-3' | slug…), heading, body, index }]
//       PURE. Splits on constitution-style headings (ARTICLE/SECTION/RULE,
//       numbered '1.' / '1.2)', Roman 'IV.', ALL-CAPS lines ≤ 60 chars,
//       markdown #/##). Body = verbatim text until the next heading. Text
//       before the first heading becomes a 'preamble' clause. No headings at
//       all → single { id:'doc', heading:'Constitution', body: fullText }.
//   searchClauses(clauses, query)
//     → ranked [{ clause, score, snippet }] — tokenized term frequency,
//       heading hits ×3 + body hits; snippet = ±120 chars around the best
//       body hit. Empty query or no hits → [].
//   buildRulingContext({ clauses, question, matches })
//     → compact string: question + top 3 matched clauses verbatim with ids,
//       framed with the never-invent instruction. matches optional (derived
//       from clauses+question when absent).
//   recordAmendment(leagueId, { path, from, to, note, source, nowMs })
//     → appends { ts, path, from, to, note, source } to amendments[] (cap
//       100) under 'commish_bylaws_<leagueId>'. source: 'drift_ack'|'manual'.
//   amendments(leagueId) → past amendments, newest first.
//
// HARD RULE: DHQ never handles, collects, or moves money. Constitutions
// routinely talk about dues and payouts — this desk QUOTES and searches that
// text as bookkeeping/reference only ("who has marked paid" lives elsewhere,
// also as bookkeeping). Nothing here executes, requests, or moves a payment.
//
// Pure compute split from storage; no fetches. No Date.now() on pure paths —
// callers pass nowMs. Warroom-local (direct <script> tag), Node-testable.
// ══════════════════════════════════════════════════════════════════
(function (root) {
    'use strict';
    const App = root.App = root.App || {};

    const KEY = lid => 'commish_bylaws_' + lid;
    const AMEND_CAP = 100;
    const SNIPPET_PAD = 120;      // chars either side of the best hit
    const CLAUSE_QUOTE_CAP = 800; // per-clause cap inside the ruling context

    // The grounding instruction every ruling card is framed with. The AI must
    // never fill constitutional silence with an invented rule.
    const RULING_INSTRUCTION = 'answer ONLY from the quoted clauses; when they are silent, say the constitution is silent — never invent a rule.';

    // ── Storage ──────────────────────────────────────────────────────
    // Browser: the shared DhqStorage localStorage wrapper. Node tests: an
    // in-memory Map that JSON round-trips values so it keeps localStorage's
    // exact semantics — undefined leaves dropped, no aliasing between gets.
    const _mem = new Map();
    const memStore = {
        get(key, fallback) { return _mem.has(key) ? JSON.parse(_mem.get(key)) : (fallback !== undefined ? fallback : null); },
        set(key, value) { _mem.set(key, JSON.stringify(value)); return true; },
    };
    function store() { return (App.DhqStorage) || memStore; }

    // ── Parsing (pure) ───────────────────────────────────────────────
    // Constitution headings, per line: keyword headings, numbered ('1.',
    // '1.2)'), Roman ('IV.'), markdown #/##, or a short ALL-CAPS line.
    const KEYWORD_RE = /^(ARTICLE|SECTION|RULE|\d+(?:\.\d+)*[.)]|[IVXLC]+[.)])\s/i;
    const MD_RE = /^#{1,6}\s+\S/;

    function isAllCapsHeading(line) {
        if (line.length > 60) return false;
        const letters = line.replace(/[^A-Za-z]/g, '');
        // Needs real words in caps — a bare "IV" or "PPR:" line is too thin
        // to promote; the numbered/keyword regexes catch real Roman headings.
        if (letters.length < 3) return false;
        return letters === letters.toUpperCase();
    }

    function isHeading(line) {
        const t = line.trim();
        if (!t) return false;
        return KEYWORD_RE.test(t) || MD_RE.test(t) || isAllCapsHeading(t);
    }

    function romanToInt(s) {
        const vals = { i: 1, v: 5, x: 10, l: 50, c: 100 };
        let out = 0;
        const low = s.toLowerCase();
        for (let i = 0; i < low.length; i++) {
            const cur = vals[low[i]] || 0;
            const nxt = vals[low[i + 1]] || 0;
            out += cur < nxt ? -cur : cur;
        }
        return out;
    }

    // 'ARTICLE IV — Trades' → 'art-4'; 'Section 1.2: Vetoes' → 'sec-1.2';
    // '3) Waivers' → 'sec-3'; 'DUES AND PAYOUTS' → 'dues-and-payouts'.
    function clauseId(heading, ordinal) {
        const h = heading.trim();
        let m = h.match(/^(article|section|rule)\s+([ivxlc]+|\d+(?:\.\d+)*)/i);
        if (m) {
            const prefix = { article: 'art', section: 'sec', rule: 'rule' }[m[1].toLowerCase()];
            const num = /^\d/.test(m[2]) ? m[2] : String(romanToInt(m[2]));
            return prefix + '-' + num;
        }
        m = h.match(/^(\d+(?:\.\d+)*)[.)]/);
        if (m) return 'sec-' + m[1];
        m = h.match(/^([ivxlc]+)[.)]/i);
        if (m) return 'sec-' + romanToInt(m[1]);
        const slug = h.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32).replace(/-+$/, '');
        return slug || ('h-' + ordinal);
    }

    // Collapse internal whitespace in a heading; strip markdown hashes.
    function cleanHeading(line) {
        return line.trim().replace(/^#{1,6}\s+/, '').replace(/\s+/g, ' ').trim();
    }

    function parseClauses(docText) {
        const text = String(docText == null ? '' : docText).replace(/\r\n?/g, '\n');
        if (!text.trim()) return [];
        const lines = text.split('\n');

        // Collect [heading|null, bodyLines[]] sections in original order.
        const sections = [];
        let cur = { heading: null, lines: [] };
        for (const line of lines) {
            if (isHeading(line)) {
                if (cur.heading !== null || cur.lines.some(l => l.trim())) sections.push(cur);
                cur = { heading: line, lines: [] };
            } else {
                cur.lines.push(line);
            }
        }
        if (cur.heading !== null || cur.lines.some(l => l.trim())) sections.push(cur);

        const anyHeading = sections.some(s => s.heading !== null);
        if (!anyHeading) {
            return [{ id: 'doc', heading: 'Constitution', body: text.trim(), index: 0 }];
        }

        const seen = {};
        return sections.map((s, i) => {
            let id, heading;
            if (s.heading === null) {
                id = 'preamble';
                heading = 'Preamble';
            } else {
                heading = cleanHeading(s.heading);
                id = clauseId(heading, i + 1);
            }
            // Dedupe repeated ids in document order: second 'sec-1' → 'sec-1-2'.
            if (seen[id]) { seen[id] += 1; id = id + '-' + seen[id]; } else { seen[id] = 1; }
            // Body verbatim: only leading blank lines + trailing whitespace go.
            const body = s.lines.join('\n').replace(/^(?:[ \t]*\n)+/, '').replace(/\s+$/, '');
            return { id, heading, body, index: i };
        });
    }

    // ── Search (pure) ────────────────────────────────────────────────
    function tokenize(q) {
        return String(q == null ? '' : q).toLowerCase().split(/[^a-z0-9]+/).filter(t => t.length >= 2);
    }

    // Count word-start occurrences of `token` in `text` (case-insensitive):
    // 'waiver' hits 'waivers', never 'unwaivered'.
    function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
    function countHits(textLower, token) {
        let n = 0, i = 0;
        while ((i = textLower.indexOf(token, i)) !== -1) {
            const prev = i === 0 ? '' : textLower[i - 1];
            if (!/[a-z0-9]/.test(prev)) n++;
            i += token.length;
        }
        return n;
    }

    function makeSnippet(clause, tokens) {
        const body = clause.body || '';
        const bodyLower = body.toLowerCase();
        // Best hit = earliest word-start occurrence of any query token.
        let best = -1, bestLen = 0;
        for (const t of tokens) {
            const re = new RegExp('(^|[^a-z0-9])(' + escapeRe(t) + ')', 'i');
            const m = re.exec(bodyLower);
            if (m) {
                const pos = m.index + m[1].length;
                if (best === -1 || pos < best) { best = pos; bestLen = t.length; }
            }
        }
        if (best === -1) {
            // Heading-only hit: lead of the body (or the heading when empty).
            const lead = body.replace(/\s+/g, ' ').trim();
            if (!lead) return clause.heading;
            return lead.length > SNIPPET_PAD * 2 ? lead.slice(0, SNIPPET_PAD * 2) + '…' : lead;
        }
        const start = Math.max(0, best - SNIPPET_PAD);
        const end = Math.min(body.length, best + bestLen + SNIPPET_PAD);
        let s = body.slice(start, end).replace(/\s+/g, ' ').trim();
        if (start > 0) s = '…' + s;
        if (end < body.length) s = s + '…';
        return s;
    }

    function searchClauses(clauses, query) {
        const list = Array.isArray(clauses) ? clauses : [];
        const tokens = tokenize(query);
        if (!tokens.length) return [];
        const out = [];
        for (const c of list) {
            const headingLower = String(c.heading || '').toLowerCase();
            const bodyLower = String(c.body || '').toLowerCase();
            let score = 0;
            for (const t of tokens) {
                score += countHits(headingLower, t) * 3 + countHits(bodyLower, t);
            }
            if (score > 0) out.push({ clause: c, score, snippet: makeSnippet(c, tokens) });
        }
        return out.sort((a, b) => b.score - a.score || a.clause.index - b.clause.index);
    }

    // ── Ruling context (pure string build) ───────────────────────────
    // The office passes this to AlexVoice.enhance for the one-shot ruling
    // card; this module only builds the grounded prompt block.
    function buildRulingContext(opts) {
        const clauses = (opts && opts.clauses) || [];
        const question = String((opts && opts.question) || '').trim();
        const matches = (opts && Array.isArray(opts.matches)) ? opts.matches : searchClauses(clauses, question);
        const top = matches.slice(0, 3);

        const lines = [];
        lines.push('LEAGUE CONSTITUTION RULING — CONTEXT');
        lines.push('');
        lines.push('QUESTION: ' + (question || '(none given)'));
        lines.push('');
        if (top.length) {
            lines.push('RELEVANT CLAUSES (quoted verbatim from the league constitution):');
            for (const m of top) {
                const c = m.clause || m; // accept raw clauses too
                let body = String(c.body || '').trim();
                if (body.length > CLAUSE_QUOTE_CAP) body = body.slice(0, CLAUSE_QUOTE_CAP) + ' […truncated]';
                lines.push('');
                lines.push('[' + c.id + '] ' + c.heading);
                lines.push(body || '(clause has a heading but no body text)');
            }
        } else {
            lines.push('RELEVANT CLAUSES: none matched this question.');
        }
        lines.push('');
        lines.push('INSTRUCTION: ' + RULING_INSTRUCTION);
        return lines.join('\n');
    }

    // ── Amendment ledger (storage) ───────────────────────────────────
    // Constitutional history: every acknowledged Drift change ('drift_ack')
    // or hand-recorded amendment ('manual') lands here, newest last on disk,
    // newest first out of amendments(). Cap 100 per league.
    function recordAmendment(leagueId, entry) {
        const lid = String(leagueId || '');
        if (!lid || !entry || typeof entry !== 'object') return null;
        const nowMs = entry.nowMs != null ? Number(entry.nowMs) : Date.now();
        const st = store();
        const rec = st.get(KEY(lid), null) || { amendments: [] };
        const row = {
            ts: nowMs,
            path: entry.path != null ? String(entry.path) : '',
            from: entry.from !== undefined ? entry.from : null,
            to: entry.to !== undefined ? entry.to : null,
            note: entry.note != null ? String(entry.note) : '',
            source: entry.source === 'drift_ack' ? 'drift_ack' : 'manual',
        };
        rec.amendments = ((rec.amendments || []).concat([row])).slice(-AMEND_CAP);
        st.set(KEY(lid), rec);
        return row;
    }

    function amendments(leagueId) {
        const rec = store().get(KEY(String(leagueId || '')), null);
        return (rec && Array.isArray(rec.amendments)) ? rec.amendments.slice().reverse() : [];
    }

    App.Commish = App.Commish || {};
    App.Commish.Bylaws = {
        parseClauses, searchClauses, buildRulingContext,
        recordAmendment, amendments,
        RULING_INSTRUCTION, _mem,
    };
    /* global module */
    if (typeof module !== 'undefined' && module.exports) module.exports = App.Commish.Bylaws;
})(typeof window !== 'undefined' ? window : globalThis);
