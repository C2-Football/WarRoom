'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {execFileSync}=require('node:child_process');
const Babel=require('@babel/standalone');
const root=path.resolve(__dirname,'..');
const api=require('../js/shared/lens-composition.js');
const copy=value=>JSON.parse(JSON.stringify(value));
const fields=[{id:'name',label:'Player',type:'string'},{id:'position',label:'Position',type:'string'},{id:'ppg',label:'PPG',type:'number',unit:'points/game'},{id:'value',label:'Value',type:'number'},{id:'teamRecord',label:'Team record',type:'string'},{id:'teamName',label:'Fantasy team',type:'string'},{id:'date',label:'Reported',type:'date'}];
const rows=Array.from({length:60},(_,i)=>({name:'Player '+(i+1),position:i%2?'WR':'RB',ppg:i===0?0:i===1?null:30-i/3,value:1000+i*10,teamRecord:'2–5',teamName:'Fantasy team '+(i%10),date:'2026-10-23T12:00:00Z'}));
const dataset={id:'targets',source:'tradeTargets',fields,rows,status:'partial',note:'Missing PPG remains unavailable.',asOf:'2026-10-23T12:00:00Z',sourceIds:['source_1'],query:{source:'tradeTargets',params:{season:'2026'},filters:[{field:'teamWinPct',op:'lt',value:50}],limit:60}};
const scatter={mark:{type:'point',filled:true,size:100},encoding:{x:{field:'value',type:'quantitative',title:'Observed value'},y:{field:'ppg',type:'quantitative'},color:{field:'position',type:'nominal'},tooltip:[{field:'name'},{field:'ppg'},{field:'value'}]},height:340};
const composition={version:1,title:'Opportunity board',subtitle:'Observed production on losing fantasy teams',theme:{accent:'#65d9c5',style:'editorial'},blocks:[{id:'comparison',kind:'chart',title:'Production and value',datasetId:'targets',visual:scatter,mobileVisual:{mark:'bar',encoding:{y:{field:'position',type:'nominal'},x:{field:'ppg',type:'quantitative',aggregate:'mean'}}},sourceIds:['source_1'],span:8,tabletSpan:12},{id:'context',kind:'text',title:'How to read this',body:'These records do not establish a willingness to trade.',sourceIds:['source_1'],span:4,tabletSpan:12},{id:'board',kind:'table',title:'All candidates',datasetId:'targets',columns:['name','position','teamName','teamRecord','ppg','value'],sourceIds:['source_1'],span:12,tabletSpan:12}],datasets:[dataset],sources:[{id:'source_1',title:'Loaded league records',url:'https://api.sleeper.app/v1/league/123/rosters',asOf:'2026-10-23T12:00:00Z',note:'Reported records and verified scoring.'}],research:{prompt:'Find targets on losing teams',createdAt:'2026-10-23T13:00:00Z'}};
composition.blocks[0].subtitle='Comparison caption should stay hidden.';
composition.research.notes='Research context belongs in the disclosure.';
const valid=api.validate(composition);
assert.equal(valid.datasets[0].rows[0].ppg,0);
assert.equal(valid.datasets[0].rows[1].ppg,null);
assert.equal(valid.datasets[0].query.params.season,'2026');
assert.equal(valid.blocks[0].span,8);
assert.equal(valid.datasets[0].rows.length,60);
assert.notEqual(valid,composition);
console.log('PASS composition preserves typed evidence, 60-row boards, source identity and responsive placement');
function reject(change,pattern){const value=copy(composition);change(value);assert.throws(()=>api.validate(value),pattern);}
for(const bad of ['javascript:alert(1)','data:text/html,test','http://example.com','https://user:pass@example.com']) reject(v=>v.sources[0].url=bad);
reject(v=>v.blocks[0].sourceIds=['missing']);
reject(v=>v.blocks[0].datasetId='missing');
reject(v=>v.blocks[0].visual.encoding.x.field='secret');
reject(v=>v.blocks[0].visual.encoding.x.field='name');
reject(v=>v.blocks[0].visual.encoding.x={field:'name',type:'temporal'});
reject(v=>v.blocks[0].span=13);
reject(v=>v.blocks[0].tabletSpan=4);
reject(v=>v.blocks[0].visual.layer=Array.from({length:7},()=>({mark:'point'})));
reject(v=>v.blocks[0].visual.encoding.x.scale={domain:{data:'other'}});
reject(v=>v.blocks[0].visual.encoding.color.scale={range:['url(https://example.com/image.svg)']});
reject(v=>v.blocks[0].visual.encoding.color.scale=null);
reject(v=>v.blocks[0].visual.encoding.x.axis={labelExpr:'fetch(secret)'});
reject(v=>v.blocks[0].visual.mark={type:'image'});
reject(v=>v.blocks[0].visual.mark={type:'point',tooltip:{expr:'datum.secret'}});
reject(v=>v.blocks[0].visual.encoding.href={field:'name'});
reject(v=>v.datasets[0].rows[0].ppg='0');
reject(v=>v.datasets[0].rows[0].extra='secret');
reject(v=>v.datasets[0].fields[0].id='constructor');
reject(v=>v.datasets[0].rows=Array.from({length:301},()=>rows[0]));
reject(v=>v.blocks[0]={id:'metric',kind:'metric',title:'Misleading first row',datasetId:'targets',field:'ppg',sourceIds:[],span:12,tabletSpan:12});
reject(v=>v.blocks[0].visual.encoding.x={field:'name',aggregate:'sum',type:'quantitative'});
for(const key of ['data','url','transform','params','config','hconcat','facet','repeat','resolve','usermeta']) reject(v=>v.blocks[0].visual[key]={url:'https://example.com'});
for(const key of ['expr','condition','datum']) reject(v=>v.blocks[0].visual.encoding.x[key]='datum.value');
const pollution=copy(composition);pollution.datasets[0].query.params=JSON.parse('{"__proto__":{"polluted":true}}');assert.throws(()=>api.validate(pollution));
reject(v=>v.blocks[0].desktopSpan=8,/Unsupported composition block key: "desktopSpan"\. Allowed keys: .*span, tabletSpan/);
reject(v=>v.blocks[0].visual.encoding.x.axis=[],/Invalid axis: expected an object\. Allowed keys: title, labels/);
console.log('PASS strict grammar rejects executable expressions, external resources, unknown fields, excessive rows and misleading metrics');
const percentageFields=[{id:'winPct',label:'Win percentage',type:'number',unit:'percent'}];
const percentVisual=encoding=>({mark:'bar',encoding:{x:encoding}});
for (const format of ['.0%','.2p']) {
    for (const location of ['format','axis','legend']) {
        const encoding={field:'winPct',type:'quantitative',...(location==='format' ? {format} : {[location]:{format}})};
        assert.throws(()=>api.validateVisual(percentVisual(encoding),percentageFields),/already use 0–100.*50 as 5000%/);
    }
}
assert.equal(api.validateVisual(percentVisual({field:'winPct',type:'quantitative',axis:{format:'.0f',title:'Win percentage (%)'}}),percentageFields).encoding.x.axis.format,'.0f');
assert.equal(api.validateVisual(percentVisual({field:'winPct',type:'quantitative',aggregate:'mean',format:'.1f'}),percentageFields).encoding.x.format,'.1f');
assert.throws(()=>api.validateVisual(percentVisual({field:'winPct',type:'quantitative',aggregate:'mean',format:'.0%'}),percentageFields),/already use 0–100/);
for (const aggregate of ['count','distinct','valid','missing']) assert.equal(api.validateVisual(percentVisual({field:'winPct',type:'quantitative',aggregate,format:'.0%'}),percentageFields).encoding.x.format,'.0%');
assert.equal(api.validateVisual(percentVisual({field:'winPct',type:'quantitative',stack:'normalize',axis:{format:'.0%'}}),percentageFields).encoding.x.axis.format,'.0%');
console.log('PASS percentage-point fields reject 100× formatting in labels, axes and legends while true normalized ratios remain supported');
const unreported={...dataset,rows:rows.map(row=>({...row,ppg:null}))};
assert.equal(api.hasPlottableData(scatter,unreported),false);
assert.equal(api.hasPlottableData(scatter,{...dataset,rows:[{...rows[0],ppg:0}]}),true,'reported zero can be drawn');
assert.equal(api.hasPlottableData(scatter,{...dataset,rows:[{...rows[0],ppg:null,value:10},{...rows[0],ppg:10,value:null}]}),false,'both coordinates must exist on the same row');
assert.equal(api.hasPlottableData({mark:'bar',encoding:{x:{field:'position',type:'nominal'},y:{aggregate:'count',type:'quantitative'}}},unreported),true,'counts remain real even when unrelated scoring is missing');

