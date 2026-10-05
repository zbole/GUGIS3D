import {useEffect,useMemo,useRef,useState} from 'react';
import catalogue from '../../../shared/public-terrain-sources.json';
import CityScene,{type CitySceneHandle} from '../studio/CityScene';
import type {Terrain} from '../studio/environment';
import type {TerrainHit} from '../studio/terrainMath';
import {loadPublicTerrain} from './loadPublicTerrain';
import {boundedTerrainDisplay} from './boundedTerrainDisplay';

const ignore=()=>{};
export default function PublicTerrainViewer({cityId}:{cityId:string}){
  const [loaded,setLoaded]=useState<{cityId:string;terrain:Terrain}|null>(null),[error,setError]=useState(''),[retry,setRetry]=useState(0);
  const [wire,setWire]=useState(true),[hit,setHit]=useState<TerrainHit|null>(null),[sceneRevision,setSceneRevision]=useState(0);
  const scene=useRef<CitySceneHandle>(null),source=catalogue.sources.find(s=>s.city_id===cityId);
  useEffect(()=>{
    let active=true;const controller=new AbortController();setLoaded(null);setError('');setHit(null);
    const timer=setTimeout(()=>controller.abort(),30000);
    loadPublicTerrain(cityId,controller.signal,import.meta.env.VITE_API_BASE_URL??'/api').then(terrain=>{if(active)setLoaded({cityId,terrain});})
      .catch(cause=>{if(active)setError(controller.signal.aborted?'读取超时，可重试。':cause instanceof Error?cause.message:'地形读取失败。');}).finally(()=>clearTimeout(timer));
    return()=>{active=false;controller.abort();clearTimeout(timer);};
  },[cityId,retry]);
  const display=useMemo(()=>loaded&&loaded.cityId===cityId?{...loaded.terrain,longitude:0,latitude:0}:null,[loaded,cityId]);
  const prepared=useMemo(()=>{
    if(!display)return null;
    try{return {result:boundedTerrainDisplay(display),error:''};}catch(cause){return {result:null,error:cause instanceof Error?cause.message:'显示构建失败。'};}
  },[display]);
  const city=useMemo(()=>display?{assets:{},instances:[],roads:[],environment:{version:'1.0' as const,terrain:display,feature_assets:{},features:[],drape_buildings:false}}:null,[display]);
  return <section className="dataset-viewer" aria-label="只读真实地形三维预览">
    <div className="dataset-viewer-controls"><strong>原生面带 · 独立三维预览</strong><button onClick={()=>scene.current?.reset()} disabled={!city}>恢复视角</button><button onClick={()=>scene.current?.top()} disabled={!city}>俯视拓扑</button><label><input type="checkbox" checked={wire} onChange={e=>setWire(e.target.checked)}/>命中面带的边界与母线</label></div>
    {!loaded&&!error&&<p role="status">正在读取当前城市、核对文件长度与 SHA-256…</p>}
    {error&&<div role="alert"><p>{error}</p><button onClick={()=>setRetry(n=>n+1)}>重试公开地形</button></div>}
    {prepared?.error&&<p role="alert">{prepared.error}</p>}
    {city&&prepared?.result&&<div className="dataset-viewer-canvas"><CityScene key={sceneRevision} ref={scene} city={city} center={{longitude:0,latitude:0}} selected={null} onSelect={ignore} context={false} showBuildings={false} showGround={false} fullDetails={false} scenePurpose="research" terrainMeshes={prepared.result.meshes} terrainWire={wire&&!!hit} terrainTopologyPatch={hit?.patch} queryTerrain onTerrainQuery={setHit} onRetry={()=>{setHit(null);setSceneRevision(n=>n+1);}}/></div>}
    <div className="dataset-viewer-query" aria-live="polite">{hit&&display?<><strong>{hit.kind==='ruled-strip'?'直纹面带':'三角带'} · {hit.patch}</strong><span>ODN 高程 {hit.height.toFixed(3)} m</span><span>原生坡度 {hit.slope.toFixed(2)}° · 坡向 {hit.aspect===null?'平坦':`${hit.aspect.toFixed(2)}°（局部 ENU 北）`}</span><span>u / v {hit.u.toFixed(3)} / {hit.v.toFixed(3)}</span><span>局部 x / y {hit.x.toFixed(2)} / {hit.y.toFixed(2)} m</span><button type="button" onClick={()=>scene.current?.focusTerrainPatch(hit.patch)}>放大命中面带</button></>:<span>点击地形读取原生面函数。这里没有正式城市对象，不产生草稿或保存记录。</span>}</div>
    {display&&prepared?.result&&<p className="dataset-note">当前 {source?.name} · {display.points.length.toLocaleString()} 控制点 · {prepared.result.vertices.toLocaleString()} 共享显示顶点。显示三角化的参数对应 3D 距离界 ≤ {(Math.ceil(prepared.result.displayDistanceBound*1000)/1000).toFixed(3)} m{prepared.result.capped?'，顶点预算导致未达 0.1 m 显示目标':''}；不是固定位置的高程误差界，也不包括粗预览对源 DTM 的误差。原生查询保留面函数。</p>}
    <p className="dataset-note">原 ENU x/y/z 放在独立局部参考架，显示高程减去参考值，垂直比例 1×；没有 ODN 到椭球高转换。此视图不与城市建筑做空间配准。绿色为直纹面带，灰色为三角带，金色为母线；接缝坡度取命中一侧。</p>
  </section>;
}
