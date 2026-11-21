# Neo Magic Compiler

一个面向零基础学习者与硬核编程爱好者的**强游戏化交互底层与编译器实战游戏**（开源协议：[MIT License](LICENSE)，当前开发分支：`main`）。

从「手动当 CPU」认识寄存器与 RISC-V 汇编出发，经过 C 语言核心基础、数据结构与算法实战、极简栈式绘图机（`DrawVM`）迷你编译器，最终在本地用真正的 C 语言维护并持续迭代一个将 C 语言编译到 RISC-V 汇编的完整编译器，乃至实现图着色与支配树等高阶优化 Pass。

> **开发状态（Phase 1 样板已落地）**：本分支聚焦**无剧情纯术语教学、图形化强交互沙盘与现代 Web + 本地工程联动架构**。当前已完成第 1 章前段 9 个样板关（`1-1` ~ `1-7` 及硬核支线 `1-4S`、`1-7S`）、浏览器内置 `nmc-wasm` 引擎与图形化 Playground。

---

## 核心设计理念

1. **痛点驱动 + 先手玩，再写代码**：每一关先让玩家用现有工具遇到明确瓶颈，再在**数据驱动的交互沙盘**中亲手操作机制（如拖拽寄存器、在 SVG ALU 芯片上计算、手拨 PC 分支/循环轨道）并实时录制为汇编，然后编码自动化，彻底告别大段纯文字说教。
2. **三类关卡节点与 DAG 技能树**：关卡明确分为 **`lesson`（概念关）**、**`practice`（零新知识主线巩固关）** 与 **`challenge`（不阻塞主线的硬核思维支线，支持 `parInstructions` 最优指令挑战）**，由 `prerequisites` 有向无环图控制解锁，并配备「自由探索」开关。
3. **四套可复用图形化沙盘**：
   - `manual-cpu`（第 1 章）：手动当 CPU + ALU 芯片台 + PC 指令轨道 + 实时录制汇编（Phase 1 已上线）
   - `memory-canvas`（第 2~3 章，规划中）：2D 内存/指针/结构体与数据结构画布 + 预测挑战 + C↔汇编三联对照
   - `lexer-ast-lab`（第 4~5 章前半，规划中）：切词传送带 & AST 积木拼装台
   - `pipeline-stage`（第 4~7 章后端，规划中）：通电流水线 + `DrawVM` 画布 / RISC-V 执行监视器
4. **纯网页交互 + 本地真实工程联动**：前端基于 `Vite + TypeScript + React + Tailwind CSS + CodeMirror 6`，第 1~3 章可通过 `nmc-wasm`（Web Worker）在浏览器零安装运行；第 4~7 章计划通过轻量本地服务 `nmc-bridge` 连接本地 IDE 与真实 C 工程（`nmc.project.json`）。
5. **独立通用 Playground（`/playground`）**：可全屏自由实验 ASM / C 子集，也可挂载任意关卡测例集进行单步/倒退时间轴调试、寄存器与内存变化高亮及测例 Diff。

---

## 七章渐进学习路线

| 章 | 主题 | 运行与开发模式 | 核心目标 |
|----|------|--------------|---------|
| **第 1 章** | RISC-V 汇编入门（RV32IM） | 纯网页 WASM（规划可选本地单文件） | 依托 `manual-cpu` 沙盘掌握算术、分支、循环、内存、调试、函数与 MMIO（**Phase 1 已开放 `1-1`~`1-7` 及支线 `1-4S`/`1-7S`**） |
| **第 2 章** | C 语言核心基础 | 纯网页 WASM（规划可选本地单文件） | 借助内存画布与 C↔汇编三联对照，吃透控制流、数组、指针、字符串、`struct` 与位运算 |
| **第 3 章** | 数据结构与基础算法 | 网页 WASM / 本地工程 | 亲手实现写编译器必备的动态数组、栈、链表、二叉树、哈希表/符号表与状态机扫描 |
| **第 4 章** | 迷你编译器：绘图脚本 → `DrawVM` | 本地 C 工程 + 网页 Playground | 用 C 把绘图脚本编译为 15 指令栈式绘图机（`DrawVM`）指令流，实时画出几何图案 |
| **第 5 章** | 核心编译器：C 核心子集 → RISC-V | 本地 C 工程 + 网页 Playground | 将纯核心 C（`int`/表达式/变量/分支循环/函数与递归）编译成单文件 RV32IM 汇编并真机运行 |
| **第 6 章** | 编译器功能扩展 | 本地 C 工程 + 网页 Playground | 在同一本地工程上扩展一维数组、指针、字符串、`struct`、位运算与 `for`/`break`/`continue` |
| **第 7 章** | 编译优化与高阶算法 | 本地 C 工程 + 网页 Playground | 专题主线/支线树：CFG、活跃变量、冲突图与图着色寄存器分配、支配树与 SSA、死代码消除 |