const React={createElement:(type,props,...children)=>({type,props:props||{},children}),useMemo:fn=>fn(),useRef:()=>({current:null}),useState:initial=>[initial,()=>{}],useEffect:()=>{}};
const window={WR:{LensComposition:api}};
const context=vm.createContext({window,React,URL,console});
vm.runInContext(Babel.transform(fs.readFileSync(path.join(root,'js/components/lens-composition.js'),'utf8'),{presets:['react']}).code,context);
const savedBeforeRender=JSON.stringify(valid),tree=window.WR.LensCompositionView({composition:valid}),nodes=[];
function walk(node){if(node==null || typeof node!=='object')return;if(Array.isArray(node))return node.forEach(walk);if(typeof node.type==='function')return walk(node.type({...node.props,children:node.children}));nodes.push(node);walk(node.children);}
walk(tree);
const surfaceNodes=[];
function surface(node){if(node==null || typeof node!=='object')return;if(Array.isArray(node))return node.forEach(surface);if(typeof node.type==='function')return surface(node.type({...node.props,children:node.children}));if(node.props.className==='lens-composition-research')return;surfaceNodes.push({type:node.type,props:node.props,children:node.children.filter(child=>typeof child!=='object')});surface(node.children);}
surface(tree);
const surfaceText=JSON.stringify(surfaceNodes),allText=JSON.stringify(nodes.map(node=>({type:node.type,props:node.props,children:node.children.filter(child=>typeof child!=='object')})));
assert(!surfaceText.includes(composition.subtitle));
assert(!allText.includes(composition.blocks[0].subtitle));
assert(!allText.includes(composition.blocks[1].body));
assert(!nodes.some(node=>node.props.className==='lens-composition-block lens-composition-text'));
assert(!nodes.some(node=>node.type==='footer'));
assert(surfaceText.includes('Production and value'));
assert(surfaceText.includes('All candidates'));
assert(!surfaceText.includes(dataset.note));
assert(!surfaceText.includes(composition.sources[0].note));
assert(!surfaceText.includes(composition.research.notes));
assert(!surfaceText.includes('Data as of'));
assert(!surfaceNodes.some(node=>node.props['data-lens-source']),'source links live only in the source disclosure');
const researchPanels=nodes.filter(node=>node.type==='details' && node.props.className==='lens-composition-research');
assert.equal(researchPanels.length,1);
assert.equal(researchPanels[0].props.open,undefined,'research starts collapsed');
assert(JSON.stringify(researchPanels[0]).includes(dataset.note));
assert(JSON.stringify(researchPanels[0]).includes(composition.sources[0].note));
assert(JSON.stringify(researchPanels[0]).includes(composition.research.notes));
assert(JSON.stringify(researchPanels[0]).includes('Data as of'));
assert.equal(JSON.stringify(valid),savedBeforeRender,'rendering leaves legacy narrative, sources and data unchanged');
assert.equal(valid.blocks[1].kind,'text','legacy saved text blocks still validate');
console.log('PASS visual-only canvas omits legacy narrative and captions; one closed source ledger retains notes, timestamps and links');
assert(!nodes.some(node=>'dangerouslySetInnerHTML' in node.props));
assert(nodes.some(node=>node.type==='a' && node.props['data-lens-source'] && node.props.rel==='noopener noreferrer'));
assert(nodes.some(node=>node.type==='table'));
assert.equal(nodes.filter(node=>node.type==='summary' && node.children.some(child=>child?.props?.className==='lens-composition-row-number')).length,60);
const facts=nodes.filter(node=>node.props.className==='lens-composition-row-facts');
assert.equal(facts.length,60);
assert(JSON.stringify(facts[0]).includes('Team record'));
assert(JSON.stringify(facts[0]).includes('PPG'));
assert(JSON.stringify(facts[0]).includes('Value'));
assert(JSON.stringify(facts[0]).includes('"children":[0]')===false,'format produces readable text');
assert(JSON.stringify(facts[0]).includes('"0"'));
assert(JSON.stringify(facts[1]).includes('Unavailable'));
assert(nodes.filter(node=>node.type==='summary').every(node=>node.props['data-lens-interactive']));
const unavailableTree=window.WR.LensCompositionView({composition:{...valid,datasets:[unreported]}}),unavailableNodes=[];
function flatten(node){if(!node || typeof node!=='object')return;if(Array.isArray(node))return node.forEach(flatten);if(typeof node.type==='function')return flatten(node.type({...node.props,children:node.children}));unavailableNodes.push(node);flatten(node.children);}
flatten(unavailableTree);
assert(JSON.stringify(unavailableNodes).includes('The values needed for this graphic have not been reported'));
assert(unavailableNodes.some(node=>node.type==='details' && node.props.className==='lens-composition-evidence' && node.props.open===true),'missing axes expose the underlying data immediately');
console.log('PASS renderer keeps mobile decision evidence inline, all rows accessible, citations safe and null distinct from zero');

