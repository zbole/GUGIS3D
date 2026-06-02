import { Box, Database, MapPinned } from "lucide-react";

import type { GugisObject } from "../types/gugis";

interface PropertyPanelProps {
  selected: GugisObject | null;
}

function formatValue(value: unknown): string {
  if (typeof value === "object" && value !== null) return JSON.stringify(value);
  return String(value);
}

const shapeTypeLabels: Record<number, string> = {
  0: "Null",
  10000: "Point",
  20000: "Line",
  30000: "Surface",
  40000: "Body",
  50000: "ComplexObject",
  60000: "Mix",
  70000: "Template"
};

function geometryType(selected: GugisObject): string {
  if (typeof selected.geometry.function_type === "string") return selected.geometry.function_type;
  if (typeof selected.geometry.template_id === "string") return `template:${selected.geometry.template_id}`;
  if (Array.isArray(selected.geometry.polygon)) return "polygon";
  if (Array.isArray(selected.geometry.coordinates)) return "coordinates";
  return "generic-json";
}

export default function PropertyPanel({ selected }: PropertyPanelProps) {
  return (
    <aside className="side-panel right-panel">
      <div className="panel-title">
        <Database size={18} />
        <span>Properties</span>
      </div>
      {!selected ? (
        <div className="empty-state">No object selected</div>
      ) : (
        <div className="property-content">
          <div className="object-heading">
            <strong>{selected.name}</strong>
            <span>{selected.object_id}</span>
          </div>
          <section>
            <h3>
              <MapPinned size={15} />
              Object
            </h3>
            <dl>
              <dt>Object ID</dt>
              <dd>{selected.object_id}</dd>
              <dt>Name</dt>
              <dd>{selected.name}</dd>
              <dt>Layer</dt>
              <dd>{selected.layer_id}</dd>
              <dt>Shape type</dt>
              <dd>
                {shapeTypeLabels[selected.shape_type] ?? "Unknown"} ({selected.shape_type})
              </dd>
              <dt>Structure</dt>
              <dd>{selected.structure_type}</dd>
              <dt>Main type</dt>
              <dd>{selected.main_type}</dd>
              <dt>Sub type</dt>
              <dd>{selected.sub_type}</dd>
              <dt>Coord mode</dt>
              <dd>{selected.coordinate_mode}</dd>
              <dt>Geometry</dt>
              <dd>{geometryType(selected)}</dd>
              <dt>Height</dt>
              <dd>{formatValue(selected.attributes.height_m ?? selected.geometry.height ?? "-")}</dd>
              <dt>Floors</dt>
              <dd>{formatValue(selected.attributes.floors ?? "-")}</dd>
              <dt>Usage</dt>
              <dd>{formatValue(selected.attributes.usage ?? selected.attributes.road_type ?? selected.attributes.landuse ?? "-")}</dd>
              <dt>Base point</dt>
              <dd>{selected.base_point.map((value) => value.toFixed(5)).join(", ")}</dd>
              <dt>Pose</dt>
              <dd>
                strike {selected.pose.strike}, dip {selected.pose.dip}, roll {selected.pose.roll ?? 0}
              </dd>
            </dl>
          </section>
          <section>
            <h3>
              <Box size={15} />
              HybridBox
            </h3>
            <dl>
              <dt>Center</dt>
              <dd>{selected.hybrid_box.center.map((value) => value.toFixed(3)).join(", ")}</dd>
              <dt>Radii xyz</dt>
              <dd>{selected.hybrid_box.radius_xyz.map((value) => value.toFixed(1)).join(", ")}</dd>
              <dt>Radius 2D</dt>
              <dd>{selected.hybrid_box.radius_2d.toFixed(1)} m</dd>
              <dt>Radius 3D</dt>
              <dd>{selected.hybrid_box.radius_3d.toFixed(1)} m</dd>
            </dl>
          </section>
          <section>
            <h3>GUGIS Mapping</h3>
            <p className="mapping-note">
              This object is represented as {selected.structure_type}. FunctionStructure uses compact procedural geometry,
              TemplateStructure stores prototype instances, and DiscreteStructure stores polygon or mesh-style geometry.
            </p>
          </section>
          <section>
            <h3>Attributes</h3>
            <pre className="json-preview">{JSON.stringify(selected.attributes, null, 2)}</pre>
            <dl>
              {Object.entries(selected.attributes).map(([key, value]) => (
                <div className="attribute-pair" key={key}>
                  <dt>{key}</dt>
                  <dd>{formatValue(value)}</dd>
                </div>
              ))}
            </dl>
          </section>
        </div>
      )}
    </aside>
  );
}
