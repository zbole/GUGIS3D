import { useMemo, useState } from "react";

import type { GugisObject, Layer } from "../types/gugis";

interface AttributeTableProps {
  objects: GugisObject[];
  layers: Layer[];
  selectedId: string | null;
  onSelect: (objectId: string, fly?: boolean) => void;
}

export default function AttributeTable({ objects, layers, selectedId, onSelect }: AttributeTableProps) {
  const [layerFilter, setLayerFilter] = useState("all");
  const [structureFilter, setStructureFilter] = useState("all");
  const [textFilter, setTextFilter] = useState("");

  const structureTypes = useMemo(
    () => Array.from(new Set(objects.map((obj) => obj.structure_type))).sort(),
    [objects]
  );

  const filtered = useMemo(() => {
    const text = textFilter.trim().toLowerCase();
    return objects.filter((obj) => {
      const layerOk = layerFilter === "all" || obj.layer_id === layerFilter;
      const structureOk = structureFilter === "all" || obj.structure_type === structureFilter;
      const textOk =
        !text ||
        obj.object_id.toLowerCase().includes(text) ||
        obj.name.toLowerCase().includes(text) ||
        Object.values(obj.attributes).some((value) => String(value).toLowerCase().includes(text));
      return layerOk && structureOk && textOk;
    });
  }, [layerFilter, objects, structureFilter, textFilter]);

  return (
    <section className="attribute-table">
      <div className="table-controls">
        <select value={layerFilter} onChange={(event) => setLayerFilter(event.target.value)} aria-label="Layer filter">
          <option value="all">All layers</option>
          {layers
            .filter((layer) => !layer.placeholder)
            .map((layer) => (
              <option value={layer.layer_id} key={layer.layer_id}>
                {layer.name}
              </option>
            ))}
        </select>
        <input
          type="search"
          value={textFilter}
          onChange={(event) => setTextFilter(event.target.value)}
          placeholder="Search object or attributes"
          aria-label="Attribute text filter"
        />
        <select
          value={structureFilter}
          onChange={(event) => setStructureFilter(event.target.value)}
          aria-label="Structure type filter"
        >
          <option value="all">All structures</option>
          {structureTypes.map((structure) => (
            <option value={structure} key={structure}>
              {structure}
            </option>
          ))}
        </select>
        <span>{filtered.length} rows</span>
      </div>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Object</th>
              <th>Name</th>
              <th>Layer</th>
              <th>Structure</th>
              <th>Height</th>
              <th>Usage</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((obj) => (
              <tr
                key={obj.object_id}
                className={obj.object_id === selectedId ? "selected" : ""}
                onClick={() => onSelect(obj.object_id, true)}
              >
                <td>
                  <strong>{obj.object_id}</strong>
                </td>
                <td>{obj.name}</td>
                <td>{obj.layer_id}</td>
                <td>{obj.structure_type}</td>
                <td>{String(obj.attributes.height_m ?? "-")}</td>
                <td>{String(obj.attributes.usage ?? obj.attributes.road_type ?? obj.attributes.landuse ?? "-")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
