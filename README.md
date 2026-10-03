# GUGIS3D 本地城市工作台

2026-10-03：合并 DOT 八轮更新，修复空简模建筑显示与剖面漏选，完善历史记录、分析重试、对比快照校对和文件保存保护；已完成 Windows 测试及本地浏览器交互验收。[简要更新说明](docs/updates_2026-10-03.md)

可持续编辑的布里斯托城市项目：内置 615 栋建筑实例，包含 600 个真实 OSM 轮廓、3 处地标参考模型和 12 栋英式住宅设计示范。建筑生成、更新、复制与导入先进入独立草稿，确认后才保存到正式城市；支持历史版本预览恢复。原城市场景页面已移除。

新增函数表达与参数说明、四种英式设计建筑以及 12/24/48 栋街区扩建草稿。已有项目的楼栋数量以页面正式城市统计为准。[函数、草稿与恢复说明](docs/drafts_functions.md)

2026-09-15：完善草稿提交与刷新恢复，优化地形查询和显示缓存，增加场景放大，修复长侧栏滚动；已完成隔离项目的浏览器交互验收。[全局优化与验收记录](docs/global_optimization_2026-09-15.md)

600 栋轮廓现已全部细化为可编辑的墙、门窗、楼板、屋顶及室内交通/分区构件。10 类构件分别配色，颜色与完整语义结构写入城市文件。街区远景使用简模，选中建筑和楼栋详查显示完整结构。立面与内部布局为规则推演，明确保留来源和精度说明。

Windows 本地运行：双击 `start-local.cmd`。新电脑安装 Python 3.13、Node.js 22+ 后运行 `start-local.ps1 -Setup`。页面：http://127.0.0.1:5173/ 。

GitHub 公开版包含源码、起始街区种子、测试和已保存的对比报告。`.local` 下的本机城市、独立草稿、历史版本、实验 ZIP 和运行日志不进入仓库；新克隆会从 615 栋起始种子建立自己的项目。对比页先展示已保存快照，不能将其当作新电脑当前项目的实测结果。要生成可下载的同源实验包，先在“地形 / 地物”生成演示地形或导入 DTM，并明确保存到正式项目，再运行下方重新测量命令。演示地形始终标记为非实测。

对比展示页：http://127.0.0.1:5173/compare 。页面逐项对照 ArcGIS Scene Viewer / CityEngine 的官方功能，并展示当前布里斯托项目的实测数据；内存百分比只对照本项目展开后的独立点线表示，绝非 ArcGIS 跑分。页面会向本地 API 校对城市修订号，项目变更后提示结果已过期。重新测量当前项目并刷新展示数据，在仓库根目录运行：

```powershell
node frontend/scripts/city-memory.mjs --input .local/city/current.gugis.json --output shared/current-city-memory-benchmark.json --runs 3
.\.venv\Scripts\python.exe data-pipeline/benchmark_terrain.py
.\.venv\Scripts\python.exe data-pipeline/benchmark_terrain_suite.py
node frontend/scripts/generate-compare-evidence.mjs
```

- [城市使用、数据格式、来源及局限](docs/city_format.md)
- [本地环境与启动](docs/local_setup_zh.md)
- [单栋实体格式](docs/studio_format.md)
- [City 1.1 全城共享几何与无损存储优化](docs/city_shared_geometry.md)
- [城市数据内存对比与复现方法](docs/city_memory.md)
- [City 1.2 函数地物、面带地形、DEM 导入与查询](docs/environment_format.md)

顶部“地形 / 地物”提供球体与柱体路灯、拱门、弧形阳台、圆形广场，以及直纹面带 / 三角带地形。旧三角扇档案仍可读取，并可按原三角面转换为多条三角带。支持 GeoTIFF、ASCII Grid DTM 导入，原生函数与面带拓扑随城市文件持久保存；随附的演示地形明确标为非实测。已有城市文件需导入以恢复本机新增对象；源码内起始种子仍为原有 615 栋。

地形工作区可下载 ArcGIS Pro 可读取的 MultiPatch Shapefile 对照数据；[对标方法和复现步骤](docs/terrain_arcgis_benchmark.md)说明同源控制网、离散误差与文件体积的计算口径。该对照不包含 ArcGIS Pro 的软件性能跑分。

所有已应用修改保存到 `.local/city/current.gugis.json`，版本快照位于 `.local/city/versions`。数据文件保留模型定义、建筑实例、地理位置、语义关系、道路和来源信息，运行时不依赖在线地图或账号。

当前格式是本项目的 GUGIS JSON 扩展，尚无原 C++ 二进制规范，不能声称与旧 `.gugis/.index` 文件兼容。地标为形态参考，轮廓高度多数推算，并非精确测绘城市。

以下为原仓库的历史架构参考，不代表当前页面功能；旧接口暂保留兼容。

---

# gugis-webgis

