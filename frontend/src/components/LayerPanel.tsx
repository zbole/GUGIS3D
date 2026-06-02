import { Layers, SlidersHorizontal } from "lucide-react";

import type { Layer, LayerState } from "../types/gugis";

interface LayerPanelProps {
  layers: Layer[];
  layerState: Record<string, LayerState>;
  onLayerChange: (layerId: string, patch: Partial<LayerState>) => void;
}

export default function LayerPanel({ layers, layerState, onLayerChange }: LayerPanelProps) {
  const groups = [
    { title: "Base", layerIds: ["terrain"] },
    { title: "3D Objects", layerIds: ["buildings", "roads", "parks", "templates"] },
    { title: "Analysis", layerIds: [] },
    { title: "AI Placeholder", layerIds: ["ai_results"] }
  ];
  const layersById = new Map(layers.map((layer) => [layer.layer_id, layer]));

  return (
    <aside className="side-panel left-panel">
      <div className="panel-title">
        <Layers size={18} />
        <span>Layers</span>
      </div>
      <div className="layer-list">
        {groups.map((group) => {
          const groupLayers = group.layerIds.map((layerId) => layersById.get(layerId)).filter((layer): layer is Layer => Boolean(layer));
          return (
            <section className="layer-group" key={group.title}>
              <div className="layer-group-title">
                <span>{group.title}</span>
                <small>{groupLayers.reduce((total, layer) => total + layer.object_count, 0)} objects</small>
              </div>
              {groupLayers.length === 0 ? (
                <div className="layer-placeholder">Planned analysis overlays</div>
              ) : (
                groupLayers.map((layer) => {
                  const state = layerState[layer.layer_id] ?? { visible: layer.visible, opacity: layer.opacity };
                  return (
                    <div className="layer-row" key={layer.layer_id}>
                      <label className="layer-main">
                        <input
                          type="checkbox"
                          checked={state.visible}
                          onChange={(event) => onLayerChange(layer.layer_id, { visible: event.target.checked })}
                        />
                        <span>
                          <strong>{layer.name}</strong>
                          <small>{layer.placeholder ? "placeholder" : `${layer.object_count} objects`}</small>
                        </span>
                      </label>
                      <label className="opacity-control">
                        <SlidersHorizontal size={14} />
                        <input
                          type="range"
                          min="0.15"
                          max="1"
                          step="0.05"
                          value={state.opacity}
                          onChange={(event) => onLayerChange(layer.layer_id, { opacity: Number(event.target.value) })}
                        />
                        <span>{Math.round(state.opacity * 100)}%</span>
                      </label>
                    </div>
                  );
                })
              )}
            </section>
          );
        })}
      </div>
    </aside>
  );
}
