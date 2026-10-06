import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {encodeSourceBandBinary,decodeSourceBandBinary,prepareSourceBandQuery} from '../src/compare/sourceRuledBandMath.ts';
import {loadHybridSourceModel} from '../src/compare/loadHybridSourceModel.ts';
const model=()=>({format:'gugis-research-surface',version:4,coordinate_system:'LOCAL_METERS',clip_bounds:[-32,-32,32,32],origin_bng:[383805.5,398336.5],horizontal_epsg:27700,vertical_datum:'ODN',points:[[-32,-32,0],[0,-32,4],[32,-32,4],[-32,32,4],[0,32,4],[32,32,8]],patches:[{kind:'triangle-strip',indices:[0,3,1,4]},{kind:'ruled-strip',left:[1,2],right:[4,5]}]});
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-10,`${a} / ${b}`);
test('native C0 mixture evaluates two triangular planes and a genuinely bilinear ruled cell with correct primitive bindings and analytic gradients',()=>{
  const m=model(),binary=encodeSourceBandBinary(m),decoded=decodeSourceBandBinary(binary);assert.deepEqual(decoded,m);assert.equal(binary.byteLength,280);const fn=prepareSourceBandQuery(decoded);assert.equal(fn.primitives,3);
  const lower=fn.query(-25.6,-12.8);close(lower.height,2);close(lower.gradient[0],.125);close(lower.gradient[1],.0625);assert.equal(lower.kind,'triangle-strip');assert.equal(lower.patch,0);const upper=fn.query(-6.4,19.2);close(upper.height,4);close(upper.gradient[0],0);close(upper.gradient[1],0);
  const ruled=fn.query(16,0);close(ruled.height,5);close(ruled.gradient[0],.0625);close(ruled.gradient[1],.03125);assert.equal(ruled.kind,'ruled-strip');assert.equal(ruled.patch,1);assert.equal(ruled.segment,0);close(ruled.easting,383821.5);close(ruled.northing,398336.5);
  for(const y of [-32,-24,-16,0,8,24,32])close(fn.query(0,y).height,4);assert.equal(fn.query(32.001,0),null);assert.equal(fn.query(0,-32.001),null);
});
test('prepared native mixture owns its geometry and origin even when the original source arrays are edited later',()=>{
  const m=model(),fn=prepareSourceBandQuery(m);m.points[5][2]=800;m.origin_bng[0]=0;m.patches[1].left.reverse();const q=fn.query(16,0);close(q.height,5);close(q.easting,383821.5);assert.equal(q.patch,1);
});
test('mixed-source loader validates real bytes, georeferencing, family, tensor-node layout and cancellation before using the model',async()=>{
  const prior=globalThis.fetch,m=model(),b=encodeSourceBandBinary(m),hash=createHash('sha256').update(new Uint8Array(b)).digest('hex'),url='/research/hybrid-source-v1/manchester-centre/hybrid-2x1.bin';let calls=0;
  try{globalThis.fetch=async()=>{calls++;return new Response(b);};const loaded=await loadHybridSourceModel(url,b.byteLength,hash,m.origin_bng,new AbortController().signal);assert.deepEqual(loaded,m);await assert.rejects(loadHybridSourceModel(url,b.byteLength,hash,[0,0],new AbortController().signal),/坐标/);await assert.rejects(loadHybridSourceModel(url.replace('hybrid-2','p1-2'),b.byteLength,hash,m.origin_bng,new AbortController().signal),/方法/);await assert.rejects(loadHybridSourceModel(url.replace('2x1','4x1'),b.byteLength,hash,m.origin_bng,new AbortController().signal),/布局/);await assert.rejects(loadHybridSourceModel(url,b.byteLength,'0'.repeat(64),m.origin_bng,new AbortController().signal),/SHA-256/);const abort=new AbortController();abort.abort();const before=calls;await assert.rejects(loadHybridSourceModel(url,b.byteLength,hash,m.origin_bng,abort.signal),{name:'AbortError'});assert.equal(calls,before);
  }finally{globalThis.fetch=prior;}
});
