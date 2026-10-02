export interface DetailCandidate {
  id: string;
  pixels: number;
  components: number;
  visible: boolean;
}

// Keep GPU residency bounded even after a long tour of the entire city.
export const detailBudget = { buildings: 48, components: 16000 };

export function chooseDetails(candidates: DetailCandidate[], resident: Set<string>) {
  const ranked = candidates.filter(item => item.visible && Number.isFinite(item.pixels) &&
    item.pixels >= (resident.has(item.id) ? 30 : 42))
    .sort((a, b) => b.pixels * (resident.has(b.id) ? 1.15 : 1) -
      a.pixels * (resident.has(a.id) ? 1.15 : 1) || a.id.localeCompare(b.id));
  const chosen = new Set<string>();
  let components = 0;
  for (const item of ranked) {
    if (chosen.size >= detailBudget.buildings) break;
    if (components + item.components > detailBudget.components) continue;
    chosen.add(item.id);
    components += item.components;
  }
  return chosen;
}
