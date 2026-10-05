import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {build} from 'esbuild';
import {fileURLToPath,pathToFileURL} from 'node:url';
import React from 'react';
import {create,act} from 'react-test-renderer';
const f=p=>new URL(p,import.meta.url),sha=b=>createHash('sha256').update(b).digest('hex');
async function bundle(name,entry){const outfile=fileURLToPath(f(`../node_modules/.cache/gugis-tests/${name}.mjs`));await build({entryPoints:[fileURLToPath(f(entry))],outfile,bundle:true,format:'esm',platform:'node',packages:'external',loader:{'.css':'empty'}});return import(pathToFileURL(outfile).href);}
const {default:Card}=await bundle('order-control-card','../src/compare/TerrainOrderControls.tsx');
const {decodeOrderBinary,validateOrderModel,orderQuery,lagrangeBasis,nodeOrders}=await bundle('order-control-kernel','../src/compare/terrainOrderMath.ts');
const {loadOrderModel}=await bundle('order-control-loader','../src/compare/loadOrderModel.ts');
const {useComparisonAnchor}=await bundle('comparison-anchor-test','../src/compare/useComparisonAnchor.ts');
const report=JSON.parse(await readFile(f('../../shared/terrain-order-control-v1.json'))),text=n=>typeof n==='string'?n:(n?.children??[]).map(text).join('');

test('structure advantage displays entire binary files, source examples and complete unfavourable higher-order controls',()=>{
  let r;const before=globalThis.fetch;globalThis.fetch=()=>assert.fail('Closed order prototype must not fetch');
  try{
    act(()=>r=create(React.createElement(Card)));const content=()=>text(r.toJSON());
    assert.match(content(),/35\.5%/);assert.match(content(),/61\.1%/);assert.match(content(),/27\/27/);
    assert.match(content(),/不能推广为优于所有高阶方法/);assert.match(content(),/完整三次三角空间 P₃/);
    assert.equal(r.root.findAllByType('canvas').length,0);
    assert.ok(r.root.findAllByType('a').some(a=>a.props.href==='/research/order-controls-v1/modulated-quadratic/p3-triangles.bin'));
    assert.equal(r.root.findAllByType('tbody')[0].findAllByType('tr').length,9);
    act(()=>r.root.findByProps({'aria-label':'高阶控制测试曲面'}).props.onChange({target:{value:'variable_curvature'}}));
    assert.match(text(r.root.findAllByType('tbody')[0]),/0\.005239/);
    const button=r.root.findAllByType('button').find(b=>text(b).startsWith('二次轮廓沿直线延展'));
    act(()=>button.props.onClick());assert.ok(r.root.findAllByType('a').some(a=>a.props.href==='/research/order-controls-v1/extruded-quadratic/p2-triangles.bin'));
  }finally{if(r)act(()=>r.unmount());globalThis.fetch=before;}
});

