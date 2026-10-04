import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import React from 'react';
import { create, act } from 'react-test-renderer';
const report = JSON.parse(await readFile(new URL('../../shared/implicit-terrain-benchmark.json', import.meta.url), 'utf8'));
const outfile = fileURLToPath(new URL('../node_modules/.cache/gugis-tests/ImplicitTerrainBenchmark.mjs', import.meta.url));
await build({ entryPoints: [fileURLToPath(new URL('../src/compare/ImplicitTerrainBenchmark.tsx', import.meta.url))],
  bundle: true, platform: 'node', format: 'esm', packages: 'external', outfile, loader: { '.css': 'empty' } });
const Benchmark = (await import(pathToFileURL(outfile).href)).default;
const text = node => typeof node === 'string' ? node : (node.children ?? []).map(text).join('');

test('each control-grid selection updates actual precision, file bytes, error plot and honest signed comparison', () => {
  let renderer; act(() => { renderer=create(React.createElement(Benchmark)); });
  for (const variant of report.variants) {
    act(() => renderer.root.findByType('select').props.onChange({target:{value:String(variant.stride_m)}}));
    const kpis=text(renderer.root.findByProps({className:'research-kpis'}));
    assert.ok(kpis.includes((variant.metrics.rmse_m*100).toFixed(2)));
    assert.ok(kpis.includes((variant.bytes/1e6).toFixed(3)));
    assert.match(kpis, variant.bytes>report.spg.bytes ? /文件增加/ : /文件减少/);
    assert.ok(renderer.root.findAllByType('img').some(img => img.props.src.endsWith(`${variant.id}-error.png`)));
    const table=text(renderer.root.findAllByType('table')[0]);
    assert.ok(table.includes((variant.metrics.max_absolute_m*100).toFixed(2)));
    assert.ok(table.includes(variant.metrics.psnr_peak_1_db.toFixed(2)));
  }
  assert.match(text(renderer.root), /ArcGIS 软件运行待测/);
  assert.match(text(renderer.root), /不同运行库，不能推断软件快慢/);
  assert.match(text(renderer.root), /不代表英国城市地形/);
  act(() => renderer.unmount());
});

test('benchmark reports retain required recovery metadata, raw-reference accounting and independent readback evidence', async () => {
  const publicReport=JSON.parse(await readFile(new URL('../public/research/implicit-terrain/results.json', import.meta.url),'utf8'));
  assert.deepEqual(publicReport,report);
  const recovery=await readFile(new URL('../public/research/implicit-terrain/spg-recovery-sidecar.json', import.meta.url),'utf8');
  assert.equal(Buffer.byteLength(recovery, 'utf8'), report.spg.sidecar_bytes);
  assert.ok(JSON.parse(recovery).residual_range_normalized.length===2);
  assert.equal(report.spg.bytes,report.spg.weights.reduce((sum,w)=>sum+w.bytes,0)+report.spg.sidecar_bytes);
  assert.equal(report.dataset.evaluated_samples,1000000);
  assert.equal(report.dataset.raw_float32_reference_bytes,4000000);
  assert.equal(report.spg.training_ms,null);
  assert.ok(Math.abs(report.spg.metrics.psnr_peak_1_db-66.39307498931885)<.001);
  assert.ok(report.pending.some(p=>p.includes('ArcGIS')));
  for(const v of report.variants){
    assert.equal(v.query_count,4096); assert.equal(v.query_repetitions_ms.length,5);
    assert.equal(v.kernel_probe_count,512); assert.ok(v.kernel_readback_max_difference_m<1e-6);
    assert.equal(v.kinds['ruled-strip']+v.kinds['triangle-strip'],v.patches);
    assert.equal(v.multipatch.components.length,5);
    assert.equal(v.multipatch.bytes,v.multipatch.components.reduce((total,part)=>total+part.bytes,0));
    assert.ok(Math.abs(v.multipatch.native_file_saving_percent - 100*(1-v.bytes/v.multipatch.bytes))<1e-8);
    const image=await readFile(new URL(`../public/research/implicit-terrain/${v.id}-error.png`,import.meta.url));
    assert.equal(image.subarray(1,4).toString(),'PNG');
  }
  const rows=(await readFile(new URL('../public/research/implicit-terrain/results.csv',import.meta.url),'utf8')).replace(/^\uFEFF/,'').trim().split(/\r?\n/).slice(1).map(row=>row.split(','));
  assert.equal(rows.length,13);
  for (const variant of report.variants) for (const [kind, result] of [['GUGIS', variant], ['MultiPatch',variant.multipatch]]) {
    const row=rows.find(row=>row[0]===kind && Number(row[1])===variant.stride_m);
    assert.ok(row); assert.equal(Number(row[2]),result.bytes); assert.equal(Number(row[3]),result.metrics.rmse_m);
  }
});

