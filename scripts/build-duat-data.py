#!/usr/bin/env python3
"""Build Duat's full W1-17 NFL calendar from nflverse weekly releases.
Run with --cache-dir to reuse downloads. Never reads the Vault's trimmed data.
"""
import argparse, csv, hashlib, io, json, re, unicodedata, urllib.request
from pathlib import Path
from datetime import datetime, timezone

p = argparse.ArgumentParser()
p.add_argument('--cache-dir', type=Path, default=Path('work/duat-cache'))
p.add_argument('--start', type=int, default=2002)
p.add_argument('--end', type=int, default=2025)
a = p.parse_args()
root = Path(__file__).resolve().parents[1]
out = root / 'data/duat'
out.mkdir(parents=True, exist_ok=True)
fields = ['player','position','season','week','pass_yds','pass_tds','interceptions','rush_yds','rush_tds','receptions','rec_yds','rec_tds','fumbles_lost','two_pt']
source_columns = ['passing_yards','passing_tds','passing_interceptions','rushing_yards','rushing_tds','receptions','receiving_yards','receiving_tds']
rows, sources = [], []
identity_owners = {}
# Distinct NFL players share this name and position. Stable alias avoids merging their scores.
ALIASES = {
    '00-0020739': 'Ricky Williams (IND)', '00-0021306': 'Adrian Peterson (CHI)',
    '00-0021425': 'Antonio Brown (BUF)', '00-0023452': 'Mike Williams (DET)',
    '00-0027702': 'Mike Williams (TB)', '00-0027608': 'Kyle Williams (SF)',
    '00-0040317': 'Jacoby Jones (WAS)', '00-0027076': 'Mike Thomas (JAX)',
    '00-0025438': 'Steve Smith (NYG)', '00-0027125': 'Zach Miller (CHI)',
    '00-0039849': 'Marvin Harrison Jr. (ARI)', '00-0034418': 'Cedrick Wilson Jr. (DAL)',
    '00-0025794': 'Chris Davis (NYJ)', '00-0030077': 'Chris Harper (GB)',
}
def number(row, key):
    value = row.get(key, '')
    return float(value) if value not in ('',None,'NA') else 0.0

def identity(name, pos):
    text = unicodedata.normalize('NFKD', name)
    text = ''.join(c for c in text if not unicodedata.combining(c)).lower()
    parts = re.sub('[^a-z0-9]+', ' ', text).strip().split()
    return 'player:' + pos + ':' + ''.join(x for x in parts if x not in {'jr','sr','ii','iii','iv','v'})

for year in range(a.start, a.end + 1):
    url = f'https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_week_{year}.csv'
    cache = a.cache_dir / f'stats_player_week_{year}.csv'
    if not cache.exists():
        cache.parent.mkdir(parents=True, exist_ok=True)
        with urllib.request.urlopen(url, timeout=60) as response:
            cache.write_bytes(response.read())
    raw = cache.read_bytes()
    reader = csv.DictReader(io.StringIO(raw.decode('utf-8-sig')))
    required = ['player_id','player_display_name','position','season_type','season','week'] + source_columns
    if not all(col in reader.fieldnames for col in required):
        raise ValueError(f'{year}: required nflverse fields missing')
    by_player = {}
    for row in reader:
        if row['season_type'] != 'REG' or row['position'] not in ('QB','RB','WR','TE'):
            continue
        week = int(row['week'])
        if not 1 <= week <= 17:
            continue
        name = ALIASES.get(row['player_id'], row['player_display_name'].strip())
        if not name:
            raise ValueError(f'{year}: unnamed player')
        ident = identity(name,row['position'])
        if ident in identity_owners and identity_owners[ident] != row['player_id']:
            raise ValueError(f'Cross-season identity collision {ident}; add an explicit alias')
        identity_owners[ident] = row['player_id']
        if int(row['season']) != year:
            raise ValueError(f'{year}: source season mismatch')
        key = (ident, year, week)
        values = [number(row,col) for col in source_columns]
        fumbles = number(row,'fumbles_lost_total') if 'fumbles_lost_total' in row else sum(number(row,col) for col in ('sack_fumbles_lost','rushing_fumbles_lost','receiving_fumbles_lost'))
        two = sum(number(row,col) for col in ('passing_2pt_conversions','rushing_2pt_conversions','receiving_2pt_conversions'))
        result = [name,row['position'],year,week,*values,fumbles,two]
        if key in by_player:
            if by_player[key][0] != row['player_id']:
                raise ValueError(f'Canonical identity collision {key}; add an explicit alias')
            for i in range(4,len(result)):
                by_player[key][1][i] += result[i]
        else:
            by_player[key] = (row['player_id'],result)
    year_rows = [value[1] for value in by_player.values()]
    coverage = {week: sum(row[3] == week for row in year_rows) for week in range(1,18)}
    if min(coverage.values()) < 100:
        raise ValueError(f'{year}: incomplete week coverage {coverage}')
    rows.extend(year_rows)
    sources.append({'season':year,'url':url,'sha256':hashlib.sha256(raw).hexdigest(),'rows':len(year_rows),'weekCounts':coverage})
rows.sort(key=lambda r:(r[2],r[3],r[1],r[0]))
with (out/'nflverse-game-logs.csv').open('w',newline='') as f:
    writer=csv.writer(f,lineterminator='\n'); writer.writerow(fields)
    writer.writerows([[int(x) if isinstance(x,float) and x.is_integer() else x for x in row] for row in rows])
players={}
for r in rows:
    name,pos,year,week,*stats=r
    ident=identity(name,pos)
    player=players.setdefault(ident,{'identity':ident,'name':name,'position':pos,'seasons':{}})
    season=player['seasons'].setdefault(year,{'season':year,'games':0,'passYd':0,'passTd':0,'passInt':0,'rushYd':0,'rushTd':0,'rec':0,'recYd':0,'recTd':0,'points':0})
    season['games']+=1
    for key,val in zip(['passYd','passTd','passInt','rushYd','rushTd','rec','recYd','recTd'],stats[:8]): season[key]+=val
    season['points']+=stats[0]*.04+stats[1]*4-stats[2]+stats[3]*.1+stats[4]*6+stats[5]*.5+stats[6]*.1+stats[7]*6-stats[8]+stats[9]*2
for player in players.values():
    player['seasons']=sorted(player['seasons'].values(),key=lambda s:s['season'])
    for season in player['seasons']: season['points']=round(season['points'],2)
    player['peak']=max(s['points'] for s in player['seasons'])
(out/'player-cards.json').write_text(json.dumps({'players':sorted(players.values(),key=lambda p:p['identity'])},separators=(',',':'))+'\n')
manifest={'version':1,'source':'nflverse player statistics','sourceUrl':'https://github.com/nflverse/nflverse-data','license':'CC-BY-4.0','licenseUrl':'https://creativecommons.org/licenses/by/4.0/','calendar':'NFL regular-season weeks 1–17; Week 18 and NFL postseason excluded','seasons':list(range(a.start,a.end+1)),'weeks':list(range(1,18)),'rows':len(rows),'players':len(players),'scoring':'Original Duat: half-PPR, 4 pass TD, -1 turnover; raw historical stats','sources':sources,'identityAliases':ALIASES,'notes':['A player with no record in a covered week scores zero; no record is not a diagnosed bye or injury.','No NFL postseason scores enter the Duat Heavenly Battle.','The 2022 Buffalo-Cincinnati canceled game has no completed stats.']}
(out/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
print(f'{len(rows)} weekly records, {len(players)} players, {a.start}–{a.end}, weeks 1–17')
