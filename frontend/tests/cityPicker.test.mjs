import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fileURLToPath,pathToFileURL} from 'node:url';
import React from 'react';
import {act,create} from 'react-test-renderer';
import {bundleWorkspaceModule} from './bundleWorkspaceModule.mjs';
const f=p=>new URL(p,import.meta.url),out=fileURLToPath(f('../node_modules/.cache/gugis-tests/city-picker.mjs'));
await bundleWorkspaceModule(fileURLToPath(f('../src/studio/CityPicker.tsx')),out);
const {default:Picker,filterCityChoices}=await import(pathToFileURL(out).href);
const cities=JSON.parse(await readFile(f('../../shared/city-workspaces.json'))),terrainCities=JSON.parse(await readFile(f('../../shared/public-terrain-sources-v9.json'))).sources.map(s=>s.city_id);
const text=n=>typeof n==='string'?n:(n?.children??[]).map(text).join('');
test('Chinese, case-insensitive English and full-width search combine with actual DTM coverage',()=>{
  assert.deepEqual(filterCityChoices(cities,'  ＥＸＥＴＥＲ ','all',[],terrainCities).map(c=>c.id),['exeter']);
  assert.deepEqual(filterCityChoices(cities,'纽卡','all',[],terrainCities).map(c=>c.id),['newcastle']);
  assert.equal(filterCityChoices(cities,'edinburgh','terrain',[],terrainCities).length,0);
  assert.equal(filterCityChoices(cities,'','terrain',[],terrainCities).length,14);
  assert.deepEqual(filterCityChoices(cities,'','selected',['london','exeter'],terrainCities).map(c=>c.id),['london','exeter']);
});
test('searching and filtering keeps chosen workspaces intact, removal is explicit and resetting an empty result recovers every city',()=>{
  const old=globalThis.fetch;const changes=[];let r;
  try{
    globalThis.fetch=()=>assert.fail('Picker must not fetch or initialize a city');
    act(()=>r=create(React.createElement(Picker,{cities,selected:['london','exeter'],multiple:true,terrainCities,onSelect:id=>changes.push(id)})));
    const search=r.root.findByType('input');act(()=>search.props.onChange({target:{value:'edinburgh'}}));assert.equal(r.root.findAllByProps({className:'city-picker-option'}).length,1);assert.equal(r.root.findByProps({className:'city-picker-chips'}).findAllByType('button').length,2);assert.equal(changes.length,0);
    act(()=>r.root.findAllByType('button').find(b=>text(b).startsWith('已核验 DTM')).props.onClick());assert.match(text(r.toJSON()),/没有匹配城市/);assert.equal(changes.length,0);
    act(()=>r.root.findByProps({'aria-label':'取消选择伦敦'}).props.onClick());assert.deepEqual(changes,['london']);
    act(()=>r.root.findByProps({className:'city-picker-reset'}).props.onClick());assert.equal(r.root.findAllByProps({className:'city-picker-option'}).length,16);assert.equal(search.props.value,'');
    act(()=>r.root.findByProps({'aria-label':'选择埃克塞特'}).props.onClick());assert.deepEqual(changes,['london','exeter']);
  }finally{if(r)act(()=>r.unmount());globalThis.fetch=old;}
});
test('invalid city cannot be entered and disabled state blocks every selector while preserving current city',()=>{
  let r;try{
    act(()=>r=create(React.createElement(Picker,{cities:[{...cities[0],status:'invalid'},cities[1]],selected:['london'],onSelect:()=>assert.fail('must not select'),disabled:true})));
    assert.ok(r.root.findAllByType('button').every(b=>b.props.disabled));assert.equal(r.root.findByType('input').props.disabled,true);assert.match(text(r.toJSON()),/当前城市伦敦/);assert.match(text(r.toJSON()),/数据异常/);
  }finally{if(r)act(()=>r.unmount());}
});
