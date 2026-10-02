import { useMemo, useState } from "react";
import type { CityDocument } from "./cityModel";
import type { WorkspaceTab } from "./workspaceNavigation";
import "./projectStatus.css";

export type ProjectStatusAction = "city" | "author" | "environment" | "analysis" | "recovery";
export type ProjectDataLayer = "buildings" | "roads" | "terrain" | "features";
export type ProjectSourceKind = "demonstration" | "measured" | "user-imported" | "missing" | "unknown";

export interface ProjectDataSource {
  kind: ProjectSourceKind;
  detail?: string;
}

export interface ProjectStatusPanelProps {
  /** The document currently shown in the scene, including a draft when previewing it. */
  city: CityDocument | null;
  /** Revision of the formal city, never the draft revision. */
  revision: string;
  hasDraft: boolean;
  draftLabel?: string;
  draftUnavailable?: boolean;
  /** Whether the parent currently permits direct writes to the formal project. */
  canSave: boolean;
  saveReason?: string;
  busy?: boolean;
  activeWorkspace?: WorkspaceTab;
  /** A trusted description of the current dataset's scope, when available. */
  scopeLabel?: string;
  /** Only label data as measured or imported when the parent has that evidence. */
  sources?: Partial<Record<ProjectDataLayer, ProjectDataSource>>;
  defaultExpanded?: boolean;
  /** Navigation only. This panel never saves, restores, or changes city data. */
  onAction?: (action: ProjectStatusAction) => void;
}

const sourceNames: Record<ProjectSourceKind, string> = {
  demonstration: "演示数据",
  measured: "实测数据",
  "user-imported": "用户导入",
  missing: "数据缺失",
  unknown: "来源未标注",
};
const layerNames: Record<ProjectDataLayer, string> = {
  buildings: "建筑", roads: "道路", terrain: "地形", features: "函数地物",
};
const navigation: readonly { action: ProjectStatusAction; label: string }[] = [
  { action: "city", label: "城市" },
  { action: "author", label: "制作" },
  { action: "environment", label: "地形 / 地物" },
  { action: "analysis", label: "分析" },
  { action: "recovery", label: "历史与恢复" },
];
const number = (value: number) => value.toLocaleString("zh-CN");

/** Bounds of placement anchors and road vertices, not a surveyed city boundary. */
function locationRange(city: CityDocument | null): string | null {
  if (!city) return null;
  let west = Infinity, east = -Infinity, south = Infinity, north = -Infinity;
  const include = (longitude: number, latitude: number) => {
    if (!Number.isFinite(longitude) || !Number.isFinite(latitude) ||
        Math.abs(longitude) > 180 || Math.abs(latitude) > 90) return;
    west = Math.min(west, longitude); east = Math.max(east, longitude);
    south = Math.min(south, latitude); north = Math.max(north, latitude);
  };
  for (const item of city.instances) include(item.longitude, item.latitude);
  for (const road of city.roads) for (const [longitude, latitude] of road.coordinates) include(longitude, latitude);
  for (const item of city.environment?.features ?? []) include(item.longitude, item.latitude);
  const axis = (min: number, max: number) => min === max
    ? `${min.toFixed(4)}°` : `${min.toFixed(4)}° 至 ${max.toFixed(4)}°`;
  if (west !== Infinity) return `经度 ${axis(west, east)} · 纬度 ${axis(south, north)}`;
  const terrain = city.environment?.terrain;
  if (terrain && Number.isFinite(terrain.longitude) && Number.isFinite(terrain.latitude) &&
      Math.abs(terrain.longitude) <= 180 && Math.abs(terrain.latitude) <= 90)
    return `地形基点 · 经度 ${terrain.longitude.toFixed(4)}° · 纬度 ${terrain.latitude.toFixed(4)}°`;
  return null;
}

function sourceFor(layer: ProjectDataLayer, present: boolean, props: ProjectStatusPanelProps): ProjectDataSource {
  if (!present) return { kind: "missing", detail: `尚未载入${layerNames[layer]}数据` };
  // A synthetic terrain flag remains visible even if an inconsistent caller supplies another label.
  if (layer === "terrain" && props.city?.environment?.terrain?.demonstration)
    return { kind: "demonstration", detail: props.sources?.terrain?.kind === "demonstration"
      ? props.sources.terrain.detail ?? "合成地形，用于方法演示" : "合成地形，用于方法演示" };
  return props.sources?.[layer] ?? { kind: "unknown", detail: "当前数据未标注来源性质" };
}

