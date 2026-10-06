import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {encodeSourceBandBinary} from '../src/compare/sourceRuledBandMath.ts';
import {inspectDiagonalGrid,loadDiagonalSourceModel} from '../src/compare/loadDiagonalSourceModel.ts';
const model={format:'gugis-research-surface',version:4,coordinate_system:'LOCAL_METERS',clip_bounds:[-32,-32,32,32],origin_bng:[383805.5,398336.5],horizontal_epsg:27700,vertical_datum:'ODN',points:[[-32,-32,0],[0,-32,0],[32,-32,0],[-32,32,0],[0,32,4],[32,32,8]],patches:[{kind:'triangle-strip',indices:[3,0,4,1]},{kind:'ruled-strip',left:[1,2],right:[4,5]}]};
const binary=Buffer.from(encodeSourceBandBinary(model)),sha=b=>createHash('sha256').update(b).digest('hex'),url='/research/diagonal-hybrid-v1/manchester-centre/hybrid-local-2x1.bin';
test('actual saved indices determine plus/minus orientation, rule cells and complete non-overlapping coverage',()=>{
  const s=inspectDiagonalGrid(model,2,1);assert.deepEqual(s.cells,['plus','ruled']);assert.equal(s.plus,1);assert.equal(s.ruled,1);assert.equal(s.minus,0);
  const minus={...model,patches:[{kind:'triangle-strip',indices:[0,3,1,4]},model.patches[1]]};assert.deepEqual(inspectDiagonalGrid(minus,2,1).cells,['minus','ruled']);
  assert.throws(()=>inspectDiagonalGrid({...model,patches:[...model.patches,model.patches[0]]},2,1),/重复/);assert.throws(()=>inspectDiagonalGrid({...model,patches:[model.patches[0]]},2,1),/缺少/);assert.throws(()=>inspectDiagonalGrid({...model,patches:[{kind:'triangle-strip',indices:[0,3,2,5]}]},2,1),/索引/);assert.throws(()=>inspectDiagonalGrid(model,4,1),/节点/);
});
test('only bound same-origin exact native files can drive opposite-diagonal queries',async()=>{
  const original=globalThis.fetch,calls=[];try{globalThis.fetch=async u=>{calls.push(u);return new Response(binary);};const signal=new AbortController().signal;assert.deepEqual(await loadDiagonalSourceModel(url,binary.length,sha(binary),model.origin_bng,signal),model);assert.equal(calls.length,1);
    await assert.rejects(loadDiagonalSourceModel(url.replace('hybrid-local','p1-local'),binary.length,sha(binary),model.origin_bng,signal),/P1/);await assert.rejects(loadDiagonalSourceModel(url,binary.length+1,sha(binary),model.origin_bng,signal),/长度/);await assert.rejects(loadDiagonalSourceModel(url,binary.length,'0'.repeat(64),model.origin_bng,signal),/SHA-256/);await assert.rejects(loadDiagonalSourceModel(url,binary.length,sha(binary),[0,0],signal),/原点/);
    const count=calls.length;await assert.rejects(loadDiagonalSourceModel(url.replace('2x1','3x1'),binary.length,sha(binary),model.origin_bng,signal),/收据/);await assert.rejects(loadDiagonalSourceModel(url.replace('manchester-centre','../manchester-centre'),binary.length,sha(binary),model.origin_bng,signal),/收据/);const abort=new AbortController();abort.abort();await assert.rejects(loadDiagonalSourceModel(url,binary.length,sha(binary),model.origin_bng,abort.signal),e=>e.name==='AbortError');assert.equal(calls.length,count);
  }finally{globalThis.fetch=original;}
});
