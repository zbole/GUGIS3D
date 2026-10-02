import type { FeatureAsset, FunctionPrimitive } from "./environment";

const definitions: Record<
  FunctionPrimitive["function"],
  { name: string; formula: string; domain: string }
> = {
  sphere: {
    name: "球体函数",
    formula: "x = ρ sinφ cosθ, y = ρ sinφ sinθ, z = ρ cosφ",
    domain: "0 ≤ ρ ≤ r，0 ≤ θ < 2π，0 ≤ φ ≤ π",
  },
  cylinder: {
    name: "圆柱函数",
    formula: "x = ρ cosθ, y = ρ sinθ, z = t",
    domain: "0 ≤ ρ ≤ r，0 ≤ θ < 2π，−h/2 ≤ t ≤ h/2",
  },
  "annular-prism": {
    name: "圆弧扇体函数",
    formula: "x = ρ cosθ, y = ρ sinθ, z = t",
    domain: "内半径 ≤ ρ ≤ 外半径，−α/2 ≤ θ ≤ α/2，−h/2 ≤ t ≤ h/2",
  },
  "arch-prism": {
    name: "半圆拱体函数",
    formula: "x = ρ cosθ, y = t, z = ρ sinθ",
    domain: "内半径 ≤ ρ ≤ 外半径，0 ≤ θ ≤ π，−厚度/2 ≤ t ≤ 厚度/2",
  },
  box: {
    name: "参数盒体",
    formula: "x = u·宽, y = v·深, z = w·高",
    domain: "−1/2 ≤ u,v,w ≤ 1/2",
  },
};
export default function FunctionExplanation({
  asset,
  references = 0,
}: {
  asset: FeatureAsset;
  references?: number;
}) {
  return (
    <section className="function-explanation" aria-label="函数构造说明">
      <h3>函数构造</h3>
      <p>
        <strong>{asset.components.length} 个离散组件</strong> ·{" "}
        {new Set(asset.components.map((p) => p.function)).size} 类函数 ·
        当前定义被 {references} 个已保存地物引用
      </p>
      <p className="function-composition">
        {asset.components
          .map((p) => `${p.category}（${definitions[p.function].name}）`)
          .join(" + ")}
      </p>
      <details className="function-reference">
      <summary>函数公式与 GUGIS 编码</summary>
      <p>
        每个组件先由函数和参数确定形状，再按组件位置组合，最后应用地物整体比例、朝向和地理位置。
      </p>
      {asset.components.map((part, index) => (
        <details key={part.id} open={index === 0}>
          <summary>
            <i style={{ background: part.color }} />
            {part.category} · {definitions[part.function].name}
          </summary>
          <code>{definitions[part.function].formula}</code>
          <p>{definitions[part.function].domain}</p>
          <p>
            当前参数：
            {Object.entries(part.parameters)
              .map(([k, v]) => `${k}=${v}`)
              .join("，")}
            ；位置 ({part.position.join(", ")}) m
          </p>
          <p className="muted">角度输入使用度，函数计算转换为弧度。</p>
        </details>
      ))}
      <details>
        <summary>查看写入 GUGIS 的函数定义</summary>
        <pre>
          {JSON.stringify(
            { kind: asset.kind, components: asset.components },
            null,
            2,
          )}
        </pre>
      </details>
      <p className="muted">
        城市文件保存函数、参数和组件关系；显示时生成三角网缓存。现有楼栋另外使用盒体参数与网格模板。
      </p>
      </details>
    </section>
  );
}
