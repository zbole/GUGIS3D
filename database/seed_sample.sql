INSERT INTO gugis_layers(layer_id, name, visible, opacity, placeholder) VALUES
  ('buildings', 'Buildings', TRUE, 0.95, FALSE),
  ('roads', 'Roads', TRUE, 0.75, FALSE),
  ('parks', 'Green Areas', TRUE, 0.8, FALSE),
  ('templates', 'Template Objects', TRUE, 1.0, FALSE),
  ('terrain', 'Terrain', TRUE, 0.65, TRUE),
  ('ai_results', 'AI Results', TRUE, 1.0, TRUE)
ON CONFLICT (layer_id) DO NOTHING;

INSERT INTO gugis_objects(
  object_id,
  layer_id,
  name,
  shape_type,
  structure_type,
  main_type,
  sub_type,
  coordinate_mode,
  base_point,
  pose,
  hybrid_box,
  geometry_payload,
  attributes,
  visible,
  opacity
) VALUES
(
  'bldg_seed_001',
  'buildings',
  'Seed Building',
  40000,
  'FunctionStructure',
  41000,
  41100,
  'global',
  ST_SetSRID(ST_MakePoint(-2.5879, 51.4545, 0), 4326),
  '{"strike": 0, "dip": 0, "roll": 0}',
  '{"center": [-2.5879, 51.4545, 12], "radius_xyz": [10, 8, 12], "radius_2d": 12.8, "radius_3d": 17.5}',
  '{"function_type": "extruded_box", "size_m": [20, 16, 24]}',
  '{"height_m": 24, "floors": 6, "usage": "seed"}',
  TRUE,
  0.95
)
ON CONFLICT (object_id) DO NOTHING;
