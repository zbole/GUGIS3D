import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
import React from 'react';
import {act,create} from 'react-test-renderer';
import {bundleWorkspaceModule} from './bundleWorkspaceModule.mjs';
const f=p=>new URL(p,import.meta.url),text=n=>typeof n==='string'?n:(n?.children??[]).map(text).join(''),out=fileURLToPath(f('../node_modules/.cache/gugis-tests/validated-advantage-summary.mjs'));
await bundleWorkspaceModule(fileURLToPath(f('../src/compare/ValidatedAdvantageSummary.tsx')),out);
const Card=(await import(pathToFileURL(out).href)).default,report=JSON.parse(await readFile(f('../../shared/validated-advantages-v1.json')));
test('results-first overview shows four distinct verified benefits, baseline units, exact ratios and working evidence links without model fetches',()=>{
  const previous=globalThis.fetch;let r;try{globalThis.fetch=()=>assert.fail('Headline view must not fetch a model');act(()=>r=create(React.createElement(Card)));assert.equal(r.root.findAllByType('article').length,4);assert.equal(r.root.findAllByProps({className:'va-number'}).map(text).join('|'),'99.88%|80.5%|32.6%|1.37×');assert.match(text(r.toJSON()),/精确 P2 控制/);assert.match(text(r.toJSON()),/未运行 ArcGIS 软件/);assert.match(text(r.toJSON()),/耗时中位数之比/);assert.match(text(r.toJSON()),/城市切换不会改变/);assert.equal(r.root.findAllByType('canvas').length,0);
    for(const c of report.claims){const article=r.root.findByProps({'data-claim':c.id});assert.equal(article.findAllByType('a')[0].props.href,c.detail_href);assert.equal(article.findAllByType('a')[1].props.href,c.package_url);assert.equal(article.findByType('i').props.style.width,`${100*c.gugis_metric/c.baseline_metric}%`);}
  }finally{if(r)act(()=>r.unmount());globalThis.fetch=previous;}
});
test('every overview input and download binds the actual immutable bytes',async()=>{const sha=b=>createHash('sha256').update(b).digest('hex');for(const e of report.inputs)assert.equal(sha(await readFile(f('../../'+e.path))),e.sha256);for(const c of report.claims){const b=await readFile(f('../public'+c.package_url));assert.equal(b.length,c.package_bytes);assert.equal(sha(b),c.package_sha256);}});
