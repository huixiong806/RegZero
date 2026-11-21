//! 判定器：把一条测例的实际结果与期望值比对，给出结论。
//!
//! 判定的三条原则：
//! 1. **只比玩家看到的与教学目标相关的状态** —— 测例写什么就比什么，没写的不比；
//! 2. **输出文本按"行"比对**（去掉每行首尾空白、丢掉空行），这样缩进差异不算错；
//! 3. 失败时要给出**可读的差异说明**，让玩家知道差在哪，而不是一句"答案错误"。

use crate::config::{Goal, Language, LevelConfig, MemExpect, TestCase};
use crate::runner::{CaseOutcome, CodeError, MachineState, Runner};
use riscv_simulator::reg_name;
use std::collections::BTreeMap;

/// 单条测例的判定结论。
#[derive(Debug, Clone)]
pub struct TestVerdict {
    /// 测例名（展示给玩家）
    pub name: String,
    pub passed: bool,
    /// 失败时的一句话说明
    pub detail: String,
    /// 期望值 vs 实际值的明细（最多几条）
    pub diffs: Vec<Diff>,
    /// 失败现场（供前端自动进入调试模式）
    pub failure_site: Option<FailureSite>,
    /// 实际输出（有输出时展示）
    pub actual_output: Option<String>,
}

/// 一处差异。
#[derive(Debug, Clone)]
pub struct Diff {
    pub what: String,
    pub expected: String,
    pub actual: String,
}

/// 失败现场。
#[derive(Debug, Clone)]
pub struct FailureSite {
    pub case_index: usize,
    pub pc: u32,
    /// 对应到编辑器里的行号（1-based；0 表示未知）
    pub line: u32,
    pub regs: BTreeMap<String, u32>,
    pub reason: FailureReason,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FailureReason {
    /// 代码没编过
    Compile,
    /// 运行出错（段错误、非法指令…）
    Runtime,
    /// 指令数超限
    Limit,
    /// 返回值不对
    Return,
    /// 寄存器不对
    Register,
    /// 内存不对
    Memory,
    /// 输出不对
    Output,
    /// 退出码不对
    ExitCode,
    /// 找不到目标函数
    MissingFunction,
}

impl FailureReason {
    /// 给玩家看的一句话。
    pub fn describe(&self) -> &'static str {
        match self {
            FailureReason::Compile => "代码没有编译通过",
            FailureReason::Runtime => "程序运行时出错了",
            FailureReason::Limit => "程序执行太久（可能是死循环）",
            FailureReason::Return => "函数返回的值不对",
            FailureReason::Register => "某个寄存器的终值不对",
            FailureReason::Memory => "内存里的结果不对",
            FailureReason::Output => "输出的内容不对",
            FailureReason::ExitCode => "程序的结束状态不对",
            FailureReason::MissingFunction => "没有找到要求的函数",
        }
    }
}

/// 整个关卡的判定结果。
#[derive(Debug, Clone)]
pub struct Verdict {
    pub level: String,
    pub passed: bool,
    /// 0–100
    pub score: u32,
    /// 一句话总结
    pub summary: String,
    pub tests: Vec<TestVerdict>,
    /// 编译错误（若有）
    pub errors: Vec<CodeError>,
    /// 星咒关卡：编译器生成的汇编文本（给玩家看）
    pub generated_assembly: Option<String>,
}

impl Verdict {
    fn compile_failed(level: &str, errors: Vec<CodeError>) -> Self {
        let summary = match errors.first() {
            Some(e) => format!("{}", e),
            None => "代码没有编译通过".to_string(),
        };
        Self {
            level: level.to_string(),
            passed: false,
            score: 0,
            summary,
            tests: Vec::new(),
            errors,
            generated_assembly: None,
        }
    }
}

/// 判定是否通过（供自检与上层使用）。
pub fn verdict_passed(v: &Verdict) -> bool {
    v.passed
}

