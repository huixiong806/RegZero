//! 浏览器内置引擎（WASM 薄适配层）。
//!
//! 所有领域逻辑收口在 `neomagic-core`；本 crate 仅负责：
//! 1. 维护单线程 Web Worker 内的调试会话状态；
//! 2. 通过 `wasm-bindgen` 暴露标准 camelCase JSON 接口；
//! 3. 提供原生可单测的 `EngineCore`，保证前后端契约在 `cargo test` 中受保护。

use neomagic_core::config::{Goal, Language, LevelConfig, TestCase};
use neomagic_core::dto::{
    describe_executed_op, sparse_bytes_to_words, verdict_to_submit_dto, LevelPayload, LevelSummary,
    MachineSnapshot, StepPayload, SubmitDto, TestCasePreview, WikiEntry,
};
use neomagic_core::levels::LevelStore;
use neomagic_core::progress::UserProgress;
use neomagic_core::runner::Runner;
use riscv_simulator::Simulator;
use std::collections::BTreeMap;
use wasm_bindgen::prelude::*;

/// 自由沙盒模式默认的单次运行指令上限，防止死循环卡死 Worker。
const SANDBOX_MAX_INSTRUCTIONS: u64 = 20_000;

/// 当前调试会话。
struct DebugSession {
    sim: Simulator,
    runner: Runner,
    watch_addrs: Vec<u32>,
}

/// 纯 Rust 引擎核心（既可被 WASM 包装，也可直接在 `cargo test` 中测试）。
pub struct EngineCore {
    store: LevelStore,
    debug: Option<DebugSession>,
}

impl Default for EngineCore {
    fn default() -> Self {
        Self::new()
    }
}

impl EngineCore {
    /// 使用编译期嵌入的关卡与 Wiki 构造引擎。
    pub fn new() -> Self {
        Self { store: LevelStore::embedded(), debug: None }
    }

    /// 列出全部关卡摘要，并根据前端传入的存档 JSON 计算 DAG 解锁状态。
    pub fn list_levels(&self, progress_json: &str) -> Result<Vec<LevelSummary>, String> {
        let progress: UserProgress = if progress_json.trim().is_empty() {
            UserProgress::default()
        } else {
            serde_json::from_str(progress_json).unwrap_or_default()
        };
        let ids = self.store.level_ids();
        let prereqs = self.store.prerequisite_map();
        let mut out = Vec::with_capacity(ids.len());

        for id in ids {
            let src = self.store.load_source(&id).map_err(|e| e.to_string())?;
            let meta = src.meta;
            let rec = progress.levels.get(&id);
            out.push(LevelSummary {
                id: meta.id.clone(),
                chapter: meta.chapter,
                order: meta.order,
                kind: meta.kind,
                title: meta.title,
                language: meta.language,
                mode: meta.mode,
                allow_local_file: meta.allow_local_file,
                prerequisites: meta.prerequisites,
                concepts: meta.concepts,
                par_instructions: meta.par_instructions,
                passed: rec.map(|r| r.passed).unwrap_or(false),
                unlocked: progress.is_unlocked_dag(&id, &prereqs),
                attempts: rec.map(|r| r.attempts).unwrap_or(0),
                best_score: rec.and_then(|r| r.best_score),
            });
        }
        Ok(out)
    }

    /// 加载单关完整数据（含元信息、沙盘配置、初始代码与测例摘要）。
    pub fn load_level(&self, level_id: &str) -> Result<LevelPayload, String> {
        let bundle = self.store.load(level_id).map_err(|e| e.to_string())?;
        let tests_preview = cases_of(&bundle.config)
            .iter()
            .enumerate()
            .map(|(i, c)| TestCasePreview::from_case(i, c))
            .collect();
        Ok(LevelPayload {
            id: bundle.id,
            meta: bundle.source.meta,
            lesson_markdown: bundle.source.lesson_markdown,
            editor: bundle.source.editor,
            initial_code: bundle.source.initial_code,
            available_ops: bundle.config.available_ops,
            forbidden_regs: bundle.config.forbidden_regs,
            tests_preview,
            solution: bundle.solution,
        })
    }