---

## 整体架构概览

```text
浏览器（web/：React + TypeScript + Tailwind CSS + CodeMirror 6）
  ├─ 关卡技能树 (DAG) / 交互沙盘 / 独立 Playground / 概念图鉴 Wiki
  ├── [已实现 · 在线引擎]  crates/nmc-wasm（WebAssembly + Web Worker）
  └── [规划中 · 本地联动]  crates/nmc-bridge（127.0.0.1:17320 HTTP + WebSocket）
                              │
                              ▼
                     crates/neomagic-core（关卡加载/嵌入、DAG 解锁、Runner、Judge、DTO）
                      ├─ crates/riscv-assembler（两遍扫描汇编器 + 行号映射 + 白名单）
                      ├─ crates/starlang（C 子集参考编译器）
                      └─ crates/riscv-simulator（RV32IM 模拟器 + MMIO + 历史倒退）
```

---

## 仓库目录结构

```text
├── web/                         # [已实现] Web 前端（Vite + TypeScript + React + Tailwind + CodeMirror 6）
│   ├── src/app/                 #   路由与顶栏布局
│   ├── src/pages/               #   DAG 技能树首页 / 关卡页 / 独立 Playground / 概念图鉴
│   ├── src/sandboxes/           #   数据驱动沙盘（manual-cpu 已上线，注册表预留后续沙盘）
│   ├── src/components/          #   可复用工作台、编辑器、寄存器/内存面板、Diff 与抽屉组件
│   ├── src/domain/              #   纯函数业务逻辑（DAG 拓扑、寄存器映射、编辑器约束）
│   └── src/engine/              #   统一 EngineClient 接口、Web Worker 客户端与本地存档
├── content/                     # [Phase 1 已建] 关卡与教学内容
│   ├── levels/cN_M/             #   单关五件套：meta.json + lesson.md + starter.* + tests.json + solution.*
│   ├── wiki/                    #   按需查阅的概念图鉴 Markdown 词条
│   └── templates/               #   [规划中] 第 4~7 章本地 C 工程脚手架模板
├── crates/
│   ├── riscv-simulator/         # [已有复用] RV32IM 模拟器 + MMIO + 历史倒退
│   ├── riscv-assembler/         # [已有复用] 两遍扫描汇编器与白名单校验
│   ├── starlang/                # [已有复用] C 子集 → RISC-V 汇编编译器
│   ├── neomagic-core/           # [已升级] 关卡加载与编译期嵌入、DAG 解锁、Runner、Judge、共享 DTO、自检
│   ├── nmc-wasm/                # [已实现] 面向浏览器的 WASM 绑定层（构建产物输出至 web/src/wasm-pkg）
│   └── nmc-bridge/              # [规划中] Phase 2/3 本地桥接服务（体检/监听/构建/沙箱运行/托管）
├── documents/                   # 设计、架构与代码质量规范文档
├── LICENSE                      # MIT License
├── Makefile                     # 构建与质量门禁快捷入口
└── README.md
```

---

## 快速开始

### 环境要求

- **前端运行与构建**：Node.js ≥ 18、npm
- **核心引擎与 WASM 构建**：Rust 工具链（`rustc` / `cargo`）、`wasm32-unknown-unknown` target 与 `wasm-pack`
  ```bash
  rustup target add wasm32-unknown-unknown
  # 按官方指引或 cargo install 安装 wasm-pack
  ```
