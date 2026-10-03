import { chooseDetails, detailBudget, type DetailCandidate } from "./detailBudget";

/** Coarse geometry residency limits, not a whole-city/GPU frame-rate claim. */
export const renderBudget = { buildings: 800, components: 12000, batchBuildings: 128 };
export interface RenderCandidate {
  id: string;
  components: number;
  distance: number;
  visible: boolean;
}

/**
 * Retain nearest visible buildings, with 10% residency hysteresis. Selection is
 * pinned even outside the viewport. A selected fallback larger than the entire
 * component budget is the sole exception: truncation would falsify its geometry.
 */
export function chooseRenderBuildings(
  candidates: RenderCandidate[], resident: ReadonlySet<string>, selected: string | null,
  budget = renderBudget,
): Set<string> {
  const usable = candidates.filter(item => Number.isFinite(item.components) && item.components > 0);
  const pinned = selected ? usable.find(item => item.id === selected) : undefined;
  const ranked = usable.filter(item => item.id !== selected && item.visible &&
    Number.isFinite(item.distance) && item.distance >= 0)
    .sort((a, b) => a.distance * (resident.has(a.id) ? .9 : 1) -
      b.distance * (resident.has(b.id) ? .9 : 1) || a.id.localeCompare(b.id));
  const chosen = new Set<string>();
  let components = 0;
  if (pinned) { chosen.add(pinned.id); components = pinned.components; }
  for (const item of ranked) {
    if (chosen.size >= budget.buildings) break;
    if (components + item.components > budget.components) continue;
    chosen.add(item.id);
    components += item.components;
  }
  return chosen;
}

/** Selection gets first refusal, while fine geometry retains its hard limits. */
export function chooseRenderDetails(
  candidates: DetailCandidate[], resident: Set<string>, selected: string | null,
): Set<string> {
  const pinned = selected ? candidates.find(item => item.id === selected &&
    item.components > 0 && item.components <= detailBudget.components) : undefined;
  if (!pinned) return chooseDetails(candidates, resident);
  const eligible = candidates.filter(item => item.id !== selected);
  const automatic = chooseDetails(eligible, resident);
  const byId = new Map(eligible.map(item => [item.id, item]));
  const chosen = new Set([pinned.id]);
  let components = pinned.components;
  for (const id of automatic) {
    const count = byId.get(id)!.components;
    if (chosen.size >= detailBudget.buildings) break;
    if (components + count > detailBudget.components) continue;
    chosen.add(id);
    components += count;
  }
  return chosen;
}
