import { useMemo } from "react";
import { Box, ChevronRight, LocateFixed, X } from "lucide-react";
import {
  BuildingDocument,
  SceneNode,
  categoryLabels,
  descendants,
} from "./model";
import { buildingColor, type BuildingColorMode } from "./buildingAppearance";
export default function Inspector({
  document,
  selected,
  onSelect,
  onFocus,
  ready,
  colorMode = "material",
  appearanceKey,
}: {
  document: BuildingDocument;
  selected: string | null;
  onSelect: (id: string | null) => void;
  onFocus: () => void;
  ready: boolean;
  colorMode?: BuildingColorMode;
  appearanceKey?: string;
}) {
  const lookup = useMemo(
    () => new Map(document.nodes.map((n) => [n.id, n])),
    [document],
  );
  const node = lookup.get(selected ?? "building") ?? document.nodes[0];
  const lineage: SceneNode[] = [];
  let current: SceneNode | undefined = node;
  while (current) {
    lineage.unshift(current);
    current = current.parent ? lookup.get(current.parent) : undefined;
  }
  const dwelling = lineage.find((n) => n.category === "dwelling"),
    solid = node.template ? document.templates[node.template] : undefined;
  const count = descendants(document, node.id).size - 1;
  return (
    <>
      <div className="panel-heading">
        <h2>对象属性</h2>
        {selected && (
          <button
            className="icon-button"
            aria-label="清除选中"
            onClick={() => onSelect(null)}
          >
            <X size={16} />
          </button>
        )}
      </div>
      <div className="inspector-content">
        <div className="object-kind">
          <Box size={15} />
          {categoryLabels[node.category]}
        </div>
        <h3>{node.name}</h3>
        <code className="object-id">{node.id}</code>
        <nav className="lineage" aria-label="对象归属">
          {lineage.map((n) => (
            <button key={n.id} onClick={() => onSelect(n.id)}>
              {n.name}
              <ChevronRight size={12} />
            </button>
          ))}
        </nav>
        <button className="full" onClick={onFocus} disabled={!ready}>
          <LocateFixed size={16} />
          定位到{selected ? "选中对象" : "楼栋"}
        </button>
        <section>
          <h4>语义关系</h4>
          <dl>
            <dt>所属单元</dt>
            <dd>{node.unit ? `${node.unit} 单元` : "—"}</dd>
            <dt>所属楼层</dt>
            <dd>{node.floor ? `${node.floor} 层` : "—"}</dd>
            <dt>子孙对象</dt>
            <dd>{count}</dd>
            <dt>表达结构</dt>
            <dd>{solid ? "模板实例" : "组合对象"}</dd>
          </dl>
        </section>
        {dwelling && (
          <section>
            <h4>关联住户</h4>
            <dl>
              {Object.entries(dwelling.attributes ?? {}).map(([k, v]) => (
                <div className="attribute-pair" key={k}>
                  <dt>{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </dl>
          </section>
        )}
        {Object.keys(node.attributes ?? {}).length > 0 && node !== dwelling && (
          <section>
            <h4>对象信息</h4>
            <dl>
              {Object.entries(node.attributes ?? {}).map(([k, v]) => (
                <div className="attribute-pair" key={k}>
                  <dt>{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </dl>
          </section>
        )}
        {solid && (
          <section>
            <h4>三维构件</h4>
            <dl>
              <dt>模板编号</dt>
              <dd>{node.template}</dd>
              <dt>实体类型</dt>
              <dd>{solid.kind === "box" ? "参数长方体" : "闭合三角面实体"}</dd>
              <dt>局部位置 / m</dt>
              <dd>{node.position?.map((v) => v.toFixed(2)).join(", ")}</dd>
              <dt>局部旋转</dt>
              <dd>{(node.rotation_z ?? 0).toFixed(2)}°</dd>
                <dt>显示配色</dt>
              <dd>
                <i
                  className="category-swatch"
                  style={{
                    backgroundColor:
                      buildingColor(node.category, document.parameters.kind, appearanceKey ?? document.parameters.name, colorMode, solid.color),
                  }}
                />{" "}
                {buildingColor(node.category, document.parameters.kind, appearanceKey ?? document.parameters.name, colorMode, solid.color)}
              </dd>
              {solid.size && (
                <>
                  <dt>尺寸 / m</dt>
                  <dd>{solid.size.join(" × ")}</dd>
                </>
              )}
              {solid.vertices && (
                <>
                  <dt>顶点 / 三角面</dt>
                  <dd>
                    {solid.vertices.length} / {solid.triangles?.length}
                  </dd>
                </>
              )}
            </dl>
          </section>
        )}
        <p className="inspector-note">
          位置采用局部东、北、天坐标，单位为米。楼层移开与隐藏仅影响当前视图。
        </p>
      </div>
    </>
  );
}
