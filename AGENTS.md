# AGENTS.md — Neo Magic Compiler

所有开发工作必须严格遵守以下边界与协作纪律。

## 1. 项目定位与当前分支

- **当前开发分支**：`main`
- **分支目标**：移除剧情与魔法世界观包装，专注于**零基础强游戏化交互教学闭环**、**现代 Web 应用改造**以及**本地 C 语言项目联动体验**。
- **开局必读顺序**（不要一上来盲扫全仓浪费上下文）：
  1. `documents/交接文档.md`（当前进度、资产盘点、Phase 1~5 行动清单）
  2. `documents/目标与形态.md`（4 套强游戏化交互沙盘、教学闭环、7 章路线与 DAG 支线体系）
  3. `documents/架构.md`（Web + `nmc-wasm` + `nmc-bridge` 协议与模块边界）
  4. `documents/代码质量规范.md`（分层依赖红线、数据驱动铁律、文件规模与门禁标准）
  5. 设计关卡玩法与文案时读 `documents/关卡设计规范.md`；配置关卡 JSON/测例文件时读 `documents/关卡编写规范.md`；查规格与指令集读 `documents/总设计.md` 与 `documents/术语表.md`。

## 2. 已拍板的架构与玩法红线（勿擅自推翻）

1. **核心 Rust 引擎全部复用**：`crates/riscv-simulator`、`crates/riscv-assembler`、`crates/starlang`、`crates/neomagic-core` 已经过测试与自检验证，**直接复用，不要重写**。
2. **废弃旧桌面壳**：原 `app/src-tauri` 与 `compiler-content/`（mdBook）不再作为目标架构，仅在迁移完成前留作参考,不用时建议删除。
3. **前端技术栈与双部署**：`web/` 采用 **`Vite + TypeScript + React + Tailwind CSS + CodeMirror 6`**，同时支持线上静态部署与 `nmc-bridge` 本地静态托管（`http://127.0.0.1:17320`）。
4. **强游戏化交互 = 4 套可复用数据驱动沙盘**（不为每关硬写一次性动画）：
   - `manual-cpu`（第 1 章：手动拖拽当 CPU + 自动录制为汇编）
   - `memory-canvas`（第 2 章：2D 内存/指针/结构体画布 + 预测挑战 + C↔汇编三联高亮）
   - `lexer-ast-lab`（第 3~4 章前端：切词传送带 + AST 积木拼装）
   - `pipeline-stage`（第 3~6 章后端：通电流水线 + `DrawVM` 画布 / RISC-V 监视器）
5. **独立通用 Playground（`/playground`）三模式**：
   - 在线编辑模式（`nmc-wasm` Web Worker，零安装）
   - 本地单文件监听模式（`nmc-bridge`，支持第 1~2 章 `.s`/`.c`）
   - 本地 C 工程模式（`nmc-bridge` 识别 `nmc.project.json`，调用本机 `gcc`/`clang`/`make` 构建、超时沙箱执行、推进第 3~6 章）
6. **七章渐进结构与三类节点（DAG 技能树）**：第 1 章 RISC-V 汇编 → 第 2 章 C 语言核心基础 → 第 3 章数据结构与基础算法 → 第 4 章 `DrawVM` 迷你编译器 → 第 5 章核心 C→RISC-V 编译器 → 第 6 章编译器功能扩展 → 第 7 章编译优化与高阶算法（图着色、支配树、SSA 等）。关卡分为 `lesson`（概念）、`practice`（零新知识巩固）、`challenge`（不阻塞主线的硬核支线），由 `prerequisites` DAG 控制解锁。
7. **工具链策略**：仅提供清晰安装指引 + `nmc-bridge` 启动自动体检，不打包内置 C 编译器，但保留 `nmc.project.json` 编译器路径可配置。

## 3. 协作与编码纪律

- **重大分歧先讨论**：凡存在两种以上合理设计方案（架构变动、协议变更、关卡机制调整），先列选项与权衡让项目发起人拍板，**禁止擅自拍板**。
- **先闭环，后扩量**：每个 Phase 先跑通最小可玩样板（如 Phase 1 先做通 `1-1`~`1-5`），验收后再批量生产。
- **代码风格**：注释统一使用**中文**，注重长期可读性与模块边界清晰；禁止在 UI/文档中重新引入魔法剧情术语。
- **阶段收尾更新记忆**：每完成一个阶段或关键改动，务必同步更新 `documents/交接文档.md` 的进度日志与下一步清单。

## 4. 质量门禁与 Windows 开发避坑

- **提交前必跑检查**：
  - `cargo test --workspace`
  - `cargo test -p neomagic-core selfcheck -- --nocapture`
  - `cargo test -p neomagic-core every_level_page_and_test_config_are_consistent`
  - 改动 `web/` 时跑 `npm run typecheck` / `npm run build`。
- **严禁使用 PowerShell `Set-Content` / `Out-File` 写含中文的文件**：会按 GBK 破坏 UTF-8 源码。始终用支持 UTF-8 的编辑工具。
- **离线构建**：根目录 `.cargo/config.toml` 配置了 `[net] offline = true` 防止多进程锁冲突；新增 crate 依赖需先单独联网缓存一次。
- **提交卫生**：每次 `git commit` 前必须执行 `git status --short`，确保没有混入临时探针文件或多余 `target/` 目录；禁止用 `mdbook test` 当门禁。
