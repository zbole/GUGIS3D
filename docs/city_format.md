# GUGIS 城市项目 1.1 / 1.2

当前保存采用 **City 1.1 全城共享几何**，读取兼容 City 1.0。新增结构、精确参数化规则和指标口径见 [共享几何格式](city_shared_geometry.md)。城市与单栋 Studio 格式分别编号；单栋导出仍为自包含文件。

含函数地物或地形的项目写入 **City 1.2**，保留现有共享建筑库，并增加 environment。数学定义、DEM 处理及验证边界见 [城市环境扩展](environment_format.md)。不含环境的旧项目继续保存为 1.1。

城市是可持续修改的数据文件。前端查看完整项目；制作或导入的建筑会追加为实例，更新单栋不会替换邻楼。修改完成后通过后端写入 `.local/city/current.gugis.json`，刷新或重新启动可恢复。

本项目采用自定义 JSON 格式；不声称与尚未提供规范的原 C++ `.gugis` / `.index` 二进制格式兼容。轮廓细化模型使用 `gugis-studio` 1.2，读取兼容 Studio 1.0 / 1.1 文件；原有参数样式仍可使用 1.1。

## 文件结构（兼容 City 1.0）

```json
{
  "format": "gugis-city",
  "version": "1.0",
  "coordinate_system": "ENU_METERS_WGS84",
  "name": "布里斯托城市项目",
  "assets": {"model_a": "完整 BuildingDocument 对象（此处省略）"},
  "instances": [{"id":"building_a","asset":"model_a","name":"建筑 A",
    "longitude":-2.603,"latitude":51.454,"altitude":0,"heading":0}],
  "roads": [],
  "metadata": {}
}
```

以上是结构示意，`assets` 的值实际必须是完整对象，不能是字符串。完整约束见 `city.schema.json`。

`assets` 保留盒体、显式闭合三角面实体、模板引用及语义树。`instances` 引用资产，保存每栋的名称、WGS84 经纬度、基准高程和顺时针朝向。实例定位覆盖资产内的默认定位，局部 XYZ 按建筑东、北、天坐标转换；父节点只表达语义归属，不叠加变换。默认高程为 0，没有加载真实地形。

多个实例可引用同一资产。复制建筑复用资产；修改一个实例时创建其独立资产，再清理无引用资产，避免改动其他实例。模板在资产内部继续复用。示例中的 12 栋英式住宅只使用 2 个资产定义。

`roads` 保留 OSM 线坐标与名称，`width` 为显示用线宽（像素），不是测绘道路宽度；查看时裁去研究范围以外的长线路段。`metadata` 保留来源、精度、许可和范围说明。单栋内部 `room` 是空间、`dwelling` 才是演示住户，不把教堂或塔楼当作住宅。

## 保存与恢复

- 每次已应用的添加、更新、复制、删除、撤销、导入都会保存。尚未提交的表单草稿不属于城市文件。
- 后端校验后先保留新旧快照，再写临时文件、刷新到磁盘并原子替换当前文件。
- 快照位于 `.local/city/versions/{sha256}.gugis.json`，可用“导入城市 / 建筑”恢复。快照不会自动清理。
- 保存携带内容哈希版本。如果另一窗口已写入，返回 409，拒绝覆盖；当前草稿保留，重新载入后可再应用。
- 页面提供最近 10 次本次会话修改的撤销；刷新后仍可从版本文件恢复。
- 损坏当前文件会明确报错，不会静默恢复默认示例。
- “导出整个城市”导出已保存的完整项目，不受隐藏、透明度、楼层抬升或列表筛选影响。
- 导出只返回已校验的正式文件字节，不创建或改写历史；下载响应的 `X-GUGIS-City-Revision` 是这些字节的 SHA-256。网页发起导出后仍应确认浏览器下载完成。
- 保存前会核对已有的新旧历史快照。若内容与文件名修订号对应的数据不一致，拒绝覆盖正式城市并保留草稿及损坏原文件；可以先导出有效的正式项目备份，再检查历史文件。程序不会静默修复或删除损坏版本。

当前使用单个本地 Uvicorn 进程；进程内锁不提供多进程 / 多服务器协作保证。城市上限为 128 MiB、3,000 个资产、5,000 个建筑实例、200,000 个实例化语义节点；这是输入限制，不是海量城市的流畅度承诺。城市总览采用 Cesium 批量几何，详查保留构件点选和楼层关系。后端按内容哈希缓存已校验快照，并直接返回编码后的 JSON，避免大型对象被通用编码器重复遍历。磁盘内容改变后仍须重新校验。

## 持续增加实地数据

“导入城市 / 建筑”可识别：

1. 城市 `.gugis.json`：校验并恢复整个项目，旧版本自动归档。
2. 单栋 Studio `.gugis.json`：追加到当前城市。
3. WGS84 GeoJSON `FeatureCollection`：每个 `Polygon` 生成一个 LoD1 轮廓实体并追加。`properties.name` 指定名称，`properties.height` 指定 1–150 米高度；缺少高度时明确记录为假设 9.6 米。允许凹多边形。每批最多 500 个要素，每个环清理后 3–120 个顶点；环必须闭合。内环、MultiPolygon 和其他坐标系需先处理；任一要素无效时整批拒绝，避免悄悄漏导。

