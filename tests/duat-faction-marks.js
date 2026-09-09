'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),Babel=require('@babel/standalone');
const World=require('../js/duat/world.js'),Rules=require('../js/duat/rules.js');
const React={createElement:(type,props,...children)=>({type,props:props||{},children})};
const App={DuatWorld:World,DuatRules:Rules};
vm.runInNewContext(Babel.transform(fs.readFileSync('js/components/duat-faction-marks.js','utf8'),{presets:['react']}).code,{window:{App},React});
function expand(tree){if(Array.isArray(tree))return tree.map(expand);if(!tree||typeof tree!=='object')return tree;if(typeof tree.type==='function')return expand(tree.type({...tree.props,children:tree.children}));return {...tree,children:expand(tree.children)};}
function nodes(tree){if(Array.isArray(tree))return tree.flatMap(nodes);return tree&&typeof tree==='object'?[tree,...nodes(tree.children)]:[];}
const draw=props=>expand(React.createElement(App.DuatFactionMark,props));
test('every supported faction renders a distinct native emblem with one common frame and no font or raster dependency',()=>{
    assert.equal(Object.keys(App.DuatFactionMarks).length,28);const signatures=new Set();
    for(const faction of World.FACTIONS){
        const tree=draw({id:faction.id}),all=nodes(tree),svg=all.find(n=>n.type==='svg'),symbol=all.find(n=>n.props.className==='duat-faction-mark-symbol');
        assert.equal(tree.props['data-faction-mark'],faction.id);assert.equal(svg.props.viewBox,'0 0 100 100');assert.equal(svg.props.preserveAspectRatio,'xMidYMid meet');
        assert.equal(all.filter(n=>n.props.className==='duat-faction-mark-field').length,1);
        assert(!all.some(n=>['text','image','img','foreignObject','clipPath'].includes(n.type)),faction.id+' must remain crisp without font substitution or cropping');
        assert(all.some(n=>n.type==='path'||n.type==='ellipse'));signatures.add(JSON.stringify(symbol));
        assert.equal(tree.props.style['--faction-mark-color'],faction.color);assert.equal(tree.props['aria-hidden'],true);
    }
    assert.equal(signatures.size,28,'Distinct cultures must not silently reuse one emblem');
});
test('legacy faction IDs use the same marks and original crest assets remain available as source material',()=>{
    for(const faction of Rules.FACTIONS){const mark=App.DuatFactionMarks[faction.id];assert(mark,faction.id);assert(mark.source);assert(fs.existsSync(mark.source));assert.equal(draw({id:faction.id}).props['data-mark-origin'],'Adapted from supplied faction identity');}
    assert.equal(Object.values(App.DuatFactionMarks).filter(mark=>mark.source).length,14);
});
test('decorative and standalone marks keep correct accessible names, sizing hooks and safe unknown fallback',()=>{
    const meaningful=draw({id:'persia',decorative:false,className:'duat-crest',label:'Persia crest',style:{width:72,height:72}});
    assert.equal(meaningful.props.role,'img');assert.equal(meaningful.props['aria-label'],'Persia crest');assert.equal(meaningful.props['aria-hidden'],undefined);assert(meaningful.props.className.includes('duat-crest'));assert.equal(meaningful.props.style.width,72);
    const fallback=draw({id:'unrecognized',decorative:false});assert.match(fallback.props['aria-label'],/Unknown faction/);assert(nodes(fallback).some(n=>n.type==='path'));assert(!nodes(fallback).some(n=>n.type==='text'));
});
test('both active sigil wrappers delegate to the same renderer',()=>{
    for(const [file,start,end] of [['js/components/duat-presentation.js','function Sigil','function Land'],['js/components/duat-library.js','function Crest','function Army']]){
        const source=fs.readFileSync(file,'utf8'),wrapper=source.slice(source.indexOf(start),source.indexOf(end));assert.match(wrapper,/DuatFactionMark/);assert(!wrapper.includes('<img'));assert(!wrapper.includes('.sigil'));
    }
});
