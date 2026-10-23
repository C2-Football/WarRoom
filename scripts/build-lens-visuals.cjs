#!/usr/bin/env node
'use strict';
// Pinned, self-hosted runtime. Generated model output is never executable code.
const path = require('node:path');
const fs = require('node:fs');
const esbuild = require('esbuild');
const root = path.resolve(__dirname, '..');
const outfile = path.join(root, 'js/vendor/lens-visuals.js');
const source = `
import {compile} from 'vega-lite';
import {parse, View} from 'vega';
import {expressionInterpreter} from 'vega-interpreter';
const deny = () => Promise.reject(new Error('Lens graphics cannot load external resources.'));
const loader = {load:deny, sanitize:deny, http:deny, file:deny};
function fitLegends(spec,rows,width,height) {
    const channels=['color','fill','stroke','shape','size','opacity','strokeDash'];
    for(const node of [spec,...(spec.layer || [])]) {
        for(const channel of channels) {
            const field=node.encoding?.[channel];
            if(!field?.field || field.legend===null) continue;
            const requested=field.legend || {},orient=requested.orient || 'bottom';
            const side=orient==='left' || orient==='right';
            const available=Math.max(48,side ? Math.min(180,width*.3) : width-20);
            const direction=requested.direction || (side ? 'vertical' : 'horizontal');
            const gradient=['color','fill','stroke'].includes(channel) && ['quantitative','temporal'].includes(field.type) && !field.bin && !['ordinal','band','point'].includes(field.scale?.type);
            const labelLimit=Math.min(requested.labelLimit || 160,Math.max(20,available-32));
            if(gradient) {
                field.legend={...requested,direction,labelLimit:side ? labelLimit : {expr:'max(20,min('+labelLimit+',width-32))'},titleLimit:side ? available : {expr:'max(20,min('+available+',width))'},gradientLength:direction==='horizontal' && !side ? {expr:'max(40,min(200,width-20))'} : Math.max(40,Math.min(200,height-60))};
                continue;
            }
            const longest=rows.reduce((length,row)=>Math.max(length,String(row[field.field] ?? '').length),0);
            const entryWidth=Math.min(labelLimit,Math.max(24,longest*8))+32;
            const fitting=Math.max(1,Math.floor(available/entryWidth));
            const columns=Math.min(requested.columns || (direction==='vertical' ? 1 : 8),fitting);
            // width is Vega's final plot width, after axis gutters. These
            // app-owned expressions use the same AST interpreter as the chart.
            field.legend={...requested,columns:side ? columns : {expr:'max(1,min('+columns+',floor(width/'+entryWidth+')))'},direction:columns===1 ? 'vertical' : direction,labelLimit:side ? labelLimit : {expr:'max(20,min('+labelLimit+',width-32))'},titleLimit:side ? available : {expr:'max(20,min('+available+',width))'},columnPadding:12,rowPadding:5};
        }
    }
    return spec;
}
function createView({spec,rows,fields,container,width=640,height=320,accent='#66d9c5',renderer='svg'}) {
    const chartWidth=Math.max(120,Math.floor(width));
    const safe = window.WR.LensComposition.validateVisual(spec, fields);
    fitLegends(safe,rows,chartWidth,safe.height || height);
    const compiled = compile({...safe, width:chartWidth, height:safe.height || height,
        data:{values:rows}, background:'transparent',
        autosize:{type:'fit',contains:'padding',resize:true},
        config:{view:{stroke:null},font:'Inter,system-ui,sans-serif',
            axis:{labelColor:'#c6cedb',titleColor:'#e9edf5',gridColor:'#ffffff14',domainColor:'#ffffff30',tickColor:'#ffffff30',labelFontSize:11,titleFontSize:12,labelLimit:140,titlePadding:12},
            legend:{labelColor:'#c6cedb',titleColor:'#e9edf5',labelFontSize:11,orient:'bottom'},
            mark:{color:accent},range:{category:[accent,'#e9b76f','#90a9ff','#ee8fab','#a5cf8d','#c0a0e9']}}
    },{logger:{warn:()=>{},info:()=>{},debug:()=>{},error:message=>{throw new Error(message);}}}).spec;
    const runtime=parse(compiled,null,{ast:true});
    const view=new View(runtime,{expr:expressionInterpreter,renderer,loader,hover:true,logLevel:0});
    if(container) view.initialize(container);
    return view;
}
window.WR=window.WR||{};
window.WR.LensVisualRuntime={version:'vega6.4.0-lite6.5.0-interpreter2.3.2',createView};
`;
esbuild.build({stdin:{contents:source,resolveDir:root,sourcefile:'lens-visuals-entry.js',loader:'js'},outfile,bundle:true,minify:true,format:'iife',platform:'browser',target:['es2020'],legalComments:'eof',metafile:true,logLevel:'warning'}).then(result=>{
    const packages=new Set(Object.keys(result.metafile.inputs).map(file=>file.match(/(?:^|\/)node_modules\/((?:@[^/]+\/)?[^/]+)/)?.[1]).filter(Boolean));
    const licenses=[...packages].sort().map(name=>{
        const directory=path.join(root,'node_modules',name),info=JSON.parse(fs.readFileSync(path.join(directory,'package.json'),'utf8'));
        const file=fs.readdirSync(directory).find(file=>/^(?:license|licence|copying)(?:\.(?:md|txt))?$/i.test(file));
        if(!file) throw new Error('Missing redistribution license for '+name);
        return name+' '+info.version+'\n'+fs.readFileSync(path.join(directory,file),'utf8').trim();
    });
    fs.writeFileSync(outfile.replace(/\.js$/,'.LICENSE.txt'),licenses.join('\n\n'+'='.repeat(72)+'\n\n')+'\n');
    fs.appendFileSync(outfile,'\n/*! Third-party licenses: lens-visuals.LICENSE.txt */\n');
    console.log('Built self-hosted lens graphics runtime and redistribution licenses.');
}).catch(error=>{console.error(error);process.exitCode=1;});
