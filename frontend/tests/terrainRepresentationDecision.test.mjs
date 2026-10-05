import test from 'node:test';
import assert from 'node:assert/strict';
import {terrainTradeoff} from '../src/compare/terrainRepresentationDecision.ts';
const row=(bytes,e2_m2,target_met=true)=>({bytes,e2_m2,target_met});
test('lower file cost does not hide increased whole-domain error',()=>{
  assert.equal(terrainTradeoff(row(100,2),row(80,3)),'tradeoff');
  assert.equal(terrainTradeoff(row(100,2),row(120,1)),'tradeoff');
});
test('selection requires both metrics to be no worse, including equal metrics',()=>{
  assert.equal(terrainTradeoff(row(100,2),row(80,1)),'mixed-dominates');
  assert.equal(terrainTradeoff(row(100,2),row(120,3)),'triangles-dominates');
  assert.equal(terrainTradeoff(row(100,2),row(100,1)),'mixed-dominates');
  assert.equal(terrainTradeoff(row(100,2),row(120,2)),'triangles-dominates');
  assert.equal(terrainTradeoff(row(100,2),row(100,2)),'equal');
});
test('failed targets or invalid evidence cannot produce a recommendation',()=>{
  for(const value of [row(80,1,false),row(0,1),row(80,NaN),row(Infinity,1),row(80,-1)])
    assert.equal(terrainTradeoff(row(100,2),value),'incomplete');
});
test('small floating-point ties do not promote storage wins into precision claims',()=>{
  assert.equal(terrainTradeoff(row(100,2),row(100,2+1e-12)),'equal');
  assert.equal(terrainTradeoff(row(100,2),row(120,2-1e-12)),'triangles-dominates');
});