test('independent analytic field and derivative agree across exact P2/P3 controls and decoded binary',async()=>{
  for(const fixture of report.structure_fixtures)for(const e of [fixture.ruled,fixture.triangles]){
    const json=await readFile(f(`../public/research/order-controls-v1/${fixture.id}/${e.filename}`)),binary=await readFile(f(`../public/research/order-controls-v1/${fixture.id}/${e.binary_filename}`));
    assert.equal(sha(binary),e.binary_sha256);const model=decodeOrderBinary(binary);assert.deepEqual(model,validateOrderModel(JSON.parse(json)));
    for(const [x,y] of [[-50,-50],[-50,50],[50,-50],[50,50],[0,0],[17,-22],[33.33,33.33],[-16.667,-16.667]]){
      const q=orderQuery(model,x,y);assert.ok(q);
      const expected=fixture.id==='extruded-quadratic'?30+.002*x*x+.03*y:30+.00002*x*x*(y+60)+.01*y;
      const gradient=fixture.id==='extruded-quadratic'?[.004*x,.03]:[.00004*x*(y+60),.00002*x*x+.01];
      assert.ok(Math.abs(q.height-expected)<1e-10);for(let k=0;k<2;k++)assert.ok(Math.abs(q.gradient[k]-gradient[k])<1e-10);
    }
    assert.equal(orderQuery(model,50.01,0),null);
  }
  for(const p of [2,3])for(const [i,node] of nodeOrders(p).entries()){
    const basis=lagrangeBasis(node.map(v=>v/p),p);for(let j=0;j<basis.length;j++)assert.ok(Math.abs(basis[j].value-(i===j?1:0))<1e-14);
    assert.ok(Math.abs(basis.reduce((sum,b)=>sum+b.value,0)-1)<1e-14);
    for(let k=0;k<3;k++){const lambda=node.map(v=>v/p),h=1e-6,a=[...lambda],b=[...lambda];a[k]-=h;b[k]+=h;
      for(let j=0;j<basis.length;j++){const fd=(lagrangeBasis(b,p)[j].value-lagrangeBasis(a,p)[j].value)/(2*h);assert.ok(Math.abs(fd-basis[j].derivative[k])<1e-8);}}
  }
});

test('binary decoder rejects excessive allocation, unknown tags, trailing bytes, folded or misplaced nodes',async()=>{
  const fixture=report.structure_fixtures[1],bytes=new Uint8Array(await readFile(f(`../public/research/order-controls-v1/${fixture.id}/${fixture.triangles.binary_filename}`)));
  for(const end of [0,15,17,bytes.length-1])assert.throws(()=>decodeOrderBinary(bytes.slice(0,end)));
  const bad=bytes.slice();new DataView(bad.buffer).setUint32(8,1000000,true);assert.throws(()=>decodeOrderBinary(bad),/容量/);
  const trailing=new Uint8Array(bytes.length+1);trailing.set(bytes);assert.throws(()=>decodeOrderBinary(trailing),/多余/);
  const model=decodeOrderBinary(bytes);model.points[model.patches[0].nodes[1]][0]+=1;assert.throws(()=>validateOrderModel(model),/位置/);
});

test('bounded binary loader verifies hash, protocol and complete stream before live query',async()=>{
  const fxt=report.structure_fixtures[1],e=fxt.ruled,url=`/research/order-controls-v1/${fxt.id}/${e.binary_filename}`,bytes=await readFile(f(`../public${url}`)),before=globalThis.fetch;
  try{globalThis.fetch=async()=>new Response(bytes);const signal=new AbortController().signal;
    assert.equal((await loadOrderModel(url,e.binary_bytes,e.binary_sha256,signal)).points.length,6);
    await assert.rejects(loadOrderModel(url,e.binary_bytes-1,e.binary_sha256,signal),/超出/);
    await assert.rejects(loadOrderModel(url,e.binary_bytes+1,e.binary_sha256,signal),/不完整/);
    await assert.rejects(loadOrderModel(url,e.binary_bytes,'0'.repeat(64),signal),/哈希/);
    globalThis.fetch=()=>assert.fail('Invalid receipt must not fetch');
    await assert.rejects(loadOrderModel('/api/cities/london/city/current',e.binary_bytes,e.binary_sha256,signal),/凭据/);
    await assert.rejects(loadOrderModel(url,2000000,e.binary_sha256,signal),/凭据/);
  }finally{globalThis.fetch=before;}
});

