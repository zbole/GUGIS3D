import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
import React from 'react';
import {act,create} from 'react-test-renderer';
import {bundleWorkspaceModule} from './bundleWorkspaceModule.mjs';
const f=p=>new URL(p,import.meta.url),text=n=>typeof n==='string'?n:(n?.children??[]).map(text).join('');
const out=fileURLToPath(f('../node_modules/.cache/gugis-tests/result-focus.mjs'));
await bundleWorkspaceModule(fileURLToPath(f('../src/compare/ResultFocusSummary.tsx')),out);
const Card=(await import(pathToFileURL(out).href)).default,report=JSON.parse(await readFile(f('../../shared/result-focus-v7.json')));
test('focused results show three separate evidence chains, all source and timing observations and the better P2 control',()=>{
  const previous=globalThis.fetch;globalThis.fetch=()=>assert.fail('Primary results must not fetch city data or native models');let r;
  try{act(()=>r=create(React.createElement(Card)));const s=text(r.toJSON());assert.match(s,/65\.16/);assert.match(s,/69\/69/);assert.match(s,/58\/63/);assert.match(s,/26,108/);assert.match(s,/20\/20/);assert.match(s,/138\/200/);assert.match(s,/17\/20/);assert.match(s,/3\/20/);assert.match(s,/60\/60/);assert.match(s,/P₂ 更小/);assert.match(s,/统一无损编码/);assert.match(s,/不是置信区间/);assert.match(s,/80\.5/);assert.match(s,/32\.6/);assert.equal(r.root.findAllByType('i').length,5);
    assert.equal(r.root.findAllByProps({className:'rf-card'}).length,3);assert.equal(r.root.findByProps({className:'rf-secondary'}).findAllByType('article').length,2);assert.equal(r.root.findAllByType('svg').length,2);assert.equal(r.root.findAllByType('svg')[0].findAllByType('circle').length,20);assert.equal(r.root.findAllByType('svg')[1].findAllByType('circle').length,40);assert.ok(r.root.findAllByType('title').every(t=>t.children.length===1&&typeof t.children[0]==='string'));
    const actual=r.root.findAllByType('i').map(n=>Number(n.props.style.width.replace('%',''))),metrics=report.stories[0].metrics;assert.deepEqual(actual,metrics.map(m=>100*m.value/Math.max(...metrics.map(m=>m.value))));assert.ok(r.root.findAllByType('a').some(a=>a.props.href==='#source-fit-results'));assert.ok(r.root.findAllByType('a').some(a=>a.props.href==='#paper-coordinate-results'));assert.equal(r.root.findAllByType('canvas').length,0);
  }finally{if(r)act(()=>r.unmount());globalThis.fetch=previous;}
});
test('the small result manifest and every evidence download bind actual immutable reports and packages',async()=>{
  const sha=b=>createHash('sha256').update(b).digest('hex');for(const input of report.inputs)assert.equal(sha(await readFile(f('../../'+input.path))),input.sha256);
  for(const c of [...report.stories,...report.secondary]){const b=await readFile(f('../public'+c.package_url));assert.equal(b.length,c.package_bytes);assert.equal(sha(b),c.package_sha256);}
});
test('primary hybrid, variation and CPU fragments do not accidentally mount the unrelated supplementary research bundle',async()=>{
  const out=fileURLToPath(f('../node_modules/.cache/gugis-tests/result-group-routing.mjs'));await bundleWorkspaceModule(fileURLToPath(f('../src/compare/EvidenceDisclosure.tsx')),out);const {evidenceGroupForHash}=await import(pathToFileURL(out).href);
  for(const hash of ['#source-fit-results','#source-fit-evidence','#source-query-results','#source-query-evidence','#hybrid-source-results','#hybrid-source-evidence','#variable-curvature-results','#native-query-repeat','#native-query-statistics','#paper-adaptive-results','#paper-frontier-results','#paper-frontier-evidence','#paper-coordinate-results','#paper-coordinate-evidence','#paper-projection-evidence','#diagonal-hybrid-results','#diagonal-hybrid-evidence'])assert.equal(evidenceGroupForHash(hash),null);
  assert.equal(evidenceGroupForHash('#hybrid-terrain-lab'),'supplementary');assert.equal(evidenceGroupForHash('#gugis-function-results'),'functions');
});
