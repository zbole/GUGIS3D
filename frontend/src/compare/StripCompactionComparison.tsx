import report from '../../../shared/strip-compaction-benchmark.json';
const kb=(n:number)=>(n/1000).toFixed(2);
export function compactPair(caseId:string,target:number){return report.cases.find(c=>c.id===caseId)?.variants.find(v=>v.target_m===target);}
export function compactOutcome(caseId:string,target:number){
  const value=compactPair(caseId,target)?.compact_vs_local_saving_percent;
  if(value===null||value===undefined)return '真实 DEM 的紧凑局部对照仍待核验。';
  if(value===0)return '紧凑表示与局部三角文件一样大。';
  return `紧凑表示比局部三角文件${value>0?'小':'大'} ${Math.abs(value).toFixed(1)}%。`;
}
export default function StripCompactionComparison({caseId,target}:{caseId:string;target:number}){
  const data=report.cases.find(c=>c.id===caseId),p=compactPair(caseId,target);
  if(!data||!p)return <section id="strip-compaction-audit" className="strip-compaction-audit"><h3>编码组织优化 · 真实 DEM 待测</h3><p>真实 DEM 不代入解析样本的节省比例。</p></section>;
  const a=p.hybrid,b=p.compact_hybrid,c=p.local_triangles,edge=p.preservation.boundary_queries;
  const maximum=Math.max(a.bytes,b.bytes,c.bytes);
  const bars=[['原混合 · 逐面记录',a.bytes,'original'],['紧凑混合 · 连续面带',b.bytes,'compact'],['局部三角 · 相容剖分',c.bytes,'local']] as const;
  return <section id="strip-compaction-audit" className="strip-compaction-audit" aria-labelledby="strip-compaction-title">
    <span className="hybrid-eyebrow">SAME SURFACE / COMPACT STRIP ORGANIZATION</span><h3 id="strip-compaction-title">相同曲面，更紧凑的面带</h3>
    <p>把共享端点的直纹面连续排列，把相邻三角形编成三角带。保留每一个控制点和原始曲面函数，单独衡量编码组织带来的收益。</p>
    <div className="strip-cost-chart" aria-label={`${data.name}在${target*100}厘米目标下三种完整文件大小`}>
      {bars.map(([name,bytes,kind])=><div className={`strip-cost-row ${kind}`} key={kind}><span>{name}</span><div><i style={{width:`${100*bytes/maximum}%`}}/></div><strong>{kb(bytes)} kB</strong></div>)}
    </div>
    <div className="strip-result" aria-live="polite"><strong>{compactOutcome(caseId,target)}</strong><span>仅编码合并：{p.organization_saving_percent===0?'文件大小不变':`原文件减少 ${p.organization_saving_percent.toFixed(1)}%`}；面片记录 {a.patches.toLocaleString()} → {b.patches.toLocaleString()}，控制点仍为 {b.points.toLocaleString()}。</span></div>
    <div className="hybrid-table-scroll"><table><caption>几何和查询保持情况 · {target*100} cm 目标</caption><thead><tr><th>核验项目</th><th>合并前 / 后</th></tr></thead><tbody>
      <tr><th>保存的双线性面 / 有向三角形</th><td>{b.ruled_quads.toLocaleString()} / {b.triangle_faces.toLocaleString()} · 原始单元哈希完全相同</td></tr>
      <tr><th>合并后的直纹面带 / 三角带</th><td>{b.ruled_strips.toLocaleString()} / {b.triangle_strips.toLocaleString()}</td></tr>
      <tr><th>4,096 个相同连续位置 · 最大高程差</th><td>{p.preservation.random_queries.max_height_difference_m.toExponential(2)} m</td></tr>
      <tr><th>控制点 / 边中点 · 最大高程差</th><td>{edge.samples.toLocaleString()} 个位置 / {edge.max_height_difference_m.toExponential(2)} m</td></tr>
      <tr><th>共享边界的坡度首命中变化</th><td>{edge.slope_ties_changed.toLocaleString()} 个位置 · 最大 {edge.max_slope_difference_degrees.toFixed(3)}°</td></tr>
    </tbody></table></div>
    <p className="hybrid-limit">这是编码组织收益，不能算作曲面逼近算法或内存节省。面片编号重组；C⁰ 边界处不同面的坡度可能不连续，重组会改变首先命中的单侧坡度。原档案保留在下载包，可恢复原编号与顺序。未运行 ArcGIS Pro。</p>
    <details className="hybrid-method"><summary>全部误差档位与计量边界</summary><p>三份档案使用相同元数据，全部坐标、面带和索引计入完整 JSON。局部三角基线已合并三角带；紧凑混合只重组原单元，不增加控制点、不再细分，也不改变原连续误差界。每条直纹边界最多 128 点，每条三角带最多 256 索引。共享边界高度与内部查询均校验，不宣称坡度首命中完全相同。</p>
      <div className="hybrid-table-scroll"><table><caption>{data.name} · 完整文件 kB</caption><thead><tr><th>目标</th><th>原混合</th><th>紧凑混合</th><th>局部三角</th><th>紧凑对照结果</th></tr></thead><tbody>{data.variants.map(v=><tr key={v.target_m}><th>{v.target_m*100} cm</th><td>{kb(v.hybrid.bytes)}</td><td>{kb(v.compact_hybrid.bytes)}</td><td>{kb(v.local_triangles.bytes)}</td><td>{compactOutcome(caseId,v.target_m)}</td></tr>)}</tbody></table></div>
    </details>
    <div className="hybrid-downloads"><a href={`/research/hybrid-terrain/${caseId}-strip-compaction.zip`} download>下载三种档案、原编号版本与核验回执 ↓</a><a href="/research/hybrid-terrain/strip-compaction-results.json" download>编码结果 JSON ↓</a><a href="/research/hybrid-terrain/strip-compaction-results.csv" download>72 份计量记录 CSV ↓</a></div>
  </section>;
}
