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
function createView({spec,rows,fields,container,width=640,height=320,accent='#66d9c5',renderer='svg'}) {
    const safe = window.WR.LensComposition.validateVisual(spec, fields);
    const compiled = compile({...safe, width:Math.max(120,Math.floor(width)), height:safe.height || height,
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
