import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fileURLToPath,pathToFileURL} from 'node:url';
import React from 'react';
import {act,create} from 'react-test-renderer';
import {bundleWorkspaceModule} from './bundleWorkspaceModule.mjs';
const f=p=>new URL(p,import.meta.url),out=fileURLToPath(f('../node_modules/.cache/gugis-tests/source-function-results.mjs'));
await bundleWorkspaceModule(fileURLToPath(f('../src/compare/SourceFunctionResults.tsx')),out);
const {default:Card}=await import(pathToFileURL(out).href),text=n=>typeof n==='string'?n:(n?.children??[]).map(text).join('');
const settle=async(r,predicate)=>{for(let i=0;i<40&&!predicate(r);i++)await act(async()=>{await new Promise(resolve=>setTimeout(resolve,25));});assert.ok(predicate(r),'Native query demo should become ready');};
test('source results expose the supported vector advantage, all fixed sites and smaller raster controls without fetching models',()=>{
  const previous=globalThis.fetch;globalThis.fetch=()=>assert.fail('Closed source result must not load models');let r;
  try{act(()=>r=create(React.createElement(Card)));assert.match(text(r.toJSON()),/80\.5/);assert.match(text(r.toJSON()),/20\/ 20/);assert.match(text(r.toJSON()),/不等于运行内存/);assert.match(text(r.toJSON()),/不是独立实测地面精度/);assert.match(text(r.toJSON()),/没有获胜的结果/);assert.equal(r.root.findByType('tbody').findAllByType('tr').length,20);assert.equal(r.root.findAllByType('canvas').length,0);
    assert.match(text(r.root.findByProps({className:'sf-file-chart'})),/实际无损 GeoTIFF 输入/);assert.match(text(r.root.findByProps({className:'sf-file-chart'})),/16\.98 kB/);
    act(()=>r.root.findByProps({'aria-label':'源函数对比样区'}).props.onChange({target:{value:'newcastle-north-quarter'}}));assert.match(text(r.toJSON()),/11\.25/);
  }finally{if(r)act(()=>r.unmount());globalThis.fetch=previous;}
});
test('actual native files show interior P1 disagreement and near-zero source-function differences, and changing site aborts old requests',async()=>{
  const previous=globalThis.fetch,calls=[];let r;
  try{globalThis.fetch=async(url,{signal})=>{calls.push({url,signal});return new Response(await readFile(f(`../public${url}`)));};act(()=>r=create(React.createElement(Card)));
    await act(async()=>{r.root.findByProps({'aria-label':'展开真实源函数同点查询'}).props.onClick();await new Promise(resolve=>setTimeout(resolve,60));});await settle(r,v=>v.root.findAllByProps({className:'sf-demo'}).length);
    assert.equal(calls.length,4);assert.equal(r.root.findAllByType('svg').length,3);const points=r.root.findAllByProps({className:'sf-point'});assert.match(text(points[0]),/Δz 0\.000000 mm/);assert.match(text(points[2]),/Δz 0\.000000 mm/);assert.match(text(points[1]),/24\.750710 mm/);assert.match(text(r.toJSON()),/BNG E /);
    act(()=>r.root.findByProps({'aria-label':'源地形同点查询X'}).props.onChange({target:{value:'31.99'}}));act(()=>r.root.findByProps({'aria-label':'源地形同点查询Y'}).props.onChange({target:{value:'-31.99'}}));assert.match(text(r.root.findAllByProps({className:'sf-point'})[2]),/Δz 0\.000000 mm/);
    await act(async()=>{r.root.findByProps({'aria-label':'源函数对比样区'}).props.onChange({target:{value:'newcastle-north-quarter'}});await new Promise(resolve=>setTimeout(resolve,60));});await settle(r,v=>v.root.findAllByProps({className:'sf-demo'}).length);assert.equal(calls.length,8);assert.ok(calls.slice(0,4).every(c=>c.signal.aborted));assert.ok(calls.slice(4).every(c=>c.url.includes('newcastle-north-quarter')));
    act(()=>r.root.findByProps({'aria-label':'展开真实源函数同点查询'}).props.onClick());assert.ok(calls.every(c=>c.signal.aborted));assert.equal(r.root.findAllByType('svg').length,0);
  }finally{if(r)act(()=>r.unmount());globalThis.fetch=previous;}
});
test('corrupt model response fails clearly and retry replaces the complete query session',async()=>{
  const previous=globalThis.fetch;let r,corrupt=true;
  try{globalThis.fetch=async url=>new Response(corrupt?new Uint8Array(1):await readFile(f(`../public${url}`)));act(()=>r=create(React.createElement(Card)));
    await act(async()=>{r.root.findByProps({'aria-label':'展开真实源函数同点查询'}).props.onClick();await new Promise(resolve=>setTimeout(resolve,60));});assert.match(text(r.root.findByProps({role:'alert'})),/文件长度不符/);corrupt=false;
    await act(async()=>{r.root.findAllByType('button').find(b=>text(b)==='重试源地形模型').props.onClick();await new Promise(resolve=>setTimeout(resolve,60));});await settle(r,v=>v.root.findAllByProps({className:'sf-demo'}).length);assert.equal(r.root.findAllByProps({role:'alert'}).length,0);
  }finally{if(r)act(()=>r.unmount());globalThis.fetch=previous;}
});
