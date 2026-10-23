/* global module */
(function (root) {
    'use strict';
    const LIMITS = { blocks: 24, datasets: 16, rows: 300, totalRows: 1200, fields: 40, sources: 40, bytes: 450000 };
    const ID = /^[A-Za-z][A-Za-z0-9_-]{0,79}$/;
    const HEX = /^#[0-9a-f]{6}$/i;
    const BAD = new Set(['__proto__', 'prototype', 'constructor']);
    const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) && Object.prototype.toString.call(value) === '[object Object]';
    const fail = message => { throw new Error(message); };
    function keys(value, allowed, label) {
        const permitted=' Allowed keys: '+allowed.join(', ')+'.';
        if (!plain(value)) fail('Invalid '+label+': expected an object.'+permitted);
        const unsupported=Object.keys(value).filter(key=>BAD.has(key) || !allowed.includes(key));
        if (unsupported.length) fail('Unsupported '+label+' '+(unsupported.length===1 ? 'key' : 'keys')+': '+unsupported.slice(0,4).map(key=>JSON.stringify(key.slice(0,80))).join(', ')+(unsupported.length>4 ? ', …' : '')+'.'+permitted);
    }
    function string(value, max, label, optional = false) {
        if (value == null && optional) return undefined;
        if (typeof value !== 'string' || value.length > max || (!optional && !value.trim())) fail('Invalid ' + label + '.');
        return value.trim();
    }
    function id(value) { if (typeof value !== 'string' || !ID.test(value) || BAD.has(value)) fail('Invalid lens identifier.'); return value; }
    function choice(value, allowed, label) { if (!allowed.includes(value)) fail('Unsupported ' + label + '.'); return value; }
    function number(value, min, max, label) { if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) fail('Invalid ' + label + '.'); return value; }
    function list(value, max, label) { if (!Array.isArray(value) || value.length > max) fail('Too many or invalid ' + label + '.'); return value; }
    function unique(items, label) { if (new Set(items.map(item => item.id)).size !== items.length) fail('Duplicate ' + label + '.'); return items; }
    function references(value, available) { return [...new Set(list(value || [], LIMITS.sources, 'sources').map(key => { id(key); if (!available.has(key)) fail('A source reference is missing.'); return key; }))]; }
    function color(value) { if (typeof value !== 'string' || !(HEX.test(value) || ['transparent','white','black'].includes(value))) fail('Use a six-digit hex color.'); return value; }
    function boundedJSON(value, depth = 0) {
        if (depth > 5) fail('Lens query is too deeply nested.');
        if (value == null || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) return value;
        if (typeof value === 'string') return string(value, 2000, 'query value', true);
        if (Array.isArray(value)) return list(value, 100, 'query values').map(item => boundedJSON(item, depth + 1));
        if (!plain(value) || Object.keys(value).some(key => BAD.has(key)) || Object.keys(value).length > 40) fail('Invalid lens query.');
        return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, boundedJSON(item, depth + 1)]));
    }
    const fieldType = type => ({ quantitative: 'number', nominal: 'string', ordinal: 'string', temporal: 'date' })[type] || choice(type, ['number','string','date','boolean'], 'field type');
    const markTypes = ['bar','line','area','point','circle','square','tick','rule','text','rect','arc'];
    const aggregates = ['count','sum','mean','average','min','max','median','distinct','valid','missing'];
    const channels = ['x','y','x2','y2','color','fill','stroke','size','shape','opacity','text','tooltip','detail','order','theta','theta2','radius','radius2','xOffset','yOffset','strokeDash'];
    function mark(input) {
        if (typeof input === 'string') return choice(input, markTypes, 'chart mark');
        keys(input, ['type','color','fill','stroke','opacity','size','strokeWidth','cornerRadius','filled','point','line','orient','interpolate','innerRadius','outerRadius','angle','dx','dy','align','baseline','fontSize','fontWeight','clip'], 'mark settings');
        const result = { type: choice(input.type, markTypes, 'chart mark') };
        for (const [key,value] of Object.entries(input)) {
            if (key === 'type') continue;
            if (['color','fill','stroke'].includes(key)) result[key] = color(value);
            else if (['filled','point','line','clip'].includes(key)) { if (typeof value !== 'boolean') fail('Invalid chart toggle.'); result[key] = value; }
            else if (key === 'orient') result[key] = choice(value, ['horizontal','vertical'], 'mark orientation');
            else if (key === 'interpolate') result[key] = choice(value, ['linear','step','step-before','step-after','monotone'], 'line interpolation');
            else if (key === 'align') result[key] = choice(value, ['left','center','right'], 'text alignment');
            else if (key === 'baseline') result[key] = choice(value, ['top','middle','bottom','alphabetic'], 'text baseline');
            else if (key === 'fontWeight') result[key] = choice(value, ['normal','bold',400,500,600,700,800], 'font weight');
            else result[key] = number(value, ['dx','dy','angle'].includes(key) ? -360 : 0, key === 'opacity' ? 1 : key === 'size' ? 2000 : 360, 'mark ' + key);
        }
        return result;
    }
    function axis(input) {
        if (input === null) return null;
        keys(input, ['title','labels','ticks','grid','domain','labelAngle','labelLimit','labelFontSize','titleFontSize','tickCount','format','orient','titlePadding'], 'axis');
        const out = {};
        for (const [key,value] of Object.entries(input)) {
            if (['labels','ticks','grid','domain'].includes(key)) { if (typeof value !== 'boolean') fail('Invalid axis toggle.'); out[key] = value; }
            else if (key === 'orient') out[key] = choice(value, ['top','bottom','left','right'], 'axis position');
            else if (['title','format'].includes(key)) out[key] = value === null && key === 'title' ? null : string(value, 120, 'axis label', true);
            else out[key] = number(value, key === 'labelAngle' ? -180 : 0, key === 'labelLimit' ? 500 : 180, 'axis size');
        }
        return out;
    }
    function scale(input,channel) {
        if (input === null) {
            if (['color','fill','stroke','shape'].includes(channel)) fail('Visual properties must use a safe scale.');
            return null;
        }
        keys(input, ['zero','nice','reverse','clamp','domain','range','scheme','type','padding','paddingInner','paddingOuter'], 'scale');
        const out = {};
        for (const [key,value] of Object.entries(input)) {
            if (['zero','nice','reverse','clamp'].includes(key)) { if (typeof value !== 'boolean') fail('Invalid scale toggle.'); out[key] = value; }
            else if (key === 'type') out[key] = choice(value, ['linear','log','sqrt','symlog','pow','time','utc','ordinal','band','point'], 'scale type');
            else if (key === 'scheme') out[key] = choice(value, ['tableau10','category10','blues','greens','oranges','purples','reds','tealblues','viridis','magma','inferno','plasma','cividis','redblue','redyellowblue','spectral','turbo'], 'color scheme');
            else if (key === 'domain' || key === 'range') out[key] = list(value, 100, 'scale values').map(item => {
                if (key==='range' && ['color','fill','stroke'].includes(channel)) return color(item);
                if (key==='range' && channel==='shape') return choice(item,['circle','square','cross','diamond','triangle-up','triangle-down','triangle-left','triangle-right','stroke'],'symbol shape');
                if (key==='range') return number(item,-1e6,1e6,'scale range');
                return typeof item === 'number' ? number(item,-1e12,1e12,'scale value') : string(item,120,'scale value');
            });
            else out[key] = number(value, 0, 1, 'scale padding');
        }
        return out;
    }
    function legend(input) {
        if (input === null) return null;
        keys(input, ['title','orient','direction','columns','labelLimit'], 'legend');
        const out = {};
        for (const [key,value] of Object.entries(input)) {
            if (key === 'title') out[key] = value === null ? null : string(value,120,'legend title',true);
            else if (key === 'orient') out[key] = choice(value,['top','bottom','left','right','none'],'legend position');
            else if (key === 'direction') out[key] = choice(value,['horizontal','vertical'],'legend direction');
            else out[key] = number(value,1,key === 'columns' ? 8 : 300,'legend size');
        }
        return out;
    }
    function encodingValue(input, fields, channel) {
        if (Array.isArray(input)) {
            if (!['tooltip','detail','order'].includes(channel)) fail('This encoding cannot contain a list.');
            return list(input,12,'encoding fields').map(value => encodingValue(value,fields,channel));
        }
        keys(input, ['field','type','title','aggregate','bin','timeUnit','sort','axis','scale','legend','format','stack','value'], 'encoding');
        if ('value' in input) {
            if (Object.keys(input).length !== 1) fail('A constant cannot also bind a field.');
            let value = input.value;
            if (['color','fill','stroke'].includes(channel)) value = color(value);
            else if (['opacity','size','x','x2','y','y2','theta','theta2','radius','radius2'].includes(channel)) value = number(value,0,channel === 'opacity' ? 1 : 2000,'encoding constant');
            else value = typeof value === 'number' ? number(value,-1e12,1e12,'encoding constant') : string(value,160,'encoding constant',true);
            return { value };
        }
        const definition = input.field && fields.find(field => field.id === input.field);
        if (!definition && !(input.aggregate === 'count' && input.field == null)) fail('A chart references a field outside its dataset.');
        if (definition?.unit==='percent' && !['count','distinct','valid','missing'].includes(input.aggregate) && input.stack!=='normalize') {
            // D3's % and p formats multiply by 100. Reported percentages are
            // already percentage points; normalized stacks are ratios instead.
            const formats=[input.format,input.axis?.format,input.legend?.format];
            if (formats.some(value=>typeof value==='string' && /[%p]$/.test(value.trim()))) fail('Percent fields already use 0–100 values. Use a numeric format such as .0f and a % axis title; .0% would display 50 as 5000%.');
        }
        const out = definition ? { field: definition.id } : {};
        if (input.type != null) {
            out.type = choice(input.type,['quantitative','nominal','ordinal','temporal'],'encoding type');
            if (out.type === 'quantitative' && definition && definition.type !== 'number' && !['count','distinct','valid','missing'].includes(input.aggregate)) fail('Quantitative axes need numeric fields.');
            if (out.type === 'temporal' && definition?.type !== 'date') fail('Temporal axes need reported dates.');
        } else if (definition) out.type = ({number:'quantitative',string:'nominal',date:'temporal',boolean:'nominal'})[definition.type];
        else out.type = 'quantitative';
        if (input.aggregate != null) { out.aggregate = choice(input.aggregate,aggregates,'aggregate'); if (!['count','distinct','valid','missing'].includes(out.aggregate) && definition?.type !== 'number') fail('This aggregate needs a numeric field.'); }
        if (input.bin != null) {
            if (definition?.type !== 'number') fail('Bins need a numeric field.');
            if (typeof input.bin === 'boolean') out.bin = input.bin;
            else { keys(input.bin,['maxbins'],'bin'); out.bin = {maxbins:number(input.bin.maxbins,2,50,'bin count')}; }
        }
        if (input.timeUnit != null) { if (definition?.type !== 'date') fail('Time units need a date field.'); out.timeUnit = choice(input.timeUnit,['year','quarter','month','week','day','date','hours','yearmonth','yearmonthdate','monthdate','hoursminutes'],'time unit'); }
        if (input.sort !== undefined) {
            if (input.sort === null || ['ascending','descending','x','y','-x','-y'].includes(input.sort)) out.sort = input.sort;
            else if (Array.isArray(input.sort)) out.sort = list(input.sort,100,'sort values').map(item => typeof item === 'number' ? number(item,-1e12,1e12,'sort value') : string(item,200,'sort value',true));
            else { keys(input.sort,['field','op','order'],'sort'); if (!fields.some(field=>field.id===input.sort.field)) fail('Unknown sort field.'); out.sort={field:input.sort.field,...(input.sort.op ? {op:choice(input.sort.op,aggregates,'sort aggregate')} : {}),...(input.sort.order ? {order:choice(input.sort.order,['ascending','descending'],'sort order')} : {})}; }
        }
        if (input.axis !== undefined) out.axis = axis(input.axis);
        if (input.scale !== undefined) out.scale = scale(input.scale,channel);
        if (input.legend !== undefined) out.legend = legend(input.legend);
        if (input.title !== undefined) out.title = input.title === null ? null : string(input.title,160,'encoding title',true);
        if (input.format !== undefined) out.format = string(input.format,80,'number format',true);
        if (input.stack !== undefined) out.stack = choice(input.stack,[null,'zero','normalize','center'],'stack');
        return out;
    }
    function validateVisual(input, fields) {
        let depth = 0;
        function node(value, layered) {
            if (++depth > 7) fail('Too many chart layers.');
            keys(value,layered ? ['mark','encoding'] : ['mark','encoding','layer','height'],'chart specification');
            const out = {};
            if (value.mark != null) out.mark = mark(value.mark);
            if (value.encoding != null) { keys(value.encoding,channels,'encoding channels'); out.encoding=Object.fromEntries(Object.entries(value.encoding).map(([channel,def])=>[channel,encodingValue(def,fields,channel)])); }
            if (value.layer != null) { if (out.mark) fail('Choose a mark or layers, not both.'); if (!value.layer.length) fail('A layered chart needs layers.'); out.layer=list(value.layer,6,'chart layers').map(child=>node(child,true)); }
            if (!out.mark && !out.layer) fail('A chart needs a mark or layers.');
            if (value.height !== undefined) out.height=number(value.height,160,900,'chart height');
            return out;
        }
        return node(input,false);
    }
    function hasPlottableData(visual,dataset) {
        if (!dataset?.rows?.length || dataset.status==='unavailable') return false;
        const layers=visual.layer || [visual];
        return layers.some(layer=>{
            const encoding={...(visual.encoding || {}),...(layer.encoding || {})};
            const markType=typeof layer.mark==='string' ? layer.mark : layer.mark?.type;
            const channels=['x','y','x2','y2','theta','theta2','radius','radius2',...(markType==='text' ? ['text'] : [])];
            const positions=channels.map(channel=>encoding[channel]).filter(value=>value && !Array.isArray(value));
            const required=positions.filter(value=>value.field && !['count','valid','missing','distinct'].includes(value.aggregate));
            const counted=positions.some(value=>['count','valid','missing','distinct'].includes(value.aggregate));
            if (!required.length) return counted;
            return dataset.rows.some(row=>required.every(value=>row[value.field]!=null && (typeof row[value.field]!=='number' || Number.isFinite(row[value.field]))));
        });
    }
    function validate(input) {
        let serialized; try { serialized = JSON.stringify(input); } catch (_) { fail('Lens contains unsupported data.'); }
        if (!serialized || serialized.length > LIMITS.bytes) fail('This lens is too large. Ask Alex to use fewer rows.');
        keys(input,['version','title','subtitle','theme','blocks','datasets','sources','research'],'lens composition');
        if (input.version !== 1) fail('Unsupported lens composition version.');
        const title=string(input.title,160,'lens title'), subtitle=string(input.subtitle,600,'lens subtitle',true);
        keys(input.theme,['accent','style'],'lens theme');
        const theme={accent:color(input.theme.accent),style:choice(input.theme.style,['editorial','analytic','bold'],'lens style')};
        const sources=unique(list(input.sources,LIMITS.sources,'sources').map(source=>{
            keys(source,['id','title','url','asOf','note'],'source');
            const result={id:id(source.id),title:string(source.title,240,'source title'),asOf:string(source.asOf,80,'source timestamp',true)||''};
            if (source.note != null) result.note=string(source.note,1200,'source note',true);
            if (source.url != null) { let url; try { url=new URL(source.url); } catch (_) { fail('Invalid source link.'); } if (url.protocol!=='https:' || url.username || url.password || url.href.length>2000) fail('Source links must use HTTPS.'); result.url=url.href; }
            return result;
        }),'source identifiers');
        const sourceIds=new Set(sources.map(source=>source.id)); let rowCount=0;
        const datasets=unique(list(input.datasets,LIMITS.datasets,'datasets').map(dataset=>{
            keys(dataset,['id','source','fields','rows','status','note','asOf','sourceIds','query'],'dataset');
            const fields=unique(list(dataset.fields,LIMITS.fields,'fields').map(field=>{ keys(field,['id','label','type','unit'],'field'); return {id:id(field.id),label:string(field.label,120,'field label'),type:fieldType(field.type),...(field.unit != null ? {unit:string(field.unit,80,'field unit',true)} : {})}; }),'field identifiers');
            if (!fields.length) fail('A dataset needs fields.');
            const rows=list(dataset.rows,LIMITS.rows,'dataset rows').map(row=>{ keys(row,fields.map(field=>field.id),'data row'); return Object.fromEntries(fields.map(field=>{ const value=row[field.id]; if (value==null) return [field.id,null]; if (field.type==='number') return [field.id,number(value,-1e15,1e15,'numeric value')]; if (field.type==='boolean') { if (typeof value!=='boolean') fail('Invalid boolean value.'); return [field.id,value]; } const text=string(value,2000,'data value',true); if (field.type==='date' && !Number.isFinite(Date.parse(text))) fail('Invalid reported date.'); return [field.id,text]; })); });
            rowCount+=rows.length; if (rowCount>LIMITS.totalRows) fail('This lens has too many rows.');
            const result={id:id(dataset.id),source:string(dataset.source,160,'dataset source'),fields,rows,status:choice(dataset.status,['ready','partial','empty','unavailable'],'dataset status'),sourceIds:references(dataset.sourceIds,sourceIds),asOf:string(dataset.asOf,80,'dataset timestamp',true)||'',note:string(dataset.note,2000,'dataset note',true)||''};
            if (dataset.query!=null) { keys(dataset.query,['id','source','columns','filters','sort','limit','params','groupBy','aggregate'],'saved query'); result.query=boundedJSON(dataset.query); if (JSON.stringify(result.query).length>6000) fail('Saved query is too large.'); }
            return result;
        }),'dataset identifiers');
        const blocks=unique(list(input.blocks,LIMITS.blocks,'blocks').map(block=>{
            keys(block,['id','kind','title','subtitle','datasetId','visual','mobileVisual','columns','field','body','sourceIds','span','tabletSpan'],'composition block');
            const result={id:id(block.id),kind:choice(block.kind,['chart','table','metric','text'],'block type'),title:string(block.title,160,'block title'),sourceIds:references(block.sourceIds,sourceIds),span:choice(block.span ?? 12,[12,8,6,4],'desktop width'),tabletSpan:choice(block.tabletSpan ?? 12,[12,6],'tablet width')};
            if (block.subtitle!=null) result.subtitle=string(block.subtitle,600,'block subtitle',true);
            const dataset=datasets.find(item=>item.id===block.datasetId);
            if (result.kind!=='text' && !dataset) fail('A data block needs a connected dataset.');
            if (block.datasetId!=null) { if (!dataset) fail('Unknown dataset.'); result.datasetId=dataset.id; }
            if (result.kind==='chart') { result.visual=validateVisual(block.visual,dataset.fields); if(block.mobileVisual!=null) result.mobileVisual=validateVisual(block.mobileVisual,dataset.fields); }
            else if (block.visual!=null || block.mobileVisual!=null) fail('Only charts accept visual specifications.');
            if (result.kind==='table') { result.columns=list(block.columns || dataset.fields.map(field=>field.id),LIMITS.fields,'table columns').map(key=>{ if (!dataset.fields.some(field=>field.id===key)) fail('Unknown table column.'); return key; }); if (!result.columns.length || new Set(result.columns).size!==result.columns.length) fail('Choose distinct table columns.'); }
            else if (block.columns!=null) fail('Only tables accept columns.');
            if (result.kind==='metric') { if (!dataset.fields.some(field=>field.id===block.field && field.type==='number')) fail('A metric needs a numeric field.'); if (dataset.rows.length>1) fail('A metric needs a dataset with a single result.'); result.field=block.field; }
            else if(block.field!=null) fail('Only metrics accept a field.');
            if(result.kind==='text') result.body=string(block.body,4000,'text block',true)||'';
            else if(block.body!=null) fail('Only text blocks accept prose.');
            return result;
        }),'block identifiers');
        if (!blocks.length) fail('A composition needs at least one block.');
        keys(input.research,['prompt','createdAt','notes'],'research record');
        const research={prompt:string(input.research.prompt,4000,'research prompt',true)||'',createdAt:string(input.research.createdAt,80,'research timestamp')};
        if(input.research.notes!=null) research.notes=string(input.research.notes,4000,'research notes',true);
        return {version:1,title,...(subtitle ? {subtitle} : {}),theme,blocks,datasets,sources,research};
    }
    root.WR=root.WR||{};
    root.WR.LensComposition={validate,validateVisual,hasPlottableData,LIMITS};
    if(typeof module==='object' && module.exports) module.exports=root.WR.LensComposition;
})(typeof window!=='undefined' ? window : globalThis);
