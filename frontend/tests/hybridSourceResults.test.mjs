import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
import React from 'react';
import {act,create} from 'react-test-renderer';
import {bundleWorkspaceModule} from './bundleWorkspaceModule.mjs';
const f=p=>new URL(p,import.meta.url),text=n=>typeof n==='string'?n:(n?.children??[]).map(text).join('');
const out=fileURLToPath(f('../node_modules/.cache/gugis-tests/hybrid-source-results.mjs'));
await bundleWorkspaceModule(fileURLToPath(f('../src/compare/HybridSourceResults.tsx')),out);
const Card=(await import(pathToFileURL(out).href)).default,report=JSON.parse(await readFile(f('../../shared/hybrid-source-display-v1.json')));
const wait=async predicate=>{for(let i=0;i<50&&!predicate();i++)await act(async()=>{await new Promise(r=>setTimeout(r,10));});assert.ok(predicate(),'Expected validated native UI state');};
test('real-source results retain all sites, fixed-grid scope, larger-cost cases and missing P1 target models',()=>{
  const previous=globalThis.fetch;globalThis.fetch=()=>assert.fail('Closed demonstration must not fetch');let r;
  try{act(()=>r=create(React.createElement(Card)));const s=text(r.toJSON());assert.match(s,/20 \/ 20/);assert.match(s,/179 \/ 200/);assert.match(s,/3\.01%–18\.09%/);assert.match(s,/没有复用论文式贪心细分/);assert.equal(r.root.findAllByType('tbody')[1].findAllByType('tr').length,20);assert.equal(r.root.findAllByType('svg').length,0);
    act(()=>r.root.findByProps({'aria-label':'混合源地形比较条件'}).props.onChange({target:{value:'target'}}));act(()=>r.root.findByProps({'aria-label':'混合源地形样区'}).props.onChange({target:{value:'manchester-north-quarter'}}));assert.match(text(r.root.findAllByType('tbody')[0]),/固定候选中没有达到此目标的模型/);assert.match(text(r.toJSON()),/含数值余量/);
    act(()=>r.root.findByProps({'aria-label':'混合源地形样区'}).props.onChange({target:{value:'manchester-centre'}}));const first=r.root.findAllByType('tbody')[0].findAllByType('tr');assert.match(text(first[0]),/35,048 B/);assert.match(text(first[2]),/42,748 B/);
  }finally{if(r)act(()=>r.unmount());globalThis.fetch=previous;}
});
test('saved mixed functions drive synchronized points, cancel old sites, and omit an infeasible P1 rather than inventing it',async()=>{
  const previous=globalThis.fetch,calls=[];let r;
  try{globalThis.fetch=async(url,{signal})=>{calls.push({url,signal});return new Response(await readFile(f(`../public${url}`)));};act(()=>r=create(React.createElement(Card)));await act(async()=>r.root.findByProps({'aria-label':'展开混合源地形原生查询'}).props.onClick());await wait(()=>r.root.findAllByType('svg').length===4);assert.equal(calls.length,4);const before=text(r.root.findAllByProps({className:'hs-point'})[2]);act(()=>r.root.findByProps({'aria-label':'混合源地形同点查询X'}).props.onChange({target:{value:'17.31'}}));assert.notEqual(text(r.root.findAllByProps({className:'hs-point'})[2]),before);assert.equal(calls.length,4);
    const ranges=r.root.findAllByType('text').map(text).filter(t=>t.startsWith('64 ×'));assert.equal(new Set(ranges).size,1);assert.match(text(r.root.findByProps({className:'hs-demo'})),/17 × 17 的展示采样/);
    act(()=>r.root.findByProps({'aria-label':'混合源地形比较条件'}).props.onChange({target:{value:'target'}}));act(()=>r.root.findByProps({'aria-label':'混合源地形样区'}).props.onChange({target:{value:'manchester-north-quarter'}}));await wait(()=>r.root.findAllByProps({className:'hs-point'}).length===2);assert.ok(calls.slice(0,4).every(c=>c.signal.aborted));assert.equal(r.root.findAllByType('svg').length,3);assert.ok(calls.filter(c=>c.url.includes('/manchester-north-quarter/')).every(c=>!c.url.includes('/p1-')));
    act(()=>r.root.findByProps({'aria-label':'展开混合源地形原生查询'}).props.onClick());assert.ok(calls.every(c=>c.signal.aborted));assert.equal(r.root.findAllByType('svg').length,0);
  }finally{if(r)act(()=>r.unmount());globalThis.fetch=previous;}
});
test('corrupt saved bytes block queries and retry validates a fresh model set',async()=>{
  const previous=globalThis.fetch;let corrupt=true,r;
  try{globalThis.fetch=async url=>{const b=await readFile(f(`../public${url}`));if(corrupt&&url.includes('/hybrid-'))b[b.length-1]^=1;return new Response(b);};act(()=>r=create(React.createElement(Card)));await act(async()=>r.root.findByProps({'aria-label':'展开混合源地形原生查询'}).props.onClick());await wait(()=>r.root.findAllByProps({role:'alert'}).length===1);assert.match(text(r.root.findByProps({role:'alert'})),/SHA-256/);assert.equal(r.root.findAllByType('svg').length,0);corrupt=false;await act(async()=>r.root.findByProps({role:'alert'}).findByType('button').props.onClick());await wait(()=>r.root.findAllByType('svg').length===4);
  }finally{if(r)act(()=>r.unmount());globalThis.fetch=previous;}
});
test('all selected public native files and downloadable receipts match exact bytes',async()=>{
  const seen=new Set(),sha=b=>createHash('sha256').update(b).digest('hex');for(const c of report.cases)for(const p of [...c.byte_pairs,...c.target_pairs])for(const method of ['p1','ruled','hybrid']){const e=p[method];if(!e)continue;const url=`../public/research/hybrid-source-v1/${c.id}/${e.binary_filename}`;if(seen.has(url))continue;seen.add(url);const b=await readFile(f(url));assert.equal(b.length,e.binary_bytes);assert.equal(sha(b),e.binary_sha256);}
  for(const [file,key] of [['results.json','report_sha256'],['native-audit.json','native_audit_sha256'],['integral-audit.json','integral_audit_sha256'],['hybrid-source-results.svg','figure_sha256']])assert.equal(sha(await readFile(f(`../public/research/hybrid-source-v1/${file}`))),report[key]);const zip=await readFile(f(`../public/research/hybrid-source-v1/${report.package.filename}`));assert.equal(zip.length,report.package.bytes);assert.equal(sha(zip),report.package.sha256);
});
test('compact UI input binds the full immutable summary and preserves every displayed method metric and missing candidate',async()=>{
  const raw=await readFile(f('../../shared/hybrid-source-display-v1.json')),view=JSON.parse(await readFile(f('../../shared/hybrid-source-ui-v1.json')));assert.equal(view.source_summary_sha256,createHash('sha256').update(raw).digest('hex'));assert.deepEqual(view.cases.map(c=>c.id),report.cases.map(c=>c.id));
  for(const [i,c] of view.cases.entries())for(const group of ['byte_pairs','target_pairs'])for(const [j,p] of c[group].entries())for(const family of ['p1','ruled','hybrid']){const reference=report.cases[i][group][j][family];if(!reference)assert.equal(p[family],null);else for(const [key,value] of Object.entries(p[family]))assert.deepEqual(value,reference[key]);}
});
test('hybrid deep links load the result group lazily and release all listeners on teardown',async()=>{
  const out=fileURLToPath(f('../node_modules/.cache/gugis-tests/hybrid-source-disclosure.mjs'));await bundleWorkspaceModule(fileURLToPath(f('../src/compare/HybridSourceDisclosure.tsx')),out);const Disclosure=(await import(pathToFileURL(out).href)).default;
  const previous=globalThis.window,previousFetch=globalThis.fetch,listeners=new Map();let r;
  try{globalThis.window={location:{hash:'#hybrid-source-results'},addEventListener:(n,fn)=>listeners.set(n,fn),removeEventListener:(n,fn)=>{if(listeners.get(n)===fn)listeners.delete(n);}};globalThis.fetch=()=>assert.fail('Closed native queries must not fetch');await act(async()=>r=create(React.createElement(Disclosure)));await wait(()=>r.root.findAllByProps({id:'hybrid-source-results'}).length===1);assert.equal(r.root.findByProps({id:'hybrid-source-evidence'}).props.open,true);act(()=>r.root.findByProps({id:'hybrid-source-evidence'}).props.onToggle({currentTarget:{open:false}}));assert.equal(r.root.findAllByProps({id:'hybrid-source-results'}).length,0);act(()=>r.unmount());r=null;assert.equal(listeners.size,0);
  }finally{if(r)act(()=>r.unmount());globalThis.window=previous;globalThis.fetch=previousFetch;}
});