export default function ProjectStatusPanel(props: ProjectStatusPanelProps) {
  const { city, revision, hasDraft, draftLabel, draftUnavailable = false, canSave, saveReason,
    busy = false, activeWorkspace, onAction, defaultExpanded = false } = props;
  const [expanded, setExpanded] = useState(defaultExpanded);
  const range = useMemo(() => locationRange(city), [city]);
  const terrain = city?.environment?.terrain;
  const counts = {
    buildings: city?.instances.length ?? 0,
    roads: city?.roads.length ?? 0,
    terrain: terrain?.patches.length ?? 0,
    features: city?.environment?.features.length ?? 0,
  };
  const scope = props.scopeLabel?.trim() || city?.metadata["范围"]?.trim() ||
    (range ? "按当前城市对象定位范围统计" : "尚无已定位城市数据");
  const units: Record<ProjectDataLayer, string> = { buildings: "栋", roads: "条", terrain: "块", features: "个" };
  const layers: readonly ProjectDataLayer[] = ["buildings", "roads", "terrain", "features"];
  const surface = city?.environment?.features.filter(item => item.layer === "surface").length ?? 0;
  const underground = city?.environment?.features.filter(item => item.layer === "underground").length ?? 0;
  const writeAllowed = !!city && canSave && !busy && !hasDraft && !draftUnavailable;
  const writeLabel = busy ? "处理中" : draftUnavailable ? "暂不可写入"
    : hasDraft ? "需先确认草稿" : writeAllowed ? "允许正式写入" : "暂不可写入";
  const reason = busy ? "正在处理当前操作，请稍候。"
    : draftUnavailable ? "独立草稿状态读取失败，重新载入项目后再继续。"
    : !city ? "城市尚未载入。"
    : hasDraft ? "已有独立草稿，请先确认写入或放弃草稿。"
    : saveReason || (writeAllowed ? "可在对应工作区确认并保存修改。" : "当前修改尚不满足保存条件。");
  const draftState = !city ? "城市尚未载入" : draftUnavailable ? "草稿状态未读取" : hasDraft ? "独立草稿 · 待确认" : "正式项目";

  return (
    <details className="project-status" open={expanded} onToggle={event => setExpanded(event.currentTarget.open)}
      aria-label="城市项目状态">
      <summary className="project-status__summary">
        <span className="project-status__identity">
          <span className="project-status__title">项目状态 <strong>{city?.name || "城市尚未载入"}</strong></span>
          <span className="project-status__scope" title={scope}>当前范围：{scope}</span>
        </span>
        <span className="project-status__counts" aria-label={hasDraft ? "当前草稿数据数量" : "正式城市数据数量"}>
          {layers.map(layer => <span key={layer} aria-label={`${layerNames[layer]} ${number(counts[layer])} ${units[layer]}`}>
            <span>{layerNames[layer]}</span> <strong>{number(counts[layer])}</strong><small>{units[layer]}</small>
          </span>)}
        </span>
        <span className={`project-status__badge${hasDraft || draftUnavailable ? " is-pending" : ""}`}>{draftState}</span>
        <span className="project-status__disclosure" aria-hidden="true">⌄</span>
      </summary>
      <div className="project-status__body">
        <div className="project-status__overview">
          <div className="project-status__location">
            <strong>{hasDraft ? "当前预览范围" : "当前城市范围"}</strong>
            <span>{scope}</span>
            {range && <small>{range}</small>}
            {range && !range.startsWith("地形基点") && <small>定位范围依据建筑、道路和地物；不代表完整城市边界。</small>}
          </div>
          <dl className="project-status__state">
            <div><dt>正式修订号</dt><dd>{revision || "尚未读取"}</dd></div>
            <div><dt>独立草稿</dt><dd>{draftUnavailable ? "状态未知" : hasDraft ? draftLabel || "已生成，待确认" : "无"}</dd></div>
            <div><dt>正式项目写入</dt><dd className={writeAllowed ? "is-allowed" : "is-pending"}>{writeLabel}</dd></div>
          </dl>
        </div>
        <p className="project-status__save-reason" aria-label="当前写入条件">{reason}</p>
        <div className="project-status__sources" aria-label="城市各层数据来源">
          {layers.map(layer => {
            const source = sourceFor(layer, counts[layer] > 0, props);
            const detail = source.detail || (source.kind === "user-imported" ? "由用户提供，实测属性未核验"
              : source.kind === "measured" ? "已标注为实测数据" : "当前数据未标注来源性质");
            return <div key={layer} className="project-status__source">
              <span className="project-status__source-heading"><strong>{layerNames[layer]}</strong>
                <span className={`project-status__source-kind is-${source.kind}`}>{sourceNames[source.kind]}</span>
              </span>
              <small>{detail}</small>
              {layer === "terrain" && terrain && <small>{number(terrain.points.length)} 个控制点 · {number(counts.terrain)} 块曲面</small>}
              {layer === "features" && counts.features > 0 && <small>地上 {number(surface)} 个 · 地下 {number(underground)} 个</small>}
            </div>;
          })}
        </div>
        {hasDraft && <p className="project-status__draft-note">上方数量和来源对应当前预览的独立草稿；正式修订号对应已保存的城市。</p>}
        {onAction && <nav className="project-status__actions" aria-label="项目工作区导航">
          {navigation.map(({ action, label }) => <button key={action} type="button"
            disabled={!city || busy} aria-current={action === activeWorkspace ? "page" : undefined}
            onClick={() => onAction(action)}>{label}</button>)}
        </nav>}
      </div>
    </details>
  );
}
