const assert=require('node:assert/strict');
global.window=globalThis;window.App={};require('../js/shared/time-league-roster.js');
const {beforeSeason}=require('../js/shared/time-league-player-cards.js');
const card={seasons:[{season:2003,games:10,points:300},{season:2000,games:10,points:100},{season:2001,games:10,points:150},{season:2002,games:10,points:500}]};
const read=beforeSeason(card,2002);assert.deepEqual(read.seasons.map(s=>s.season),[2000,2001]);assert.equal(read.best.season,2001);assert.equal(read.change,5);assert.equal(beforeSeason(card,1999).seasons.length,0);assert.equal(beforeSeason(null,2000).latest,undefined);assert.equal(beforeSeason({seasons:[{season:2000,games:0,points:0},{season:2001,games:2,points:4}]},2002).change,null);console.log('Prior-season boundaries, missing history, and per-game trends passed');
