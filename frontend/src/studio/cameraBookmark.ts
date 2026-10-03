import { knownCities, type CityId } from "./cityWorkspaces";

/** Degrees / metres, never tile URLs, source paths, selection or viewport bounds. */
export type CameraPose = [longitude: number, latitude: number, height: number, heading: number, pitch: number, roll: number];
export interface CameraBookmark { city: CityId; revision: string; pose: CameraPose }
export type CameraBookmarkResult = { kind: "none" } | { kind: "invalid"; message: string } | { kind: "valid"; bookmark: CameraBookmark };
export interface CameraNavigation { sequence: number; result: CameraBookmarkResult }
export const noCameraNavigation: CameraNavigation = { sequence: 0, result: { kind: "none" } };
export const cameraFragmentPrefix = "#gugis-view=";
export const cameraBookmarkLimit = 512;
const revisionPattern = /^[a-f0-9]{64}$/;
const decimalPattern = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;
const invalid = (): CameraBookmarkResult => ({ kind: "invalid", message: "视角链接无效或不属于当前城市，未应用相机位置。" });
const angle = (value: number) => ((value % 360) + 360) % 360;

/** Reject out-of-range values instead of silently moving the requested camera. */
export function validateCameraPose(value: unknown): CameraPose | null {
  if (!Array.isArray(value) || value.length !== 6 || !value.every(v => typeof v === "number" && Number.isFinite(v))) return null;
  const [lon, lat, height, heading, pitch, roll] = value;
  if (Math.abs(lon) > 180 || Math.abs(lat) > 85 || height < 2 || height > 100000 ||
      Math.abs(heading) > 360 || Math.abs(pitch) > 90 || Math.abs(roll) > 360) return null;
  return [lon, lat, height, angle(heading), pitch, angle(roll)];
}
export function ownsCameraFragment(hash: string): boolean {
  return hash.startsWith("#gugis-view");
}
export function stripCameraFragment(href: string): string {
  const url = new URL(href);
  if (ownsCameraFragment(url.hash)) url.hash = "";
  return url.href;
}
export function decodeCameraBookmark(hash: string): CameraBookmarkResult {
  if (!ownsCameraFragment(hash)) return { kind: "none" };
  if (!hash.startsWith(cameraFragmentPrefix) || hash.length > cameraBookmarkLimit) return invalid();
  // Canonical plain fields forbid percent tricks, unknown/duplicate fields and
  // decoder ambiguities. Every numeric token is a bounded, finite decimal.
  const match = /^#gugis-view=1&city=([a-z]+)&revision=([a-f0-9]{64})&pose=([^&]+)$/.exec(hash);
  if (!match || !knownCities.includes(match[1] as CityId)) return invalid();
  const tokens = match[3].split(",");
  if (tokens.length !== 6 || tokens.some(token => token.length > 24 || !decimalPattern.test(token))) return invalid();
  const pose = validateCameraPose(tokens.map(Number));
  return pose ? { kind: "valid", bookmark: { city: match[1] as CityId, revision: match[2], pose } } : invalid();
}
export function encodeCameraBookmark(bookmark: CameraBookmark): string {
  const pose = validateCameraPose(bookmark.pose);
  if (!knownCities.includes(bookmark.city) || !revisionPattern.test(bookmark.revision) || !pose) throw new Error("无法生成有效的视角链接");
  // Fixed decimal output prevents exponent notation; rounding only affects link
  // precision, never validation of the input's allowed range.
  const numbers = pose.map((value, i) => {
    const rounded = Number(value.toFixed(i === 2 ? 3 : 7));
    const normalized = i === 3 || i === 5 ? angle(rounded) : rounded;
    return normalized.toFixed(i === 2 ? 3 : 7).replace(/\.?0+$/, "") || "0";
  });
  const hash = `${cameraFragmentPrefix}1&city=${bookmark.city}&revision=${bookmark.revision}&pose=${numbers.join(",")}`;
  if (decodeCameraBookmark(hash).kind !== "valid") throw new Error("无法生成有效的视角链接");
  return hash;
}
/** Check the explicit URL city too: legacy workspace fallbacks cannot authorize a bookmark. */
export function cameraBookmarkForLocation(href: string, city: CityId, tiles: boolean): CameraBookmarkResult {
  const url = new URL(href), result = decodeCameraBookmark(url.hash);
  if (result.kind === "none") return result;
  if (!tiles || url.searchParams.getAll("city").length !== 1 || url.searchParams.get("city") !== city ||
      url.searchParams.getAll("view_mode").length !== 1 || url.searchParams.get("view_mode") !== "tiles" ||
      (result.kind === "valid" && result.bookmark.city !== city)) return invalid();
  return result;
}
/** Start from origin/path only. The current page is the sole destination authority. */
export function cameraBookmarkUrl(href: string, bookmark: CameraBookmark): string {
  const current = new URL(href);
  if (!["http:", "https:"].includes(current.protocol) || current.username || current.password) throw new Error("当前地址无法安全生成视角链接");
  const url = new URL(current.pathname, current.origin);
  // A path beginning with // must not turn into an unrelated authority.
  if (url.origin !== current.origin) throw new Error("当前地址无法安全生成视角链接");
  const selected = [...new Set((current.searchParams.get("cities") ?? "").split(","))]
    .filter((id): id is CityId => knownCities.includes(id as CityId));
  if (!selected.includes(bookmark.city)) selected.push(bookmark.city);
  url.searchParams.set("city", bookmark.city);
  url.searchParams.set("cities", selected.join(","));
  url.searchParams.set("view_mode", "tiles");
  url.hash = encodeCameraBookmark(bookmark);
  if (url.href.length > cameraBookmarkLimit) throw new Error("当前地址过长，无法生成视角链接");
  return url.href;
}