test('off-grid audit uses matching archives and its own original-source statistics without claiming held-out accuracy', async () => {
  const base=await readFile(new URL('../../shared/implicit-terrain-benchmark.json',import.meta.url));
  const audit=JSON.parse(await readFile(new URL('../../shared/implicit-terrain-offgrid.json',import.meta.url),'utf8'));
  const publicAudit=JSON.parse(await readFile(new URL('../public/research/implicit-terrain/offgrid-results.json',import.meta.url),'utf8'));
  assert.deepEqual(publicAudit,audit);
  assert.equal(audit.parent_report_sha256,createHash('sha256').update(base).digest('hex'));
  assert.equal(audit.source_sha256,report.dataset.source_sha256);
  assert.equal(audit.samples,16384);assert.equal(audit.unique_samples,audit.samples);
  assert.equal(audit.held_out,false);assert.equal(audit.source_resolution_m,.5);
  assert.equal(audit.variants.length,report.variants.length);
  let renderer;act(()=>{renderer=create(React.createElement(Benchmark));});
  for(const variant of audit.variants){
    assert.equal(variant.archive_sha256,report.variants.find(v=>v.id===variant.id).sha256);
    assert.equal(variant.query_repetitions_ms.length,5);
    assert.ok(variant.metrics.max_absolute_m>=variant.metrics.p95_absolute_m);
    assert.ok(variant.metrics.rmse_m>=variant.metrics.mae_m);
    act(()=>renderer.root.findByType('select').props.onChange({target:{value:String(variant.stride_m)}}));
    const section=text(renderer.root.findByProps({id:'offgrid-audit'}));
    assert.ok(section.includes((variant.metrics.rmse_m*100).toFixed(2)));
    assert.ok(section.includes((variant.metrics.max_absolute_m*100).toFixed(2)));
    assert.match(section,/这不是独立留出测试集/);
    assert.match(section,/不与上方百万个 1 m 网格点的统计混用/);
  }
  act(()=>renderer.unmount());
  const csv=(await readFile(new URL('../public/research/implicit-terrain/offgrid-results.csv',import.meta.url),'utf8')).trim().split(/\r?\n/);
  assert.equal(csv.length,8);
  for(const row of csv.slice(1))assert.match(row,/,False$/);
});
test('native index comparison publishes matched archives, identical complete hits, measured overhead and all selections', async () => {
  const audit=JSON.parse(await readFile(new URL('../../shared/terrain-index-benchmark.json',import.meta.url)));
  const published=JSON.parse(await readFile(new URL('../public/research/implicit-terrain/terrain-index-benchmark.json',import.meta.url)));
  assert.deepEqual(published,audit);
  const source=(await readFile(new URL('../src/studio/terrainMath.ts',import.meta.url),'utf8')).replace(/\r\n/g,'\n');
  assert.equal(audit.source_sha256.after,createHash('sha256').update(source).digest('hex'));
  assert.equal(audit.query_count,4096);
  assert.equal(audit.reports.length,report.variants.length);
  const med=values=>[...values].sort((a,b)=>a-b)[Math.floor(values.length/2)];
  let renderer;act(()=>{renderer=create(React.createElement(Benchmark));});
  for(const row of audit.reports){
    assert.equal(row.archive_sha256,report.variants.find(v=>v.id===row.id).sha256);
    assert.equal(row.results_identical,true);
    for(const variant of [row.before,row.after]){
      assert.equal(variant.trials.length,3);
      assert.equal(variant.query_median_ms,med(variant.trials.map(t=>t.query_median_ms)));
      for(const trial of variant.trials){
        assert.equal(trial.result_sha256,row.result_sha256);
        assert.equal(trial.query_repetitions_ms.length,9);
        assert.equal(trial.query_median_ms,med(trial.query_repetitions_ms));
      }
    }
    assert.equal(row.speedup,row.before.query_median_ms/row.after.query_median_ms);
    assert.ok(row.after.statistics.memberships<=row.after.statistics.membershipBudget);
    act(()=>renderer.root.findByType('select').props.onChange({target:{value:String(row.stride_m)}}));
    const section=text(renderer.root.findByProps({id:'native-index-audit'}));
    assert.ok(section.includes(row.after.query_median_ms.toFixed(2)));
    assert.ok(section.includes((row.after.retained_index_heap_bytes/1e6).toFixed(3)));
    assert.match(section,/不是 ArcGIS 或 SPG 的速度结果/);
    assert.match(section,row.speedup>=1 ? /该档查询加速/ : /该档未加速/);
  }
  act(()=>renderer.unmount());
});
test('format comparison includes compact and joined baselines, full accounting and signed losses',async()=>{
  const packingBytes=await readFile(new URL('../../shared/implicit-terrain-packing.json',import.meta.url));
  const packing=JSON.parse(packingBytes);
  const joined=JSON.parse(await readFile(new URL('../../shared/implicit-terrain-joined.json',import.meta.url)));
  const base=await readFile(new URL('../../shared/implicit-terrain-benchmark.json',import.meta.url));
  assert.equal(packing.parent_report_sha256,createHash('sha256').update(base).digest('hex'));
  assert.equal(joined.parent_packing_sha256,createHash('sha256').update(packingBytes).digest('hex'));
  for(const [file,report] of [['packing-results.json',packing],['joined-results.json',joined]])
    assert.deepEqual(JSON.parse(await readFile(new URL(`../public/research/implicit-terrain/${file}`,import.meta.url))),report);
  let renderer;act(()=>{renderer=create(React.createElement(Benchmark));});
  for(const row of joined.variants){
    const previous=packing.variants.find(v=>v.id===row.id);
    assert.equal(row.native_sha256,report.variants.find(v=>v.id===row.id).sha256);
    assert.equal(row.geometry_only_bytes,row.components.reduce((sum,f)=>sum+f.bytes,0));
    assert.equal(row.with_patch_metadata_bytes,row.geometry_only_bytes+row.sidecars.reduce((sum,f)=>sum+f.bytes,0));
    assert.equal(row.triangles,report.variants.find(v=>v.id===row.id).multipatch.triangles);
    assert.ok(row.after_parts<=row.before_parts);assert.ok(row.after_vertices<=row.before_vertices);
    assert.equal(previous.original.xyz_parts_sha256,previous.packed.xyz_parts_sha256);
    assert.equal(previous.geometry_only_bytes,previous.components.reduce((sum,f)=>sum+f.bytes,0));
    assert.equal(row.native_saving_percent,100*(1-row.native_bytes/row.geometry_only_bytes));
    assert.equal(row.arcgis_execution,null);
    if([8,16].includes(row.stride_m))assert.equal(row.readback_vs_original_max_m,0);
    act(()=>renderer.root.findByType('select').props.onChange({target:{value:String(row.stride_m)}}));
    const section=text(renderer.root.findByProps({className:'research-format-result'}));
    assert.ok(section.includes((row.geometry_only_bytes/1e6).toFixed(3)));
    assert.ok(section.includes(`${row.native_saving_percent>=0?'小':'大'} ${Math.abs(row.native_saving_percent).toFixed(1)}%`));
    assert.match(section,/不能沿用原分组方式的文件节省百分比/);
  }
  act(()=>renderer.unmount());
});
