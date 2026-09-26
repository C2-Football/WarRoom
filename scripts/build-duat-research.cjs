'use strict';
// Week 18 is research context only. Duat gameplay remains NFL weeks 1–17.
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
require(path.join(root,'js/duat/dynasty.js'));
const Season=globalThis.App.TimeLeagueSeason;
const source='data/time-league/regular-season-game-logs.csv';
const logs=Season.parseGameLogCsv(fs.readFileSync(path.join(root,source),'utf8')).logs.filter(log=>log.week===18&&log.season>=2021);
const result={version:1,source,availableSeasons:[...new Set(logs.map(log=>log.season))].sort(),statsByGame:Object.fromEntries(logs.map(log=>[Season.gameLogKey(log.identity,log.season,log.week),globalThis.App.DuatMystery.numericStats(log.stats)]))};
const output=path.join(root,'data/duat/research-week18.json'),text=JSON.stringify(result)+'\n';
if(process.argv.includes('--check')){if(fs.readFileSync(output,'utf8')!==text)throw new Error('Regenerate Duat Week 18 research with node scripts/build-duat-research.cjs');}
else fs.writeFileSync(output,text);
console.log(`Duat research: ${logs.length} Week 18 archive rows across ${result.availableSeasons.length} seasons; gameplay unchanged.`);
