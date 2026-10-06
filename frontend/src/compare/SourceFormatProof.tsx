import report from '../../../shared/source-multipatch-v1.json';
import {useComparisonAnchor} from './useComparisonAnchor';
const base='/research/source-multipatch-v1/';
const size=(n:number)=>(n/1000).toFixed(2)+' kB';
export default function SourceFormatProof({siteId}:{siteId:string}){
  useComparisonAnchor('source-format-results');
  const site=report.cases.find(s=>s.id===siteId);
  if(!site)return null;
  const saving=100*(1-site.native_p1_bytes/site.bytes);
  return <div id="source-format-results" className="sf-format-proof" aria-label="同几何 ArcGIS 兼容文件对比">
    <div><span>ArcGIS 兼容格式 / 同一三角几何</span><h3>同样 8,192 个三角面，原生文件小 {saving.toFixed(1)}%。</h3>
      <p>GUGIS P1 {size(site.native_p1_bytes)} / 实际 MultiPatch 五文件 {size(site.bytes)}。对照省略可选 M 数组、采用 1 个要素和 64 条向上的三角带，全部源三角面、高程、面积和索引已逐一读回核验。</p>
      <p>这里比较相同 P1 表面的完整磁盘文件；未运行 ArcGIS 软件。同体积的 GUGIS 面带还可保留源双线性函数，原始 P1 三角面则存在内部差。</p>
      <details className="cr-details"><summary>20 样区的同几何格式结果与逐面证据</summary>
        <div className="cr-table"><table><caption>同源 P1 表面 · 全部 20 个固定样区 · 省略可选 M 的 MultiPatch</caption><thead><tr><th>样区</th><th>GUGIS / 五文件 B</th><th>文件减少</th><th>面数</th><th>同几何核验</th></tr></thead><tbody>{report.cases.map(s=><tr key={s.id}><th>{s.name.replace(' · 英国环境署裸地 DTM','')}</th><td>{s.native_p1_bytes.toLocaleString()} / {s.bytes.toLocaleString()}</td><td>{s.saving_percent.toFixed(1)}%</td><td>{s.triangles.toLocaleString()}</td><td>{s.readback.same_8192_source_faces&&s.readback.all_faces_upward?'全部通过':'未通过'}</td></tr>)}</tbody></table></div>
        <img src={base+'same-source-format-results.svg'} loading="lazy" width="1050" height="410" alt="全部20个固定样区的同几何原生P1与省略M数组的实际MultiPatch五文件字节对比，节省32.6%"/>
        <p>按 <a href={report.specification} target="_blank" rel="noreferrer">Esri 规范</a>生成 SHP/SHX/DBF/PRJ/CPG；PyShp {report.independent_reader.version} 读回全部 163,840 个源三角面，无重复或退化面。源行三角带与输出列三角带的三角几何集合完全相同，输出法向向上。PRJ 只记录水平 BNG，ODN/米制约定和源单位警告保存在证据回执中。此文件对照不证明最优编码或 ArcGIS 软件的加载、内存和帧率。</p>
        <div className="cr-actions"><a download href={base+'sites.csv'}>同几何格式结果 CSV ↓</a><a download href={base+'results.json'}>完整 MultiPatch 逐面读回记录 ↓</a></div>
        <p className="cr-hash">格式报告 SHA-256：{report.report_sha256}<br/>ZIP SHA-256：{report.package.sha256}</p>
      </details>
    </div>
    <div className="cr-actions"><a download href={base+site.id+'/'+site.package.filename}>当前 MultiPatch 五文件 ZIP ↓</a><a download href={'/research/source-native-bands-v1/'+site.id+'/source_p1.bin'}>同几何 GUGIS P1 ↓</a><a download href={base+report.package.filename}>20 样区格式证据 ZIP ↓</a><a href="/datasets?dataset=manchester#ruled-terrain-tiles">验证 512 米一米面带分块 ↗</a></div>
  </div>;
}
