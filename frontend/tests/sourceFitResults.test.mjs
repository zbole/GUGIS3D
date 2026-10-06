import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
import React from 'react';
import {act,create} from 'react-test-renderer';
import {bundleWorkspaceModule} from './bundleWorkspaceModule.mjs';
import {decodeSourceBandBinary,decodeRegularGridBinary,prepareSourceBandQuery,prepareRegularGridQuery} from '../src/compare/sourceRuledBandMath.ts';
const f=p=>new URL(p,import.meta.url),text=n=>typeof n==='string'?n:(n?.children??[]).map(text).join(''),sha=b=>createHash('sha256').update(b).digest('hex');
const out=fileURLToPath(f('../node_modules/.cache/gugis-tests/source-fit-results.mjs'));await bundleWorkspaceModule(fileURLToPath(f('../src/compare/SourceFitResults.tsx')),out);
const Card=(await import(pathToFileURL(out).href)).default,report=JSON.parse(await readFile(f('../../shared/source-global-fit-display-v1.json')));
const wait=async fn=>{for(let i=0;i<80;i++){if(fn())return;await act(async()=>new Promise(resolve=>setTimeout(resolve,10)));}assert.fail('Expected actual validated native model UI');};

test('equally fitted controls retain every site, three losses, maximum-error tradeoffs and missing targets without fetching models',()=>{
  const old=globalThis.fetch;let r;try{globalThis.fetch=()=>assert.fail('Static fit result fetched models or city');act(()=>r=create(React.createElement(Card)));const s=text(r.toJSON());for(const pattern of [/2,900/,/17\/20/,/3\/20/,/144/,/138\/200/,/20\/20/,/全局最优混合结构/,/不是区间证明/])assert.match(s,pattern);assert.equal(r.root.findByProps({'aria-label':'共享拟合真实地形样区'}).findAllByType('option').length,20);assert.equal(r.root.findAllByType('tbody')[0].findAllByType('tr').length,6);assert.equal(r.root.findAllByType('tbody')[1].findAllByType('tr').length,20);
    act(()=>r.root.findByProps({'aria-label':'共享拟合真实地形样区'}).props.onChange({target:{value:'oxford-north-quarter'}}));assert.match(text(r.root.findByProps({className:'sfit-overview'})),/0\.4128%更高/);
    act(()=>r.root.findByProps({'aria-label':'共享拟合文件预算'}).props.onChange({target:{value:'135528'}}));assert.doesNotMatch(text(r.toJSON()),/NaN|Infinity/);assert.match(text(r.root.findByProps({className:'sfit-overview'})),/135,528 → 135,528/);
    act(()=>r.root.findByProps({'aria-label':'共享拟合比较条件'}).props.onChange({target:{value:'target'}}));act(()=>r.root.findByProps({'aria-label':'共享拟合最大误差目标'}).props.onChange({target:{value:'0.01'}}));assert.doesNotMatch(text(r.toJSON()),/NaN|Infinity/);assert.ok(r.root.findAllByType('tr').some(row=>text(row).includes('无合格模型')));
  }finally{if(r)act(()=>r.unmount());globalThis.fetch=old;}
});

