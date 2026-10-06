# 真实 DTM 的直纹面带与三角带混合表达

入口：`/compare#hybrid-source-results`。输入来自已经公开的十城二十固定样区，每个样区含 65 × 65 个原始一米 Float32 节点，比较的是节点之间 64 × 64 m 的源双线性高程函数。

在完整文件不超过 **8,192 B** 的条件下，混合表达在 **20/20** 个样区中的全域 E₂ 都低于本次固定网格 P1，降幅 **3.01%–18.09%**。全部十档预算共 **179/200** 组优于 P1；其他结果同样公开。这里的 P1 是固定张量网格三角带，不能将这一结果描述成打败论文的自适应算法。

## 连接与误差

每个样区检查 49 个固定张量网格、三种表示，共 2,940 份原生模型。每个矩形单元可用共享角点的双线性直纹面，或者两个 P1 三角面表示。混合方法按全域积分中的局部平方误差选择类型，连续同类单元合并为面带或三角带记录；额外记录和重复边界索引全部计入完整 GPR4 二进制文件。

所有单元共享整数网格角点，两种类型沿矩形边界具有相同的线性函数，因此保持 C⁰，梯度可以跳变。这里没有独立细分引起的 T 形接点。

E₂ = √∫(z模型 − z源)² dA，单位 m²。面带与源函数在一米源单元内的残差为双线性函数，最大绝对差检查角点；三角模型还检查裁切后的对角线二次残差极值。只检查源节点会漏掉对角线内部峰值。连续最大差包含明确的 Float64 数值余量，不是严格区间证明，也不是实测地面精度。

## 页面与完整证据

页面支持二十样区、十档完整文件预算和六档最大差目标。原生查询按需读取当前三种模型和原始源高程格，检查长度、SHA-256、坐标原点和网格布局，再由原生函数返回同点高程、坡度和源函数差。17 × 17 线框只是显示采样，另图直接显示保存文件中的混合类型分布。

界面使用由完整不可变报告派生的紧凑视图，仅保留实际显示的指标和下载回执；所有样区、预算、未合格项与数值保持一致。`python data-pipeline/build_hybrid_ui_summary.py --check` 可逐字节检查该视图，公开研究报告不受裁剪。

在 10 cm 最大差目标下，曼彻斯特中心混合文件为 42,748 B，P1 为 35,048 B，混合反而较大；利兹中心混合为 21,520 B，P1 为 35,048 B。其他一些样区需要完整一米面带，P1 固定候选可能全部不合格。按局部 E₂ 选类型不保证文件最小或最大差最小，这些结果都保留。

- 预先固定协议：`data-pipeline/hybrid_source_protocol.json`。
- 全部模型、原始 GeoTIFF 裁片与结果：`frontend/public/research/hybrid-source-v1/`。
- 全部选择：`selections.csv`；原生查询核验：`native-audit.json`；独立积分：`integral-audit.json`。
- 原生核验包含 15,432,060 次高程、梯度及源节点查询，12,801,600 对接缝高程检查。
- 独立五节点求积重新计算全部保存模型，并校核局部选择和连续最大差。
- 完整证据：`hybrid-source-evidence.zip`；报告 SHA-256：`b21a22efdbaddf5aabe56a264a3681966fc6ffb09d1cdfb60d25b5d008901b62`。

## 复现

先使用新的输出目录，运行生成、原生审计及独立发布。已发布的 v1 与其哈希绑定脚本不可覆盖；修改算法应建立新协议和版本。

```powershell
python data-pipeline/hybrid_source_benchmark.py .local/research/hybrid-source-reproduction
cd frontend
node scripts/audit-hybrid-source.mjs ../.local/research/hybrid-source-reproduction
cd ..
python -c "import sys; sys.path.insert(0, 'data-pipeline'); import publish_hybrid_source as p; from pathlib import Path; p.verify(Path('.local/research/hybrid-source-reproduction'))"
python -m unittest discover -s data-pipeline/tests -p 'test_hybrid_source*.py'
cd frontend
node --test tests/hybridSourceNative.test.mjs tests/hybridSourceResults.test.mjs
```

输出目录必须尚不存在，且原始 DTM、固定报告与绑定脚本必须完整。上述命令只生成并核验私有复现结果，不替换网站公开 v1。Python 需要 NumPy。测试验证原生算法及 React 交互；它们不替代真实浏览器/GPU 验收，不代表 ArcGIS 软件测试。原始源单位元数据警告、ODN/米制约定、英国环境署来源与 OGL 署名一并保留。现有正式城市与历史存档不被此研究实验修改。