/// 判定一个关卡的提交。
pub fn judge(config: &LevelConfig, code: &str) -> Verdict {
    let runner = match Runner::new(config.clone(), code) {
        Ok(r) => r,
        Err(errors) => return Verdict::compile_failed(&config.level, errors),
    };

    let generated = runner.generated.clone();
    let mut verdicts = Vec::new();

    match &config.goal {
        Goal::Static { tests } => {
            for (i, case) in tests.iter().enumerate() {
                let outcome = runner.run_case(case);
                verdicts.push(check_case(config, i, case, &outcome, false));
            }
        }
        Goal::Output { tests } => {
            for (i, case) in tests.iter().enumerate() {
                let outcome = runner.run_case(case);
                verdicts.push(check_case(config, i, case, &outcome, true));
            }
        }
        Goal::Scripted { judge, args } => {
            verdicts.extend(crate::judge::scripted::run(config, &runner, judge, args));
        }
    }

    let passed_count = verdicts.iter().filter(|v| v.passed).count();
    let total = verdicts.len().max(1);
    let passed = passed_count == verdicts.len() && !verdicts.is_empty();
    let score = (passed_count * 100 / total) as u32;
    let summary = if passed {
        format!("全部 {} 条测例通过", verdicts.len())
    } else if let Some(first) = verdicts.iter().find(|v| !v.passed) {
        format!(
            "{}（测例 {}：{}）",
            first.detail,
            first.name,
            first
                .diffs
                .first()
                .map(|d| format!("{} 应为 {}，实际 {}", d.what, d.expected, d.actual))
                .unwrap_or_else(|| "细节见下方".to_string())
        )
    } else {
        "没有测例可判定".to_string()
    };

    Verdict {
        level: config.level.clone(),
        passed,
        score,
        summary,
        tests: verdicts,
        errors: Vec::new(),
        generated_assembly: generated,
    }
}

