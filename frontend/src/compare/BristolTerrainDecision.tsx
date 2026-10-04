import {useEffect,useState} from 'react';
import manifest from '../../../shared/bristol-viewer-models.json';
import {bristolFrontier,bristolModelKey,bristolModelNames,feasibleBristolModels} from './bristolCostSelection';
import './BristolTerrainDecision.css';
const cm=(n:number)=>(100*n).toFixed(3);
export default function BristolTerrainDecision({target}:{target:number}){
  const [caseId,setCaseId]=useState('bristol-harbour'),[bound,setBound]=useState(String(target*100)),[rms,setRms]=useState('');
  useEffect(()=>setBound(String(target*100)),[target]);
  const records=manifest.models.filter(m=>m.case_id===caseId);
  const maxM=Number(bound)/100,rmseM=rms.trim()===''?null:Number(rms)/100;
  const valid=Number.isFinite(maxM)&&maxM>0&&(rmseM===null||(Number.isFinite(rmseM)&&rmseM>0));
  const eligible=feasibleBristolModels(records,maxM,rmseM),best=eligible[0],frontier=new Set(bristolFrontier(records));
  const familyChoices=Object.entries(bristolModelNames).map(([family,name])=>({family,name,model:eligible.find(m=>m.family===family)}));
  const maxBytes=Math.max(...records.map(m=>m.bytes));
  return <section className="bristol-decision" aria-labelledby="bristol-decision-title">
    <span className="hybrid-eyebrow">REAL SOURCE / TWO ERROR CONSTRAINTS / MEASURED COST</span>
    <h3 id="bristol-decision-title">在真实地形上，选符合要求的表示。</h3>
    <p>同一样区的九份已发布模型，先检查连续最大参考界，再同时检查可选的 4,096 点抽查 RMSE。只推荐真实保存且满足要求的档位；不在不同地形之间借用结果。</p>
    <div className="bristol-decision__controls"><label>样区<select aria-label="Bristol 成本决策样区" value={caseId} onChange={e=>setCaseId(e.target.value)}><option value="bristol-harbour">布里斯托港区</option><option value="bristol-brandon-hill">布兰登山坡</option></select></label>
      <label>最大参考误差（cm）<input type="number" step="any" min="0.000001" value={bound} onChange={e=>setBound(e.target.value)} aria-label="Bristol 最大参考误差约束" aria-invalid={!Number.isFinite(maxM)||maxM<=0}/></label>
      <label>RMSE 上限（cm，可留空）<input type="number" step="any" min="0.000001" value={rms} onChange={e=>setRms(e.target.value)} aria-label="Bristol RMSE 约束" aria-invalid={rmseM!==null&&(!Number.isFinite(rmseM)||rmseM<=0)}/></label>
    </div>
    <div className="bristol-decision__result" aria-live="polite">{best?<><strong>{bristolModelNames[best.family as keyof typeof bristolModelNames]} · {(best.bytes/1000).toFixed(2)} kB</strong><span>当前 {eligible.length} / {records.length} 份可行模型中的最小文件。原构建目标 {best.target_m*100} cm；实际参考界 {cm(best.continuous_bound_m)} cm，抽查 RMSE {cm(best.rmse_m)} cm。</span><a href={`/research/bristol-viewer/models/${best.case_id}/${best.filename}`} download>下载当前推荐的原生研究模型 ↓</a></>:<><strong>{valid?'没有已测模型同时满足当前要求。':'请输入大于零的有限误差值。'}</strong><span>不外推未构建的档位，不把 RMSE 代替最大参考误差。可查看下方全部真实测点。</span></>}</div>
    <div className="bristol-decision__bars" aria-label="当前约束下各类表示的文件成本">{familyChoices.map(({family,name,model})=><div key={family}><span>{name}</span><div>{model&&<i style={{width:`${100*model.bytes/maxBytes}%`}}/>}</div><strong>{model?`${(model.bytes/1000).toFixed(2)} kB`:'无可行档位'}</strong></div>)}</div>
    <div className="hybrid-table-scroll"><table><caption>{records[0]?.case_name} · 三种表示的全部已测档位</caption><thead><tr><th>表示 / 原目标</th><th>原生文件</th><th>参考界 / RMSE</th><th>当前要求</th><th>联合已测前沿</th></tr></thead><tbody>{[...records].sort((a,b)=>a.target_m-b.target_m||a.family.localeCompare(b.family)).map(m=><tr key={bristolModelKey(m)} className={best?.sha256===m.sha256?'is-smallest':''}>
      <th>{bristolModelNames[m.family as keyof typeof bristolModelNames]} / {m.target_m*100} cm</th><td>{(m.bytes/1000).toFixed(2)} kB</td><td>{cm(m.continuous_bound_m)} / {cm(m.rmse_m)} cm</td><td>{eligible.some(e=>e.sha256===m.sha256)?'满足':'不满足'}</td><td>{frontier.has(bristolModelKey(m))?'是':'否'}</td></tr>)}</tbody></table></div>
    <p className="hybrid-limit">联合前沿只判断已测候选：不存在另一份文件同时不更大、参考界不更高、RMSE 不更高，并至少一项更优。模型可能代表不同曲面；相同误差预算的成本比较不是同几何的格式收益，也不保证全局最优。RMSE 是固定坐标的抽查结果；参考界相对源 DTM 双线性面，两者都不是独立地面实测精度。这里不含 ArcGIS 软件耗时、GPU 或内存比较。</p>
  </section>;
}