    /// 按顺序列出全部结构化 Wiki 词条。
    pub fn list_wiki(&self) -> Result<Vec<WikiEntry>, String> {
        self.store.list_wiki()
    }

    /// 读取单篇结构化 Wiki 词条。
    pub fn load_wiki(&self, topic: &str) -> Result<WikiEntry, String> {
        self.store.load_wiki(topic)
    }

    /// 运行某关卡的指定测例（不计分，不修改存档）。
    pub fn run_code(
        &self,
        level_id: &str,
        code: &str,
        case_index: Option<usize>,
    ) -> Result<MachineSnapshot, String> {
        let bundle = self.store.load(level_id).map_err(|e| e.to_string())?;
        let runner = build_runner(bundle.config.clone(), code)?;
        let case = pick_case(&bundle.config, case_index);
        let watch_addrs = collect_watch_addrs(&bundle.source.meta.sandbox, &case);
        let outcome = runner.run_case(&case);
        Ok(MachineSnapshot {
            pc: outcome.state.pc,
            pc_line: runner.line_at(outcome.state.pc),
            regs: outcome.state.regs,
            memory_words: sparse_bytes_to_words(&outcome.state.memory, &watch_addrs),
            tick: outcome.state.instructions,
            instructions: outcome.state.instructions,
            output: outcome.state.output,
            exit_code: outcome.state.exit_code,
            pause_kind: outcome.state.pause_kind,
            pause_detail: outcome.state.pause_detail.unwrap_or_default(),
            halted: true,
            can_step: false,
            can_step_back: false,
            generated_assembly: runner.generated.clone(),
        })
    }

    /// 自由沙盒运行（独立 Playground 无白名单限制模式）。
    pub fn run_sandbox(
        &self,
        language: &str,
        code: &str,
        input_text: &str,
    ) -> Result<MachineSnapshot, String> {
        let (cfg, case) = sandbox_config_and_case(language, input_text)?;
        let runner = build_runner(cfg, code)?;
        let outcome = runner.run_case(&case);
        Ok(MachineSnapshot {
            pc: outcome.state.pc,
            pc_line: runner.line_at(outcome.state.pc),
            regs: outcome.state.regs,
            memory_words: sparse_bytes_to_words(&outcome.state.memory, &[0x1000, 0x1004]),
            tick: outcome.state.instructions,
            instructions: outcome.state.instructions,
            output: outcome.state.output,
            exit_code: outcome.state.exit_code,
            pause_kind: outcome.state.pause_kind,
            pause_detail: outcome.state.pause_detail.unwrap_or_default(),
            halted: true,
            can_step: false,
            can_step_back: false,
            generated_assembly: runner.generated.clone(),
        })
    }

    /// 提交代码并执行全部测例判定。
    pub fn submit_code(&self, level_id: &str, code: &str) -> Result<SubmitDto, String> {
        let bundle = self.store.load(level_id).map_err(|e| e.to_string())?;
        let instruction_count = Runner::new(bundle.config.clone(), code)
            .ok()
            .map(|r| r.words().len());
        let verdict = neomagic_core::judge(&bundle.config, code);
        Ok(verdict_to_submit_dto(
            level_id,
            verdict,
            instruction_count,
            bundle.source.meta.par_instructions,
        ))
    }

