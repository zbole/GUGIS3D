import type { BuildingDocument, Parameters } from "./model";
import type { CityDocument } from "./cityModel";
import type { Terrain } from "./environment";
import {
  encodeCity,
  decodeCity,
  type CityArchive,
  type StorageStatistics,
} from "./cityArchive";
const base = (import.meta.env.VITE_API_BASE_URL ?? "/api").replace(/\/$/, "");
async function request<T>(path: string, body?: unknown): Promise<T> {
  const r = await fetch(`${base}/city${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(120000),
  });
  if (!r.ok) {
    const p = await r.json().catch(() => ({ detail: r.statusText }));
    throw new Error(
      r.status === 409
        ? "另一窗口已修改项目，请先重新载入。当前草稿仍保留，未覆盖已保存的数据。"
        : `${r.status}：${
            typeof p.detail === "string"
              ? p.detail
              : Array.isArray(p.detail)
                ? "文件校验未通过。" +
                  p.detail
                    .slice(0, 3)
                    .map(
                      (e: { loc: string[]; msg: string }) =>
                        `${e.loc.join(".")}：${e.msg === "Field required" ? "缺少必需字段" : e.msg}`,
                    )
                    .join("；")
                : "文件或参数无效"
          }`,
    );
  }
  return r.json();
}
export const loadCity = async () => {
  const result = await request<{
    revision: string;
    document: CityArchive | CityDocument;
    storage: StorageStatistics;
  }>("/current");
  return { ...result, document: decodeCity(result.document) };
};
export interface CityReceipt {
    revision: string;
    bytes: number;
    directory: string;
    filename: string;
    storage: StorageStatistics;
}
export const persistCity = (city: CityDocument, revision: string) =>
  request<CityReceipt>("/current", { base_revision: revision, document: encodeCity(city) });
export const commitDraft = (revision: string) =>
  request<CityReceipt>("/draft/commit", { revision });
export const validateCity = async (city: unknown) => {
  const result = await request<{
    document: CityArchive | CityDocument;
    storage: StorageStatistics;
  }>("/validate", city);
  return { ...result, document: decodeCity(result.document) };
};
export const cityExportUrl = `${base}/city/export`;
export const generateBlock = (
  count: number,
  longitude: number,
  latitude: number,
) =>
  request<Pick<CityDocument, "assets" | "instances">>("/block", {
    count,
    longitude,
    latitude,
  });
export interface DraftEditor {
  mode: "add" | "update";
  parameters: Parameters;
  instance_id: string;
}
export interface CityDraft {
  revision: string;
  base_revision: string;
  label: string;
  document: CityDocument;
  editor?: DraftEditor | null;
}
export const loadDraft = async () => {
  const r = await request<{
    draft: (Omit<CityDraft, "document"> & { document: CityArchive }) | null;
  }>("/draft");
  return r.draft
    ? { ...r.draft, document: decodeCity(r.draft.document) }
    : null;
};
export const persistDraft = (
  document: CityDocument,
  base_revision: string,
  base_draft_revision: string | null,
  label: string,
  editor?: DraftEditor,
) =>
  request<{ revision: string }>("/draft", {
    document: encodeCity(document),
    base_revision,
    base_draft_revision,
    label,
    editor,
  });
export const discardDraft = (revision: string) =>
  request("/draft/discard", { revision });
export interface CityVersion {
  revision: string;
  modified_at: string;
  bytes: number;
  current: boolean;
}
export const listVersions = (offset = 0) =>
  request<{ versions: CityVersion[]; has_more: boolean }>(
    `/versions?offset=${offset}`,
  );
export const loadVersion = async (id: string) => {
  const r = await request<{ document: CityArchive }>(`/versions/${id}`);
  return decodeCity(r.document);
};

export const importGeoJSON = (value: unknown) =>
  request<{ documents: BuildingDocument[] }>("/geojson", value);
export const refineBuilding = (document: BuildingDocument) =>
  request<{ document: BuildingDocument }>("/refine", document);
export const demoTerrain = () => request<{ terrain: Terrain }>("/terrain/demo");
export const upgradeLegacyTerrain = (terrain: Terrain) =>
  request<{ terrain: Terrain }>("/terrain/upgrade", terrain);
export const terrainMultipatchUrl = `${base}/city/terrain/benchmark.zip`;
export async function importTerrain(
  file: File,
  source_crs: string,
  datum: string,
  stride: number,
) {
  const query = new URLSearchParams({
    filename: file.name,
    source_crs,
    datum,
    stride: String(stride),
  });
  const r = await fetch(`${base}/city/terrain/import?${query}`, {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream" },
    body: file,
    signal: AbortSignal.timeout(120000),
  });
  const result = await r.json();
  if (!r.ok)
    throw new Error(
      typeof result.detail === "string"
        ? result.detail
        : JSON.stringify(result.detail),
    );
  return result as { terrain: Terrain };
}