test('live binary prototype releases models on close and updates the fixture without stale responses',async()=>{
  const before=globalThis.fetch,calls=[];let r;
  try{globalThis.fetch=async(url,{signal})=>{calls.push({url,signal});return new Response(await readFile(f(`../public${url}`)));};
    act(()=>r=create(React.createElement(Card)));await act(async()=>{r.root.findByProps({'aria-expanded':false}).props.onClick();await new Promise(resolve=>setTimeout(resolve,40));});
    for(let i=0;i<10&&r.root.findAllByProps({className:'oc-demo-grid'}).length===0;i++)await act(async()=>{await new Promise(resolve=>setTimeout(resolve,20));});
    assert.equal(r.root.findAllByProps({className:'oc-node-diagram'}).length,2);
    assert.match(text(r.root.findByProps({className:'oc-demo-grid'})),/16 个节点/);
    act(()=>r.root.findByProps({'aria-label':'结构对照查询X'}).props.onChange({target:{value:'31'}}));
    assert.equal(r.root.findByProps({'aria-label':'结构对照查询X'}).props.value,31);
    act(()=>r.root.findByProps({'aria-expanded':true}).props.onClick());
    assert.ok(calls.every(c=>c.signal.aborted));assert.equal(r.root.findAllByProps({className:'oc-demo'}).length,0);
  }finally{if(r)act(()=>r.unmount());globalThis.fetch=before;}
});

test('async comparison anchors follow only their matching fragment once the section mounts',()=>{
  const oldWindow=globalThis.window,oldDocument=globalThis.document;let r;const calls=[];
  const Mount=({anchor})=>{useComparisonAnchor(anchor);return null;};
  try{globalThis.window={location:{hash:'#order-structure-results'}};
    globalThis.document={getElementById:id=>({scrollIntoView:options=>calls.push({id,options})})};
    act(()=>r=create(React.createElement(Mount,{anchor:'order-structure-results'})));
    assert.deepEqual(calls,[{id:'order-structure-results',options:{block:'start'}}]);
    act(()=>r.update(React.createElement(Mount,{anchor:'order-structure-results'})));assert.equal(calls.length,1);
    act(()=>r.update(React.createElement(Mount,{anchor:'paper-results'})));assert.equal(calls.length,1);
  }finally{if(r)act(()=>r.unmount());globalThis.window=oldWindow;globalThis.document=oldDocument;}
});

test('switching structure fixtures during a delayed read keeps late P3 responses out of the new P2 demo',async()=>{
  const before=globalThis.fetch,calls=[],payloads=new Map();let r;
  for(const fixture of report.structure_fixtures)for(const e of [fixture.ruled,fixture.triangles]){
    const url=`/research/order-controls-v1/${fixture.id}/${e.binary_filename}`;payloads.set(url,await readFile(f(`../public${url}`)));
  }
  try{
    globalThis.fetch=(url,{signal})=>new Promise(resolve=>calls.push({url,signal,resolve:()=>resolve(new Response(payloads.get(url)))}));
    act(()=>r=create(React.createElement(Card)));act(()=>r.root.findByProps({'aria-expanded':false}).props.onClick());assert.equal(calls.length,2);
    const button=r.root.findAllByType('button').find(b=>text(b).startsWith('二次轮廓沿直线延展'));act(()=>button.props.onClick());
    assert.equal(calls.length,4);assert.ok(calls.slice(0,2).every(c=>c.signal.aborted));
    await act(async()=>{calls.slice(2).forEach(c=>c.resolve());await new Promise(resolve=>setTimeout(resolve,30));});
    for(let i=0;i<10&&r.root.findAllByProps({className:'oc-demo-grid'}).length===0;i++)await act(async()=>{await new Promise(resolve=>setTimeout(resolve,20));});
    assert.match(text(r.root.findByProps({className:'oc-demo-grid'})),/9 个节点/);
    await act(async()=>{calls.slice(0,2).forEach(c=>c.resolve());await new Promise(resolve=>setTimeout(resolve,30));});
    assert.match(text(r.root.findByProps({className:'oc-demo-grid'})),/9 个节点/);
    assert.doesNotMatch(text(r.root.findByProps({className:'oc-demo-grid'})),/16 个节点/);
    assert.equal(r.root.findAllByProps({role:'alert'}).length,0);
  }finally{if(r)act(()=>r.unmount());globalThis.fetch=before;}
});
