//! 运行器：把玩家代码编译成机器码，再按测例跑起来。
//!
//! 两种模式：
//! - **函数模式**（测例里有 `call`）：在玩家代码之外生成一小段"引导代码"，
//!   把参数放进 `a0..` 然后跳到目标函数，返回后 `a0` 就是函数的返回值。
//! - **程序模式**（没有 `call`）：从代码段入口开始跑，跑到 `ecall` 退出。

use crate::config::{CallSpec, Language, LevelConfig, MemExpect, TestCase};
use riscv_assembler::{assemble_with, Assembly, Options};
use riscv_simulator::{PauseOn, Simulator, SimulatorConfig, MMIO_DISPLAY, MMIO_INPUT};
use starlang::CompileOutput;
use std::collections::BTreeMap;

/// 引导代码放的地址。
///
/// 放在 `0x0800`：玩家代码从 0 开始，`0x0800` 之上是关卡测例常用的数据区
/// （`0x1000` 起）与星咒编译器的数据段（`0x4000`），彼此不重叠。
/// 早期版本把它放在 `0x2000`，结果把测例放在 `0x2000` 的数组整片盖掉了。
pub const BOOT_ADDR: u32 = 0x0800;
/// 默认栈顶。
pub const DEFAULT_STACK_TOP: u32 = 0x0000_F000;

/// 编译/汇编阶段的错误（带行号）。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CodeError {
    pub line: u32,
    pub message: String,
    /// 是汇编错误还是星咒错误（前端可以用来给不同的提示）
    pub kind: ErrorKind,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ErrorKind {
    /// 星之语汇编错误
    Assemble,
    /// 星咒编译错误
    Compile,
}

impl std::fmt::Display for CodeError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        if self.line == 0 {
            write!(f, "{}", self.message)
        } else {
            write!(f, "第 {} 行：{}", self.line, self.message)
        }
    }
}

/// 一条测例跑完之后的机器状态。
#[derive(Debug, Clone)]
pub struct MachineState {
    pub regs: BTreeMap<String, u32>,
    pub zero_regs: BTreeMap<String, u32>,
    pub pc: u32,
    pub instructions: u64,
    /// 非零内存（稀疏）
    pub memory: BTreeMap<u32, u8>,
    pub output: String,
    pub exit_code: Option<i32>,
    /// 结束原因（`exit` / `ebreak` / `error` / `limit` …）
    pub pause_kind: String,
    /// 结束原因的说明文字（`error` 时是错误信息）
    pub pause_detail: Option<String>,
}

/// 一条测例的执行结果。
#[derive(Debug, Clone)]
pub struct CaseOutcome {
    /// 是否为函数模式
    pub is_call: bool,
    /// 函数返回值（函数模式）
    pub ret: Option<i32>,
    pub state: MachineState,
}

/// 关卡运行器。
pub struct Runner {
    pub config: LevelConfig,
    /// 生成/汇编好的代码
    pub assembly: Assembly,
    /// 星咒编译产物（汇编文本），供 UI 展示
    pub generated: Option<String>,
}

impl Runner {
    /// 编译玩家代码。编译失败时返回带行号的错误。
    pub fn new(config: LevelConfig, code: &str) -> Result<Self, Vec<CodeError>> {
        let (assembly_text, generated) = match config.language {
            Language::Asm => (code.to_string(), None),
            Language::C => {
                let out: CompileOutput = starlang::compile(code).map_err(|e| {
                    vec![CodeError { line: e.line, message: e.message, kind: ErrorKind::Compile }]
                })?;
                (out.assembly.clone(), Some(out.assembly))
            }
        };

        let options = Options {
            base_addr: 0,
            data_base: if config.language == Language::C { starlang::DATA_BASE } else { 0x1000 },
            available_ops: config.available_ops.clone(),
            forbidden_regs: config.forbidden_regs.clone(),
            allow_pseudo: true,
        };
        let assembly = assemble_with(&assembly_text, &options).map_err(|errs| {
            errs.into_iter()
                .map(|e| CodeError { line: e.line, message: e.message, kind: ErrorKind::Assemble })
                .collect::<Vec<_>>()
        })?;

        Ok(Self { config, assembly, generated })
    }

    /// 玩家代码的机器码（供调试面板显示）。
    pub fn words(&self) -> &[u32] {
        &self.assembly.words
    }

    /// 指令地址 → 源行号。
    pub fn line_of(&self, addr: u32) -> Option<u32> {
        self.assembly.addr_to_line(addr)
    }

