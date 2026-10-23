(function () {
    'use strict';
    const {useEffect,useMemo,useRef,useState}=React;
    let runtimePromise;
    function loadRuntime() {
        if(window.WR.LensVisualRuntime) return Promise.resolve(window.WR.LensVisualRuntime);
        if(runtimePromise) return runtimePromise;
        runtimePromise=new Promise((resolve,reject)=>{
            const declared=document.querySelector('script[data-lens-visuals-runtime]');
            const src=new URL(declared?.getAttribute('src') || 'js/vendor/lens-visuals.js',document.baseURI);
            if(src.origin!==window.location.origin) { reject(new Error('Graphics must load from this app.')); return; }
            const script=document.createElement('script'); script.src=src.href;script.async=true;
            if(declared?.nonce) script.nonce=declared.nonce;
            const timeout=setTimeout(()=>{script.remove();reject(new Error('Graphics took too long to load.'));},25000);
            script.onload=()=>{clearTimeout(timeout);window.WR.LensVisualRuntime ? resolve(window.WR.LensVisualRuntime) : reject(new Error('Graphics are unavailable.'));};
            script.onerror=()=>{clearTimeout(timeout);script.remove();reject(new Error('Graphics are unavailable.'));};
            document.head.appendChild(script);
        }).catch(error=>{runtimePromise=null;throw error;});
        return runtimePromise;
    }
    function format(value,field) {
        if(value==null || (typeof value==='number'&&!Number.isFinite(value))) return 'Unavailable';
        if(field?.type==='date') { const date=new Date(value); return Number.isFinite(date.getTime()) ? date.toLocaleDateString(undefined,{year:'numeric',month:'short',day:'numeric'}) : 'Unavailable'; }
        if(typeof value==='boolean') return value ? 'Yes' : 'No';
        if(typeof value==='number') return value.toLocaleString(undefined,{maximumFractionDigits:2})+(field?.unit==='percent' ? '%' : '');
        return String(value);
    }
    function timestamp(value) { const date=new Date(value); return value && Number.isFinite(date.getTime()) ? date.toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short'}) : 'Timestamp unavailable'; }
    function DataTable({dataset,columns,title,expanded=false}) {
        const fields=(columns || dataset.fields.map(field=>field.id)).map(id=>dataset.fields.find(field=>field.id===id));
        const first=fields[0];
        const priorities=['position','teamRecord','ppg','value'];
        const summaryFields=[...priorities.map(id=>fields.find(field=>field.id===id)).filter(Boolean),...fields.slice(1)].filter((field,index,all)=>field.id!==first.id && all.findIndex(item=>item.id===field.id)===index).slice(0,4);
        const ownerField=fields.find(field=>field.id==='teamName' && field.id!==first.id);
        if(!dataset.rows.length) return <p className="lens-composition-empty">{dataset.status==='unavailable' ? 'This data is unavailable.' : 'No reported rows match this view.'}</p>;
        return <div className="lens-composition-data" data-lens-interactive="true">
            <div className="lens-composition-table-wrap" tabIndex="0" role="region" aria-label={title+' data table'} data-alex-scroll="true" data-lens-interactive="true">
                <table><caption className="lens-visually-hidden">{title}: {dataset.rows.length} reported rows</caption><thead><tr>{fields.map(field=><th key={field.id} scope="col">{field.label}{field.unit && field.unit!=='percent' ? <small>{field.unit}</small> : null}</th>)}</tr></thead><tbody>{dataset.rows.map((row,index)=><tr key={index}>{fields.map((field,col)=>col===0 ? <th scope="row" key={field.id}>{format(row[field.id],field)}</th> : <td key={field.id}>{format(row[field.id],field)}</td>)}</tr>)}</tbody></table>
            </div>
            {expanded && <div className="lens-composition-row-details">{dataset.rows.map((row,index)=><details key={index} data-lens-interactive="true"><summary data-lens-interactive="true"><span className="lens-composition-row-number">{index+1}</span><span className="lens-composition-row-name">{format(row[first.id],first)}{ownerField && <small>{format(row[ownerField.id],ownerField)}</small>}</span><span className="lens-composition-expand" aria-hidden="true">+</span><span className="lens-composition-row-facts">{summaryFields.map(field=><span key={field.id}><small>{field.label}</small><strong>{format(row[field.id],field)}</strong></span>)}</span></summary><dl>{dataset.fields.map(field=><div key={field.id}><dt>{field.label}{field.unit && field.unit!=='percent' ? ' ('+field.unit+')' : ''}</dt><dd>{format(row[field.id],field)}</dd></div>)}</dl></details>)}</div>}
        </div>;
    }
    function Chart({block,dataset,accent}) {
        const host=useRef(null),[width,setWidth]=useState(0),[state,setState]=useState('loading');
        const visual=width>0 && width<500 && block.mobileVisual ? block.mobileVisual : block.visual;
        const plottable=window.WR.LensComposition.hasPlottableData(visual,dataset);
        useEffect(()=>{
            const element=host.current; if(!element) return;
            let frame=0,lastWidth=0,disposed=false;
            const measure=()=>{frame=0;if(disposed)return;const next=Math.max(120,Math.floor(element.getBoundingClientRect().width));if(next!==lastWidth){lastWidth=next;setWidth(next);}};
            // SVG height changes also trigger observers. Schedule width changes
            // outside the observer delivery cycle to avoid WebKit resize loops.
            const schedule=()=>{if(!frame)frame=window.requestAnimationFrame(measure);};
            schedule(); const observer=typeof ResizeObserver==='function' ? new ResizeObserver(schedule) : null;
            observer?.observe(element); window.addEventListener('resize',schedule);
            return ()=>{disposed=true;observer?.disconnect();window.removeEventListener('resize',schedule);if(frame)window.cancelAnimationFrame(frame);};
        },[]);
        useEffect(()=>{
            if(!width || !host.current || !plottable) return;
            let cancelled=false,view; setState('loading');
            const y=visual.encoding?.y || visual.layer?.find(layer=>layer.encoding?.y)?.encoding.y;
            const rowHeight=y && ['nominal','ordinal'].includes(y.type) ? Math.min(900,Math.max(260,dataset.rows.length*25)) : width<500 ? 290 : 340;
            loadRuntime().then(async runtime=>{
                if(cancelled) return;
                host.current.replaceChildren();
                view=runtime.createView({container:host.current,spec:visual,rows:dataset.rows,fields:dataset.fields,width,height:rowHeight,accent});
                await view.runAsync();
                // Axis gutters settle the plot width first. Refit after that
                // width determines the wrapped legend's final number of rows.
                if(cancelled) return;
                await view.resize().runAsync();
                if(!cancelled) setState('ready');
            }).catch(()=>{if(!cancelled){view?.finalize();host.current?.replaceChildren();setState('error');}});
            return ()=>{cancelled=true;view?.finalize();};
        },[visual,dataset,width,accent,plottable]);
        const missing=dataset.status==='unavailable' || !dataset.rows.length;
        return <div className="lens-composition-chart">
            <div ref={host} className="lens-composition-graphic" role="img" aria-hidden={!plottable || state==='error' ? true : undefined} aria-label={block.title+'. The same values are available in the data table below.'} style={{height:!plottable || state==='error' ? 0 : undefined,minHeight:!plottable || state==='error' ? 0 : undefined}} />
            {missing ? <p className="lens-composition-empty">{dataset.status==='unavailable' ? 'This data is unavailable.' : 'No reported rows match this view.'}</p> : !plottable ? <p className="lens-composition-empty" role="status">The values needed for this graphic have not been reported. Available details are shown below.</p> : state==='loading' ? <p className="lens-composition-chart-status" role="status">Drawing your graphic…</p> : state==='error' ? <p className="lens-composition-chart-status" role="status">This graphic could not render. The reported data is available below.</p> : null}
            {!missing && <details className="lens-composition-evidence" open={state==='error' || !plottable ? true : undefined} data-lens-interactive="true"><summary data-lens-interactive="true">View data · {dataset.rows.length} rows</summary><DataTable dataset={dataset} title={block.title} /></details>}
        </div>;
    }
    function Block({block,composition}) {
        const dataset=composition.datasets.find(item=>item.id===block.datasetId);
        const field=dataset?.fields.find(item=>item.id===block.field);
        return <section className={'lens-composition-block lens-composition-'+block.kind} data-lens-block={block.id} style={{'--lens-span':block.span,'--lens-tablet-span':block.tabletSpan}} aria-label={block.title}>
            <header><h3>{block.title}</h3></header>
            {block.kind==='chart' && <Chart block={block} dataset={dataset} accent={composition.theme.accent} />}
            {block.kind==='table' && <DataTable dataset={dataset} columns={block.columns} title={block.title} expanded={true} />}
            {block.kind==='metric' && <div className="lens-composition-metric-value">{format(dataset.status==='unavailable' ? null : dataset.rows[0]?.[block.field],field)}{field.unit && field.unit!=='percent' && <small>{field.unit}</small>}</div>}
        </section>;
    }
    function LensCompositionView({composition}) {
        const checked=useMemo(()=>{try{return {value:window.WR.LensComposition.validate(composition)};}catch(error){return {error:error.message};}},[composition]);
        if(checked.error) return <div className="lens-composition-invalid" role="alert">This saved lens could not be displayed. {checked.error}</div>;
        const doc=checked.value;
        return <article className={'lens-composition lens-composition-style-'+doc.theme.style} style={{'--lens-accent':doc.theme.accent}} data-lens-composition="true">
            <header className="lens-composition-heading"><h2>{doc.title}</h2></header>
            <div className="lens-composition-grid">{doc.blocks.filter(block=>block.kind!=='text').map(block=><Block key={block.id} block={block} composition={doc} />)}</div>
            {(doc.sources.length>0 || doc.datasets.length>0 || doc.research.notes) && <details className="lens-composition-research" data-lens-interactive="true"><summary data-lens-interactive="true">Research and sources · {doc.sources.length}</summary><small>Researched {timestamp(doc.research.createdAt)}</small>{doc.research.notes && <p>{doc.research.notes}</p>}{doc.datasets.length>0 && <ol className="lens-composition-snapshots" aria-label="Data snapshots">{doc.datasets.map(dataset=><li key={dataset.id}><strong>{doc.blocks.find(block=>block.datasetId===dataset.id)?.title || dataset.source}</strong>{dataset.note && <p>{dataset.note}</p>}<small>{dataset.asOf ? 'Data as of '+timestamp(dataset.asOf) : 'Snapshot timestamp unavailable'}</small></li>)}</ol>}<ol aria-label="Sources">{doc.sources.map(source=><li key={source.id}>{source.url ? <a href={source.url} target="_blank" rel="noopener noreferrer" data-lens-source="true">{source.title} ↗</a> : <strong>{source.title}</strong>}{source.note && <p>{source.note}</p>}<small>{source.asOf ? 'As of '+timestamp(source.asOf) : 'Snapshot timestamp unavailable'}</small></li>)}</ol></details>}
        </article>;
    }
    window.WR=window.WR||{};
    window.WR.LensCompositionView=LensCompositionView;
    window.WR.LensCompositionDataTable=DataTable;
})(window);
