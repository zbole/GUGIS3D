import {useState} from 'react';
import data from '../../../shared/paper-finite-frontier-v1.json';
import ProjectionNativeDemo,{type ProjectionCase,type ProjectionReceipt} from './ProjectionNativeDemo';
import {useComparisonAnchor} from './useComparisonAnchor';
import './PaperProjectionResults.css';
import './PaperFrontierResults.css';

const methods=[
  {id:'p1',label:'原 Iₜ 贪心插值',colour:'#89959d'},
  {id:'fixed_pt',label:'旧固定网格 Pₜ',colour:'#caa781'},
  {id:'adaptive_pt',label:'完整自适应 Pₜ',colour:'#487fba'},
  {id:'before',label:'原方向面带',colour:'#b3a453'},
  {id:'fitted',label:'GUGIS 共享拟合面带',colour:'#158d70'},
  {id:'p2',label:'P₂ 高阶控制',colour:'#8b69af'},
] as const;
type Method=typeof methods[number]['id'];
type Decision={selected:Record<Method,string|null>};
type Counts={wins:number;ties:number;losses:number;only_fitted:number;only_adaptive:number;neither:number};
type Site=Omit<ProjectionCase,'pairs'>&{candidates:Record<Method,string[]>;frontiers:Record<Method,string[]>;provenance:Record<string,number[]>;byte_rows:(Decision&{ceiling_bytes:number})[];error_rows:(Decision&{target_e2_m2:number})[]};
const report=data as unknown as {cases:Site[];defaults:{default_case:string;default_byte_ceiling:number;default_e2_target_m2:number};summary:Record<string,{byte_rows:Counts;error_rows:Counts}>;report_sha256:string;source_report_sha256:string;package:{filename:string;bytes:number;sha256:string};audit:{exhaustive_selections:number;complete_source_files:number}};
const base='/research/paper-finite-frontier-v1/';
const pct=(value:number,baseline:number)=>100*(1-value/baseline);
const size=(n:number)=>n.toLocaleString()+' B';

function FrontierPlot({site,selection}:{site:Site;selection:Decision['selected']}){
  const entries=Object.values(site.models),minX=Math.floor(Math.log2(Math.min(...entries.map(e=>e.binary_bytes)))),maxX=Math.ceil(Math.log2(Math.max(...entries.map(e=>e.binary_bytes)))),minY=Math.floor(Math.log10(Math.min(...entries.map(e=>e.e2_m2)))),maxY=Math.ceil(Math.log10(Math.max(...entries.map(e=>e.e2_m2))));
  const x=(n:number)=>68+640*(Math.log2(n)-minX)/(maxX-minX),y=(n:number)=>42+266*(maxY-Math.log10(n))/(maxY-minY);
  return <figure className="frontier-plot"><svg viewBox="0 0 760 365" role="img" aria-label="六方法全部已保存候选的完整字节与全域E₂对数散点，左下更好">
    {Array.from({length:maxX-minX+1},(_,i)=>minX+i).map(k=><g key={'x'+k}><path d={`M${x(2**k)} 42V308`} stroke="#e6ece7"/><text x={x(2**k)} y="329" textAnchor="middle">{(2**k/1024).toFixed(2).replace(/\.?0+$/,'')} KiB</text></g>)}
    {Array.from({length:maxY-minY+1},(_,i)=>minY+i).map(k=><g key={'y'+k}><path d={`M68 ${y(10**k)}H708`} stroke="#e6ece7"/><text x="59" y={y(10**k)+4} textAnchor="end">10^{k}</text></g>)}
    <text x="68" y="23">全域 E₂ / m² · 越低越好</text><text x="708" y="353" textAnchor="end">完整原生文件 · 越小越好</text>
    {methods.map(m=><g key={m.id}>{site.candidates[m.id].map(key=>{const e=site.models[key],front=site.frontiers[m.id].includes(key),chosen=selection[m.id]===key;return <g key={key}><title>{`${m.label} · ${size(e.binary_bytes)} · E₂ ${e.e2_m2.toExponential(6)} m² · 原 N ${site.provenance[key].join(', ')}${front?' · 有限前沿':' · 被已保存候选支配'}`}</title><circle cx={x(e.binary_bytes)} cy={y(e.e2_m2)} r={chosen?6:front?3.5:2.7} fill={m.colour} fillOpacity={front?1:.3} stroke={chosen?'#173d35':'none'} strokeWidth="1.5" data-method={m.id} data-file={e.binary_filename} data-bytes={e.binary_bytes} data-e2={e.e2_m2}/></g>;})}</g>)}
  </svg><figcaption>左下更好；大圆是当前选择，淡圆是被现有候选支配的模型。只画实际文件，不插值、不外推；每种方法只在原九档保存模型中选择。</figcaption><div className="frontier-legend">{methods.map(m=><span key={m.id}><i style={{background:m.colour}}/>{m.label}</span>)}</div></figure>;
}

