import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {build} from 'esbuild';
import {fileURLToPath,pathToFileURL} from 'node:url';
import React from 'react';
import {create,act} from 'react-test-renderer';
const file=p=>new URL(p,import.meta.url),text=n=>typeof n==='string'?n:(n?.children??[]).map(text).join('');
async function bundle(name,entry,plugins=[]){const outfile=fileURLToPath(file(`../node_modules/.cache/gugis-tests/${name}.mjs`));await build({entryPoints:[fileURLToPath(file(entry))],outfile,bundle:true,platform:'node',format:'esm',packages:'external',loader:{'.css':'empty'},define:{'import.meta.env':'{}'},plugins});return import(pathToFileURL(outfile).href);}
const {loadPublicTerrain}=await bundle('load-public-terrain','../src/datasets/loadPublicTerrain.ts');
const {boundedTerrainDisplay}=await bundle('bounded-terrain-display','../src/datasets/boundedTerrainDisplay.ts');
const {patchFaces,ruledPoint}=await import('../src/studio/terrainMath.ts');
const {default:Explorer}=await bundle('dataset-explorer','../src/datasets/DatasetExplorer.tsx',[{name:'test-only-viewer',setup(b){b.onResolve({filter:/^react$/,namespace:'test'},()=>({path:'react',external:true}));b.onResolve({filter:/\.\/PublicTerrainViewer$/},()=>({path:'test-only-viewer',namespace:'test'}));b.onLoad({filter:/.*/,namespace:'test'},()=>({contents:"import React from 'react'; export default function Viewer({cityId}){return React.createElement('div',{'data-test-city':cityId},'test-only viewer');}",loader:'js'}));}}]);
const catalogue=JSON.parse(await readFile(file('../../shared/public-terrain-sources-v4.json')));
function response(bytes){return new Response(new ReadableStream({start(controller){for(let n=0;n<bytes.length;n+=8191)controller.enqueue(bytes.subarray(n,n+8191));controller.close();}}),{status:200});}
const controller=()=>new AbortController();

test('bounded public loader preserves all published raw models and only reads their preview endpoints',async()=>{
  const previous=globalThis.fetch;
  try{
    for(const source of catalogue.sources){const bytes=await readFile(file(`../../backend/data/terrain/${source.city_id}-ea-dtm-preview.gugis-terrain.json`));let calls=0;
      globalThis.fetch=async(url,options)=>{calls++;assert.equal(url,`/api/cities/${source.city_id}/city/terrain/public-preview`);assert.equal(options.signal instanceof AbortSignal,true);return response(Buffer.concat([Buffer.from('{"terrain":'),bytes,Buffer.from('}')]));};
      const result=await loadPublicTerrain(source.city_id,controller().signal);assert.equal(result.points.length,source.preview_points);assert.deepEqual(result,JSON.parse(bytes));assert.equal(calls,1);
    }
    globalThis.fetch=()=>assert.fail('pending city must not fetch another source');
    for(const id of ['edinburgh','cardiff','../london','unknown'])await assert.rejects(loadPublicTerrain(id,controller().signal),/无已核验/);
  }finally{globalThis.fetch=previous;}
});

test('loader rejects same-length corrupt archives, incomplete/oversized streams, protocol changes and cancellation',async()=>{
  const source=catalogue.sources.find(s=>s.city_id==='manchester'),native=await readFile(file('../../backend/data/terrain/manchester-ea-dtm-preview.gugis-terrain.json'));
  const bytes=Buffer.concat([Buffer.from('{"terrain":'),native,Buffer.from('}')]),previous=globalThis.fetch;
  try{
    let changed=Buffer.from(bytes);changed[200]^=1;
    for(const [content,pattern] of [[changed,/哈希/],[bytes.subarray(0,-1),/不完整/],[Buffer.concat([bytes,Buffer.from('x')]),/超出/],[Buffer.concat([Buffer.from('{"wrong__":'),native,Buffer.from('}')]),/协议/]]){globalThis.fetch=async()=>response(content);await assert.rejects(loadPublicTerrain(source.city_id,controller().signal),pattern);}
    const aborted=controller();aborted.abort();globalThis.fetch=async()=>response(bytes);await assert.rejects(loadPublicTerrain(source.city_id,aborted.signal),{name:'AbortError'});
  }finally{globalThis.fetch=previous;}
});

test('parametric 3D tessellation bound covers curved XY and all interior residuals; budget fallback is explicit',()=>{
  const terrain={points:[[0,0,0],[2,0,0],[0,2,0],[3,2,2]],patches:[{id:'curved-xy',kind:'ruled-strip',left:[0,2],right:[1,3]}]};
  const result=boundedTerrainDisplay(terrain,.03,10000),mesh=result.meshes['ruled-strip'];
  // Independently locate each parameter triangle and interpolate its output.
  const d=Math.round(Math.sqrt(result.expandedVertices))-1,twist=Math.sqrt(5);
  assert.ok(Math.abs(result.displayDistanceBound-twist/(4*d*d))<1e-12);
  let maximum=0;
  for(let j=0;j<=100;j++)for(let i=0;i<=100;i++){
    const u=i/100,v=j/100,x=Math.min(Math.floor(u*d),d-1),y=Math.min(Math.floor(v*d),d-1),s=u*d-x,t=v*d-y;
    const a=ruledPoint(...terrain.points,x/d,y/d),b=ruledPoint(...terrain.points,(x+1)/d,y/d),c=ruledPoint(...terrain.points,x/d,(y+1)/d),e=ruledPoint(...terrain.points,(x+1)/d,(y+1)/d);
    const approximation=s+t<=1?a.map((_,k)=>(1-s-t)*a[k]+s*b[k]+t*c[k]):b.map((_,k)=>(1-t)*b[k]+(1-s)*c[k]+(s+t-1)*e[k]);
    const exact=ruledPoint(...terrain.points,u,v),distance=Math.hypot(...exact.map((n,k)=>n-approximation[k]));maximum=Math.max(maximum,distance);
  }
  assert.ok(maximum<=result.displayDistanceBound+1e-12);assert.ok(mesh.triangles.length>2);
  const capped=boundedTerrainDisplay(terrain,.00001,4);assert.equal(capped.capped,true);assert.equal(capped.expandedVertices,4);assert.ok(capped.displayDistanceBound>.00001);
  assert.throws(()=>boundedTerrainDisplay(terrain,.1,3),/超过显示预算/);assert.throws(()=>boundedTerrainDisplay(terrain,0),/无效/);
});

