import { useEffect, useState } from "react";
import type { CityWorkspace } from "./cityWorkspaces";
import { candidateSourceUrl, catalogueCandidateRelation, loadSourceCandidates, sourceCandidateDownloadUrl,
  type CandidateCity, type SourceCandidate, type SourceCandidates } from "./sourceCandidates";
import "./sourceCandidateReview.css";

const names = { london: "伦敦", birmingham: "伯明翰" };
const relationLabels = { baseline: "目录版本与原始种子完全一致", candidate: "目录版本与此候选完全一致",
  different: "目录版本不同；此候选不是保留你现有修改的补丁", unknown: "目录版本未知；没有判断项目能否替换" };
const bbox = (values: number[]) => values.map(v => String(v)).join(", ");
const policy = (s: SourceCandidate["candidate"]) => `${s.height_policy["height-tag"]} 源高度标签 / ${s.height_policy["levels-derived"]} 楼层估算 / ${s.height_policy.assumed} 假定高度`;
function OmissionList({ entries }: { entries: Array<{ osm_way: number; reason: string }> }) {
  return entries.length ? <ul>{entries.map(entry => <li key={entry.osm_way}>
    <a href={`https://www.openstreetmap.org/way/${entry.osm_way}`} target="_blank" rel="noreferrer">osm{entry.osm_way}</a>：{entry.reason}
  </li>)}</ul> : <p>无</p>;
}
export default function SourceCandidateReview({ cities }: { cities: CityWorkspace[] }) {
  const [expanded, setExpanded] = useState(false), [city, setCity] = useState<CandidateCity>("london");
  const [data, setData] = useState<SourceCandidates | null>(null), [loading, setLoading] = useState(false);
  const [error, setError] = useState(""), [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!expanded) { setLoading(false); return; }
    const controller = new AbortController(); let active = true;
    setLoading(true); setError(""); setData(null);
    void loadSourceCandidates(city, controller.signal).then(result => { if (active) setData(result); })
      .catch(reason => { if (active) setError(reason instanceof Error ? reason.message : String(reason)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; controller.abort(); };
  }, [expanded, city, attempt]);
  // Never show a stale city's report or download links during a newer selection.
  const visible = expanded && data?.city_id === city ? data : null;
  return <details className="source-candidate-review" open={expanded} onToggle={event => setExpanded(event.currentTarget.open)}>
    <summary>伦敦 / 伯明翰源数据修订候选 <small>只读检查与下载，不自动替换项目</small></summary>
    <div className="source-candidate-body">
      <p>对比原始供应种子与非默认 v2 候选。当前已保存项目、草稿和历史均不在这个对比中。</p>
      <div className="source-candidate-controls">
        <label>候选城市 <select aria-label="源修订候选城市" value={city} onChange={event => setCity(event.target.value as CandidateCity)}>
          {Object.entries(names).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
        </select></label>
        <button type="button" disabled={loading} onClick={() => setAttempt(n => n + 1)}>重新检查候选</button>
      </div>
      {loading && <p role="status">正在校验 {names[city]} 候选目录；不会载入城市模型…</p>}
      {error && <p role="alert">{error} <button type="button" onClick={() => setAttempt(n => n + 1)}>重试候选目录</button></p>}
      {visible && !visible.candidates.length && <p>此城市没有已登记候选，不会使用其他城市代替。</p>}
      {visible?.candidates.map(c => <article key={`${city}:${c.candidate.revision}`}>
        <h3>{names[city]} · 非默认 {c.version} 候选</h3>
        <p>{c.source.coverage_label} · 局部街区样本，不代表全城覆盖或实测高度</p>
        <div className="source-candidate-comparison">
          <section><h4>原始供应种子</h4><strong>{c.baseline.building_count} 栋 / {c.baseline.road_count} 条道路</strong><p>{policy(c.baseline)}</p></section>
          <section><h4>非默认修订候选</h4><strong>{c.candidate.building_count} 栋 / {c.candidate.road_count} 条道路</strong><p>{policy(c.candidate)}</p></section>
        </div>
        <p className="source-candidate-relation">{relationLabels[catalogueCandidateRelation(cities.find(w => w.id === city), c, city)]}<br />
          <small>仅依据本页面已读城市目录中的修订摘要，不是实时项目检查，不包括未保存修改。</small></p>
        <h4>保留建筑的源高度修正</h4>
        <ul>{c.changes.height_corrections.map(change => <li key={change.osm_way}>
          <a href={`https://www.openstreetmap.org/way/${change.osm_way}`} target="_blank" rel="noreferrer">osm{change.osm_way}</a> · {change.name || "未命名建筑"}：模型 {change.baseline_height_m} m → 源标签 {change.candidate_height_m} m（未独立测量核验）
        </li>)}</ul>
        <p>未新增建筑 ID；保留对象的位置、参数及道路不变。{c.changes.assumed_height_wording_changes} 栋的缺失高度假设说明更清楚，这不是几何修正或测量结果。</p>
        <details><summary>相对原始种子新增移除 {c.changes.removed_buildings.length} 栋</summary><OmissionList entries={c.changes.removed_buildings} /></details>
        <details><summary>原种子已遗漏 {c.changes.preexisting_omissions.length} 栋，不计作本次移除</summary><OmissionList entries={c.changes.preexisting_omissions} /></details>
        <details><summary>完整修订、来源范围与限制</summary>
          <dl><dt>原始种子 SHA-256</dt><dd>{c.baseline.revision}</dd><dt>候选 SHA-256</dt><dd>{c.candidate.revision}</dd>
            <dt>保留 OSM 来源 SHA-256</dt><dd>{c.source.sha256}</dd><dt>OSM 快照</dt><dd>{c.source.snapshot}</dd>
            <dt>查询窗口 WGS84 [西, 南, 东, 北]</dt><dd>{bbox(c.source.query_bbox_wgs84)}</dd>
            <dt>实际导入范围 WGS84 [西, 南, 东, 北]</dt><dd>{bbox(c.source.actual_data_bbox_wgs84)}</dd></dl>
          <p>查询窗口和实际导入范围均不是城市行政边界。候选没有新增覆盖，也没有实测 DEM。</p>
          <ul>{c.limitations.map((limit, i) => <li key={i}>{limit}</li>)}</ul>
        </details>
        <div className="source-candidate-warning"><strong>完整城市文件，不是自动修补包</strong>
          <p>手动导入会预览整份替换草稿；提交可能移除候选中没有的自建建筑、道路、地形、功能要素和分析信息。请先导出或保留可恢复副本，检查后再决定是否提交。本面板不会创建草稿或启用候选。</p></div>
        <div className="source-candidate-downloads">{(["provenance", "archive", "report"] as const).map(kind => {
          const download = c.downloads[kind];
          return <div key={kind}><a href={sourceCandidateDownloadUrl(download)} download={download.filename}>
            {kind === "provenance" ? "下载候选 + 来源说明 ZIP" : kind === "archive" ? "单独下载候选城市 JSON" : "单独下载导入回执 JSON"}
          </a><small>{(download.byte_length / 1024).toFixed(1)} KiB · SHA-256：{download.sha256}</small></div>;
        })}</div>
        <p className="source-candidate-license"><a href={candidateSourceUrl(c.source.attribution_url)!} target="_blank" rel="noreferrer">{c.source.attribution}</a> · <a href={candidateSourceUrl(c.source.licence_url)!} target="_blank" rel="noreferrer">{c.source.licence}</a><br />重新分发时请保留来源、回执和许可说明。</p>
      </article>)}
    </div>
  </details>;
}
