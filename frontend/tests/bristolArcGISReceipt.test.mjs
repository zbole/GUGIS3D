import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {build} from 'esbuild';
import {fileURLToPath,pathToFileURL} from 'node:url';
import React from 'react';
import {create,act} from 'react-test-renderer';
const file=p=>new URL(p,import.meta.url),sha=b=>createHash('sha256').update(b).digest('hex');
async function bundle(name,entry){const outfile=fileURLToPath(file(`../node_modules/.cache/gugis-tests/${name}.mjs`));await build({entryPoints:[fileURLToPath(file(entry))],outfile,bundle:true,platform:'node',format:'esm',packages:'external'});return import(pathToFileURL(outfile).href);}
const {validateBristolArcGISReceipt:validate}=await bundle('bristol-arcgis-receipt','../src/compare/bristolArcGISReceipt.ts');
const {default:Card}=await bundle('bristol-arcgis-card','../src/compare/BristolArcGISRun.tsx');
const protocol=JSON.parse(await readFile(file('../../shared/bristol-arcgis-protocol.json')));
const text=n=>typeof n==='string'?n:(n?.children??[]).map(text).join('');
// Deliberately artificial unit-test numbers. Never published as ArcGIS results.
function fixture(){return {schema:'gugis-bristol-arcgis-run-v1',manifest_sha256:protocol.manifest_sha256,runner_sha256:protocol.runner_sha256,repeats:5,cache_policy:'one-process-one-warmup-per-operation-five-repeats-no-cold-cache-guarantee',operations:['SearchCursor-SHAPE@-and-SAMPLE_ID','CopyFeatures-to-new-FGDB'],measured_at_utc:'2026-10-05T08:00:00+00:00',runtime:{product:'ArcGISPro',version:'TEST-ONLY',license:'Advanced',python:'3.11',os:'unit-test',processor:''},results:protocol.models.map(m=>({id:m.id,native_sha256:m.native_sha256,geometry_sha256:m.geometry_sha256,coordinate_sha256:m.coordinate_sha256,feature_count:1,vertex_count:m.multipatch_vertices,horizontal_wkid:27700,has_z:true,source_coordinates_identical:true,copy_coordinates_identical:true,read_ms:[3,1,2,5,4],copy_ms:[30,10,20,50,40],copy_output_bytes:[100,101,102,103,104],median_read_ms:3,median_copy_ms:30}))};}

test('six sample receipt is order independent and computes medians from original records',()=>{
  const value=fixture();value.results.reverse();const result=validate(value);
  assert.equal(result.results.length,6);assert.equal(result.results[0].median_read_ms,3);
  assert.equal(result.results[0].id,protocol.models[5].id);
});

test('rejects stale package, missing/duplicated sample, coordinate failure and misleading medians',()=>{
  const changes=[r=>r.manifest_sha256='0'.repeat(64),r=>r.runner_sha256='0'.repeat(64),r=>r.results.pop(),r=>r.results[1]=r.results[0],r=>r.results[0].coordinate_sha256='0'.repeat(64),r=>r.results[0].native_sha256='0'.repeat(64),r=>r.results[0].copy_coordinates_identical=false,r=>r.results[0].vertex_count++,r=>r.results[0].median_read_ms=1,r=>r.cache_policy='cold',r=>r.operations.reverse(),r=>r.runtime.product='ArcMap',r=>r.runtime.license='Unavailable',r=>r.measured_at_utc='yesterday'];
  for(const change of changes){const r=fixture();change(r);assert.throws(()=>validate(r));}
  for(const v of [0,-1,NaN,Infinity,'3']){const r=fixture();r.results[0].read_ms[2]=v;assert.throws(()=>validate(r));}
  const r=fixture();r.results[0].copy_output_bytes[0]=1.5;assert.throws(()=>validate(r));
});

test('pending card displays file evidence and no unmeasured software speedup',()=>{
  let r;act(()=>r=create(React.createElement(Card,{target:.1})));
  assert.match(text(r.toJSON()),/软件耗时待测/);assert.equal(r.root.findAllByType('tbody')[0].findAllByType('tr').length,2);
  assert.match(text(r.toJSON()),/不能用它们计算跨产品加速比/);
  assert.match(text(r.toJSON()),/49\.79/);assert.match(text(r.toJSON()),/69\.55/);
  act(()=>r.update(React.createElement(Card,{target:.5})));assert.match(text(r.toJSON()),/50 cm/);
  act(()=>r.unmount());
});

test('result import is bounded, clears invalid values, and clear/unmount cancel outstanding reads',async()=>{
  let r;act(()=>r=create(React.createElement(Card,{target:.1})));
  const input=()=>r.root.findByProps({'aria-label':'导入布里斯托ArcGIS结果'});
  const importFile=async content=>{const bytes=new TextEncoder().encode(content);await act(async()=>{input().props.onChange({currentTarget:{value:'file',files:[{size:bytes.length,arrayBuffer:async()=>bytes.buffer}]}});});for(let i=0;i<50&&input().props.disabled;i++)await act(async()=>{await new Promise(resolve=>setTimeout(resolve,5));});assert.equal(input().props.disabled,false);};
  await importFile(JSON.stringify(fixture()));assert.match(text(r.toJSON()),/已导入运行者结果/);assert.match(text(r.toJSON()),/未独立复现/);
  await importFile('{');assert.match(text(r.toJSON()),/软件耗时待测/);assert.doesNotMatch(text(r.toJSON()),/TEST-ONLY/);
  let release;const slow=new Promise(resolve=>{release=resolve;});
  act(()=>input().props.onChange({currentTarget:{value:'file',files:[{size:8,arrayBuffer:()=>slow}]}}));
  act(()=>r.root.findByProps({className:'paper-receipt-clear'}).props.onClick());
  const bytes=new TextEncoder().encode(JSON.stringify(fixture()));await act(async()=>{release(bytes.buffer);await slow;});
  assert.match(text(r.toJSON()),/已清除本页导入结果/);assert.doesNotMatch(text(r.toJSON()),/TEST-ONLY/);
  act(()=>input().props.onChange({currentTarget:{value:'file',files:[{size:128*1024+1,arrayBuffer:()=>assert.fail('oversize file must not be read')}]}}));
  assert.match(text(r.toJSON()),/超过 128 KiB/);act(()=>r.unmount());
});

test('current package binds old measured geometry, global integral, and runner sources',async()=>{
  const manifest=await readFile(file('../public/research/bristol-arcgis/manifest.json'));
  assert.equal(sha(manifest),protocol.manifest_sha256);
  assert.equal(sha(await readFile(file(`../public/research/bristol-arcgis/${protocol.download.filename}`))),protocol.download.sha256);
  for(const [name,key] of [['run_bristol_arcgis.py','runner_sha256'],['package_bristol_arcgis.py','packager_sha256']])assert.equal(sha((await readFile(file(`../../data-pipeline/${name}`),'utf8')).replaceAll('\r\n','\n')),protocol[key]);
  assert.equal(sha(await readFile(file('../../shared/bristol-certified-terrain.json'))),protocol.parent_report_sha256);
  assert.equal(sha(await readFile(file('../../shared/bristol-global-l2.json'))),protocol.integral_report_sha256);
  for(const m of protocol.models){assert.equal(m.files.filter(f=>!f.path.endsWith('native.json')).reduce((sum,f)=>sum+f.bytes,0),m.multipatch_core_bytes);assert.ok(m.multipatch_vertices>=m.native_points);}
});