/// 判定单条测例。`output_only` 为真时只比输出与退出码。
pub fn check_case(
    config: &LevelConfig,
    index: usize,
    case: &TestCase,
    outcome: &CaseOutcome,
    output_only: bool,
) -> TestVerdict {
    let name = if case.name.is_empty() {
        format!("测例 {}", index + 1)
    } else {
        case.name.clone()
    };
    let mut diffs = Vec::new();
    let mut reason = FailureReason::Register;

    let site = |reason: FailureReason| FailureSite {
        case_index: index,
        pc: outcome.state.pc,
        line: 0,
        regs: outcome.state.regs.clone(),
        reason,
    };

    // 1) 运行是否出错
    if outcome.state.pause_kind == "error" {
        let detail = outcome
            .state
            .pause_detail
            .clone()
            .unwrap_or_else(|| "运行时错误".to_string());
        return failed(name, detail, diffs, site(FailureReason::Runtime), outcome);
    }
    if outcome.state.pause_kind == "limit" {
        return failed(
            name,
            "程序执行指令数超过上限（可能是死循环，检查循环的退出条件）".to_string(),
            diffs,
            site(FailureReason::Limit),
            outcome,
        );
    }

    // 2) 输出文本
    if let Some(expected) = &case.output_text {
        let actual = &outcome.state.output;
        if !text_matches(expected, actual) {
            diffs.push(Diff {
                what: "输出".to_string(),
                expected: show_text(expected),
                actual: show_text(actual),
            });
            reason = FailureReason::Output;
        }
    }

    // 3) 退出码
    if let Some(want) = case.expected_exit {
        let got = outcome.state.exit_code.unwrap_or(-1) as i64;
        if got != want {
            diffs.push(Diff {
                what: "退出码".to_string(),
                expected: want.to_string(),
                actual: got.to_string(),
            });
            if reason == FailureReason::Register {
                reason = FailureReason::ExitCode;
            }
        }
    }

    // 4) 返回值（函数模式）
    if let Some(want) = case.expected_ret {
        match outcome.ret {
            Some(got) => {
                if got as i64 != want {
                    diffs.push(Diff {
                        what: "返回值".to_string(),
                        expected: want.to_string(),
                        actual: got.to_string(),
                    });
                    if reason == FailureReason::Register {
                        reason = FailureReason::Return;
                    }
                }
            }
            None => {
                diffs.push(Diff {
                    what: "返回值".to_string(),
                    expected: want.to_string(),
                    actual: "（没有拿到返回值）".to_string(),
                });
                reason = FailureReason::MissingFunction;
            }
        }
    }

    if !output_only {
        // 5) 寄存器（测例里允许写 `sp`、`a0` 这类别名，这里统一按 xN 查）
        //
        // 寄存器是 32 位无符号存储、按有符号解释 —— 所以 `got` 必须先经过 `as i32`，
        // 否则 -93 会被当成 4294967203。
        for (reg, want) in &case.expected_regs {
            let key = normalize_reg(reg).unwrap_or_else(|| reg.clone());
            let Some(got) = outcome
                .state
                .regs
                .get(&key)
                .or_else(|| outcome.state.regs.get(reg))
                .copied()
            else {
                continue;
            };
            let got_signed = got as i32 as i64;
            if got_signed != *want {
                diffs.push(Diff {
                    what: format!("寄存器 {}", key),
                    expected: format!("{}（{}）", want, hex32(*want as i32)),
                    actual: format!("{}（{}）", got_signed, hex32(got as i32)),
                });
                reason = FailureReason::Register;
            }
        }

        // 6) 内存
        for (addr, want) in &case.expected_memory {
            if let Some(diff) = check_memory(&outcome.state, *addr, want) {
                diffs.push(diff);
                if reason == FailureReason::Register {
                    reason = FailureReason::Memory;
                }
            }
        }
    }

    if diffs.is_empty() {
        TestVerdict {
            name,
            passed: true,
            detail: "通过".to_string(),
            diffs,
            failure_site: None,
            actual_output: if outcome.state.output.is_empty() {
                None
            } else {
                Some(outcome.state.output.clone())
            },
        }
    } else {
        let detail = format!(
            "{}：{}",
            reason.describe(),
            diffs
                .iter()
                .map(|d| format!("{} 应为 {}，实际 {}", d.what, d.expected, d.actual))
                .collect::<Vec<_>>()
                .join("；")
        );
        // 补上失败行号（能查到就给）
        let mut s = site(reason);
        s.line = 0;
        let _ = &config;
        failed(name, detail, diffs, s, outcome)
    }
}

fn failed(
    name: String,
    detail: String,
    diffs: Vec<Diff>,
    site: FailureSite,
    outcome: &CaseOutcome,
) -> TestVerdict {
    TestVerdict {
        name,
        passed: false,
        detail,
        diffs,
        failure_site: Some(site),
        actual_output: if outcome.state.output.is_empty() {
            None
        } else {
            Some(outcome.state.output.clone())
        },
    }
}

/// 规范化文本后比对。
///
/// 规范化 = 按行拆分 → 去掉每行首尾空白 → 丢掉空行 → 逐行完全一致。
pub fn text_matches(expected: &str, actual: &str) -> bool {
    normalize_text(expected) == normalize_text(actual)
}

fn normalize_text(text: &str) -> Vec<String> {
    text.replace("\r\n", "\n")
        .replace('\r', "\n")
        .split('\n')
        .map(|l| l.trim().to_string())
        .filter(|l| !l.is_empty())
        .collect()
}

fn show_text(text: &str) -> String {
    let lines = normalize_text(text);
    if lines.is_empty() {
        return "（空）".to_string();
    }
    if lines.len() == 1 {
        return format!("{:?}", lines[0]);
    }
    lines.join(" / ")
}

fn hex32(v: i32) -> String {
    format!("0x{:08X}", v as u32)
}

