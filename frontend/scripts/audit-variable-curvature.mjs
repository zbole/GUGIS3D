import {readFile,writeFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import assert from 'node:assert/strict';
import {decodePrincipalBinary,encodePrincipalBinary,preparePrincipalQuery} from '../src/compare/principalRuledMath.ts';
const root=path.resolve('..'),folder=path.resolve(process.argv[2]),sha=b=>createHash('sha256').update(b).digest('hex');
if(!process.argv[2]||path.relative(root,folder).startsWith('..'))throw Error('Explicit repository research folder required');
const raw=await readFile(path.join(folder,'results.json')),report=JSON.parse(raw),rows=[];
const source=(c,x,y)=>{const f=c.field,r=c.source_frame,u=x*r[0][0]+y*r[1][0],v=x*r[0][1]+y*r[1][1];return 30+f.quadratic[0]*u*u+f.quadratic[1]*v*v+f.quartic[0]*u**4+f.quartic[1]*v**4;};
function coordinates(a,b,c,x,y){
  const e=[b[0]-a[0],b[1]-a[1]],d=[c[0]-a[0],c[1]-a[1]],det=e[0]*d[1]-e[1]*d[0],inverse=[d[1]/det,-d[0]/det,-e[1]/det,e[0]/det];
  return {u:inverse[0]*(x-a[0])+inverse[1]*(y-a[1]),v:inverse[2]*(x-a[0])+inverse[3]*(y-a[1]),inverse};
}
function expected(c,m,p,x,y){
  if(p.kind==='quadratic-ruled'){
    const a=m.points[p.left[0]],b=m.points[p.left[2]],d=m.points[p.right[0]],r=m.points[p.right[2]],{u,v,inverse}=coordinates(a,b,d,x,y);
    const h=(a,b)=>[source(c,a[0],a[1]),source(c,(a[0]+b[0])/2,(a[1]+b[1])/2),source(c,b[0],b[1])],left=h(a,b),right=h(d,r),basis=[2*u*u-3*u+1,4*u-4*u*u,2*u*u-u],derivative=[4*u-3,4-8*u,4*u-1],dot=(a,b)=>a.reduce((n,h,i)=>n+h*b[i],0),l=dot(left,basis),rr=dot(right,basis),du=(1-v)*dot(left,derivative)+v*dot(right,derivative),dv=rr-l;
    return {height:(1-v)*l+v*rr,gradient:[du*inverse[0]+dv*inverse[2],du*inverse[1]+dv*inverse[3]]};
  }
  const nodes=p.kind==='lagrange-triangle'?p.indices.map(i=>m.points[i]):p.points,a=nodes[0],b=nodes[p.kind==='lagrange-triangle'?3:1],cc=nodes[p.kind==='lagrange-triangle'?5:2],{u,v,inverse}=coordinates(a,b,cc,x,y),w=1-u-v;
  if(p.kind==='triangle-strip'){
    const du=b[2]-a[2],dv=cc[2]-a[2];return {height:w*a[2]+u*b[2]+v*cc[2],gradient:[du*inverse[0]+dv*inverse[2],du*inverse[1]+dv*inverse[3]]};
  }
  const basis=[w*(2*w-1),4*w*u,4*w*v,u*(2*u-1),4*u*v,v*(2*v-1)],bu=[1-4*w,4*(w-u),-4*v,4*u-1,4*v,0],bv=[1-4*w,-4*u,4*(w-v),0,4*u,4*v-1],dot=weights=>nodes.reduce((s,p,i)=>s+weights[i]*p[2],0),du=dot(bu),dv=dot(bv);
  return {height:dot(basis),gradient:[du*inverse[0]+dv*inverse[2],du*inverse[1]+dv*inverse[3]]};
}
for(const c of report.cases){
  const descriptors=new Map([...c.p1_baselines,...c.p2_hierarchy,...c.candidates.filter(e=>e.evaluated)].map(e=>[e.filename,e]));const files=(await readdir(path.join(folder,c.id))).filter(n=>n.endsWith('.json')).sort();assert.deepEqual(files,[...descriptors.keys()].sort());
  for(const name of files){
    const e=descriptors.get(name),jr=await readFile(path.join(folder,c.id,name)),br=await readFile(path.join(folder,c.id,e.binary_filename));assert.equal(jr.length,e.bytes);assert.equal(br.length,e.binary_bytes);assert.equal(sha(jr),e.sha256);assert.equal(sha(br),e.binary_sha256);
    const model=decodePrincipalBinary(br);assert.deepEqual(model,JSON.parse(jr));assert.equal(sha(new Uint8Array(encodePrincipalBinary(model))),e.binary_sha256);
    const fn=preparePrincipalQuery(model),primitives=[];for(const p of model.patches)if(p.kind==='triangle-strip')for(let i=0;i<p.indices.length-2;i++)primitives.push({kind:p.kind,points:p.indices.slice(i,i+3).map(n=>model.points[n])});else primitives.push(p);
    let dh=0,dg=0,squared=0,maximum=0,hits=0;
    for(let j=0;j<32;j++)for(let i=0;i<32;i++){
      const x=-50+(i+.271828182846)*100/32,y=-50+(j+.414213562373)*100/32,a=fn.query(x,y);assert.ok(a,'Complete physical square coverage required');const b=expected(c,model,primitives[a.primitive],x,y);dh=Math.max(dh,Math.abs(a.height-b.height));dg=Math.max(dg,...a.gradient.map((v,k)=>Math.abs(v-b.gradient[k])));const gap=Math.abs(a.height-source(c,x,y));maximum=Math.max(maximum,gap);squared+=gap*gap;hits++;
    }
    assert.ok(dh<1e-8);assert.ok(dg<1e-8);for(const [x,y] of [[-50,-50],[50,-50],[50,50],[-50,50]])assert.ok(fn.query(x,y));assert.equal(fn.query(50.01,0),null);assert.equal(fn.query(0,-50.01),null);
    rows.push({case_id:c.id,filename:name,binary_filename:e.binary_filename,binary_sha256:e.binary_sha256,queries:hits,max_independent_height_difference_m:dh,max_independent_gradient_difference:dg,source_sampled_rms_m:Math.sqrt(squared/hits),source_sampled_maximum_m:maximum,coverage_corners:4,outside_rejected:true});
  }
  console.log(c.id+': '+files.length+' full native models, independent polynomial heights and derivatives verified');
}
const scripts={};for(const name of ['frontend/scripts/audit-variable-curvature.mjs','frontend/src/compare/principalRuledMath.ts'])scripts[name]=sha((await readFile(path.join(root,name),'utf8')).replaceAll('\r\n','\n'));
await writeFile(path.join(folder,'native-audit.json'),JSON.stringify({schema:'gugis-variable-curvature-native-audit-v1',report_sha256:sha(raw),scripts,query_fixture:'32x32 common physical-square internal points, offsets .271828182846 and .414213562373; four corners and two outside points',models:rows,total_internal_queries:rows.length*1024,scope:'Saved polynomial function and gradient correctness. Source error maxima/RMS in this audit are sampled diagnostics, separate from whole-domain Gauss integrals. No timing, GPU, heap-memory or ground-accuracy claim.'}));
