import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {build} from 'esbuild';
import {fileURLToPath,pathToFileURL} from 'node:url';
import React from 'react';
import {create,act} from 'react-test-renderer';
const outfile=fileURLToPath(new URL('../node_modules/.cache/gugis-tests/city-dataset-card.mjs',import.meta.url));
await build({entryPoints:[fileURLToPath(new URL('../src/datasets/CityDatasetCard.tsx',import.meta.url))],outfile,bundle:true,platform:'node',format:'esm',packages:'external',define:{'import.meta.env':'{}'}});
const {default:Card}=await import(pathToFileURL(outfile).href);
const catalogue=JSON.parse(await readFile(new URL('../../shared/public-city-datasets.json',import.meta.url)));
const text=n=>typeof n==='string'?n:(n?.children??[]).map(text).join('');
const good=source=>({ok:true,json:async()=>({status:'available',source})});

test('all eight city cards verify metadata only, keep source scope and expose the exact public download',async()=>{
  const before=globalThis.fetch;let r;
  try{
    for(const source of catalogue.sources){let calls=0;globalThis.fetch=async(url,options)=>{calls++;assert.equal(url,`/api/cities/${source.city_id}/public-dataset`);assert.equal(options.cache,'no-store');assert.ok(options.signal instanceof AbortSignal);return good(source);};
      await act(async()=>r=create(React.createElement(Card,{cityId:source.city_id})));
      const body=text(r.toJSON());assert.ok(body.includes(source.building_count.toLocaleString()));assert.match(body,/不包含您本机添加的建筑/);assert.match(body,/不一次性渲染/);assert.match(body,/未经独立实测核验/);if(source.quality_warnings.length)assert.match(body,/已知模型问题/);
      const link=r.root.findAllByType('a').find(a=>a.props.download);assert.equal(link.props.href,`/api/cities/${source.city_id}/public-dataset.gugis.json`);assert.equal(calls,1);
      act(()=>r.unmount());
    }
  }finally{if(r)act(()=>r.unmount());globalThis.fetch=before;}
});

test('failed verification or wrong source revision hides the download and explicit retry can recover',async()=>{
  const before=globalThis.fetch,source=catalogue.sources.find(s=>s.city_id==='bath');let r;
  try{
    globalThis.fetch=async()=>good({...source,sha256:'0'.repeat(64)});
    await act(async()=>r=create(React.createElement(Card,{cityId:'bath'})));
    assert.match(text(r.toJSON()),/发布修订不一致/);assert.equal(r.root.findAllByType('a').filter(a=>a.props.download).length,0);
    globalThis.fetch=async()=>({ok:false});await act(async()=>r.root.findByType('button').props.onClick());assert.match(text(r.toJSON()),/未通过公开样本核验/);
    globalThis.fetch=async()=>good(source);await act(async()=>r.root.findByType('button').props.onClick());assert.equal(r.root.findAllByType('a').filter(a=>a.props.download).length,1);
  }finally{if(r)act(()=>r.unmount());globalThis.fetch=before;}
});

test('city switching aborts obsolete checks and late old metadata cannot enable a new city download',async()=>{
  const before=globalThis.fetch;let r,resolveBath,resolveYork;const signals=[];
  try{
    globalThis.fetch=(url,options)=>{signals.push(options.signal);return new Promise(resolve=>{if(url.includes('/bath/'))resolveBath=resolve;else resolveYork=resolve;});};
    await act(async()=>r=create(React.createElement(Card,{cityId:'bath'})));
    await act(async()=>r.update(React.createElement(Card,{cityId:'york'})));assert.equal(signals[0].aborted,true);
    await act(async()=>resolveBath(good(catalogue.sources.find(s=>s.city_id==='bath'))));assert.equal(r.root.findAllByType('a').filter(a=>a.props.download).length,0);
    await act(async()=>resolveYork(good(catalogue.sources.find(s=>s.city_id==='york'))));assert.equal(r.root.findAllByType('a').find(a=>a.props.download).props.href,'/api/cities/york/public-dataset.gugis.json');
    act(()=>r.unmount());assert.equal(signals[1].aborted,true);
  }finally{if(r)act(()=>r.unmount());globalThis.fetch=before;}
});

test('unknown identifiers never request public or private city APIs',async()=>{
  const before=globalThis.fetch;let r;
  try{globalThis.fetch=()=>assert.fail('unknown city must not fetch');await act(async()=>r=create(React.createElement(Card,{cityId:'../city/current'})));assert.match(text(r.toJSON()),/尚无已发布/);assert.equal(r.root.findAllByType('a').length,0);}
  finally{if(r)act(()=>r.unmount());globalThis.fetch=before;}
});
