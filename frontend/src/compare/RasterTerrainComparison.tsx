import report from '../../../shared/raster-triangle-benchmark.json';
const data=report.cases[0];
const kb=(n:number)=>(n/1000).toFixed(2);
const cm=(n:number)=>(n*100).toFixed(3);
export const rasterPair=(target:number)=>data.variants.find(v=>v.target_m===target);
export function rasterOutcome(target:number){
  const value=rasterPair(target)?.compact_vs_local_saving_percent;
  return value===null||value===undefined?'双方未全部通过同误差核验，不输出节省结论。':value===0?'两份文件一样大。':`紧凑混合文件比局部三角${value>0?'小':'大'} ${Math.abs(value).toFixed(1)}%。`;
}
export default function RasterTerrainComparison({target}:{target:number}){
  const pair=rasterPair(target)!;
  const a=pair.hybrid,b=pair.local_triangles,c=pair.compact_hybrid;
  const modes=[['hybrid','参考栅格证书混合',a],['compact_hybrid','同一曲面 · 紧凑混合',c],['local_triangles','局部最长边三角带',b]] as const;
  const maximum=Math.max(a.bytes,b.bytes,c.bytes);
  return <section id="raster-terrain-audit" className={`strip-compaction-audit raster-terrain-audit${(pair.compact_vs_local_saving_percent??0)<0?' has-loss':''}`} aria-labelledby="raster-terrain-title">
    <span className="hybrid-eyebrow">REAL DEM SOURCE / CONTINUOUS REFERENCE AUDIT</span><h3 id="raster-terrain-title">真实 DEM，核查整片区域</h3>
    <p>同一个瑞士 64 × 64 m 源窗口，129 × 129 个高程，0.5 m 间距。把源栅格双线性插值作为共同连续参考，重新构建混合模型与局部三角带。误差界针对这张参考栅格，不能代表未知的实际地面误差。</p>
    <div className="strip-cost-chart" aria-label={`真实 DEM 在${target*100}厘米目标下三种完整 JSON 大小`}>
      {modes.map(([mode,label,model])=><div className={`strip-cost-row ${mode==='compact_hybrid'?'compact':mode==='hybrid'?'original':'local'}`} key={mode}><span>{label}</span><div><i style={{width:`${100*model.bytes/maximum}%`}}/></div><strong>{kb(model.bytes)} kB</strong></div>)}
    </div>
    <div className="strip-result" aria-live="polite"><strong>{rasterOutcome(target)}</strong><span>局部三角 {b.points.toLocaleString()} 点 / 混合 {a.points.toLocaleString()} 点；同时计入面带、索引与共同元数据。</span></div>
    <div className="local-triangle-models">{[modes[0],modes[2]].map(([mode,label,model])=><figure key={mode}><img loading="lazy" width={784} height={630} src={`/research/hybrid-terrain/${data.id}-${model.filename.replace('.json','.png')}`} alt={`${label}实际保存的参考栅格地形拓扑`}/><figcaption>{label} · {model.patches.toLocaleString()} 条面带记录</figcaption></figure>)}</div>
    <div className="hybrid-table-scroll"><table><caption>{target*100} cm 目标 · 连续参考与实际读回</caption><thead><tr><th>核验项目</th>{modes.map(([mode,label])=><th key={mode}>{label}</th>)}</tr></thead><tbody>
      <tr><th>连续界 / 离网格核验</th>{modes.map(([mode,,model])=><td key={mode}>{model.target_met?'连续界通过':'连续界未通过'} / {model.offgrid.meets_sampled_target?'抽查通过':'抽查未通过'}</td>)}</tr>
      <tr><th>整片区域最大误差上界</th>{modes.map(([mode,,model])=><td key={mode}>{cm(model.continuous_certificate.max_error_bound_m)} cm</td>)}</tr>
      <tr><th>16,641 个源高程位置 · RMSE / 最大差</th>{modes.map(([mode,,model])=><td key={mode}>{cm(model.source_grid.rmse_m)} / {cm(model.source_grid.max_absolute_m)} cm</td>)}</tr>
      <tr><th>4,096 个相同连续坐标 · RMSE / 最大差</th>{modes.map(([mode,,model])=><td key={mode}>{cm(model.offgrid.rmse_m)} / {cm(model.offgrid.max_absolute_m)} cm</td>)}</tr>
    </tbody></table></div>
    <p className="hybrid-limit">旧采样混合档案的连续参考上界为 {cm(pair.historical_continuous_certificate.max_error_bound_m)} cm，{pair.historical_continuous_certificate.max_error_bound_m>target?'超过当前目标；原记录保留，未冒充新构建的达标模型。':'满足本档参考目标；原记录仍独立保留。'}紧凑编码仅重组新混合模型，内部与边界高程一致；{pair.preservation.boundary_queries.slope_ties_changed.toLocaleString()} 个边界抽查位置的单侧坡度首命中有变化。原面片编号和顺序版本在下载包中。</p>
    <details className="hybrid-method"><summary>区域界怎样计算，以及不能由此推断什么</summary><p>源矩形内部的高度是双线性函数。与三角形平面之差为 A + Bx + Cy + Dxy；检查三角形内部的源网格顶点、跨网格的边交点及边段二次函数的极值。网格对齐直纹面的差仍是双线性的，最大绝对差在源像元角点取得。包含五位小数高度舍入及浮点保护量；这是实数极值推导配合数值核查，未声称区间算术的机器证明。</p>
      <p>栅格参考不是 C² 函数。这里的局部对照采用最长边二分，并先处理邻面的更长边以避免针状三角形；持续优先处理误差界最差区域，保持共享边相容。它与解析样本的 L¹ 边决策分开，不能借用论文的渐近最优定理。控制点预算或几何分辨率不足会标记未达标。</p>
      <p>数据来自 ImplicitTerrain 作者公开瑞士 DEM 窗口，不是英国城市 DEM。未运行 ArcGIS Pro，也不把完整 JSON 比例称为内存节省；参考插值不能补出源 DEM 未测量的细节。</p>
      <div className="hybrid-table-scroll"><table><caption>四档目标全部公开</caption><thead><tr><th>目标</th><th>紧凑 / 局部文件 kB</th><th>混合 / 局部区域界 cm</th><th>结果</th></tr></thead><tbody>{data.variants.map(v=><tr key={v.target_m}><th>{v.target_m*100} cm</th><td>{kb(v.compact_hybrid.bytes)} / {kb(v.local_triangles.bytes)}</td><td>{cm(v.hybrid.continuous_certificate.max_error_bound_m)} / {cm(v.local_triangles.continuous_certificate.max_error_bound_m)}</td><td>{rasterOutcome(v.target_m)}</td></tr>)}</tbody></table></div>
    </details>
    <div className="hybrid-downloads"><a href="#raster-multipatch-audit">查看相同三角几何的 ArcGIS 格式对照 ↓</a><a href="/research/hybrid-terrain/swiss-dem-crop-raster-triangles.zip" download>下载三种表示、参考栅格与区域核验回执 ↓</a><a href="/research/hybrid-terrain/raster-triangle-results.json" download>连续参考 JSON ↓</a><a href="/research/hybrid-terrain/raster-triangle-results.csv" download>12 份模型 CSV ↓</a></div>
  </section>;
}
