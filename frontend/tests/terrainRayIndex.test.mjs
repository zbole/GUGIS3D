import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {build} from 'esbuild';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {Cartesian3,Matrix4,Ray} from 'cesium';
const root=new URL('../../',import.meta.url);
const output=fileURLToPath(new URL('../node_modules/.cache/gugis-tests/terrain-ray-hierarchy.mjs',import.meta.url));
await build({stdin:{contents:"export * from './src/studio/terrainRayIndex'; export {terrainIndex} from './src/studio/terrainMath'; export {terrainSampler} from './src/studio/terrainScene';",resolveDir:fileURLToPath(new URL('../',import.meta.url))},outfile:output,
  bundle:true,platform:'node',format:'esm',packages:'external'});
const {buildTerrainRayHierarchy,terrainRayHierarchy,acceleratedTerrainSampler,terrainIndex,terrainSampler}=await import(pathToFileURL(output).href);
const terrain={version:'1.0',name:'Native tests',longitude:0,latitude:0,vertical_datum:'local',reference_height:0,
  demonstration:true,source:{},points:[[0,0,0],[10,0,0],[0,10,0],[10,10,10]],
  patches:[{id:'ruled',kind:'ruled-strip',left:[0,2],right:[1,3]}]};

test('ray hierarchy preserves both roots, skewed ruled functions, strip/fan kinds and invalid rays',()=>{
  const fixtures=[terrain,{...terrain,points:[[0,0,0],[10,2,0],[1,10,0],[12,12,10]]},
    {...terrain,reference_height:100,points:[...terrain.points,[5,5,3]].map(p=>[p[0],p[1],p[2]+100]),
      patches:[{id:'strip',kind:'triangle-strip',indices:[1,0,3,2]},{id:'fan',kind:'triangle-fan',hub:4,ring:[0,2,3,1]}]},
    {...terrain,patches:[]}];
  const rays=[[[5,5,20],[0,0,-1]],[[0,10,2],[1,-1,0]],[[-5,-5,0],[1,1,.4]],[[5,5,20],[0,0,1]],
    [[50,50,20],[0,0,-1]],[[5,5,20],[1,0,0]],[[4,4,200],[0,0,-1]],[[0,0,20],[0,0,-1]],
    [[0,0,0],[0,0,0]],[[Infinity,0,0],[0,0,-1]],[[0,0,1],[NaN,0,-1]]];
  for(const model of fixtures)for(const leafSize of [2,8]){
    const before=JSON.stringify(model),native=terrainIndex(model),tree=buildTerrainRayHierarchy(model,leafSize);
    for(const [origin,direction] of rays)assert.deepEqual(tree.raycast(origin,direction),native.raycast(origin,direction));
    assert.equal(JSON.stringify(model),before);
  }
});

test('coincident hits and shared-edge one-sided derivatives keep source cell order',()=>{
  const model={...terrain,points:[[0,0,0],[1,0,0],[0,1,0],[1,1,2],[0,0,-1],[1,0,-1],[0,1,-1]],
    patches:[{id:'steep-first',kind:'triangle-strip',indices:[1,3,2]},
      {id:'flat-second',kind:'triangle-strip',indices:[0,1,2]},
      {id:'lower',kind:'triangle-strip',indices:[4,5,6]}]};
  for(const reversed of [false,true]){
    const current={...model,patches:reversed?[model.patches[1],model.patches[0],model.patches[2]]:model.patches};
    const native=terrainIndex(current),tree=buildTerrainRayHierarchy(current,2);
    for(const x of [0,.25,.5,.75,1])assert.deepEqual(tree.raycast([x,1-x,10],[0,0,-1]),native.raycast([x,1-x,10],[0,0,-1]));
  }
});

test('large actual DEM filters ray candidates and preserves geographic wrapper results',async()=>{
  const report=JSON.parse(await readFile(new URL('shared/raster-triangle-benchmark.json',root)));
  const variant=report.cases[0].variants.find(v=>v.target_m===.1);
  for(const family of ['hybrid','compact_hybrid','local_triangles']){
    const model=JSON.parse(await readFile(new URL(`frontend/public/research/hybrid-terrain/models/swiss-dem-crop/${variant[family].filename}`,root)));
    const before=JSON.stringify(model),native=terrainIndex(model),tree=terrainRayHierarchy(model);
    assert.equal(terrainRayHierarchy(model),tree);
    for(const [x,y] of [[0,0],[.25,.125],[-20,21],[31.75,-31.75],[-32,-32],[32,32]]){
      const origin=[x,y,2000],direction=[0,0,-1],result=tree.raycastWithStats(origin,direction);
      assert.deepEqual(result.hit,native.raycast(origin,direction));
      assert.ok(result.candidateCells<32);assert.ok(result.nodesTested+result.cellsTested<native.cells.length/10);
    }
    const regular=terrainSampler(model),accelerated=acceleratedTerrainSampler(model,'hierarchy');
    assert.equal(regular.index,accelerated.index,'height analysis retains the exact original native index');
    const origin=Matrix4.multiplyByPoint(regular.frame,new Cartesian3(.25,.125,2000-model.reference_height),new Cartesian3());
    const direction=Matrix4.multiplyByPointAsVector(regular.frame,new Cartesian3(0,0,-1),new Cartesian3());
    assert.deepEqual(accelerated.ray(new Ray(origin,direction)),regular.ray(new Ray(origin,direction)));
    assert.equal(JSON.stringify(model),before);
  }
});

test('overlapping sheets use a bounded subset fallback and preserve the first source hit',()=>{
  const model={...terrain,patches:Array.from({length:300},(_,i)=>({id:`sheet-${i}`,kind:'triangle-strip',indices:[0,1,2]}))};
  const native=terrainIndex(model),result=buildTerrainRayHierarchy(model).raycastWithStats([2,2,30],[0,0,-1]);
  assert.equal(result.fallback,true);assert.equal(result.candidateCells,257);assert.equal(result.solvedCells,300);
  assert.deepEqual(result.hit,native.raycast([2,2,30],[0,0,-1]));assert.equal(result.hit.patch,'sheet-0');
});
