// Independent source-cell formula and exhaustive frozen/compact seam ownership.
import {readFile,writeFile,mkdtemp} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import {bundleWorkspaceModule} from '../tests/bundleWorkspaceModule.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url)),folder=process.argv[2],sha=b=>createHash('sha256').update(b).digest('hex');if(!folder)throw new Error('Provide completed repetition directory');
const receiptRaw=await readFile(folder+'/run-receipt.json'),receipt=JSON.parse(receiptRaw),protocolRaw=await readFile(folder+'/protocol.json'),protocol=JSON.parse(protocolRaw),sourceRaw=await readFile(root+'shared/source-native-bands-v1.json'),source=JSON.parse(sourceRaw);
assert.equal(receipt.runs.length,3);assert.ok(receipt.runs.every(r=>r.exit_code===0&&r.signal===null));assert.equal(sha(protocolRaw),receipt.protocol_sha256);assert.equal(sha(sourceRaw),protocol.source_publication_sha256);
for(const [p,h] of Object.entries(receipt.scripts))assert.equal(sha((await readFile(root+p,'utf8')).replace(/\r\n/g,'\n')),h);
const buildFolder=await mkdtemp(root+'.local/qa/source-query-audit-');
await bundleWorkspaceModule(root+'frontend/src/compare/compactSourceBandQuery.ts',buildFolder+'/compact.mjs');await bundleWorkspaceModule(root+'frontend/src/compare/sourceRuledBandMath.ts',buildFolder+'/frozen.mjs');
const compiled={};for(const name of ['compact.mjs','frozen.mjs'])compiled[name]=sha(await readFile(buildFolder+'/'+name));
for(const entry of receipt.runs){const raw=await readFile(folder+'/'+entry.folder+'/results.json'),r=JSON.parse(raw);assert.equal(sha(raw),entry.report_sha256);assert.deepEqual(r.compiled_sha256,compiled);for(const [name,h] of Object.entries(compiled))assert.equal(sha(await readFile(folder+'/'+entry.folder+'/'+name)),h);}
const {prepareCompactSourceBandQuery}=await import(pathToFileURL(buildFolder+'/compact.mjs').href),{decodeSourceBandBinary,decodeRegularGridBinary,prepareSourceBandQuery,prepareRegularGridQuery,encodeSourceBandBinary,encodeRegularGridBinary}=await import(pathToFileURL(buildFolder+'/frozen.mjs').href);
const points=JSON.parse(await readFile(folder+'/run-1/query-fixture.json')).points;assert.equal(points.length,4096);
const proof=[...points,[-32,-32],[-32,32],[32,-32],[32,32]],seams=[...points];for(let j=0;j<=64;j++)for(let i=0;i<=64;i++)seams.push([-32+i,-32+j]);for(let k=1;k<64;k++)for(const d of [-2e-11,-1e-11,-1e-12,0,1e-12,1e-11,2e-11])seams.push([-32+k+d,.618],[-.381,-32+k+d]);
// Independently written bilinear interpolation and physical derivatives, using
// the source's original Float32 heights, not the optimized implementation.
function expected(g,x,y){const col=Math.min(63,Math.max(0,Math.ceil(x+32)-1)),row=Math.min(63,Math.max(0,Math.ceil(y+32)-1)),u=x+32-col,v=y+32-row,a=g.values[row*65+col],b=g.values[row*65+col+1],c=g.values[(row+1)*65+col],d=g.values[(row+1)*65+col+1];return {height:(1-u)*(1-v)*a+u*(1-v)*b+(1-u)*v*c+u*v*d,gradient:[(1-v)*(b-a)+v*(d-c),(1-u)*(c-a)+u*(d-b)]};}
const report={schema:'gugis-source-query-native-audit-v1',receipt_sha256:sha(receiptRaw),protocol_sha256:sha(protocolRaw),source_publication_sha256:sha(sourceRaw),compiled_sha256:compiled,scripts:{'frontend/scripts/audit-source-query.mjs':sha((await readFile(root+'frontend/scripts/audit-source-query.mjs','utf8')).replace(/\r\n/g,'\n'))},source_proof_locations:0,frozen_equivalence_locations:0,query_calls:0,cases:[]};
for(const c of source.cases){
  const decoded=[];for(const e of [c.models.find(v=>v.family==='ruled'),c.models.find(v=>v.family==='source_p2'),c.regular_grid]){const filename=e.binary_filename??e.filename,raw=await readFile(`${root}frontend/public/research/source-native-bands-v1/${c.id}/${filename}`);assert.equal(sha(raw),e.binary_sha256??e.sha256);const grid=filename==='regular-grid.bin',m=grid?decodeRegularGridBinary(raw):decodeSourceBandBinary(raw);assert.deepEqual(Buffer.from(grid?encodeRegularGridBinary(m):encodeSourceBandBinary(m)),raw);decoded.push(m);}
  const [ruled,p2,grid]=decoded;assert.deepEqual(ruled.points.map(p=>p[2]),Array.from(grid.values));assert.equal(grid.width,65);assert.equal(grid.height,65);
  const methods=[prepareCompactSourceBandQuery(ruled),prepareSourceBandQuery(ruled),prepareSourceBandQuery(p2),prepareRegularGridQuery(grid)];assert.equal(methods[0].implementation,'compact-source-band');
  let max_height_m=0,max_gradient=0,max_frozen_difference=0;
  for(const [x,y] of proof){const b=expected(grid,x,y);for(const m of methods){const q=m.query(x,y);assert.ok(q);max_height_m=Math.max(max_height_m,Math.abs(q.height-b.height));for(let k=0;k<2;k++)max_gradient=Math.max(max_gradient,Math.abs(q.gradient[k]-b.gradient[k]));report.query_calls++;}report.source_proof_locations++;}
  for(const [x,y] of seams){const a=methods[0].query(x,y),b=methods[1].query(x,y);assert.ok(a&&b);for(const k of ['patch','primitive','kind','u','v','segment','easting','northing'])assert.equal(a[k],b[k]);max_frozen_difference=Math.max(max_frozen_difference,Math.abs(a.height-b.height),...a.gradient.map((v,k)=>Math.abs(v-b.gradient[k])));report.frozen_equivalence_locations++;report.query_calls+=2;}
  for(const m of methods)for(const [x,y] of [[-32-1e-12,0],[32+1e-12,0],[0,-32-1e-12],[0,32+1e-12],[NaN,0],[0,Infinity]])assert.equal(m.query(x,y),null);
  assert.ok(max_height_m<1e-9&&max_gradient<1e-9&&max_frozen_difference<1e-9);
  report.cases.push({id:c.id,source_proof_locations:proof.length,frozen_equivalence_locations:seams.length,max_height_m,max_gradient,max_frozen_difference,outside_rejected:true,byte_roundtrip:true,execution_points:methods.slice(0,3).map(m=>m.execution_points)});
}
assert.equal(report.source_proof_locations,82000);assert.equal(report.frozen_equivalence_locations,184060);assert.equal(report.query_calls,696120);
await writeFile(folder+'/native-audit.json',JSON.stringify(report,null,2)+'\n');console.log('All 20 saved source windows / 696120 native calls / exact frozen seam ownership verified');
