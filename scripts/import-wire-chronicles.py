"""Build reviewed Wire facts from the local, read-only workbook cell archive.

Usage: python3 scripts/import-wire-chronicles.py [archive-directory]
No source workbooks or current Sleeper settings are modified.
"""
import json
import re
import sys
from pathlib import Path

BASE = Path(__file__).resolve().parents[1]
INPUT = Path(sys.argv[1]) if len(sys.argv) > 1 else BASE / 'output/league-histories'
live = json.loads((INPUT / 'sleeper-reconciliation.json').read_text())
result = {}
one_owners = {
    'Malcolm Wohler': '510866780064288768', 'Brooks Farris': '511343705642745856',
    'Steve Crusinberry': '540392203863576576', 'Ivan Hartung': '592403599754055680',
    'Blake Hudson': '609254546056765440', 'Sam Coonrod': '592383910399234048',
    'Kevin Gates': '594658668281122816',
}
for key in ['the-one', 'psycho']:
    raw = json.loads((INPUT / (key + '-source-cells.json')).read_text())
    sheets = {s['name']: {c['cell']: c['value'] for c in s['cells']} for s in raw['sheets']}
    seasons = {int(s['league']['season']): s for s in live[key]}
    def source(sheet, cells):
        return {'workbook': raw['source'], 'sheet': sheet, 'range': cells}
    def api(year, endpoint):
        return {'url': 'https://api.sleeper.app/v1/league/' + seasons[year]['league']['league_id'] + '/' + endpoint, 'label': 'Sleeper ' + str(year) + ' ' + endpoint, 'checkedOn': '2026-09-14'}
    def identity(year, text):
        if key == 'the-one':
            return one_owners.get(text)
        candidates = set()
        # Exact historical account handles only. Explicit workbook aliases below
        # are backed by title-bracket participants and historical users.
        aliases = {'tropic lightning': 'skjjcruz', 'body by bowflex': 'glshuck', 'caca': 'cacapoopoopeepeepnts'}
        if year == 2025:
            aliases['dirty mike and the boys'] = 'skjjcruz'  # P3 D10:G10 explicitly binds the same-season name.
        handle = aliases.get(text.lower(), text.lower())
        for u in seasons.get(year, {}).get('users', []):
            if u['name'].lower() == handle:
                candidates.add(u['user_id'])
        return next(iter(candidates)) if len(candidates) == 1 else None
    facts = []
    sn = 'The One HOF' if key == 'the-one' else 'Hall of Psychos P2'
    sheet = sheets[sn]
    for r in (range(5, 19) if key == 'the-one' else range(8, 11)):
        year = int(sheet['A' + str(r)])
        text = sheet['B' + str(r)].strip()
        # Both documented score layouts: Name SCORE - Name SCORE / SCORE Name.
        m = re.fullmatch(r'(.+?) (\d+\.\d+) - (?:(.+?) (\d+\.\d+)|(\d+\.\d+) (.+))', text)
        winner, loser, scores = text, None, None
        status = 'documented'
        if m:
            winner, loser = m[1], m[3] or m[6]
            scores = [float(m[2]), float(m[4] or m[5])]
        elif ' v ' in text:
            winner, loser = text.split(' v ')
            status = 'unresolved'  # No explicit winner in the original matchup.
        f = {'id': key + '-final-' + str(year), 'type': 'final', 'season': year, 'classification': status,
             'winner': winner, 'loser': loser, 'scores': scores, 'original': text,
             'owners': [identity(year, n) for n in [winner, loser] if n],
             'sources': [source(sn, 'A%d:F%d' % (r, r))]}
        s = seasons.get(year)
        if s and s['final']:
            bracket = s['final']
            owners = {r['roster_id']: r['owner_id'] for r in s['rosters']}
            pts = {r['roster_id']: r['custom_points'] if r.get('custom_points') is not None else r.get('points') for r in s['finalRows']}
            observed = [pts.get(bracket[k]) for k in ['w', 'l']]
            matched = f['owners'] == [owners.get(bracket[k]) for k in ['w', 'l']]
            if matched and all(isinstance(v, (int, float)) for v in observed) and s['league']['settings'].get('playoff_round_type', 0) == 0:
                f.update(scores=observed, reconciliation='matched' if scores == observed else 'score-correction', originalScores=scores)
                f['sources'] += [api(year, 'winners_bracket'), api(year, 'matchups/' + str(s['finalWeek']))]
            else:
                f.update(classification='unresolved', reconciliation='participant-or-format-conflict')
        facts.append(f)
    # Supply missing title years from verified one-week Sleeper title brackets.
    if key == 'psycho':
        for year in [2024, 2025]:
            s = seasons[year]; b = s['final']
            assert b and s['league']['settings'].get('playoff_round_type', 0) == 0
            owners = {r['roster_id']: r['owner_id'] for r in s['rosters']}
            users = {u['user_id']: u for u in s['users']}
            rows = {r['roster_id']: r for r in s['finalRows']}
            ids = [owners[b[k]] for k in ['w', 'l']]
            scores = [rows[b[k]].get('custom_points') if rows[b[k]].get('custom_points') is not None else rows[b[k]]['points'] for k in ['w', 'l']]
            facts.append({'id': key + '-final-' + str(year), 'type': 'final', 'season': year, 'classification': 'documented',
                          'winner': users[ids[0]]['name'], 'loser': users[ids[1]]['name'], 'owners': ids, 'scores': scores,
                          'sources': [api(year, 'winners_bracket'), api(year, 'matchups/' + str(s['finalWeek']))], 'reconciliation': 'sleeper-supplement'})
        sn = 'Hall of Psychos P3'; sh = sheets[sn]; award = ''
        for r in range(6, 35):
            award = sh.get('A' + str(r), award)
            year = int(sh['D' + str(r)]); holder = sh['E' + str(r)].strip(); stat = sh.get('G' + str(r))
            # Parenthesized handles occur in the documented award list. For
            # unannotated team names do not guess a contemporary identity.
            parenthesis = re.search(r'\(([^)]+)\)', holder)
            candidates = {identity(year, holder.removeprefix('Team ').split('(')[0].strip())}
            if parenthesis:
                candidates.add(identity(year, parenthesis[1]))
            candidates.discard(None)
            uid = next(iter(candidates)) if len(candidates) == 1 else None
            facts.append({'id': key + '-award-' + str(r), 'type': 'award', 'season': year,
                          'classification': 'documented', 'award': award, 'holder': holder, 'stat': stat,
                          'owners': [uid] if uid else [], 'sources': [source(sn, 'A%d:G%d' % (r, r))]})
    else:
        # Player championship membership by year, not cumulative career totals.
        for r in range(23, 34):
            player, years = sheet.get('H' + str(r)), sheet.get('I' + str(r))
            if not player or not years:
                continue
            for yr in str(years).split(','):
                year = 2000 + int(yr)
                facts.append({'id': 'the-one-player-%s-%s' % (r, year), 'type': 'legacy', 'season': year,
                              'classification': 'documented', 'player': player, 'owners': next((f['owners'][:1] for f in facts if f['type'] == 'final' and f['season'] == year and f['classification'] != 'unresolved'), []),
                              'sources': [source('The One HOF', 'G%d:I%d' % (r, r))]})
    if key == 'psycho':
        weekly = json.loads((INPUT / 'psycho-weekly-reconciliation.json').read_text())
        for f in facts:
            if f['type'] != 'award' or f['award'] not in ['WEEKLY HIGH SCORE', 'SEASON POINTS LEADER']:
                continue
            year = f['season']; s = seasons[year]
            weeks = sorted([(w, rows) for y, w, rows in weekly if int(y) == year])
            expected = list(range(s['league']['settings'].get('start_week', 1), s['league']['settings']['playoff_week_start']))
            assert [w for w, _ in weeks] == expected
            owner_by_rid = {r['roster_id']: r['owner_id'] for r in s['rosters']}
            users = {u['user_id']: u['name'] for u in s['users']}
            totals = {}; high = []
            for w, rows in weeks:
                assert len(rows) == len(s['rosters'])
                for r in rows:
                    pts = r['custom_points'] if r.get('custom_points') is not None else r['points']
                    assert isinstance(pts, (int, float))
                    rid = r['roster_id']; totals[rid] = totals.get(rid, 0) + pts
                    high.append((pts, rid, w))
            if f['award'] == 'WEEKLY HIGH SCORE':
                pts, rid, week = max(high)
                evidence = [api(year, 'matchups/' + str(week))]
            else:
                rid = max(totals, key=totals.get); pts = round(totals[rid], 2); week = None
                evidence = [api(year, 'matchups/' + str(w)) for w in expected]
            recorded = float(re.match(r'[0-9.]+', str(f['stat']))[0])
            f['observed'] = {'value': pts, 'holder': users[owner_by_rid[rid]], 'ownerId': owner_by_rid[rid], 'week': week, 'throughWeek': expected[-1], 'checkedOn': '2026-09-14'}
            f['reconciliation'] = 'matched' if abs(recorded - pts) < .005 and f['owners'] == [owner_by_rid[rid]] else 'award-snapshot-differs'
            f['sources'] += evidence
    result[key] = {'name': 'The One' if key == 'the-one' else 'Psycho League',
                   'leagueIds': [s['league']['league_id'] for s in live[key]], 'facts': facts,
                   'coverage': 'Championships, historical player honors and awards. Documentary snapshots do not add to regular-season or Cup totals.',
                   'ownerBindings': [{'ownerId': uid, 'documentedName': name, 'evidence': [{'season': f['season'], 'sources': f['sources']} for f in facts if f['type'] == 'final' and uid in f['owners'] and f.get('reconciliation') in ['matched', 'score-correction']]} for name, uid in one_owners.items()] if key == 'the-one' else [{'ownerId': u['user_id'], 'accountName': u['name'], 'season': year, 'source': api(year, 'users')} for year, s in seasons.items() for u in s['users']],
                   'identityEvidence': 'The One mappings use matching championship participants and historical Sleeper owners. Psycho mappings use exact season account handles and explicit workbook aliases. Unmatched names remain unbound.',
                   'excluded': ['Undated cumulative wins and Cup totals', 'Date-formatted win-loss cells', 'Unresolved rule votes', 'Unconfirmed owner name changes']}
output = BASE / 'js/shared/league-wire-chronicles-data.js'
output.write_text('// Reviewed documentary history. Generated by scripts/import-wire-chronicles.py.\nwindow.WrWireChroniclesData = ' + json.dumps(result, ensure_ascii=False, separators=(',', ':')) + ';\n')
print({k: {'facts': len(v['facts']), 'correctedFinals': sum(f.get('reconciliation') == 'score-correction' for f in v['facts'])} for k, v in result.items()})