    /// 跑一条测例。
    pub fn run_case(&self, case: &TestCase) -> CaseOutcome {
        let mut cfg = self.base_config(case);
        let is_call = case.call.is_some();
        cfg.pause_on = if is_call {
            PauseOn::batch()
        } else if case.batch_output {
            PauseOn::batch()
        } else {
            self.judge_pause_on()
        };

        let mut sim = Simulator::new();
        sim.configure(cfg);
        self.apply_and_boot(&mut sim, case.call.as_ref());
        // 把测例的输入字符流灌进输入端口（必须在 run 之前）
        if !case.input_text.is_empty() {
            push_input(&mut sim, &case.input_text);
        }
        let r = sim.run().expect("模拟器不该在这里失败");

        let ret = if is_call { sim.get_reg("a0").map(|v| v as i32) } else { None };
        let state = MachineState {
            regs: u32_regs(&sim),
            zero_regs: zero_regs(&sim),
            pc: sim.get_pc(),
            instructions: r.instructions_executed,
            memory: snapshot(&sim),
            output: r.text_output.clone(),
            exit_code: r.exit_code,
            pause_kind: r.reason.kind().to_string(),
            pause_detail: Some(r.reason.describe()),
        };
        CaseOutcome { is_call, ret, state }
    }

    /// 程序模式下的"暂停行为"：默认为了速度不逐次暂停 MMIO 写。
    fn judge_pause_on(&self) -> PauseOn {
        let mut po = PauseOn::batch();
        po.mmio_read_empty = false;
        po
    }

    /// 组装一个"执行这段汇编"所需的模拟器配置基底。
    fn base_config(&self, case: &TestCase) -> SimulatorConfig {
        let mut cfg = SimulatorConfig::new();
        cfg.max_instructions = case.max_instructions.unwrap_or(self.config.max_instructions);

        // 寄存器名统一成 `x0`..`x31` 再放进配置。
        //
        // 这一点很关键：`sp` 与 `x2` 是同一个寄存器的两个名字，如果同时以两个键塞进去，
        // 模拟器按 HashMap 的迭代顺序赋值，结果就不确定了。
        let canon = |name: &str| -> Option<String> {
            riscv_simulator::reg_index(name).map(riscv_simulator::reg_name)
        };

        // 栈指针：测例显式给了 `initial.sp` 就用它；否则只有当测例**没有**占用 x2 时
        // 才填默认栈顶 —— 第一章的关卡常把 x1/x2 当"两个格子"用，而 x2 恰好是 sp。
        let x2_used_by_case = case.initial_regs.contains_key("x2") || case.initial_regs.contains_key("sp");
        if let Some(sp) = case.initial_sp {
            cfg.initial_regs.insert("x2".to_string(), sp);
        } else if !x2_used_by_case {
            cfg.initial_regs.insert("x2".to_string(), DEFAULT_STACK_TOP);
        }
        for (name, value) in &case.initial_regs {
            if let Some(key) = canon(name) {
                cfg.initial_regs.insert(key, *value as u32);
            }
        }
        // 数据段（星咒编译产物）交给 initial_memory
        for (addr, byte) in self.assembly.initial_memory() {
            cfg.initial_memory.insert(addr, byte);
        }
        // 测例给的内存
        for (addr, expect) in &case.initial_memory {
            apply_mem_expect(&mut cfg, *addr, expect);
        }
        cfg
    }

    /// 装载代码、写入内存、必要时装引导代码并设置 PC。
    fn apply_and_boot(&self, sim: &mut Simulator, call: Option<&CallSpec>) {
        let mut cfg = sim.config().clone();
        cfg.pause_on = if let Some(_) = call { PauseOn::batch() } else { cfg.pause_on };
        self.assembly
            .apply_to(sim)
            .expect("玩家代码装不进内存（可能是代码段超出了 RAM）");

        // 先写内存：初始数据（apply_to 已经把数据段写进去了）
        match call {
            None => {}
            Some(spec) => {
                let Some(&target) = self.assembly.symbols.get(&spec.function) else {
                    // 找不到函数：让 PC 指向非法地址，判定阶段会给出可读错误
                    panic!(
                        "找不到函数 `{}`；代码里定义的符号有：{:?}",
                        spec.function,
                        self.assembly.symbols.keys().collect::<Vec<_>>()
                    );
                };
                let boot_src = build_boot(target, &spec.args);
                let boot = assemble_with(&boot_src, &Options { base_addr: BOOT_ADDR, ..Options::default() })
                    .expect("引导代码汇编失败（这是引擎的 bug）");
                sim.load_binary_at(BOOT_ADDR, &boot.words).expect("引导代码装不进内存");
                sim.set_pc(BOOT_ADDR);
            }
        }
    }

