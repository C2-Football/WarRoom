'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),Babel=require('@babel/standalone');
const source=Babel.transform(fs.readFileSync('js/components/duat-weekly-flow.js','utf8'),{presets:['react']}).code;
const nodes=tree=>Array.isArray(tree)?tree.flatMap(nodes):tree&&typeof tree==='object'?[tree,...nodes(tree.children)]:[];
const text=tree=>Array.isArray(tree)?tree.map(text).join(' '):tree==null||typeof tree==='boolean'?'':typeof tree==='object'?text(tree.children):String(tree);
function mount(){
    const refs=[],effects=[],cleanups=[],dependencies=[],styles=new Map(),events=new Map(),observers=[],calls=[];let cursor=0,effectIndex=0,height=100;
    const game={style:{setProperty:(key,value)=>styles.set(key,value),removeProperty:key=>styles.delete(key)}};
    const window={App:{},getComputedStyle:()=>({position:'fixed'}),addEventListener:(key,fn)=>events.set(key,fn),removeEventListener:key=>events.delete(key),ResizeObserver:class{constructor(callback){this.callback=callback;observers.push(this);}observe(node){this.node=node;}disconnect(){this.disconnected=true;}}};
    const React={createElement:(type,props,...children)=>({type,props:props||{},children}),useRef(initial){const key=cursor++;return refs[key]||(refs[key]={current:initial});},useEffect(callback,deps){const key=effectIndex++;if(!dependencies[key]||deps.some((value,i)=>value!==dependencies[key][i]))effects.push(()=>{cleanups[key]?.();cleanups[key]=callback();});dependencies[key]=deps;}};
    vm.runInNewContext(source,{window,React});
    const props={stage:'lineup',week:1,cycle:1,primary:{label:'Confirm lineup',onClick:()=>calls.push('primary')},secondary:{label:'Edit lineup',onClick:()=>calls.push('secondary')},children:'The current task'};
    function render(changes={}){
        Object.assign(props,changes);cursor=effectIndex=0;effects.length=0;const tree=window.App.DuatWeeklyUI.Frame(props);
        for(const node of nodes(tree))if(node.props.ref){const kind=node.type==='footer'?'action':'heading';node.props.ref.current={closest:()=>game,getBoundingClientRect:()=>({height}),focus:()=>calls.push(kind+' focus'),scrollIntoView:()=>calls.push(kind+' scroll')};}
        effects.forEach(fn=>fn());return tree;
    }
    return {render,calls,styles,events,observers,setHeight:value=>{height=value;},App:window.App,unmount:()=>cleanups.forEach(fn=>fn?.())};
}
test('one current action row preserves disabled authority and inline error recovery across every guided stage',()=>{
    const h=mount();let dismissed=0;
    for(const stage of ['alliance','lineup','favors','kickoff','games','recap','conquest']){
        const tree=h.render({stage,busy:false,primary:{label:'Current move',disabled:true,onClick:()=>{}},actionError:'The room changed. Try again.',onDismissError:()=>dismissed++});
        assert.equal(nodes(tree).filter(node=>node.props['aria-label']==='Week actions').length,1);assert.equal(nodes(tree).filter(node=>node.type==='button'&&text(node)==='Current move').length,1);
        assert.equal(nodes(tree).find(node=>node.type==='button'&&text(node)==='Current move').props.disabled,true);assert.equal(nodes(tree).filter(node=>node.props.role==='alert').length,1);const feedback=nodes(tree).find(node=>node.props.className==='duat-weekly-feedback');assert(!nodes(feedback).some(node=>node.type==='button'&&text(node)==='Current move'),'Primary stays outside the scrolling feedback.');
        nodes(tree).find(node=>node.type==='button'&&text(node)==='Dismiss error').props.onClick();
    }
    assert.equal(dismissed,7);const tree=h.render({actionError:'',primary:{label:'Continue',onClick:()=>h.calls.push('continued')},busy:false});assert.equal(nodes(tree).filter(node=>node.props.role==='alert').length,0);nodes(tree).find(node=>node.type==='button'&&text(node)==='Continue').props.onClick();assert(h.calls.includes('continued'));
    const busy=h.render({busy:true});assert(nodes(busy).filter(node=>node.type==='button').every(node=>node.props.disabled));
});
test('the action space follows measured content height and cleans its observer and resize listener on exit',()=>{
    const h=mount();h.render();assert.equal(h.styles.get('--duat-week-action-height'),'100px');h.setHeight(207.5);h.observers[0].callback();assert.equal(h.styles.get('--duat-week-action-height'),'208px');h.setHeight(145);h.events.get('resize')();assert.equal(h.styles.get('--duat-week-action-height'),'145px');h.unmount();assert(h.observers[0].disconnected);assert.equal(h.events.size,0);assert.equal(h.styles.size,0);
});
test('pending recruit completion focuses the existing fixed action without jumping the content or invoking anything',()=>{
    const h=mount();h.render({stage:'favors',pendingRecruit:true});h.calls.length=0;h.render({pendingRecruit:false});assert.deepEqual(h.calls,['action focus']);h.render();assert.deepEqual(h.calls,['action focus']);
});
test('lineup feedback follows authoritative legality and current selected count without storing a second lineup',()=>{
    const h=mount();let checks=0;h.App.DuatCampaign={activeArmy:()=>({players:[]}),settingsOf:()=>({roster:'test'}),ROSTERS:{test:{slots:['QB','RB','WR']}},legalLineup:(_f,lineup)=>{checks++;return lineup.join(',')==='q,r,w';}};
    const props={campaign:{factions:[{id:'f'}]},factionId:'f',onChange(){}};
    assert.match(text(h.App.DuatWeeklyUI.Preparation({...props,lineup:['q']})),/1\s*\/\s*3\s*starters.*Choose 2 more/);
    const invalid=h.App.DuatWeeklyUI.Preparation({...props,lineup:['q','q2','w']});assert.match(text(invalid),/Check the starting positions/);assert.equal(nodes(invalid).find(node=>node.type==='details').props.open,true);
    assert.match(text(h.App.DuatWeeklyUI.Preparation({...props,lineup:['q','r','w','extra']})),/Move 1 to the bench/);
    assert.match(text(h.App.DuatWeeklyUI.Preparation({...props,lineup:['q','r','w']})),/Lineup complete/);assert.equal(checks,4);
});
