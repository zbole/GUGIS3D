import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import React from 'react';
import {act,create} from 'react-test-renderer';
const source=p=>fileURLToPath(new URL(p,import.meta.url));
const report=JSON.parse(await readFile(source('../../shared/terrain-error-cost.json'),'utf8'));
const outfile=source('../node_modules/.cache/gugis-tests/terrain-tradeoff.mjs');
await build({entryPoints:[source('../src/compare/TerrainTradeoff.tsx')],bundle:true,platform:'node',format:'esm',packages:'external',outfile});
const {default:Comparison,leastCost}=await import(pathToFileURL(outfile).href);
const text=n=>typeof n==='string'?n:(n.children??[]).map(text).join('');

test('a changed error criterion changes recommendation without implying a maximum guarantee',()=>{
  let renderer;act(()=>renderer=create(React.createElement(Comparison,{caseId:'swiss-dem-crop',target:.1})));
  const result=()=>text(renderer.root.findByProps({className:'tradeoff-recommendation'}));
  assert.match(result(),/局部三角 · 297.75 kB/);
  act(()=>renderer.root.findByProps({'aria-label':'精度成本指标'}).props.onChange({target:{value:'rmse_m'}}));
  assert.match(result(),/紧凑混合 · 589.62 kB/);
  assert.match(result(),/当前只按 RMSE 筛选，最大误差要求需另行核对/);
  assert.match(result(),/实际参考界 9.931 cm/);
  act(()=>renderer.root.findByProps({'aria-label':'精度成本允许误差厘米'}).props.onChange({target:{value:'0.000000001'}}));
  assert.match(result(),/没有已测档位满足约束/);
  act(()=>renderer.root.findByProps({'aria-label':'精度成本允许误差厘米'}).props.onChange({target:{value:''}}));
  assert.equal(renderer.root.findByProps({'aria-label':'精度成本允许误差厘米'}).props['aria-invalid'],true);
  act(()=>renderer.update(React.createElement(Comparison,{caseId:'bilinear-saddle',target:.25})));
  assert.equal(renderer.root.findByProps({'aria-label':'精度成本允许误差厘米'}).props.value,'5');
  act(()=>renderer.unmount());
});

test('minimum-cost selection compares all observed targets strictly against the chosen threshold',()=>{
  for(const case_ of report.cases)for(const metric of ['bound_m','rmse_m'])for(const budget of [.000001,.01,.02,.05,.1,.5,1]){
    const selected=leastCost(case_.records,metric,budget);
    const families=new Set();
    for(const record of selected){
      assert.ok(record[metric]<=budget);assert.ok(!families.has(record.family));families.add(record.family);
      assert.ok(!case_.records.some(r=>r.family===record.family&&r[metric]<=budget&&r.bytes<record.bytes));
    }
    for(const family of new Set(case_.records.map(r=>r.family))){
      assert.equal(families.has(family),case_.records.some(r=>r.family===family&&r[metric]<=budget));
    }
  }
  assert.deepEqual(leastCost(report.cases[0].records,'bound_m',NaN),[]);
  assert.deepEqual(leastCost(report.cases[0].records,'bound_m',0),[]);
});
