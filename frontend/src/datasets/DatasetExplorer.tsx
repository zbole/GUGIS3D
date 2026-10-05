import {lazy,Suspense,useEffect,useState} from 'react';
import catalogue from '../../../shared/public-terrain-sources.json';
import workspaces from '../../../shared/city-workspaces.json';
import './DatasetExplorer.css';

const TerrainViewer=lazy(()=>import('./PublicTerrainViewer'));
const known=(value:string|null)=>workspaces.some(c=>c.id===value)?value!:'bristol';
const apiBase=(import.meta.env.VITE_API_BASE_URL??'/api').replace(/\/$/,'');
export default function DatasetExplorer(){
  const [cityId,setCityId]=useState(()=>known(new URLSearchParams(window.location.search).get('dataset'))),[view,setView]=useState(false);
  const workspace=workspaces.find(c=>c.id===cityId)!,source=catalogue.sources.find(s=>s.city_id===cityId);
  useEffect(()=>{document.title='GUGIS3D · 真实地形数据集';const restore=()=>{setCityId(known(new URLSearchParams(window.location.search).get('dataset')));setView(false);};window.addEventListener('popstate',restore);return()=>window.removeEventListener('popstate',restore);},[]);
  function select(next:string){if(next===cityId)return;setView(false);setCityId(next);const url=new URL(window.location.href);url.searchParams.set('dataset',next);url.hash='';window.history.pushState(null,'',url);}
  return <main className="dataset-page">
    <header className="dataset-header"><a href="/" className="dataset-logo">GUGIS<span>3D</span></a><nav aria-label="数据集页面导航"><a href="/compare#paper-results">对比结果</a><a href="/">城市工作台 ↗</a></nav></header>
    <section className="dataset-intro"><span className="dataset-eyebrow">PUBLIC TERRAIN / 城市数据集</span><h1>先看数据，再进入城市。</h1><p>真实裸地源、原生面带与可复核的误差资料。这里只读浏览，不初始化、修改或保存正式城市。</p><div className="dataset-summary"><span><strong>{catalogue.sources.length}</strong> 座城市已取得 DTM</span><span><strong>{(catalogue.sources.reduce((n,s)=>n+s.valid_pixels,0)/1e6).toFixed(2)}</strong> 百万个有效源像元</span><span><strong>1 m</strong> 源分辨率 · 非预览精度</span></div></section>
    <div className="dataset-layout"><aside aria-label="选择公开地形城市"><h2>城市中心样本</h2>{workspaces.map(city=><button key={city.id} type="button" aria-pressed={city.id===cityId} onClick={()=>select(city.id)}><span>{city.name}<small>{city.city_name}</small></span><i>{catalogue.sources.some(s=>s.city_id===city.id)?'已取得':'待取得'}</i></button>)}<p>各地均为局部样本。英国环境署资料不覆盖苏格兰和威尔士，本页不会用英格兰数据代替。</p></aside>
      <section className="dataset-detail" aria-label={`${workspace.name}地形数据详情`}><div className="dataset-heading"><div><span className="dataset-eyebrow">{workspace.city_name.toUpperCase()} / {source?'真实裸地':'待取得资料'}</span><h2>{workspace.name}</h2><p>{workspace.coverage_label}</p></div>{source&&<button className="dataset-primary" type="button" aria-expanded={view} onClick={()=>setView(v=>!v)}>{view?'关闭三维预览':'打开只读三维预览'}</button>}</div>
        {!source?<div className="dataset-pending"><strong>尚无已核验的公开 DTM</strong><p>本城建筑样本工作区已有独立入口。地形资料未取得前，不显示替代数据或虚构精度。</p><a href={`/?city=${cityId}&cities=${cityId}&view_mode=tiles&tile_profile=economy`}>浏览本城建筑样本 ↗</a></div>:<>
          <dl className="dataset-metrics"><div><dt>源栅格 / EPSG:27700</dt><dd>{source.width.toLocaleString()} × {source.height.toLocaleString()}</dd></div><div><dt>高程 / ODN 米</dt><dd>{source.min_height_m.toFixed(2)} – {source.max_height_m.toFixed(2)}</dd></div><div><dt>原生粗预览控制点</dt><dd>{source.preview_points.toLocaleString()}</dd></div><div><dt>{source.sample_audit.requested.toLocaleString()} 点相对源 RMSE</dt><dd>{source.sample_audit.rmse_m.toFixed(3)} m</dd></div><div><dt>抽查最大绝对差</dt><dd className="dataset-error-value">{source.sample_audit.max_absolute_m.toFixed(3)} m</dd></div><div><dt>源像元 / 缺测</dt><dd>{source.valid_pixels.toLocaleString()} / {source.nodata_pixels}</dd></div></dl>
          <div className="dataset-quality"><strong>20 像元采样预览，保持原生函数查询。</strong><p>抽查命中 {source.sample_audit.hits.toLocaleString()} / {source.sample_audit.requested.toLocaleString()}。源 DTM 参与预览构建；这些是相对源栅格的差异，不能作为独立地面精度或连续误差保证。</p></div>
          {view&&<Suspense fallback={<p role="status">正在载入只读三维预览模块…</p>}><TerrainViewer key={cityId} cityId={cityId}/></Suspense>}
          <figure className="dataset-source-figure"><img key={cityId} src={`/research/${cityId}-terrain/${cityId}-source-preview.png`} alt={`${workspace.name}真实源 DTM 高程及固定4,096源像元抽查误差分布，大误差未隐藏`} loading="lazy"/><figcaption>源地形与原生粗预览误差，ODN 米。源图显示抽稀不改变存档的 1 m 像元；误差色带饱和点保留在原记录。图中 English 标签用于科研复核。</figcaption></figure>
          <div className="dataset-downloads"><a href={`${apiBase}/cities/${cityId}/city/terrain/public-raster.tif`} download>1 m GeoTIFF · {(source.raster_bytes/1e6).toFixed(2)} MB ↓</a><a href={`/research/${cityId}-terrain/pixel-queries.csv`} download>原像元误差 CSV ↓</a><a href={`/research/${cityId}-terrain/preview-audit.json`} download>查询核验 JSON ↓</a><a href={`/research/${cityId}-terrain/${cityId}-source-preview.svg`} download>研究图 SVG ↓</a></div>
          <details className="dataset-provenance"><summary>范围、来源、许可与文件校验</summary><p>{source.coverage_label}</p><p>WGS84 裁剪范围：{source.query_bbox_wgs84.join(' / ')}。实际原像元中心形成预览模型边界；不代表城市行政范围。</p><p>{source.product} · 下载时间 {source.retrieved_utc}。复合源包含不同测量年份，不能称为实时现场数据。</p><p>{source.accuracy_note}</p><p>{source.unit_metadata_warning}</p><p>原生模型 SHA-256 <code>{source.model_sha256}</code><br/>无损栅格 SHA-256 <code>{source.raster_sha256}</code></p><p>{source.attribution}</p><a href={source.dataset_url} target="_blank" rel="noreferrer">官方数据集 ↗</a><a href={source.license_url} target="_blank" rel="noreferrer">{source.license} ↗</a></details>
        </>}
      </section>
    </div><footer>GUGIS3D · 真实地形数据目录 · 浏览与城市编辑分开</footer>
  </main>;
}
