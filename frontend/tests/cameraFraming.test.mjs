import test from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import { Cartesian2, Cartesian3, Cartographic, Ellipsoid, Matrix4, Math as CM } from "cesium";
import { realCamera } from "./helpers/realCamera.mjs";
const outfile = fileURLToPath(new URL("../node_modules/.cache/gugis-tests/camera-framing.mjs", import.meta.url));
await build({ entryPoints: [fileURLToPath(new URL("../src/studio/cameraFraming.ts", import.meta.url))], outfile,
  bundle: true, platform: "node", format: "esm", packages: "external" });
const { defaultCameraTarget, frameCameraTarget } = await import(pathToFileURL(outfile).href);
const streamfile = outfile.replace("camera-framing", "camera-framing-stream");
await build({ entryPoints: [fileURLToPath(new URL("../src/studio/renderTileClient.ts", import.meta.url))], outfile: streamfile,
  bundle: true, platform: "node", format: "esm", packages: "external" });
const { chooseViewportTiles, tileLoadingProfiles } = await import(pathToFileURL(streamfile).href);
const catalog = JSON.parse(await readFile(new URL('../../shared/city-workspaces.json', import.meta.url), 'utf8'));
const centers = Object.fromEntries(catalog.map(({ id, query_bbox_wgs84: b }) => [id, [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2]]));
const dimensions = [[1040, 500], [800, 500], [1400, 400], [390, 700]];
const evidence = [];

for (const [city, [longitude, latitude]] of Object.entries(centers)) {
  const manifest = JSON.parse(await readFile(new URL(`./fixtures/render-manifests/${city}.json`, import.meta.url), "utf8"));
  test(`${city} camera fixture is the exact retained-source revision`, async () => {
    const source = city === "bristol" ? "bristol.gugis.json" : `cities/${city}.gugis.json`;
    const bytes = await readFile(new URL(`../../backend/data/${source}`, import.meta.url));
    assert.equal(createHash("sha256").update(bytes).digest("hex"), manifest.revision);
    assert.equal(manifest.city_id, city);
  });
  for (const [width, height] of dimensions) for (const [profile, budget] of Object.entries(tileLoadingProfiles)) {
    test(`${city} ${profile} ${width}x${height} default aims at the actual sample and selects nonempty bounded tiles`, () => {
      const camera = realCamera(width, height);
      const target = defaultCameraTarget(manifest.bounds_wgs84, { longitude, latitude });
      frameCameraTarget(camera, target);
      const rectangle = camera.computeViewRectangle(Ellipsoid.WGS84);
      assert.ok(rectangle, "target-centered framing must have an ellipsoid footprint");
      const bounds = [rectangle.west, rectangle.south, rectangle.east, rectangle.north].map(CM.toDegrees);
      assert.ok(bounds.every(Number.isFinite));
      const point = camera.pickEllipsoid(new Cartesian2(width / 2, height / 2), Ellipsoid.WGS84);
      assert.ok(point, "center ray hits the sample target");
      const centerError = Cartesian3.distance(point, Cartesian3.fromDegrees(target.longitude, target.latitude));
      assert.ok(centerError < .01, `target is ${centerError} m off-center`);
      assert.ok(Matrix4.equals(camera.transform, Matrix4.IDENTITY), "free navigation returns to the world frame");
      const actual = Cartographic.fromCartesian(point);
      const view = { bounds, center: { longitude: CM.toDegrees(actual.longitude), latitude: CM.toDegrees(actual.latitude) } };
      const plan = chooseViewportTiles(manifest, view, budget);
      assert.ok(plan.candidates > 0); assert.ok(plan.chosen.length > 0);
      assert.ok(plan.chosen.length <= budget.activeTiles); assert.ok(plan.bytes <= budget.activeBytes);
      evidence.push({ city, profile, width, height, source_revision: manifest.revision, bounds,
        target: [target.longitude, target.latitude], center_error_m: centerError, intersecting_tiles: plan.candidates,
        total_tiles: manifest.tiles.length, selected_tiles: plan.chosen.length, selected_source_bytes: plan.bytes });
    });
  }
}

test("empty package framing stays aimed at its own catalog city", () => {
  for (const [longitude, latitude] of Object.values(centers)) {
    const camera = realCamera(390, 700), target = defaultCameraTarget(null, { longitude, latitude });
    frameCameraTarget(camera, target);
    const hit = camera.pickEllipsoid(new Cartesian2(195, 350), Ellipsoid.WGS84);
    assert.ok(Cartesian3.distance(hit, Cartesian3.fromDegrees(longitude, latitude)) < .01);
  }
});

test("save reproducible no-GPU framing evidence", async () => {
  assert.equal(evidence.length, catalog.length * dimensions.length * Object.keys(tileLoadingProfiles).length);
  // Test output, not a formal city/cache write. The evidence explicitly excludes GPU QA.
  await writeFile(join(tmpdir(), "gugis-default-camera-after.json"), JSON.stringify({ method: "Real Cesium Camera math; no browser, WebGL or GPU", cases: evidence }, null, 2));
});
