import type { BuildingDocument, Parameters } from "./model";
import type { CityDocument } from "./cityModel";
import type { Terrain } from "./environment";
import { fetchApiJson } from "./apiResponse";
import {
  encodeCity,
  decodeCity,
  type CityArchive,
  type StorageStatistics,
} from "./cityArchive";
const base = (import.meta.env.VITE_API_BASE_URL ?? "/api").replace(/\/$/, "");
async function request<T>(prefix: string, path: string, body?: unknown): Promise<T> {
  return fetchApiJson<T>(`${base}${prefix}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(120000),
  }, { writes: body !== undefined && ["/current", "/draft", "/draft/commit", "/draft/discard"].includes(path),
    conflictMessage: "另一窗口已修改项目，请先重新载入。当前草稿仍保留，未覆盖已保存的数据。" });
}

export interface CityReceipt {
    revision: string;
    bytes: number;
    directory: string;
    filename: string;
    storage: StorageStatistics;
}
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
export interface CityVersion {
  revision: string;
  modified_at: string;
  bytes: number;
  current: boolean;
}
/** Immutable API binding: delayed requests can never target a newly selected city. */
export function createCityApi(cityId?: string) {
  if (cityId && !/^[a-z][a-z0-9-]*$/.test(cityId)) throw new Error("城市标识无效");
  const prefix = cityId ? `/cities/${encodeURIComponent(cityId)}/city` : "/city";
  const cityRequest = <T>(path: string, body?: unknown) => request<T>(prefix, path, body);
const loadCity = async () => {
  const result = await cityRequest<{
    revision: string;
    document: CityArchive | CityDocument;
    storage: StorageStatistics;
  }>("/current");
  return { ...result, document: decodeCity(result.document) };
};

const persistCity = (city: CityDocument, revision: string) =>
  cityRequest<CityReceipt>("/current", { base_revision: revision, document: encodeCity(city) });
const commitDraft = (revision: string) =>
  cityRequest<CityReceipt>("/draft/commit", { revision });
const validateCity = async (city: unknown) => {
  const result = await cityRequest<{
    document: CityArchive | CityDocument;
    storage: StorageStatistics;
  }>("/validate", city);
  return { ...result, document: decodeCity(result.document) };
};
const cityExportUrl = `${base}${prefix}/export`;
const generateBlock = (
  count: number,
  longitude: number,
  latitude: number,
) =>
  cityRequest<Pick<CityDocument, "assets" | "instances">>("/block", {
    count,
    longitude,
    latitude,
  });


const loadDraft = async () => {
  const r = await cityRequest<{
    draft: (Omit<CityDraft, "document"> & { document: CityArchive }) | null;
  }>("/draft");
  return r.draft
    ? { ...r.draft, document: decodeCity(r.draft.document) }
    : null;
};
const persistDraft = (
  document: CityDocument,
  base_revision: string,
  base_draft_revision: string | null,
  label: string,
  editor?: DraftEditor,
) =>
  cityRequest<{ revision: string }>("/draft", {
    document: encodeCity(document),
    base_revision,
    base_draft_revision,
    label,
    editor,
  });
const discardDraft = (revision: string) =>
  cityRequest("/draft/discard", { revision });

const listVersions = (offset = 0) =>
  cityRequest<{ versions: CityVersion[]; has_more: boolean }>(
    `/versions?offset=${offset}`,
  );
const loadVersion = async (id: string) => {
  const r = await cityRequest<{ document: CityArchive }>(`/versions/${id}`);
  return decodeCity(r.document);
};

const importGeoJSON = (value: unknown) =>
  cityRequest<{ documents: BuildingDocument[] }>("/geojson", value);
const refineBuilding = (document: BuildingDocument) =>
  cityRequest<{ document: BuildingDocument }>("/refine", document);
const demoTerrain = () => cityRequest<{ terrain: Terrain }>("/terrain/demo");
const upgradeLegacyTerrain = (terrain: Terrain) =>
  cityRequest<{ terrain: Terrain }>("/terrain/upgrade", terrain);
const terrainMultipatchUrl = `${base}${prefix}/terrain/benchmark.zip`;
async function importTerrain(
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
  return fetchApiJson<{ terrain: Terrain }>(`${base}${prefix}/terrain/import?${query}`, {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream" },
    body: file,
    signal: AbortSignal.timeout(120000),
  });
}

  return { loadCity, persistCity, commitDraft, validateCity, cityExportUrl, generateBlock, loadDraft, persistDraft, discardDraft, listVersions, loadVersion, importGeoJSON, refineBuilding, demoTerrain, upgradeLegacyTerrain, terrainMultipatchUrl, importTerrain };
}

export type CityApi = ReturnType<typeof createCityApi>;
const legacyCityApi = createCityApi();
export const { loadCity, persistCity, commitDraft, validateCity, cityExportUrl, generateBlock, loadDraft, persistDraft, discardDraft, listVersions, loadVersion, importGeoJSON, refineBuilding, demoTerrain, upgradeLegacyTerrain, terrainMultipatchUrl, importTerrain } = legacyCityApi;