/// 比对一处内存。
fn check_memory(state: &MachineState, addr: u32, want: &MemExpect) -> Option<Diff> {
    match want {
        MemExpect::Word(v) => {
            let got = read_word(&state.memory, addr) as i32 as i64;
            if got != *v {
                Some(Diff {
                    what: format!("内存 0x{:X}", addr),
                    expected: format!("{}（{}）", v, hex32(*v as i32)),
                    actual: format!("{}（{}）", got, hex32(got as i32)),
                })
            } else {
                None
            }
        }
        MemExpect::Words(values) => {
            let mut mismatches = Vec::new();
            for (i, want) in values.iter().enumerate() {
                let a = addr + i as u32 * 4;
                let got = read_word(&state.memory, a) as i32 as i64;
                if got != *want {
                    mismatches.push(format!(
                        "[{}]@0x{:X}: 期望 {} 实际 {}",
                        i, a, want, got
                    ));
                }
            }
            if mismatches.is_empty() {
                None
            } else {
                Some(Diff {
                    what: format!("内存 0x{:X} 起的数组", addr),
                    expected: want.describe(),
                    actual: mismatches.join("；"),
                })
            }
        }
        MemExpect::String(s) => {
            let got = read_cstr(&state.memory, addr, 4096);
            if got != *s {
                Some(Diff {
                    what: format!("内存 0x{:X} 处的字符串", addr),
                    expected: format!("{:?}", s),
                    actual: format!("{:?}", got),
                })
            } else {
                None
            }
        }
    }
}

fn read_word(mem: &BTreeMap<u32, u8>, addr: u32) -> u32 {
    let b = |i: u32| mem.get(&(addr + i)).copied().unwrap_or(0) as u32;
    b(0) | (b(1) << 8) | (b(2) << 16) | (b(3) << 24)
}

fn read_cstr(mem: &BTreeMap<u32, u8>, addr: u32, max: u32) -> String {
    let mut out = Vec::new();
    for i in 0..max {
        let b = mem.get(&(addr + i)).copied().unwrap_or(0);
        if b == 0 {
            break;
        }
        out.push(b);
    }
    String::from_utf8_lossy(&out).to_string()
}

/// 把寄存器名统一成 `x0`..`x31`（测例里允许写 `sp`、`a0` 这类别名）。
pub fn normalize_reg(name: &str) -> Option<String> {
    riscv_simulator::reg_index(name).map(reg_name)
}

/// 星咒关卡：给出编译产物里的所有函数名（供报错提示）。
pub fn describe_language(lang: Language) -> &'static str {
    match lang {
        Language::Asm => "星之语（汇编）",
        Language::C => "星咒（C 子集）",
    }
}

