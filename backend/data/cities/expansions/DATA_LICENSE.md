# 扩展街区和新增城市的数据来源

2026-10-04 的六份采集使用 OpenStreetMap Overpass 接口。原始响应、查询范围、采集时间、哈希、署名及转换统计随文件保留；所有范围均为中心街区样本，不代表全城覆盖。完整相交 way 可能越出查询框；未取得 multipolygon relations、实测地形或建筑内部。

原始 OSM 来源和相应派生数据库按 [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/) 分发，署名 **© OpenStreetMap contributors**，见 [OpenStreetMap 版权说明](https://www.openstreetmap.org/copyright)。建筑高度标签未独立实测；无标签时采用楼层推算或明确标注的假设高度。新采集保留 Overpass 返回的公开标签。

本目录的布里斯托、伦敦、伯明翰资料仅为新增来源。合并后的种子还保留原项目对象，沿用各对象原来源和许可；不将设计示范或规则推演的室内结构视为 OSM 实测成果。曼彻斯特、爱丁堡、卡迪夫的原始响应和清单位于本目录上层，以城市名命名。

原有 `cities/DATA_LICENSE.md` 和 `baselines/v1` 是较早版本候选审阅的固定来源，不能将其原采集范围或过滤规则套用到本次扩展。
