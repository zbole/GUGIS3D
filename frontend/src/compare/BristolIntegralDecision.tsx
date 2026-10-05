import {useState} from 'react';
import report from '../../../shared/bristol-global-l2.json';
import {selectIntegralCandidates} from './integralCostSelection';

const names={global_compact:'原全局紧凑混合',local_triangles:'局部三角带',local_compact:'新局部紧凑混合'};

export default function BristolIntegralDecision(){
  const [caseId,setCaseId]=useState('bristol-harbour'),[maximum,setMaximum]=useState('10'),[e2,setE2]=useState('');
  const candidates=report.models.filter(m=>m.case_id===caseId);
  const maxM=maximum.trim()===''?NaN:Number(maximum)/100;
  const e2Limit=e2.trim()===''?null:Number(e2);
  const valid=Number.isFinite(maxM)&&maxM>0&&(e2Limit===null||Number.isFinite(e2Limit)&&e2Limit>0);
  const feasible=selectIntegralCandidates(candidates,maxM,e2Limit);
  const winner=feasible[0];
  return <article className="paper-integral-decision" aria-labelledby="integral-decision-title">
    <div className="paper-heading"><div><span className="paper-eyebrow">从结果作决定</span><h3 id="integral-decision-title">同时约束局部最大误差与全域 E₂。</h3><p>在该样区九份已发布模型中，选择满足两项约束的最小原生文件。</p></div></div>
    <div className="paper-controls"><label>样区<select aria-label="全域积分决策样区" value={caseId} onChange={e=>setCaseId(e.target.value)}><option value="bristol-harbour">布里斯托港区</option><option value="bristol-brandon-hill">布兰登山坡</option></select></label><label>最大参考界 / cm<input aria-label="全域积分最大参考界" type="number" min="0.001" step="any" value={maximum} onChange={e=>setMaximum(e.target.value)}/></label><label>E₂ 上限 / m²（可选）<input aria-label="全域积分E2上限" type="number" min="0.000001" step="any" placeholder="留空仅约束最大参考界" value={e2} onChange={e=>setE2(e.target.value)}/></label></div>
    <div className="paper-integral-verdict" role="status" aria-live="polite">{!valid?<p>请输入大于零的有限最大参考界；E₂ 可留空，填写时也需大于零。</p>:winner?<><strong>{names[winner.family as keyof typeof names]} · {(winner.bytes/1000).toFixed(2)} kB</strong><p>全域 E₂ {winner.e2_m2.toFixed(5)} m² · 最大参考界 {(winner.continuous_bound_m*100).toFixed(3)} cm<br/>全域 RMS {(winner.rms_integral_m*100).toFixed(3)} cm · {feasible.length} / {candidates.length} 份候选满足约束</p><a href={`/research/bristol-viewer/models/${winner.case_id}/${winner.filename}`} download>下载所选原生模型 ↓</a><small>模型 SHA-256 {winner.sha256}</small></>:<p>没有已测模型同时满足约束。不会以超限模型替代，也不推断未测细分档位。</p>}</div>
    <details className="paper-method"><summary>全部九份候选的约束核对</summary><div className="paper-table-scroll"><table><caption>满足约束按实际档案大小排序；未达标也保留</caption><thead><tr><th>表示 / 原构建目标</th><th>文件 / kB</th><th>全域 E₂ / m²</th><th>最大界 / cm</th><th>约束状态</th></tr></thead><tbody>{[...candidates].sort((a,b)=>a.bytes-b.bytes).map(m=><tr key={m.sha256}><th>{names[m.family as keyof typeof names]} / {m.target_m*100} cm</th><td>{(m.bytes/1000).toFixed(2)}</td><td>{m.e2_m2.toFixed(5)}</td><td>{(m.continuous_bound_m*100).toFixed(3)}</td><td>{!valid?'输入无效':feasible.some(f=>f.sha256===m.sha256)?'满足':'超限'}</td></tr>)}</tbody></table></div></details>
    <p className="paper-scope">E₂ = √∫误差²，面积固定为 4,096 m²，RMS = E₂ / 64。这里约束的是源 DTM 双线性参考面；不是独立地面测量精度。推荐仅在有限候选集内成立，不保证全局最优或 ArcGIS 性能优势。</p>
  </article>;
}
