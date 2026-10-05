import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {build} from 'esbuild';
import {fileURLToPath,pathToFileURL} from 'node:url';
import React from 'react';
import {create,act} from 'react-test-renderer';
const file=p=>new URL(p,import.meta.url),sha=b=>createHash('sha256').update(b).digest('hex');
async function bundle(name,entry){const outfile=fileURLToPath(file(`../node_modules/.cache/gugis-tests/${name}.mjs`));await build({entryPoints:[fileURLToPath(file(entry))],outfile,bundle:true,platform:'node',format:'esm',packages:'external',loader:{'.css':'empty'}});return import(pathToFileURL(outfile).href);}
const {default:Card,RealTerrainResultSummary}=await bundle('paper-terrain-results','../src/compare/PaperTerrainResults.tsx');
const {default:Disclosure,evidenceGroupForHash}=await bundle('paper-evidence-disclosure','../src/compare/EvidenceDisclosure.tsx');
const {default:IntegralDecision}=await bundle('bristol-integral-decision','../src/compare/BristolIntegralDecision.tsx');
const {selectIntegralCandidates}=await bundle('integral-cost-selection','../src/compare/integralCostSelection.ts');
const text=n=>typeof n==='string'?n:(n?.children??[]).map(text).join('');

test('focused results switch the actual case, budget, chart and negative findings together',()=>{
  let r;act(()=>r=create(React.createElement(Card)));
  const change=(label,value)=>act(()=>r.root.findByProps({'aria-label':label}).props.onChange({target:{value}}));
  assert.match(text(r.root.findByProps({className:'paper-finding'})),/78\.4%/);
  assert.equal(r.root.findAllByType('tbody')[0].findAllByType('tr').length,3);
  assert.match(text(r.toJSON()),/E₂ 是全域积分范数/);
  change('论文指标三角形预算','8');assert.match(text(r.root.findByProps({className:'paper-finding'})),/18\.5%/);
  change('论文指标曲线','rho_median');assert.match(r.root.findByProps({className:'paper-chart'}).props['aria-label'],/形状/);
  change('论文指标测试曲面','isotropic');assert.match(text(r.root.findByProps({className:'paper-finding'})),/无误差收益/);
  assert.ok(r.root.findAllByType('a').some(a=>a.props.href==='/research/paper-metrics/isotropic-curves.svg'));
  assert.match(text(r.toJSON()),/不是 ArcGIS 软件性能/);
  change('论文指标三角形预算','2048');change('论文指标测试曲面','variable_curvature');
  assert.match(text(r.root.findByProps({className:'paper-finding'})),/34\.1%/);
  assert.match(text(r.root.findByProps({className:'paper-finding'})),/仅改变细分选区：E₂ 降低 22\.4%/);
  assert.match(text(r.toJSON()),/重心处 Q/);
  act(()=>r.unmount());
});

test('real terrain highlight retains the hillside disadvantage and does not substitute paper triangle N',()=>{
  let r;act(()=>r=create(React.createElement(RealTerrainResultSummary)));
  assert.match(text(r.toJSON()),/小 53\.6%/);assert.match(text(r.toJSON()),/大 19\.8%/);
  assert.match(text(r.toJSON()),/几何与 RMSE 不完全相同/);
  assert.match(text(r.toJSON()),/全域 E₂/);
  assert.equal(r.root.findAllByType('tbody')[0].findAllByType('tr').length,6);
  act(()=>r.root.findByProps({'aria-label':'真实地形结果误差目标'}).props.onChange({target:{value:'.5'}}));
  assert.match(text(r.toJSON()),/小 17\.4%/);assert.match(text(r.toJSON()),/大 2\.0%/);
  act(()=>r.unmount());
});

test('supplementary experiments are not mounted until requested; historical deep links expand their group',()=>{
  const prior=globalThis.window;const listeners=new Map();let r;
  try{
    globalThis.window={location:{hash:''},addEventListener:(key,fn)=>listeners.set(key,fn),removeEventListener:key=>listeners.delete(key),setTimeout,clearTimeout};
    let mounts=0;function Probe(){React.useEffect(()=>{mounts++;},[]);return React.createElement('div',null,'heavy');}
    act(()=>r=create(React.createElement(Disclosure,{group:'supplementary',title:'补充',note:'历史'},React.createElement(Probe))));
    assert.equal(mounts,0);assert.equal(r.root.findAllByType(Probe).length,0);
    globalThis.window.location.hash='#terrain-lab';act(()=>listeners.get('hashchange')());
    assert.equal(mounts,1);assert.equal(r.root.findByType('details').props.open,true);
    act(()=>r.root.findByType('details').props.onToggle({currentTarget:{open:false}}));assert.equal(r.root.findAllByType(Probe).length,0);
    act(()=>listeners.get('click')({target:{closest:()=>({getAttribute:()=> '#terrain-lab'})}}));assert.equal(r.root.findByType('details').props.open,true);
    assert.equal(evidenceGroupForHash('#bristol-terrain-decision'),'real');assert.equal(evidenceGroupForHash('#paper-results'),null);
    assert.equal(evidenceGroupForHash('#unrelated'),null);
    act(()=>r.unmount());r=null;assert.equal(listeners.size,0);
  }finally{if(r)act(()=>r.unmount());if(prior===undefined)delete globalThis.window;else globalThis.window=prior;}
});

