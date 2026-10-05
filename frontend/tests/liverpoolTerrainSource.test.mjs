import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {terrainIndex} from '../src/studio/terrainMath.ts';
const url=p=>new URL(p,import.meta.url),sha=b=>createHash('sha256').update(b).digest('hex');
const read=p=>readFile(url(p));
test('Liverpool current source retains historical eight-city provenance and new audit scripts and scientific figures',async()=>{
  const previous=await read('../../shared/public-terrain-sources-v3.json');
  const release=JSON.parse(await read('../../shared/public-terrain-sources-v4.json'));
  assert.equal(release.parent_manifest.sha256,sha(previous));assert.deepEqual(release.sources.slice(0,8),JSON.parse(previous).sources);
  const source=release.sources.find(s=>s.city_id==='liverpool'),base='../public/research/liverpool-terrain/';
  const auditBytes=await read(base+'preview-audit.json'),audit=JSON.parse(auditBytes);
  assert.equal(sha(auditBytes),source.sample_audit_sha256);
  for(const [digest,path] of [[audit.scripts.python,'../../data-pipeline/prepare_ea_v4_city_terrain.py'],[audit.scripts.node,'../scripts/audit-ea-v4-city-terrain.mjs'],[audit.native_kernel_sha256,'../src/studio/terrainMath.ts']])assert.equal(sha((await readFile(url(path),'utf8')).replace(/\r\n/g,'\n')),digest);
  const figs=JSON.parse(await read(base+'figures.json'));
  assert.equal(figs.audit_sha256,sha(auditBytes));assert.equal(figs.raster_sha256,source.raster_sha256);
  assert.equal(figs.plotter_sha256,sha((await readFile(url('../../data-pipeline/plot_ea_v4_terrain.py'),'utf8')).replace(/\r\n/g,'\n')));
  for(const [name,receipt] of Object.entries(figs.files)){const b=await read(base+name);assert.equal(b.length,receipt.bytes);assert.equal(sha(b),receipt.sha256);}
});
test('saved Liverpool functions reproduce every source query and all controls with unsuppressed outliers',async()=>{
  const release=JSON.parse(await read('../../shared/public-terrain-sources-v4.json')),source=release.sources.find(s=>s.city_id==='liverpool');
  const bytes=await read('../../backend/data/terrain/liverpool-ea-dtm-preview.gugis-terrain.json');assert.equal(sha(bytes),source.model_sha256);
  const model=JSON.parse(bytes),index=terrainIndex(model),fixtures=JSON.parse(await read('../public/research/liverpool-terrain/pixel-queries.json'));
  assert.deepEqual(new Set(model.patches.map(p=>p.kind)),new Set(['ruled-strip','triangle-strip']));
  const errors=fixtures.map(f=>{const q=index.query(f.x,f.y);assert.ok(q);return q.height-f.source_height_m;});
  assert.ok(fixtures.some(f=>f.source_height_m<0));assert.ok(model.points.some(p=>p[2]<0));assert.equal(errors.length,4096);assert.ok(Math.abs(Math.sqrt(errors.reduce((n,e)=>n+e*e,0)/4096)-source.sample_audit.rmse_m)<1e-12);
  assert.equal(Math.max(...errors.map(Math.abs)),source.sample_audit.max_absolute_m);
  assert.ok(Math.max(...errors.map(Math.abs))>11);
  for(const [x,y,z] of model.points){const q=index.query(x,y);assert.ok(q);assert.ok(Math.abs(q.height-z)<1e-9);}
});
