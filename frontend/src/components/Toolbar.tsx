import { EyeOff, Focus, Home, Move3d, Ruler, ScanLine, Slice, Trash2, XCircle } from "lucide-react";

import type { MeasurementMode } from "../types/gugis";

interface ToolbarProps {
  selectedId: string | null;
  measurementMode: MeasurementMode;
  clippingEnabled: boolean;
  cameraReady: boolean;
  onResetCamera: () => void;
  onTopView: () => void;
  onObliqueView: () => void;
  onStreetLevelView: () => void;
  onNorthUp: () => void;
  onRotateLeft: () => void;
  onRotateRight: () => void;
  onTiltUp: () => void;
  onTiltDown: () => void;
  onFlyToSelected: () => void;
  onClearSelection: () => void;
  onMeasurementModeChange: (mode: MeasurementMode) => void;
  onToggleSelectedVisibility: () => void;
  onToggleClipping: () => void;
  onClearMeasurements: () => void;
}

export default function Toolbar({
  selectedId,
  measurementMode,
  clippingEnabled,
  cameraReady,
  onResetCamera,
  onTopView,
  onObliqueView,
  onStreetLevelView,
  onNorthUp,
  onRotateLeft,
  onRotateRight,
  onTiltUp,
  onTiltDown,
  onFlyToSelected,
  onClearSelection,
  onMeasurementModeChange,
  onToggleSelectedVisibility,
  onToggleClipping,
  onClearMeasurements
}: ToolbarProps) {
  return (
    <div className="toolbar" role="toolbar" aria-label="Map tools">
      <div className="toolbar-group view-group" aria-label="View controls">
        <span className="toolbar-group-label">View</span>
        <button title="Top View (T)" onClick={onTopView} disabled={!cameraReady}>
          Top
        </button>
        <button title="Oblique View (O)" onClick={onObliqueView} disabled={!cameraReady}>
          Oblique
        </button>
        <button title="Street-level View" onClick={onStreetLevelView} disabled={!cameraReady}>
          Street
        </button>
        <button title="North Up" onClick={onNorthUp} disabled={!cameraReady}>
          North
        </button>
        <button title="Rotate Left (Q)" onClick={onRotateLeft} disabled={!cameraReady}>
          Left
        </button>
        <button title="Rotate Right (E)" onClick={onRotateRight} disabled={!cameraReady}>
          Right
        </button>
        <button title="Tilt Up (W)" onClick={onTiltUp} disabled={!cameraReady}>
          Tilt Up
        </button>
        <button title="Tilt Down (S)" onClick={onTiltDown} disabled={!cameraReady}>
          Tilt Down
        </button>
        <button title="Reset to Bristol (R)" onClick={onResetCamera} disabled={!cameraReady}>
          <Home size={16} />
          Reset
        </button>
      </div>
      <span className="toolbar-divider" />
      <button title="Fly to selected object" onClick={onFlyToSelected} disabled={!selectedId || !cameraReady}>
        <Focus size={18} />
      </button>
      <button title="Clear selection" onClick={onClearSelection} disabled={!selectedId}>
        <XCircle size={18} />
      </button>
      <span className="toolbar-divider" />
      <button
        title="Distance measurement"
        className={measurementMode === "distance" ? "active" : ""}
        onClick={() => onMeasurementModeChange(measurementMode === "distance" ? "none" : "distance")}
      >
        <Ruler size={18} />
      </button>
      <button
        title="Height measurement"
        className={measurementMode === "height" ? "active" : ""}
        onClick={() => onMeasurementModeChange(measurementMode === "height" ? "none" : "height")}
      >
        <Move3d size={18} />
      </button>
      <button title="Clear measurements" onClick={onClearMeasurements}>
        <Trash2 size={18} />
      </button>
      <span className="toolbar-divider" />
      <button title="Toggle selected object visibility" onClick={onToggleSelectedVisibility} disabled={!selectedId}>
        <EyeOff size={18} />
      </button>
      <button
        title="Toggle clipping / slicing"
        className={clippingEnabled ? "active" : ""}
        onClick={onToggleClipping}
      >
        <Slice size={18} />
      </button>
      <button title="Return to pick mode" onClick={() => onMeasurementModeChange("none")}>
        <ScanLine size={18} />
      </button>
    </div>
  );
}
