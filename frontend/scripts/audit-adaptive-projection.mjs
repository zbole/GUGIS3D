import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {bundleWorkspaceModule} from '../tests/bundleWorkspaceModule.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url)),folder=path.resolve(process.argv[2]),sha=b=>createHash('sha256').update(b).digest('hex');
if(!path.relative(root,folder).startsWith(path.join('.local','research')+path.sep))throw Error('Explicit private study folder required');
const raw=await readFile(folder+'/results.json'),report=JSON.parse(raw),out=folder+'/native-audit-kernel.mjs';
await bundleWorkspaceModule(root+'frontend/src/compare/principalRuledMath.ts',out);
const {decodePrincipalBinary,encodePrincipalBinary,preparePrincipalQuery}=await import(pathToFileURL(out).href),rows=[];
for(const site of report.cases){
  for(const pair of site.pairs){
    const e=pair.adaptive_pt,jb=await readFile(folder+'/'+site.id+'/'+e.filename),bb=await readFile(folder+'/'+site.id+'/'+e.binary_filename);assert.equal(sha(jb),e.sha256);assert.equal(sha(bb),e.binary_sha256);assert.equal(bb.length,e.binary_bytes);
    const model=decodePrincipalBinary(bb);assert.deepEqual(model,JSON.parse(jb));assert.equal(sha(Buffer.from(encodePrincipalBinary(model))),e.binary_sha256);assert.equal(model.patches.length,pair.budget);assert.ok(model.patches.every(p=>p.kind==='triangle-strip'&&p.indices.length===3));
    const fn=preparePrincipalQuery(model);let queries=0,height=0,gradient=0;
    const query=(x,y)=>{const q=fn.query(x,y);assert.ok(q);const ids=model.patches[q.patch].indices,[a,b,c]=ids.map(i=>model.points[i]),ex=b[0]-a[0],ey=b[1]-a[1],fx=c[0]-a[0],fy=c[1]-a[1],det=ex*fy-ey*fx,u=((x-a[0])*fy-(y-a[1])*fx)/det,v=(-(x-a[0])*ey+(y-a[1])*ex)/det,du=b[2]-a[2],dv=c[2]-a[2];height=Math.max(height,Math.abs(q.height-(a[2]+u*du+v*dv)));gradient=Math.max(gradient,Math.abs(q.gradient[0]-(du*fy-dv*ey)/det),Math.abs(q.gradient[1]-(-du*fx+dv*ex)/det));queries++;};
    for(let j=0;j<32;j++)for(let i=0;i<32;i++)query(-50+(i+.37111323125)*100/32,-50+(j+.61317198875)*100/32);
    for(const [x,y] of [[-50,-50],[50,-50],[50,50],[-50,50]])query(x,y);
    for(const [x,y] of [[-50.001,0],[50.001,0],[0,-50.001],[0,50.001]])assert.equal(fn.query(x,y),null);
    assert.ok(height<1e-8&&gradient<1e-8);rows.push({case_id:site.id,filename:e.filename,binary_sha256:e.binary_sha256,queries,height_difference_m:height,gradient_difference:gradient,outside_rejected:true});
  }
  console.log(site.id+': all adaptive PT native planes checked');
}
const scripts={};for(const p of ['frontend/scripts/audit-adaptive-projection.mjs','frontend/tests/bundleWorkspaceModule.mjs','frontend/src/compare/principalRuledMath.ts','frontend/src/compare/curvedRuledMath.ts','frontend/src/compare/terrainOrderMath.ts','frontend/src/compare/preparedOrderQuery.ts'])scripts[p]=sha((await readFile(root+p,'utf8')).replace(/\r\n/g,'\n'));
const audit={schema:'gugis-paper-adaptive-projection-native-audit-v1',report_sha256:sha(raw),scripts,native_models:rows.length,queries:rows.reduce((s,r)=>s+r.queries,0),models:rows};
await writeFile(folder+'/native-audit.json',JSON.stringify(audit,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({models:audit.native_models,queries:audit.queries}));
