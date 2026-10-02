import { categoryLabels, componentCategories, componentColors } from "./model";
import { materialLegend, type BuildingColorMode } from "./buildingAppearance";

export default function ComponentLegend({ colorMode = "material" }: { colorMode?: BuildingColorMode }) {
  const entries = colorMode === "material" ? materialLegend : componentCategories.map(category => [categoryLabels[category], componentColors[category]]);
  return (
    <details className="component-legend">
      <summary>{colorMode === "material" ? "建筑材质配色" : "构件分类配色"}</summary>
      <div>
        {entries.map(([label, color]) => (
          <span key={label}>
            <i style={{ backgroundColor: color }} />
            {label}
          </span>
        ))}
      </div>
      {colorMode === "material" && <p className="legend-note">材质为示意配色，非实测立面颜色。</p>}
    </details>
  );
}
