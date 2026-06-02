import type { Entity } from "cesium";

export function objectIdFromPickedEntity(entity: Entity | undefined): string | null {
  if (!entity) return null;
  const objectIdProperty = (entity.properties as unknown as { objectId?: { getValue: () => unknown } } | undefined)?.objectId;
  const propertyId = objectIdProperty?.getValue();
  if (typeof propertyId === "string") return propertyId;
  return null;
}
