import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
import React from 'react';
import {act,create} from 'react-test-renderer';
import {bundleWorkspaceModule} from './bundleWorkspaceModule.mjs';
import {loadVariableModel} from '../src/compare/loadVariableModel.ts';
const f=p=>new URL(p,import.meta.url),text=n=>typeof n==='string'?n:(n?.children??[]).map(text).join('');
const out=fileURLToPath(f('../node_modules/.cache/gugis-tests/variable-curvature-results.mjs'));
await bundleWorkspaceModule(fileURLToPath(f('../src/compare/VariableCurvatureResults.tsx')),out);
const Card=(await import(pathToFileURL(out).href)).default,report=JSON.parse(await readFile(f('../../shared/variable-curvature-display-v1.json')));
const wait=async(predicate)=>{for(let i=0;i<30&&!predicate();i++)await act(async()=>{await new Promise(r=>setTimeout(r,10));});assert.ok(predicate(),'Expected native UI state');};
test('variation cards retain all cases, distinguish failed direction choices and disclose the cheaper/more accurate P2 control',()=>{
  const prior=globalThis.fetch;globalThis.fetch=()=>assert.fail('Closed native query must not fetch');let r;
  try{act(()=>r=create(React.createElement(Card)));const result=text(r.toJSON());assert.match(result,/63 \/ 63/);assert.match(result,/31 \/ 63/);assert.match(result,/63\.60%/);assert.match(result,/2,071/);assert.match(result,/2,120,704/);assert.match(result,/高于 433\.92%/);assert.match(result,/未做全局最优 P2/);assert.equal(r.root.findByType('tbody').findAllByType('tr').length,14);assert.equal(r.root.findAllByType('svg').length,0);
    act(()=>r.root.findByProps({'aria-label':'变曲率对标曲面'}).props.onChange({target:{value:'published-quartic'}}));act(()=>r.root.findByProps({'aria-label':'变曲率论文预算'}).props.onChange({target:{value:'32'}}));assert.match(text(r.root.findByProps({className:'vc-metrics'})),/131\.49% 更高/);assert.match(text(r.root.findByProps({className:'vc-metrics'})),/31\/ 63/);assert.equal(r.root.findAllByProps({className:'vc-loss'}).length,1);
  }finally{if(r)act(()=>r.unmount());globalThis.fetch=prior;}
});
test('actual saved P1, ruled and P2 files drive synchronized queries and are cancelled when the point demonstration closes',async()=>{
  const prior=globalThis.fetch,calls=[];let r;
  try{globalThis.fetch=async(url,{signal})=>{calls.push({url,signal});return new Response(await readFile(f(`../public${url}`)));};act(()=>r=create(React.createElement(Card)));await act(async()=>r.root.findByProps({'aria-label':'展开变曲率原生查询'}).props.onClick());await wait(()=>r.root.findAllByType('svg').length===3);assert.equal(calls.length,3);assert.match(text(r.root.findAllByProps({className:'vc-point'})[0]),/同点 Δz/);assert.match(text(r.root.findByProps({className:'vc-demo'})),/曲线节点仅显示水平结构/);
    const before=text(r.root.findAllByProps({className:'vc-point'})[1]);act(()=>r.root.findByProps({'aria-label':'变曲率同点查询X'}).props.onChange({target:{value:'41.1'}}));assert.notEqual(before,text(r.root.findAllByProps({className:'vc-point'})[1]));assert.equal(calls.length,3);act(()=>r.root.findByProps({'aria-label':'展开变曲率原生查询'}).props.onClick());assert.ok(calls.every(c=>c.signal.aborted));assert.equal(r.root.findAllByType('svg').length,0);
  }finally{if(r)act(()=>r.unmount());globalThis.fetch=prior;}
});
test('corrupted model bytes produce a visible error and a successful retry reads fresh validated models',async()=>{
  const prior=globalThis.fetch;let corrupt=true,r;
  try{globalThis.fetch=async url=>{const b=await readFile(f(`../public${url}`));if(corrupt&&url.includes('/paper-p1-'))b[b.length-1]^=1;return new Response(b);};act(()=>r=create(React.createElement(Card)));await act(async()=>r.root.findByProps({'aria-label':'展开变曲率原生查询'}).props.onClick());await wait(()=>r.root.findAllByProps({role:'alert'}).length===1);assert.match(text(r.root.findByProps({role:'alert'})),/SHA-256/);assert.equal(r.root.findAllByType('svg').length,0);corrupt=false;await act(async()=>r.root.findByProps({role:'alert'}).findByType('button').props.onClick());await wait(()=>r.root.findAllByType('svg').length===3);
  }finally{if(r)act(()=>r.unmount());globalThis.fetch=prior;}
});
test('all displayed download receipts match real native file bytes and the immutable reports',async()=>{
  const seen=new Set(),sha=b=>createHash('sha256').update(b).digest('hex');for(const c of report.cases)for(const p of c.pairs)for(const k of ['p1','world','mean_hessian','p2']){const e=p[k],url=`../public/research/variable-curvature-v1/${c.id}/${e.binary_filename}`;if(seen.has(url))continue;seen.add(url);const b=await readFile(f(url));assert.equal(b.length,e.binary_bytes);assert.equal(sha(b),e.binary_sha256);}
  for(const [file,key] of [['results.json','report_sha256'],['native-audit.json','native_audit_sha256'],['integral-audit.json','integral_audit_sha256']])assert.equal(sha(await readFile(f(`../public/research/variable-curvature-v1/${file}`))),report[key]);
});
test('native loader rejects malformed paths, failed responses, wrong receipts and pre-cancelled requests',async()=>{
  const prior=globalThis.fetch,c=report.cases[0],e=c.pairs[0].mean_hessian,url=`/research/variable-curvature-v1/${c.id}/${e.binary_filename}`,abort=new AbortController();let calls=0;
  try{globalThis.fetch=async()=>{calls++;return new Response('',{status:503});};await assert.rejects(loadVariableModel('/research/variable-curvature-v1/../private.bin',e.binary_bytes,e.binary_sha256,abort.signal),/回执/);assert.equal(calls,0);await assert.rejects(loadVariableModel(url,e.binary_bytes,e.binary_sha256,abort.signal),/503/);abort.abort();await assert.rejects(loadVariableModel(url,e.binary_bytes,e.binary_sha256,abort.signal),{name:'AbortError'});assert.equal(calls,1);
    globalThis.fetch=async()=>new Response(await readFile(f(`../public${url}`)));await assert.rejects(loadVariableModel(url,e.binary_bytes+1,e.binary_sha256,new AbortController().signal),/长度/);await assert.rejects(loadVariableModel(url,e.binary_bytes,'0'.repeat(64),new AbortController().signal),/SHA-256/);
  }finally{globalThis.fetch=prior;}
});
test('deep links mount only the variation result group and remove navigation listeners on teardown',async()=>{
  const path=fileURLToPath(f('../node_modules/.cache/gugis-tests/variable-curvature-disclosure.mjs'));await bundleWorkspaceModule(fileURLToPath(f('../src/compare/VariableCurvatureDisclosure.tsx')),path);const Disclosure=(await import(pathToFileURL(path).href)).default;
  const prior=globalThis.window,priorFetch=globalThis.fetch,listeners=new Map();let r;
  try{globalThis.window={location:{hash:'#variable-curvature-results'},addEventListener:(n,fn)=>listeners.set(n,fn),removeEventListener:(n,fn)=>{if(listeners.get(n)===fn)listeners.delete(n);},setTimeout,clearTimeout};globalThis.fetch=()=>assert.fail('Disclosure must not fetch native models');await act(async()=>r=create(React.createElement(Disclosure)));await wait(()=>r.root.findAllByProps({id:'variable-curvature-results'}).length===1);assert.equal(r.root.findByProps({id:'variable-curvature-evidence'}).props.open,true);act(()=>r.root.findByProps({id:'variable-curvature-evidence'}).props.onToggle({currentTarget:{open:false}}));assert.equal(r.root.findAllByProps({id:'variable-curvature-results'}).length,0);act(()=>r.unmount());r=null;assert.equal(listeners.size,0);
  }finally{if(r)act(()=>r.unmount());globalThis.window=prior;globalThis.fetch=priorFetch;}
});
