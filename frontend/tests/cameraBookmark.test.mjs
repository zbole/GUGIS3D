import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { fileURLToPath, pathToFileURL } from "node:url";
const outfile = fileURLToPath(new URL("../node_modules/.cache/gugis-tests/camera-bookmark.mjs", import.meta.url));
await build({ entryPoints: [fileURLToPath(new URL("../src/studio/cameraBookmark.ts", import.meta.url))], outfile,
  bundle: true, platform: "node", format: "esm", packages: "external" });
const { validateCameraPose, encodeCameraBookmark, decodeCameraBookmark, cameraBookmarkUrl,
  cameraBookmarkForLocation, stripCameraFragment } = await import(pathToFileURL(outfile).href);
const bookmark = { city: "london", revision: "a".repeat(64), pose: [-.1276, 51.5072, 1600.125, 18, -45, 0] };
const encoded = encodeCameraBookmark(bookmark);

test("bounded camera links round-trip all cities, normalizing angles without serializing other state", () => {
  for (const city of ["bristol", "london", "birmingham"]) {
    const input = { ...bookmark, city, pose: [-180, -85, 2, -90, 90, 360] };
    assert.deepEqual(decodeCameraBookmark(encodeCameraBookmark(input)), {
      kind: "valid", bookmark: { ...input, pose: [-180, -85, 2, 270, 90, 0] },
    });
  }
  assert.deepEqual(decodeCameraBookmark(encoded), { kind: "valid", bookmark });
  assert.equal(decodeCameraBookmark("").kind, "none");
  assert.equal(decodeCameraBookmark("#terrain").kind, "none");
  assert.equal(decodeCameraBookmark(encodeCameraBookmark({ ...bookmark, pose: [0.0000001, 0, 100000, 359.99999999, -90, -0.0000001] })).kind, "valid");
});

test("pose validation rejects non-finite, missing and out-of-range numbers without clamping", () => {
  for (const [index, bad] of [[0, 181], [1, 85.01], [2, 1.999], [2, 100001], [3, 361], [4, -91], [5, -361]]) {
    const pose = [...bookmark.pose]; pose[index] = bad;
    assert.equal(validateCameraPose(pose), null);
    assert.throws(() => encodeCameraBookmark({ ...bookmark, pose }));
  }
  for (const bad of [NaN, Infinity, -Infinity, "1", null, undefined]) {
    const pose = [...bookmark.pose]; pose[0] = bad;
    assert.equal(validateCameraPose(pose), null);
  }
  assert.equal(validateCameraPose([1, 2, 3]), null);
  assert.equal(validateCameraPose([...bookmark.pose, 0]), null);
});

test("codec rejects malicious, duplicate, oversized and non-decimal fragments", () => {
  const bad = [encoded + "&city=london", encoded + "&budget=999999", encoded + "&url=https://evil.test/",
    encoded.replace("=1&", "=2&"), encoded.replace("city=london", "city=../london"), encoded.replace("city=london", "city=paris"),
    encoded.replace("a".repeat(64), "a".repeat(63)), encoded.replace("a".repeat(64), "A".repeat(64)),
    encoded + "x".repeat(512), "#gugis-view=", "#gugis-viewExtra=1", encoded.replace("city=london", "city=%6condon"),
    encoded.replace("city=london", "city=london&revision=" + "b".repeat(64))];
  for (const token of ["1e2", "0x10", "Infinity", "NaN", " 1", "+1", "01", ".5", "1.", "1%2C2", "1".repeat(25), "-181"])
    bad.push(encoded.replace("pose=-0.1276", "pose=" + token));
  for (const hash of bad) assert.equal(decodeCameraBookmark(hash).kind, "invalid", hash);
});

test("generated URLs keep only the current origin/path and allowlisted session fields", () => {
  const href = "https://maps.example.test/workbench/?cities=london,paris,bristol,london&city=birmingham&source=/secret&api=https://evil.test&names=private&pause=true&budget=999#private";
  const url = new URL(cameraBookmarkUrl(href, bookmark));
  assert.equal(url.origin, "https://maps.example.test"); assert.equal(url.pathname, "/workbench/");
  assert.deepEqual([...url.searchParams.keys()], ["city", "cities", "view_mode"]);
  assert.equal(url.searchParams.get("cities"), "london,bristol");
  assert.equal(url.searchParams.get("city"), "london"); assert.equal(url.searchParams.get("view_mode"), "tiles");
  assert.equal(url.hash, encoded); assert.ok(url.href.length <= 512);
  for (const bad of ["https://user:password@maps.example.test/", "file:///private", "javascript:alert(1)",
    "https://maps.example.test//evil.test/path", "https://maps.example.test/" + "x".repeat(512)]) assert.throws(() => cameraBookmarkUrl(bad, bookmark));
  assert.throws(() => cameraBookmarkUrl(href, { ...bookmark, city: "paris" }));
});

test("location validation binds explicit city and tile mode without legacy city fallbacks", () => {
  const href = cameraBookmarkUrl("http://localhost/", bookmark);
  assert.equal(cameraBookmarkForLocation(href, "london", true).kind, "valid");
  for (const input of [href.replace("city=london&cities", "city=bristol&cities"), href.replace("city=london&cities", "city=unknown&cities"),
    href.replace("city=london&cities", "city=london&city=london&cities"), href.replace("view_mode=tiles", "view_mode=tiles&view_mode=tiles"),
    href.replace("view_mode=tiles", "workspace=city")]) assert.equal(cameraBookmarkForLocation(input, "london", true).kind, "invalid");
  assert.equal(cameraBookmarkForLocation(href, "bristol", true).kind, "invalid");
  assert.equal(cameraBookmarkForLocation(href, "london", false).kind, "invalid");
  assert.equal(new URL(stripCameraFragment(href)).hash, "");
  assert.equal(new URL(stripCameraFragment("http://localhost/#terrain")).hash, "#terrain");
});
