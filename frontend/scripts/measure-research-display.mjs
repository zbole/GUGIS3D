// CPU-only geometry audit. No browser, WebGL, ArcGIS or GPU measurements.
import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {cpus} from 'node:os';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {build} from 'esbuild';
const root=new URL('../../',import.meta.url),frontend=new URL('../',import.meta.url);
const sha=b=>createHash('sha256').update(b).digest('hex');
const sourceSha=async url=>sha((await readFile(url,'utf8')).replace(/\r\n/g,'\n'));
const outdir=new URL('.local/benchmark/display-reuse-2026-10-05/',root);
await mkdir(outdir,{recursive:true});
const bundle=new URL('node_modules/.cache/gugis-tests/display-reuse-audit.mjs',frontend);
await build({stdin:{contents:"export {researchTerrainMeshes} from './src/compare/researchTerrainMesh'; export {surfaceGeometry} from './src/studio/terrainScene';",
  resolveDir:fileURLToPath(frontend)},outfile:fileURLToPath(bundle),bundle:true,platform:'node',format:'esm',packages:'external'});
const {researchTerrainMeshes,surfaceGeometry}=await import(pathToFileURL(fileURLToPath(bundle)).href);
const parents={},records=[];
function faceHash(meshes){
  const h=createHash('sha256');
  for(const [kind,mesh] of Object.entries(meshes)){
    h.update(kind+'\n');
    for(const face of mesh.triangles)h.update(JSON.stringify(face.map(index=>mesh.vertices[index]))+'\n');
  }
  return h.digest('hex');
}
function measure(terrain,target,shared){
  const start=performance.now(),result=researchTerrainMeshes(terrain,Math.max(.01,target/2),180000,shared);
  let bytes=0,positionBytes=0,normalBytes=0,indexBytes=0,faces=0;
  for(const [kind,mesh] of Object.entries(result.meshes)){
    faces+=mesh.triangles.length;
    const geometry=surfaceGeometry(terrain,kind,mesh);if(!geometry)continue;
    positionBytes+=geometry.attributes.position.values.byteLength;
    normalBytes+=geometry.attributes.normal.values.byteLength;
    indexBytes+=geometry.indices.byteLength;
    bytes+=Object.values(geometry.attributes).reduce((sum,a)=>sum+(a?.values?.byteLength??0),0)+geometry.indices.byteLength;
  }
  const prepareMs=performance.now()-start;
  return {vertices:result.vertices,triangles:faces,typed_array_bytes:bytes,position_bytes:positionBytes,
    normal_bytes:normalBytes,index_bytes:indexBytes,display_bound_m:result.displayBound,capped:result.capped,
    face_sha256:faceHash(result.meshes),prepare_ms:prepareMs};
}
for(const name of ['strip-compaction-benchmark.json','raster-triangle-benchmark.json']){
  const raw=await readFile(new URL('shared/'+name,root));parents[name]=sha(raw);
  const report=JSON.parse(raw);
  for(const c of report.cases)for(const v of c.variants)for(const family of ['hybrid','compact_hybrid','local_triangles']){
    const receipt=v[family],url=new URL(`public/research/hybrid-terrain/models/${c.id}/${receipt.filename}`,frontend);
    const bytes=await readFile(url);assert.equal(bytes.length,receipt.bytes);assert.equal(sha(bytes),receipt.sha256);
    const terrain=JSON.parse(bytes),before=JSON.stringify(terrain);
    // Warm both paths, then alternate their order across three measurements.
    measure(terrain,v.target_m,false);measure(terrain,v.target_m,true);
    const runs={expanded:[],shared:[]};
    for(let i=0;i<3;i++)for(const mode of i%2?['shared','expanded']:['expanded','shared']){
      global.gc?.();runs[mode].push(measure(terrain,v.target_m,mode==='shared'));
    }
    const median=items=>[...items].sort((a,b)=>a.prepare_ms-b.prepare_ms)[1];
    const expanded=median(runs.expanded),shared=median(runs.shared);
    assert.equal(expanded.face_sha256,shared.face_sha256,'Oriented display geometry changed');
    assert.equal(expanded.triangles,shared.triangles);assert.equal(expanded.index_bytes,shared.index_bytes);
    assert.equal(expanded.display_bound_m,shared.display_bound_m);assert.equal(expanded.capped,shared.capped);
    assert.equal(JSON.stringify(terrain),before,'Native archive mutated');
    assert.ok(shared.vertices<=expanded.vertices);assert.ok(shared.typed_array_bytes<=expanded.typed_array_bytes);
    records.push({case_id:c.id,case_name:c.name,target_m:v.target_m,family,archive_sha256:receipt.sha256,
      archive_bytes:receipt.bytes,filename:receipt.filename,expanded,shared,
      vertex_saving_percent:expanded.vertices?(1-shared.vertices/expanded.vertices)*100:0,
      buffer_saving_percent:expanded.typed_array_bytes?(1-shared.typed_array_bytes/expanded.typed_array_bytes)*100:0});
  }
}
assert.equal(records.length,84);
const report={schema:'gugis-research-display-reuse-v1',generated_at:'2026-10-05',parents,
  sources:{mesh:await sourceSha(new URL('src/compare/researchTerrainMesh.ts',frontend)),
    geometry:await sourceSha(new URL('src/studio/terrainScene.ts',frontend)),
    native_query:await sourceSha(new URL('src/studio/terrainMath.ts',frontend)),script:await sourceSha(new URL(import.meta.url))},
  runtime:{node:process.version,platform:process.platform,cpu:cpus()[0].model,logical_cpus:cpus().length,explicit_gc:!!global.gc},
  method:{models:84,trials:3,metric:'Actual Cesium CPU geometry attribute and index TypedArray byteLength',
    timing:'CPU tessellation + attributes/normals; alternating mode order, median of three after warm-up; GC and face hash audit outside timing',
    sharing:'Exact coordinates only; no rounding, no resampling, no triangle removal; sharing is separate per surface kind',
    normals:'Shared vertices change estimated lighting normals; native height/slope queries are unchanged',
    limits:'Original expanded vertex budget remains conservative and unchanged',
    exclusions:'Not full retained heap, peak allocation, wire overlay, Cesium internal buffers, driver/GPU memory, browser FPS or ArcGIS software performance'},records};
await writeFile(new URL('report.json',outdir),JSON.stringify(report,null,2)+'\n');
const columns=['case_id','target_m','family','archive_sha256','expanded_vertices','shared_vertices','expanded_buffer_bytes','shared_buffer_bytes','vertex_saving_percent','buffer_saving_percent','display_bound_m','oriented_faces_unchanged'];
const csv=[columns.join(','),...records.map(r=>[r.case_id,r.target_m,r.family,r.archive_sha256,r.expanded.vertices,r.shared.vertices,
  r.expanded.typed_array_bytes,r.shared.typed_array_bytes,r.vertex_saving_percent,r.buffer_saving_percent,r.shared.display_bound_m,true].join(','))].join('\n')+'\n';
await writeFile(new URL('report.csv',outdir),csv);
console.log(JSON.stringify({records:records.length,swiss_10cm:records.filter(r=>r.case_id==='swiss-dem-crop'&&r.target_m===.1)
  .map(r=>({family:r.family,expanded_vertices:r.expanded.vertices,shared_vertices:r.shared.vertices,buffer_saving_percent:r.buffer_saving_percent,
    expanded_ms:r.expanded.prepare_ms,shared_ms:r.shared.prepare_ms})),output:fileURLToPath(outdir)},null,2));