    /// 造一个**给调试器用**的模拟器：已经装好玩家代码、（需要时）装好引导代码、
    /// 灌好输入字符流，但**一条指令都还没执行**。
    ///
    /// `pause_on` 用调试档（每个 MMIO 写、每次输入读空、`ebreak` 都停下），
    /// 这样"单步"的粒度是玩家能理解的一步，而不是一下子跑到底。
    ///
    /// 前端拿到的是一台停在起点的机器，之后用 `step` / `step_back` 推进。
    pub fn debug_simulator(&self, case: &TestCase) -> Simulator {
        let mut cfg = self.base_config(case);
        cfg.pause_on = PauseOn::debug();
        // 必须打开历史记录，否则 `step_back` / `rewind_to` 无据可回，
        // "倒退"按钮会变成摆设（这里踩过一次：单步能用、倒退静默无效）。
        cfg.record_history = true;
        let mut sim = Simulator::new();
        sim.configure(cfg);
        self.apply_and_boot(&mut sim, case.call.as_ref());
        if !case.input_text.is_empty() {
            push_input(&mut sim, &case.input_text);
        }
        sim
    }

    /// 调试时给玩家看的那条"当前指令"对应的源码行（1-based，0 表示查不到）。
    pub fn line_at(&self, pc: u32) -> u32 {
        self.line_of(pc).unwrap_or(0)
    }
}

/// 生成"设置参数并调用目标函数"的引导代码。
fn build_boot(target: u32, args: &[i64]) -> String {
    let mut s = String::from(".text\n");
    for (i, a) in args.iter().enumerate() {
        s.push_str(&format!("li a{}, {}\n", i, *a as i32));
    }
    s.push_str(&format!("li t5, {}\n", target));
    s.push_str("jalr ra, t5, 0\n");
    s.push_str("li a7, 0\necall\n");
    s
}

fn apply_mem_expect(cfg: &mut SimulatorConfig, addr: u32, expect: &MemExpect) {
    for (offset, byte) in expect.bytes() {
        cfg.initial_memory.insert(addr + offset, byte);
    }
}

fn u32_regs(sim: &Simulator) -> BTreeMap<String, u32> {
    sim.get_all_regs().into_iter().collect()
}

fn zero_regs(sim: &Simulator) -> BTreeMap<String, u32> {
    sim.get_all_regs().into_iter().filter(|(_, v)| *v == 0).map(|(k, v)| (k, v)).collect()
}

fn snapshot(sim: &Simulator) -> BTreeMap<u32, u8> {
    sim.get_memory_snapshot().into_iter().collect()
}

/// 把一条测例的输入字符流灌进模拟器。
pub fn push_input(sim: &mut Simulator, text: &str) {
    let values: Vec<u32> = text.bytes().map(|b| b as u32).collect();
    sim.push_mmio(MMIO_INPUT, &values);
}

/// 读一条测例的输入文本（给 Judge 用）。
pub fn input_values(text: &str) -> Vec<u32> {
    text.bytes().map(|b| b as u32).collect()
}

