import report from '../../../shared/terrain-ray-benchmark.json';
import './ResearchDisplayReuse.css';
const names={hybrid:'证书混合',compact_hybrid:'紧凑混合',local_triangles:'局部三角'};
export default function ResearchRayAudit({caseId,target,archiveSha256,indexed}:{caseId:string;target:number;archiveSha256:string;indexed:boolean}){
  const record=report.records.find(r=>r.case_id===caseId&&r.target_m===target&&r.archive_sha256===archiveSha256);
  if(!record)return <p className="hybrid-live-note">射线实验仅测量 10 cm 目标的 15 份指定档案；当前档案没有匹配记录。<a href="/research/hybrid-terrain/ray-index-results.json" download>下载完整实验</a></p>;
  const max=Math.max(record.linear_batch_median_ms,record.hierarchy_batch_median_ms);
  return <section className="display-reuse-audit" aria-label="原生射线查询实测">
    <div className="display-reuse-audit__intro"><div><small>同一 1,024 射线 · 保留原求交函数 · 本项目 CPU 对照</small>
      <h4>查询阶段耗时比 {record.query_only_ratio.toFixed(1)}×</h4></div><span>当前点选：{indexed&&record.tree.cells>=4096?'空间筛选':'原扫描'}</span></div>
    <div className="display-reuse-audit__bars">{[['原扫描',record.linear_batch_median_ms],['空间筛选',record.hierarchy_batch_median_ms]].map(([label,value])=><div key={label as string}>
      <span>{label as string}</span><div className="display-reuse-audit__track"><i style={{width:`${100*(value as number)/max}%`}}/></div><strong>{(value as number).toFixed(2)} ms</strong></div>)}</div>
    <p>{record.tree.cells.toLocaleString()} 个原生面区段；本组每条射线最多 {record.candidate_cells.max} 个候选，{record.hits} 条命中。全部射线的命中状态、面片、高程、坡度、坡向和原生参数与原扫描逐项一致；高程精度没有因此提高。</p>
    <p>额外建树 {record.hierarchy_extra_build_ms.toFixed(2)} ms，按本组均值估算{record.approximate_build_break_even_rays===null?'无法摊销构建成本':`约 ${record.approximate_build_break_even_rays} 条射线后才摊销`}。首次点选另付建树成本，默认关闭；不是普通点高程查询、浏览器帧率或 ArcGIS 软件性能。</p>
    <details><summary>15 份结果 · 同时查看小模型的不利结果</summary><div className="hybrid-table-scroll"><table><caption>10 cm 目标 · 每份 1,024 射线 · 原扫描 / 空间筛选耗时比</caption><thead><tr><th>地形</th><th>表示</th><th>区段</th><th>查询耗时比</th><th>额外建树</th></tr></thead><tbody>
      {report.records.map(r=><tr key={`${r.case_id}/${r.family}`}><td>{r.case_name}</td><td>{names[r.family as keyof typeof names]}</td><td>{r.tree.cells.toLocaleString()}</td><td>{r.query_only_ratio.toFixed(2)}×{r.query_only_ratio<1?' · 空间筛选更慢':''}</td><td>{r.hierarchy_extra_build_ms.toFixed(2)} ms</td></tr>)}
    </tbody></table></div></details>
    <p>多于 256 个已发现候选时回到原扫描，避免每次点选建立大型临时索引。页面不会因为这组查询结果宣称 ArcGIS 更慢。</p>
    <div className="hybrid-downloads"><a href="/research/hybrid-terrain/ray-index-results.json" download>原生射线结果 · JSON</a><a href="/research/hybrid-terrain/ray-index-results.csv" download>查询与构建代价 · CSV</a><a href="/research/hybrid-terrain/ray-fixtures.json" download>七组共同射线坐标</a></div>
  </section>;
}
