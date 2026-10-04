import report from '../../../shared/raster-multipatch-benchmark.json';
const kb=(n:number)=>(n/1000).toFixed(2);
export const multipatchPair=(target:number)=>report.variants.find(v=>v.target_m===target);
export function multipatchOutcome(target:number){
  const row=multipatchPair(target);
  if(!row)return '本档尚无 MultiPatch 核验回执。';
  const percent=row.native_vs_core_saving_percent;
  return percent===0?'相同三角几何的两个完整格式一样大。':`相同三角几何，GUGIS 文件${percent>0?'小':'大'} ${Math.abs(percent).toFixed(1)}%。`;
}
export default function RasterMultipatchComparison({target}:{target:number}){
  const row=multipatchPair(target);
  if(!row)return null;
  const maximum=Math.max(row.native_bytes,row.core_bytes,row.with_native_recovery_bytes);
  const formats=[['local','GUGIS · 局部三角原档',row.native_bytes],['original','MultiPatch · 五件套',row.core_bytes],['compact','MultiPatch · 加原档恢复信息',row.with_native_recovery_bytes]] as const;
  return <section id="raster-multipatch-audit" className="strip-compaction-audit" aria-labelledby="raster-multipatch-title">
    <span className="hybrid-eyebrow">IDENTICAL GEOMETRY / ARCGIS FILE FORMAT</span>
    <h3 id="raster-multipatch-title">相同三角几何，直接带到 ArcGIS</h3>
    <p>将上面的局部三角模型原样写入 Shape MultiPatch 三角带。保持每个有向三角形及 XYZ 高程，只合并端点相容的面带；一个地形要素、不写不存在的 M 值。这是文件格式与独立读回核验，尚未运行 ArcGIS Pro。</p>
    <div className="strip-cost-chart" aria-label={`${target*100}厘米目标下相同几何的格式文件大小`}>{formats.map(([kind,label,bytes])=><div className={`strip-cost-row ${kind}`} key={kind}><span>{label}</span><div><i style={{width:`${100*bytes/maximum}%`}}/></div><strong>{kb(bytes)} kB</strong></div>)}</div>
    <div className="strip-result" aria-live="polite"><strong>{multipatchOutcome(target)}</strong><span>计入 SHP、SHX、DBF、PRJ、CPG；GUGIS 计入共享控制点、面带索引和共同元数据。文件大小比例不代表运行内存或渲染速度。</span></div>
    <div className="hybrid-table-scroll"><table><caption>同一几何核验 · {target*100} cm 目标</caption><tbody>
      <tr><th>三角形 / 保存面带</th><td>{row.triangles.toLocaleString()} / {row.saved_parts.toLocaleString()}</td></tr>
      <tr><th>参考栅格最大误差上界</th><td>{(row.continuous_certificate.max_error_bound_m*100).toFixed(3)} cm · 三角几何完全保留，因此沿用原区域界</td></tr>
      <tr><th>4,096 个坐标 · 对网站查询最大差</th><td>{row.offgrid.native_kernel_max_difference_m.toExponential(2)} m</td></tr>
      <tr><th>16,641 个源位置 · 对原几何最大差</th><td>{row.source_grid.native_geometry_max_difference_m.toExponential(2)} m</td></tr>
      <tr><th>恢复原 GUGIS 文件</th><td>点编号、面带、元数据逐字节相同 · 已核验 SHA-256</td></tr>
      <tr><th>坐标位置</th><td>瑞士 EPSG:2056 · 源像元中心平移 {report.origin_xy.join(', ')} m；Z 原值保留</td></tr>
    </tbody></table></div>
    <p className="hybrid-limit">混合曲面与局部三角是不同近似解：当前紧凑混合 {kb(row.compact_hybrid_bytes)} kB，相对上述 MultiPatch {row.hybrid_vs_core_saving_percent>=0?'小':'大'} {Math.abs(row.hybrid_vs_core_saving_percent).toFixed(1)}%。它们满足同一档参考误差目标，但这不能当作相同几何的格式收益。</p>
    <details className="hybrid-method"><summary>四档结果、恢复成本及在 ArcGIS 中使用</summary>
      <div className="hybrid-table-scroll"><table><caption>所有目标及两种成本口径</caption><thead><tr><th>目标</th><th>GUGIS / 五件套 kB</th><th>原档格式结果</th><th>附恢复信息 kB</th><th>紧凑混合对五件套</th></tr></thead><tbody>{report.variants.map(v=><tr key={v.target_m}><th>{v.target_m*100} cm</th><td>{kb(v.native_bytes)} / {kb(v.core_bytes)}</td><td>{multipatchOutcome(v.target_m)}</td><td>{kb(v.with_native_recovery_bytes)}</td><td>{v.hybrid_vs_core_saving_percent>=0?'小':'大'} {Math.abs(v.hybrid_vs_core_saving_percent).toFixed(1)}%</td></tr>)}</tbody></table></div>
      <p>解压下载包，将 terrain.shp 连同同名 .shx、.dbf、.prj、.cpg 加入 ArcGIS 三维场景。数据位于瑞士局部窗口；核对范围及坐标后缩放到图层。native.json 是同几何 GUGIS 原档，reference.npz 和 query-fixture.json 用于复核。</p>
      <p>五件套保持几何但不包含 GUGIS 的共享点编号、逐面带编号和全部元数据。可选 native-recovery.json 保存这些恢复信息；第二种总成本计入它，读回后已逐字节恢复 native.json。ZIP 压缩大小、参考栅格和核验回执不混入五件套成本。</p>
      <p>本次没有 ArcGIS 软件侧构建、内存、帧率或分析计时；独立 Python 读回也不等同于 ArcGIS 性能。文件结构依据 <a href={report.specification} target="_blank" rel="noreferrer">Esri Shapefile 技术规范（MultiPatch / Table 16）</a>，不存在的可选 M 不计入基线。</p>
      <p>有向三角形集合 SHA-256：<code>{row.oriented_triangle_multiset_sha256}</code></p>
    </details>
    <div className="hybrid-downloads"><a href={`/research/hybrid-terrain/${row.download.filename}`} download>下载 {target*100} cm 同几何 MultiPatch 与恢复包 ↓</a><a href="/research/hybrid-terrain/raster-multipatch-results.json" download>四档核验 JSON ↓</a><a href="/research/hybrid-terrain/raster-multipatch-results.csv" download>格式成本 CSV ↓</a></div>
  </section>;
}
