// Keep Cesium's real geometry/matrix/entity types. Substitute only the GPU viewer
// and primitive lifecycle so React updates can be tested without a browser.
export * from "cesium";
import { Cartesian3, Event, EntityCollection, Transforms, Matrix4, Ray, Intersect, Cartographic } from "cesium";
export const viewState = { viewers: [], primitives: [], handlers: [] };
export class Primitive {
  constructor(options) {
    this.options = options;
    this.appearance = options.appearance;
    this.ready = true;
    this.show = true;
    this.attributes = new Map();
    for (const instance of [options.geometryInstances].flat())
      this.attributes.set(
        instance.id,
        Object.fromEntries(
          Object.entries(instance.attributes).map(([k, v]) => [k, v.value]),
        ),
      );
    viewState.primitives.push(this);
  }
  getGeometryInstanceAttributes(id) {
    return this.attributes.get(id);
  }
}
export class ScreenSpaceEventHandler {
  constructor() {
    this.actions = new Map();
    viewState.handlers.push(this);
  }
  setInputAction(fn, type) {
    this.actions.set(type, fn);
  }
  destroy() {}
}
export class Viewer {
  constructor(_host, options) {
    this.options = options;
    const primitives = [];
    this.entities = new EntityCollection();
    this.camera = {
      positionWC: Cartesian3.fromDegrees(-2.603, 51.454, 1000),
      get positionCartographic() { return Cartographic.fromCartesian(this.positionWC); },
      heading: 18 * Math.PI / 180, pitch: -45 * Math.PI / 180, roll: 0,
      sets: [], cancellations: 0,
      cancelFlight: () => { this.camera.cancellations++; },
      setView: options => {
        this.camera.sets.push(options);
        this.camera.positionWC = options.destination;
        Object.assign(this.camera, options.orientation);
        this.camera.changed.raiseEvent();
      },
      computeViewRectangle: () => undefined,
      changed: new Event(),
      moveEnd: new Event(),
      pixelSize: 0.1,
      visible: true,
      frustum: { computeCullingVolume: () => ({ computeVisibility: () => this.camera.visible ? Intersect.INSIDE : Intersect.OUTSIDE }) },
      getPixelSize: () => this.camera.pixelSize,
      getPickRay: () => {
        const frame = Transforms.eastNorthUpToFixedFrame(Cartesian3.fromDegrees(-2.603, 51.454));
        return new Ray(Matrix4.multiplyByPoint(frame, new Cartesian3(0, 0, 1000), new Cartesian3()),
          Matrix4.multiplyByPointAsVector(frame, new Cartesian3(0, 0, -1), new Cartesian3()));
      },
      flights: [],
      flyToBoundingSphere: (...args) => this.camera.flights.push(args),
      pickEllipsoid: () => Cartesian3.fromDegrees(-2.603, 51.454),
    };
    this.scene = {
      canvas: { clientWidth: 800, clientHeight: 600 },
      screenSpaceCameraController: {},
      postRender: new Event(),
      renderError: new Event(),
      primitives: {
        values: primitives,
        add: (p) => {
          primitives.push(p);
          return p;
        },
        remove: (p) => {
          const index = primitives.indexOf(p);
          if (index >= 0) primitives.splice(index, 1);
        },
      },
      requestRender() {},
      pick: () => this.picked,
    };
    viewState.viewers.push(this);
  }
  isDestroyed() {
    return !!this.destroyed;
  }
  destroy() {
    this.destroyed = true;
  }
}
