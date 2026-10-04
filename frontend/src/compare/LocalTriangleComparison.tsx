import report from '../../../shared/local-triangle-benchmark.json';
const kb=(n:number)=>(n/1000).toFixed(2);
const cm=(n:number)=>(n*100).toFixed(3);
const median=(a:number[])=>[...a].sort((a,b)=>a-b)[Math.floor(a.length/2)];
export function localTrianglePair(caseId:string,target:number){
  return report.cases.find(c=>c.id===caseId)?.variants.find(p=>p.target_m===target);
}
export function localTriangleOutcome(caseId:string,target:number){
  const pair=localTrianglePair(caseId,target);
  if(!pair)return '真实 DEM 的局部三角连续误差界仍待补齐，本项暂不比较。';
  if(!pair.comparison_eligible||pair.native_file_saving_percent===null)return '未通过同误差核验，暂不比较。';
  if(pair.native_file_saving_percent===0)return '两者完整文件一样大。';
  return `混合文件${pair.native_file_saving_percent>0?'减少':'增加'} ${Math.abs(pair.native_file_saving_percent).toFixed(1)}%。`;
}
export default function LocalTriangleComparison({caseId,target}:{caseId:string;target:number}){
  const data=report.cases.find(c=>c.id===caseId),pair=localTrianglePair(caseId,target);
  if(!data||!pair)return <section id="local-triangle-audit" className="local-triangle-audit"><h3>更强的局部三角对照 · 待补齐真实 DEM</h3><p>{localTriangleOutcome(caseId,target)}先完成解析样本的连续误差界与相容剖分；不将其优势代入真实地形。</p></section>;
  const a=pair.hybrid,b=pair.local_triangles,loss=(pair.native_file_saving_percent??0)<0;
  return <section id="local-triangle-audit" className={`local-triangle-audit${loss?' has-loss':''}`} aria-labelledby="local-triangle-title">
    <span className="hybrid-eyebrow">STRONGER BASELINE / CONFORMING LOCAL BISECTION</span>
    <h3 id="local-triangle-title">换成局部三角剖分，优势还成立吗？</h3>
    <p>相同 {target*100} cm 最大误差目标，比较当前混合模型与逐三角形局部细分。保持共享边连续，并把相邻三角形合成三角带；不再要求整行或整列一起细分。</p>
    <div className="local-triangle-result" aria-live="polite"><strong>{localTriangleOutcome(caseId,target)}</strong><span>统一元数据的完整原生 JSON：混合 {kb(a.bytes)} kB / 局部三角 {kb(b.bytes)} kB。</span></div>
    <div className="local-triangle-models"><figure><img loading="lazy" src={`/research/hybrid-terrain/${caseId}-hybrid-${target}m.png`} alt={`${data.name}的原混合模型拓扑`}/><figcaption>混合 · {a.points.toLocaleString()} 点 · {a.patches.toLocaleString()} 面片</figcaption></figure>
      <figure><img loading="lazy" src={`/research/hybrid-terrain/${caseId}-local-triangles-${target}m.png`} alt={`${data.name}的实际局部相容三角剖分`}/><figcaption>局部三角 · {b.points.toLocaleString()} 点 · {b.triangles.toLocaleString()} 三角形 / {b.patches.toLocaleString()} 三角带</figcaption></figure></div>
    <div className="hybrid-table-scroll"><table><caption>更强候选族 · {data.name} · {target*100} cm 目标</caption><thead><tr><th>实测项目</th><th>混合原生面带</th><th>局部相容三角带</th></tr></thead><tbody>
      <tr><th>构建 / 离网格目标</th><td>{a.target_met&&a.offgrid.meets_sampled_target?'均通过':'未全部通过'}</td><td>{b.target_met&&b.offgrid.meets_sampled_target?'均通过':'未全部通过'}</td></tr>
      <tr><th>源网格 RMSE / 最大差</th><td>{cm(a.source_grid.rmse_m)} / {cm(a.source_grid.max_absolute_m)} cm</td><td>{cm(b.source_grid.rmse_m)} / {cm(b.source_grid.max_absolute_m)} cm</td></tr>
      <tr><th>4,096 个相同连续坐标 RMSE / 最大差</th><td>{cm(a.offgrid.rmse_m)} / {cm(a.offgrid.max_absolute_m)} cm</td><td>{cm(b.offgrid.rmse_m)} / {cm(b.offgrid.max_absolute_m)} cm</td></tr>
      <tr><th>构建与结构校验 · Python</th><td>{a.build_and_validate_ms.toFixed(2)} ms · 原构建记录</td><td>{b.build_and_validate_ms.toFixed(2)} ms · 本轮构建</td></tr>
      <tr><th>4,096 次原生查询中位耗时 · Node</th><td>{median(a.offgrid.query_repetitions_ms).toFixed(2)} ms</td><td>{median(b.offgrid.query_repetitions_ms).toFixed(2)} ms</td></tr>
      <tr><th>留存索引堆增量 · V8</th><td>{kb(a.offgrid.retained_index_heap_bytes)} kB</td><td>{kb(b.offgrid.retained_index_heap_bytes)} kB</td></tr>
      <tr><th>邻接边同步细分 / 最长边保护次数</th><td>全局相容分区</td><td>{b.closure_splits.toLocaleString()} / {b.longest_edge_safeguards.toLocaleString()}</td></tr>
      <tr><th>独立读回与网站内核最大差</th><td>{a.offgrid.decoded_kernel_max_difference_m.toExponential(2)} m</td><td>{b.offgrid.decoded_kernel_max_difference_m.toExponential(2)} m</td></tr>
    </tbody></table></div>
    <details className="hybrid-method"><summary>论文决策、成本公平性和更强对照的边界</summary>
      <p>每次选择连续误差界最大的三角形。凸碗使用论文中的精确 L¹ 插值误差减少量选边；其他解析样本用七点正权求积近似绝对 L¹ 误差，子三角误差界改善不足 1% 时改切最长边。相邻面同步切同一条边以消除悬挂点；这增加了论文原算法之外的保护与相容成本，不能直接借用其渐近最优证明。</p>
      <p>两份实际保存档案使用相同元数据，包含全部坐标、共享索引、面带和隐含邻接。原混合几何未变；算法来源、原档案 SHA-256、细分历史保存在双方共同的实验回执中。局部三角保留二分产生的精确浮点 XY，较多小数位的成本也计入文件。</p>
      <p>局部三角在二分中点求已知解析函数值，部分控制点不在原 65 × 65 源网格上；这是更强的函数访问和候选族，不能当作只改变一个算法参数的消融实验。构建计时不是配对速度测试；索引堆不包含浏览器或 GPU；未运行 ArcGIS Pro。</p>
      <div className="hybrid-table-scroll"><table><caption>全部四档，不隐藏结果反转</caption><thead><tr><th>目标</th><th>混合 / 局部点数</th><th>混合 / 局部 kB</th><th>混合文件变化</th></tr></thead><tbody>{data.variants.map(v=><tr key={v.target_m}><th>{v.target_m*100} cm</th><td>{v.hybrid.points} / {v.local_triangles.points}</td><td>{kb(v.hybrid.bytes)} / {kb(v.local_triangles.bytes)}</td><td>{localTriangleOutcome(caseId,v.target_m)}</td></tr>)}</tbody></table></div>
    </details>
    <div className="hybrid-downloads"><a href={`/research/hybrid-terrain/${caseId}-local-triangles.zip`} download>下载统一元数据的全部配对模型与回执 ↓</a><a href="/research/hybrid-terrain/local-triangle-results.json" download>完整局部对照 JSON ↓</a><a href="/research/hybrid-terrain/local-triangle-results.csv" download>48 份模型 CSV ↓</a></div>
  </section>;
}