async function runtimeTest(){
    execFileSync(process.execPath,['scripts/build-lens-visuals.cjs'],{cwd:root,stdio:'pipe'});
    const runtimeWindow={WR:{LensComposition:api}};
    let generated=0,network=0;
    const sandbox={window:runtimeWindow,console,setTimeout,clearTimeout,setInterval,clearInterval,structuredClone,URL,performance,TextDecoder,TextEncoder,fetch:()=>{network++;throw Error('Unexpected network');},Function:function(){generated++;throw Error('Dynamic code generation forbidden');}};
    const runtimeContext=vm.createContext(sandbox,{codeGeneration:{strings:false,wasm:false}});
    vm.runInContext(fs.readFileSync(path.join(root,'js/vendor/lens-visuals.js'),'utf8'),runtimeContext);
    const variants=[scatter,{layer:[{mark:{type:'bar',opacity:.4},encoding:{x:{field:'position'},y:{field:'ppg',type:'quantitative',aggregate:'mean'}}},{mark:{type:'point',filled:true},encoding:{x:{field:'position'},y:{field:'ppg',type:'quantitative',aggregate:'mean'}}}]},{mark:'line',encoding:{x:{field:'date',type:'temporal',timeUnit:'yearmonthdate'},y:{field:'ppg',aggregate:'mean',type:'quantitative'}}},{mark:'bar',encoding:{x:{field:'ppg',type:'quantitative',bin:{maxbins:8}},y:{aggregate:'count',type:'quantitative'}}},{mark:{type:'arc',innerRadius:50},encoding:{theta:{aggregate:'count',type:'quantitative'},color:{field:'position',type:'nominal'}}}];
    for(const spec of variants){
        const view=runtimeWindow.WR.LensVisualRuntime.createView({spec,rows,fields,width:600,renderer:'none'});
        await view.runAsync();
        const svg=await view.toSVG();
        assert(svg.includes('<svg'));
        assert(!svg.includes('<image'));
        assert(!svg.includes('<script'));
        view.finalize();
    }
    assert.equal(generated,0,'all compiler-generated expressions run through the interpreter');
    assert.equal(network,0,'charts never fetch resources');
    console.log('PASS real Vega runs layered, scatter, temporal, binned and arc grammar under no-eval with no network');
}
runtimeTest().catch(error=>{console.error(error.message);console.error(String(error.stack).split('\n').filter(line=>line.trim().startsWith('at ')).slice(-8).join('\n'));process.exitCode=1;});
