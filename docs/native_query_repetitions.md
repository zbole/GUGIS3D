# 三次独立进程的原生 CPU 查询复测

入口：`/compare#native-query-repeat`。

预先固定三次新 Node 进程和全部五个同函数样例后，完成了 255 对准备后测量及 75 对旧内核测量，完整保留 **660 行**原始记录。五例 × 三进程的 **15/15** 个耗时中位数对比均大于 1，三角 / 面带耗时中位数之比为 **1.024–1.408×**。重新构建实际内核后的 **123,000** 次高程、梯度和边界查询通过。

| 固定样例 | 进程 1 | 进程 2 | 进程 3 |
| --- | ---: | ---: | ---: |
| 二次轮廓沿直线延展 | 1.078× | 1.024× | 1.082× |
| 二次轮廓随母线线性变化 | 1.226× | 1.193× | 1.210× |
| 8 条连续面带 | 1.367× | 1.408× | 1.394× |
| 32 条连续面带 | 1.168× | 1.235× | 1.196× |
| 128 条连续面带 | 1.190× | 1.219× | 1.203× |

这是一组本机 Windows i7-14650HX / Node v24.13.0 CPU 测量。三次实测范围不是置信区间，不能把相关行合并成独立实验推断；后台系统负载仍不受控。较小收益与全部配对失败次数都保留。结果不等于 ArcGIS 软件、论文作者实现、GPU 帧率或跨设备保证。

## 固定条件

五个固定例子均比较相同高程函数与解析梯度：两个旧例分别使用 P₂ / P₃ 三角函数控制，三个分段例使用 P₃。所有原生文件、内核源代码、4,096 个查询点、五批预热、17 对准备后试验、五对旧内核试验及交替执行顺序均保持原始协议。每例双方共用标定后的循环数，上限为 128。

旧运行器的 esbuild 配置会探测受限祖先目录；本次使用已有的仓库范围构建器，仅替换构建调用和根目录解析。原始计时正文保持逐字节相同，发布审计能逆向恢复并验证原始源码 SHA-256。独立核验重新构建两个内核，逐字节比较全部三次实际计时产物，再读取原始二进制文件检查函数结果。这没有绕过文件权限。

本任务的构建和数值审计在计时前结束，三个进程顺序运行，没有择优重跑。原始 `native-query-v1` 与后续 `query-statistics-v1` 证据均保持不变。

## 下载与复现

`frontend/public/research/native-query-repeat-v1/` 包含三次独立报告和 CSV、所有 660 行合并记录、实际编译内核、固定查询点、源代码快照、原始 v1 ZIP、协议、独立审计与科学图。完整新证据 ZIP 为 376,360 B，SHA-256：`37f2f36b205e6359421b37ff6d3335505375cf5769955208250a28ebec761e5a`。

在仓库根目录运行，输出目录须是 `.local/research` 下尚不存在的直接子目录。原始分段例可以从旧证据 ZIP 的 `piecewise-controls.json` 和三份分段例模型恢复到独立目录，报告命名为 `results.json`；报告字节必须符合固定协议的哈希。`piecewise-ruled-2026-10-06-fixed` 为本机原始固定例目录。

```powershell
node frontend/scripts/repeat-native-query.mjs .local/research/native-query-repeat-reproduction .local/research/piecewise-ruled-2026-10-06-fixed
node frontend/scripts/audit-native-repeat.mjs .local/research/native-query-repeat-reproduction
python data-pipeline/publish_native_repeat.py .local/research/native-query-repeat-reproduction --verify-only
python -m unittest discover -s data-pipeline/tests -p 'test_native_query_repeat.py'
cd frontend
node --test tests/nativeRepeatAdapter.test.mjs tests/nativeQueryRepeatResults.test.mjs
```

复现计时允许结果不同，不会覆盖已公开 v1。发布验证要求本次固定的 CPU/Node 身份，换设备应使用新协议和独立版本。新增页面已通过数值、React 交互和构建检查；当前环境仍未完成新增页面的真实浏览器/GPU 验收。
