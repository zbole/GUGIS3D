import { useEffect, useMemo, useState } from "react";
import { countryNames, filterReadinessCities, loadUkReadiness, safeSourceUrl, type UkReadiness } from "./ukCoverage";
import "./ukCoverage.css";

const sampleLabels = { available: "相关样本可用", missing: "尚无可用样本数据", invalid: "样本数据异常", unavailable: "样本状态不可用", none: "尚无关联样本" };
const boundaryLabels = { "not-recorded": "未记录边界", "receipt-recorded": "已有结构检查回执", "validation-failed": "回执校验失败" };
export default function UkCoverageProgress() {
  const [expanded, setExpanded] = useState(false), [data, setData] = useState<UkReadiness | null>(null);
  const [loading, setLoading] = useState(false), [error, setError] = useState(""), [attempt, setAttempt] = useState(0);
  const [query, setQuery] = useState(""), [country, setCountry] = useState("");
  useEffect(() => {
    if (!expanded) { setLoading(false); return; }
    const controller = new AbortController(); let active = true;
    setLoading(true); setError("");
    void loadUkReadiness(controller.signal).then(result => { if (active) setData(result); })
      .catch(reason => { if (active) setError(reason instanceof Error ? reason.message : String(reason)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; controller.abort(); };
  }, [expanded, attempt]);
  const shown = useMemo(() => filterReadinessCities(data?.cities ?? [], country, query), [data, country, query]);
  const url = data ? safeSourceUrl(data.source.url) : null;
  return <details className="uk-coverage-progress" open={expanded} onToggle={event => setExpanded(event.currentTarget.open)}>
    <summary>英国城市接入进度 <small>官方名单、数据与边界分别记录</small></summary>
    <div className="uk-coverage-body">
      {loading && <p role="status">正在读取接入进度，不会加载城市模型…</p>}
      {error && <p role="alert">{error} <button onClick={() => setAttempt(n => n + 1)}>重试进度目录</button></p>}
      {data && (loading || error) && <p>下方为上次成功读取的进度</p>}
      {data && <>
        <p className="uk-coverage-counts">{data.summary.registered_cities} 个登记城市 · {data.summary.sample_workspaces} 个已配置样本工作区（{data.summary.available_sample_workspaces} 个可用）</p>
        <p>全城覆盖尚未评估。城市地位名单不提供地理边界，样本关联未经过城市边界包含关系核验。</p>
        <p>边界回执只证明文件完整性与结构检查；不代表拓扑、权威城市归属或全边界数据覆盖已经验证。</p>
        <div className="uk-coverage-filters">
          <label>地区 <select aria-label="接入进度地区" value={country} onChange={event => setCountry(event.target.value)}>
            <option value="">全部地区</option>{Object.entries(countryNames).map(([id, name]) => <option key={id} value={id}>{name} · {data.country_counts[id as keyof typeof countryNames]}</option>)}
          </select></label>
          <label>城市 <input aria-label="搜索登记城市" value={query} maxLength={100} onChange={event => setQuery(event.target.value)} placeholder="城市名称或别名" /></label>
          <button disabled={loading} onClick={() => setAttempt(n => n + 1)}>刷新进度</button>
        </div>
        <p className="uk-coverage-result-count">显示 {shown.length} / {data.cities.length} 个城市</p>
        <div className="uk-coverage-table-wrap"><table><thead><tr><th>城市</th><th>地区</th><th>样本关联</th><th>边界回执</th><th>全城覆盖</th></tr></thead>
          <tbody>{shown.map(city => <tr key={city.id}><th scope="row">{city.source_name}
            {city.aliases.length > 0 && <small>{city.aliases.join(" / ")}</small>}</th><td>{countryNames[city.country]}</td>
            <td>{sampleLabels[city.sample.state]}{city.sample.workspace_ids.map(id => {
              const sample = data.samples.find(item => item.workspace_id === id);
              return sample ? <small key={id}>{sample.display_name}：{sample.status === "available" ? `${sample.building_count} 栋 / ${sample.road_count} 条道路（工作区数量）` : "工作区数量未读取"}<br />{sample.association_note}</small> : null;
            })}</td><td>{city.boundary.reason_code === "unsupported-platform" ? "当前平台未检查" : boundaryLabels[city.boundary.state]}</td><td>尚未评估</td></tr>)}</tbody></table>
          {!shown.length && <p>没有匹配的登记城市</p>}
        </div>
        <p className="uk-coverage-source">{url && <a href={url} target="_blank" rel="noreferrer">{data.source.title}</a>} · 发布 {data.source.published_at} · 核对 {data.source.verified_at}<br />
          {data.source.conferral_caveat}<br />{data.source.attribution} · {data.source.license}</p>
      </>}
    </div>
  </details>;
}