test('all real previews fit the display budget without losing any native triangular face',async()=>{
  const key=t=>t.map(p=>p.join(',')).join('|');
  for(const source of catalogue.sources){
    const terrain=JSON.parse(await readFile(file(`../../backend/data/terrain/${source.city_id}-ea-dtm-preview.gugis-terrain.json`)));
    const before=JSON.stringify(terrain),prepared=boundedTerrainDisplay(terrain),mesh=prepared.meshes['triangle-strip'];
    assert.ok(prepared.expandedVertices<=200000);assert.ok(Number.isFinite(prepared.displayDistanceBound));assert.equal(JSON.stringify(terrain),before);
    const original=terrain.patches.filter(p=>p.kind==='triangle-strip').flatMap(p=>patchFaces(p)).map(face=>key(face.map(i=>terrain.points[i]))).sort();
    const rendered=mesh.triangles.map(face=>key(face.map(i=>mesh.vertices[i]))).sort();assert.deepEqual(rendered,original);
  }
});

test('dataset catalogue opens viewers only explicitly, clears them on city switch, restores back, and retains pending nations',async()=>{
  const previousWindow=globalThis.window,previousDocument=globalThis.document;const listeners=new Map();let r;
  try{
    globalThis.window={location:{href:'http://localhost/datasets?dataset=manchester',search:'?dataset=manchester'},history:{pushState:(_,__,url)=>{globalThis.window.location.href=String(url);globalThis.window.location.search=new URL(String(url)).search;}},addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:name=>listeners.delete(name)};
    globalThis.document={title:''};await act(async()=>r=create(React.createElement(Explorer)));
    assert.match(text(r.toJSON()),/5\.511 m/);assert.equal(r.root.findAllByProps({'data-test-city':'manchester'}).length,0);
    await act(async()=>r.root.findByProps({className:'dataset-primary'}).props.onClick());assert.equal(r.root.findByProps({'data-test-city':'manchester'}).props.children,'test-only viewer');
    act(()=>r.root.findAllByType('button').find(b=>text(b).includes('约克')).props.onClick());assert.match(text(r.toJSON()),/4\.683 m/);assert.equal(r.root.findAllByProps({'data-test-city':'manchester'}).length,0);assert.match(window.location.search,/dataset=york/);
    act(()=>r.root.findAllByType('button').find(b=>text(b).includes('爱丁堡')).props.onClick());assert.match(text(r.toJSON()),/尚无已核验/);assert.equal(r.root.findAllByProps({className:'dataset-primary'}).length,0);
    act(()=>r.root.findAllByType('button').find(b=>text(b).includes('牛津')).props.onClick());assert.match(text(r.toJSON()),/6,594/);assert.match(text(r.toJSON()),/0\.264 m/);assert.match(text(r.toJSON()),/3\.550 m/);assert.equal(r.root.findAllByProps({'data-test-city':'oxford'}).length,0);
    await act(async()=>r.root.findByProps({className:'dataset-primary'}).props.onClick());assert.equal(r.root.findByProps({'data-test-city':'oxford'}).props.children,'test-only viewer');
    act(()=>r.root.findAllByType('button').find(b=>text(b).includes('剑桥')).props.onClick());assert.match(text(r.toJSON()),/9,838/);assert.match(text(r.toJSON()),/0\.226 m/);assert.match(text(r.toJSON()),/2\.568 m/);assert.equal(r.root.findAllByProps({'data-test-city':'cambridge'}).length,0);assert.equal(r.root.findAllByProps({'data-test-city':'oxford'}).length,0);
    act(()=>r.root.findAllByType('button').find(b=>text(b).includes('利物浦')).props.onClick());assert.match(text(r.toJSON()),/3,401/);assert.match(text(r.toJSON()),/0\.593 m/);assert.match(text(r.toJSON()),/11\.391 m/);assert.equal(r.root.findAllByProps({className:'dataset-primary'}).length,1);assert.equal(r.root.findAllByProps({'data-test-city':'liverpool'}).length,0);assert.equal(r.root.findAllByProps({'data-test-city':'cambridge'}).length,0);
    window.location.search='?dataset=manchester';act(()=>listeners.get('popstate')());assert.match(text(r.toJSON()),/5\.511 m/);assert.equal(r.root.findAllByProps({'data-test-city':'manchester'}).length,0);
    act(()=>r.unmount());r=null;assert.equal(listeners.size,0);
  }finally{if(r)act(()=>r.unmount());if(previousWindow===undefined)delete globalThis.window;else globalThis.window=previousWindow;if(previousDocument===undefined)delete globalThis.document;else globalThis.document=previousDocument;}
});
