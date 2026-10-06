import test from 'node:test';
import assert from 'node:assert/strict';
import {encodeSourceBandBinary,decodeSourceBandBinary,prepareSourceBandQuery} from '../src/compare/sourceRuledBandMath.ts';
const model={format:'gugis-research-surface',version:4,coordinate_system:'LOCAL_METERS',clip_bounds:[-32,-32,32,32],origin_bng:[383805.5,398336.5],horizontal_epsg:27700,vertical_datum:'ODN',points:[[-32,-32,0],[0,-32,0],[32,-32,0],[-32,32,0],[0,32,4],[32,32,8]],patches:[{kind:'triangle-strip',indices:[3,0,4,1]},{kind:'ruled-strip',left:[1,2],right:[4,5]}]};
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-10,`${a} / ${b}`);
test('existing GPR4 kernel represents the opposite P1 diagonal with exact height, gradient and C0 joins to bilinear bands',()=>{
  const bytes=encodeSourceBandBinary(model),decoded=decodeSourceBandBinary(bytes);assert.deepEqual(decoded,model);assert.equal(bytes.byteLength,280);const q=prepareSourceBandQuery(decoded);
  for(const [u,v] of [[.2,.8],[.8,.2],[.25,.25],[.75,.75]]){const p=q.query(-32+32*u,-32+64*v);close(p.height,4*Math.min(u,v));if(u<v){close(p.gradient[0],.125);close(p.gradient[1],0);}else if(u>v){close(p.gradient[0],0);close(p.gradient[1],.0625);}}
  const right=q.query(16,0);close(right.height,3);close(right.gradient[0],.0625);close(right.gradient[1],.09375);
  const left=prepareSourceBandQuery({...model,patches:[model.patches[0]]}),band=prepareSourceBandQuery({...model,patches:[model.patches[1]]});for(const y of [-32,-24,-16,0,8,24,32]){close(left.query(0,y).height,band.query(0,y).height);close(q.query(0,y).height,4*(y+32)/64);}assert.equal(q.query(32.01,0),null);
});
