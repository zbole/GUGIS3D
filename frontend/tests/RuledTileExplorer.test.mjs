import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fileURLToPath,pathToFileURL} from 'node:url';
import React from 'react';
import {create,act} from 'react-test-renderer';
import {bundleWorkspaceModule} from './bundleWorkspaceModule.mjs';
const f=p=>new URL(p,import.meta.url),out=fileURLToPath(f('../node_modules/.cache/gugis-tests/ruled-tile-explorer.mjs'));
await bundleWorkspaceModule(fileURLToPath(f('../src/datasets/RuledTileExplorer.tsx')),out);const {default:Explorer}=await import(pathToFileURL(out).href),text=n=>typeof n==='string'?n:(n?.children??[]).map(text).join('');
const wait=async(r,ready)=>{for(let i=0;i<50&&!ready(r);i++)await act(async()=>{await new Promise(resolve=>setTimeout(resolve,20));});assert.ok(ready(r));};
test('closed original-resolution explorer loads no terrain and clearly scopes source, cache and ground accuracy',()=>{
  const before=globalThis.fetch;globalThis.fetch=()=>assert.fail('Closed tile explorer must not fetch');let r;
  try{act(()=>r=create(React.createElement(Explorer)));assert.match(text(r.toJSON()),/512 × 512 m/);assert.match(text(r.toJSON()),/不是全城覆盖/);assert.match(text(r.toJSON()),/不是独立实测地面精度/);assert.equal(r.root.findAllByType('canvas').length,0);}finally{if(r)act(()=>r.unmount());globalThis.fetch=before;}
});
test('opening loads just one native tile, switching queries exact BNG values, closing cancels, reopening owns a fresh manager',async()=>{
  const before=globalThis.fetch,calls=[];let r;
  try{globalThis.fetch=async(url,{signal})=>{calls.push({url,signal});return new Response(await readFile(f('../public'+url)));};act(()=>r=create(React.createElement(Explorer)));
    await act(async()=>{r.root.findByProps({'aria-label':'展开一米面带瓦片查询'}).props.onClick();await new Promise(resolve=>setTimeout(resolve,50));});await wait(r,v=>v.root.findAllByProps({className:'rt-point'}).length);
    assert.equal(calls.length,1);assert.equal(r.root.findByProps({'aria-label':'选择原始一米面带瓦片'}).findAllByType('button').length,64);assert.match(text(r.root.findByProps({className:'rt-cache'})),/135\.53 kB/);assert.match(text(r.toJSON()),/8\.67 MB/);
    await act(async()=>{r.root.findByProps({'aria-label':'选择面带瓦片 r0c0'}).props.onClick();await new Promise(resolve=>setTimeout(resolve,50));});await wait(r,v=>v.root.findAllByProps({className:'rt-point'}).length);assert.equal(calls.length,2);assert.match(text(r.root.findByProps({className:'rt-point'})),/命中 r0c0/);
    act(()=>r.root.findByProps({'aria-label':'展开一米面带瓦片查询'}).props.onClick());assert.ok(calls.every(c=>c.signal.aborted));assert.equal(r.root.findAllByProps({className:'rt-point'}).length,0);
    await act(async()=>{r.root.findByProps({'aria-label':'展开一米面带瓦片查询'}).props.onClick();await new Promise(resolve=>setTimeout(resolve,50));});await wait(r,v=>v.root.findAllByProps({className:'rt-point'}).length);assert.equal(calls.length,3);assert.match(text(r.root.findByProps({className:'rt-cache'})),/1 \/ 64/);
  }finally{if(r)act(()=>r.unmount());globalThis.fetch=before;}
});
test('a damaged native tile cannot replace results and can be retried with a valid body',async()=>{
  const before=globalThis.fetch;let r,corrupt=true;
  try{globalThis.fetch=async url=>new Response(corrupt?new Uint8Array(1):await readFile(f('../public'+url)));act(()=>r=create(React.createElement(Explorer)));
    await act(async()=>{r.root.findByProps({'aria-label':'展开一米面带瓦片查询'}).props.onClick();await new Promise(resolve=>setTimeout(resolve,50));});assert.match(text(r.root.findByProps({role:'alert'})),/长度不符/);corrupt=false;
    await act(async()=>{r.root.findAllByType('button').find(b=>text(b)==='重试瓦片查询').props.onClick();await new Promise(resolve=>setTimeout(resolve,50));});await wait(r,v=>v.root.findAllByProps({className:'rt-point'}).length);assert.equal(r.root.findAllByProps({role:'alert'}).length,0);
  }finally{if(r)act(()=>r.unmount());globalThis.fetch=before;}
});
