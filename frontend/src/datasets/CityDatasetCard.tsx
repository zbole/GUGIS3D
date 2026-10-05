import {useEffect,useState} from 'react';
import catalogue from '../../../shared/public-city-datasets.json';

const apiBase=(import.meta.env.VITE_API_BASE_URL??'/api').replace(/\/$/,'');
export default function CityDatasetCard({cityId}:{cityId:string}){
  const source=catalogue.sources.find(s=>s.city_id===cityId);
  const [verified,setVerified]=useState(''),[error,setError]=useState(''),[retry,setRetry]=useState(0);
  useEffect(()=>{
    const controller=new AbortController();let active=true;
    setVerified('');setError('');
    if(!source){setError('尚无已发布的城市样本。');return()=>{active=false;controller.abort();};}
    const timer=setTimeout(()=>controller.abort(),30000);
    fetch(`${apiBase}/cities/${cityId}/public-dataset`,{signal:controller.signal,cache:'no-store'})
      .then(async response=>{if(!response.ok)throw new Error('服务器未通过公开样本核验，请刷新或重试。');
        const body=await response.json();
        if(body.status!=='available'||body.source?.city_id!==cityId||body.source?.sha256!==source.sha256||body.source?.bytes!==source.bytes)
          throw new Error('城市样本与当前页面的发布修订不一致，请刷新后重试。');
        if(active)setVerified(`${cityId}/${source.sha256}`);
      }).catch(e=>{if(active)setError(e?.name==='AbortError'?'核验超时，可以重试；没有修改城市。':e.message||'公开样本核验失败。');})
      .finally(()=>clearTimeout(timer));
    return()=>{active=false;clearTimeout(timer);controller.abort();};
  },[cityId,source,retry]);
  if(!source)return <p role="status">尚无已发布的城市样本。</p>;
  const ready=verified===`${cityId}/${source.sha256}`,counts=source.height_counts;
  return <section className="dataset-city-card" aria-label={`${source.name}完整公开城市样本`}>
    <div className="dataset-city-heading"><div><span className="dataset-eyebrow">GUGIS CITY / 完整公开样本文件</span><h3>建筑、道路与原始数据依据</h3></div><a href={`/?city=${cityId}&cities=${cityId}&view_mode=tiles&tile_profile=economy`}>浏览本城建筑 ↗</a></div>
    <div className="dataset-city-numbers"><span><strong>{source.building_count.toLocaleString()}</strong> 栋建筑</span><span><strong>{source.road_count.toLocaleString()}</strong> 条道路</span><span><strong>{(source.bytes/1e6).toFixed(2)} MB</strong> GUGIS 文件</span></div>
    <p>下载包含这个局部样本的全部对象与来源信息。它是公开种子，不包含您本机添加的建筑、草稿或历史；只读建筑视图按需加载，不一次性渲染整份文件。</p>
    <div className="dataset-city-quality"><strong>楼高依据，未经独立实测核验</strong><p>{counts?`${counts['height-tag'].toLocaleString()} 栋高度标签 · ${counts['levels-derived'].toLocaleString()} 栋楼层 × 3.2 m 推算 · ${counts.assumed.toLocaleString()} 栋假设 9.6 m` :source.height_policy}</p><p>{source.terrain_included?'种子保留原有地形，不能作为本页独立 EA DTM。':'城市种子不含地形；裸地 DTM 使用独立资料和核验，不随此文件下载。'}</p></div>
    {source.quality_warnings.map(w=><p className="dataset-city-warning" role="note" key={w.code}><strong>已知模型问题：</strong>{w.message}</p>)}
    <div className="dataset-city-actions">{ready?<a href={`${apiBase}/cities/${cityId}/public-dataset.gugis.json`} download>下载完整 GUGIS 样本 ↓</a>:error?<><p role="alert">{error}</p><button type="button" onClick={()=>setRetry(r=>r+1)}>重新核验样本</button></>:<p role="status">正在核对服务器公开样本的长度与 SHA-256…</p>}<small>{ready?'已核对公开种子修订；下载时再次检查文件指纹。':'文件通过核验后才显示下载入口。'}</small></div>
    <details className="dataset-city-provenance"><summary>城市样本范围、许可和修订</summary><p>{source.coverage_label}</p><p>查询范围：{source.query_bbox_wgs84.join(' / ')}。{source.actual_data_bbox_wgs84?`完整对象实际范围：${source.actual_data_bbox_wgs84.join(' / ')}。`:'没有单独发布完整几何包围框，不以对象中心范围代替。'}不表示行政边界或全城覆盖。</p><p>{source.source} · {source.license}</p><p>来源取得时间：{source.source_retrieved_at}。保留对象沿用各自来源依据。</p><p>公开文件 SHA-256 <code>{source.sha256}</code></p><a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OSM 署名与许可 ↗</a></details>
  </section>;
}
