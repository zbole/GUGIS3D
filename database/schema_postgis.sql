CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE IF NOT EXISTS gugis_layers (
  layer_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  visible BOOLEAN NOT NULL DEFAULT TRUE,
  opacity DOUBLE PRECISION NOT NULL DEFAULT 1.0,
  placeholder BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS gugis_objects (
  object_id TEXT PRIMARY KEY,
  layer_id TEXT NOT NULL REFERENCES gugis_layers(layer_id),
  name TEXT NOT NULL,
  shape_type INTEGER NOT NULL,
  structure_type TEXT NOT NULL,
  main_type INTEGER NOT NULL,
  sub_type INTEGER NOT NULL,
  coordinate_mode TEXT NOT NULL CHECK (coordinate_mode IN ('global', 'local')),
  base_point geometry(PointZ, 4326) NOT NULL,
  pose JSONB NOT NULL DEFAULT '{"strike": 0, "dip": 0, "roll": 0}',
  hybrid_box JSONB NOT NULL,
  geometry_payload JSONB NOT NULL,
  attributes JSONB NOT NULL DEFAULT '{}',
  visible BOOLEAN NOT NULL DEFAULT TRUE,
  opacity DOUBLE PRECISION NOT NULL DEFAULT 1.0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS gugis_objects_layer_idx ON gugis_objects(layer_id);
CREATE INDEX IF NOT EXISTS gugis_objects_shape_idx ON gugis_objects(shape_type);
CREATE INDEX IF NOT EXISTS gugis_objects_structure_idx ON gugis_objects(structure_type);
CREATE INDEX IF NOT EXISTS gugis_objects_base_point_gix ON gugis_objects USING GIST(base_point);
CREATE INDEX IF NOT EXISTS gugis_objects_attributes_gin ON gugis_objects USING GIN(attributes);
CREATE INDEX IF NOT EXISTS gugis_objects_hybrid_box_gin ON gugis_objects USING GIN(hybrid_box);

CREATE OR REPLACE FUNCTION update_gugis_objects_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_gugis_objects_updated_at ON gugis_objects;
CREATE TRIGGER trg_gugis_objects_updated_at
BEFORE UPDATE ON gugis_objects
FOR EACH ROW EXECUTE FUNCTION update_gugis_objects_updated_at();
