# 城市来源复核与后续覆盖边界 · 2026-10-03

## 已验证的保留数据

对 `a1394ba67e8135ba49520984082eda647840696a` 的两城来源与种子做了离线复核：

- 原始保留文件 SHA-256、字节数、元素数均与 `*-source.json` 一致
- 派生种子 SHA-256、字节数均与 `*-import.json` 一致
- 使用该提交的转换器重建，两城输出逐字节等于提交的种子
- OSM 快照时间均为 `2026-10-03T04:31:51Z`
- London 为 Westminster / Whitehall 样区：823 栋、762 条道路；Birmingham 为 Civic centre / Jewellery Quarter 样区：809 栋、479 条道路
- 真实的是来源水平轮廓；高度标签未独立核验，多数高度是楼层估算或显示假设，没有实测 DEM、立面或室内数据

完整采集窗口、实际几何包络、许可与源文件哈希见
[来源许可](../backend/data/cities/DATA_LICENSE.md)及
[多城市工作区说明](multi_city_workspaces.md)。查询窗口不是行政边界；完整跨界 way 的几何可能超出窗口。

## 发现的问题与严格导入规则

旧转换器把已知但超出 1–150 米范围的高度也归入 9.6 米假设：

- Birmingham：OSM `way/1436375109`，The Octagon，来源 `height=155`、`building:levels=49`，旧种子高度为 9.6 米
- London：`way/951721975`、`way/1149973649`，来源 `height=0.5`，旧种子高度也为 9.6 米
- 另有 London 9 个、Birmingham 5 个来源记录带有 `building:part`、非零/复合 `min_height` 或非零 `building:min_level`。旧转换器忽略这些属性，可能填满悬空部分下方或重复表示建筑部件；London 其中一个记录也属于上述 0.5 米记录

修正后的 `city_sample_import.py` 使用以下规则：

1. 样区导入器支持经闭合网格与归档往返测试的 0.1–1000 米来源高度；The Octagon 的 155 米及可导入对象的 0.5 米保持原值。超出此明确范围时拒绝，不改用楼层数或 9.6 米；其他 GeoJSON 接口的既有高度范围没有改变
2. 没有可用高度但有楼层数时，仅使用有限、范围内的 `building:levels × 3.2 m`；若原 `height` 无法解析，会在单栋高度依据中明确说明
3. 仅在高度和楼层标签均缺失时采用 9.6 米显示假设；无法安全解析的竖向值不当成缺失值
4. 建筑部件、地下建筑以及非零/无法解析的底部高度或起始楼层明确跳过，保留 OSM ID 与原因；不将其强制从地面拉伸
5. Polygon 复杂度、闭合性等既有校验保持有效；不能转换的记录进入遗漏清单

这是保守的 LoD1 样区导入规则，不代表这些被跳过的建筑不存在。
完整英国城市数据仍需扩展建筑部件、内环及 multipolygon 关系支持；不能通过丢弃不支持的建筑来宣称全城完整。

## 不自动替换旧数据

本次修正增加导入规则、验证测试、精确版本质量提示及独立 v2 候选，**不改写仓库保留的 OSM 来源、种子、旧转换清单，也不改写用户本地工作区**。
因此当前 823 / 809 栋种子仍是原始版本，仍带有上述已知问题。
使用新导入器构建的候选文件必须单独查看遗漏清单、预览，再决定是否替换；不能把旧种子称为已修正。

隔离重建命令（从仓库根目录运行，使用新的输出目录）：

```sh
PYTHONPATH=backend .venv/bin/python data-pipeline/import_city_samples.py \
  --city all --output-dir .local/rebuilt-strict-city-samples
```

2026-10-03 使用最终 0.1–1000 米规则生成的
[`candidates/v2`](../backend/data/cities/candidates/v2/README.md) 验证结果：

| 候选 | 建筑 / 道路 | 来源高度 / 楼层推算 / 缺失假设 | 遗漏建筑总数 |
|---|---:|---:|---:|
| London | 814 / 762 | 17 / 327 / 470 | 11（包括原先复杂轮廓 2 栋） |
| Birmingham | 804 / 479 | 48 / 133 / 623 | 5 |

这些计数只代表严格规则产生的候选，不是现有工作区或已发布种子的计数。
原种子哈希保持不变：

- London：`eae9915aebbbbeaa4d5bd8998e339b112b42dbb08b64ed4145014d86d4e8c050`
- Birmingham：`a5d38bcdcec5a1181db4f56f98414612709c5f51a0a642fe89d35f89965809fd`

`source-audit.json` 将上述旧版本哈希与来源问题绑定。
`GET /cities` 新增 `data_revision` 与 `quality_warnings`：只有已验证文件字节的 SHA-256 与城市标识同时命中审计表，才返回该种子专属问题。
当前文件被编辑后哈希不同，不将旧版本的特定断言套用到新文件；这不代表新文件已经完成质量核验。
前端还应将目录 `data_revision` 与当前加载的项目修订号对比，避免旧目录响应在编辑后继续显示过期断言。

此前 1–150 米严格方案的隔离试验产生 813 / 803 栋；该中间方案已被最终高度保留方案取代，不应作为 v2 候选计数。

## 从三个样区走向全英国

