import type { GugisObject } from "../types/gugis";

export function passesSimpleClip(obj: GugisObject, enabled: boolean, clipLongitude: number): boolean {
  if (!enabled) return true;
  return obj.hybrid_box.center[0] <= clipLongitude;
}
