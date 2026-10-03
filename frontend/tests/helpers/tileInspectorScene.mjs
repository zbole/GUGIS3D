import React, { forwardRef, useImperativeHandle } from "react";

// This focused interaction harness verifies the parent/scene contract, not WebGL.
export const inspectorScene = { props: null, focuses: [], resets: 0 };
export default forwardRef(function InspectorScene(props, ref) {
  inspectorScene.props = props;
  useImperativeHandle(ref, () => ({ focusBuilding: id => inspectorScene.focuses.push(id),
    reset: () => { inspectorScene.resets++; } }));
  return React.createElement("div", { "data-scene-stub": true });
});
