import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
import React from 'react';
import {act,create} from 'react-test-renderer';
import {bundleWorkspaceModule} from './bundleWorkspaceModule.mjs';
const f=p=>new URL(p,import.meta.url),out=fileURLToPath(f('../node_modules/.cache/gugis-tests/principal-direction-results.mjs'));
await bundleWorkspaceModule(fileURLToPath(f('../src/compare/PrincipalDirectionResults.tsx')),out);
const {default:Card}=await import(pathToFileURL(out).href),text=n=>typeof n==='string'?n:(n?.children??[]).map(text).join(''),report=JSON.parse(await readFile(f('../../shared/principal-ruled-display-v1.json')));
test('direction result cards retain all 63 fixed pairs, exact P2 control and measured-scope limits',()=>{
  const previous=globalThis.fetch;globalThis.fetch=()=>assert.fail('Closed result card must not load native models');let r;
  try{act(()=>r=create(React.createElement(Card)));assert.match(text(r.toJSON()),/63 \/ 63/);assert.match(text(r.toJSON()),/99\.88/);assert.match(text(r.toJSON()),/43\.0/);
    assert.match(text(r.toJSON()),/不声称优于通用 P2 三角函数/);assert.match(text(r.toJSON()),/不是新的 P1 最优性定理/);assert.equal(r.root.findAllByType('canvas').length,0);
    assert.equal(r.root.findByType('tbody').findAllByType('tr').length,7);
    act(()=>r.root.findByProps({'aria-label':'主曲率方向角度'}).props.onChange({target:{value:'90'}}));assert.doesNotMatch(text(r.toJSON()),/-0\.00/);
    act(()=>r.root.findByProps({'aria-label':'方向对照面数预算'}).props.onChange({target:{value:'8'}}));assert.match(text(r.root.findByProps({className:'pr-metrics'})),/0\.0%/);
  }finally{if(r)act(()=>r.unmount());globalThis.fetch=previous;}
});
test('native structure demonstration reads checksum-bound files, queries both surfaces and exposes the exact P2 control on demand',async()=>{
  const previous=globalThis.fetch,calls=[];let r;
  try{globalThis.fetch=async(url,{signal})=>{calls.push({url,signal});return new Response(await readFile(f(`../public${url}`)));};act(()=>r=create(React.createElement(Card)));
    await act(async()=>{r.root.findByProps({'aria-label':'展开方向结构与同点查询'}).props.onClick();await new Promise(resolve=>setTimeout(resolve,40));});
    for(let i=0;i<20&&!r.root.findAllByProps({className:'pr-demo'}).length;i++)await act(async()=>{await new Promise(resolve=>setTimeout(resolve,10));});
    assert.equal(calls.length,2);assert.equal(r.root.findAllByType('svg').length,2);assert.match(text(r.toJSON()),/256 个原生面/);assert.equal(r.root.findAllByProps({className:'pr-point'}).length,2);
    act(()=>r.root.findByProps({'aria-label':'方向面带查询X'}).props.onChange({target:{value:'41.3'}}));act(()=>r.root.findByProps({'aria-label':'方向面带查询Y'}).props.onChange({target:{value:'-21.7'}}));
    await act(async()=>{r.root.findAllByType('button').find(b=>text(b)==='载入 P2 高阶控制').props.onClick();await new Promise(resolve=>setTimeout(resolve,40));});
    for(let i=0;i<20&&r.root.findAllByType('svg').length!==3;i++)await act(async()=>{await new Promise(resolve=>setTimeout(resolve,10));});
    assert.equal(calls.length,5);assert.equal(r.root.findAllByType('svg').length,3);assert.match(text(r.root.findAllByProps({className:'pr-point'})[2]),/Δz 0\.000000 mm/);
    act(()=>r.root.findByProps({'aria-label':'展开方向结构与同点查询'}).props.onClick());assert.ok(calls.every(c=>c.signal.aborted));assert.equal(r.root.findAllByType('svg').length,0);
  }finally{if(r)act(()=>r.unmount());globalThis.fetch=previous;}
});
test('all displayed complete-file receipts and download paths match the immutable release',async()=>{
  const sha=b=>createHash('sha256').update(b).digest('hex');for(const c of report.cases)for(const e of [c.p2_control,...c.pairs.flatMap(p=>[p.p1,p.world,p.principal])]){
    const b=await readFile(f(`../public/research/principal-ruled-v1/${c.id}/${e.binary_filename}`));assert.equal(b.length,e.binary_bytes);assert.equal(sha(b),e.binary_sha256);
  }
});
