import test from 'node:test';
import assert from 'node:assert/strict';
import {readTerrainResultLink,terrainResultUrl} from '../src/compare/terrainResultLink.ts';
test('result links recover a scoped sample and the exact target',()=>{
  assert.deepEqual(readTerrainResultLink({search:'?terrain_scope=cambridge&terrain_target=0.25&terrain_site=cambridge-north-quarter',hash:'#cambridge-terrain-results'}),{scope:'cambridge',target:.25,site:'cambridge-north-quarter'});
  assert.deepEqual(readTerrainResultLink({hash:'#oxford-terrain-results'}),{scope:'oxford',target:.1,site:null});
});
test('explicit experiment hash wins and cannot use another experiment sample',()=>{
  assert.deepEqual(readTerrainResultLink({search:'?terrain_scope=cambridge&terrain_site=cambridge-centre&terrain_target=0.5',hash:'#oxford-terrain-results'}),{scope:'oxford',target:.5,site:null});
  assert.deepEqual(readTerrainResultLink({search:'?terrain_scope=__proto__&terrain_target=Infinity&terrain_site=../fixture',hash:'#unknown-terrain-results'}),{scope:'bristol',target:.1,site:null});
});
test('updating results preserves workspace and unrelated options while removing stale samples',()=>{
  const initial='http://127.0.0.1:5173/compare?city=london&cities=london,bristol&view_mode=tiles&tile_profile=economy&note=hello&terrain_site=cambridge-centre#paper-results';
  const url=new URL(terrainResultUrl(initial,{scope:'oxford',target:.25,site:'oxford-north-quarter'}));
  assert.equal(url.pathname,'/compare');assert.equal(url.searchParams.get('city'),'london');
  assert.equal(url.searchParams.get('cities'),'london,bristol');assert.equal(url.searchParams.get('note'),'hello');
  assert.equal(url.searchParams.get('tile_profile'),'economy');assert.equal(url.hash,'#oxford-terrain-results');
  assert.deepEqual(readTerrainResultLink(url),{scope:'oxford',target:.25,site:'oxford-north-quarter'});
  const bristol=new URL(terrainResultUrl(url.href,{scope:'bristol',target:.5,site:null}));
  assert.equal(bristol.searchParams.has('terrain_site'),false);assert.equal(bristol.hash,'#bristol-terrain-results');
});
test('unsupported targets or incompatible sites cannot be published as result links',()=>{
  assert.throws(()=>terrainResultUrl('http://localhost/compare',{scope:'cambridge',target:.2,site:null}),/Unsupported/);
  assert.throws(()=>terrainResultUrl('http://localhost/compare',{scope:'oxford',target:.1,site:'cambridge-centre'}),/different experiment/);
});

test('Liverpool sample links round trip and incompatible old samples clear',()=>{
  for(const site of ['liverpool-centre','liverpool-north-quarter']){
    const url=new URL(terrainResultUrl('http://localhost/compare?city=liverpool&terrain_site=cambridge-centre',{scope:'liverpool',target:.25,site}));
    assert.deepEqual(readTerrainResultLink(url),{scope:'liverpool',target:.25,site});
    assert.equal(url.searchParams.get('city'),'liverpool');
    assert.equal(url.hash,'#liverpool-terrain-results');
  }
  assert.deepEqual(readTerrainResultLink({search:'?terrain_scope=cambridge&terrain_site=cambridge-centre&terrain_target=.5',hash:'#liverpool-terrain-results'}),{scope:'liverpool',target:.5,site:null});
});
