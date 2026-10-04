import type { BuildingDocument, Parameters } from "./model";
import { fetchApiJson } from "./apiResponse";
const base = (import.meta.env.VITE_API_BASE_URL ?? "/api").replace(/\/$/, "");
async function request<T>(path: string, body?: unknown): Promise<T> {
  return fetchApiJson<T>(`${base}/studio${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
  }, { writes: path === "/save" });
}
export const loadExample = () => request<BuildingDocument>("/example");
export const generateBuilding = (params: Parameters) =>
  request<BuildingDocument>("/generate", params);
export const validateDocument = (document: unknown) =>
  request<{ document: BuildingDocument }>("/validate", document);
export const saveDocument = (document: BuildingDocument) =>
  request<{
    id: string;
    filename: string;
    directory: string;
    bytes: number;
    download_path: string;
  }>("/save", document);
export const downloadUrl = (path: string) => `${base}${path}`;
