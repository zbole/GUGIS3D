import {useEffect,useState} from 'react';
import report from '../../../shared/bristol-certified-terrain.json';
import BristolLocalPartitionComparison from './BristolLocalPartitionComparison';
import './hybridTerrainLab.css';
import './BristolTerrainBenchmark.css';

const names={hybrid:'原始全局混合面带',compact_hybrid:'紧凑全局混合面带',local_triangles:'局部三角带'};
const families=['hybrid','compact_hybrid','local_triangles'] as const;
const kb=(bytes:number)=>(bytes/1000).toFixed(2);
export default function BristolTerrainBenchmark(){
  const [target,setTarget]=useState(.1);
  useEffect(()=>{
    if(typeof window==='undefined'||window.location?.hash!=='#bristol-terrain-benchmark')return;
    const frame=window.requestAnimationFrame(()=>document.getElementById('bristol-terrain-benchmark')?.scrollIntoView());
    return()=>window.cancelAnimationFrame(frame);
  },[]);
  const pairs=report.cases.map(c=>({data:c,pair:c.variants.find(v=>v.target_m===target)!}));
  return <section className="hybrid-lab bristol-benchmark" id="bristol-terrain-benchmark" aria-labelledby="bristol-benchmark-title">
    <div className="hybrid-lab-heading"><div><span className="hybrid-eyebrow">REAL BRISTOL / FIXED SOURCE / REPRODUCIBLE RESULTS</span>
      <h2 id="bristol-benchmark-title">把真实布里斯托，放进同一场实验。</h2>
      <p>英国环境署 1 m 裸地 DTM，港区与布兰登山坡各固定 64 × 64 m。相同源栅格、相同最大误差目标，比较三种 GUGIS 表示；局部三角带另与同几何的 ArcGIS 兼容 MultiPatch 文件组对照。</p></div>
      <a href={report.source_url} target="_blank" rel="noreferrer">英国环境署原始资料 ↗</a></div>
    <div className="hybrid-controls"><label>真实 Bristol 最大误差目标<select aria-label="真实 Bristol 最大误差目标" value={target} onChange={e=>setTarget(Number(e.target.value))}>
      {[.1,.25,.5].map(v=><option key={v} value={v}>{v*100} cm</option>)}</select></label><span>误差界相对于源栅格双线性参考面；不是未知真实地面的精度保证。</span></div>
    <div className="bristol-benchmark__scores">{pairs.map(({data,pair})=><article key={data.id}>
      <span>{data.name} · {target*100} cm 目标</span><strong>{pair.multipatch.native_vs_core_saving_percent.toFixed(1)}%<small>文件体积减少</small></strong>
      <p>GUGIS 局部三角带 <b>{kb(pair.local_triangles.bytes)} kB</b><br/>同几何 MultiPatch 文件组 <b>{kb(pair.multipatch.core_bytes)} kB</b></p>
      <small>同方向三角面回读核对；4,096 点最大高程差 ≤ {pair.multipatch.native_height_max_difference_m.toExponential(1)} m。未运行 ArcGIS 软件。</small>
    </article>)}</div>
    <div className="hybrid-table-scroll"><table><caption>同误差目标下的表示代价 · 所有方法均完整列出</caption><thead><tr><th>样区</th><th>GUGIS 表示</th><th>文件 / kB</th><th>控制点</th><th>连续参考误差界 / cm</th><th>4,096 点 RMSE / cm</th></tr></thead><tbody>
      {pairs.flatMap(({data,pair})=>families.map(family=><tr key={`${data.id}/${family}`} className={family==='local_triangles'?'is-smallest':''}>
        <th scope="row">{data.name}</th><td>{names[family]}{family==='local_triangles'?' · 本组最小':''}</td><td>{kb(pair[family].bytes)}</td><td>{pair[family].points.toLocaleString()}</td>
        <td>{(pair[family].continuous_bound_m*100).toFixed(3)}{pair[family].target_met?' · 达标':' · 未达标'}</td><td>{(pair[family].query_audit.rmse_m*100).toFixed(3)}</td>
      </tr>))}</tbody></table></div>
    <p className="bristol-benchmark__finding">真实样区也会推翻直觉：首轮全局方案的六组中，局部三角带均小于紧凑混合面带；当前目标下，原全局紧凑混合文件在港区大 {(100*(pairs[0].pair.compact_hybrid.bytes/pairs[0].pair.local_triangles.bytes-1)).toFixed(1)}%，在山坡大 {(100*(pairs[1].pair.compact_hybrid.bytes/pairs[1].pair.local_triangles.bytes-1)).toFixed(1)}%。这支持按地形选择表达，不能用解析鞍面的优势替代真实城市结果。</p>
    <BristolLocalPartitionComparison target={target} />
    <div className="hybrid-table-scroll"><table><caption>MultiPatch 对照口径 · 同一份局部三角带几何</caption><thead><tr><th>样区</th><th>GUGIS / kB</th><th>五个文件 / kB</th><th>加原生恢复信息 / kB</th><th>原生档案回读</th></tr></thead><tbody>
      {pairs.map(({data,pair})=><tr key={data.id}><th>{data.name}</th><td>{kb(pair.local_triangles.bytes)}</td><td>{kb(pair.multipatch.core_bytes)}</td><td>{kb(pair.multipatch.recoverable_bytes)}</td><td>逐字节一致</td></tr>)}
    </tbody></table></div>
    <p className="hybrid-limit">五个文件 = SHP + SHX + DBF + PRJ + CPG，未压缩，单要素、三角带、省略不存在的可选 M。该文件组保留同一几何与投影，但不保留 GUGIS 控制点编号、原面带编号和全部元数据；右栏加计恢复文件后可逐字节还原。以上为文件大小，不能替代浏览器内存、GPU 帧率或 ArcGIS 软件耗时。</p>
    <details className="hybrid-method"><summary>源图、完整三档结果与 CPU 查询代价</summary>
      <figure className="bristol-benchmark__figure"><img src="/research/bristol-certified/source-and-cost.png" alt="港区与布兰登山坡原始 DTM 高程图，以及 10、25、50 厘米目标的三类文件成本；局部三角带在六组均最小" loading="lazy"/><figcaption>每个样区 65 × 65 原始像元中心，ODN 米，零缺测。两张高程图各用自己的色标，不用于视觉比较坡度。</figcaption></figure>
      <div className="hybrid-table-scroll"><table><caption>本机 CPU 实测 · 5 次预热批次中位数，每批 4,096 查询；构建和索引另计</caption><thead><tr><th>样区</th><th>目标</th><th>表示</th><th>模型构建 / ms</th><th>查询索引 / ms</th><th>查询一批 / ms</th></tr></thead><tbody>
        {report.cases.flatMap(data=>data.variants.flatMap(pair=>families.map(family=><tr key={`${data.id}/${pair.target_m}/${family}`}><td>{data.name}</td><td>{pair.target_m*100} cm</td><td>{names[family]}</td><td>{pair[family].build_validate_ms.toFixed(2)}{family==='compact_hybrid'?` + 压紧 ${pair.compact_hybrid.compaction_validate_ms.toFixed(2)}`:''}</td><td>{pair[family].query_audit.index_ms.toFixed(2)}</td><td>{pair[family].query_audit.query_batch_median_ms.toFixed(2)}</td></tr>)))}
      </tbody></table></div>
      <p>两地位置在拟合前固定；没有挑选有利结果。港区 50 cm 局部三角带文件略大于 25 cm：各档独立细分与打包，不保证字节数单调。参考界计算覆盖源单元和三角边极值，包含保存舍入与浮点保护，不是区间算术证明或最优性定理。</p>
      <p>实验模型采用英国国家格网局部偏移，未转换为城市 ENU，不能直接放入城市三维场景。正式城市和 20 像元粗预览均保持独立；本实验不代表整城已达该误差目标。</p>
    </details>
    <div className="hybrid-downloads">{report.cases.map(data=><a key={data.id} href={`/research/bristol-certified/${data.download.filename}`} download>{data.name}复现实验包 · {(data.download.bytes/1e6).toFixed(2)} MB</a>)}
      <a href="/research/bristol-certified/results.csv" download>结果 CSV</a><a href="/research/bristol-certified/results.json" download>数据与校验 JSON</a><a href="/research/bristol-certified/source-and-cost.svg" download>研究图 SVG</a></div>
    <p className="hybrid-attribution">© Environment Agency copyright and/or database right 2022. All rights reserved. <a href="https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/" target="_blank" rel="noreferrer">Open Government Licence v3.0</a> · <a href={report.multipatch_specification} target="_blank" rel="noreferrer">Esri MultiPatch 规范</a></p>
  </section>;
}