- **本地 C 工程联动（第 4~7 章规划）**：本机 C 工具链（`gcc` 或 `clang`、`make`）

### 启动本地网页试玩

首次克隆仓库后（`web/src/wasm-pkg/` 属于生成产物，未提交至 Git），请先编译 WASM 并安装前端依赖：

```bash
# 方式 A：使用 Makefile 一键启动流程
make wasm
make web-install
make web-dev

# 方式 B：直接执行底层命令
wasm-pack build crates/nmc-wasm --target web --out-dir ../../web/src/wasm-pkg --release
cd web && npm install && npm run dev
```

启动后在浏览器打开 `http://localhost:5173` 即可试玩第 1 章前段关卡（`1-1` ~ `1-7` 及 `1-4S` / `1-7S`）、独立 `/playground` 与 `/wiki/rv32-registers`。

> 提示：修改 `crates/` 或 `content/` 下的关卡内容后，需要重新运行 `make wasm` 以刷新前端使用的嵌入式 WASM 包。

### 运行测试与质量门禁

```bash
# 1. 快速测试（Rust 全仓测试 + Web Vitest 纯逻辑单测）
make test

# 2. 关卡参考解自检 + 配置/DAG/无禁词/嵌入一致性守卫
make selfcheck

# 3. 全套提交前门禁（重新构建 WASM + 自检 + Rust 测试 + Web typecheck/lint/test/build）
make check
```

对应的直接命令如下：

```bash
# Rust 引擎测试与关卡自检
cargo test --workspace
cargo test -p neomagic-core selfcheck -- --nocapture
cargo test -p neomagic-core every_level_page_and_test_config_are_consistent

# Web 前端门禁
cd web && npm run typecheck && npm run lint && npm run test && npm run build
```

> 本地桥接命令 `cargo run -p nmc-bridge` 将在 Phase 2/3 建立 `crates/nmc-bridge` 后开放。

---

## 关卡自检与代码质量红线

- **引擎关卡自检**：仓库内所有关卡必须附带可验证的参考解，并通过 `every_level_is_solvable_with_its_reference_solution`（参考解跑通全部测例）与 `every_level_page_and_test_config_are_consistent`（编辑器只读边界、DAG 前置存在性、Par 指标、嵌入清单同步、无残留术语检查）。
- **工程结构与代码规范**：所有前端与 Rust 改动须遵守 [`documents/代码质量规范.md`](documents/代码质量规范.md) 的单向依赖红线、数据驱动原则与类型安全要求。

---

## 文档导航

| 文档 | 职责与适用场景 |
|------|---------------|
| [`documents/交接文档.md`](documents/交接文档.md) | **项目活记忆**：当前资产盘点、Phase 1 完成情况与下一步行动清单 |
| [`documents/代码质量规范.md`](documents/代码质量规范.md) | **强制工程规范**：前后端分层依赖红线、数据驱动铁律、规模控制与自动化门禁 |
| [`documents/目标与形态.md`](documents/目标与形态.md) | **产品定位与闭环设计**：强游戏化交互沙盘、零基础教学闭环、本地联动体验 |
| [`documents/架构.md`](documents/架构.md) | **技术架构与协议**：React 前端、`EngineClient` 抽象、`nmc-wasm` 与未来 `nmc-bridge` 通信协议 |
| [`documents/总设计.md`](documents/总设计.md) | **核心技术规格**：RV32IM 指令与寄存器规格、C 子集分层、`DrawVM` 与 Judge 体系 |
| [`documents/关卡编写规范.md`](documents/关卡编写规范.md) | **关卡编写指南**：`content/levels/cN_M/` 目录规范、`lesson`/`practice`/`challenge` 配置、RISC-V 避坑清单 |
| [`documents/存档格式.md`](documents/存档格式.md) | **存档与同步契约**：浏览器存储结构与后续本地同步规范 |
| [`documents/开发流程.md`](documents/开发流程.md) | **开发与验证流程**：环境搭建、自检与提交流程 |
| [`documents/术语表.md`](documents/术语表.md) | **统一术语约定**：核心计算机术语与模块命名规范 |
