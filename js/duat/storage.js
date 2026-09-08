/* global module, require */
(function(root){
    'use strict';
    const KEY='dhq-duat-campaigns-v1', PREFIX='dhq-duat-campaign-v1:', COMPRESSED='DUAT4:LZ16:';
    const codec=()=>typeof module!=='undefined'&&module.exports?require('./vendor/lz-string-1.5.0.js'):root.LZString;
    const checksum=value=>{let hash=2166136261;for(let i=0;i<value.length;i++){hash^=value.charCodeAt(i);hash=Math.imul(hash,16777619);}return(hash>>>0).toString(16);};
    function encode(state){const json=JSON.stringify(state);return state.version===4?COMPRESSED+checksum(json)+':'+codec().compressToUTF16(json):json;}
    function decode(raw){
        if(!raw.startsWith(COMPRESSED))return JSON.parse(raw);
        const boundary=raw.indexOf(':',COMPRESSED.length),expected=raw.slice(COMPRESSED.length,boundary);
        if(boundary<0||!codec())throw new Error('The compressed dynasty save could not be read. Restore its exported backup.');
        const json=codec().decompressFromUTF16(raw.slice(boundary+1));
        if(typeof json!=='string'||checksum(json)!==expected)throw new Error('The dynasty save is damaged. Restore its exported backup.');
        return JSON.parse(json);
    }
    const storage=()=>root.localStorage;
    const entry=state=>({id:state.id,name:state.name,week:state.week,phase:state.phase,factionId:state.hostFactionId,createdAt:state.createdAt,...(state.version===4?{dynastySeason:state.dynastySeason}:{})});
    const validEntry=row=>row&&typeof row.id==='string'&&row.id.length>0&&typeof row.name==='string'&&row.name.length>0
        &&Number.isInteger(row.week)&&row.week>=1&&row.week<=18&&['preseason','draft','reveal','season','complete'].includes(row.phase)
        &&typeof row.factionId==='string'&&typeof row.createdAt==='string';
    function recoverShelf(db){
        const recovered=[];
        // A damaged index is not a damaged campaign. Recovery is read-only;
        // malformed records remain available for manual recovery or replacement
        // from an explicit backup. Storage-access failures must still surface.
        for(let i=0;i<db.length;i++){
            const key=db.key(i);
            if(typeof key!=='string'||!key.startsWith(PREFIX))continue;
            const raw=db.getItem(key);
            if(raw===null)continue;
            let state;
            try{
                state=decode(raw);
                if(!root.App.DuatCampaign.validateCampaign(state)||key!==PREFIX+state.id)continue;
            }catch{continue;}
            recovered.push({row:entry(state),updatedAt:state.updatedAt});
        }
        return recovered.sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)||a.row.name.localeCompare(b.row.name)||a.row.id.localeCompare(b.row.id)).map(item=>item.row);
    }
    function list(){
        const db=storage(),raw=db.getItem(KEY);
        let rows;
        try{rows=JSON.parse(raw);}catch{return recoverShelf(db);}
        if(!Array.isArray(rows)||!rows.every(validEntry)||new Set(rows.map(row=>row.id)).size!==rows.length)return recoverShelf(db);
        return rows;
    }
    function read(id){
        const raw=storage().getItem(PREFIX+id);
        if(!raw)throw new Error('This campaign is not available on this browser. Restore its backup to continue.');
        const state=decode(raw);
        if(!root.App.DuatCampaign.validateCampaign(state))throw new Error('This save is not a valid Duat campaign. Restore a backup to continue.');
        return state;
    }
    function write(state){
        if(!root.App.DuatCampaign.validateCampaign(state))throw new Error('The campaign could not be validated. Your previous save is intact.');
        const db=storage(), key=PREFIX+state.id, before=db.getItem(key), oldIndex=db.getItem(KEY);
        const rows=list().filter(row=>row.id!==state.id);
        rows.unshift(entry(state));
        try{db.setItem(key,encode(state));db.setItem(KEY,JSON.stringify(rows));}
        catch(error){
            try{if(before===null)db.removeItem(key);else db.setItem(key,before);if(oldIndex===null)db.removeItem(KEY);else db.setItem(KEY,oldIndex);}catch{}
            throw new Error('Your move could not be saved. Free browser storage or export your current campaign before trying again.');
        }
    }
    function remove(id){
        const rows=list().filter(row=>row.id!==id);
        storage().setItem(KEY,JSON.stringify(rows));storage().removeItem(PREFIX+id);
    }
    const api={list,read,write,remove};(root.App=root.App||{}).DuatStorage=api;
    if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