A web-based 3D GIS MVP for testing a GUGIS-style object model.

The project uses **React + TypeScript + CesiumJS** for the interactive 3D frontend and **FastAPI** for the backend API. The current version uses synthetic Bristol-area sample objects and JSON fallback data, with PostGIS schema files prepared for later database deployment.

## Current Features

* Interactive CesiumJS 3D viewer.
* Synthetic Bristol-area 3D objects.
* GUGIS-compatible object schema:

  * `FunctionStructure`
  * `TemplateStructure`
  * `DiscreteStructure`
  * `HybridBox`
  * object attributes, pose, visibility, and opacity.
* Layer management.
* Layer groups for Base, 3D Objects, Analysis, and AI Placeholder.
* Object picking, clear selection, and stronger selected-object highlighting.
* Property panel and searchable/filterable attribute table.
* Reset to Bristol and fly-to-object tools.
* Distance and height measurement.
* Camera longitude, latitude, and height in the status bar.
* Visibility and transparency controls.
* Clean clipping/slicing placeholder for future 3D Tiles / mesh objects.
* FastAPI endpoints for:

  * health check
  * layers
  * objects
  * object query
  * HybridBox query
  * distance measurement
  * GUGIS JSON export.
* PostGIS schema and seed SQL for future deployment.

## Project Layout

```text
gugis-webgis/
├── frontend/       # React + TypeScript + Vite + CesiumJS
├── backend/        # FastAPI backend
├── database/       # PostGIS schema and sample seed SQL
├── data-pipeline/  # sample data and converter scripts
├── docs/           # architecture, API, object model, roadmap
└── README.md
```

## Quick Start

Run the backend and frontend in two separate terminals.

### Backend

Use the `webgis-backend` conda environment.

```bash
cd ~/gugis-webgis/backend
conda activate webgis-backend
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

Check the backend:

```bash
curl http://localhost:8000/health
```

Expected result:

```json
{"status":"ok","service":"gugis-webgis"}
```

API docs:

```text
http://localhost:8000/docs
```

### Frontend

Use the `webgis-node` conda environment.

```bash
cd ~/gugis-webgis/frontend
conda activate webgis-node
npm run dev -- --host 0.0.0.0
```

Open:

```text
http://localhost:5173/
```

The frontend reads the backend URL from:

```text
VITE_API_BASE_URL=http://localhost:8000
```

See `frontend/.env.example`.

On a remote server, use VS Code Port Forwarding for:

```text
5173 -> frontend
8000 -> backend
```

Then open the forwarded local address:

```text
http://localhost:5173/
```

## Build Check

Run this after frontend changes:

```bash
cd ~/gugis-webgis/frontend
conda activate webgis-node
npm run build
```

## Backend vs Frontend

The frontend is the actual WebGIS page.

```text
Frontend: http://localhost:5173
Backend API: http://localhost:8000
Backend docs: http://localhost:8000/docs
```

The backend is required when using API-based object loading, object query, export, and future PostGIS functions.

## GUGIS Object Model

Each object is represented as a GIS entity rather than only a rendered mesh.

Main fields include:

* `object_id`
* `layer_id`
* `shape_type`
* `structure_type`
* `main_type`
* `sub_type`
* `coordinate_mode`
* `base_point`
* `pose`
* `hybrid_box`
* `geometry`
* `attributes`
* `visible`
* `opacity`

Supported structure types in the MVP:

```text
FunctionStructure
TemplateStructure
DiscreteStructure
CompositeStructure
BooleanStructure
```

See:

```text
docs/gugis_object_model.md
```

## Development Roadmap

### V0.1 Current MVP

* Synthetic Bristol sample city.
* CesiumJS interactive viewer.
* FastAPI JSON backend.
* Basic ArcGIS-like interaction tools.
* GUGIS-style object schema.

### V0.2 Frontend Validation

* Fix UI/runtime bugs.
* Improve object picking.
* Improve measurement tools.
* Improve clipping/slicing.

### V0.3 Real Data Import

* Import Bristol OSM / Overture buildings.
* Convert footprints and attributes into GUGIS JSON.
* Generate LoD1 building objects.

### V0.4 Stronger GUGIS Adapter

* Better separation of:

  * FunctionStructure
  * TemplateStructure
  * DiscreteStructure
* Add stronger HybridBox query logic.
* Add object-level spatial filtering.

### V0.5 3D Tiles / glTF Export

* Export render cache.
* Support larger 3D scenes.
* Prepare for web-scale streaming.

### V0.6 AI Integration

* Add point cloud / remote sensing result layers.
* Connect building extraction or semantic segmentation outputs.
* Convert AI results into GUGIS objects.

## Notes

This project currently does **not** depend on 51Earth or any closed cloud-rendering platform.

The goal is to first build a minimal open-source 3D WebGIS prototype, then gradually extend it toward a full GUGIS-compatible data engine.
