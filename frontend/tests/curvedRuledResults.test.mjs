import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash,webcrypto} from 'node:crypto';
import {build} from 'esbuild';
import {fileURLToPath,pathToFileURL} from 'node:url';
import React from 'react';
import {create,act} from 'react-test-renderer';
const f=p=>new URL(p,import.meta.url),sha=b=>createHash('sha256').update(b).digest('hex');
async function bundle(name,entry){const outfile=fileURLToPath(f(`../node_modules/.cache/gugis-tests/${name}.mjs`));await build({entryPoints:[fileURLToPath(f(entry))],outfile,bundle:true,format:'esm',platform:'node',packages:'external',loader:{'.css':'empty'}});return import(pathToFileURL(outfile).href);}
const {default:Card,functionPair}=await bundle('curved-results','../src/compare/CurvedRuledResults.tsx');
const {curveQuery,validateCurveModel,curvedRuledPoint}=await bundle('curved-kernel-test','../src/compare/curvedRuledMath.ts');
const {loadCurvedRuledModel}=await bundle('curved-loader-test','../src/compare/loadCurvedRuledModel.ts');
const report=JSON.parse(await readFile(f('../../shared/curved-ruled-comparison-v1.json')));
const text=n=>typeof n==='string'?n:(n?.children??[]).map(text).join('');

test('direct GUGIS advantage follows baseline bytes, includes every budget and preserves three negative paper pairs',()=>{
  const fetchBefore=globalThis.fetch;globalThis.fetch=()=>assert.fail('Closed prototype must not fetch models');let r;
  try{
    act(()=>r=create(React.createElement(Card)));const finding=()=>text(r.root.findByProps({className:'cr-finding '}));
    assert.match(finding(),/98\.3%/);assert.match(finding(),/41\.7%/);
    assert.equal(r.root.findAllByType('canvas').length,0);
    assert.ok(r.root.findAllByType('a').some(a=>a.props.href==='/research/curved-ruled-v1/anisotropic/curve-x-1x256.json'));
    assert.match(text(r.toJSON()),/24\/27/);assert.match(text(r.toJSON()),/3 组不占优/);
    assert.equal(r.root.findAllByType('tbody')[0].findAllByType('tr').length,9);
    const change=(label,value)=>act(()=>r.root.findByProps({'aria-label':label}).props.onChange({target:{value}}));
    change('函数对照基线三角形数','8');assert.match(text(r.root.findByProps({className:'cr-finding cr-adverse'})),/15\.3%.*误差增加/);
    change('函数对照测试曲面','variable_curvature');change('函数对照基线三角形数','32');assert.match(text(r.root.findByProps({className:'cr-finding cr-adverse'})),/32\.5%/);
    change('函数对照基线','uniform_euclidean');assert.match(finding(),/41\.9%/);
    assert.match(text(r.toJSON()),/控制点本身不一定在源曲面上/);assert.match(text(r.toJSON()),/不作速度胜负结论/);
    const pairs=report.cases.flatMap(c=>c.pairs.filter(p=>p.method==='paper_l2_l1'));
    assert.equal(pairs.filter(p=>p.e2_reduction_percent<0).length,3);
    for(const c of report.cases)for(const p of c.pairs){const {baseline,candidate}=functionPair(c,p.method,p.budget_n);assert.ok(candidate.bytes<=baseline.bytes);assert.ok(Math.abs(p.e2_reduction_percent-100*(1-candidate.e2_m2/baseline.e2_m2))<1e-12);}
  }finally{if(r)act(()=>r.unmount());globalThis.fetch=fetchBefore;}
});

