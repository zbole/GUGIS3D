import {readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath,pathToFileURL} from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {bundleWorkspaceModule} from '../tests/bundleWorkspaceModule.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url)),folder=path.resolve(process.argv[2]),sha=b=>createHash('sha256').update(b).digest('hex');
assert.equal(path.dirname(folder),path.join(root,'.local','research'));
const reportRaw=await readFile(path.join(folder,'results.json')),report=JSON.parse(reportRaw),out=path.join(folder,'audit-source-controls-kernel.mjs');
await bundleWorkspaceModule(root+'frontend/src/compare/sourceRuledBandMath.ts',out);
const {decodeSourceBandBinary,encodeSourceBandBinary,prepareSourceBandQuery,decodeRegularGridBinary,prepareRegularGridQuery}=await import(pathToFileURL(out).href);
const rows=[];
for(const site of report.cases){
  const refRaw=await readFile(path.join(folder,site.id,'reference.json')),reference=JSON.parse(refRaw);assert.equal(sha(refRaw),site.reference_sha256);
  const g=site.regular_grid,gridRaw=await readFile(path.join(folder,site.id,g.filename));assert.equal(gridRaw.length,g.bytes);assert.equal(sha(gridRaw),g.sha256);
  const grid=decodeRegularGridBinary(gridRaw);assert.equal(grid.width,65);assert.equal(grid.height,65);assert.deepEqual(grid.origin_bng,site.origin_bng);const source=prepareRegularGridQuery(grid);
  for(let j=0;j<65;j++)for(let i=0;i<65;i++)assert.equal(source.query(i-32,j-32).height,reference.height[j][i]);
  const expected=(x,y,p1=false)=>{const i=Math.min(63,Math.max(0,Math.ceil(x+32)-1)),j=Math.min(63,Math.max(0,Math.ceil(y+32)-1)),u=x+32-i,v=y+32-j,z=reference.height,a=z[j][i],b=z[j][i+1],c=z[j+1][i],d=z[j+1][i+1];
    if(p1)return u+v<=1?{height:a+(b-a)*u+(c-a)*v,gradient:[b-a,c-a]}:{height:d+(c-d)*(1-u)+(b-d)*(1-v),gradient:[d-c,d-b]};
    const mixed=a-b-c+d;return{height:a+(b-a)*u+(c-a)*v+mixed*u*v,gradient:[b-a+mixed*v,c-a+mixed*u]};};
  for(const e of site.controls){
    const raw=await readFile(path.join(folder,site.id,e.binary_filename));assert.equal(raw.length,e.binary_bytes);assert.equal(sha(raw),e.binary_sha256);const model=decodeSourceBandBinary(raw);assert.equal(sha(Buffer.from(encodeSourceBandBinary(model))),e.binary_sha256);assert.deepEqual(model.origin_bng,site.origin_bng);const fn=prepareSourceBandQuery(model);let queries=0,maxHeight=0,maxGradient=0;
    for(let j=0;j<64;j++)for(let i=0;i<64;i++){const x=i-32+.37111323125,y=j-32+.61317198875,a=expected(x,y,e.family==='source_p1'),q=fn.query(x,y);assert.ok(q);queries++;maxHeight=Math.max(maxHeight,Math.abs(q.height-a.height));maxGradient=Math.max(maxGradient,...q.gradient.map((v,k)=>Math.abs(v-a.gradient[k])));if(e.family!=='source_p1')assert.ok(Math.abs(q.height-source.query(x,y).height)<1e-8);}
    for(let j=0;j<65;j++)for(let i=0;i<65;i++){const q=fn.query(i-32,j-32);assert.ok(q);queries++;maxHeight=Math.max(maxHeight,Math.abs(q.height-reference.height[j][i]));}
    for(const [x,y] of [[-32.001,0],[32.001,0],[0,-32.001],[0,32.001]])assert.equal(fn.query(x,y),null);
    assert.ok(maxHeight<1e-8&&maxGradient<1e-8);rows.push({case_id:site.id,family:e.family,binary_sha256:e.binary_sha256,queries,independent_height_difference_m:maxHeight,independent_gradient_difference:maxGradient,source_nodes_verified:4225,outside_rejected:true});
  }
  console.log(site.id+': original Float32 grid and all exact-function/P1 controls verified');
}
const scriptRaw=(await readFile(fileURLToPath(import.meta.url),'utf8')).replace(/\r\n/g,'\n');
await writeFile(path.join(folder,'source-controls-audit.json'),JSON.stringify({schema:'gugis-exeter-source-controls-audit-v1',report_sha256:sha(reportRaw),script_sha256:sha(scriptRaw),source_grids:report.cases.length,native_models:rows.length,queries:rows.reduce((n,r)=>n+r.queries,0),models:rows},null,2)+'\n',{flag:'wx'});
console.log('Exact controls native queries:',rows.reduce((n,r)=>n+r.queries,0));
