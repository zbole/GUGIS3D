import {useState} from 'react';
import report from '../../../shared/dem-curved-grid-control-v1.json';
import './DemCurvedGridControl.css';
const base='/research/dem-curved-grid-v1/';
export default function DemCurvedGridControl(){
  const [target,setTarget]=useState(.1);
  const pairs=report.cases.flatMap(c=>c.pairs),eligible=pairs.filter(p=>p.selected);
  return <div className="nq-dtm-control">
    <p>解析函数的结构收益需要经过真实数据验证。这组控制试验保留十座城市的全部 20 个固定 65 × 65 源像素窗口，每个窗口检查 98 种规则二次直纹面网格，比较 10 / 25 / 50 cm 三档已保存的自适应 P1 三角带。</p>
    <p><strong>{eligible.length} / {pairs.length} 个完整文件预算能容纳面带候选；其中 {eligible.filter(p=>p.e2_reduction_percent!>0).length} 个获得更低 E₂。</strong>同时满足三角网实际最大误差界和文件预算的候选为 {pairs.filter(p=>p.best_e2_with_maximum_gate).length} 个。规则面带在这些窗口上尚未胜出，后续需要依据局部地形选择表示方式。</p>
    <label className="nq-dtm-choice">查看 P1 最大误差目标 <select aria-label="真实DTM面带控制误差目标" value={target} onChange={e=>setTarget(Number(e.target.value))}>{report.targets_m.map(t=><option key={t} value={t}>{Math.round(t*100)} cm</option>)}</select></label>
    <div className="cr-table"><table><caption>全部 20 个固定样区 · 相同完整 JSON 文件预算 · E₂ 比值小于 1 才有精度优势</caption><thead><tr><th>城市 / 固定样区</th><th>GUGIS / P1 文件 B</th><th>E₂ 比值</th><th>最大误差界 m · GUGIS / P1</th><th>已核验模型</th></tr></thead><tbody>{report.cases.map(c=>{const p=c.pairs.find(p=>p.target_m===target)!,s=p.selected;return <tr key={c.id}><th>{c.name}</th><td>{s?`${s.bytes.toLocaleString()} / ${p.baseline.bytes.toLocaleString()}`:`无适配候选 / ${p.baseline.bytes.toLocaleString()}`}</td><td>{s?(s.e2_m2/p.baseline.e2_m2).toFixed(3):'—'}</td><td>{s?`${s.continuous_bound_m.toFixed(4)} / ${p.baseline.continuous_bound_m.toFixed(4)}`:`— / ${p.baseline.continuous_bound_m.toFixed(4)}`}</td><td><a download href={`${base}${c.id}/${p.baseline.filename}`}>P1 ↓</a>{s&&<> · <a download href={`${base}${c.id}/${s.id}.json`}>面带 ↓</a></>}</td></tr>;})}</tbody></table></div>
    <p>双方使用相同精简原生 JSON 外壳。P1 的原有几何和五位小数高程完整保留，二次面带使用未舍入的源 Float64 高程；序列化精度是本控制的一个限制。有限网格池并非最优面带算法，也没有测量构建耗时。</p>
    <p>全域 E₂ 相对原始 1 m 栅格的连续逐格双线性曲面计算。最大误差检查包括源像素格内的二次驻点，并加入 Float64 数值余量；它不是实测地面精度或区间算术证明。这些 C₀ 地形不符合论文严格凸 C² 假设，P1 基线也不是论文作者的软件或 ArcGIS 实测。</p>
    <img src={`${base}real-dtm-control.svg`} loading="lazy" width="820" height="790" alt="真实DTM全部20样区三档文件预算下的面带与自适应三角网全域E2比值；全部可容纳候选的比值大于1，四档标为无适配文件"/>
    <div className="cr-actions"><a download href={`${base}pairs.csv`}>全部 60 组对照 CSV ↓</a><a download href={`${base}results.json`}>全部 1,960 个候选记录 ↓</a><a download href={`${base}${report.package.filename}`}>模型、源窗口和复核源码 ZIP ↓</a></div>
    <p className="cr-hash">完整记录 SHA-256：{report.report_sha256}<br/>证据 ZIP SHA-256：{report.package.sha256}</p>
  </div>;
}
