import {useState} from 'react';
import originalReport from '../../../shared/multicity-terrain-benchmark.json';
import oxfordReport from '../../../shared/oxford-terrain-benchmark.json';
import cambridgeReport from '../../../shared/cambridge-terrain-benchmark.json';
import liverpoolReport from '../../../shared/liverpool-terrain-benchmark.json';
import sheffieldReport from '../../../shared/sheffield-terrain-benchmark.json';
import leedsReport from '../../../shared/leeds-terrain-benchmark.json';
import {terrainTradeoff,tradeoffText} from './terrainRepresentationDecision';
import {currentTerrainResultLink,rememberTerrainResult} from './terrainResultLink';
const report=originalReport;


const cities={manchester:'曼彻斯特',york:'约克',bath:'巴斯',oxford:'牛津',cambridge:'剑桥',liverpool:'利物浦',sheffield:'谢菲尔德',leeds:'利兹'};
const title=(c:typeof report.cases[number])=>`${cities[c.city_id as keyof typeof cities]} · ${c.site_id==='centre'?'中心':'北侧四分位'}`;
const cost=(n:number)=>`${(n/1000).toFixed(2)} kB`;
const difference=(gain:number)=>Math.abs(gain)<.000001?'体积相同':`${gain>0?'小':'大'} ${Math.abs(gain).toFixed(1)}%`;