### 先定义“覆盖”

[Cabinet Office 官方名单](https://www.gov.uk/government/publications/list-of-cities/list-of-cities-html)
的 United Kingdom 部分包含 76 座城市：England 55、Scotland 8、Wales 7、Northern Ireland 6。
Douglas 及列在 Overseas Territories 下的城市不属于这一 UK 分母。
Wales 的 Bangor 和 Northern Ireland 的 Bangor 必须有不同标识。
官方名单中的 London 和 Westminster 分列；本项目当前 `london` 工作区实际上是 Westminster / Whitehall 的伦敦样区，不能直接当作官方 City of London 边界覆盖。

城市地位名单只定义成员，不定义可计算的覆盖多边形。
[ONS 的 built-up area 解释](https://www.ons.gov.uk/peoplepopulationandcommunity/housing/articles/townsandcitiescharacteristicsofbuiltupareasenglandandwales/census2021)
与行政辖区、官方 city status 并不等同；London 还有特殊处理。
Northern Ireland 可参考
[NISRA settlement limits](https://www.nisra.gov.uk/publications/urban-rural-geography-documents-2015)，
但其年份和定义也必须单独记录。
每个城市应明确选择边界版本、来源、许可及哈希，再计算已取得/未取得/不能转换区域，而不是用下拉菜单数量作为覆盖率。

### 数据路线

- **继续 OSM**：与现有来源和许可最兼容。小样区使用有界 Overpass 查询；城市或全国批量处理应转为区域 PBF 与本地筛选，避免把公共查询服务当作无限批量接口。
  [OSMF API 使用政策](https://operations.osmfoundation.org/policies/api/)明确将大量读取引向批量下载/替代服务。
  [Geofabrik United Kingdom](https://download.geofabrik.de/europe/united-kingdom.html)包含 Great Britain 和 Northern Ireland；不要误用 Great Britain 抽取代表 UK
- **Overture**：可用统一建筑 schema 与 bbox 下载作为扩展来源。全球覆盖不等于每栋都存在；`height`、`num_floors` 等是可选字段，建筑部件需另外处理。
  官方 [Python client](https://docs.overturemaps.org/getting-data/overturemaps-py/)支持 GeoJSON/GeoParquet 有界下载；生产应固定发布版本并保存原始 `sources`、实体 ID、查询与哈希。
  [建筑指南](https://docs.overturemaps.org/guides/buildings/)及
  [schema](https://docs.overturemaps.org/schema/reference/buildings/building/)给出具体语义
- **OS OpenMap – Local**：是 Great Britain 的概化底图建筑轮廓，不包括 Northern Ireland，也不能单独解决可靠楼高。
  [OS 产品说明](https://www.ordnancesurvey.co.uk/products/os-open-map-local)及
  [OpenData 使用/署名要求](https://www.ordnancesurvey.co.uk/products/product-support)
  适合补充底图；不要把概化复合面当作逐栋实测轮廓
- **真实高程补充**：Environment Agency 的
  [1m DSM](https://www.data.gov.uk/dataset/cf3f1137-c12b-44a1-a835-e80fe4a60b92/lidar-composite-digital-surface-model-dsm-1m)
  覆盖约 99% England，不能代表全 UK。DSM 含树木等地物且时间不一；和匹配的 DTM 计算楼高也只是需要质量校验的派生值，不能自动称为实测建筑高度

OSM 与 Overture 建筑数据库采用 ODbL；保留署名、许可链接及每条来源信息，公开派生数据库时遵循相同许可和数据可获取要求。
Overture 中其他来源还可能有附加署名要求，应按实际 `sources` 及
[官方 attribution 页面](https://docs.overturemaps.org/attribution/)复核。
这些数据许可不自动改变应用代码的许可。

### 建议的有界分块验收（尚未实现全国数据流）

1. 以一个真实来源版本和已确认城市边界为单位，生成稳定的网格/四叉树 tile 索引；密集区域继续细分，使每包建筑数和字节数都有上限
2. 每栋用稳定来源 ID 去重并分配唯一 owner tile，保留完整建筑几何；渲染包的实际包络可以跨 tile，不能把跨界几何重复计为新建筑。道路应另存源 ID 与切分段 ID
3. 每包记录输入/输出 SHA-256、来源日期、query/实际 bounds、建筑/道路数、height/levels/assumed 数、遗漏 ID 与原因、许可和边界版本
4. 城市目录只读小型索引；视域附近才请求 LoD1 包，并设置总内存、并发请求、CPU/GPU 实例数与缓存淘汰上限。当前 City JSON 的 3,000 资产 / 5,000 实例限制仍是编辑文档边界，不能简单提高数值代替分块
5. 全量基础数据与局部编辑工作区分开。用户编辑、草稿、历史按城市和稳定对象 ID 保存，源数据更新不得自动覆盖它们
6. 先在 London 与 Birmingham 测量首屏、切换、视域移动、内存回收和失败重试，再覆盖 Scotland、Wales、Northern Ireland 的样区。只有边界内目标来源已完成取得与转换，遗漏被解释，才能报告该边界/该来源的覆盖；不能等同于现实世界建筑零遗漏

上述路线是后续工程验收计划，不是已完成的全英数据或性能承诺。