    /// 启动关卡调试会话（支持传入 `case_index`，支撑「一键调试失败测例」）。
    pub fn debug_start(
        &mut self,
        level_id: &str,
        code: &str,
        case_index: Option<usize>,
    ) -> Result<MachineSnapshot, String> {
        let bundle = self.store.load(level_id).map_err(|e| e.to_string())?;
        let runner = build_runner(bundle.config.clone(), code)?;
        let case = pick_case(&bundle.config, case_index);
        let watch_addrs = collect_watch_addrs(&bundle.source.meta.sandbox, &case);
        let sim = runner.debug_simulator(&case);
        let snap = make_snapshot(&sim, &runner, &watch_addrs);
        self.debug = Some(DebugSession { sim, runner, watch_addrs });
        Ok(snap)
    }

    /// 启动自由沙盒调试会话。
    pub fn debug_start_sandbox(
        &mut self,
        language: &str,
        code: &str,
        input_text: &str,
    ) -> Result<MachineSnapshot, String> {
        let (cfg, case) = sandbox_config_and_case(language, input_text)?;
        let runner = build_runner(cfg, code)?;
        let watch_addrs = vec![0x1000, 0x1004, 0x1008, 0x100C];
        let sim = runner.debug_simulator(&case);
        let snap = make_snapshot(&sim, &runner, &watch_addrs);
        self.debug = Some(DebugSession { sim, runner, watch_addrs });
        Ok(snap)
    }

    /// 单步前进 `n` 步（`n == 1` 时附带本步指令的数据通路脉冲信息）。
    pub fn debug_step(&mut self, n: u32) -> Result<StepPayload, String> {
        let s = self
            .debug
            .as_mut()
            .ok_or_else(|| "尚未进入调试会话，请先点击「调试」".to_string())?;
        let steps = n.max(1);
        let pre_capture = if steps == 1 && !s.sim.is_halted() {
            let pc_before = s.sim.get_pc();
            let word = if pc_before % 4 == 0 {
                s.runner.words().get((pc_before / 4) as usize).copied()
            } else {
                None
            };
            let regs_before: BTreeMap<String, u32> = s.sim.get_all_regs().into_iter().collect();
            Some((pc_before, s.runner.line_at(pc_before), word, regs_before))
        } else {
            None
        };

        let res = s.sim.step(steps).map_err(|e| e.to_string())?;
        let snapshot = make_snapshot(&s.sim, &s.runner, &s.watch_addrs);
        let executed = pre_capture.and_then(|(pc_before, line_before, word, regs_before)| {
            word.and_then(|w| {
                describe_executed_op(
                    w,
                    pc_before,
                    snapshot.pc,
                    line_before,
                    snapshot.pc_line,
                    &regs_before,
                    &snapshot.regs,
                )
            })
        });
        Ok(StepPayload {
            snapshot,
            reg_changes: res.reg_changes.into_iter().collect(),
            mem_changes: res.mem_changes.into_iter().take(64).collect(),
            executed,
        })
    }

    /// 倒退 `n` 步。
    pub fn debug_step_back(&mut self, n: u32) -> Result<StepPayload, String> {
        let s = self
            .debug
            .as_mut()
            .ok_or_else(|| "尚未进入调试会话，请先点击「调试」".to_string())?;
        let res = s.sim.step_back(n.max(1));
        Ok(StepPayload {
            snapshot: make_snapshot(&s.sim, &s.runner, &s.watch_addrs),
            reg_changes: res.reg_changes.into_iter().collect(),
            mem_changes: res.mem_changes.into_iter().take(64).collect(),
            executed: None,
        })
    }

    /// 继续运行直到暂停点或退出。
    pub fn debug_continue(&mut self) -> Result<MachineSnapshot, String> {
        let s = self
            .debug
            .as_mut()
            .ok_or_else(|| "尚未进入调试会话，请先点击「调试」".to_string())?;
        s.sim.run().map_err(|e| e.to_string())?;
        Ok(make_snapshot(&s.sim, &s.runner, &s.watch_addrs))
    }