/// 显示端口地址（供上层引用，避免各处写魔数）。
pub const DISPLAY: u32 = MMIO_DISPLAY;

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::LevelConfig;

    fn asm_runner(code: &str, ops: &[&str]) -> Runner {
        let json = format!(
            r#"{{"level":"t","availableOps":{},"forbiddenRegs":[],
                "goal":{{"type":"static","tests":[{{}}]}}}}"#,
            serde_json::to_string(ops).unwrap()
        );
        let cfg = LevelConfig::parse(&json).unwrap();
        Runner::new(cfg, code).unwrap()
    }

    #[test]
    fn runs_assembly_in_program_mode() {
        let r = asm_runner(
            "li x1, 7\nli x2, 35\nadd x3, x1, x2\nli a7, 0\necall\n",
            &["li", "add", "ecall"],
        );
        let case = TestCase { batch_output: true, ..Default::default() };
        let out = r.run_case(&case);
        assert_eq!(out.state.regs.get("x3"), Some(&42));
        assert_eq!(out.state.exit_code, Some(0));
    }

    #[test]
    fn call_mode_reports_return_value() {
        let json = r#"{"level":"t","language":"c","availableOps":[],"forbiddenRegs":[],
            "goal":{"type":"static","tests":[{}]}}"#;
        let cfg = LevelConfig::parse(json).unwrap();
        let r = Runner::new(cfg, "int solve(int a, int b) { return a * b; }").unwrap();
        let case = TestCase {
            call: Some(CallSpec { function: "solve".into(), args: vec![6, 7] }),
            ..Default::default()
        };
        let out = r.run_case(&case);
        assert_eq!(out.ret, Some(42));
        assert!(out.is_call);
    }

    #[test]
    fn two_cases_in_a_row_keep_their_own_registers() {
        let r = asm_runner("add x3, x1, x2\nli a7, 0\necall\n", &["add", "li", "ecall"]);
        for (a, b) in [(1, 1), (0, 0), (2026, 74)] {
            let mut case = TestCase { batch_output: true, ..Default::default() };
            case.initial_regs.insert("x1".into(), a);
            case.initial_regs.insert("x2".into(), b);
            let out = r.run_case(&case);
            assert_eq!(
                out.state.regs.get("x3"),
                Some(&((a + b) as u32)),
                "a={} b={} 时 x3 不对（x1={:?} x2={:?}）",
                a,
                b,
                out.state.regs.get("x1"),
                out.state.regs.get("x2")
            );
        }
    }

    #[test]
    fn initial_registers_are_applied() {
        let r = asm_runner("add x3, x1, x2\nli a7, 0\necall\n", &["add", "li", "ecall"]);
        let mut case = TestCase { batch_output: true, ..Default::default() };
        case.initial_regs.insert("x1".into(), 3);
        case.initial_regs.insert("x2".into(), 4);
        let out = r.run_case(&case);
        assert_eq!(out.state.regs.get("x3"), Some(&7));
    }

    #[test]
    fn assembly_errors_carry_line_numbers() {
        let cfg = LevelConfig::parse(
            r#"{"level":"t","availableOps":["addi"],"forbiddenRegs":[],
                "goal":{"type":"static","tests":[{}]}}"#,
        )
        .unwrap();
        let errs = match Runner::new(cfg, "addi x1, x0, 1\nmul x2, x1, x1\n") {
            Ok(_) => panic!("本来期望汇编失败"),
            Err(e) => e,
        };
        assert_eq!(errs[0].line, 2);
        assert_eq!(errs[0].kind, ErrorKind::Assemble);
        assert!(errs[0].message.contains("mul"), "{}", errs[0].message);
    }

    #[test]
    fn c_syntax_errors_carry_line_numbers() {
        // 语法错误（词法/语法阶段）带行号
        let cfg = LevelConfig::parse(
            r#"{"level":"t","language":"c","availableOps":[],"forbiddenRegs":[],
                "goal":{"type":"static","tests":[{}]}}"#,
        )
        .unwrap();
        let errs = match Runner::new(cfg, "int solve() {\n  return 1 +\n}") {
            Ok(_) => panic!("本来期望编译失败"),
            Err(e) => e,
        };
        assert_eq!(errs[0].line, 3);
        assert_eq!(errs[0].kind, ErrorKind::Compile);
    }

    #[test]
    fn c_codegen_errors_are_reported_as_compile_errors() {
        // 代码生成阶段的错误（未定义变量）目前**不带行号**（AST 里没有存位置），
        // 但必须是"编译错误"而不是静默通过。行号以后再补（见交接文档）。
        let cfg = LevelConfig::parse(
            r#"{"level":"t","language":"c","availableOps":[],"forbiddenRegs":[],
                "goal":{"type":"static","tests":[{}]}}"#,
        )
        .unwrap();
        let errs = match Runner::new(cfg, "int solve() {\n  return nope;\n}") {
            Ok(_) => panic!("本来期望编译失败"),
            Err(e) => e,
        };
        assert_eq!(errs[0].kind, ErrorKind::Compile);
        assert!(errs[0].message.contains("nope"), "{}", errs[0].message);
    }

    #[test]
    fn memory_expectations_are_written_before_the_run() {
        let r = asm_runner(
            "li x1, 0x1000\nlw x2, 0(x1)\nli a7, 0\necall\n",
            &["li", "lw", "ecall"],
        );
        let mut case = TestCase { batch_output: true, ..Default::default() };
        case.initial_memory.insert(0x1000, MemExpect::Word(99));
        let out = r.run_case(&case);
        assert_eq!(out.state.regs.get("x2"), Some(&99));
    }

    #[test]
    fn input_text_reaches_the_program() {
        let r = asm_runner(
            "li t0, 0xF0000004\nlw x1, 0(t0)\nlw x2, 0(t0)\nadd x3, x1, x2\nli a7, 0\necall\n",
            &["li", "lw", "add", "ecall"],
        );
        let case = TestCase { input_text: "AB".into(), batch_output: true, ..Default::default() };
        let out = r.run_case(&case);
        assert_eq!(out.state.regs.get("x3"), Some(&(65 + 66)));
    }

    #[test]
    fn program_output_is_captured() {
        let r = asm_runner(
            "li t0, 0xF0000000\nli t1, 72\nsw t1, 0(t0)\nli t1, 105\nsw t1, 0(t0)\nli a7, 0\necall\n",
            &["li", "sw", "ecall"],
        );
        let case = TestCase { batch_output: true, ..Default::default() };
        let out = r.run_case(&case);
        assert_eq!(out.state.output, "Hi");
    }

    #[test]
    fn infinite_loop_hits_the_instruction_limit() {
        let r = asm_runner("loop:\nj loop\n", &["j"]);
        let mut case = TestCase { batch_output: true, ..Default::default() };
        case.max_instructions = Some(1000);
        let out = r.run_case(&case);
        assert_eq!(out.state.pause_kind, "limit");
        assert!(out.state.instructions <= 1001);
    }
}