export default function PaperFrontierResults(){
  useComparisonAnchor('paper-frontier-results');
  const [field,setField]=useState('anisotropic-quartic'),[angle,setAngle]=useState(30),[mode,setMode]=useState<'error'|'bytes'>('error'),[target,setTarget]=useState(report.defaults.default_e2_target_m2),[ceiling,setCeiling]=useState(report.defaults.default_byte_ceiling),[demo,setDemo]=useState(false);
  const cases=report.cases.filter(c=>c.field.id===field),site=cases.find(c=>c.angle_degrees===angle)!,row=mode==='error'?site.error_rows.find(r=>r.target_e2_m2===target)!:site.byte_rows.find(r=>r.ceiling_bytes===ceiling)!;
  const selected=(method:Method)=>{const key=row.selected[method];return key?site.models[key]:null;},f=selected('fitted'),a=selected('adaptive_pt'),p2=selected('p2'),column=mode==='error'?'binary_bytes':'e2_m2',saving=f&&a?pct(f[column],a[column]):null,counts=report.summary[field][mode==='error'?'error_rows':'byte_rows'];
  const candidates:{label:string;model:ProjectionReceipt|null}[]=[{label:methods[2].label,model:a},{label:methods[4].label,model:f},{label:methods[5].label,model:p2}];
  const entries=candidates.filter((e):e is {label:string;model:ProjectionReceipt}=>e.model!==null);
  const allRows=cases.flatMap(c=>(mode==='error'?c.error_rows:c.byte_rows).map(r=>({c,r}))),paired=counts.wins+counts.ties+counts.losses;
  return <section id="paper-frontier-results" className="frontier-results" aria-labelledby="frontier-title">
    <header><span className="cr-eyebrow">实际完整文件 / 同一误差门槛 / 有限候选前沿</span><h2 id="frontier-title">用空间和精度，直接比较结果。</h2><p>复用已独立核验的两个四次曲面、七个方向和六种方法。完整自适应 Pₜ 按论文的区域优先级与选边规则生成；这里重新整理既有文件，不重新拟合或生成网格。</p></header>
    <div className="frontier-mode" role="group" aria-label="比较条件"><button aria-pressed={mode==='error'} onClick={()=>setMode('error')}>同误差门槛 · 比文件</button><button aria-pressed={mode==='bytes'} onClick={()=>setMode('bytes')}>同空间上限 · 比误差</button></div>
    <div className="frontier-selects"><label>源函数<select aria-label="文件精度对照函数" value={field} onChange={e=>setField(e.target.value)}><option value="anisotropic-quartic">强各向异性四次曲面</option><option value="published-quartic">较均衡四次曲面</option></select></label><label>方向<select aria-label="文件精度对照方向" value={angle} onChange={e=>setAngle(Number(e.target.value))}>{cases.map(c=><option key={c.id} value={c.angle_degrees}>{c.angle_degrees}°</option>)}</select></label>{mode==='error'?<label>全域 E₂ 门槛<select aria-label="全域E₂门槛" value={target} onChange={e=>setTarget(Number(e.target.value))}>{site.error_rows.map(r=><option key={r.target_e2_m2} value={r.target_e2_m2}>≤ {r.target_e2_m2} m²</option>)}</select></label>:<label>完整文件上限<select aria-label="完整文件字节上限" value={ceiling} onChange={e=>setCeiling(Number(e.target.value))}>{site.byte_rows.map(r=><option key={r.ceiling_bytes} value={r.ceiling_bytes}>≤ {size(r.ceiling_bytes)}</option>)}</select></label>}</div>
    <div className="frontier-metrics"><article><span>GUGIS 对完整自适应 Pₜ · {mode==='error'?'完整文件':'全域 E₂'}</span><strong>{saving===null?'暂无成对结果':`${Math.abs(saving).toFixed(2)}%`}<small>{saving===null?'一方或双方没有已保存合格候选':saving>0?'降低':saving<0?'升高':'相同'}</small></strong><p>{f&&a?mode==='error'?`${size(a.binary_bytes)} → ${size(f.binary_bytes)}`:`${a.e2_m2.toExponential(5)} → ${f.e2_m2.toExponential(5)} m²`:'没有将缺失基线当作优势。'}</p></article><article><span>当前函数全部方向与门槛 · 成对获益</span><strong>{counts.wins}/{paired}</strong><p>{counts.losses} 组失利 · {counts.ties} 组相同 · {counts.only_fitted+counts.only_adaptive+counts.neither} 组缺少成对候选</p></article><article className="frontier-control"><span>P₂ 高阶控制</span><strong>{p2?mode==='error'?size(p2.binary_bytes):p2.e2_m2.toExponential(4)+' m²':'没有合格候选'}</strong><p>{p2&&f?p2[column]<f[column]?`当前比 GUGIS ${mode==='error'?'文件更小':'误差更低'}；同屏保留。`:`当前未优于 GUGIS 的${mode==='error'?'文件代价':'全域误差'}。`:'只展示已有合格文件。'}</p></article></div>
    <p className="frontier-condition">当前条件：{mode==='error'?`全域 E₂ ≤ ${target} m²，比较合格文件的最小实际字节。达标误差无需完全相等。`:`完整文件 ≤ ${size(ceiling)}，比较已保存候选的最低全域 E₂。实际文件字节无需相等。`}E₂ 是函数全域 L₂ 误差，不能当作点位最大差或真实地面精度。</p>
    <div className="cr-table"><table><caption>六种方法均在各自原九档保存模型内选择；无合格候选直接显示</caption><thead><tr><th>方法</th><th>完整文件 / B</th><th>全域 E₂ / m²</th><th>存储点 / 原生记录</th><th>原选择 N</th><th>保存模型</th></tr></thead><tbody>{methods.map(m=>{const key=row.selected[m.id],e=key?site.models[key]:null;return <tr key={m.id} className={m.id==='fitted'?'frontier-highlight':undefined}><th>{m.label}</th>{e?<><td>{e.binary_bytes.toLocaleString()}</td><td>{e.e2_m2.toExponential(6)}</td><td>{e.points.toLocaleString()} / {e.records.toLocaleString()}</td><td>{site.provenance[key!].join(', ')}</td><td><a download href={`/research/${e.package}/${site.id}/${e.binary_filename}`}>原生文件 ↗</a></td></>:<td colSpan={5}>已保存候选中无{mode==='error'?'达标':'预算内'}模型</td>}</tr>;})}</tbody></table></div>
    <FrontierPlot site={site} selection={row.selected}/>
    <div className="cr-actions"><button disabled={!f||!a} aria-label="展开文件精度原生同步查询" aria-expanded={demo&&!!f&&!!a} onClick={()=>setDemo(v=>!v)}>{demo?'收起同步查询':'看当前达标文件的同点原生误差'}</button><a download href={`${base}${report.package.filename}`}>全部实际模型与决策 ZIP ↗</a><a href="#paper-adaptive-results">原九档逐预算实验 ↗</a></div>
    {demo&&f&&a&&<ProjectionNativeDemo site={{...site,pairs:[]}} entries={entries}/>}
    <details className="cr-details"><summary>当前函数全部 {allRows.length} 组决策，包括失利与未达标</summary><div className="cr-table"><table><caption>七个方向 × 全部固定门槛 · 缺失不计获益</caption><thead><tr><th>方向 / 门槛</th><th>GUGIS</th><th>完整自适应 Pₜ</th><th>{mode==='error'?'字节降低':'E₂ 降低'}</th></tr></thead><tbody>{allRows.map(({c,r})=>{const fv=c.models[r.selected.fitted!],av=c.models[r.selected.adaptive_pt!];return <tr key={c.id+JSON.stringify(r)}><th>{c.angle_degrees}° / {'target_e2_m2' in r?r.target_e2_m2+' m²':size(r.ceiling_bytes)}</th><td>{fv?mode==='error'?size(fv.binary_bytes):fv.e2_m2.toExponential(5):'无合格候选'}</td><td>{av?mode==='error'?size(av.binary_bytes):av.e2_m2.toExponential(5):'无合格候选'}</td><td>{fv&&av?pct(fv[column],av[column]).toFixed(3)+'%':'不可计算'}</td></tr>;})}</tbody></table></div></details>
    <details className="cr-details"><summary>文件编码、已观察数据、有限搜索与完整证据</summary><p>本轮是已公开结果的后续分析。仅使用六方法每类原九档已保存的选择，不代表全部网格或最优模型；不外推收敛阶，也不宣称优于论文的渐近定理。完整自适应 Pₜ 的独立 XYZ 平面编码会重复存储部分坐标，当前字节结果不能代表最小平面系数编码。GUGIS 面带保持 C⁰，Pₜ 分片可以不连续。函数阶数与编码差异均存在，P₂ 强控制始终可见。</p><p>独立穷举核验了 {report.audit.exhaustive_selections.toLocaleString()} 项选择，核对全部 {report.audit.complete_source_files.toLocaleString()} 个既有 JSON/二进制文件的完整字节及 SHA。ZIP 保存所有相关实际模型、完整决策 CSV、原研究积分/原生查询核验和本轮实现；这是文件与函数误差结果，未新增 RAM、GPU、ArcGIS 软件计时或地面真值测量。</p><div className="cr-actions">{[['protocol.json','固定规则与观察披露'],['all-decisions.csv','全部六方法决策CSV'],['results.json','完整有限候选与前沿'],['independent-audit.json','独立穷举核验']].map(([file,label])=><a key={file} download href={`${base}${file}`}>{label} ↗</a>)}</div><p className="cr-hash">报告 SHA-256：{report.report_sha256}<br/>ZIP SHA-256：{report.package.sha256}</p></details>
  </section>;
}
