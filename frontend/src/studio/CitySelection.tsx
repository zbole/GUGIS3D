import { lazy, Suspense } from "react";
import { citySourceLicense, type CityId, type CityWorkspace } from "./cityWorkspaces";
import { type TileLoadingProfile } from "./renderTileClient";
import "./citySelection.css";
import CityPicker from "./CityPicker";
import terrainCatalogue from "../../../shared/public-terrain-sources-v9.json";

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
    <header className="city-selection-brand"><div>GUGIS<strong>3D</strong><small>英国城市工作台</small></div><nav aria-label="城市选择页面导航"><a href="/compare#validated-advantages">对比结果 ↗</a><a href="/datasets">公开数据 ↗</a></nav></header>
    <section className="city-selection-intro"><span>CITY WORKSPACES</span><h1>先选择你要探索的城市</h1>
      <p>每座城市独立保存。按需载入真实轮廓，保留来源、范围与精度说明。</p></section>
    <section className="city-selection-main" aria-label="选择起始城市">
      <h2 className="city-selection-step"><span>01</span>选择城市</h2>
      <div className="city-selection-controls"><div role="group" aria-label="城市选择方式">
        <button aria-pressed={!multiple} onClick={() => onMultiple(false)}>单选城市</button>
        <button aria-pressed={multiple} onClick={() => onMultiple(true)}>多选城市</button>
      </div><span>{cities.length} 个已登记城市 · 局部街区样本</span></div>
      {!cities.length && !error && <p role="status">正在读取城市目录；尚未载入任何城市模型…</p>}
      {error && <div className="city-selection-error" role="alert"><p>{error}</p><button onClick={onRetry}>重试城市目录</button></div>}
      <CityPicker cities={cities} selected={selected} multiple={multiple} terrainCities={terrainCatalogue.sources.map(s=>s.city_id)} onSelect={id=>onSelect(id as CityId)}/>
      {selected.length>0&&<details className="city-selection-chosen-detail"><summary>已选城市的范围、建筑数量与来源</summary>{cities.filter(city=>selected.includes(city.id as CityId)).map(city=>{const source=citySourceLicense(city);return <div key={city.id}><strong>{city.name} · {city.building_count??0} 栋建筑 · {city.road_count??0} 条道路</strong><p>{city.coverage_label}</p>{!!city.quality_warnings?.length&&<small className="city-selection-warning">此版本有已知高度 / 竖向模型问题，进入后可查看说明</small>}{source?<a href={source.url} target="_blank" rel="noreferrer">{source.label} ↗</a>:<small>{city.source??'当前项目数据'}</small>}</div>;})}</details>}
      <h2 className="city-selection-step city-selection-step--mode"><span>02</span>选择浏览方式</h2>
      <label className={`city-selection-mode${previewMode ? " is-selected" : ""}`}><input type="checkbox" checked={previewMode}
        aria-label="轻量分块浏览（只读）" onChange={event => onPreviewModeChange(event.target.checked)} />
        <span><strong>轻量分块浏览（只读）</strong><small>仅请求视域附近的建筑分块；需已生成渲染缓存。关闭后载入完整可编辑项目。</small></span>
      </label>
      <details className="city-selection-profile-options" open={previewMode}><summary>只读模式的加载配置</summary>
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
      </details>
      <div className="city-selection-actions"><div><strong>已选 {selected.length} 个城市</strong>
        <span className="city-selection-current-mode">{previewMode ? `只读浏览 · ${tileProfile === "economy" ? "低资源" : "均衡"}` : "完整编辑"}</span>
        <p>多选后可切换查看；同时仅保留一个城市场景，降低内存与 GPU 负担。</p></div>
        <button className="primary" disabled={!selected.some(id => cities.some(city => city.id === id && city.status !== "invalid"))} onClick={onEnter}>进入工作区 →</button></div>
      <section className="city-selection-secondary" aria-label="数据来源与接入说明">
        <strong>数据来源与覆盖说明</strong><p>核对来源修订、候选数据与城市接入进度；不影响上方城市选择。</p>
        <Suspense fallback={<p>正在载入源修订检查面板…</p>}><SourceCandidateReview cities={cities} /></Suspense>
        <Suspense fallback={<p>正在载入接入进度面板…</p>}><UkCoverageProgress /></Suspense>
      </section>
    </section>
    <footer>当前样本不代表英国全部城市或完整行政区域。部分高度为推算值，设计构件与演示地形均不是实测成果。</footer>
  </main>;
}
