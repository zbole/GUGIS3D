import {readFile,writeFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
import {decodePrincipalBinary,encodePrincipalBinary,preparePrincipalQuery} from '../src/compare/principalRuledMath.ts';
const root=fileURLToPath(new URL('../../',import.meta.url)),folder=path.resolve(process.argv[2]??''),sha=b=>createHash('sha256').update(b).digest('hex');
if(path.relative(root,folder).startsWith('..')||!process.argv[2])throw new Error('Explicit repository research directory required');
const raw=await readFile(path.join(folder,'results.json')),report=JSON.parse(raw),rows=[];
function expectedTriangle(points,x,y){
  const [[ax,ay,az],[bx,by,bz],[cx,cy,cz]]=points,det=ax*(by-cy)+bx*(cy-ay)+cx*(ay-by);
  const gx=(az*(by-cy)+bz*(cy-ay)+cz*(ay-by))/det,gy=(az*(cx-bx)+bz*(ax-cx)+cz*(bx-ax))/det;
  return {height:az+gx*(x-ax)+gy*(y-ay),gradient:[gx,gy]};
}
function expectedRuled(m,p,q,x,y){
  const a=m.points[p.left[0]],c=m.points[p.left[2]],b=m.points[p.right[0]],e=[c[0]-a[0],c[1]-a[1]],d=[b[0]-a[0],b[1]-a[1]],det=e[0]*d[1]-e[1]*d[0];
  const v=(e[0]*(y-a[1])-e[1]*(x-a[0]))/det,coefficient=d[0]*(q[0][0]*d[0]+q[0][1]*d[1])+d[1]*(q[1][0]*d[0]+q[1][1]*d[1]);
  return {height:30+x*(q[0][0]*x+q[0][1]*y)+y*(q[1][0]*x+q[1][1]*y)+coefficient*v*(1-v),gradient:[2*(q[0][0]*x+q[0][1]*y)-coefficient*(1-2*v)*e[1]/det,2*(q[1][0]*x+q[1][1]*y)+coefficient*(1-2*v)*e[0]/det]};
}
for(const c of report.cases){
  const descriptors=new Map();for(const p of c.pairs)for(const e of [p.p1,p.world,p.principal])if(e)descriptors.set(e.filename,e);
  if(c.p2_control)descriptors.set(c.p2_control.filename,c.p2_control);
  const actual=(await readdir(path.join(folder,c.id))).filter(n=>n.endsWith('.json')).sort();assert.deepEqual(actual,[...descriptors.keys()].sort());
  for(const name of actual){
    const e=descriptors.get(name),jr=await readFile(path.join(folder,c.id,name)),br=await readFile(path.join(folder,c.id,e.binary_filename));
    assert.equal(sha(jr),e.sha256);assert.equal(jr.length,e.bytes);assert.equal(sha(br),e.binary_sha256);assert.equal(br.length,e.binary_bytes);
    const model=JSON.parse(jr),decoded=decodePrincipalBinary(br);assert.deepEqual(decoded,model);assert.equal(sha(new Uint8Array(encodePrincipalBinary(decoded))),e.binary_sha256);
    const prepared=preparePrincipalQuery(decoded),primitives=[];
    for(const p of model.patches)if(p.kind==='quadratic-ruled'||p.kind==='lagrange-triangle')primitives.push(p);else for(let j=0;j<p.indices.length-2;j++)primitives.push({kind:'triangle-strip',points:p.indices.slice(j,j+3).map(i=>model.points[i])});
    let hits=0,maximum=0,squared=0,heightDifference=0,gradientDifference=0;
    for(let j=0;j<64;j++)for(let i=0;i<64;i++){
      const x=-50+(i+.38196601125)*100/64,y=-50+(j+.61803398875)*100/64,a=prepared.query(x,y);assert.ok(a,'Incomplete native square coverage');hits++;
      const p=primitives[a.primitive],q=c.q_matrix,expected=p.kind==='quadratic-ruled'?expectedRuled(model,p,q,x,y):p.kind==='lagrange-triangle'?{height:30+x*(q[0][0]*x+q[0][1]*y)+y*(q[1][0]*x+q[1][1]*y),gradient:[2*(q[0][0]*x+q[0][1]*y),2*(q[1][0]*x+q[1][1]*y)]}:expectedTriangle(p.points,x,y);
      heightDifference=Math.max(heightDifference,Math.abs(a.height-expected.height));gradientDifference=Math.max(gradientDifference,...a.gradient.map((g,k)=>Math.abs(g-expected.gradient[k])));
      const z=30+x*(q[0][0]*x+q[0][1]*y)+y*(q[1][0]*x+q[1][1]*y),error=Math.abs(a.height-z);maximum=Math.max(maximum,error);squared+=error*error;
    }
    assert.ok(heightDifference<1e-8);assert.ok(gradientDifference<1e-9);assert.ok(maximum<=(e.continuous_bound_m??e.linf_m)+1e-8);
    for(const [x,y] of [[-50,-50],[-50,50],[50,-50],[50,50]])assert.ok(prepared.query(x,y),'Uncovered clip corner');
    assert.equal(prepared.query(50.001,0),null);assert.equal(prepared.query(0,-50.001),null);
    let witnessChecked=false;if(e.maximum_witness){const w=e.maximum_witness,a=prepared.query(w.x,w.y);assert.ok(a);const q=c.q_matrix,z=30+w.x*(q[0][0]*w.x+q[0][1]*w.y)+w.y*(q[1][0]*w.x+q[1][1]*w.y);assert.ok(Math.abs(Math.abs(a.height-z)-w.absolute_error_m)<1e-8);witnessChecked=true;}
    rows.push({case_id:c.id,filename:name,sha256:e.sha256,bytes:e.bytes,binary_filename:e.binary_filename,binary_sha256:e.binary_sha256,binary_bytes:e.binary_bytes,requested:4096,hits,source_sampled_maximum_m:maximum,source_sampled_rms_m:Math.sqrt(squared/hits),independent_height_difference_m:heightDifference,independent_gradient_difference:gradientDifference,clip_corners_checked:4,outside_clip_rejected:true,maximum_witness_checked:witnessChecked});
  }
  process.stdout.write(`${c.id}: ${actual.length} JSON/binary native models and same-square queries verified\n`);
}
const result={schema:'gugis-principal-native-audit-v1',report_sha256:sha(raw),kernel_sha256:sha((await readFile(new URL('../src/compare/principalRuledMath.ts',import.meta.url),'utf8')).replace(/\r\n/g,'\n')),auditor_sha256:sha((await readFile(fileURLToPath(import.meta.url),'utf8')).replace(/\r\n/g,'\n')),query_fixture:'64x64 deterministic off-edge square coordinates: offsets 0.38196601125 / 0.61803398875, plus four clip corners and outside-clip rejection',rows};
await writeFile(path.join(folder,'native-audit.json'),JSON.stringify(result,null,2)+'\n');process.stdout.write(`Complete ${rows.length} native models / ${rows.length*4096} interior queries\n`);