test('saved Bezier controls interpolate mid-height but are not sample heights; query derivatives match finite differences in both axes',async()=>{
  for(const cid of ['isotropic','anisotropic','variable_curvature']){
    const c=report.cases.find(c=>c.id===cid);
    for(const axis of ['x','y']){
      const e=c.candidates.find(e=>e.axis===axis&&e.nx===1&&e.ny===1),model=validateCurveModel(JSON.parse(await readFile(f(`../public/research/curved-ruled-v1/${cid}/${e.filename}`))));
      const patch=model.patches[0],point=curvedRuledPoint(model,patch,.37,.61),q=curveQuery(model,point[0],point[1]);
      assert.ok(Math.abs(point[2]-q.height)<1e-11);
      for(let j=0;j<2;j++){const a=[point[0],point[1]],b=[...a],h=1e-3;a[j]-=h;b[j]+=h;
        const derivative=(curveQuery(model,...b).height-curveQuery(model,...a).height)/(2*h);assert.ok(Math.abs(q.gradient[j]-derivative)<1e-8);}
      const middle=model.points[patch.left[1]];
      assert.ok(Math.abs(middle[2]-curveQuery(model,middle[0],middle[1]).height)>1e-3);
    }
  }
  assert.equal(curveQuery({patches:[]},NaN,0),null);
});

test('native loader bounds incoming streams and verifies actual SHA before decoding',async()=>{
  const c=report.cases[1],e=c.candidates[0],url=`/research/curved-ruled-v1/${c.id}/${e.filename}`;
  const bytes=await readFile(f(`../public${url}`));const fetchBefore=globalThis.fetch;const signal=new AbortController().signal;
  try{
    assert.equal(sha(bytes),e.sha256);
    globalThis.fetch=async()=>new Response(bytes);
    assert.ok((await loadCurvedRuledModel(url,e.bytes,e.sha256,signal)).patches.length>0);
    await assert.rejects(loadCurvedRuledModel(url,e.bytes+1,e.sha256,signal),/不完整/);
    await assert.rejects(loadCurvedRuledModel(url,e.bytes-1,e.sha256,signal),/超过/);
    await assert.rejects(loadCurvedRuledModel(url,e.bytes,'0'.repeat(64),signal),/哈希/);
    globalThis.fetch=()=>assert.fail('Invalid receipts must not fetch');
    for(const bad of ['https://example.org/model.json','/api/cities/london/city/current','/research/curved-ruled-v1/anisotropic/../model.json'])await assert.rejects(loadCurvedRuledModel(bad,e.bytes,e.sha256,signal),/凭据/);
    for(const bad of [0,NaN,Infinity,2*1024*1024])await assert.rejects(loadCurvedRuledModel(url,bad,e.sha256,signal),/凭据/);
  }finally{globalThis.fetch=fetchBefore;}
});

test('closing or changing a loaded prototype aborts stale reads and query markers use the actual field',async()=>{
  let r;const fetchBefore=globalThis.fetch,calls=[];
  try{
    globalThis.fetch=async(url,{signal})=>{calls.push({url,signal});return new Response(await readFile(f(`../public${url}`)));};
    act(()=>r=create(React.createElement(Card)));
    await act(async()=>{r.root.findByProps({'aria-expanded':false}).props.onClick();await new Promise(resolve=>setTimeout(resolve,40));});
    // Local crypto/file promises can complete after React's first effect flush.
    for(let i=0;i<10&&r.root.findAllByProps({className:'cr-preview-grid'}).length===0;i++)await act(async()=>{await new Promise(resolve=>setTimeout(resolve,20));});
    assert.equal(calls.length,2);assert.equal(r.root.findAllByProps({className:'cr-model-plot'}).length,2);
    act(()=>r.root.findByProps({'aria-label':'函数模型查询X'}).props.onChange({target:{value:'7.5'}}));
    assert.equal(r.root.findByProps({'aria-label':'函数模型查询X'}).props.value,7.5);
    act(()=>r.root.findByProps({'aria-expanded':true}).props.onClick());
    assert.ok(calls.every(c=>c.signal.aborted));assert.equal(r.root.findAllByProps({className:'cr-preview'}).length,0);
    assert.equal(r.root.findAllByType('canvas').length,0);
  }finally{if(r)act(()=>r.unmount());globalThis.fetch=fetchBefore;}
});
