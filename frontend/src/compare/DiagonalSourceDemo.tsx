import {useEffect,useMemo,useState} from 'react';
import {loadDiagonalSourceModel,inspectDiagonalGrid} from './loadDiagonalSourceModel';
import {loadHybridSourceModel} from './loadHybridSourceModel';
import {loadSourceModel} from './loadSourceModel';
import {prepareSourceBandQuery,prepareRegularGridQuery,type SourceBandModel,type RegularHeightGrid} from './sourceRuledBandMath';
export type DiagonalReceipt={method:string;binary_filename:string;binary_bytes:number;binary_sha256:string;nx:number;ny:number;ruled_cells:number;minus_cells:number;plus_cells:number;p1_triangles:number;stored_points:number;e2_m2:number;continuous_bound_m:number;previous:boolean};
export type DiagonalSite={id:string;name:string;origin_bng:number[];regular_grid:{url:string;bytes:number;sha256:string};models:Record<string,DiagonalReceipt>;byte_pairs:{byte_ceiling:number;'p1-local':string|null;'hybrid-local':string|null;prior:Record<string,string|null>}[];target_pairs:{height_target_m:number;'p1-local':string|null;'hybrid-local':string|null;prior:Record<string,string|null>}[]};
const coordinates=Array.from({length:17},(_,i)=>Number((-32+(i+.5)*64/17).toFixed(2)));
const familyColours={ruled:'#348d74',minus:'#7494b1',plus:'#bd8853'};
function colour(value:number,scale:number){const t=Math.min(1,Math.abs(value)/scale),zero=[248,250,247],end=value<0?[94,142,174]:[190,113,72];return `rgb(${zero.map((v,i)=>Math.round(v+(end[i]-v)*t)).join(',')})`;}
export default function DiagonalSourceDemo({site,entries}:{site:DiagonalSite;entries:{label:string;model:DiagonalReceipt}[]}){
  const [loaded,setLoaded]=useState<{models:SourceBandModel[];grid:RegularHeightGrid;key:string;siteId:string}|null>(null),[error,setError]=useState(''),[retry,setRetry]=useState(0),[x,setX]=useState(.27),[y,setY]=useState(-1.41);
  const key=entries.map(e=>e.model.binary_sha256).join(',');
  useEffect(()=>{const controller=new AbortController();setLoaded(null);setError('');
    Promise.all([Promise.all(entries.map(({model:e})=>(e.previous?loadHybridSourceModel:loadDiagonalSourceModel)(`/research/${e.previous?'hybrid-source-v1':'diagonal-hybrid-v1'}/${site.id}/${e.binary_filename}`,e.binary_bytes,e.binary_sha256,site.origin_bng,controller.signal))),loadSourceModel(site.regular_grid.url,site.regular_grid.bytes,site.regular_grid.sha256,site.origin_bng,controller.signal)]).then(([models,source])=>{
      if(source.kind!=='grid')throw new Error('对角线对照的源高程格类型不符');
      models.forEach((model,i)=>{const e=entries[i].model,s=inspectDiagonalGrid(model,e.nx,e.ny);if(s.ruled!==e.ruled_cells||s.minus!==e.minus_cells||s.plus!==e.plus_cells)throw new Error('实际原生单元类型与结果收据不符');});
      if(!controller.signal.aborted)setLoaded({models,grid:source.model,key,siteId:site.id});
    }).catch(e=>{if(!controller.signal.aborted)setError(e instanceof Error?e.message:'对角线模型读取失败');});
    return()=>controller.abort();
  },[site.id,key,retry]);
  const ready=loaded?.key===key&&loaded.siteId===site.id?loaded:null;
  const functions=useMemo(()=>ready?.models.map(prepareSourceBandQuery)??null,[ready]),source=useMemo(()=>ready?prepareRegularGridQuery(ready.grid):null,[ready]);
  const structures=useMemo(()=>ready?.models.map((m,i)=>inspectDiagonalGrid(m,entries[i].model.nx,entries[i].model.ny))??[],[ready]);
  const maps=useMemo(()=>functions&&source?functions.map(fn=>coordinates.flatMap((yy,j)=>coordinates.map((xx,i)=>({x:xx,y:yy,i,j,delta:fn.query(xx,yy)!.height-source.query(xx,yy)!.height})))):[],[functions,source]);
  const scale=Math.max(.001,...maps.flatMap(m=>m.map(p=>Math.abs(p.delta))));
  if(error)return <p role="alert">{error} <button onClick={()=>setRetry(v=>v+1)}>重试对角线原生模型</button></p>;
  if(!ready||!functions||!source)return <p role="status">正在校验已保存模型、两种对角线和原始 Float32 源高程格…</p>;
  const reference=source.query(x,y)!;
  return <div className="ds-demo"><div className="pr-query-controls">{(['X','Y'] as const).map((name,i)=><label key={name}>同一局部 {name} / m<input type="range" aria-label={`双对角线同步查询${name}`} min="-31.9" max="31.9" step=".01" value={i?y:x} onChange={e=>(i?setY:setX)(Number(e.target.value))}/><output>{(i?y:x).toFixed(2)}</output></label>)}</div><p>同一点 · BNG E {reference.easting.toFixed(2)} / N {reference.northing.toFixed(2)} m · 原始源函数 Z {reference.height.toFixed(6)} m ODN</p><div className="ds-native-models">{entries.map(({label,model:e},index)=>{
    const s=structures[index],q=functions[index].query(x,y)!,dx=320/e.nx,dy=320/e.ny;
    return <article key={e.method}><h3>{label}</h3><p>{e.binary_bytes.toLocaleString()} B · {e.nx} × {e.ny} 网格</p><svg className="ds-family-map" viewBox="0 0 340 360" role="img" aria-label={`${label}真实文件的直纹面与两种对角线分布`}>{s.runs.map((r,i)=><rect key={i} data-family={r.kind} x={10+dx*r.i} y={10+320-dy*(r.j+1)} width={dx*r.length} height={dy} fill={familyColours[r.kind]} stroke="white" strokeWidth=".4"/>)}{e.nx*e.ny<=256&&s.cells.map((kind,i)=>kind==='ruled'?null:<line key={i} x1={10+dx*(i%e.nx)} x2={10+dx*(i%e.nx+1)} y1={10+320-dy*(Math.floor(i/e.nx)+(kind==='minus'?1:0))} y2={10+320-dy*(Math.floor(i/e.nx)+(kind==='minus'?0:1))} stroke="white" strokeWidth=".7"/>)}<text x="10" y="349">绿：直纹面 · 蓝 / 铜：两种三角带</text></svg><p>{s.ruled} 直纹单元 · {s.minus} 负向 / {s.plus} 正向对角线单元</p><p className="ds-query-value">Z {q.height.toFixed(6)} m<br/>与源函数 Δz {(1000*(q.height-reference.height)).toFixed(3)} mm<br/>坡度 {(Math.atan(Math.hypot(...q.gradient))*180/Math.PI).toFixed(4)}°</p><svg className="ds-error-map" viewBox="0 0 300 300" role="img" aria-label={`${label}同色标源函数误差热图，点击同步查询点`}>{maps[index].map(p=><rect key={p.i+17*p.j} data-x={p.x} data-y={p.y} data-delta={p.delta} x={27+14.4*p.i} y={12+14.4*(16-p.j)} width="14.45" height="14.45" fill={colour(p.delta,scale)} onClick={()=>{setX(p.x);setY(p.y);}}><title>{`X ${p.x.toFixed(2)} / Y ${p.y.toFixed(2)} m · Δz ${(1000*p.delta).toFixed(4)} mm`}</title></rect>)}<circle cx={27+244.8*(x+32)/64} cy={12+244.8*(32-y)/64} r="4" fill="none" stroke="#193f37" strokeWidth="1.5" pointerEvents="none"/><text className="ds-heat-scale" x="27" y="278">统一色标 ±{(1000*scale).toFixed(3)} mm</text><text x="27" y="295">蓝：模型较低 · 白：接近 · 铜：较高</text></svg></article>;
  })}</div><p>类型图直接读取已保存原生记录；每次方向切换产生的分组和索引都计入文件。热图使用同一组 289 个源单元内部点和同一色标；点击色块或使用上方滑块同步查询所有模型。它是可交互的误差示例，完整 E₂ 与最大误差来自全域积分和极值核验。C⁰ 边界连续，梯度仍可跳变。</p></div>;
}
