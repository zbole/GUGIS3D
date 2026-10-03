import { ChevronDown } from "lucide-react";
import { memoryComparison, memoryMB } from "./memoryBenchmark";

export default function MemoryComparison({ revision, cityId = "bristol" }: { revision: string; cityId?: string }) {
  if (cityId !== "bristol") return (
    <details className="memory-comparison">
      <summary>
        <span className="memory-label">城市数据内存对比</span>
        <span className="memory-stale">当前城市内存基准待测</span>
        <span className="memory-toggle">测量说明 <ChevronDown size={16} aria-hidden="true" /></span>
      </summary>
      <div className="memory-details">
        <p className="memory-method">此城市尚无独立点线与共享几何的同源内存测量报告。下方实例、模型和几何记录数量属于当前城市；内存占用与节省比例将在生成该城市的基准后展示。</p>
      </div>
    </details>
  );
  const result = memoryComparison(revision);
  return (
    <details className="memory-comparison">
      <summary>
        <span className="memory-label">城市数据内存对比</span>
        {result.matches ? (
          <>
            <span className="memory-saving">
              节省 <strong>{result.saving.toFixed(2)}%</strong>
            </span>
            <span className="memory-baseline">
              独立点线 {memoryMB(result.wire)} → 共享方案{" "}
              {memoryMB(result.shared)}
            </span>
          </>
        ) : (
          <span className="memory-stale">项目已修改 · 查看上次测量</span>
        )}
        <span className="memory-toggle">
          对比明细 <ChevronDown size={16} aria-hidden="true" />
        </span>
      </summary>
      <div className="memory-details">
        <p className="memory-sample">
          <span className={result.matches ? "memory-match" : "memory-stale"}>
            {result.matches
              ? "与当前已保存项目一致"
              : "上次测量结果，当前项目需重新测量"}
          </span>
          <span>
            样本：{result.buildings} 栋建筑 ·{" "}
            {result.components.toLocaleString()} 个构件
          </span>
        </p>
        <div className="memory-table-wrap">
          <table>
            <caption className="memory-visually-hidden">
              城市数据保留内存测试结果
            </caption>
            <thead>
              <tr>
                <th scope="col">数据表示方式</th>
                <th scope="col">内存占用</th>
                <th scope="col">共享方案节省</th>
              </tr>
            </thead>
            <tbody>
              {result.rows.map((row) => (
                <tr key={row.label}>
                  <th scope="row">{row.label}</th>
                  <td>{memoryMB(row.bytes)}</td>
                  <td>
                    {row.saving === null ? "—" : `${row.saving.toFixed(2)}%`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="memory-method">
          相比独立点线减少 {memoryMB(result.saved)}。相同 JavaScript 数组表示，
          {result.runs} 次独立 V8
          进程测试取中位数；统计城市几何与语义数据，不含浏览器界面和显存。纯点线模型不含表面。
        </p>
      </div>
    </details>
  );
}
