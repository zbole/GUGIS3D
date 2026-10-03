import type { Placement } from "./cityModel";
import type { RenderAsset, RenderManifest, RenderTile } from "./renderTileClient";

export const LOADED_BUILDINGS_PAGE_SIZE = 25;

export interface LoadedBuilding {
  placement: Placement;
  quality: RenderAsset["quality"];
  kind: RenderAsset["kind"];
  primitiveCount: number;
  tileIds: string[];
}

/** Inspect only resident, verified tiles. Cached/evicted and other sessions are excluded. */
export function loadedBuildings(manifest: RenderManifest, tiles: readonly RenderTile[]): LoadedBuilding[] {
  const buildings = new Map<string, LoadedBuilding>();
  for (const tile of tiles) {
    if (tile.city_id !== manifest.city_id || tile.revision !== manifest.revision) continue;
    for (const placement of tile.instances) {
      const existing = buildings.get(placement.id);
      if (existing) {
        if (!existing.tileIds.includes(tile.tile_id)) existing.tileIds.push(tile.tile_id);
        continue;
      }
      const asset = Object.prototype.hasOwnProperty.call(tile.assets, placement.asset) ? tile.assets[placement.asset] : undefined;
      if (!asset) continue;
      buildings.set(placement.id, { placement, quality: asset.quality, kind: asset.kind,
        primitiveCount: asset.primitives.length, tileIds: [tile.tile_id] });
    }
  }
  return [...buildings.values()].sort((a, b) => a.placement.name.localeCompare(b.placement.name) || a.placement.id.localeCompare(b.placement.id));
}

/** Literal, case-insensitive name/ID matching; never triggers a wider lookup. */
export function loadedBuildingPage(buildings: readonly LoadedBuilding[], query: string, requestedPage: number) {
  const term = query.trim().toLowerCase();
  const matches = term ? buildings.filter(({ placement }) =>
    placement.name.toLowerCase().includes(term) || placement.id.toLowerCase().includes(term)) : buildings;
  const pages = Math.max(1, Math.ceil(matches.length / LOADED_BUILDINGS_PAGE_SIZE));
  const page = Number.isFinite(requestedPage) ? Math.max(0, Math.min(pages - 1, Math.floor(requestedPage))) : 0;
  const start = page * LOADED_BUILDINGS_PAGE_SIZE;
  return { items: matches.slice(start, start + LOADED_BUILDINGS_PAGE_SIZE), matched: matches.length,
    loaded: buildings.length, page, pages, first: matches.length ? start + 1 : 0,
    last: Math.min(start + LOADED_BUILDINGS_PAGE_SIZE, matches.length) };
}
