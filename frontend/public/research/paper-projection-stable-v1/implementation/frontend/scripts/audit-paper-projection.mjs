import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {bundleWorkspaceModule} from '../tests/bundleWorkspaceModule.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url)),folder=path.resolve(process.argv[2]),sha=b=>createHash('sha256').update(b).digest('hex');
if(!path.relative(root,folder).startsWith(path.join('.local','research')+path.sep))throw Error('Explicit private research folder required');
const raw=await readFile(folder+'/results.json'),report=JSON.parse(raw),out=folder+'/native-audit-kernel.mjs';await bundleWorkspaceModule(root+'frontend/src/compare/principalRuledMath.ts',out);
const {decodePrincipalBinary,encodePrincipalBinary,preparePrincipalQuery}=await import(pathToFileURL(out).href);
function direct(model,patch,x,y){
  const a=model.points[patch.kind==='quadratic-ruled'?patch.left[0]:patch.indices[0]],b=model.points[patch.kind==='quadratic-ruled'?patch.left[2]:patch.indices[1]],c=model.points[patch.kind==='quadratic-ruled'?patch.right[0]:patch.indices[2]],ex=b[0]-a[0],ey=b[1]-a[1],fx=c[0]-a[0],fy=c[1]-a[1],det=ex*fy-ey*fx,u=((x-a[0])*fy-(y-a[1])*fx)/det,v=(-(x-a[0])*ey+(y-a[1])*ex)/det;
  let z,du,dv;
  if(patch.kind==='quadratic-ruled'){
    const left=patch.left.map(i=>model.points[i][2]),right=patch.right.map(i=>model.points[i][2]),basis=[(1-u)**2,2*u*(1-u),u*u],derivative=[-2*(1-u),2-4*u,2*u],dot=(a,b)=>a.reduce((s,n,i)=>s+n*b[i],0),l=dot(left,basis),r=dot(right,basis);z=(1-v)*l+v*r;du=(1-v)*dot(left,derivative)+v*dot(right,derivative);dv=r-l;
  }else{z=a[2]+(b[2]-a[2])*u+(c[2]-a[2])*v;du=b[2]-a[2];dv=c[2]-a[2];}
  return {height:z,gradient:[(du*fy-dv*ey)/det,(-du*fx+dv*ex)/det]};
}
const rows=[];
for(const site of report.cases){
  const entries=new Map();for(const pair of site.pairs)for(const method of ['pt','c0-stable']){const e=pair[method];if(e)entries.set(e.filename,e);}
  for(const entry of entries.values()){
    const json=await readFile(folder+'/'+site.id+'/'+entry.filename),binary=await readFile(folder+'/'+site.id+'/'+entry.binary_filename);assert.equal(sha(json),entry.sha256);assert.equal(sha(binary),entry.binary_sha256);assert.equal(binary.length,entry.binary_bytes);const model=decodePrincipalBinary(binary);assert.deepEqual(model,JSON.parse(json));assert.equal(sha(Buffer.from(encodePrincipalBinary(model))),entry.binary_sha256);assert.ok(model.patches.every(p=>entry.method==='pt'?p.kind==='triangle-strip'&&p.indices.length===3:p.kind==='quadratic-ruled'));
    const fn=preparePrincipalQuery(model);let queries=0,height=0,gradient=0;
    const query=(x,y)=>{const q=fn.query(x,y);assert.ok(q);const e=direct(model,model.patches[q.patch],x,y);height=Math.max(height,Math.abs(q.height-e.height));gradient=Math.max(gradient,...q.gradient.map((v,i)=>Math.abs(v-e.gradient[i])));queries++;};
    for(let j=0;j<32;j++)for(let i=0;i<32;i++)query(-50+(i+.37111323125)*100/32,-50+(j+.61317198875)*100/32);
    for(const [x,y] of [[-50,-50],[50,-50],[50,50],[-50,50]])query(x,y);
    for(const [x,y] of [[-50.001,0],[50.001,0],[0,-50.001],[0,50.001]])assert.equal(fn.query(x,y),null);
    assert.ok(height<1e-8&&gradient<1e-8);let seams=0,seamDifference=0;
    if(entry.method==='c0-stable'){
      const edges=new Map(),own=model.patches.map(p=>preparePrincipalQuery({...model,patches:[p]}));
      model.patches.forEach((p,patch)=>{for(const ids of [p.left,p.right,[p.left[0],p.right[0]],[p.left[2],p.right[2]]]){const key=[ids[0],ids.at(-1)].sort((a,b)=>a-b).join(',');if(!edges.has(key))edges.set(key,[]);edges.get(key).push({ids,patch});}});
      for(const edge of edges.values())if(edge.length===2){const [a,b]=edge;assert.deepEqual(a.ids,b.ids);for(const t of [0,.13,.27,.5,.73,.87,1]){const first=model.points[a.ids[0]],last=model.points[a.ids.at(-1)],x=(1-t)*first[0]+t*last[0],y=(1-t)*first[1]+t*last[1];if(x<-50||x>50||y<-50||y>50)continue;const qa=own[a.patch].query(x,y),qb=own[b.patch].query(x,y);assert.ok(qa&&qb);seamDifference=Math.max(seamDifference,Math.abs(qa.height-qb.height));seams++;}}
      assert.ok(seamDifference<1e-8);
    }
    rows.push({case_id:site.id,filename:entry.filename,binary_sha256:entry.binary_sha256,queries,height_difference_m:height,gradient_difference:gradient,seam_pairs:seams,seam_difference_m:seamDifference,outside_rejected:true});
  }
  console.log(site.id+': all saved PT planes and rank-aware C0 native functions checked');
}
const scripts={};for(const p of ['frontend/scripts/audit-paper-projection.mjs','frontend/tests/bundleWorkspaceModule.mjs','frontend/src/compare/principalRuledMath.ts','frontend/src/compare/curvedRuledMath.ts','frontend/src/compare/terrainOrderMath.ts','frontend/src/compare/preparedOrderQuery.ts'])scripts[p]=sha((await readFile(root+p,'utf8')).replace(/\r\n/g,'\n'));
const audit={schema:'gugis-paper-projection-native-audit-v1',report_sha256:sha(raw),scripts,native_models:rows.length,queries:rows.reduce((s,r)=>s+r.queries,0),seam_pairs:rows.reduce((s,r)=>s+r.seam_pairs,0),models:rows};await writeFile(folder+'/native-audit.json',JSON.stringify(audit,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({models:audit.native_models,queries:audit.queries,seams:audit.seam_pairs}));
