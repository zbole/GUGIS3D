import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import {bundleWorkspaceModule} from '../tests/bundleWorkspaceModule.mjs';
import {sha} from './nativeRepeatAdapter.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url)),folder=path.resolve(process.argv[2]),relative=path.relative(root,folder);
if(!relative.startsWith(path.join('.local','research')+path.sep))throw Error('Explicit repository private research directory required');
const auditFolder=folder+'/independent-native-audit';await mkdir(auditFolder,{recursive:false});
for(const [entry,name] of [['preparedOrderQuery.ts','prepared.mjs'],['terrainOrderMath.ts','frozen.mjs']])await bundleWorkspaceModule(root+'frontend/src/compare/'+entry,auditFolder+'/'+name);
const {prepareOrderQuery}=await import(pathToFileURL(auditFolder+'/prepared.mjs').href),{decodeOrderBinary,validateOrderModel}=await import(pathToFileURL(auditFolder+'/frozen.mjs').href);
const receiptRaw=await readFile(folder+'/run-receipt.json'),receipt=JSON.parse(receiptRaw),baselineRaw=await readFile(root+'frontend/public/research/native-query-v1/results.json'),baseline=JSON.parse(baselineRaw),rows=[];
assert.equal(receipt.baseline_report_sha256,sha(baselineRaw));assert.equal(receipt.runs.length,3);const compiled={};
for(const name of ['prepared.mjs','frozen.mjs'])compiled[name]=sha(await readFile(auditFolder+'/'+name));
for(const run of receipt.runs){
  assert.equal(run.exit_code,0);const raw=await readFile(folder+'/'+run.folder+'/results.json'),r=JSON.parse(raw);assert.equal(sha(raw),run.report_sha256);
  for(const [name,h] of Object.entries(compiled))assert.equal(sha(await readFile(folder+'/'+run.folder+'/'+name)),h,'Timed kernel differs from independent rebuild');
  for(const c of r.cases){
    const original=baseline.cases.find(v=>v.id===c.id);assert.ok(original);
    for(const m of c.methods){
      const expected=original.methods.find(v=>v.family===m.family);assert.equal(m.binary_sha256,expected.binary_sha256);assert.equal(m.binary_bytes,expected.binary_bytes);
      const base=root+'frontend/public/research/native-query-v1/'+c.id+'/',b=await readFile(base+m.binary_filename);assert.equal(sha(b),m.binary_sha256);const model=decodeOrderBinary(b),json=JSON.parse(await readFile(base+m.binary_filename.replace(/\.bin$/,'.json')));
      assert.deepEqual(model,validateOrderModel(json));const fn=prepareOrderQuery(model);let maxHeight=0,maxGradient=0,hits=0;
      const points=[];for(let i=0;i<128;i++)for(let j=0;j<32;j++)points.push([-50+(i+.38196601125)*100/128,-50+(j+.61803398875)*100/32]);points.push([-50,-50],[-50,50],[50,-50],[50,50]);
      for(const [x,y] of points){let z,g;
        if(c.id==='extruded-quadratic'){z=30+.002*x*x+.03*y;g=[.004*x,.03];}
        else if(c.id==='modulated-quadratic'){z=30+.00002*x*x*(y+60)+.01*y;g=[.00004*x*(y+60),.00002*x*x+.01];}
        else{const n=c.strips,w=100/n,j=Math.min(n-1,Math.max(0,Math.floor((x+50)/w))),s=x-(-50+j*w),a=(.2+.05*Math.cos(2*Math.PI*j/n))/(w*w);z=30+.001*x+.002*y+a*s*(s-w)*(1+.002*y);g=[.001+a*(2*s-w)*(1+.002*y),.002+.002*a*s*(s-w)];}
        const q=fn.query(x,y);assert.ok(q);hits++;maxHeight=Math.max(maxHeight,Math.abs(q.height-z));maxGradient=Math.max(maxGradient,...g.map((v,k)=>Math.abs(q.gradient[k]-v)));
      }
      assert.ok(maxHeight<1e-9&&maxGradient<1e-9);for(const [x,y] of [[-50.01,0],[50.01,0],[0,-50.01],[0,50.01]])assert.equal(fn.query(x,y),null);
      rows.push({repetition:run.repetition,case_id:c.id,family:m.family,binary_sha256:m.binary_sha256,hits,max_height_m:maxHeight,max_gradient:maxGradient,outside_rejected:true});
    }
  }
}
const scripts={};for(const p of ['frontend/scripts/audit-native-repeat.mjs','frontend/tests/bundleWorkspaceModule.mjs'])scripts[p]=sha((await readFile(root+p,'utf8')).replace(/\r\n/g,'\n'));
const result={schema:'gugis-native-repeat-audit-v1',receipt_sha256:sha(receiptRaw),baseline_report_sha256:sha(baselineRaw),compiled_sha256:compiled,scripts,queries:rows.reduce((a,r)=>a+r.hits,0),models:rows};
await writeFile(folder+'/native-audit.json',JSON.stringify(result,null,2)+'\n',{flag:'wx'});console.log('Independent rebuilt kernel queries verified:',result.queries);
