import { useEffect, useMemo, useState } from "react";
import {
  Building2,
  ChevronDown,
  ChevronRight,
  Layers3,
  Search,
} from "lucide-react";
import type { BuildingDocument, SceneNode } from "./model";

export default function SemanticTree({
  document,
  selected,
  onSelect,
}: {
  document: BuildingDocument;
  selected: string | null;
  onSelect: (id: string | null) => void;
}) {
  const [expanded, setExpanded] = useState(new Set(["building", "u1"]));
  const [query, setQuery] = useState("");
  const children = useMemo(() => {
    const result = new Map<string, SceneNode[]>();
    for (const n of document.nodes) {
      const key = n.parent ?? "";
      const list = result.get(key) ?? [];
      list.push(n);
      result.set(key, list);
    }
    return result;
  }, [document]);
  useEffect(() => {
    const nodes = new Map(document.nodes.map((n) => [n.id, n]));
    setExpanded((previous) => {
      const next = new Set(previous);
      let n = selected ? nodes.get(selected) : null;
      while (n?.parent) {
        next.add(n.parent);
        n = nodes.get(n.parent);
      }
      return next;
    });
  }, [selected, document]);
  const matches = useMemo(() => {
    const text = query.trim().toLocaleLowerCase();
    return text
      ? document.nodes.filter((n) =>
          `${n.name} ${n.id} ${Object.values(n.attributes ?? {}).join(" ")}`
            .toLocaleLowerCase()
            .includes(text),
        )
      : [];
  }, [query, document]);
  function row(node: SceneNode, depth: number): React.ReactNode {
    const kids = children.get(node.id) ?? [],
      open = expanded.has(node.id);
    return (
      <li key={node.id}>
        <div
          className={`tree-row ${selected === node.id ? "selected" : ""}`}
          style={{ paddingLeft: 12 + depth * 14 }}
        >
          {kids.length ? (
            <button
              className="tree-toggle"
              aria-label={`${open ? "收起" : "展开"} ${node.name}`}
              aria-expanded={open}
              onClick={() =>
                setExpanded((old) => {
                  const n = new Set(old);
                  if (open) n.delete(node.id);
                  else n.add(node.id);
                  return n;
                })
              }
            >
              {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </button>
          ) : (
            <span className="tree-spacer" />
          )}
          <button
            className="node-select"
            aria-pressed={selected === node.id}
            onClick={() => onSelect(node.id)}
            title={`${node.name} · ${node.id}`}
          >
            {node.category === "building" ? (
              <Building2 size={16} />
            ) : node.category === "floor" ? (
              <Layers3 size={15} />
            ) : (
              <span className={`node-dot ${node.category}`} />
            )}
            <span>{node.name}</span>
            {kids.length > 0 && <small>{kids.length}</small>}
          </button>
        </div>
        {open && kids.length > 0 && (
          <ul>{kids.map((n) => row(n, depth + 1))}</ul>
        )}
      </li>
    );
  }
  return (
    <>
      <div className="panel-heading">
        <h2>对象结构</h2>
        <span>{document.nodes.length.toLocaleString()} 对象</span>
      </div>
      <label className="studio-search">
        <Search size={15} />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索构件、空间编号…"
          aria-label="搜索对象"
        />
      </label>
      <div className="tree-scroll">
        {query.trim() ? (
          <>
            <p className="search-count">
              找到 {matches.length} 项
              {matches.length > 80 ? "，显示前 80 项" : ""}
            </p>
            {matches.slice(0, 80).map((n) => (
              <button
                className={`search-result ${selected === n.id ? "selected" : ""}`}
                key={n.id}
                onClick={() => onSelect(n.id)}
              >
                <span>{n.name}</span>
                <small>
                  {n.unit ? `${n.unit} 单元 / ${n.floor ?? "—"} 层 · ` : ""}
                  {n.id}
                </small>
              </button>
            ))}
            {!matches.length && (
              <p className="muted">没有匹配对象。可尝试“南窗”或“DEMO”。</p>
            )}
          </>
        ) : (
          <ul className="object-tree" aria-label="建筑对象层级">
            {(children.get("") ?? []).map((n) => row(n, 0))}
          </ul>
        )}
      </div>
      <div className="tree-footer">
        <span className="node-dot window" /> 点选构件可追溯所属空间与楼层
      </div>
    </>
  );
}
