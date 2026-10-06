import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
import React from 'react';
import {act,create} from 'react-test-renderer';
import {bundleWorkspaceModule} from './bundleWorkspaceModule.mjs';
const f=p=>new URL(p,import.meta.url),text=n=>typeof n==='string'?n:(n?.children??[]).map(text).join(''),out=fileURLToPath(f('../node_modules/.cache/gugis-tests/exeter-source-results.mjs'));
await bundleWorkspaceModule(fileURLToPath(f('../src/compare/ExeterSourceResults.tsx')),out);
const Card=(await import(pathToFileURL(out).href)).default,report=JSON.parse(await readFile(f('../../shared/exeter-source-fit-v1.json')));
const wait=async fn=>{for(let i=0;i<60&&!fn();i++)await act(async()=>{await new Promise(r=>setTimeout(r,10));});assert.ok(fn(),'Actual source native state expected');};
test('new sites stay separate from the twenty-site cohort, retain all 20 budgets, losses, source controls and source-relative scope',()=>{
  const old=globalThis.fetch;let r;
  try{globalThis.fetch=()=>assert.fail('Closed card must not read model or city');act(()=>r=create(React.createElement(Card)));const s=text(r.toJSON());assert.match(s,/0\.9554% E₂ 降低/);assert.match(s,/290\/ 294/);assert.match(s,/16\/20 获益，1 组失利、3 组相同/);assert.match(s,/10拟合只优化/);assert.match(s,/原二十样区不改写/);assert.match(s,/不是完全盲测/);assert.match(s,/16,980 B/);assert.match(s,/694,376 B/);assert.equal(r.root.findAllByType('tbody')[1].findAllByType('tr').length,20);assert.equal(r.root.findAllByType('tbody')[0].findAllByType('tr').length,6);
    act(()=>r.root.findByProps({'aria-label':'Exeter新增样区'}).props.onChange({target:{value:'exeter-north-quarter'}}));assert.match(text(r.toJSON()),/0\.7000% E₂ 降低/);
    const loss=report.cases.flatMap(c=>c.byte_pairs.map(row=>({c,row}))).find(({c,row})=>row['hybrid-fit']&&row['p1-fit']&&c.models[row['hybrid-fit']].e2_m2>c.models[row['p1-fit']].e2_m2);
    act(()=>r.root.findByProps({'aria-label':'Exeter新增样区'}).props.onChange({target:{value:loss.c.id}}));act(()=>r.root.findByProps({'aria-label':'Exeter文件预算'}).props.onChange({target:{value:String(loss.row.byte_ceiling)}}));assert.match(text(r.root.findByProps({className:'exeter-source-current'})),/E₂ 更高/);
    act(()=>r.root.findByProps({'aria-label':'Exeter对比条件'}).props.onChange({target:{value:'target'}}));act(()=>r.root.findByProps({'aria-label':'Exeter最大差目标'}).props.onChange({target:{value:'.01'}}));assert.match(text(r.toJSON()),/已保存候选未达标/);assert.match(text(r.toJSON()),/无成对合格候选/);
  }finally{if(r)act(()=>r.unmount());globalThis.fetch=old;}
});
test('actual fitted GPR4 and original Float32 files drive three synchronized heatmaps; collapsing aborts and releases requests',async()=>{
  const old=globalThis.fetch,calls=[];let r;
  try{globalThis.fetch=async(url,{signal})=>{calls.push({url,signal});return new Response(await readFile(f('../public'+url)));};act(()=>r=create(React.createElement(Card)));await act(async()=>r.root.findByProps({'aria-label':'展开Exeter原生同步查询'}).props.onClick());await wait(()=>r.root.findAllByProps({className:'exeter-error-map'}).length===3);assert.equal(calls.length,4);assert.ok(calls.every(c=>c.url.startsWith('/research/exeter-source-fit-v1/exeter-centre/')));
    const maps=r.root.findAllByProps({className:'exeter-error-map'});assert.ok(maps.every(m=>m.findAllByType('rect').length===289));const point=maps[1].findAllByType('rect')[94];act(()=>point.props.onClick());assert.equal(r.root.findByProps({'aria-label':'新增样区同步查询X'}).props.value,point.props['data-x']);assert.equal(calls.length,4);
    const sha=b=>createHash('sha256').update(b).digest('hex');for(const c of calls){const raw=await readFile(f('../public'+c.url));assert.ok(raw.length<=2_000_000);assert.equal(sha(raw).length,64);}
    act(()=>r.root.findByProps({'aria-label':'展开Exeter原生同步查询'}).props.onClick());assert.ok(calls.every(c=>c.signal.aborted));assert.equal(r.root.findAllByProps({className:'exeter-error-map'}).length,0);
  }finally{if(r)act(()=>r.unmount());globalThis.fetch=old;}
});
test('failed model read cancels peers and displays explicit retry; successful retry uses the same source receipts',async()=>{
  const old=globalThis.fetch;let r;const signals=[];
  try{globalThis.fetch=async(url,{signal})=>{signals.push(signal);return new Response(null,{status:503});};act(()=>r=create(React.createElement(Card)));await act(async()=>r.root.findByProps({'aria-label':'展开Exeter原生同步查询'}).props.onClick());await wait(()=>r.root.findAllByProps({role:'alert'}).length>0);assert.match(text(r.toJSON()),/503/);assert.ok(signals.every(s=>s.aborted));globalThis.fetch=async url=>new Response(await readFile(f('../public'+url)));await act(async()=>r.root.findAllByType('button').find(b=>text(b)==='重试新增样区文件').props.onClick());await wait(()=>r.root.findAllByProps({className:'exeter-error-map'}).length===3);
  }finally{if(r)act(()=>r.unmount());globalThis.fetch=old;}
});
