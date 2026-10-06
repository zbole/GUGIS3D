import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
import React from 'react';
import {act,create} from 'react-test-renderer';
import {bundleWorkspaceModule} from './bundleWorkspaceModule.mjs';
const f=p=>new URL(p,import.meta.url),text=n=>typeof n==='string'?n:(n?.children??[]).map(text).join('');
const out=fileURLToPath(f('../node_modules/.cache/gugis-tests/source-query-results.mjs'));await bundleWorkspaceModule(fileURLToPath(f('../src/compare/SourceQueryResults.tsx')),out);
const Card=(await import(pathToFileURL(out).href)).default,report=JSON.parse(await readFile(f('../../shared/source-query-display-v1.json')));
test('all real source sites, independent processes and the faster raster remain visible without loading models',()=>{
  const previous=globalThis.fetch;globalThis.fetch=()=>assert.fail('Static CPU results must not fetch city or models');let r;
  try{act(()=>r=create(React.createElement(Card)));const s=text(r.toJSON());for(const pattern of [/60\/60/,/3\.92–4\.73/,/2\.84–3\.53/,/规则栅格控制仍然更快/,/不是置信区间/,/ArcGIS 软件或 GPU/,/0 条计时/,/696,120/])assert.match(s,pattern);
    assert.equal(r.root.findByType('select').findAllByType('option').length,20);assert.equal(r.root.findAllByType('tbody')[0].findAllByType('tr').length,20);assert.equal(r.root.findAllByType('tbody')[1].findAllByType('tr').length,4);assert.equal(r.root.findAllByType('i').length,12);
    const before=text(r.root.findByProps({className:'sq-processes'}));act(()=>r.root.findByProps({'aria-label':'真实地形查询性能样区'}).props.onChange({target:{value:'newcastle-north-quarter'}}));assert.notEqual(text(r.root.findByProps({className:'sq-processes'})),before);
    for(const value of report.cases.find(c=>c.id==='newcastle-north-quarter').repetitions.flatMap(r=>Object.values(r.latency_median_ns)))assert.match(text(r.root.findByProps({className:'sq-processes'})),new RegExp(value.toFixed(2).replace('.','\\.')));
    assert.equal(r.root.findAllByType('canvas').length,0);assert.equal(r.root.findAllByType('svg').length,0);
  }finally{if(r)act(()=>r.unmount());globalThis.fetch=previous;}
});
test('all current native files and evidence downloads bind the exact immutable measurement',async()=>{
  const sha=b=>createHash('sha256').update(b).digest('hex'),base='../public/research/source-query-v1/';let r;
  try{act(()=>r=create(React.createElement(Card)));for(const a of r.root.findAllByType('a').filter(a=>a.props.download)){const raw=await readFile(f('../public'+a.props.href));assert.ok(raw.length>0);}
    for(const [name,key] of [['results.json','report_sha256'],['all-trials.csv','trials_sha256'],['native-audit.json','native_audit_sha256'],['protocol.json','protocol_sha256']])assert.equal(sha(await readFile(f(base+name))),report[key]);
    for(const c of report.cases)for(const m of c.methods)assert.equal(sha(await readFile(f(base+'models/'+c.id+'/'+m.filename))),m.binary_sha256);
  }finally{if(r)act(()=>r.unmount());}
});
test('both real CPU deep links open their lazy panel and remove navigation listeners',async()=>{
  const out=fileURLToPath(f('../node_modules/.cache/gugis-tests/source-query-disclosure.mjs'));await bundleWorkspaceModule(fileURLToPath(f('../src/compare/SourceQueryDisclosure.tsx')),out);const Disclosure=(await import(pathToFileURL(out).href)).default;
  for(const hash of ['#source-query-results','#source-query-evidence']){const previous=globalThis.window,listeners=new Map();let r;
    try{globalThis.window={location:{hash},addEventListener:(n,fn)=>listeners.set(n,fn),removeEventListener:(n,fn)=>{if(listeners.get(n)===fn)listeners.delete(n);}};await act(async()=>r=create(React.createElement(Disclosure)));for(let i=0;i<40&&!r.root.findAllByProps({id:'source-query-results'}).length;i++)await act(async()=>{await new Promise(resolve=>setTimeout(resolve,10));});assert.equal(r.root.findAllByProps({id:'source-query-results'}).length,1);assert.equal(r.root.findByProps({id:'source-query-evidence'}).props.open,true);act(()=>r.unmount());r=null;assert.equal(listeners.size,0);
    }finally{if(r)act(()=>r.unmount());globalThis.window=previous;}
  }
});
