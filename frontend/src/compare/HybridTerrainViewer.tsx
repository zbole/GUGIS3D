import { useEffect, useMemo, useRef, useState } from 'react';
import CityScene, { type CitySceneHandle } from '../studio/CityScene';
import type { Terrain } from '../studio/environment';
import type { TerrainHit } from '../studio/terrainMath';
import { researchTerrainMeshes } from './researchTerrainMesh';
import { loadResearchTerrain } from './loadResearchTerrain';
type Receipt={filename:string;bytes:number;sha256:string;continuous_certificate?:{max_error_bound_m:number}};
const noSelection=()=>{};
export default function HybridTerrainViewer({caseId,target,hybrid,triangles,localTriangles,compactHybrid,referenceHybrid}:{caseId:string;target:number;hybrid:Receipt;triangles:Receipt;localTriangles?:Receipt;compactHybrid?:Receipt;referenceHybrid?:Receipt}){
  const [mode,setMode]=useState<'hybrid'|'triangles'|'local_triangles'|'compact_hybrid'|'reference_hybrid'>(referenceHybrid?'reference_hybrid':'hybrid');
  const [terrain,setTerrain]=useState<Terrain|null>(null);
  const [error,setError]=useState('');
  const [hit,setHit]=useState<TerrainHit|null>(null);
  const [attempt,setAttempt]=useState(0);
  const [wire,setWire]=useState(true);
  const scene=useRef<CitySceneHandle>(null);
  const receipt=mode==='hybrid'?hybrid:mode==='local_triangles'&&localTriangles?localTriangles:mode==='compact_hybrid'&&compactHybrid?compactHybrid:mode==='reference_hybrid'&&referenceHybrid?referenceHybrid:triangles;
  useEffect(()=>{
    const controller=new AbortController();let active=true;
    setTerrain(null);setHit(null);setError('');
    const timeout=setTimeout(()=>controller.abort(),20000);
    loadResearchTerrain(`/research/hybrid-terrain/models/${caseId}/${receipt.filename}`,receipt.bytes,receipt.sha256,controller.signal)
      .then(value=>{if(active)setTerrain(value);})
      .catch(e=>{if(active)setError(controller.signal.aborted?'研究档案加载超时，可重试':e instanceof Error?e.message:'研究档案加载失败');})
      .finally(()=>clearTimeout(timeout));
    return()=>{active=false;controller.abort();clearTimeout(timeout);};
  },[caseId,receipt.filename,receipt.bytes,receipt.sha256,attempt]);
  const prepared=useMemo(()=>{
    if(!terrain)return null;
    try{return {result:researchTerrainMeshes(terrain,Math.max(.01,target/2)),error:''};}
    catch(e){return {result:null,error:e instanceof Error?e.message:'研究显示构建失败'};}
  },[terrain,target]);
  const city=useMemo(()=>terrain?{assets:{},instances:[],roads:[],environment:{version:'1.0' as const,terrain,
    feature_assets:{},features:[],drape_buildings:false}}:null,[terrain]);
  const issue=error||prepared?.error;
  return <div className="hybrid-live-view">
    <div className="hybrid-live-controls"><label>三维查看表示<select aria-label="研究三维表示" value={mode} onChange={e=>setMode(e.target.value as typeof mode)}>
      {referenceHybrid&&<option value="reference_hybrid">参考栅格证书混合 · 新构建</option>}<option value="hybrid">{referenceHybrid?'原采样混合 · 历史记录':'混合表示'}</option><option value="triangles">纯三角面 · 全局网格</option>{localTriangles&&<option value="local_triangles">局部三角剖分 · 更强对照</option>}{compactHybrid&&<option value="compact_hybrid">紧凑混合 · 同一曲面</option>}</select></label>
      <button onClick={()=>scene.current?.reset()} disabled={!terrain}>恢复视角</button><button onClick={()=>scene.current?.top()} disabled={!terrain}>俯视拓扑</button>
      <label><input type="checkbox" checked={wire} onChange={e=>setWire(e.target.checked)}/>显示面带边界与母线</label>
      <span>拖动旋转，滚轮缓速缩放；点击表面读取原生高程与坡度。</span></div>
    {issue?<div role="alert"><p>{issue}</p><button onClick={()=>setAttempt(v=>v+1)}>重试研究视图</button></div>
      :city&&prepared?.result?<div className="hybrid-live-canvas"><CityScene ref={scene} city={city} center={{longitude:0,latitude:0}}
        selected={null} onSelect={noSelection} context={false} showGround={false} fullDetails={false} scenePurpose="research"
        terrainMeshes={prepared.result.meshes} terrainWire={wire} queryTerrain onTerrainQuery={setHit} onRetry={()=>setAttempt(v=>v+1)} /></div>
      :<p role="status">正在读取并核对研究档案 SHA-256…</p>}
    {prepared?.result&&<p className="hybrid-live-note">当前仅加载一份已核验的研究档案。显示顶点 {prepared.result.vertices.toLocaleString()}；直纹面显示离散的高程差上界 {(prepared.result.displayBound*100).toFixed(3)} cm{prepared.result.capped?'（显示预算限制）':''}。显示离散不参与上方原生模型误差或文件大小统计。</p>}
    {prepared?.result&&receipt.continuous_certificate&&<p className="hybrid-live-note">原生参考区域界 {(receipt.continuous_certificate.max_error_bound_m*100).toFixed(3)} cm；叠加显示离散后的保守参考界 {((receipt.continuous_certificate.max_error_bound_m+prepared.result.displayBound)*100).toFixed(3)} cm。点击查询仍使用原生面函数。</p>}
    <div className="hybrid-live-query" aria-live="polite">{hit?<>
      <strong>{hit.kind==='ruled-strip'?'直纹面':'三角面'} · {hit.patch}</strong><span>x {hit.x.toFixed(2)} m / y {hit.y.toFixed(2)} m</span>
      <span>高程 {hit.height.toFixed(4)} m</span><span>坡度 {hit.slope.toFixed(3)}° / 坡向 {hit.aspect===null?'平坦':`${hit.aspect.toFixed(2)}°`}</span>
    </>:<span>点击三维表面核查函数求值；这里的局部坐标属于研究样本。</span>}</div>
  </div>;
}
