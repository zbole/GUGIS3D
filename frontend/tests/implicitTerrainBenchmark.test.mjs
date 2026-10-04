import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
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
    const table=text(renderer.root.findByType('table'));
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
