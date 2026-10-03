import { lazy, Suspense } from "react";
import { citySourceLicense, type CityId, type CityWorkspace } from "./cityWorkspaces";
import { type TileLoadingProfile } from "./renderTileClient";
import "./citySelection.css";

const UkCoverageProgress = lazy(() => import("./UkCoverageProgress"));
const SourceCandidateReview = lazy(() => import("./SourceCandidateReview"));

export default function CitySelection({ cities, selected, multiple, error, previewMode, onPreviewModeChange, tileProfile = "balanced", onTileProfileChange, onMultiple, onSelect, onEnter, onRetry }: {
  cities: CityWorkspace[];
  selected: CityId[];
  multiple: boolean;
  error: string;
  previewMode: boolean;
  onPreviewModeChange: (value: boolean) => void;
  tileProfile?: TileLoadingProfile;
  onTileProfileChange?: (value: TileLoadingProfile) => void;
  onMultiple: (multiple: boolean) => void;
  onSelect: (id: CityId) => void;
  onEnter: () => void;
  onRetry: () => void;
}) {
  return <main className="city-selection">
    <header className="city-selection-brand">GUGIS<strong>3D</strong><small>英国城市工作台</small></header>
    <section className="city-selection-intro"><span>CITY WORKSPACES</span><h1>先选择你要探索的城市</h1>
      <p>每座城市独立保存。按需载入真实轮廓，保留来源、范围与精度说明。</p></section>
    <section className="city-selection-main" aria-label="选择起始城市">
      <div className="city-selection-controls"><div role="group" aria-label="城市选择方式">
        <button aria-pressed={!multiple} onClick={() => onMultiple(false)}>单选城市</button>
        <button aria-pressed={multiple} onClick={() => onMultiple(true)}>多选城市</button>
      </div><span>{cities.length} 个已登记城市 · 局部街区样本</span></div>
      {!cities.length && !error && <p role="status">正在读取城市目录；尚未载入任何城市模型…</p>}
      {error && <div className="city-selection-error" role="alert"><p>{error}</p><button onClick={onRetry}>重试城市目录</button></div>}
      <div className="city-selection-grid">{cities.map(city => {
        const id = city.id as CityId, source = citySourceLicense(city);
        return <label key={city.id} className={`city-selection-card${selected.includes(id) ? " is-selected" : ""}${city.status === "invalid" ? " is-invalid" : ""}`}>
          <input type={multiple ? "checkbox" : "radio"} name="starting-city" aria-label={`选择${city.name}`}
            checked={selected.includes(id)} disabled={city.status === "invalid"} onChange={() => onSelect(id)} />
          <small className="city-selection-country">UNITED KINGDOM</small>
          <strong>{city.name}</strong><span className="city-selection-english">{city.city_name ?? city.id}</span>
          <p>{city.coverage_label}</p>
          <span className="city-selection-counts">{city.status === "invalid" ? "数据异常，请先恢复文件" : city.status === "pending" ? "待导入数据" : `${city.building_count ?? 0} 栋建筑 · ${city.road_count ?? 0} 条道路`}</span>
          {!!city.quality_warnings?.length && <small className="city-selection-warning">此版本有已知高度 / 竖向模型问题，进入后可查看说明</small>}
          <small className="city-selection-source">{source?.label ?? city.source ?? "当前项目数据"}</small>
        </label>;
      })}</div>
      <Suspense fallback={<p>正在载入源修订检查面板…</p>}><SourceCandidateReview cities={cities} /></Suspense>
      <Suspense fallback={<p>正在载入接入进度面板…</p>}><UkCoverageProgress /></Suspense>
      <label className="city-selection-mode"><input type="checkbox" checked={previewMode}
        aria-label="轻量分块浏览（只读）" onChange={event => onPreviewModeChange(event.target.checked)} />
        <span><strong>轻量分块浏览（只读）</strong><small>仅请求视域附近的建筑分块；需已生成渲染缓存。关闭后载入完整可编辑项目。</small></span>
      </label>
      <fieldset className="city-selection-tile-profile" disabled={!previewMode}>
        <legend>分块读取配置（进入前选择）</legend>
        <div>{(["balanced", "economy"] as const).map(profile => <label key={profile}>
          <input type="radio" name="tile-profile" value={profile} checked={tileProfile === profile}
            aria-label={profile === "balanced" ? "均衡分块读取" : "低资源分块读取"}
            onChange={() => onTileProfileChange?.(profile)} />
          <span><strong>{profile === "balanced" ? "均衡（Balanced）" : "低资源（Economy）"}</strong>
            <small>{profile === "balanced" ? "驻留 ≤ 8 瓦片 / 8 MiB，缓存 ≤ 16 瓦片 / 16 MiB，3 个并发请求"
              : "驻留 ≤ 2 瓦片 / 2 MiB，缓存 ≤ 4 瓦片 / 4 MiB，1 个并发请求"}</small></span>
        </label>)}</div>
        <p>限制已验证的源瓦片字节与请求数，并非 GPU / JS 内存或帧率保证。超出单瓦片预算的源数据不会读取；可重新选择均衡配置或离线生成更小瓦片。完整编辑不使用此配置。</p>
      </fieldset>
      <div className="city-selection-actions"><div><strong>已选 {selected.length} 个城市</strong>
        <p>多选后可切换查看；同时仅保留一个城市场景，降低内存与 GPU 负担。</p></div>
        <button className="primary" disabled={!selected.some(id => cities.some(city => city.id === id && city.status !== "invalid"))} onClick={onEnter}>进入工作区 →</button></div>
    </section>
    <footer>当前样本不代表英国全部城市或完整行政区域。部分高度为推算值，设计构件与演示地形均不是实测成果。</footer>
  </main>;
}
