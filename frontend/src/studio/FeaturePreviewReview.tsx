import { useMemo } from "react";
import type { Environment, FeaturePlacement } from "./environment";

type Change = { id: string; type: "新增" | "修改" | "移除"; before?: FeaturePlacement; after?: FeaturePlacement };
const fields = ["asset", "name", "longitude", "latitude", "altitude", "heading", "scale", "layer"] as const;

export function featurePreviewChanges(before?: Environment, after?: Environment): Change[] {
  if (before?.features === after?.features && before?.feature_assets === after?.feature_assets) return [];
  const original = new Map((before?.features ?? []).map(item => [item.id, item]));
  const current = new Map((after?.features ?? []).map(item => [item.id, item]));
  const originals = new Map<string, string>(), previews = new Map<string, string>();
  const definition = (env: Environment | undefined, id: string, cache: Map<string, string>) => {
    if (!cache.has(id)) cache.set(id, JSON.stringify(env?.feature_assets[id]) ?? "");
    return cache.get(id);
  };
  const changes: Change[] = [];
  for (const item of current.values()) {
    const old = original.get(item.id);
    if (!old) changes.push({ id: item.id, type: "新增", after: item });
    else if (fields.some(key => old[key] !== item[key]) ||
      definition(before, old.asset, originals) !== definition(after, item.asset, previews))
      changes.push({ id: item.id, type: "修改", before: old, after: item });
  }
  for (const old of original.values()) if (!current.has(old.id)) changes.push({ id: old.id, type: "移除", before: old });
  return changes;
}

const functions: Record<string, string> = { sphere: "球体", cylinder: "圆柱", "annular-prism": "圆弧扇体", "arch-prism": "拱形体", box: "长方体" };
function structure(env: Environment | undefined, item?: FeaturePlacement) {
  if (!item) return "—";
  const asset = env?.feature_assets[item.asset];
  return asset ? `${asset.components.length} 个组件 · ${[...new Set(asset.components.map(part => functions[part.function] ?? part.function))].join(" + ")}` : "定义不可用";
}

export default function FeaturePreviewReview({ before, after }: { before?: Environment; after?: Environment }) {
  const changes = useMemo(() => featurePreviewChanges(before, after), [before, after]);
  if (!changes.length) return null;
  const count = (kind: Change["type"]) => changes.filter(change => change.type === kind).length;
  return <details className="terrain-preview-review feature-preview-review" open>
    <summary>函数地物预览 · 新增 {count("新增")} / 修改 {count("修改")} / 移除 {count("移除")}</summary>
    <div className="terrain-preview-review-scroll" role="region" aria-label="函数地物改动清单，可横向滚动" tabIndex={0}>
      <table><caption>影响的地物实例与函数组件；共享定义的修改会列出受影响实例</caption>
        <thead><tr><th scope="col">地物 / 操作</th><th scope="col">原项目</th><th scope="col">当前草稿</th></tr></thead>
        <tbody>{changes.slice(0, 25).map(change => <tr key={change.id}>
          <th scope="row">{change.after?.name ?? change.before?.name} · {change.type}<small>{change.id}</small></th>
          <td>{structure(before, change.before)}</td><td>{structure(after, change.after)}{change.after && <small>
            {change.after.layer === "underground" ? "地下" : "地上 / 地表"} · 距地形 {change.after.altitude.toLocaleString("zh-CN", { maximumFractionDigits: 3 })} m · 比例 {change.after.scale}
          </small>}</td>
        </tr>)}</tbody>
      </table>
    </div>
    {changes.length > 25 && <p>共影响 {changes.length.toLocaleString()} 个地物，此处列出前 25 个；场景使用完整草稿。</p>}
    <p>草稿保存函数类型、参数与共享定义；场景中的离散网格是显示缓存。确认后才替换正式项目，丢弃可恢复原地物。</p>
  </details>;
}
