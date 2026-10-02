import type { FeatureAsset } from "./environment";

/** Validate coupled parameters before sending the full city archive to the server. */
export function featureErrors(asset: FeatureAsset): string[] {
  const errors: string[] = [];
  for (const part of asset.components) {
    const prefix = `${part.category}（${part.id}）`;
    for (const [key, value] of Object.entries(part.parameters)) {
      const min = key === "inner_radius" ? 0 : 0.001;
      const max = key === "angle" ? 360 : 1000;
      if (!Number.isFinite(value) || value < min || value > max)
        errors.push(
          `${prefix}：${key === "angle" ? "角度" : "尺寸"}须在 ${min}–${max} 之间。`,
        );
    }
    if (
      "outer_radius" in part.parameters &&
      part.parameters.outer_radius <= part.parameters.inner_radius
    )
      errors.push(`${prefix}：外半径必须大于内半径。`);
    if (part.position.some((n) => !Number.isFinite(n) || Math.abs(n) > 10000))
      errors.push(`${prefix}：组件位置须在 −10,000–10,000 m 之间。`);
  }
  return errors;
}
