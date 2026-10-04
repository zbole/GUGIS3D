import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {build} from 'esbuild';
import {fileURLToPath,pathToFileURL} from 'node:url';
import React from 'react';
import {create,act} from 'react-test-renderer';
const file=p=>new URL(p,import.meta.url),manifest=JSON.parse(await readFile(file('../../shared/bristol-viewer-models.json')));
async function bundle(name,entry){const outfile=fileURLToPath(file(`../node_modules/.cache/gugis-tests/${name}.mjs`));await build({entryPoints:[fileURLToPath(file(entry))],outfile,bundle:true,platform:'node',format:'esm',packages:'external',loader:{'.css':'empty'}});return import(pathToFileURL(outfile).href);}
const {feasibleBristolModels,bristolFrontier,bristolModelKey}=await bundle('bristol-decision-math','../src/compare/bristolCostSelection.ts');
const Card=(await bundle('bristol-decision-ui','../src/compare/BristolTerrainDecision.tsx')).default;
const text=n=>typeof n==='string'?n:(n?.children??[]).map(text).join('');

test('two error constraints choose only published feasible models and reveal real harbour/hill tradeoffs',()=>{
  const harbour=manifest.models.filter(m=>m.case_id==='bristol-harbour'),hill=manifest.models.filter(m=>m.case_id==='bristol-brandon-hill');
  assert.equal(feasibleBristolModels(harbour,.1,null)[0].bytes,23093);
  assert.equal(feasibleBristolModels(hill,.1,null)[0].bytes,36764);
  assert.equal(feasibleBristolModels(hill,.1,.029)[0].bytes,44037);
  assert.equal(feasibleBristolModels(harbour,.1,.01)[0].bytes,60805);
  // A stricter original construction target can still cost less than a looser
  // target of another family; rank actual archives, not their target labels.
  assert.equal(feasibleBristolModels(harbour,.5,.025)[0].bytes,23093);
  assert.deepEqual(feasibleBristolModels(harbour,.05,null),[]);
  for(const invalid of [NaN,Infinity,0,-1]){assert.deepEqual(feasibleBristolModels(harbour,invalid,null),[]);assert.deepEqual(feasibleBristolModels(harbour,.1,invalid),[]);}
  for(const data of [harbour,hill])for(const m of data){
    assert.ok(feasibleBristolModels(data,m.continuous_bound_m,m.rmse_m).some(n=>n.sha256===m.sha256));
    assert.ok(!feasibleBristolModels(data,m.continuous_bound_m-1e-12,null).some(n=>n.sha256===m.sha256));
  }
});

test('joint finite frontier does not treat a better RMSE but worse maximum bound as dominated',()=>{
  const prototype=manifest.models[0];
  const a={...prototype,family:'global_compact',target_m:.1,bytes:100,continuous_bound_m:.1,rmse_m:.02};
  const b={...prototype,family:'local_compact',target_m:.1,bytes:90,continuous_bound_m:.2,rmse_m:.01};
  const c={...prototype,family:'local_triangles',target_m:.1,bytes:110,continuous_bound_m:.11,rmse_m:.021};
  assert.deepEqual(new Set(bristolFrontier([a,b,c])),new Set([bristolModelKey(a),bristolModelKey(b)]));
  assert.equal(bristolFrontier([a,{...a,target_m:.25}]).length,2);
});

test('UI keeps all nine observations visible, combines error controls and downloads the exact winning archive',()=>{
  let r;act(()=>r=create(React.createElement(Card,{target:.1})));
  const change=(label,value)=>act(()=>r.root.findByProps({'aria-label':label}).props.onChange({target:{value}}));
  const result=()=>text(r.root.findByProps({className:'bristol-decision__result'}));
  assert.match(result(),/新局部紧凑混合 · 23.09 kB/);
  change('Bristol 成本决策样区','bristol-brandon-hill');assert.match(result(),/局部三角带 · 36.76 kB/);
  change('Bristol RMSE 约束','2.9');assert.match(result(),/新局部紧凑混合 · 44.04 kB/);
  const link=r.root.findAllByType('a')[0];assert.equal(link.props.href,'/research/bristol-viewer/models/bristol-brandon-hill/local_compact-0.1m.json');assert.equal(link.props.download,true);
  change('Bristol 最大参考误差约束','5');assert.match(result(),/没有已测模型同时满足/);assert.equal(r.root.findAllByType('a').length,0);
  assert.equal(r.root.findAllByType('tbody')[0].findAllByType('tr').length,9);
  change('Bristol RMSE 约束','');act(()=>r.update(React.createElement(Card,{target:.5})));assert.match(result(),/局部三角带 · 4.26 kB/);
  change('Bristol 最大参考误差约束','');assert.match(result(),/请输入大于零/);
  assert.match(text(r.toJSON()),/不是同几何的格式收益/);assert.match(text(r.toJSON()),/不保证全局最优/);
  act(()=>r.unmount());
});