    /// 重置当前调试会话到起点。
    pub fn debug_reset(&mut self) -> Result<MachineSnapshot, String> {
        let s = self
            .debug
            .as_mut()
            .ok_or_else(|| "尚未进入调试会话，请先点击「调试」".to_string())?;
        s.sim.reset();
        Ok(make_snapshot(&s.sim, &s.runner, &s.watch_addrs))
    }

    /// 退出调试会话并释放模拟器状态。
    pub fn debug_quit(&mut self) {
        self.debug = None;
    }

    /// 按需读取当前调试会话指定地址段的 32 位字视图（最多 64 字）。
    pub fn debug_read_memory(
        &self,
        start_addr: u32,
        word_count: u32,
    ) -> Result<BTreeMap<String, i32>, String> {
        let s = self
            .debug
            .as_ref()
            .ok_or_else(|| "尚未进入调试会话".to_string())?;
        let aligned = start_addr & !3;
        let count = word_count.clamp(1, 64);
        let mem: BTreeMap<u32, u8> = s.sim.get_memory_snapshot().into_iter().collect();
        let mut out = BTreeMap::new();
        for i in 0..count {
            let addr = aligned.saturating_add(i * 4);
            let b0 = *mem.get(&addr).unwrap_or(&0);
            let b1 = *mem.get(&(addr + 1)).unwrap_or(&0);
            let b2 = *mem.get(&(addr + 2)).unwrap_or(&0);
            let b3 = *mem.get(&(addr + 3)).unwrap_or(&0);
            out.insert(format!("0x{:04X}", addr), i32::from_le_bytes([b0, b1, b2, b3]));
        }
        Ok(out)
    }

    /// 编译 C 子集源码为 RISC-V 汇编（为 Phase 2 三联高亮预留 `lineMap` 字段）。
    pub fn compile_starlang_with_map(&self, code: &str) -> Result<serde_json::Value, String> {
        let out = starlang::compile(code).map_err(|e| format!("第 {} 行：{}", e.line, e.message))?;
        Ok(serde_json::json!({
            "assembly": out.assembly,
            "lineMap": []
        }))
    }
}

// ═══════════════════════════════════════════════════════════════════════════
//  WASM 绑定壳（统一返回 JSON 字符串，确保与 HTTP Bridge 协议 1:1 一致）
// ═══════════════════════════════════════════════════════════════════════════

/// 暴露给浏览器 Web Worker 的引擎句柄。
#[wasm_bindgen]
pub struct WasmEngine {
    core: EngineCore,
}

#[wasm_bindgen]
impl WasmEngine {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        Self { core: EngineCore::new() }
    }

    pub fn list_levels(&self, progress_json: &str) -> Result<String, JsValue> {
        to_json(self.core.list_levels(progress_json))
    }

    pub fn load_level(&self, level_id: &str) -> Result<String, JsValue> {
        to_json(self.core.load_level(level_id))
    }

    pub fn list_wiki(&self) -> Result<String, JsValue> {
        to_json(self.core.list_wiki())
    }

    pub fn load_wiki(&self, topic: &str) -> Result<String, JsValue> {
        to_json(self.core.load_wiki(topic))
    }

    pub fn run_code(
        &self,
        level_id: &str,
        code: &str,
        case_index: Option<usize>,
    ) -> Result<String, JsValue> {
        to_json(self.core.run_code(level_id, code, case_index))
    }

    pub fn run_sandbox(
        &self,
        language: &str,
        code: &str,
        input_text: &str,
    ) -> Result<String, JsValue> {
        to_json(self.core.run_sandbox(language, code, input_text))
    }

    pub fn submit_code(&self, level_id: &str, code: &str) -> Result<String, JsValue> {
        to_json(self.core.submit_code(level_id, code))
    }

    pub fn debug_start(
        &mut self,
        level_id: &str,
        code: &str,
        case_index: Option<usize>,
    ) -> Result<String, JsValue> {
        to_json(self.core.debug_start(level_id, code, case_index))
    }

    pub fn debug_start_sandbox(
        &mut self,
        language: &str,
        code: &str,
        input_text: &str,
    ) -> Result<String, JsValue> {
        to_json(self.core.debug_start_sandbox(language, code, input_text))
    }

    pub fn debug_step(&mut self, n: u32) -> Result<String, JsValue> {
        to_json(self.core.debug_step(n))
    }

    pub fn debug_step_back(&mut self, n: u32) -> Result<String, JsValue> {
        to_json(self.core.debug_step_back(n))
    }

    pub fn debug_continue(&mut self) -> Result<String, JsValue> {
        to_json(self.core.debug_continue())
    }

    pub fn debug_reset(&mut self) -> Result<String, JsValue> {
        to_json(self.core.debug_reset())
    }

    pub fn debug_quit(&mut self) {
        self.core.debug_quit();
    }

    pub fn debug_read_memory(&self, start_addr: u32, word_count: u32) -> Result<String, JsValue> {
        to_json(self.core.debug_read_memory(start_addr, word_count))
    }

    pub fn compile_starlang_with_map(&self, code: &str) -> Result<String, JsValue> {
        to_json(self.core.compile_starlang_with_map(code))
    }
}