导入轮廓清理重复/冗余顶点后必须是简单多边形：不接受自相交、非相邻接触、重叠或回折的边。每个坐标须是有限数值，经度在 ±180° 内、纬度在本工作台支持的 ±85° 内。畸形要素、geometry、properties 或坐标数组统一拒绝整批；`properties: null` 可按未提供属性处理。拒绝导入不修改正式城市、草稿或历史。

GeoJSON 几何转换与响应 JSON 编码使用既有后台线程池，避免转换期间独占 API 事件循环。解析后的数据、整批拒绝语义与显式保存流程不变。线程池容量和 Python GIL 仍限制并发计算，这不是更高吞吐或任意规模导入的承诺。

选择待细化轮廓，点击“补全精细结构”可沿原轮廓补齐构件，先预览草稿再确认保存。细化后仍可改名、移动、旋转；选择另一建筑类型会在确认后替换整栋几何。也可通过 GUGIS 实体文件持续补充测量结果。任意复杂体仍受盒体 / 闭合三角网及语义格式约束，尚无直接 IFC、glTF、BIM 或测绘点云转换器。

## 轮廓细化与分类颜色

起始街区的 600 栋 OSM 建筑均已从单体量变为 `urban` 构件模型。保留原始轮廓、建筑锚点和檐口高度，按用途标签或明确的默认规则推演开间与层数；窗洞砌体、门、玻璃、窗框、层间檐口、楼板、楼梯井、内隔墙、分区通行门与屋顶分别保存。狭小附属建筑不强行设置无法容纳的楼梯。大型立面会适当放宽开间间距，以约束完整几何规模。

凹形轮廓的楼板按多边形裁切，二层及以上为楼梯井留洞。室内走廊与横向分隔沿轮廓分段，避免跨越凹口；分区作为 `room` 节点保留，并明确标注为推演。四边凸形住宅可用双坡屋顶，复杂轮廓采用平顶与女儿墙。这不是街景/测绘/BIM 驱动的现状复原，屋顶与内部布局仍需实测资料进一步校正。

`shared/component-colors.json` 是前后端共用的 10 类构件色表。模板颜色写入文件；旧模板若跨类别共享，重新配色时先拆分引用，避免一种类别影响另一种。界面图例、图层色块及对象属性展示相同颜色，选择高亮只作轻微提亮。颜色表达构件类型，不表示真实石材、砖、玻璃等材质。

1.2 模型可带 `overview` 简模（使用建筑局部绝对坐标的独立闭合实体）。街区远景显示简模，选中建筑显示完整构件；楼栋详查始终读取完整 `nodes`。简模不是语义节点，不能替代完整数据，也不影响导出。地标和设计住宅继续显示完整模型。

## 起始数据及真实性

保留的 OSM 查询覆盖 Brandon Hill、Park Street、College Green 周边，选取距核心中心最近的 600 个可转换闭合 way 建筑轮廓，以及 544 个道路 way 记录。不是布里斯托全市模型，未获取 multipolygon 关系。高度读取 `height`，其次按 `building:levels × 3.2 m` 推算，缺失则假设三层。各对象保存高度依据。数据时间保留在文件 metadata 中。

Wills Memorial Building、Cabot Tower、Bristol Cathedral 的定位参考保留的 OSM 轮廓，外形按公开资料制作，包括塔楼、八角构件、尖拱窗、侧廊、扶壁和屋顶。尺寸、内部空间和分段均为建模假设；没有声称测绘精度。12 栋乔治式 / 维多利亚式街屋是单独标注的设计示范，不代表对应位置真实现状。

参考来源：

- [OpenStreetMap 数据及 ODbL 许可](https://www.openstreetmap.org/copyright)，原始响应保留于 `backend/data/bristol-osm.json`。本项目生成的城市数据库保留相应署名与许可。
- [Historic England：Wills Memorial Building](https://historicengland.org.uk/listing/the-list/list-entry/1218203)
- [Bristol Museums：Cabot Tower](https://museums.bristol.gov.uk/narratives.php?irn=3492)
- [Historic England：Bristol Cathedral](https://historicengland.org.uk/listing/the-list/list-entry/1202129)
- [Bristol Cathedral：历史](https://bristol-cathedral.co.uk/history/)

## 接口及独立制作

| 接口 | 用途 |
|---|---|
| GET /city/current | 返回共享 1.1 document、磁盘版本 revision 及 storage 指标；读取不改写旧文件 |
| POST /city/current | 携带 base_revision 和 1.0 / 1.1 document 保存；返回新 revision、bytes 和 storage |
| POST /city/validate | 完整项目校验 |
| POST /city/geojson | GeoJSON 转换及批次校验，不直接保存 |
| POST /city/refine | 单栋轮廓细化 / 分类配色，返回完整对象，不直接保存 |
| GET /city/export | 当前城市的完整下载文件 |
| GET /city/schema | 城市 JSON Schema |

在仓库根目录运行以下命令，可在无网页、无 HTTP 服务的情况下，从本地保留数据重建城市文件：

```powershell
./.venv/Scripts/python.exe data-pipeline/generate_city.py --output .local/bristol-rebuilt.gugis.json
./.venv/Scripts/python.exe data-pipeline/refine_city.py input.gugis.json output-detailed.gugis.json
./.venv/Scripts/python.exe data-pipeline/pack_city.py old-city.gugis.json shared-city.gugis.json
./.venv/Scripts/python.exe data-pipeline/generate_building.py --kind cathedral --floors 6 --units 1 --name "Bristol Cathedral" --output .local/cathedral.gugis.json
```

独立程序写入指定输出路径，不自动替换正在编辑的城市工作区。
