import report from '../../../shared/bristol-local-partition-summary.json';

const kb=(n:number)=>(n/1000).toFixed(2);
const relative=(saving:number)=>saving>=0?`小 ${saving.toFixed(1)}%`:`大 ${(-saving).toFixed(1)}%`;
export default function BristolLocalPartitionComparison({target}:{target:number}){
  const pairs=report.cases.map(data=>({data,pair:data.variants.find(v=>v.target_m===target)}));
  if(pairs.some(p=>!p.pair))return <p>此档位尚无局部分区实测，不能借用其他档位结果。</p>;
  return <section className="hybrid-method bristol-local-partition" aria-labelledby="bristol-local-title">
    <span className="hybrid-eyebrow">NEXT ITERATION / LOCAL REFINEMENT / C0 CLOSURE</span>
    <h3 id="bristol-local-title">让复杂地形，主要影响附近区域。</h3>
    <p>第二轮把整行、整列传播的全局细分改为局部矩形分区。满足参考误差且能减少细分的单元保留直纹面，遇到细分接缝用三角带闭合：相邻边共享控制点编号及高程，不增加三角扇编码。整块单元仍核对连续参考误差界。</p>
    <div className="hybrid-table-scroll"><table><caption>相同源裁剪、相同 {target*100} cm 目标 · 新算法的优势与剩余代价</caption><thead><tr><th>真实样区</th><th>局部紧凑混合</th><th>相比原全局紧凑混合</th><th>相比局部三角带</th><th>连续参考界 / RMSE</th></tr></thead><tbody>
      {pairs.map(({data,pair})=>pair&&<tr key={data.id}><th>{data.name}</th><td>{kb(pair.compact_local_hybrid.bytes)} kB<br/>{pair.compact_local_hybrid.points.toLocaleString()} 控制点</td>
        <td>{relative(pair.vs_global_compact_saving_percent)}</td><td>{relative(pair.vs_local_triangles_saving_percent)}</td>
        <td>{(pair.compact_local_hybrid.continuous_bound_m*100).toFixed(3)} / {(pair.compact_local_hybrid.query_audit.rmse_m*100).toFixed(3)} cm</td></tr>)}
    </tbody></table></div>
    <p>港区三档均小于局部三角带；山坡三档仍更大。混合模型与局部三角表示是不同的认证曲面，此处比较相同误差目标下的成本，不能当作相同几何的格式收益，也不等于全局最优。</p>
    <details><summary>查看实际局部拓扑、接缝检查和构建代价</summary>
      <figure className="bristol-benchmark__figure"><img src="/research/bristol-local-partition/local-topology-cost.png" loading="lazy" alt="两处真实 Bristol 原始高程、10 厘米目标的局部直纹面和闭合三角带拓扑，以及三档全部成本"/><figcaption>绿色为实际直纹面单元，灰色为实际三角带面；平面投影图不用于展示垂直尺度。山坡的不利结果保留在右侧成本图。</figcaption></figure>
      {pairs.map(({data,pair})=>pair&&<p key={data.id}><b>{data.name}</b>：{pair.receipt.local_cells} 个局部矩形、{pair.receipt.boundary_triangulated_cells} 个单元执行接缝三角闭合；{pair.compact_local_hybrid.closure.internal_edges_paired.toLocaleString()} 条内部边均有对应边，XY 覆盖 {pair.compact_local_hybrid.closure.xy_area_m2.toFixed(2)} m²。4,225 源像元中心、4,096 固定非网格点及 256 外边界点均命中。单次构建 {pair.build_validate_ms.toFixed(2)} ms，另压紧 {pair.compaction_validate_ms.toFixed(2)} ms；每批 4,096 原生查询的五次预热中位数 {pair.compact_local_hybrid.query_audit.query_batch_median_ms.toFixed(2)} ms。</p>)}
      <p>保证的是共享边线的 C0 连续，不保证法线 C1 连续；边界坡度可取不同一侧。矩形候选和局部三角候选不同，算法为工程原型；保留失败状态与点数、迭代预算。源参考和 BNG 局部坐标限制沿用第一轮，本机 CPU 数值不能作为 ArcGIS 或 GPU 跑分。</p>
    </details>
    <div className="hybrid-downloads">{report.cases.map(data=><a key={data.id} href={`/research/bristol-local-partition/${data.download.filename}`} download>{data.name}局部分区包 · {(data.download.bytes/1e6).toFixed(2)} MB</a>)}
      <a href="/research/bristol-local-partition/results.csv" download>第二轮全部结果 CSV</a><a href="/research/bristol-local-partition/results.json" download>完整构建与接缝回执</a><a href="/research/bristol-local-partition/local-topology-cost.svg" download>局部拓扑科学图 SVG</a></div>
  </section>;
}
