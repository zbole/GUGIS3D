import {useEffect,useState} from 'react';
import report from '../../../shared/terrain-error-cost.json';
import './terrainTradeoff.css';
export type ErrorMetric='bound_m'|'rmse_m';
type RecordPoint=typeof report.cases[number]['records'][number];
const names:Record<string,string>={hybrid:'原混合',compact_hybrid:'紧凑混合',local_triangles:'局部三角',multipatch:'MultiPatch 五件套'};
const cm=(n:number)=>(n*100).toFixed(3);
export function leastCost(records:RecordPoint[],metric:ErrorMetric,budgetM:number){
  if(!Number.isFinite(budgetM)||budgetM<=0)return [];
  return Object.keys(names).flatMap(family=>{
    const eligible=records.filter(r=>r.family===family&&r[metric]<=budgetM)
      .sort((a,b)=>a.bytes-b.bytes||a[metric]-b[metric]||a.id.localeCompare(b.id));
    return eligible.length?[eligible[0]]:[];
  }).sort((a,b)=>a.bytes-b.bytes||a[metric]-b[metric]||a.id.localeCompare(b.id));
}
export default function TerrainTradeoff({caseId,target}:{caseId:string;target:number}){
  const [metric,setMetric]=useState<ErrorMetric>('bound_m');
  const [budget,setBudget]=useState(String(target*100));
  useEffect(()=>setBudget(String(target*(metric==='bound_m'?100:20))),[caseId,target,metric]);
  useEffect(()=>{
    if(typeof window==='undefined'||window.location?.hash!=='#terrain-error-cost')return;
    const frame=window.requestAnimationFrame(()=>document.getElementById('terrain-error-cost')?.scrollIntoView());
    return()=>window.cancelAnimationFrame(frame);
  },[]);
  const data=report.cases.find(c=>c.id===caseId);
  if(!data)return null;
  const budgetM=Number(budget)/100;
  const choices=leastCost(data.records,metric,budgetM),best=choices[0];
  const frontier=new Set(data.frontiers[metric]);
  const file=`/research/hybrid-terrain/tradeoff/${caseId}-${metric}`;
  return <section id="terrain-error-cost" className="terrain-tradeoff" aria-labelledby="terrain-tradeoff-title">
    <span className="hybrid-eyebrow">PRECISION × COST / OBSERVED FRONTIER</span><h3 id="terrain-tradeoff-title">先定误差要求，再看文件成本</h3>
    <p>把四档已保存模型放在同一张精度—成本图上。圈出的点表示已测数据中没有另一个点同时更小、误差更低；它不是所有可能模型的最优解。每个样本沿用同一组 4,096 个查询坐标。</p>
    <div className="tradeoff-controls"><label>约束指标<select aria-label="精度成本指标" value={metric} onChange={e=>setMetric(e.target.value as ErrorMetric)}><option value="bound_m">连续参考最大误差界</option><option value="rmse_m">离网格抽查 RMSE</option></select></label><label>允许误差（cm）<input aria-label="精度成本允许误差厘米" type="number" min="0.000001" step="any" value={budget} onChange={e=>setBudget(e.target.value)} aria-invalid={!Number.isFinite(budgetM)||budgetM<=0}/></label><span>{metric==='bound_m'?'检查参考区域上的最大误差上界。':'RMSE 仅描述这组坐标的平均误差，不能保证每一点的最大误差。'}</span></div>
    <div className="tradeoff-recommendation" aria-live="polite">{best?<><strong>已测档位中的最小文件：{names[best.family]} · {(best.bytes/1000).toFixed(2)} kB</strong><span>原构建目标 {best.target_m*100} cm；实际参考界 {cm(best.bound_m)} cm；抽查 RMSE {cm(best.rmse_m)} cm。{metric==='rmse_m'?'当前只按 RMSE 筛选，最大误差要求需另行核对。':'当前按参考最大误差界筛选。'}</span></>:<><strong>当前要求下，没有已测档位满足约束。</strong><span>不外推不存在的模型，不把较小 RMS 当成最大误差达标。</span></>}</div>
    <figure><img src={`${file}.png`} loading="lazy" width={1500} height={825} alt={`${data.name}的${metric==='bound_m'?'最大参考误差界':'抽查 RMSE'}与完整文件成本科学图`}/><figcaption>横轴为完整未压缩文件；纵轴为所选误差，两轴对数刻度。连线只连接已测点，不作插值保证。接近零的绘图下限标在图中，不改变表格数值和筛选。</figcaption></figure>
    <div className="hybrid-table-scroll"><table><caption>每种表示在当前约束下的最小已测档位</caption><thead><tr><th>表示</th><th>原构建目标</th><th>完整成本</th><th>参考界 / RMSE</th><th>已测前沿</th></tr></thead><tbody>{Object.keys(names).filter(family=>data.records.some(r=>r.family===family)).map(family=>{
      const candidate=choices.find(r=>r.family===family);
      return <tr key={family}><th>{names[family]}</th>{candidate?<><td>{candidate.target_m*100} cm</td><td>{(candidate.bytes/1000).toFixed(2)} kB</td><td>{cm(candidate.bound_m)} / {cm(candidate.rmse_m)} cm</td><td>{frontier.has(candidate.id)?'是':'否'} · <a href={candidate.download} download>取走模型 ↓</a></td></>:<td colSpan={4}>没有已测档位满足当前约束</td>}</tr>;
    })}</tbody></table></div>
    <details className="hybrid-method"><summary>展开全部测点与公平比较边界</summary><p>原混合与紧凑混合保留同一曲面；局部三角使用不同的更强候选族。解析函数允许局部二分中点直接求值，网格混合仍限制在源控制网；瑞士样本双方查询相同的栅格双线性参考，没有新增真实观测。解析界计入五位小数高程舍入；参考栅格界计入实际保存模型与浮点保护量，均未声称区间算术机器证明。</p><p>前沿按所选误差判定，误差差异不超过 {report.error_tie_tolerance_m} m 按数值平局处理；可行性筛选仍要求记录值不超过输入阈值。原构建目标未达标的记录仍保留真实参考界，不根据目标标签冒充达标。成本不含 ZIP 压缩或软件运行内存；MultiPatch 使用上节同几何五件套，不含可选原档恢复侧车。未运行 ArcGIS Pro。</p>
      <div className="hybrid-table-scroll"><table><caption>{data.name} · 所有真实保存的测点</caption><thead><tr><th>表示 / 原目标</th><th>原目标达标</th><th>完整成本 kB</th><th>参考界 cm</th><th>RMSE cm</th><th>当前指标前沿</th></tr></thead><tbody>{data.records.map(r=><tr key={r.id}><th>{names[r.family]} / {r.target_m*100} cm</th><td>{r.build_target_met?'是':'否'}</td><td>{(r.bytes/1000).toFixed(2)}</td><td>{cm(r.bound_m)}</td><td>{cm(r.rmse_m)}</td><td>{frontier.has(r.id)?'是':'否'}</td></tr>)}</tbody></table></div>
    </details>
    <div className="hybrid-downloads"><a href={`${file}.png`} download>当前科学图 PNG ↓</a><a href={`${file}.svg`} download>可编辑科学图 SVG ↓</a><a href="/research/hybrid-terrain/terrain-error-cost.csv" download>88 个测点 CSV ↓</a><a href="/research/hybrid-terrain/terrain-error-cost.json" download>成本与前沿回执 JSON ↓</a></div>
  </section>;
}
