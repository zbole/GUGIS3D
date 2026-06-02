# API

Base URL: `http://localhost:8000`

## `GET /health`

Returns service status.

## `GET /layers`

Returns layer metadata.

## `GET /objects`

Returns all objects. Optional query parameter:

- `layer_id`: filter by layer.

## `GET /objects/{object_id}`

Returns one object or `404`.

## `POST /objects/query`

Request body:

```json
{
  "layer_id": "buildings",
  "structure_type": "FunctionStructure",
  "text": "office",
  "attributes": {"usage": "office"}
}
```

Returns matching GUGIS objects.

## `POST /analysis/hybrid-box-query`

Request body:

```json
{
  "center": [-2.5879, 51.4545, 0],
  "radius_2d": 80,
  "radius_3d": 120,
  "layer_id": "buildings"
}
```

Returns objects whose HybridBox intersects the query ball.

## `POST /analysis/measure-distance`

Request body:

```json
{
  "start": [-2.588, 51.454, 0],
  "end": [-2.587, 51.455, 20]
}
```

Returns 2D and 3D distances in meters.

## `POST /export/gugis-json`

Returns a complete GUGIS JSON collection.
