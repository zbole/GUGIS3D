import { useEffect, useState } from 'react';
import report from '../../../shared/implicit-terrain-benchmark.json';
import offgrid from '../../../shared/implicit-terrain-offgrid.json';
import indexReport from '../../../shared/terrain-index-benchmark.json';
import packing from '../../../shared/implicit-terrain-packing.json';
import joined from '../../../shared/implicit-terrain-joined.json';
import './implicitTerrainBenchmark.css';

const median = (values: number[]) => [...values].sort((a, b) => a-b)[Math.floor(values.length/2)];
const mb = (bytes: number) => (bytes/1e6).toFixed(3);
const cm = (metres: number) => (metres*100).toFixed(2);

export default function ImplicitTerrainBenchmark() {
  const [stride, setStride] = useState(8);
  useEffect(() => {
    // This section is lazy loaded, after the browser's initial hash scroll.
    if (typeof window === 'undefined') return;
    const id = window.location?.hash?.slice(1) ?? '';
    if (!['implicit-terrain','offgrid-audit','native-index-audit','research-format-audit'].includes(id)) return;
    const frame = window.requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView());
    return () => window.cancelAnimationFrame(frame);
  }, []);
  const selected = report.variants.find(v => v.stride_m === stride)!;
  const selectedOffgrid = offgrid.variants.find(v => v.stride_m === stride)!;
  const selectedIndex = indexReport.reports.find(v => v.stride_m === stride)!;
  const selectedPacking = packing.variants.find(v => v.stride_m === stride)!;
  const selectedJoined = joined.variants.find(v => v.stride_m === stride)!;
  const spg = report.spg;
  const saving = (1-selected.bytes/spg.bytes)*100;
  const points = [...report.variants.map(v => ({ ...v, color: '#227a6b', label: `${v.stride_m} m` })),
    { ...spg, id: 'spg', color: '#bc704b', label: 'SPG' }];
  const sx = (bytes: number) => 55 + (Math.log10(bytes)-4)/3.4*530;
  const sy = (error: number) => 236 - (Math.log10(error)+1.5)/2*190;
  return <section id="implicit-terrain" className="research-benchmark" aria-labelledby="research-title">
    <div className="research-heading"><div><span className="research-eyebrow">REPRODUCIBLE TERRAIN BENCHMARK / 01</span>
      <h2 id="research-title">从论文方法，走到同源实测。</h2><p>采用 ImplicitTerrain 作者公开的瑞士 DEM 与预训练 SPG，在本机重建与 GUGIS 对照。独立研究样本，不代表英国城市地形。</p></div>
      <a href={report.sources.project} target="_blank" rel="noreferrer">查看原论文项目 ↗</a></div>
    <div className="research-badges"><span>真实 DEM · 1 km²</span><span>1,000,000 个同源采样点</span><span>本机 CPU 复现</span><span>ArcGIS 软件运行待测</span></div>
    <div className="research-selector"><label htmlFor="research-stride">GUGIS 控制网采样间距</label>
      <select id="research-stride" value={stride} onChange={e => setStride(Number(e.target.value))}>{report.variants.map(v => <option key={v.id} value={v.stride_m}>{v.stride_m} m · {v.points.toLocaleString()} 个控制点</option>)}</select>
      <span>保留末端边界；直纹面带 + 三角带；从保存档案读回求值。</span><a href="#offgrid-audit">核验原始 0.5 m 数据 ↓</a><a href="#native-index-audit">查询内核更新 ↓</a></div>
    <div className="research-kpis" aria-live="polite">
      <article><small>GUGIS · {stride} m RMSE</small><strong>{cm(selected.metrics.rmse_m)}<em> cm</em></strong><span>SPG {cm(spg.metrics.rmse_m)} cm</span></article>
      <article><small>完整表达文件</small><strong>{mb(selected.bytes)}<em> MB</em></strong><span>SPG 两个权重 + 恢复元数据 {mb(spg.bytes)} MB</span></article>
      <article><small>{saving >= 0 ? '相对 SPG 的文件减少' : '相对 SPG 的文件增加'}</small><strong>{Math.abs(saving).toFixed(1)}<em>%</em></strong><span>请同时检查精度；文件尺寸不是内存</span></article>
      <article><small>原生档案构建与校验</small><strong>{selected.build_ms.toFixed(1)}<em> ms</em></strong><span>SPG 为已有权重，训练耗时尚未测量</span></article>
    </div>
    <div className="research-visuals">
      <figure className="research-tradeoff"><figcaption><strong>精度与存储的取舍</strong><span>左下角更好 · 双对数坐标 · 全部六档公开</span></figcaption>
        <svg viewBox="0 0 650 290" role="img" aria-label="GUGIS 六档控制网与 SPG 的文件大小、RMSE散点图">
          {[.05,.1,.5,1,2].map(e => <g key={e}><path d={`M55 ${sy(e)} H610`} stroke="#e2e8e5"/><text x="45" y={sy(e)+4} textAnchor="end">{e}</text></g>)}
          {[.02,.1,1,10].map(m => <g key={m}><path d={`M${sx(m*1e6)} 24 V244`} stroke="#edf0ee"/><text x={sx(m*1e6)} y="265" textAnchor="middle">{m} MB</text></g>)}
          <text x="15" y="15">RMSE (m)</text>
          <polyline fill="none" stroke="#227a6b" strokeWidth="2" points={report.variants.map(v => `${sx(v.bytes)},${sy(v.metrics.rmse_m)}`).join(' ')}/>
          {points.map(p => <g key={p.id}><circle cx={sx(p.bytes)} cy={sy(p.metrics.rmse_m)} r={p.id === selected.id ? 8 : 5} fill={p.color}/><text x={sx(p.bytes)+9} y={sy(p.metrics.rmse_m)-8}>{p.label}</text></g>)}
        </svg><p>更稀疏的 GUGIS 网格文件更小，但误差升高。2 m 档 RMSE 更低，文件显著更大；此示例不支持“全面优于 SPG”的结论。</p>
      </figure>
      <figure className="research-image"><img loading="lazy" src="/research/implicit-terrain/reference.png" alt="作者瑞士示例一平方公里参考高程图，东西和南北方向以米标注"/><figcaption>同一参考 DEM · 作者 0.5 m 栅格按示例流程重采样至 1 m</figcaption></figure>
    </div>
    <div className="research-errors">
      <figure><img loading="lazy" src={`/research/implicit-terrain/${selected.id}-error.png`} alt={`GUGIS ${stride}米控制网的高程误差分布，色标固定为正负2米`}/><figcaption>GUGIS · {stride} m · 误差图</figcaption></figure>
      <figure><img loading="lazy" src="/research/implicit-terrain/spg-error.png" alt="本机 SPG 复现高程误差分布，与 GUGIS 使用相同正负2米色标"/><figcaption>ImplicitTerrain SPG · 误差图</figcaption></figure>
      <div className="research-reading"><h3>相同色标，看到误差在哪里。</h3><p>两张图使用 ±2 m 色标，超出部分颜色截断；下表仍统计完整误差。平均误差小，不等于所有点都达到相同精度。</p>
        <p>GUGIS 保留显式控制点与可编辑面带，能直接定位结构和局部修改；SPG 在本例的紧凑表达与重建精度上表现强。下一步应继续验证局部修改成本和拓扑保真。</p></div>
    </div>
    <div className="research-table-scroll"><table><caption>百万采样点重建与明示口径分析 · 当前 GUGIS {stride} m 档</caption>
      <thead><tr><th>指标</th><th>GUGIS · {stride} m</th><th>SPG · 本机复现</th><th>如何解读</th></tr></thead><tbody>
        <tr><th>RMSE / MAE</th><td>{cm(selected.metrics.rmse_m)} / {cm(selected.metrics.mae_m)} cm</td><td>{cm(spg.metrics.rmse_m)} / {cm(spg.metrics.mae_m)} cm</td><td>所有参考像元中心；高程单位米</td></tr>
        <tr><th>P95 / 最大绝对误差</th><td>{cm(selected.metrics.p95_absolute_m)} / {cm(selected.metrics.max_absolute_m)} cm</td><td>{cm(spg.metrics.p95_absolute_m)} / {cm(spg.metrics.max_absolute_m)} cm</td><td>95%误差范围与最坏点同时报告</td></tr>
        <tr><th>PSNR / SSIM</th><td>{selected.metrics.psnr_peak_1_db.toFixed(2)} dB / {selected.metrics.ssim.toFixed(6)}</td><td>{spg.metrics.psnr_peak_1_db.toFixed(2)} dB / {spg.metrics.ssim.toFixed(6)}</td><td>PSNR 使用作者 peak=1；SSIM参数见方法</td></tr>
        <tr><th>平滑后梯度范数 RMSE</th><td>{selected.metrics.smoothed_gradient_norm_rmse.toFixed(5)}</td><td>{spg.metrics.smoothed_gradient_norm_rmse.toFixed(5)}</td><td>共同高斯 σ=4；无量纲坡度</td></tr>
        <tr><th>平滑后梯度方向平均角差</th><td>{selected.metrics.smoothed_gradient_direction_mean_degrees?.toFixed(3)}°</td><td>{spg.metrics.smoothed_gradient_direction_mean_degrees?.toFixed(3)}°</td><td>剔除平坦点；有效点数可能不同</td></tr>
        <tr><th>4,096 次求值中位耗时 · 基线记录</th><td>{median(selected.query_repetitions_ms).toFixed(2)} ms · Node 基线内核</td><td>{median(spg.query_repetitions_ms).toFixed(2)} ms · PyTorch CPU</td><td>同点、五次重复；不同运行库，不能推断软件快慢</td></tr>
        <tr><th>独立数值核验</th><td>512 点最大差 {(selected.kernel_readback_max_difference_m*1000).toExponential(2)} mm</td><td>PSNR 与作者示例 66.39307 dB 吻合</td><td>GUGIS Python 档案读回与网站查询内核互核</td></tr>
      </tbody></table></div>
    <section id="offgrid-audit" className="research-offgrid" aria-labelledby="offgrid-title">
      <span className="research-eyebrow">SOURCE RESOLUTION CHECK / 02</span>
      <h3 id="offgrid-title">原始 0.5 m 数据的离网格核验</h3>
      <p>从原始 DEM 无放回抽取 {offgrid.samples.toLocaleString()} 个像元中心，全部偏离 1 m 评测网格。参考值直接读取原始栅格，双方在相同位置求值；不插值生成参考答案。</p>
      <div className="research-table-scroll"><table><caption>独立列出的离网格结果 · 当前 GUGIS {stride} m 档</caption>
        <thead><tr><th>原始源数据误差</th><th>GUGIS · {stride} m</th><th>SPG · 本机复现</th></tr></thead>
        <tbody>{[
          ['RMSE / MAE', `${cm(selectedOffgrid.metrics.rmse_m)} / ${cm(selectedOffgrid.metrics.mae_m)}`, `${cm(offgrid.spg.metrics.rmse_m)} / ${cm(offgrid.spg.metrics.mae_m)}`],
          ['P95 / 最大绝对误差', `${cm(selectedOffgrid.metrics.p95_absolute_m)} / ${cm(selectedOffgrid.metrics.max_absolute_m)}`, `${cm(offgrid.spg.metrics.p95_absolute_m)} / ${cm(offgrid.spg.metrics.max_absolute_m)}`],
        ].map(([label,native,spg])=><tr key={label}><th>{label}</th><td>{native} cm</td><td>{spg} cm</td></tr>)}</tbody>
      </table></div>
      <p className="research-offgrid-limit">原始数据参与了预处理，因此这不是独立留出测试集。此处结果不与上方百万个 1 m 网格点的统计混用；平均误差与最坏点需一起判断。</p>
      <div className="research-downloads"><a href="/research/implicit-terrain/offgrid-results.json" download>下载离网格 JSON ↓</a><a href="/research/implicit-terrain/offgrid-results.csv" download>下载离网格 CSV ↓</a></div>
    </section>
    <section id="native-index-audit" className="research-offgrid" aria-labelledby="native-index-title">
      <span className="research-eyebrow">NATIVE QUERY ENGINE / 03</span>
      <h3 id="native-index-title">相同精度，更快查询高密度控制网</h3>
      <p>将固定 64 m 空间分桶改为有资源上限的自适应索引。同一 Node 运行库、同一档案、同一 4,096 个连续坐标，比较更新前后的原生求值。</p>
      <div className="research-table-scroll"><table><caption>查询内核更新前后 · 当前 GUGIS {stride} m 档</caption>
        <thead><tr><th>实测指标</th><th>更新前</th><th>更新后</th></tr></thead><tbody>
          <tr><th>4,096 次查询中位耗时</th><td>{selectedIndex.before.query_median_ms.toFixed(2)} ms</td><td>{selectedIndex.after.query_median_ms.toFixed(2)} ms</td></tr>
          <tr><th>索引构建中位耗时</th><td>{selectedIndex.before.index_median_ms.toFixed(2)} ms</td><td>{selectedIndex.after.index_median_ms.toFixed(2)} ms</td></tr>
          <tr><th>索引留存数据堆 · V8</th><td>{mb(selectedIndex.before.retained_index_heap_bytes)} MB</td><td>{mb(selectedIndex.after.retained_index_heap_bytes)} MB</td></tr>
          <tr><th>查询结果核验</th><td colSpan={2}>全部查询的高程、坡度、坡向、面片及参数序列逐字节一致</td></tr>
        </tbody></table></div>
      <p>{selectedIndex.speedup >= 1 ? `该档查询加速 ${selectedIndex.speedup.toFixed(2)} 倍` : `该档未加速，查询耗时增加 ${((1/selectedIndex.speedup-1)*100).toFixed(1)}%`}。每个版本运行三个独立进程，交替次序；各进程热身后运行九次，取各进程中位数的中位数。</p>
      <p className="research-offgrid-limit">更细的索引会增加内存和构建开销，低密度控制网不一定更快。留存数据堆在强制垃圾回收后计量，仅包含索引增量；不代表 GPU 或浏览器内存。射线拾取未变更；此处仅比较 GUGIS 自身版本，不是 ArcGIS 或 SPG 的速度结果。</p>
      <div className="research-downloads"><a href="/research/implicit-terrain/terrain-index-benchmark.json" download>下载逐次计时与一致性哈希 ↓</a></div>
    </section>
    <div id="research-format-audit" className="research-format-result" aria-live="polite"><h3>同一控制网，导出 ArcGIS 可读的三角带文件。</h3>
      <p>当前 {stride} m 档：GUGIS <strong>{mb(selected.bytes)} MB</strong>；进一步合并相邻三角带后的单要素 XYZ Shapefile 为 <strong>{mb(selectedJoined.geometry_only_bytes)} MB</strong>。原生 JSON 相比这一紧凑几何基线<strong>{selectedJoined.native_saving_percent>=0 ? '小' : '大'} {Math.abs(selectedJoined.native_saving_percent).toFixed(1)}%</strong>；不能沿用原分组方式的文件节省百分比。</p>
      <div className="research-table-scroll"><table><caption>改变要素分组，优势仍然成立吗？ · 同一 XYZ 三角带</caption>
        <thead><tr><th>保存方式</th><th>未压缩文件</th><th>保留的内容</th></tr></thead><tbody>
          <tr><th>GUGIS 原生档案</th><td>{mb(selected.bytes)} MB</td><td>控制点、原生面带、共享索引与元数据</td></tr>
          <tr><th>MultiPatch · 每面片一个要素</th><td>{mb(selectedPacking.per_patch_bytes)} MB</td><td>五个组件，DBF 保留面片 ID 与原类型；原基线</td></tr>
          <tr><th>MultiPatch · 单要素紧凑 XYZ</th><td>{mb(selectedPacking.geometry_only_bytes)} MB</td><td>五个组件，完整 XYZ 与三角带；不保留逐面片属性</td></tr>
          <tr><th>紧凑 XYZ + 面片属性映射</th><td>{mb(selectedPacking.with_patch_metadata_bytes)} MB</td><td>另计 JSON 映射，保留面片 ID、原类型和来源元数据</td></tr>
          <tr><th>单要素 XYZ · 合并相邻三角带</th><td>{mb(selectedJoined.geometry_only_bytes)} MB</td><td>相同有向三角形；共享带端点，进一步减少重复坐标</td></tr>
          <tr><th>合并三角带 + 两份属性映射</th><td>{mb(selectedJoined.with_patch_metadata_bytes)} MB</td><td>另计原面片属性及合并位置映射；不是原生拓扑恢复</td></tr>
        </tbody></table></div>
      <p>紧凑版合并记录，并按 <a href={packing.specification} target="_blank" rel="noreferrer">Esri 格式规范</a>省略未使用的可选 M 度量值。全部六档的三角带顺序、部件类型与 XYZ 哈希一致；8 m 和 16 m 另做百万像元读回，高程差为零。映射不能恢复共享控制点 ID 或离散前的直纹面，不宣称无损回到原生档案。</p>
      <p>进一步将兼容的相邻三角带从 {selectedJoined.before_parts.toLocaleString()} 个部件合并为 {selectedJoined.after_parts.toLocaleString()} 个，全部六档有向三角形集合哈希一致，8 m / 16 m 读回高程仍完全相同。这一结果提示：需要优化原生面带的组织，再在相同误差和完整成本下比较，不能把文件格式选择直接当作方法优势。</p>
      <p>将实际 .shp 读回后，相对同一 DEM 的 RMSE 为 <strong>{cm(selected.multipatch.metrics.rmse_m)} cm</strong>；三角带离散相对原生面带的高程 RMSE 为 <strong>{cm(selected.multipatch.native_discretization_rmse_m)} cm</strong>、最大差 <strong>{cm(selected.multipatch.native_discretization_max_m)} cm</strong>。原三角带保留，直纹面带每个区段离散一次。</p>
      <p>这是格式与数值对照：EPSG:2056，实际 {selected.multipatch.parts.toLocaleString()} 个 Triangle Strip 部件；未运行 ArcGIS Pro，不据此推断其内存、帧率或查询速度。</p>
      <div className="research-downloads"><a href="/research/implicit-terrain/packing-results.json" download>下载分组方式审计 ↓</a><a href="/research/implicit-terrain/terrain-8m-packed.zip" download>下载 8 m 紧凑对照包 ↓</a><a href="/research/implicit-terrain/terrain-16m-packed.zip" download>下载 16 m 紧凑对照包 ↓</a></div>
      <div className="research-downloads"><a href="/research/implicit-terrain/joined-results.json" download>下载相邻带合并审计 ↓</a><a href="/research/implicit-terrain/terrain-8m-joined.zip" download>下载 8 m 合并带基线 ↓</a><a href="/research/implicit-terrain/terrain-16m-joined.zip" download>下载 16 m 合并带基线 ↓</a></div>
    </div>
    <details className="research-method"><summary>实验方法、来源与尚未完成的指标</summary>
      <p><strong>来源：</strong><a href={report.sources.paper} target="_blank" rel="noreferrer">CVPR 2024 Workshop INRV 论文</a> · <a href={`${report.sources.repository}/tree/${report.dataset.reference_repo_revision}`} target="_blank" rel="noreferrer">锁定作者代码版本</a>。此处使用公开示例权重，不是重新训练或论文全部数据集复现。</p>
      <p><strong>精度：</strong>在全部 1,000,000 个参考像元中心计算米制高程误差，未建立留出测试集。PSNR = −10 log₁₀（[-1,1] 归一化高程的均方误差），peak=1。SSIM 使用高斯 σ=1.5、11×11 窗口、总体协方差，并按源高程范围设置 data_range=1；此参数口径不声称与论文默认值完全相同。</p>
      <p><strong>梯度：</strong>参考和重建高程共同采用高斯 σ=4 像元、1 m 中心差分，剔除4像元边界；方向比较要求双方梯度范数均大于0.01。这是共同平滑后的栅格分析，尚非解析导数或论文全部表格复现。</p>
      <p><strong>存储：</strong>GUGIS 计入完整未压缩 JSON 与元数据；SPG 计入两个实际权重文件和恢复所需的高程范围、残差范围、坐标域等元数据。原 DEM 另列，文件大小不能换算为运行内存。</p>
      <p><strong>耗时：</strong>同一随机种子、同一4,096个连续坐标，热身后重复5次。GUGIS 用网站查询内核在 Node 中逐点求值；SPG 用 PyTorch CPU 批量前向求值，包含两个网络与残差恢复。运行库和实现不同，结果只展示此实验，不推断产品性能胜负。GUGIS 的构建包含结构校验，训练成本仍待测。</p>
      <p>本机 {report.runtime.platform} · Python {report.runtime.python} · PyTorch {report.runtime.torch}（{report.runtime.torch_threads} CPU 线程）· Node {report.runtime.node}。</p>
      <p>原始 GeoTIFF {mb(report.dataset.source_bytes)} MB；1 m float32 高程数组 {mb(report.dataset.raw_float32_reference_bytes)} MB。论文另报模型 1.51 MB / 栅格 7.6 MB；其文件口径与本示例不同。</p>
      <ul>{['ArcGIS Pro 软件运行、GPU 内存与帧率','SPG 重新训练成本与多随机种子稳定性','统一拓扑流程的临界网络 precision / recall / F₀.₅ 与 MIG 距离','独立来源或独立留出测试集的精度'].map(item => <li key={item}>{item} · 待测</li>)}</ul>
      <p>原始 DEM SHA-256：<code>{report.dataset.source_sha256}</code>。研究坐标为瑞士投影采样格；未作为布里斯托、伦敦或其他英国城市的真实地形。</p>
    </details>
    <div className="research-downloads"><a href="/research/implicit-terrain/results.json" download>下载完整 JSON 结果 ↓</a><a href="/research/implicit-terrain/results.csv" download>下载 CSV 数值表 ↓</a><a href="/research/implicit-terrain/terrain-8m.zip" download>下载 8 m 同源 GUGIS / Shapefile 示例 ↓</a><a href="/research/implicit-terrain/terrain-16m.zip" download>下载 16 m 对照示例 ↓</a><a href="https://github.com/zbole/GUGIS3D/tree/main/data-pipeline" target="_blank" rel="noreferrer">查看复现实验脚本 ↗</a></div>
    <p className="research-attribution">DEM 来源：ImplicitTerrain 作者公开示例 / swissALTI3D · Federal Office of Topography swisstopo。<a href="https://www.swisstopo.admin.ch/en/terms-of-use-free-geodata-and-geoservices" target="_blank" rel="noreferrer">地理数据使用条件 ↗</a>。图为本项目重新计算绘制，下载包不含作者权重或代码。</p>
  </section>;
}
