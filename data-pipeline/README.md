# Data Pipeline

This folder contains lightweight scripts for creating or adapting open city data into the internal GUGIS JSON format used by the MVP.

Current scripts:

- `generate_sample_city.py`: deterministic synthetic Bristol-like sample data.
- `osm_to_gugis.py`: placeholder converter interface for OSM-derived footprints and roads.
- `overture_to_gugis.py`: placeholder converter interface for Overture Maps buildings and transportation data.

The MVP loads `backend/data/sample_gugis_objects.json` by default.