test('three saved fitted binaries use one heat scale and native point values, synchronize clicks and abort obsolete site loads',async()=>{
  const old=globalThis.fetch,calls=[];let r;try{globalThis.fetch=async(url,{signal})=>{calls.push({url,signal});return new Response(await readFile(f('../public'+url)));};act(()=>r=create(React.createElement(Card)));await act(async()=>r.root.findByProps({'aria-label':'展开共享拟合原生同步查询'}).props.onClick());await wait(()=>r.root.findAllByProps({className:'sfit-native'}).length===1);assert.equal(calls.length,4);const site=report.cases[0],row=site.byte_pairs.find(p=>p.byte_ceiling===8192),source=prepareRegularGridQuery(decodeRegularGridBinary(await readFile(f(`../public/research/source-native-bands-v1/${site.id}/${site.regular_grid.filename}`))));
    const maps=r.root.findByProps({className:'sfit-native'}).findAllByType('svg');assert.equal(maps.length,3);assert.equal(new Set(maps.map(m=>text(m.findAllByType('text')[0]))).size,1);
    for(const [i,key] of ['p1-fit','ruled-fit','hybrid-fit'].entries()){const e=site.models[row[key]],fn=prepareSourceBandQuery(decodeSourceBandBinary(await readFile(f(`../public/research/source-global-fit-v1/${site.id}/${e.binary_filename}`))));for(const cell of maps[i].findAllByType('rect')){assert.ok(Math.abs(cell.props['data-delta']-(fn.query(cell.props['data-x'],cell.props['data-y']).height-source.query(cell.props['data-x'],cell.props['data-y']).height))<1e-12);}}
    const cell=maps[2].findAllByType('rect')[212];act(()=>cell.props.onClick());assert.equal(r.root.findByProps({'aria-label':'共享拟合原生同步查询X'}).props.value,cell.props['data-x']);assert.equal(calls.length,4);act(()=>r.root.findByProps({'aria-label':'共享拟合真实地形样区'}).props.onChange({target:{value:'newcastle-centre'}}));assert.ok(calls.slice(0,4).every(c=>c.signal.aborted));await wait(()=>r.root.findAllByProps({className:'sfit-native'}).length===1);assert.equal(calls.length,8);assert.ok(calls.slice(4).every(c=>c.url.includes('/newcastle-centre/')));
  }finally{if(r)act(()=>r.unmount());globalThis.fetch=old;}
});

test('corrupted fitted data is refused and retry loads complete verified models',async()=>{
  const old=globalThis.fetch;let r,corrupt=true;try{globalThis.fetch=async url=>{const b=await readFile(f('../public'+url));if(corrupt&&url.includes('/hybrid-fit-'))b[b.length-1]^=1;return new Response(b);};act(()=>r=create(React.createElement(Card)));await act(async()=>r.root.findByProps({'aria-label':'展开共享拟合原生同步查询'}).props.onClick());await wait(()=>r.root.findAllByProps({role:'alert'}).length===1);assert.match(text(r.root.findByProps({role:'alert'})),/SHA-256/);assert.equal(r.root.findAllByProps({className:'sfit-native'}).length,0);corrupt=false;await act(async()=>r.root.findByProps({role:'alert'}).findByType('button').props.onClick());await wait(()=>r.root.findAllByProps({className:'sfit-native'}).length===1);
  }finally{if(r)act(()=>r.unmount());globalThis.fetch=old;}
});

test('every selectable fitted or original model and evidence download binds immutable native bytes',async()=>{
  assert.equal(sha(await readFile(f('../public/research/source-global-fit-v1/results.json'))),report.report_sha256);const p=report.package,b=await readFile(f('../public/research/source-global-fit-v1/'+p.filename));assert.equal(b.length,p.bytes);assert.equal(sha(b),p.sha256);
  for(const site of report.cases)for(const e of Object.values(site.models)){const folder=e.method.endsWith('-fit')?'source-global-fit-v1':e.method==='ruled'?'hybrid-source-v1':'diagonal-hybrid-v1';const raw=await readFile(f(`../public/research/${folder}/${site.id}/${e.binary_filename}`));assert.equal(raw.length,e.binary_bytes);assert.equal(sha(raw),e.binary_sha256);}
});

test('both new fitting deep links mount only their lazy result panel and clean up listeners',async()=>{
  const out=fileURLToPath(f('../node_modules/.cache/gugis-tests/source-fit-disclosure.mjs'));await bundleWorkspaceModule(fileURLToPath(f('../src/compare/SourceFitDisclosure.tsx')),out);const Disclosure=(await import(pathToFileURL(out).href)).default;
  for(const hash of ['#source-fit-results','#source-fit-evidence']){const previous=globalThis.window,listeners=new Set();let r;try{globalThis.window={location:{hash},addEventListener:(n,fn)=>listeners.add(fn),removeEventListener:(n,fn)=>listeners.delete(fn)};await act(async()=>r=create(React.createElement(Disclosure)));await wait(()=>r.root.findAllByProps({id:'source-fit-results'}).length===1);assert.equal(r.root.findByProps({id:'source-fit-evidence'}).props.open,true);act(()=>r.unmount());r=null;assert.equal(listeners.size,0);}finally{if(r)act(()=>r.unmount());globalThis.window=previous;}}
});