impl Default for WasmEngine {
    fn default() -> Self {
        Self::new()
    }
}

// ═══════════════════════════════════════════════════════════════════════════
//  内部辅助
// ═══════════════════════════════════════════════════════════════════════════

fn to_json<T: serde::Serialize>(res: Result<T, String>) -> Result<String, JsValue> {
    match res {
        Ok(val) => serde_json::to_string(&val)
            .map_err(|e| JsValue::from_str(&format!("结果序列化失败：{}", e))),
        Err(msg) => Err(JsValue::from_str(&msg)),
    }
}

fn build_runner(config: LevelConfig, code: &str) -> Result<Runner, String> {
    Runner::new(config, code).map_err(|errs| {
        errs.iter()
            .map(|e| {
                if e.line == 0 {
                    e.message.clone()
                } else {
                    format!("第 {} 行：{}", e.line, e.message)
                }
            })
            .collect::<Vec<_>>()
            .join("\n")
    })
}

fn cases_of(config: &LevelConfig) -> &[TestCase] {
    match &config.goal {
        Goal::Static { tests } | Goal::Output { tests } => tests,
        Goal::Scripted { .. } => &[],
    }
}

fn pick_case(config: &LevelConfig, case_index: Option<usize>) -> TestCase {
    let list = cases_of(config);
    let idx = case_index.unwrap_or(0);
    list.get(idx).or_else(|| list.first()).cloned().unwrap_or_default()
}

fn sandbox_config_and_case(language: &str, input_text: &str) -> Result<(LevelConfig, TestCase), String> {
    let lang = Language::parse(language)
        .ok_or_else(|| format!("不支持的沙盒语言：{}（仅支持 asm / c）", language))?;
    let case = TestCase {
        name: "自由沙盒".to_string(),
        input_text: input_text.to_string(),
        ..Default::default()
    };
    let cfg = LevelConfig {
        level: "sandbox".to_string(),
        language: lang,
        available_ops: Vec::new(),
        forbidden_regs: Vec::new(),
        max_instructions: SANDBOX_MAX_INSTRUCTIONS,
        goal: Goal::Static { tests: vec![case.clone()] },
    };
    Ok((cfg, case))
}

fn collect_watch_addrs(sandbox: &serde_json::Value, case: &TestCase) -> Vec<u32> {
    let mut addrs = Vec::new();
    if let Some(arr) = sandbox.get("watchMemory").and_then(|v| v.as_array()) {
        for item in arr {
            if let Some(s) = item.as_str() {
                if let Ok(a) = parse_addr(s) {
                    addrs.push(a);
                }
            }
        }
    }
    for &addr in case.initial_memory.keys().chain(case.expected_memory.keys()) {
        addrs.push(addr & !3);
    }
    addrs.sort_unstable();
    addrs.dedup();
    addrs
}

