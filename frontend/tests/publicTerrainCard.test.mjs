import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {create,act} from 'react-test-renderer';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {componentBundle} from './helpers/componentBundle.mjs';
const Card=await componentBundle('PublicTerrainCard');
const source=JSON.parse(await readFile(new URL('../../shared/public-terrain-sources.json',import.meta.url))).sources[0];
const text=node=>typeof node==='string'?node:(node?.children??[]).map(text).join('');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');

test('public DTM card distinguishes original resolution, coarse preview errors and unsaved workflow',async()=>{
  let renderer,previews=0;
  const api={publicTerrainSource:async()=>({status:'available',source}),publicTerrainRasterUrl:'/api/cities/bristol/city/terrain/public-raster.tif'};
  await act(async()=>{renderer=create(React.createElement(Card,{api,disabled:false,onPreview:()=>previews++}));});
  const content=text(renderer.toJSON());
  assert.match(content,/20 像元采样/);assert.match(content,/RMSE 0\.608 m · 最大差 6\.822 m/);
  assert.match(content,/独立草稿/);assert.match(content,/WCS Elevation/);
  const button=renderer.root.findAllByType('button').find(n=>text(n)==='预览环境署真实 DTM');
  act(()=>button.props.onClick());assert.equal(previews,1);
  assert.equal(renderer.root.findAllByType('a')[0].props.href,api.publicTerrainRasterUrl);
  act(()=>renderer.update(React.createElement(Card,{api,disabled:true,onPreview:()=>previews++})));
  assert.equal(renderer.root.findAllByType('button')[0].props.disabled,true);
  act(()=>renderer.unmount());
});

test('late Bristol source cannot replace a newly selected pending city; failed metadata can retry',async()=>{
  let resolveBristol,renderer,calls=0;
  const slow={publicTerrainSource:()=>new Promise(resolve=>{resolveBristol=resolve;}),publicTerrainRasterUrl:'/bristol.tif'};
  const london={publicTerrainSource:async()=>({status:'pending',source:null}),publicTerrainRasterUrl:'/london.tif'};
  await act(async()=>{renderer=create(React.createElement(Card,{api:slow,disabled:false,onPreview:()=>{}}));});
  await act(async()=>renderer.update(React.createElement(Card,{api:london,disabled:false,onPreview:()=>{}})));
  await act(async()=>resolveBristol({status:'available',source}));
  assert.match(text(renderer.toJSON()),/尚无已取得的公开 DTM/);
  assert.doesNotMatch(text(renderer.toJSON()),/6\.822/);
  const flaky={publicTerrainSource:async()=>{if(!calls++)throw new Error('503 来源指纹异常');return {status:'available',source};},publicTerrainRasterUrl:'/bristol.tif'};
  await act(async()=>renderer.update(React.createElement(Card,{api:flaky,disabled:false,onPreview:()=>{}})));
  assert.match(text(renderer.toJSON()),/503 来源指纹异常/);
  await act(async()=>renderer.root.findByType('button').props.onClick());
  assert.match(text(renderer.toJSON()),/RMSE 0\.608/);assert.equal(calls,2);
  act(()=>renderer.unmount());
});

test('Bristol original-pixel audit binds actual raster, preview, fixtures and frozen query scripts',async()=>{
  const auditBytes=await readFile(new URL('../../shared/bristol-terrain-preview-audit.json',import.meta.url));
  const report=JSON.parse(auditBytes);
  assert.equal(hash(auditBytes),source.sample_audit_sha256);
  assert.equal(hash(await readFile(new URL('../../backend/data/terrain/bristol-ea-dtm-1m.tif',import.meta.url))),source.raster_sha256);
  assert.equal(hash(await readFile(new URL('../../backend/data/terrain/bristol-ea-dtm-preview.gugis-terrain.json',import.meta.url))),source.model_sha256);
  assert.equal(hash(await readFile(new URL('../public/research/bristol-terrain/pixel-queries.json',import.meta.url))),report.fixture_sha256);
  assert.equal(hash(await readFile(new URL('../public/research/bristol-terrain/preview-audit.json',import.meta.url))),hash(auditBytes));
  for(const [expected,path] of [[report.native_kernel_sha256,'../src/studio/terrainMath.ts'],[report.scripts.node,'../scripts/audit-bristol-terrain.mjs'],[report.scripts.python,'../../data-pipeline/audit_bristol_public_terrain.py']])
    assert.equal(hash((await readFile(new URL(path,import.meta.url),'utf8')).replace(/\r\n/g,'\n')),expected);
  const csv=(await readFile(new URL('../public/research/bristol-terrain/pixel-queries.csv',import.meta.url),'utf8')).trim().split('\n');
  assert.equal(csv.length,4097);assert.equal(report.hits,4096);assert.equal(report.misses,0);
  assert.equal(report.controls_checked,15480);assert.ok(report.max_control_query_error_m<1e-10);
  const rows=csv.slice(1).map(line=>line.split(',').map(Number));
  const errors=rows.map(row=>row[6]);
  assert.ok(Math.abs(Math.sqrt(errors.reduce((sum,e)=>sum+e*e,0)/4096)-report.rmse_m)<1e-12);
  assert.ok(Math.abs(Math.max(...errors.map(Math.abs))-report.max_absolute_m)<1e-12);
  const figures=JSON.parse(await readFile(new URL('../public/research/bristol-terrain/figures.json',import.meta.url)));
  assert.equal(figures.audit_sha256,hash(auditBytes));assert.equal(figures.raster_sha256,source.raster_sha256);
  assert.equal(hash((await readFile(new URL('../../data-pipeline/plot_bristol_terrain_source.py',import.meta.url),'utf8')).replace(/\r\n/g,'\n')),figures.plotter_sha256);
  for(const [name,entry] of Object.entries(figures.files)){
    const bytes=await readFile(new URL('../public/research/bristol-terrain/'+name,import.meta.url));
    assert.equal(bytes.length,entry.bytes);assert.equal(hash(bytes),entry.sha256);
  }
});
