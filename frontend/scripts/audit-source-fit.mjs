import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {bundleWorkspaceModule} from '../tests/bundleWorkspaceModule.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url)),folder=path.resolve(process.argv[2]),relative=path.relative(root,folder),sha=b=>createHash('sha256').update(b).digest('hex');
if(!relative.startsWith(path.join('.local','research')+path.sep))throw Error('Explicit repository private research directory required');
const raw=await readFile(folder+'/results.json'),report=JSON.parse(raw),out=folder+'/audit-native-kernel.mjs';
await bundleWorkspaceModule(root+'frontend/src/compare/sourceRuledBandMath.ts',out);
const {decodeSourceBandBinary,encodeSourceBandBinary,prepareSourceBandQuery}=await import(pathToFileURL(out).href),rows=[];
function value(model,nx,ny,families,x,y,forcedI,forcedJ){
  const dx=64/nx,dy=64/ny,i=forcedI??Math.min(nx-1,Math.max(0,Math.ceil((x+32)/dx)-1)),j=forcedJ??Math.min(ny-1,Math.max(0,Math.ceil((y+32)/dy)-1)),u=(x+32-i*dx)/dx,v=(y+32-j*dy)/dy,p=model.points,a=p[j*(nx+1)+i][2],b=p[j*(nx+1)+i+1][2],c=p[(j+1)*(nx+1)+i][2],d=p[(j+1)*(nx+1)+i+1][2],family=families[j*nx+i];let z,g;
  if(family==='ruled'){const mixed=a-b-c+d;z=a+(b-a)*u+(c-a)*v+mixed*u*v;g=[((b-a)+mixed*v)/dx,((c-a)+mixed*u)/dy];}
  else if(family==='minus'){if(u+v<=1){z=a+(b-a)*u+(c-a)*v;g=[(b-a)/dx,(c-a)/dy];}else{z=d+(c-d)*(1-u)+(b-d)*(1-v);g=[(d-c)/dx,(d-b)/dy];}}
  else if(family==='plus'){if(v<=u){z=a+(b-a)*u+(d-b)*v;g=[(b-a)/dx,(d-b)/dy];}else{z=a+(d-c)*u+(c-a)*v;g=[(d-c)/dx,(c-a)/dy];}}
  else throw Error('Unknown cell family');return{height:z,gradient:g,family};
}
function source(reference,x,y){const i=Math.min(63,Math.max(0,Math.ceil(x+32)-1)),j=Math.min(63,Math.max(0,Math.ceil(y+32)-1)),u=x+32-i,v=y+32-j,z=reference.height,a=z[j][i],b=z[j][i+1],c=z[j+1][i],d=z[j+1][i+1];return a+(b-a)*u+(c-a)*v+(a-b-c+d)*u*v;}
for(const site of report.cases){
  const referenceRaw=await readFile(folder+'/'+site.id+'/reference.json'),reference=JSON.parse(referenceRaw);assert.equal(sha(referenceRaw),site.reference_sha256);
  for(const e of site.candidates){
    const json=await readFile(folder+'/'+site.id+'/'+e.filename),binary=await readFile(folder+'/'+site.id+'/'+e.binary_filename);assert.equal(sha(json),e.sha256);assert.equal(sha(binary),e.binary_sha256);assert.equal(binary.length,e.binary_bytes);const m=decodeSourceBandBinary(binary);assert.deepEqual(m,JSON.parse(json));assert.equal(sha(Buffer.from(encodeSourceBandBinary(m))),e.binary_sha256);assert.deepEqual(m.origin_bng,site.origin_bng);const fn=prepareSourceBandQuery(m);let queries=0,maxHeight=0,maxGradient=0,maxFrame=0;
    // Non-complementary fixed offsets avoid nondifferentiable P1 diagonals.
    // All original source nodes are subsequently audited for height only.
    for(let j=0;j<32;j++)for(let i=0;i<32;i++){const x=-32+(i+.37111323125)*2,y=-32+(j+.61317198875)*2,a=value(m,e.nx,e.ny,e.families,x,y),q=fn.query(x,y);assert.ok(q);queries++;maxHeight=Math.max(maxHeight,Math.abs(q.height-a.height));maxGradient=Math.max(maxGradient,...a.gradient.map((v,k)=>Math.abs(q.gradient[k]-v)));maxFrame=Math.max(maxFrame,Math.abs(q.easting-(site.origin_bng[0]+x)),Math.abs(q.northing-(site.origin_bng[1]+y)));assert.equal(q.kind,a.family==='ruled'?'ruled-strip':'triangle-strip');}
    for(let j=0;j<=64;j++)for(let i=0;i<=64;i++){const x=i-32,y=j-32,q=fn.query(x,y);assert.ok(q);queries++;maxHeight=Math.max(maxHeight,Math.abs(q.height-value(m,e.nx,e.ny,e.families,x,y).height));assert.ok(Math.abs(q.height-reference.height[j][i])<=e.continuous_bound_m+1e-8);}
    assert.ok(maxHeight<1e-8&&maxGradient<1e-8&&maxFrame<1e-8);const witness=e.maximum_witness_xy,q=fn.query(...witness);assert.ok(q);const witnessError=Math.abs(q.height-source(reference,...witness));assert.ok(Math.abs(witnessError-e.continuous_maximum_m)<1e-8);for(const [x,y] of [[-32.001,0],[32.001,0],[0,-32.001],[0,32.001]])assert.equal(fn.query(x,y),null);
    const dx=64/e.nx,dy=64/e.ny;let seams=0,seamMax=0;
    for(let j=0;j<e.ny;j++)for(let i=1;i<e.nx;i++)for(const t of [0,.13,.27,.5,.73,.87,1]){const x=-32+i*dx,y=-32+(j+t)*dy;seamMax=Math.max(seamMax,Math.abs(value(m,e.nx,e.ny,e.families,x,y,i-1,j).height-value(m,e.nx,e.ny,e.families,x,y,i,j).height));seams++;}
    for(let j=1;j<e.ny;j++)for(let i=0;i<e.nx;i++)for(const t of [0,.13,.27,.5,.73,.87,1]){const x=-32+(i+t)*dx,y=-32+j*dy;seamMax=Math.max(seamMax,Math.abs(value(m,e.nx,e.ny,e.families,x,y,i,j-1).height-value(m,e.nx,e.ny,e.families,x,y,i,j).height));seams++;}
    assert.ok(seamMax<1e-8);rows.push({case_id:site.id,filename:e.filename,binary_sha256:e.binary_sha256,queries,independent_height_difference_m:maxHeight,independent_gradient_difference:maxGradient,frame_difference_m:maxFrame,seam_height_pairs:seams,seam_height_difference_m:seamMax,maximum_witness_verified:true,outside_rejected:true});
  }
  console.log(site.id+': all 147 fitted native models and unchanged shared seams audited');
}
const scripts={};for(const p of ['frontend/scripts/audit-source-fit.mjs','frontend/tests/bundleWorkspaceModule.mjs','frontend/src/compare/sourceRuledBandMath.ts','frontend/src/compare/principalRuledMath.ts','frontend/src/compare/curvedRuledMath.ts','frontend/src/compare/terrainOrderMath.ts','frontend/src/compare/preparedOrderQuery.ts'])scripts[p]=sha((await readFile(root+p,'utf8')).replace(/\r\n/g,'\n'));
const audit={schema:'gugis-source-global-fit-native-audit-v1',report_sha256:sha(raw),scripts,native_models:rows.length,queries:rows.reduce((a,r)=>a+r.queries,0),seam_height_pairs:rows.reduce((a,r)=>a+r.seam_height_pairs,0),models:rows};await writeFile(folder+'/native-audit.json',JSON.stringify(audit,null,2)+'\n',{flag:'wx'});console.log('Total audited native queries:',audit.queries);
