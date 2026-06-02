import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { getLayers, getObjects } from "./api/client";
import AttributeTable from "./components/AttributeTable";
import CesiumViewer, { type CesiumViewerHandle } from "./components/CesiumViewer";
import LayerPanel from "./components/LayerPanel";
import PropertyPanel from "./components/PropertyPanel";
import StatusBar from "./components/StatusBar";
import Toolbar from "./components/Toolbar";
import type { GugisObject, Layer, LayerState, MeasurementMode } from "./types/gugis";

type CameraCommand =
  | "resetCamera"
  | "topView"
  | "obliqueView"
  | "streetLevelView"
  | "northUp"
  | "rotateLeft"
  | "rotateRight"
  | "tiltUp"
  | "tiltDown";

export default function App() {
  const viewerRef = useRef<CesiumViewerHandle | null>(null);
  const [objects, setObjects] = useState<GugisObject[]>([]);
  const [layers, setLayers] = useState<Layer[]>([]);
  const [layerState, setLayerState] = useState<Record<string, LayerState>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hiddenObjectIds, setHiddenObjectIds] = useState<Set<string>>(new Set());
  const [measurementMode, setMeasurementMode] = useState<MeasurementMode>("none");
  const [clippingEnabled, setClippingEnabled] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [status, setStatus] = useState("Loading GUGIS sample city");
  const [backendState, setBackendState] = useState("API pending");
  const [cameraStatus, setCameraStatus] = useState("Camera pending");

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setLoadError(null);
    Promise.all([getObjects(), getLayers()])
      .then(([loadedObjects, loadedLayers]) => {
        if (cancelled) return;
        setObjects(loadedObjects);
        setLayers(loadedLayers);
        setLayerState(
          Object.fromEntries(
            loadedLayers.map((layer) => [
              layer.layer_id,
              {
                visible: layer.visible,
                opacity: layer.opacity
              }
            ])
          )
        );
        setStatus(`Loaded ${loadedObjects.length} GUGIS objects`);
        setBackendState("API ready or fallback active");
        setIsLoading(false);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : "Failed to load data";
        setLoadError(message);
        setStatus(message);
        setBackendState("API unavailable");
        setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const selectedObject = useMemo(
    () => objects.find((obj) => obj.object_id === selectedId) ?? null,
    [objects, selectedId]
  );

  const handleLayerChange = useCallback((layerId: string, patch: Partial<LayerState>) => {
    setLayerState((previous) => ({
      ...previous,
      [layerId]: {
        ...(previous[layerId] ?? { visible: true, opacity: 1 }),
        ...patch
      }
    }));
  }, []);

  const handleSelect = useCallback((objectId: string | null, fly = false) => {
    setSelectedId(objectId);
    if (objectId) {
      setStatus(`Selected ${objectId}`);
      if (fly) viewerRef.current?.flyToObject(objectId);
    } else {
      setStatus("Selection cleared");
    }
  }, []);

  const toggleSelectedVisibility = useCallback(() => {
    if (!selectedId) return;
    setHiddenObjectIds((previous) => {
      const next = new Set(previous);
      if (next.has(selectedId)) {
        next.delete(selectedId);
        setStatus(`Object ${selectedId} visible`);
      } else {
        next.add(selectedId);
        setStatus(`Object ${selectedId} hidden`);
      }
      return next;
    });
  }, [selectedId]);

  const handleHeightMode = useCallback(
    (mode: MeasurementMode) => {
      setMeasurementMode(mode);
      if (mode === "height" && selectedObject) {
        const height = Number(selectedObject.attributes.height_m ?? selectedObject.geometry.height ?? selectedObject.hybrid_box.radius_xyz[2] * 2);
        setStatus(`Height ${Number.isFinite(height) ? height.toFixed(1) : "unknown"} m`);
      } else if (mode === "distance") {
        setStatus("Click two positions to measure distance");
      } else if (mode === "height") {
        setStatus("Select an object to measure height");
      } else {
        setStatus("Pick mode");
      }
    },
    [selectedObject]
  );

  const runCameraCommand = useCallback((command: CameraCommand, label: string) => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    const action = viewer[command];
    if (typeof action === "function") {
      action();
      setStatus(label);
    }
  }, []);

  useEffect(() => {
    const editableTags = new Set(["INPUT", "SELECT", "TEXTAREA"]);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      const target = event.target as HTMLElement | null;
      if (target && (editableTags.has(target.tagName) || target.isContentEditable)) return;

      const key = event.key.toLowerCase();
      if (key === "t") {
        runCameraCommand("topView", "Top View");
      } else if (key === "o") {
        runCameraCommand("obliqueView", "Oblique View");
      } else if (key === "r") {
        runCameraCommand("resetCamera", "Reset to Bristol");
      } else if (key === "q") {
        runCameraCommand("rotateLeft", "Rotate Left");
      } else if (key === "e") {
        runCameraCommand("rotateRight", "Rotate Right");
      } else if (key === "w") {
        runCameraCommand("tiltUp", "Tilt Up");
      } else if (key === "s") {
        runCameraCommand("tiltDown", "Tilt Down");
      } else {
        return;
      }
      event.preventDefault();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [runCameraCommand]);

  return (
    <main className="app-shell">
      <Toolbar
        selectedId={selectedId}
        measurementMode={measurementMode}
        clippingEnabled={clippingEnabled}
        cameraReady={cameraReady}
        onResetCamera={() => runCameraCommand("resetCamera", "Reset to Bristol")}
        onTopView={() => runCameraCommand("topView", "Top View")}
        onObliqueView={() => runCameraCommand("obliqueView", "Oblique View")}
        onStreetLevelView={() => runCameraCommand("streetLevelView", "Street-level View")}
        onNorthUp={() => runCameraCommand("northUp", "North Up")}
        onRotateLeft={() => runCameraCommand("rotateLeft", "Rotate Left")}
        onRotateRight={() => runCameraCommand("rotateRight", "Rotate Right")}
        onTiltUp={() => runCameraCommand("tiltUp", "Tilt Up")}
        onTiltDown={() => runCameraCommand("tiltDown", "Tilt Down")}
        onFlyToSelected={() => selectedId && viewerRef.current?.flyToObject(selectedId)}
        onClearSelection={() => handleSelect(null)}
        onMeasurementModeChange={handleHeightMode}
        onToggleSelectedVisibility={toggleSelectedVisibility}
        onToggleClipping={() => {
          setClippingEnabled((value) => !value);
          setStatus(
            clippingEnabled
              ? "Slicing disabled"
              : "Slicing is currently a placeholder; planned for 3D Tiles / mesh-based objects."
          );
        }}
        onClearMeasurements={() => viewerRef.current?.clearMeasurements()}
      />
      <div className="workspace">
        <LayerPanel layers={layers} layerState={layerState} onLayerChange={handleLayerChange} />
        <section className="map-region">
          <CesiumViewer
            ref={viewerRef}
            objects={objects}
            layerState={layerState}
            selectedId={selectedId}
            hiddenObjectIds={hiddenObjectIds}
            measurementMode={measurementMode}
            clippingEnabled={clippingEnabled}
            onSelect={handleSelect}
            onStatus={setStatus}
            onCameraStatus={setCameraStatus}
            onViewerReady={setCameraReady}
          />
          {(isLoading || loadError || clippingEnabled) && (
            <div className={`map-overlay ${loadError ? "error" : ""}`}>
              {isLoading && <span>Loading GUGIS objects from API...</span>}
              {loadError && <span>Object loading failed: {loadError}</span>}
              {clippingEnabled && (
                <span>Slicing is currently a placeholder; planned for 3D Tiles / mesh-based objects.</span>
              )}
            </div>
          )}
          <AttributeTable objects={objects} layers={layers} selectedId={selectedId} onSelect={handleSelect} />
        </section>
        <PropertyPanel selected={selectedObject} />
      </div>
      <StatusBar
        status={status}
        objectCount={objects.length}
        selectedId={selectedId}
        backendState={backendState}
        cameraStatus={cameraStatus}
      />
    </main>
  );
}
