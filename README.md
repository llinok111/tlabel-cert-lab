# tlabel-cert-lab

**把动画标签的“什么时候可见 / 什么时候重叠”从 60 Hz 逐帧采样换成整段精确区间证书：** 6 个 4 s 场景、84 个标签、141 个真实重叠区间，60 Hz 采样漏掉其中 **26 个（18.44%）**；同一份证书的整段求解中位 **0.428 ms**，60 Hz 扫描中位 **2.283 ms**（**5.34×**），且 6/6 场景的车道数达到冲突图最大团下界（可证最优）。所有数字由 `bench/verify.mjs` 与 `bench/bench.mjs` 现场复算。

Upstream: none

这是一个原创项目，不是任何仓库的 fork。示例场景由 `tools/gen-sample.mjs` 确定性生成。

## 怎么跑（一条命令）

```bash
node tools/gen-sample.mjs && node bench/verify.mjs
```

需要 Node ≥ 20（本机实测 v24.19.0），零 npm 依赖，不安装 three。

浏览器演示（three.js 从 CDN importmap 加载，版本写死 0.169.0）：

```bash
python3 -m http.server 4173
# 打开 http://localhost:4173
```

`main.js` 只消费 `solveScene()` / `statusAt()` 的输出，不在渲染层重算几何。

## 它到底证明什么

每个标签与遮挡物都在屏幕平面内做**匀速直线运动**，标签盒子为 `w × h`。两条轴上的重叠条件都是 `|d0 + dv·t| < (w1+w2)/2`，对 `t` 是线性的，因此“两个可见标签在何时重叠”的精确解是**一个开区间**，不需要采样、不需要容差常量。

`src/core.mjs` 对每个场景输出：

1. **visible**：标签完整落在视口内、且未被任何移动遮挡物覆盖的时间区间（并集）；
2. **collisions**：两个标签**同时可见且盒子重叠**的时间区间；
3. **lanes**：把标签按“是否曾经碰撞”连成冲突图，做 DSATUR 着色；同车道标签保证永不碰撞；
4. **optimality**：冲突图最大团（Bron–Kerbosch）给出色数下界，DSATUR 用色数等于下界时，车道数被证明最优。

60 Hz 基线在 `baseline/sampled.mjs`：同一套盒子判定，但只在 `k/60` 帧上求值，再把连续为真的帧合并成 run。它不知道区间解法的存在。

## 证据（真实运行，`bench/result.json`）

| 指标 | 实测 | 对照 / 基线 |
|---|---|---|
| 精确重叠区间 | **141** | 60 Hz 检测到 115，漏 **26**（miss rate **18.44%**） |
| 独立 oracle | 6 场景 × 30,000 点 = **180,000** 采样 | 采样到的 **309,781** 个碰撞瞬时全部落在解析区间内，**0 漏** |
| 区间中点复核 | **140/140** 碰撞区间中点经独立实现复算为“同时可见且重叠” | 可见区间中点也逐条复算，**0 假阳** |
| 车道最优性 | **6/6** 场景 `lanes == maxClique` | 同车道碰撞 **0**；团内每对都有真实碰撞见证 |
| 整段求解（6 场景） | 中位 **0.428 ms**，p95 0.741 ms，min 0.425 ms | 60 Hz 扫描中位 **2.283 ms** → **5.34×** |
| 冷启动（首次全量） | **6.71 ms**（含 JIT/首次分配） | 11 个样本，每样本 200 次重复取均值 |
| 尺度不变性 | 1e-6 / 1e-3 / 1 / 1e3 / 1e6 五个尺度，**0 组合不一致** | 区间端点最大归一化漂移 **5.03e-16**；车道数、碰撞数不变 |

`bench/bench.mjs` 的 11 个样本里，`min=0.4252` 与 `median=0.4277` 只差 **0.6%**，但 `stddev=0.0889`（相对中位 **20.8%**，超过 10%）。原因：4 核共享机器上的两次 GC/JIT 停顿把 p95 抬到 0.741 ms；主结论用中位数，不用均值，也不隐藏这个离散度。

逐场景输出（来自 `node bench/verify.mjs`）：

```
crossing-rows      overlaps=20  collisions=20  lanes=2  clique=2   60HzMissed=0
subframe-conveyor  overlaps=26  collisions=26  lanes=2  clique=2   60HzMissed=23
swarm-occlusion    overlaps=10  collisions=9   lanes=3  clique=3   60HzMissed=0
priority-stack     overlaps=85  collisions=85  lanes=11 clique=11  60HzMissed=3
viewport-egress    overlaps=0   collisions=0   lanes=1  clique=1   60HzMissed=0
occluder-sweep     overlaps=0   collisions=0   lanes=1  clique=1   60HzMissed=0
RESULT PASS failures=0
```

## 本轮创新

**B 档：首次把“标签可见性”做成连续时间区间证书，并在同一份精确区间上解出可证最优的车道着色。**

- 同账号的 `labelcast-lab` 只做**静态** 40 个标签的遮挡布局；`toi-cert-lab` 只做**三角对**的 TOI 区间；本项目处理的是**动画标签的整段可见性/碰撞区间**，对象与输出都不同。
- 以前的做法是逐帧采样：4 s 只要 240 帧，但亚帧级别的交叉（`subframe-conveyor` 中 26 个区间有 23 个整段落在两帧之间）会被结构性漏掉。本项目把判定变成线性不等式的精确解，漏检不再依赖帧率。
- “所见即所验”：浏览器滑块读的是 Node 里被断言的同一份 `solveScene()` 输出；页面不重算区间。

## 已知限制（必须读）

1. **只覆盖匀速直线运动**。非线性轨迹需分段线性化并在端点做事件去重，未实现。
2. **屏幕空间轴对齐盒子**，不含旋转、缩放动画或透视投影下的尺寸变化；正交投影是当前模型。
3. **边界瞬时按开区间处理**：恰好相切的一个瞬间测度为 0，不计入区间；`bench` 的采样点取 `(i+0.5)·T/N`，避开端点。
4. **没有绝对阈值常量**（没有 `AREA_EPS` 之类）。唯一的数值容差出现在验证侧：oracle 采样步长 `T/30000`（约 1.33e-4 s），尺度漂移断言 `< 1e-9`（实测 5.03e-16）。
5. **有效尺度 1e-6 … 1e6**（五个数量级实测状态一致）；`< 1e-12` 未测。
6. 场景是**合成基准语料**（脚本生成、固定种子、两次 md5 一致），不是真实资产；它用于证明判定逻辑，不用于声称真实产品性能。
7. 浏览器层只验证了静态服务 200、importmap 存在、JS 语法；没有截图或无头浏览器证据（明确不使用 Playwright/Puppeteer）。
8. 60 Hz 基线是“朴素逐帧扫描”，不是工业竞品；它只用来量化亚帧漏检。

## 上游回馈评估

本轮交 **0 个**。这是原创的标签可见性/调度工具，没有修改上游库；three.js 的逐帧标签遮挡是设计选择，不是缺陷。未写 `state/upstream-pr.json`。

## License

MIT，见 `LICENSE`。示例场景与全部代码均为本项目原创。