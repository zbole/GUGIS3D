import {useEffect,useState} from 'react';
import type {CityApi,PublicTerrainSource} from './cityApi';
import './PublicTerrainCard.css';

type Info={status:'available'|'pending';source:PublicTerrainSource|null};
export default function PublicTerrainCard({api,disabled,onPreview}:{
  api:Pick<CityApi,'publicTerrainSource'|'publicTerrainRasterUrl'>;disabled:boolean;onPreview:()=>void;
}){
  const [info,setInfo]=useState<Info|null>(null),[error,setError]=useState(''),[retry,setRetry]=useState(0);
  useEffect(()=>{
    let active=true;setInfo(null);setError('');
    api.publicTerrainSource().then(result=>{if(active)setInfo(result);},cause=>{
      if(active)setError(cause instanceof Error?cause.message:String(cause));
    });
    return ()=>{active=false;};
  },[api,retry]);
  const source=info?.status==='available'?info.source:null;
  const auditBase=source&&['bristol','london','birmingham','manchester','york','bath','oxford','cambridge','liverpool','sheffield','leeds','nottingham','newcastle'].includes(source.city_id)?`/research/${source.city_id}-terrain`:null;
  return <section className="public-terrain-card" aria-label="公开真实地形资料">
    <small>PUBLIC DTM / 真实裸地数据</small>
    {!info&&!error&&<p role="status">正在核对当前城市的公开地形资料…</p>}
    {error&&<><p role="alert">{error}</p><button disabled={disabled} onClick={()=>setRetry(n=>n+1)}>重新核对公开地形</button></>}
    {info?.status==='pending'&&<p>当前城市尚无已核验的公开 DTM。可导入自己的 DEM；不会借用其他城市地形。</p>}
    {source&&<>
      <h3>{source.name}</h3><p>{source.product} · {source.vertical_datum}</p>
      <p>{source.preview_stride_pixels} 像元采样 · {source.preview_points.toLocaleString()} 控制点；源分辨率不等于预览精度。</p>
      <dl><dt>{source.sample_audit.requested.toLocaleString()} 原像元抽查 · 相对源 DTM</dt>
        <dd>RMSE {source.sample_audit.rmse_m.toFixed(3)} m · 最大差 {source.sample_audit.max_absolute_m.toFixed(3)} m</dd></dl>
      <p>仅局部覆盖；抽查不是连续误差保证。</p>
      <p>抽查命中 {source.sample_audit.hits.toLocaleString()} / {source.sample_audit.requested.toLocaleString()}；误差按命中点计算，缺测不补值。</p>
      <button className="primary full" disabled={disabled} onClick={onPreview}>预览环境署真实 DTM</button>
      <p className="muted">仅独立草稿，确认前不替换正式地形。</p>
      <div className="public-terrain-card__links"><a href={api.publicTerrainRasterUrl} download>下载 1 m GeoTIFF · {(source.raster_bytes/1e6).toFixed(2)} MB</a>
        <a href={`/datasets?dataset=${source.city_id}`}>仅浏览源地形与三维面带 ↗</a>
        <a href={source.dataset_url} target="_blank" rel="noreferrer">官方数据集说明 ↗</a></div>
      <details><summary>来源、许可与精度边界</summary><p>{source.attribution}</p>
        <p>{source.coverage_label}</p><p>{source.accuracy_note}</p><p>坐标系：{source.source_crs}。需要更细地形时，可下载源 GeoTIFF，再选择较小采样步长导入。</p>
        <a href={source.license_url} target="_blank" rel="noreferrer">{source.license} ↗</a>
        <p>下载时间：{source.retrieved_utc}。2022 复合数据汇集不同年份测量，不代表 2026 年现场。</p>
        <p>{source.unit_metadata_warning}</p><p>栅格仅无损压缩，像元、坐标和缺测标记逐项保持。预览沿用现有城市坡度分类规则，未建立全分辨率误差保证。</p>
        {auditBase&&<div className="public-terrain-card__links"><a href={`${auditBase}/preview-audit.json`} download>像元抽查回执 · JSON</a><a href={`${auditBase}/pixel-queries.csv`} download>4,096 点差异 · CSV</a>
          <a href={`${auditBase}/${source.city_id}-source-preview.png`} download>源地形与误差分布 · PNG</a><a href={`${auditBase}/${source.city_id}-source-preview.svg`} download>可编辑科学图 · SVG</a></div>}
      </details>
    </>}
  </section>;
}
