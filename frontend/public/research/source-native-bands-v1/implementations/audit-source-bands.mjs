import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
import {decodeSourceBandBinary,encodeSourceBandBinary,prepareSourceBandQuery,decodeRegularGridBinary,encodeRegularGridBinary,prepareRegularGridQuery} from '../src/compare/sourceRuledBandMath.ts';
const root=fileURLToPath(new URL('../../',import.meta.url)),folder=path.resolve(process.argv[2]??''),sha=b=>createHash('sha256').update(b).digest('hex');
if(!process.argv[2]||path.relative(root,folder).startsWith('..'))throw new Error('Explicit repository source-study directory required');
const raw=await readFile(path.join(folder,'results.json')),report=JSON.parse(raw),rows=[];
function referenceQuery(ref,x,y){
  const i=Math.min(63,Math.max(0,Math.ceil(x+32)-1)),j=Math.min(63,Math.max(0,Math.ceil(y+32)-1)),u=x+32-i,v=y+32-j,z=ref.height;
  const a=z[j][i],b=z[j][i+1],c=z[j+1][i],d=z[j+1][i+1],mixed=a-b-c+d;
  return {height:a+(b-a)*u+(c-a)*v+mixed*u*v,gradient:[b-a+mixed*v,c-a+mixed*u]};
}
function independentPlane(points,x,y){
  const [[ax,ay,az],[bx,by,bz],[cx,cy,cz]]=points,det=ax*(by-cy)+bx*(cy-ay)+cx*(ay-by),gx=(az*(by-cy)+bz*(cy-ay)+cz*(ay-by))/det,gy=(az*(cx-bx)+bz*(ax-cx)+cz*(bx-ax))/det;
  return {height:az+gx*(x-ax)+gy*(y-ay),gradient:[gx,gy]};
}
for(const c of report.cases){
  const rr=await readFile(path.join(folder,c.id,'reference.json'));assert.equal(sha(rr),c.reference_sha256);const ref=JSON.parse(rr);assert.deepEqual(ref.origin_bng,c.origin_bng);assert.equal(c.source_identity.source_crs,'EPSG:27700');assert.equal(c.source_identity.vertical_datum,'ODN');assert.equal(c.source_identity.height_unit,'m');
  const entries=[...c.models,{family:'regular_grid',binary_filename:c.regular_grid.filename,binary_bytes:c.regular_grid.bytes,binary_sha256:c.regular_grid.sha256}];
  for(const e of entries){
    const br=await readFile(path.join(folder,c.id,e.binary_filename));assert.equal(br.length,e.binary_bytes);assert.equal(sha(br),e.binary_sha256);let prepared,primitives=[];
    if(e.family==='regular_grid'){
      const g=decodeRegularGridBinary(br);assert.equal(g.width,65);assert.equal(g.height,65);assert.deepEqual([...g.values],ref.height.flat());assert.deepEqual(g.origin_bng,ref.origin_bng);assert.equal(sha(new Uint8Array(encodeRegularGridBinary(g))),e.binary_sha256);prepared=prepareRegularGridQuery(g);
    }else{
      const jr=await readFile(path.join(folder,c.id,e.filename));assert.equal(jr.length,e.bytes);assert.equal(sha(jr),e.sha256);const original=JSON.parse(jr),m=decodeSourceBandBinary(br);assert.deepEqual(m,original);assert.equal(sha(new Uint8Array(encodeSourceBandBinary(m))),e.binary_sha256);assert.deepEqual(m.origin_bng,ref.origin_bng);assert.deepEqual(m.clip_bounds,[-32,-32,32,32]);prepared=prepareSourceBandQuery(m);
      if(e.family==='source_p1')for(const p of m.patches)for(let i=0;i<p.indices.length-2;i++)primitives.push(p.indices.slice(i,i+3).map(j=>m.points[j]));
    }
    let hits=0,vertexHits=0,maximum=0,squared=0,heightDifference=0,gradientDifference=0,sourceGradientDifference=0;
    for(let j=0;j<64;j++)for(let i=0;i<64;i++)for(const u of [.271828182846,.731058578630]){
      const x=i-32+u,y=j-32+.414213562373,a=prepared.query(x,y),source=referenceQuery(ref,x,y);assert.ok(a,'Uncovered 1m source cell');hits++;
      const expected=e.family==='source_p1'?independentPlane(primitives[a.primitive],x,y):source;
      heightDifference=Math.max(heightDifference,Math.abs(a.height-expected.height));gradientDifference=Math.max(gradientDifference,...a.gradient.map((v,k)=>Math.abs(v-expected.gradient[k])));sourceGradientDifference=Math.max(sourceGradientDifference,...a.gradient.map((v,k)=>Math.abs(v-source.gradient[k])));
      const error=Math.abs(a.height-source.height);maximum=Math.max(maximum,error);squared+=error**2;assert.equal(a.easting,c.origin_bng[0]+x);assert.equal(a.northing,c.origin_bng[1]+y);
    }
    assert.ok(heightDifference<1e-8);assert.ok(gradientDifference<1e-9);assert.ok(maximum<=(e.continuous_bound_m??1e-8)+1e-8);
    for(let j=0;j<65;j++)for(let i=0;i<65;i++){
      const x=i-32,y=j-32,a=prepared.query(x,y);assert.ok(a,'Original pixel centre is uncovered');vertexHits++;assert.ok(Math.abs(a.height-ref.height[j][i])<1e-9);
      if(e.family!=='source_p1'){const expected=referenceQuery(ref,x,y);assert.ok(a.gradient.every((v,k)=>Math.abs(v-expected.gradient[k])<1e-9),'One-sided source-node gradient choice changed');}
    }
    assert.equal(prepared.query(-32.001,0),null);assert.equal(prepared.query(0,32.001),null);let witness=false;
    if(e.maximum_witness){const w=e.maximum_witness,a=prepared.query(w.x,w.y),b=referenceQuery(ref,w.x,w.y);assert.ok(a);assert.ok(Math.abs(Math.abs(a.height-b.height)-w.absolute_error_m)<1e-9);witness=true;}
    rows.push({case_id:c.id,family:e.family,binary_filename:e.binary_filename,binary_bytes:e.binary_bytes,binary_sha256:e.binary_sha256,internal_requested:8192,internal_hits:hits,original_vertices_requested:4225,original_vertices_hits:vertexHits,source_sampled_maximum_m:maximum,source_sampled_rms_m:Math.sqrt(squared/hits),independent_height_difference_m:heightDifference,independent_gradient_difference:gradientDifference,source_gradient_difference:sourceGradientDifference,source_world_frame_checked:true,outside_clip_rejected:true,p1_maximum_witness_checked:witness});
  }
  process.stdout.write(`${c.id}: all four representations, 8192 internal queries and all 4225 original nodes verified\n`);
}
const sources=['frontend/src/compare/sourceRuledBandMath.ts','frontend/src/compare/principalRuledMath.ts','frontend/scripts/audit-source-bands.mjs'],scripts={};for(const p of sources)scripts[p]=sha((await readFile(path.join(root,p),'utf8')).replace(/\r\n/g,'\n'));
await writeFile(path.join(folder,'native-audit.json'),JSON.stringify({schema:'gugis-source-native-audit-v1',report_sha256:sha(raw),scripts,query_fixture:'Two internal samples per original 1m cell: u=0.271828182846/0.731058578630, v=0.414213562373; all original nodes; ascending first-hit cell owns node gradient',rows},null,2)+'\n');process.stdout.write(`Complete ${rows.length} representations / ${rows.length*(8192+4225)} verified queries\n`);