export default function MultiCityTerrainResults({target,onTargetChange,dataset='multicity'}:{target:number;onTargetChange:(target:number)=>void;dataset?:'multicity'|'oxford'|'cambridge'|'liverpool'|'sheffield'|'leeds'}){
  const report=dataset==='leeds'?leedsReport:dataset==='sheffield'?sheffieldReport:dataset==='liverpool'?liverpoolReport:dataset==='cambridge'?cambridgeReport:dataset==='oxford'?oxfordReport:originalReport;
  const base=dataset==='multicity'?'/research/multicity-terrain/':`/research/${dataset}-terrain-benchmark/`;
  const [site,setSite]=useState(()=>{const link=currentTerrainResultLink();return link.scope===dataset&&report.cases.some(c=>c.id===link.site)?link.site!:report.cases[0].id;});
  const current=report.cases.find(c=>c.id===site)!;
  const pairs=report.cases.map(c=>({case:c,tri:c.models.find(m=>m.family==='local_triangles'&&m.target_m===target)!,mixed:c.models.find(m=>m.family==='hybrid'&&m.target_m===target)!}));
  const {tri,mixed}=pairs.find(p=>p.case.id===site)!;
  const mp=tri.multipatch!;
  const formatGain=100*(1-tri.bytes/mp.five_component_bytes),mixGain=100*(1-mixed.bytes/tri.bytes);
  const pack=Object.values(report.packages).find(p=>p.filename===site+'.zip')!;
  return <div id={`${dataset}-terrain-results`} className="multicity-results">
    <div className="paper-heading"><div><span className="paper-eyebrow">02 / 跨城对照 · {report.cases.length} 个固定样区</span><h2>相同几何，表示更紧凑。</h2><p>{dataset==='multicity'?'曼彻斯特、约克、巴斯各两个 64 × 64 m 源样区。':`${cities[dataset]}两个预先固定的 64 × 64 m 源样区。`}先比较原生三角带与 MultiPatch，再评估局部分区是否值得采用。</p></div><span className="paper-run-state">ArcGIS 软件运行：待完成</span></div>
    <div className="paper-controls"><label>固定源样区<select aria-label="跨城对标样区" value={site} onChange={e=>{setSite(e.target.value);rememberTerrainResult({scope:dataset,target,site:e.target.value});}}>{report.cases.map(c=><option key={c.id} value={c.id}>{title(c)}</option>)}</select></label><label>同一最大参考误差目标<select aria-label="真实地形结果误差目标" value={target} onChange={e=>onTargetChange(Number(e.target.value))}>{report.targets_m.map(t=><option key={t} value={t}>{t*100} cm</option>)}</select></label></div>
    <div className="paper-city-grid" aria-live="polite"><article><span>{title(current)} · 原生三角带 vs 同几何 MultiPatch</span><strong>小 {formatGain.toFixed(1)}%</strong><p>{cost(tri.bytes)} / {cost(mp.five_component_bytes)}<br/>两者全域 E₂ <b>{tri.e2_m2.toFixed(5)} m²</b><br/>实际三角形 <b>{tri.native_triangles.toLocaleString()}</b> · XYZ 与有序三角带读回一致</p><small>未压缩 JSON 与 SHP / SHX / DBF / PRJ / CPG 五组件总字节。仅三角几何及所列源属性相同，不代表完整元数据等价、内存节省或软件提速。</small></article>
    <article className={mixGain<0?'paper-city-negative':''}><span>局部分区候选（允许直纹面） vs 原生三角带</span><strong>{difference(mixGain)}</strong><p>{cost(mixed.bytes)} / {cost(tri.bytes)}<br/>全域 E₂ <b>{mixed.e2_m2.toFixed(5)} / {tri.e2_m2.toFixed(5)} m²</b><br/>直纹四边形 <b>{mixed.ruled_quads}</b> · 三角形 <b>{mixed.native_triangles}</b></p><small>{mixed.ruled_quads===0?'此档未使用直纹面；差异来自三角分区与编码，不能归为直纹函数收益。':'此档包含原生直纹区段，积分与查询直接作用于保存的函数。'} 两类几何和 E₂ 不相同，体积收益需结合精度判断。</small></article></div>
    <p className="paper-scope" role="status">{tradeoffText[terrainTradeoff(tri,mixed)]}此建议仅针对当前样区、目标与两项指标，不外推到全城或软件速度。</p>
    <div className="multicity-chart"><img src={`${base}${site}-error-cost.png`} alt={`${title(current)}三个误差目标的全域E2与文件代价，展示局部分区、原生三角带及同几何MultiPatch全部结果`}/><p className="paper-scope">同一组固定样区，全部 10 / 25 / 50 cm 档位。横轴为未压缩文件，纵轴为全域 E₂，均为对数轴；越靠左下，表示代价与参考误差越低。</p></div>
    <div className="paper-table-scroll"><table><caption>全部{dataset==='multicity'?'六个':'两个'}样区 · 目标 {target*100} cm · 保留不利结果</caption><thead><tr><th>样区</th><th>原生三角 / kB</th><th>MultiPatch / kB</th><th>同几何节省</th><th>局部分区 / kB</th><th>分区体积变化</th><th>E₂ 三角 / 分区 · m²</th><th>N 三角 / 分区</th><th>分区直纹区段</th><th>最大界 三角 / 分区 · cm</th><th>达标 三角 / 分区</th></tr></thead><tbody>{pairs.map(({case:c,tri:t,mixed:h})=><tr key={c.id} className={c.id===site?'paper-primary-row':undefined}><th scope="row">{title(c)}</th><td>{(t.bytes/1000).toFixed(2)}</td><td>{(t.multipatch!.five_component_bytes/1000).toFixed(2)}</td><td>{(100*(1-t.bytes/t.multipatch!.five_component_bytes)).toFixed(1)}%</td><td>{(h.bytes/1000).toFixed(2)}</td><td>{difference(100*(1-h.bytes/t.bytes))}</td><td>{t.e2_m2.toFixed(4)} / {h.e2_m2.toFixed(4)}</td><td>{t.native_triangles} / {h.native_triangles}</td><td>{h.ruled_quads}</td><td>{(t.continuous_bound_m*100).toFixed(3)} / {(h.continuous_bound_m*100).toFixed(3)}</td><td>{t.target_met?'是':'否'} / {h.target_met?'是':'否'}</td></tr>)}</tbody></table></div>
    <p className="paper-scope">源为 EA 2022 裸地 DTM：源栅格中心列，中心行或北侧四分位行，拟合前固定位置。每个样区完整积分面积 4,096 m²；RMS = E₂ / 64。最大参考界使用 Float64 数值保护，不是区间算术证明。三角模型采用最大误差优先和欧氏最长边，不是论文的 L₂ 选区 / L₁ 选边实现；仅对齐全域 E₂ 与实际 N。真实 DTM 不满足严格凸 C² 假设，也不是独立地面真值。</p>
    <details className="paper-method"><summary>源、坐标、核验与完整下载</summary><p>原生模型 XY 是样区中心的 BNG 偏移，MultiPatch 为绝对 EPSG:27700；Z 均为 ODN 米，不能直接作为城市 ENU 高度导入。每个模型核验 4,096 个固定查询和全部保存控制点，共 {(report.cases.length*6*4096).toLocaleString()} 次样点查询；抽样 RMSE 与全域积分分别记录。允许直纹面的局部分区未保证优于三角法；{dataset==='liverpool'||dataset==='sheffield'||dataset==='leeds'?`${cities[dataset]}六档局部分区中，${report.cases.flatMap(c=>c.models).filter(m=>m.family==='hybrid').reduce((n,m)=>n+m.ruled_quads,0)} 个实际直纹四边形；${report.cases.reduce((n,c)=>n+c.models.filter(m=>m.family==='hybrid'&&m.bytes>c.models.find(t=>t.family==='local_triangles'&&t.target_m===m.target_m)!.bytes).length,0)} 档文件更大。直纹数量、E₂ 与文件体积分别判断，不将纯三角分区的差异归为函数收益。`:dataset==='cambridge'?'剑桥中心 10 cm、北侧 10 / 25 cm 档各含一个直纹四边形；其他三档没有直纹区段。六档局部分区文件均更大，三档全域 E₂ 较低，三档较高，需区分精度与体积。':dataset==='oxford'?'牛津中心 10 cm 档含 17 个直纹四边形；其他五档没有直纹区段。体积与 E₂ 分别判断，不能将纯三角分区差异归为直纹函数收益。':'本轮全部 10 cm 档位的局部分区文件更大。'}</p><p>英国环境署 2022 版权所有，OGL v3.0。完整 ZIP 包含六个原生模型、三档 MultiPatch、源裁片、查询夹具与六份逐点 CSV；ZIP 压缩体积 {cost(pack.bytes)} 不参与上述表示代价比较。ArcGIS 软件计时和 FGDB 运行结果仍待取得。</p><p className="multicity-fingerprint">源 TIFF SHA-256：{current.source_raster_sha256}<br/>当前三角模型 SHA-256：{tri.sha256}<br/>恢复包 SHA-256：{pack.sha256}</p><div className="paper-downloads"><a href={`${base}${site}/${tri.filename}`} download>当前三角带 JSON ↓</a><a href={`${base}${site}/${mixed.filename}`} download>当前局部分区 JSON ↓</a><a href={`${base}${site}/${tri.filename.replace('.json','.queries.csv')}`} download>当前三角模型逐点 CSV ↓</a><a href={`${base}${pack.filename}`} download>此样区完整恢复包 ↓</a></div></details>
    <div className="paper-downloads"><a href={`${base}results.csv`} download>全部 {report.cases.length*6} 组结果 CSV ↓</a><a href={`${base}results.json`} download>生成定义与指纹 ↓</a><a href={`${base}native-query-audit.json`} download>原生查询核验回执 ↓</a><a href={`${base}${site}-error-cost.svg`} download>当前科学曲线 SVG ↓</a></div>
  </div>;
}
