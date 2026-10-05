import {readFile,writeFile,access} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import assert from 'node:assert/strict';
const root=fileURLToPath(new URL('../../',import.meta.url)),folder=process.argv[2];
const sha=b=>createHash('sha256').update(b).digest('hex');
const reportBytes=await readFile(folder+'/results.json'),report=JSON.parse(reportBytes);
assert.equal(report.schema,'gugis-cambridge-certified-terrain-v1');
assert.equal(report.cases.length,2);assert.equal(report.cases.reduce((n,c)=>n+c.models.length,0),12);
const output=folder+'/native-query-audit.json';
await assert.rejects(access(output),{code:'ENOENT'});
await build({entryPoints:[root+'frontend/src/studio/terrainMath.ts'],outfile:folder+'/native-kernel.mjs',bundle:true,platform:'node',format:'esm'});
const {terrainIndex}=await import(pathToFileURL(folder+'/native-kernel.mjs').href);
const rows=[];
for(const c of report.cases){
  const fixtureBytes=await readFile(`${folder}/${c.id}/query-fixture.json`),fixture=JSON.parse(fixtureBytes);
  assert.equal(sha(fixtureBytes),c.fixture_sha256);assert.equal(fixture.xy.length,4096);
  for(const m of c.models){
    const bytes=await readFile(`${folder}/${c.id}/${m.filename}`);assert.equal(sha(bytes),m.sha256);assert.equal(bytes.length,m.bytes);
    const model=JSON.parse(bytes),index=terrainIndex(model),residuals=[],answers=[];
    for(let i=0;i<fixture.xy.length;i++){
      const [x,y]=fixture.xy[i],hit=index.query(x,y),error=hit?hit.height-fixture.reference[i]:null;
      if(hit){assert.ok(Math.abs(error)<=m.continuous_bound_m+1e-8);residuals.push(error);}
      answers.push([x,y,fixture.reference[i],hit?.height??'',error??'']);
    }
    assert.equal(residuals.length,4096,'No domain holes in native query');
    const controls=model.points.map(([x,y,z])=>{const hit=index.query(x,y);assert.ok(hit);return Math.abs(hit.height-z);});
    assert.ok(Math.max(...controls)<1e-9);
    const sorted=residuals.map(Math.abs).sort((a,b)=>a-b);
    const csv='x,y,source_reference_height_m,native_height_m,difference_m\n'+answers.map(a=>a.join(',')).join('\n')+'\n';
    const filename=m.filename.replace(/\.json$/,'.queries.csv');await writeFile(`${folder}/${c.id}/${filename}`,csv);
    rows.push({case_id:c.id,family:m.family,target_m:m.target_m,model_sha256:m.sha256,
      fixture_sha256:c.fixture_sha256,requested:4096,hits:4096,controls_checked:controls.length,
      max_control_error_m:Math.max(...controls),sampled_rmse_m:Math.sqrt(residuals.reduce((n,e)=>n+e*e,0)/4096),
      sampled_mae_m:residuals.reduce((n,e)=>n+Math.abs(e),0)/4096,sampled_p95_absolute_m:sorted[Math.ceil(.95*4096)-1],
      sampled_max_absolute_m:sorted.at(-1),queries_csv:{filename,bytes:Buffer.byteLength(csv),sha256:sha(csv)}});
  }
  console.log(c.id,'native audit complete');
}
await writeFile(output,JSON.stringify({schema:'gugis-cambridge-native-query-audit-v1',parent_report_sha256:sha(reportBytes),
  auditor_sha256:sha((await readFile(fileURLToPath(import.meta.url),'utf8')).replace(/\r\n/g,'\n')),
  native_kernel_sha256:sha((await readFile(root+'frontend/src/studio/terrainMath.ts','utf8')).replace(/\r\n/g,'\n')),
  scope:'Native original functions queried at fixed source-relative fixtures and every saved control. Sampled errors separate from full-domain L2 integral and max certificate. No browser, GPU, city write or ArcGIS run.',rows},null,2)+'\n');
