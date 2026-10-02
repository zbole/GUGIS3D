# 当前使用入口

本地页面已升级为城市项目。请按 [城市工作区说明](city_format.md) 使用“添加建筑”“修改建筑”“导出整个城市”。所有已应用的修改自动写入 `.local/city/current.gugis.json`；单栋文件导入会追加，城市文件导入会恢复项目。旧“原城市场景”页面已移除。

以下保留启动环境和第一版技术验证记录；旧版按钮名称以当前页面为准。

# GUGIS3D 本地运行与使用

当前版本在原 React、Cesium、FastAPI 项目上增加了三维对象工作台。代码保存在本机 GUGIS3D 目录，Git 分支为 local/object-studio，未向远程仓库推送。

## 启动和停止

本机已安装并验证 Node.js 24.13.0、Python 3.13 独立虚拟环境，以及锁定的前后端依赖。不需要 Conda、Docker、PostGIS 或 Cesium ion Token。

双击项目根目录的 start-local.cmd。它会启动两个仅监听本机回环地址的后台服务，并打开 http://127.0.0.1:5173/。重复运行会复用本项目已经启动的服务。关闭网页不会停止后台服务。

也可在项目目录运行：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\start-local.ps1 -NoBrowser
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\stop-local.ps1
```

首次在另一台 Windows 电脑安装：准备 Python 3.13（py 启动器）及 Node.js 22 或以上，再运行：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\start-local.ps1 -Setup
```

前端地址 http://127.0.0.1:5173/；后端健康检查 http://127.0.0.1:8000/health；接口文档 http://127.0.0.1:8000/docs。日志保存在项目 .local 目录。脚本检查端口冲突，且不会终止占用端口的其他应用。

## 推荐演示顺序

1. 打开“对象查看”，显示默认 12 层、2 个单元、48 户住宅。
2. 点击“关注楼层”，设为 8 至 11 层。其余楼层透明显示。
3. 点击“仅看区间”，把起止层都设为 8；点选蓝色窗户，右侧可查看所属单元、楼层、住户编号和复用模板。
4. 点击“移开上部”，从 11 层起抬升 12 米。切换“隐藏上部”可查看剩余主体。“恢复全部”撤销当前显示操作。
5. 在“数据制作”中选低层住宅，修改层数、单元数、层高和名称，点击“生成三维对象”。
6. 点击“保存对象文件”。经过校验的完整文件会写入项目 .local/exports 目录，界面显示完整位置。文件名采用内容散列，相同版本重复保存不会生成重复文件。不同版本分别保留。
7. 点击“读取对象文件”，选择已保存的 .gugis.json 文件。导入恢复完整对象，不受保存前的楼层隐藏或移开状态影响。版本不支持或内容损坏时保留当前模型并提示错误。
8. 点击“原城市场景”使用原有 18 个对象、图层、属性查询和量测功能。

“下载副本”提供标准 HTTP 附件地址。内置浏览器可能不呈现下载事件；本地保存回执与 .local/exports 中的实际文件是可靠的保存依据。网页刷新会重新显示示例，因此需要保留的修改应先保存文件。

## 独立三维制作程序

该程序只依赖 Python 和 Pydantic，无需运行网页、FastAPI 服务或 Cesium。

```powershell
.\.venv\Scripts\python.exe data-pipeline/generate_building.py --floors 12 --units 2 --output .local/tower.gugis.json
.\.venv\Scripts\python.exe data-pipeline/generate_building.py --kind villa --floors 3 --units 1 --output .local/villa.gugis.json
```

先用该程序写出对象文件，再在工作台读取，形成制作与可视化分离的工作流程。

## 验证命令

```powershell
$env:PYTHONPATH='backend'
.\.venv\Scripts\python.exe -m unittest discover -s backend/tests -v
npm test --prefix frontend
npm run build --prefix frontend
```

44 项后端测试和 42 项前端测试覆盖语义继承、输入边界、闭合几何、文件互读、楼层操作、City 1.2 面带与函数地物、独立草稿与历史恢复，以及编辑表单和场景对象生命周期。前端测试使用 React 测试渲染器与 Cesium Viewer 替代对象，不能替代真实浏览器/GPU 验收。生产构建已通过。当前开发启动无需生产构建。

## 故障处理

端口占用：先运行 stop-local.ps1；如仍提示占用，检查是否是另一个项目，勿直接终止未知进程。

页面有界面但无模型：查看 .local/frontend.err.log；启动脚本会检查 Cesium 本地资源，避免资源被错误地返回成 HTML。需要 WebGL 浏览器。

显示“内置示例 · 离线”：后端尚未就绪。可查看模型并使用浏览器下载副本，但生成、校验、可靠本地保存需要启动后端。

## 当前边界

这是对评审意见的首版可运行实现。住宅由固定构件规则组合，可调整层数、单元数、层高、地理位置和朝向；尚不是自由拖放的通用 CAD 建模器。低层住宅示例并非原“别墅700”的复刻。

单栋对象采用 gugis-studio 1.0 JSON，城市项目支持 gugis-city 1.0/1.1/1.2；新增的地形与函数地物保存为 City 1.2。尚不兼容原 CMakeDate/CGuGisProjection 的 .gugis/.index 二进制文件，网站已移除原城市场景入口。

未实现任意实体布尔运算、通用三维剖切、三维实体生成准确二维内外环、原 C++ 程序复编译或大规模场景流式加载。后续需要原源码、结构体/序列化定义及至少一组可核对的原始对象文件，才能准确实现兼容与对比验证。
