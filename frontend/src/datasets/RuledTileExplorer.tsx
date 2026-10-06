import {useEffect,useRef,useState} from 'react';
import report from '../../../shared/ruled-terrain-tiles-v1.json';
import {createRuledTileQuery} from './ruledTileQuery';
import {useComparisonAnchor} from '../compare/useComparisonAnchor';
import './RuledTileExplorer.css';
const base='/research/ruled-terrain-tiles-v1/';
type Manager=ReturnType<typeof createRuledTileQuery>;
type Point=NonNullable<Awaited<ReturnType<Manager['query']>>>;
function QueryView(){
  const managerRef=useRef<Manager|null>(null),[x,setX]=useState(.27),[y,setY]=useState(.41),[point,setPoint]=useState<Point|null>(null),[error,setError]=useState(''),[retry,setRetry]=useState(0),[stats,setStats]=useState({ready_tiles:0,ready_file_bytes:0,requests:0,validated_file_bytes:0,limit:8});
  // Allocate in effect setup so development StrictMode can dispose and recreate
  // the manager without retaining an already-disposed useMemo value.
  useEffect(()=>{const manager=createRuledTileQuery(report);managerRef.current=manager;return()=>{if(managerRef.current===manager)managerRef.current=null;manager.dispose();};},[]);
  useEffect(()=>{const manager=managerRef.current;if(!manager)return;const abort=new AbortController();setPoint(null);setError('');
    manager.query(report.origin_bng[0]+x,report.origin_bng[1]+y,abort.signal).then(result=>{if(!abort.signal.aborted){setPoint(result);setStats(manager.stats());}}).catch(e=>{if(!abort.signal.aborted)setError(e instanceof Error?e.message:'原生瓦片查询失败');});return()=>abort.abort();
  },[x,y,retry]);
  const row=Math.max(0,Math.min(7,Math.ceil((y+256)/64)-1)),column=Math.max(0,Math.min(7,Math.ceil((x+256)/64)-1)),selected=report.tiles[row*8+column],min=Math.min(...report.tiles.map(t=>t.height_mean_m)),max=Math.max(...report.tiles.map(t=>t.height_mean_m));
  return <div className="rt-query">
    <div className="rt-grid" role="group" aria-label="选择原始一米面带瓦片">{[...report.tiles].sort((a,b)=>b.row-a.row||a.column-b.column).map(t=><button key={t.id} type="button" aria-label={'选择面带瓦片 '+t.id} aria-pressed={selected.id===t.id} style={{backgroundColor:'hsl(155 25% '+(88-22*(t.height_mean_m-min)/(max-min||1))+'%)'}} onClick={()=>{setX(t.origin_bng[0]-report.origin_bng[0]);setY(t.origin_bng[1]-report.origin_bng[1]);}} title={'64 × 64 m；源高程 '+t.height_min_m.toFixed(2)+'–'+t.height_max_m.toFixed(2)+' m'}>{t.row+1}·{t.column+1}</button>)}</div>
    <div className="rt-query-result"><p className="rt-map-note">↑ 北 · 颜色为瓦片源节点平均高程概览</p>
      <div className="rt-controls">{(['X','Y'] as const).map((name,i)=><label key={name}>相对中心 {name} / m<input type="range" aria-label={'一米瓦片查询'+name} min="-256" max="256" step=".01" value={i?y:x} onChange={e=>(i?setY:setX)(Number(e.target.value))}/><output>{(i?y:x).toFixed(2)}</output></label>)}</div>
      {error?<p role="alert">{error} <button onClick={()=>setRetry(v=>v+1)}>重试瓦片查询</button></p>:!point?<p role="status">正在校验命中瓦片并执行原生函数查询…</p>:<div className="rt-point" aria-live="polite"><strong>{point.height.toFixed(9)} <small>m ODN</small></strong><p>BNG E {point.easting.toFixed(2)} / N {point.northing.toFixed(2)} m</p><p>坡度 {(Math.atan(Math.hypot(...point.gradient))*180/Math.PI).toFixed(6)}° · 原生面带 {point.patch+1} / 区段 {(point.segment??0)+1}</p><p>命中 {point.tile_id} · 64 × 64 m · 原始 1 m 源单元函数</p></div>}
      <div className="rt-cache"><span>当前缓存关联文件 <strong>{stats.ready_tiles} / 64</strong></span><span>关联原生文件 <strong>{(stats.ready_file_bytes/1000).toFixed(2)} kB</strong></span><span>完整原生瓦片合计 <strong>{(report.total_tile_bytes/1e6).toFixed(2)} MB</strong></span></div>
      <p className="rt-map-note">按命中范围读取，最多缓存 8 个准备好的瓦片。数值显示关联文件字节，并非执行系数缓存、浏览器内存或显存测量；边界高程连续，法向导数可能跳变。</p>
    </div>
  </div>;
}
export default function RuledTileExplorer(){
  useComparisonAnchor('ruled-terrain-tiles');
  const [open,setOpen]=useState(()=>typeof window!=='undefined'&&window.location?.hash==='#ruled-terrain-tiles');
  return <section id="ruled-terrain-tiles" className="rt-explorer" aria-labelledby="rt-title">
    <div className="rt-heading"><div><span>原始分辨率 / 函数面带 / 有界加载</span><h3 id="rt-title">512 米真实地形，按需读取一米面带。</h3><p>曼彻斯特中心局部 512 × 512 m · 263,169 个原始源高程点 · 64 个原生瓦片。保留逐格双线性函数；源函数一致性不是独立实测地面精度。</p></div><button aria-label="展开一米面带瓦片查询" aria-expanded={open} onClick={()=>setOpen(v=>!v)}>{open?'收起一米面带查询':'打开一米面带查询'}</button></div>
    {open&&<QueryView/>}
    <div className="rt-downloads"><a download href={base+report.source_geotiff.filename}>原始像素 GeoTIFF · {(report.source_geotiff.bytes/1e6).toFixed(2)} MB ↓</a><a download href={base+report.package.filename}>全部原生瓦片与证据 ZIP ↓</a><a download href={base+'publication.json'}>完整瓦片清单 ↓</a><a download href={base+'native-audit.json'}>原生函数与接缝核验 ↓</a></div>
    <details><summary>覆盖、接缝与来源证据</summary><p>范围为固定中心样区，不是全城覆盖。原始 1 m Float32 像元保持不变；GeoTIFF 像素面积覆盖 513 × 513 m，函数域为源像素中心之间的 512 × 512 m。完整文件保留坐标与原生面带，查询不需要先生成三角网。</p><p>{report.audit_summary.total_internal_queries.toLocaleString()} 次内部查询、{report.audit_summary.total_source_node_queries.toLocaleString()} 次源节点查询；接缝检查 {report.audit_summary.seam_midpoint_pairs.toLocaleString()} 个中点与 {report.audit_summary.seam_source_node_pairs.toLocaleString()} 个源节点。接缝高程和沿边导数一致；这些是 Float64 数值核验，不是区间算术证明。</p><p>{report.source_identity.attribution} <a href={report.source_identity.dataset_url} target="_blank" rel="noreferrer">英国环境署数据源</a> · <a href={report.source_identity.license_url} target="_blank" rel="noreferrer">OGL v3</a>。{report.source_identity.unit_metadata_warning}</p><p>这里不声称优于规则栅格、ArcGIS 软件性能或运行内存。文件 SHA-256 {report.report_sha256}<br/>ZIP SHA-256 {report.package.sha256}</p></details>
  </section>;
}