fn parse_addr(s: &str) -> Result<u32, std::num::ParseIntError> {
    let trimmed = s.trim();
    if let Some(hex) = trimmed.strip_prefix("0x").or_else(|| trimmed.strip_prefix("0X")) {
        u32::from_str_radix(hex, 16)
    } else {
        trimmed.parse::<u32>()
    }
}

fn make_snapshot(sim: &Simulator, runner: &Runner, watch_addrs: &[u32]) -> MachineSnapshot {
    let pc = sim.get_pc();
    let tick = sim.get_tick();
    let halted = sim.is_halted();
    let (pause_kind, pause_detail) = match sim.last_pause() {
        Some(p) => (p.kind().to_string(), p.describe()),
        None => ("ready".to_string(), "就绪，等待单步或运行".to_string()),
    };
    let mem: BTreeMap<u32, u8> = sim.get_memory_snapshot().into_iter().collect();
    MachineSnapshot {
        pc,
        pc_line: runner.line_at(pc),
        regs: sim.get_all_regs().into_iter().collect(),
        memory_words: sparse_bytes_to_words(&mem, watch_addrs),
        tick,
        instructions: tick,
        output: sim.text_output(),
        exit_code: sim.exit_code(),
        pause_kind,
        pause_detail,
        halted,
        can_step: !halted,
        can_step_back: tick > sim.history_base_tick(),
        generated_assembly: runner.generated.clone(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn list_load_submit_and_debug_roundtrip() {
        let mut engine = EngineCore::new();

        // 1. 列出关卡与 DAG 解锁
        let levels = engine.list_levels("").unwrap();
        assert!(levels.len() >= 9);
        assert_eq!(levels[0].id, "1-1");
        assert!(levels[0].unlocked);
        assert!(!levels[1].unlocked);

        // 2. 加载 1-4S 支线关并验证提交 + Par 达标
        let level = engine.load_level("1-4S").unwrap();
        assert_eq!(level.meta.par_instructions, Some(4));
        let sol = level.solution.unwrap();
        let submit = engine.submit_code("1-4S", &sol).unwrap();
        assert!(submit.passed);
        assert_eq!(submit.instruction_count, Some(4));
        assert!(submit.met_par);

        // 3. 启动指定失败测例调试 + 单步 + 倒退
        let init_snap = engine.debug_start("1-4S", &sol, Some(1)).unwrap();
        assert_eq!(init_snap.tick, 0);
        assert!(!init_snap.can_step_back);

        let step1 = engine.debug_step(1).unwrap();
        assert_eq!(step1.snapshot.tick, 1);
        assert!(step1.snapshot.can_step_back);
        assert!(!step1.reg_changes.is_empty());

        let back = engine.debug_step_back(1).unwrap();
        assert_eq!(back.snapshot.tick, 0);
        assert!(!back.snapshot.can_step_back);
    }

    #[test]
    fn sandbox_runs_asm_and_c() {
        let engine = EngineCore::new();
        let asm_snap = engine
            .run_sandbox("asm", "addi t0, zero, 21\nadd t1, t0, t0\necall\n", "")
            .unwrap();
        assert_eq!(asm_snap.regs.get("x6"), Some(&42));

        let c_snap = engine
            .run_sandbox("c", "int main() { return 6 * 7; }", "")
            .unwrap();
        assert!(c_snap.generated_assembly.is_some());
    }

    #[test]
    fn wiki_entries_are_embedded_and_readable() {
        let engine = EngineCore::new();
        let list = engine.list_wiki().unwrap();
        assert!(list.len() >= 3);
        assert_eq!(list[0].topic, "rv32-registers");
        let reg = engine.load_wiki("rv32-registers").unwrap();
        assert!(reg.title.contains("寄存器"));
        assert!(!reg.sections.is_empty());
    }
}