/// Judge 子模块（内置判定程序）。
pub mod scripted;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn text_comparison_ignores_indentation_and_blank_lines() {
        assert!(text_matches("a\nb", "  a  \n\n b\n"));
        assert!(!text_matches("a\nb", "a\nb\nc"));
        assert!(!text_matches("1 2 3", "1 2"));
        assert!(text_matches("", "\n\n"));
    }

    #[test]
    fn register_aliases_are_normalized() {
        assert_eq!(normalize_reg("sp").as_deref(), Some("x2"));
        assert_eq!(normalize_reg("a0").as_deref(), Some("x10"));
        assert_eq!(normalize_reg("x31").as_deref(), Some("x31"));
        assert_eq!(normalize_reg("nope"), None);
    }

    #[test]
    fn passing_static_case() {
        let cfg = LevelConfig::parse(
            r#"{"level":"t","availableOps":[],"forbiddenRegs":[],
                "goal":{"type":"static","tests":[
                  {"name":"加法","initial":{"regs":{"x1":3,"x2":4}},
                   "expected":{"regs":{"x3":7}}}]}}"#,
        )
        .unwrap();
        let v = judge(&cfg, "add x3, x1, x2\nli a7, 0\necall\n");
        if let Some(site) = v.tests.first().and_then(|t| t.failure_site.as_ref()) {
            eprintln!("DEBUG x1={:?} x2={:?} x3={:?}", site.regs.get("x1"), site.regs.get("x2"), site.regs.get("x3"));
        }
        assert!(v.passed, "{}", v.summary);
        assert_eq!(v.score, 100);
        assert_eq!(v.tests.len(), 1);
    }

    #[test]
    fn failing_static_case_reports_the_diff() {
        let cfg = LevelConfig::parse(
            r#"{"level":"t","availableOps":[],"forbiddenRegs":[],
                "goal":{"type":"static","tests":[
                  {"name":"加法","initial":{"regs":{"x1":3,"x2":4}},
                   "expected":{"regs":{"x3":7}}}]}}"#,
        )
        .unwrap();
        let v = judge(&cfg, "add x3, x1, x1\nli a7, 0\necall\n");
        assert!(!v.passed);
        assert_eq!(v.score, 0);
        let t = &v.tests[0];
        assert!(!t.passed);
        assert_eq!(t.diffs.len(), 1);
        assert_eq!(t.diffs[0].expected, "7（0x00000007）");
        assert_eq!(t.diffs[0].actual, "6（0x00000006）");
        assert!(t.failure_site.is_some());
    }

    #[test]
    fn runtime_error_is_reported_as_runtime_failure() {
        let cfg = LevelConfig::parse(
            r#"{"level":"t","availableOps":[],"forbiddenRegs":[],
                "goal":{"type":"static","tests":[{"expected":{"regs":{"x3":1}}}]}}"#,
        )
        .unwrap();
        // 读一个野地址 → 段错误
        let v = judge(&cfg, "li x1, 0x7FFFFFF0\nlw x3, 0(x1)\n");
        assert!(!v.passed);
        assert_eq!(
            v.tests[0].failure_site.as_ref().unwrap().reason,
            FailureReason::Runtime
        );
    }

    #[test]
    fn output_mismatch_is_reported() {
        let cfg = LevelConfig::parse(
            r#"{"level":"t","availableOps":[],"forbiddenRegs":[],
                "goal":{"type":"output","tests":[{"output":{"text":"Hi"}}]}}"#,
        )
        .unwrap();
        let v = judge(
            &cfg,
            "li t0, 0xF0000000\nli t1, 72\nsw t1, 0(t0)\nli a7, 0\necall\n",
        );
        assert!(!v.passed);
        assert_eq!(v.tests[0].failure_site.as_ref().unwrap().reason, FailureReason::Output);
        assert!(v.tests[0].detail.contains("Hi"), "{}", v.tests[0].detail);
    }

    #[test]
    fn memory_mismatch_is_reported() {
        let cfg = LevelConfig::parse(
            r#"{"level":"t","availableOps":[],"forbiddenRegs":[],
                "goal":{"type":"static","tests":[{"expected":{"0x1000":42}}]}}"#,
        )
        .unwrap();
        let v = judge(&cfg, "li a7, 0\necall\n");
        assert!(!v.passed);
        assert!(v.tests[0].detail.contains("内存"), "{}", v.tests[0].detail);
    }

    #[test]
    fn c_level_end_to_end() {
        let cfg = LevelConfig::parse(
            r#"{"level":"2-3","language":"c","availableOps":[],"forbiddenRegs":[],
                "goal":{"type":"static","tests":[
                  {"name":"n=5","call":{"fn":"solve","args":[5]},"expected":{"ret":15}},
                  {"name":"n=0","call":{"fn":"solve","args":[0]},"expected":{"ret":0}}]}}"#,
        )
        .unwrap();
        let code = "int solve(int n) { int s = 0; for (int i = 1; i <= n; i++) s += i; return s; }";
        let v = judge(&cfg, code);
        assert!(v.passed, "{}", v.summary);
        assert!(v.generated_assembly.as_deref().unwrap().contains("solve:"));
    }
}
