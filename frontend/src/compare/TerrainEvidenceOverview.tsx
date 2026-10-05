import multicity from '../../../shared/multicity-terrain-benchmark.json';
import oxford from '../../../shared/oxford-terrain-benchmark.json';
import cambridge from '../../../shared/cambridge-terrain-benchmark.json';
import liverpool from '../../../shared/liverpool-terrain-benchmark.json';
import sheffield from '../../../shared/sheffield-terrain-benchmark.json';
import leeds from '../../../shared/leeds-terrain-benchmark.json';
import nottingham from '../../../shared/nottingham-terrain-benchmark.json';
import {terrainEvidenceTotals} from './terrainEvidenceTotals';
import type {TerrainResultScope} from './terrainResultLink';
const groups=[{scope:'multicity',name:'曼彻斯特 / 约克 / 巴斯',report:multicity},{scope:'oxford',name:'牛津',report:oxford},{scope:'cambridge',name:'剑桥',report:cambridge},{scope:'liverpool',name:'利物浦',report:liverpool},{scope:'sheffield',name:'谢菲尔德',report:sheffield},{scope:'leeds',name:'利兹',report:leeds},{scope:'nottingham',name:'诺丁汉',report:nottingham}] as const;
export default function TerrainEvidenceOverview({target,onSelect}:{target:number;onSelect:(scope:TerrainResultScope)=>void}){
  const totals=terrainEvidenceTotals(groups.map(g=>g.report),target);
  return <section className="terrain-evidence-overview" aria-label="跨城证据汇总">
    <div className="paper-heading"><div><span className="paper-eyebrow">跨城证据 / 当前目标 {target*100} cm</span><h2>文件收益已验证，混合表示按地形选择。</h2><p>{totals.cityCount} 座城市 · {totals.siteCount} 个预先固定样区 · 每处完整 4,096 m²。先看完整证据，再查看具体样区。</p></div></div>
    <dl className="terrain-evidence-cards">
      <div><dt>同几何三角带 / MultiPatch 五组件</dt><dd>小 {totals.formatSavingPercent.toFixed(1)}%</dd><p>{(totals.triangleBytes/1000).toFixed(2)} / {(totals.multipatchBytes/1000).toFixed(2)} kB · {totals.siteCount} 对文件字节分别求和后计算；不是百分比平均或全城压缩率。</p></div>
      <div><dt>文件与全域 E₂ 同时不劣</dt><dd>{totals.mixedDominates} / {totals.siteCount}</dd><p>局部分区候选；原生三角带同时不劣 {totals.trianglesDominate} 档，取舍 {totals.tradeoffs} 档，相同 {totals.equal} 档。几何不同，不代替同几何格式对照。</p></div>
      <div><dt>实际使用直纹函数的候选</dt><dd>{totals.withRuled} / {totals.siteCount}</dd><p>共 {totals.ruledQuads} 个直纹四边形。纯三角分区的收益不归为函数收益；面带记录数不等于实际三角形 N。</p></div>
    </dl>
    <p className="paper-scope">本汇总仅含统一构建流程的 {totals.cityCount} 城、{totals.siteCount} 个固定样区，布里斯托原始实验在下方单列；不是全城或随机总体估计。文件表示、精度取舍与 ArcGIS 软件运行分别判断，软件耗时和内存尚无实测结果。</p>
    <details className="paper-method"><summary>展开各城结果与汇总计算</summary><p>同几何节省 = 1 − Σ 原生三角带字节 / Σ MultiPatch 五组件字节。每对 XYZ 与带分组核验一致；选定源属性一致，完整元数据不等价。所有达标模型都纳入当前档位，正负结果保留。精度比较采用全域 E₂，不汇总不同样区的抽查 RMSE。</p><ul className="terrain-evidence-groups">{groups.map(g=>{const t=terrainEvidenceTotals([g.report],target);return <li key={g.scope}><span>{g.name} · {t.siteCount} 处 · 同几何小 {t.formatSavingPercent.toFixed(1)}% · 分区同时不劣 {t.mixedDominates}/{t.siteCount}</span><button type="button" onClick={()=>onSelect(g.scope)}>查看{g.name}证据</button></li>;})}</ul></details>
  </section>;
}
