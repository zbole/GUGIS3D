import { useEffect, useState } from "react";
import suiteUrl from "../../../shared/terrain-comparison-suite.json?url";
import overview from "../../../shared/terrain-comparison-overview.json";
import type { ComparisonSuite } from "./comparisonModel";
import { loadComparisonSuite } from "./suiteResource";
import TerrainComparisonLab from "./TerrainComparisonLab";

export default function TerrainComparisonLoader() {
  const [suite, setSuite] = useState<ComparisonSuite | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setError("");
    loadComparisonSuite(suiteUrl, overview, controller.signal).then(result => {
      if (!controller.signal.aborted) setSuite(result);
    }).catch(error => {
      if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "实验数据加载失败。");
    });
    return () => controller.abort();
  }, [attempt]);
  useEffect(() => {
    if (!suite || !["#terrain-lab", "#derivative-title"].includes(location.hash)) return;
    const id = location.hash.slice(1);
    const frame = requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ block: "start" }));
    return () => cancelAnimationFrame(frame);
  }, [suite]);
  if (suite) return <TerrainComparisonLab suite={suite}/>;
  return <section className="cmp-section cmp-lab" id="terrain-lab" aria-busy={!error}>
    <p className="cmp-kicker">同源精度实验室</p><h2>精度与分析对比</h2>
    {error ? <div className="cmp-budget-verdict"><p role="alert">{error}</p><button onClick={() => setAttempt(a => a + 1)}>重新加载实验数据</button></div>
      : <p role="status">正在读取并校验点查询与剖面数据…</p>}
  </section>;
}
