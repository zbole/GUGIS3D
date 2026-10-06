import {useEffect,useMemo,useState} from 'react';
import report from '../../../shared/source-native-bands-v1.json';
import {loadSourceModel,type LoadedSourceModel} from './loadSourceModel';
import {prepareRegularGridQuery} from './sourceRuledBandMath';
import {prepareCompactSourceBandQuery} from './compactSourceBandQuery';
import SourceQueryDisclosure from './SourceQueryDisclosure';
import {useComparisonAnchor} from './useComparisonAnchor';
import SourceFormatProof from './SourceFormatProof';
import HybridSourceDisclosure from './HybridSourceDisclosure';
import SourceFitDisclosure from './SourceFitDisclosure';
import './SourceFunctionResults.css';
const base='/research/source-native-bands-v1/';
type Site=typeof report.cases[number];
const model=(s:Site,f:string)=>s.models.find(m=>m.family===f)!;
const labels=['GUGIS 原生直纹面带','源节点 P1 三角带','逐格 P2 三角函数'];
const size=(n:number)=>`${(n/1000).toFixed(2)} kB`;
const saving=(a:number,b:number)=>100*(1-a/b);
function SourceQueryDemo({site}:{site:Site}){
  const witness=model(site,'source_p1').maximum_witness!,[x,setX]=useState(witness.x),[y,setY]=useState(witness.y),[loaded,setLoaded]=useState<LoadedSourceModel[]|null>(null),[error,setError]=useState(''),[retry,setRetry]=useState(0);
  useEffect(()=>{const abort=new AbortController();setLoaded(null);setError('');
    const files=site.models.map(m=>({filename:m.binary_filename,bytes:m.binary_bytes,sha256:m.binary_sha256}));files.push(site.regular_grid);
    Promise.all(files.map(m=>loadSourceModel(`${base}${site.id}/${m.filename}`,m.bytes,m.sha256,site.origin_bng,abort.signal))).then(v=>{if(!abort.signal.aborted)setLoaded(v);}).catch(e=>{if(!abort.signal.aborted)setError(e instanceof Error?e.message:'模型读取失败');});return()=>abort.abort();
  },[site.id,retry]);
  const queries=useMemo(()=>loaded?.map(m=>m.kind==='surface'?prepareCompactSourceBandQuery(m.model):prepareRegularGridQuery(m.model))??null,[loaded]);
  if(error)return <p role="alert">{error} <button onClick={()=>setRetry(v=>v+1)}>重试源地形模型</button></p>;
  if(!loaded||!queries)return <p role="status">正在校验三个完整矢量文件与原始 Float32 源高程格…</p>;
  const reference=queries[3].query(x,y)!,west=Math.min(31,Math.max(-32,Math.floor(x))),south=Math.min(31,Math.max(-32,Math.floor(y))),centre=queries[3].query(west+.5,south+.5)!.height;
  const maxRelief=Math.max(...[[0,0],[0,1],[1,0],[1,1]].map(([u,v])=>Math.abs(queries[3].query(west+u,south+v)!.height-centre))),verticalRatio=Math.min(50,100/(52*Math.max(1e-6,maxRelief)));
  const project=(u:number,v:number,z:number)=>[150+105*(u-v),230-52*(u+v)-52*verticalRatio*(z-centre)];
  return <div className="sf-demo">
    <div className="sf-query-controls">{(['X','Y'] as const).map((name,i)=><label key={name}>相对中心 {name} / m<input type="range" aria-label={`源地形同点查询${name}`} min="-31.99" max="31.99" step=".01" value={i?y:x} onChange={e=>(i?setY:setX)(Number(e.target.value))}/><output>{(i?y:x).toFixed(2)}</output></label>)}<button onClick={()=>{setX(witness.x);setY(witness.y);}}>定位 P1 最大高程差</button></div>
    <p className="sf-coordinate">同一点 · BNG E {reference.easting.toFixed(2)} / N {reference.northing.toFixed(2)} m · 源函数 Z {reference.height.toFixed(9)} m ODN</p>
    <div className="sf-query-grid">{site.models.map((m,i)=>{
      const q=queries[i].query(x,y)!;let paths='';
      for(let direction=0;direction<2;direction++)for(let line=0;line<=8;line++)for(let step=0;step<=8;step++){
        const u=(direction?line:step)/8,v=(direction?step:line)/8,z=queries[i].query(west+u,south+v)!.height,p=project(u,v,z);paths+=`${step?'L':'M'}${p[0]},${p[1]}`;
      }
      const point=project(x-west,y-south,q.height),diagonal=[project(0,1,queries[i].query(west,south+1)!.height),project(1,0,queries[i].query(west+1,south)!.height)];
      return <article key={m.family}><h3>{labels[i]}</h3><p>{size(m.binary_bytes)} · {m.controls.toLocaleString()} 个存储节点</p>
        <svg viewBox="0 0 300 330" role="img" aria-label={`${labels[i]}实际函数在当前1米源单元的立体采样图`}><path d={paths} fill="none" stroke={['#278c78','#708ca2','#b09667'][i]} strokeWidth=".8"/>{i>0&&<path d={`M${diagonal[0]}L${diagonal[1]}`} stroke={i===1?'#708ca2':'#b09667'} strokeWidth="1.5"/>}<circle cx={point[0]} cy={point[1]} r="4" fill="#d56c50" stroke="white"/><text x="12" y="312">1 × 1 m 源单元 · 垂直比例 {verticalRatio.toFixed(1)} 倍</text></svg>
        <p className="sf-point">Z {q.height.toFixed(9)} m<br/>相对源函数 Δz {Number((1000*(q.height-reference.height)).toFixed(6)).toFixed(6)} mm<br/>坡度 {(Math.atan(Math.hypot(...q.gradient))*180/Math.PI).toFixed(6)}°</p>
      </article>;
    })}</div>
    <p>线框仅为原生函数在当前源单元的展示采样，不计作模型存储面数。面带和 P2 可保留同一双线性单元函数；P1 虽通过所有原始高程点，单元内部仍可能不同。共享边界处导数可能不连续，查询采用固定的首命中规则。</p>
  </div>;
}
export default function SourceFunctionResults(){
  useComparisonAnchor('source-function-results');
  const [siteId,setSiteId]=useState(report.cases[0].id),[demo,setDemo]=useState(false),site=report.cases.find(s=>s.id===siteId)!,r=model(site,'ruled'),p1=model(site,'source_p1'),p2=model(site,'source_p2'),same=report.cases.filter(s=>model(s,'ruled').e2_m2<1e-8&&model(s,'source_p2').e2_m2<1e-8).length;
  return <section id="source-function-results" className="sf-results" aria-labelledby="sf-title">
    <div className="cr-heading"><div><span className="cr-eyebrow">真实 DTM / 同一源函数 / 完整文件</span><h2 id="sf-title">相同高程函数，用更少矢量数据保存。</h2><p>十座城市、20 个预先固定的 1 m DTM 样区。保留逐格双线性函数时，原生面带比本次逐格 P2 三角函数文件更小；同节点 P1 三角带则产生单元内部高程差。</p></div><label className="sf-site">固定样区<select aria-label="源函数对比样区" value={siteId} onChange={e=>setSiteId(e.target.value)}>{report.cases.map(s=><option key={s.id} value={s.id}>{s.name.replace(' · 英国环境署裸地 DTM','')}</option>)}</select></label></div>
    <div className="sf-metrics"><article><span>同一源函数 · 相对逐格 P2 文件减少</span><strong>{saving(r.binary_bytes,p2.binary_bytes).toFixed(1)}<small>%</small></strong><p>{size(r.binary_bytes)} / {size(p2.binary_bytes)} · 面带 / P2</p></article><article><span>全域源函数一致性核验通过</span><strong>{same}<small>/ {report.cases.length}</small></strong><p>面带与 P2 全域 E₂ 均 &lt; 10⁻⁸ m²</p></article><article><span>同节点 P1 · 相对源函数全域 RMS 差</span><strong>{(p1.rms_integral_m*1000).toFixed(2)}<small>mm</small></strong><p>P1 与面带文件均为 {r.binary_bytes.toLocaleString()} B</p></article></div>
    <div className="sf-file-chart" aria-label="同源表示完整文件代价">{[
      ...site.models.map((m,i)=>({name:labels[i],bytes:m.binary_bytes,tone:i===0?'ruled':i===1?'p1':'p2',note:i===1?'同节点；源函数存在内部差':'保留同一源函数'})),
      {name:'Float32 规则高程格控制',bytes:site.regular_grid.bytes,tone:'grid',note:'XY 隐式；保留同一源函数'},
      {name:'实际无损 GeoTIFF 输入',bytes:site.source_geotiff.bytes,tone:'tiff',note:'源像素完全不变；可下载 GIS 输入'},
    ].map(v=><div className={`sf-file-row ${v.tone}`} key={v.tone}><div><strong>{v.name}</strong><span>{size(v.bytes)}</span></div><div className="sf-file-track"><i style={{width:`${100*v.bytes/p2.binary_bytes}%`}}/></div><p>{v.note}</p></div>)}</div>
    <p className="sf-control">规则高程格与无损 GeoTIFF 在这些规则样区中更小。本节验证面带相对通用共享 XYZ 的逐格 P2 矢量表示的优势，不是优于所有栅格或最优三角编码。完整文件字节数也不等于运行内存。</p>
    <SourceQueryDisclosure/>
    <SourceFormatProof siteId={siteId}/>
    <SourceFitDisclosure/>
    <HybridSourceDisclosure/>
    <div className="cr-actions"><button aria-label="展开真实源函数同点查询" aria-expanded={demo} onClick={()=>setDemo(v=>!v)}>{demo?'收起真实源函数同点查询':'验证实际高程与精细函数结构'}</button><a download href={`${base}${site.id}/${site.source_geotiff.filename}`}>当前原始像素 GeoTIFF ↓</a><a download href={`${base}${site.id}/${r.binary_filename}`}>当前 GUGIS 原生面带 ↓</a><a download href={`${base}${report.package.filename}`}>20 样区完整证据 ZIP ↓</a></div>
    {demo&&<SourceQueryDemo key={site.id} site={site}/>}
    <details className="cr-details"><summary>20 个固定样区的全部对比结果</summary><div className="cr-table"><table><caption>相同 65 × 65 源高程节点 · 每样区比较像素中心之间的 64 × 64 m</caption><thead><tr><th>样区</th><th>面带 / P2 完整文件 kB</th><th>减少</th><th>P1 源函数 RMS 差 mm</th><th>实际源 GeoTIFF kB</th></tr></thead><tbody>{report.cases.map(s=><tr key={s.id}><th>{s.name.replace(' · 英国环境署裸地 DTM','')}</th><td>{(model(s,'ruled').binary_bytes/1000).toFixed(2)} / {(model(s,'source_p2').binary_bytes/1000).toFixed(2)}</td><td>{saving(model(s,'ruled').binary_bytes,model(s,'source_p2').binary_bytes).toFixed(1)}%</td><td>{(model(s,'source_p1').rms_integral_m*1000).toFixed(3)}</td><td>{(s.source_geotiff.bytes/1000).toFixed(2)}</td></tr>)}</tbody></table></div><img src={`${base}source-function-results.svg`} loading="lazy" width="1100" height="870" alt="四种同源完整文件代价与全部20个真实样区P1源函数RMS差，注明规则栅格更小和源函数一致性范围"/></details>
    <details className="cr-details"><summary>来源、误差定义与可复核证据</summary><p>源数据为英国环境署 2022 年 1 m 裸地 DTM，EPSG:27700；高程按官方说明采用米、ODN。源 WCS 单位字段与米制正文存在冲突，源 GeoTIFF 本身未记录高程单位，元数据警告保留在报告中。{site.source_identity.attribution} <a href={site.source_identity.dataset_url} target="_blank" rel="noreferrer">官方数据集</a> · <a href={site.source_identity.license_url} target="_blank" rel="noreferrer">OGL v3</a></p>
      <p>同源函数指原始 Float32 像素节点之间的逐格双线性插值，不是独立实测地面精度。这些分段 DTM 不满足论文严格凸 C² 曲面的全部前提。本节 P1 为源规则节点三角化，未采用论文式贪心细化。另一个预算受限的真实 DTM 控制试验仍保留其面带没有获胜的结果。</p>
      <p>三个矢量文件共用 80 B 坐标头部、Float64 XYZ 节点池和完整原生记录。面带保存 64 条边界带，包含 4,096 个单元；P1 三角带使用相同 4,225 个原始节点；逐格 P2 共享 16,641 个节点，共 8,192 个二次三角面。所有 80 种表示共核验 993,360 次内部与源节点查询，独立五阶求积复核全域积分。Float64 数值余量不是区间算术证明；本节未计时。</p>
      <p>可下载 GeoTIFF 保留原始像素值、坐标系、1 m 分辨率与无损压缩；像素面积覆盖 65 × 65 m，而函数比较覆盖 65 个像素中心之间的 64 × 64 m。研究模型 GPR4 是函数查询实验文件，并非完整城市存档。</p>
      <div className="cr-actions"><a download href={`${base}sites.csv`}>全部结果 CSV ↓</a><a download href={`${base}results.json`}>完整模型与积分记录 ↓</a><a download href={`${base}native-audit.json`}>原生高程与梯度核验 ↓</a><a download href={`${base}source-function-results.svg`}>科学图 SVG ↓</a></div><p className="cr-hash">报告 SHA-256：{report.report_sha256}<br/>ZIP SHA-256：{report.package.sha256}</p>
    </details>
  </section>;
}
