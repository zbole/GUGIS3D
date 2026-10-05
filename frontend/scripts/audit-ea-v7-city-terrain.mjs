import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {build} from 'esbuild';
import {fileURLToPath,pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
const root=fileURLToPath(new URL('../../',import.meta.url)),hash=b=>createHash('sha256').update(b).digest('hex');
const folder=process.argv[2],prefix=process.argv[3];
assert.match(prefix,/^nottingham$/);
await build({entryPoints:[root+'frontend/src/studio/terrainMath.ts'],outfile:folder+'/kernel.mjs',bundle:true,platform:'node',format:'esm'});
const {terrainIndex}=await import(pathToFileURL(folder+'/kernel.mjs').href);
const modelBytes=await readFile(root+`backend/data/terrain/${prefix}-ea-dtm-preview.gugis-terrain.json`);
const info=JSON.parse(await readFile(folder+'/source-info.json')),terrain=JSON.parse(modelBytes),index=terrainIndex(terrain);
assert.equal(info.city_id,prefix);assert.equal(info.model_sha256,hash(modelBytes));
const fixtureBytes=await readFile(folder+'/pixel-queries.json'),fixtures=JSON.parse(fixtureBytes);
assert.equal(fixtures.length,4096);
assert.equal(new Set(fixtures.map(f=>`${f.row}/${f.column}`)).size,4096);
const controls=terrain.points.map(([x,y,z])=>{const hit=index.query(x,y);return hit?Math.abs(hit.height-z):null;});
const errors=[],results=fixtures.map(f=>{const hit=index.query(f.x,f.y);if(hit)errors.push(hit.height-f.source_height_m);return {...f,hit};});
assert.equal(errors.length,4096);assert.ok(controls.every(x=>x!==null&&x<1e-9));const sorted=errors.map(Math.abs).sort((a,b)=>a-b),controlErrors=controls.filter(x=>x!==null);
const report={schema:'gugis-ea-city-preview-audit-v1',city_id:prefix,model_sha256:hash(modelBytes),raster_sha256:info.raster_sha256,
  fixture_sha256:hash(fixtureBytes),native_kernel_sha256:hash((await readFile(root+'frontend/src/studio/terrainMath.ts','utf8')).replace(/\r\n/g,'\n')),
  scripts:{node:hash((await readFile(fileURLToPath(import.meta.url),'utf8')).replace(/\r\n/g,'\n')),
    python:hash((await readFile(root+'data-pipeline/prepare_ea_v7_city_terrain.py','utf8')).replace(/\r\n/g,'\n'))},
  method:'4096 fixed unique valid source 1m pixel centres, seed20261005,40-pixel rim excluded before querying. Misses retained; errors use hits only. Source participates in preview construction, not held-out ground truth.',
  preview_stride_pixels:20,source_pixel_m:1,requested:4096,hits:errors.length,misses:4096-errors.length,
  rmse_m:Math.sqrt(errors.reduce((s,e)=>s+e*e,0)/errors.length),mae_m:errors.reduce((s,e)=>s+Math.abs(e),0)/errors.length,
  p95_absolute_m:sorted[Math.ceil(.95*sorted.length)-1],max_absolute_m:Math.max(...sorted),
  controls_checked:controls.length,controls_hits:controlErrors.length,max_control_query_error_m:Math.max(...controlErrors),
  limits:'Sampled relative source-raster differences, no continuous bound or true-ground accuracy guarantee; ODN unchanged; no ArcGIS run.'};
await writeFile(folder+'/preview-audit.json',JSON.stringify(report,null,2)+'\n');
await writeFile(folder+'/results.json',JSON.stringify(results)+'\n');
const fields=['row','column','x','y','source_height_m','native_height_m','difference_m'];
await writeFile(folder+'/pixel-queries.csv',[fields.join(','),...results.map(r=>[r.row,r.column,r.x,r.y,r.source_height_m,r.hit?.height??'',r.hit?r.hit.height-r.source_height_m:''].join(','))].join('\n')+'\n');
console.log(JSON.stringify(report,null,2));