test('published reports, source, all terminal meshes and scientific figures are hash bound',async()=>{
  const bytes=await readFile(file('../../shared/paper-terrain-metrics.json'));
  assert.deepEqual(bytes,await readFile(file('../public/research/paper-metrics/results.json')));
  const report=JSON.parse(bytes);
  assert.equal(report.source_sha256,sha((await readFile(file('../../data-pipeline/paper_metric_benchmark.py'),'utf8')).replaceAll('\r\n','\n')));
  assert.equal(report.cases.flatMap(c=>c.methods.flatMap(m=>m.rows)).length,81);
  for(const c of report.cases)for(const m of c.methods){const mesh=await readFile(file(`../public/research/paper-metrics/${m.mesh_filename}`));assert.equal(sha(mesh),m.mesh_sha256);assert.equal(JSON.parse(mesh).triangles.length,2048);}
  const figures=JSON.parse(await readFile(file('../public/research/paper-metrics/figures.json')));
  assert.equal(figures.report_sha256,sha(bytes));assert.equal(figures.plot_script_sha256,sha((await readFile(file('../../data-pipeline/plot_paper_metrics.py'),'utf8')).replaceAll('\r\n','\n')));
  for(const [name,hash] of Object.entries(figures.files))assert.equal(sha(await readFile(file(`../public/research/paper-metrics/${name}`))),hash);
});

test('Bristol whole-domain result cards are bound to the unchanged source archives and actual integral script',async()=>{
  const bytes=await readFile(file('../../shared/bristol-global-l2.json')),report=JSON.parse(bytes);
  assert.deepEqual(bytes,await readFile(file('../public/research/bristol-global-l2/results.json')));
  assert.equal(report.source_sha256,sha((await readFile(file('../../data-pipeline/raster_l2_audit.py'),'utf8')).replaceAll('\r\n','\n')));
  assert.equal(report.viewer_manifest_sha256,sha(await readFile(file('../../shared/bristol-viewer-models.json'))));
  assert.equal(report.models.length,18);
  for(const m of report.models){assert.equal(m.integrated_area_m2,4096);assert.ok(m.rms_integral_m<=m.continuous_bound_m);assert.equal(m.rms_integral_m,m.e2_m2/64);assert.equal(sha(await readFile(file(`../public/research/bristol-viewer/models/${m.case_id}/${m.filename}`))),m.sha256);}
  const figs=JSON.parse(await readFile(file('../public/research/bristol-global-l2/figures.json')));
  assert.equal(figs.report_sha256,sha(bytes));assert.equal(figs.plot_script_sha256,sha((await readFile(file('../../data-pipeline/plot_bristol_l2.py'),'utf8')).replaceAll('\r\n','\n')));
  for(const [name,hash] of Object.entries(figs.files))assert.equal(sha(await readFile(file(`../public/research/bristol-global-l2/${name}`))),hash);
});

test('joint integral/max constraints select the exact feasible archive, handle no solution and retain all nine candidates',async()=>{
  const report=JSON.parse(await readFile(file('../../shared/bristol-global-l2.json')));
  const harbour=report.models.filter(m=>m.case_id==='bristol-harbour'),hill=report.models.filter(m=>m.case_id==='bristol-brandon-hill');
  assert.equal(selectIntegralCandidates(harbour,.1,null)[0].bytes,23093);
  assert.equal(selectIntegralCandidates(harbour,.1,.5)[0].bytes,60805);
  assert.equal(selectIntegralCandidates(hill,.1,null)[0].bytes,36764);
  assert.equal(selectIntegralCandidates(hill,.1,1.85)[0].bytes,44037);
  assert.deepEqual(selectIntegralCandidates(harbour,.05,.5),[]);
  for(const invalid of [NaN,Infinity,0,-1]){assert.deepEqual(selectIntegralCandidates(harbour,invalid,null),[]);assert.deepEqual(selectIntegralCandidates(harbour,.1,invalid),[]);}
  let r;act(()=>r=create(React.createElement(IntegralDecision)));
  const change=(label,value)=>act(()=>r.root.findByProps({'aria-label':label}).props.onChange({target:{value}}));
  const verdict=()=>text(r.root.findByProps({className:'paper-integral-verdict'}));
  change('全域积分决策样区','bristol-brandon-hill');assert.match(verdict(),/局部三角带 · 36\.76 kB/);
  change('全域积分E2上限','1.85');assert.match(verdict(),/新局部紧凑混合 · 44\.04 kB/);
  assert.equal(r.root.findAllByType('a')[0].props.href,'/research/bristol-viewer/models/bristol-brandon-hill/local_compact-0.1m.json');
  change('全域积分最大参考界','5');assert.match(verdict(),/没有已测模型同时满足/);assert.equal(r.root.findAllByType('a').length,0);
  assert.equal(r.root.findAllByType('tbody')[0].findAllByType('tr').length,9);
  change('全域积分最大参考界','');assert.match(verdict(),/请输入大于零/);
  assert.match(text(r.toJSON()),/RMS = E₂ \/ 64/);assert.match(text(r.toJSON()),/不保证全局最优/);
  act(()=>r.unmount());
});
