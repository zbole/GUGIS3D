import {useEffect,useMemo,useRef,useState} from 'react';
import models from '../../../shared/bristol-viewer-models.json';
import CityScene,{type CitySceneHandle} from '../studio/CityScene';
import type {Terrain} from '../studio/environment';
import type {TerrainHit} from '../studio/terrainMath';
import {researchTerrainMeshes} from './researchTerrainMesh';
import {loadBristolResearchTerrain} from './loadResearchTerrain';
import './hybridTerrainLab.css';

type Record=(typeof models.models)[number];
type Loaded={key:string;receipt:Record;terrain:Terrain};
const labels={local_compact:'新局部紧凑混合',global_compact:'原全局紧凑混合',local_triangles:'局部三角带'};
const ignoreSelection=()=>{};
export default function BristolTerrainViewer({target}:{target:number}){
  const [caseId,setCaseId]=useState('bristol-harbour');
  const [family,setFamily]=useState<keyof typeof labels>('local_compact');
  const [loaded,setLoaded]=useState<Loaded|null>(null),[error,setError]=useState(''),[attempt,setAttempt]=useState(0);
  const [wire,setWire]=useState(true),[hit,setHit]=useState<TerrainHit|null>(null);
  const [sceneRevision,setSceneRevision]=useState(0);
  const scene=useRef<CitySceneHandle>(null);
  const receipt=models.models.find(m=>m.case_id===caseId&&m.family===family&&m.target_m===target);
  const key=receipt?`${receipt.case_id}/${receipt.sha256}`:'';
  useEffect(()=>{
    let active=true;const controller=new AbortController();
    setError('');setHit(null);
    if(!receipt){setError('当前目标无已核验三维模型；不能借用其他档位。');return;}
    const timeout=setTimeout(()=>controller.abort(),20000);
    loadBristolResearchTerrain(`/research/bristol-viewer/models/${receipt.case_id}/${receipt.filename}`,receipt.bytes,receipt.sha256,controller.signal)
      .then(terrain=>{if(active)setLoaded({key,receipt,terrain});})
      .catch(e=>{if(active)setError(controller.signal.aborted?'模型加载超时，可重试。':e instanceof Error?e.message:'模型读取失败。');})
      .finally(()=>clearTimeout(timeout));
    return()=>{active=false;controller.abort();clearTimeout(timeout);};
  },[key,attempt]);
  const ready=!!loaded&&loaded.key===key&&!error;
  const display=useMemo(()=>loaded?{...loaded.terrain,longitude:0,latitude:0}:null,[loaded]);
  const prepared=useMemo(()=>{
    if(!display||!loaded)return null;
    try{return {result:researchTerrainMeshes(display,Math.max(.0025,loaded.receipt.target_m/4),100000,true),error:''};}
    catch(e){return {result:null,error:e instanceof Error?e.message:'显示模型构建失败。'};}
  },[display,loaded]);
  const city=useMemo(()=>display?{assets:{},instances:[],roads:[],environment:{version:'1.0' as const,terrain:display,
    feature_assets:{},features:[],drape_buildings:false}}:null,[display]);
  return <section className="hybrid-live-view" aria-labelledby="bristol-viewer-title">
    <h4 id="bristol-viewer-title">真实样区 · 局部三维结构对照</h4>
    <div className="hybrid-live-controls"><label>样区<select aria-label="Bristol 三维研究样区" value={caseId} onChange={e=>setCaseId(e.target.value)}>
      <option value="bristol-harbour">布里斯托港区</option><option value="bristol-brandon-hill">布兰登山坡</option></select></label>
      <label>表示<select aria-label="Bristol 三维研究表示" value={family} onChange={e=>setFamily(e.target.value as keyof typeof labels)}>
        {Object.entries(labels).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
      <button onClick={()=>scene.current?.reset()} disabled={!loaded}>恢复样区视角</button><button onClick={()=>scene.current?.top()} disabled={!loaded}>俯视原生拓扑</button>
      <label><input type="checkbox" checked={wire} onChange={e=>setWire(e.target.checked)}/>Bristol 原生边界与母线</label></div>
    <p className="hybrid-live-note">英国国家格网偏移按 1:1 放在抽象局部参考架中；不进行城市地理配准或 ODN／椭球高转换。X/Y/Z 和原生面函数保留，显示高程减去同样区参考值；垂直比例 1×。</p>
    {!ready&&!error&&<p role="status">正在读取和校验所选模型 SHA-256…{loaded?'当前仍显示下方标注的旧模型，查询暂时关闭。':''}</p>}
    {error&&<div role="alert"><p>{error}{loaded?' 下方保留上一份已核验模型；不会冒充新结果。':''}</p><button onClick={()=>setAttempt(n=>n+1)}>重试 Bristol 三维模型</button></div>}
    {prepared?.error&&<p role="alert">{prepared.error}</p>}
    {city&&prepared?.result&&<div className="hybrid-live-canvas"><CityScene key={sceneRevision} ref={scene} city={city} center={{longitude:0,latitude:0}}
      selected={null} onSelect={ignoreSelection} context={false} showBuildings={false} showGround={false} fullDetails={false} scenePurpose="research"
      terrainMeshes={prepared.result.meshes} terrainWire={wire} queryTerrain={ready} onTerrainQuery={ready?setHit:undefined}
      onRetry={()=>{setHit(null);setSceneRevision(n=>n+1);}}/></div>}
    {loaded&&prepared?.result&&<p className="hybrid-live-note" aria-label="当前已核验 Bristol 三维模型">当前显示：{loaded.receipt.case_name} · {labels[loaded.receipt.family as keyof typeof labels]} · 原目标 {loaded.receipt.target_m*100} cm · {loaded.receipt.points.toLocaleString()} 控制点 · {(loaded.receipt.bytes/1000).toFixed(2)} kB。原生参考界 {(loaded.receipt.continuous_bound_m*100).toFixed(3)} cm；显示离散另加最多 {(prepared.result.displayBound*100).toFixed(3)} cm，二者叠加 {(100*(loaded.receipt.continuous_bound_m+prepared.result.displayBound)).toFixed(3)} cm。显示离散不改变原生查询或研究文件成本。</p>}
    <div className="hybrid-live-query" aria-live="polite">{hit&&ready?<><strong>{hit.kind==='ruled-strip'?'直纹面带':'三角带'} · {hit.patch}</strong><span>BNG 偏移 x {hit.x.toFixed(2)} / y {hit.y.toFixed(2)} m</span>
      <span>ODN 高程 {hit.height.toFixed(4)} m</span><span>坡度 {hit.slope.toFixed(3)}° · 坡向 {hit.aspect===null?'平坦':`${hit.aspect.toFixed(2)}°`}（格网北）</span><span>u / v：{hit.u.toFixed(3)} / {hit.v.toFixed(3)}</span></>:<span>拖动、缩放或俯视；点击表面读取原生面带、高程、坡度和 u/v。未配准真实城市，无正式数据写入。</span>}</div>
    <p className="hybrid-live-note">切换表示时保留三维 Viewer 和镜头；只在新档案长度、哈希通过后替换模型。加载失败或切换期间不返回旧模型的查询结果。绿色为直纹面、灰色为三角带，金色为母线；坡度在接缝取命中的一侧，不保证 C1 连续。</p>
  </section>;
}
