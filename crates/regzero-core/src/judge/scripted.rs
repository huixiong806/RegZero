//! 内置 Judge（"特殊判定"程序）。
//!
//! 有些关卡没法用固定测例判定 —— 比如"排序任意数组"、"求值任意表达式"。
//! 这类关卡在测例 JSON 里写 `"goal": { "type": "scripted", "judge": "名字", ... }`，
//! 由这里注册的 Rust 函数动态生成输入、检查输出。
//!
//! 这样做的代价是 Judge 不能由关卡作者随时新增（要改代码），
//! 好处是**不需要额外进程、不需要另写 EXE、可以直接单元测试**，
//! 对一个纯离线教学游戏来说是划算的。

use crate::config::LevelConfig;
use crate::judge::{Diff, FailureReason, FailureSite, TestVerdict};
use crate::runner::{push_input, Runner};
use riscv_simulator::{PauseOn, Simulator};
use serde_json::Value;

/// 一个 Judge 的入口。
type JudgeFn = fn(&LevelConfig, &Runner, &Value) -> Vec<TestVerdict>;

/// Judge 注册表。
pub const JUDGES: &[(&str, JudgeFn)] = &[
    ("sort_check", sort_check),
    ("brackets_check", brackets_check),
    ("expr_check", expr_check),
    ("compile_and_run", compile_and_run),
];

/// 按名字跑一个 Judge。
pub fn run(config: &LevelConfig, runner: &Runner, name: &str, args: &Value) -> Vec<TestVerdict> {
    match JUDGES.iter().find(|(n, _)| *n == name) {
        Some((_, f)) => f(config, runner, args),
        None => vec![TestVerdict {
            name: name.to_string(),
            passed: false,
            detail: format!("本关指定了一个不存在的判定程序 `{}`（可用的是 {:?}）", name, names()),
            diffs: Vec::new(),
            failure_site: None,
            actual_output: None,
        }],
    }
}

/// 全部已注册的 Judge 名字。
pub fn names() -> Vec<&'static str> {
    JUDGES.iter().map(|(n, _)| *n).collect()
}

// ─────────────────────────────────────────────────────────────────────────────
//  小工具
// ─────────────────────────────────────────────────────────────────────────────

/// 线性同余伪随机数（不用外部依赖，保证可复现）。
struct Rng(u64);

impl Rng {
    fn new(seed: u64) -> Self {
        Self(seed.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407) | 1)
    }
    fn next(&mut self) -> u64 {
        self.0 = self.0.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
        self.0 >> 17
    }
    fn range(&mut self, lo: i64, hi: i64) -> i64 {
        if hi <= lo {
            return lo;
        }
        lo + (self.next() % ((hi - lo + 1) as u64)) as i64
    }
}

fn arg_i64(args: &Value, key: &str, default: i64) -> i64 {
    args.get(key).and_then(|v| v.as_i64()).unwrap_or(default)
}

fn pass(name: impl Into<String>, actual_output: Option<String>) -> TestVerdict {
    TestVerdict {
        name: name.into(),
        passed: true,
        detail: "通过".to_string(),
        diffs: Vec::new(),
        failure_site: None,
        actual_output,
    }
}

fn fail(name: impl Into<String>, what: &str, expected: String, actual: String, reason: FailureReason) -> TestVerdict {
    TestVerdict {
        name: name.into(),
        passed: false,
        detail: format!("{}：{} 应为 {}，实际 {}", reason.describe(), what, expected, actual),
        diffs: vec![Diff { what: what.to_string(), expected, actual }],
        failure_site: Some(FailureSite {
            case_index: 0,
            pc: 0,
            line: 0,
            regs: Default::default(),
            reason,
        }),
        actual_output: None,
    }
}

/// 直接把输入灌进模拟器并跑完（绕过测例机制，Judge 自己控制输入）。
fn run_program(config: &LevelConfig, runner: &Runner, input: &str) -> crate::runner::MachineState {
    let mut cfg = SimulatorConfigFor(config, runner);
    cfg.pause_on = PauseOn::batch();
    let mut sim = Simulator::new();
    sim.configure(cfg);
    runner.assembly.apply_to(&mut sim).expect("装载失败");
    push_input(&mut sim, input);
    let r = sim.run().expect("运行失败");
    crate::runner::MachineState {
        regs: sim.get_all_regs().into_iter().collect(),
        zero_regs: Default::default(),
        pc: sim.get_pc(),
        instructions: r.instructions_executed,
        memory: sim.get_memory_snapshot().into_iter().collect(),
        output: r.text_output.clone(),
        exit_code: r.exit_code,
        pause_kind: r.reason.kind().to_string(),
        pause_detail: Some(r.reason.describe()),
    }
}

/// 把 Runner 的配置变成一份模拟器配置（Judge 用）。
#[allow(non_snake_case)]
fn SimulatorConfigFor(config: &LevelConfig, runner: &Runner) -> riscv_simulator::SimulatorConfig {
    let mut cfg = riscv_simulator::SimulatorConfig::new();
    cfg.max_instructions = config.max_instructions.max(1_000_000);
    cfg.initial_regs.insert("sp".to_string(), crate::runner::DEFAULT_STACK_TOP);
    for (addr, byte) in runner.assembly.initial_memory() {
        cfg.initial_memory.insert(addr, byte);
    }
    cfg
}

/// 解析程序输出里的十进制整数（按空白与换行分隔）。
fn parse_ints(text: &str) -> Vec<i64> {
    text.split(|c: char| !(c.is_ascii_digit() || c == '-'))
        .filter(|s| !s.is_empty() && *s != "-")
        .filter_map(|s| s.parse::<i64>().ok())
        .collect()
}

// ─────────────────────────────────────────────────────────────────────────────
//  sort_check：随机数组 → 玩家排序 → 校验
// ─────────────────────────────────────────────────────────────────────────────

/// 程序模式：内存在 `judgeArgs.memoryBase`（默认 `0x2000`）处放 `arraySize` 个整数，
/// 程序要把它原地升序排好，然后输出排序后的元素（十进制，空格分隔）。
fn sort_check(config: &LevelConfig, runner: &Runner, args: &Value) -> Vec<TestVerdict> {
    let size = arg_i64(args, "arraySize", 8) as usize;
    let max_value = arg_i64(args, "maxValue", 99);
    let base = arg_i64(args, "memoryBase", 0x2000) as u32;
    let rounds = arg_i64(args, "rounds", 4).max(1) as usize;
    let seed = arg_i64(args, "seed", 12345) as u64;

    let mut rng = Rng::new(seed);
    let mut out = Vec::new();
    for round in 0..rounds {
        let data: Vec<i64> = (0..size).map(|_| rng.range(0, max_value)).collect();
        let mut expected = data.clone();
        expected.sort();

        let mut sim = Simulator::new();
        let mut cfg = SimulatorConfigFor(config, runner);
        cfg.pause_on = PauseOn::batch();
        for (i, v) in data.iter().enumerate() {
            for (j, b) in (*v as i32).to_le_bytes().iter().enumerate() {
                cfg.initial_memory.insert(base + (i * 4 + j) as u32, *b);
            }
        }
        sim.configure(cfg);
        runner.assembly.apply_to(&mut sim).expect("装载失败");
        let r = sim.run().expect("运行失败");

        let name = format!("随机数组 #{}（{} 个元素）", round + 1, size);
        if r.reason.kind() == "error" {
            out.push(fail(
                name,
                "运行",
                "正常结束".to_string(),
                r.reason.describe(),
                FailureReason::Runtime,
            ));
            continue;
        }
        // 校验内存里被排好序
        let mut ok = true;
        for (i, want) in expected.iter().enumerate() {
            let addr = base + i as u32 * 4;
            let got = sim.get_mem(addr, 4);
            let got = i32::from_le_bytes([got[0], got[1], got[2], got[3]]);
            if got as i64 != *want {
                out.push(fail(
                    name.clone(),
                    &format!("排序后第 {} 个数", i),
                    want.to_string(),
                    got.to_string(),
                    FailureReason::Memory,
                ));
                ok = false;
                break;
            }
        }
        if ok {
            out.push(pass(name.clone(), Some(r.text_output.clone())));
        }
    }
    out
}

// ─────────────────────────────────────────────────────────────────────────────
//  brackets_check：随机括号串 → 玩家判断是否匹配
// ─────────────────────────────────────────────────────────────────────────────

/// 程序模式：输入是若干行括号串，每行输出 `1`（匹配）或 `0`（不匹配）。
fn brackets_check(config: &LevelConfig, runner: &Runner, args: &Value) -> Vec<TestVerdict> {
    let rounds = arg_i64(args, "rounds", 6).max(1) as usize;
    let max_len = arg_i64(args, "maxLen", 12).max(2) as usize;
    let seed = arg_i64(args, "seed", 999) as u64;
    let mut rng = Rng::new(seed);
    let mut out = Vec::new();

    for round in 0..rounds {
        let len = rng.range(2, max_len as i64) as usize;
        let mut s = String::new();
        for _ in 0..len {
            s.push(match rng.range(0, 3) {
                0 => '(',
                1 => ')',
                2 => '[',
                _ => ']',
            });
        }
        let expected = if is_balanced(&s) { "1" } else { "0" };
        let input = format!("{}\n", s);
        let state = run_program(config, runner, &input);
        let name = format!("括号串 #{}：{}", round + 1, s);
        if state.pause_kind == "error" {
            out.push(fail(name, "运行", "正常结束".into(), state.pause_detail.clone().unwrap_or_default(), FailureReason::Runtime));
            continue;
        }
        let got = state.output.trim();
        if crate::judge::text_matches(expected, got) {
            out.push(pass(name, Some(state.output.clone())));
        } else {
            out.push(fail(name, "判断结果", expected.to_string(), got.to_string(), FailureReason::Output));
        }
    }
    out
}

fn is_balanced(s: &str) -> bool {
    let mut stack = Vec::new();
    for c in s.chars() {
        match c {
            '(' | '[' => stack.push(c),
            ')' => {
                if stack.pop() != Some('(') {
                    return false;
                }
            }
            ']' => {
                if stack.pop() != Some('[') {
                    return false;
                }
            }
            _ => {}
        }
    }
    stack.is_empty()
}

// ─────────────────────────────────────────────────────────────────────────────
//  expr_check：随机表达式 → 参考实现求值 → 比对玩家输出
// ─────────────────────────────────────────────────────────────────────────────

/// 程序模式：输入若干行表达式（`+ - *` 与括号、非负整数），每行输出一个整数结果。
fn expr_check(config: &LevelConfig, runner: &Runner, args: &Value) -> Vec<TestVerdict> {
    let rounds = arg_i64(args, "rounds", 6).max(1) as usize;
    let max_value = arg_i64(args, "maxValue", 20).max(1);
    let max_operands = arg_i64(args, "maxOperands", 5).max(2) as usize;
    let seed = arg_i64(args, "seed", 4242) as u64;
    let mut rng = Rng::new(seed);
    let mut out = Vec::new();

    for round in 0..rounds {
        let n = rng.range(2, max_operands as i64) as usize;
        let mut expr = String::new();
        let mut values = Vec::new();
        for i in 0..n {
            let v = rng.range(0, max_value);
            values.push(v);
            if i > 0 {
                expr.push(match rng.range(0, 2) {
                    0 => '+',
                    1 => '-',
                    _ => '*',
                });
            }
            // 偶尔加个括号
            if rng.range(0, 3) == 0 && i > 0 && i + 1 < n {
                expr.insert(expr.len().saturating_sub(1).max(0), '(');
                expr.push_str(&format!("{})", v));
            } else {
                expr.push_str(&v.to_string());
            }
        }
        // 用 Rust 侧的参考求值器算答案
        let Ok(expected) = eval_expression(&expr) else {
            continue;
        };
        let input = format!("{}\n", expr);
        let state = run_program(config, runner, &input);
        let name = format!("表达式 #{}：{}", round + 1, expr);
        if state.pause_kind == "error" {
            out.push(fail(name, "运行", "正常结束".into(), state.pause_detail.clone().unwrap_or_default(), FailureReason::Runtime));
            continue;
        }
        let got = parse_ints(&state.output);
        match got.first() {
            Some(v) if *v == expected => out.push(pass(name, Some(state.output.clone()))),
            Some(v) => out.push(fail(name, "表达式的值", expected.to_string(), v.to_string(), FailureReason::Output)),
            None => out.push(fail(name, "输出", expected.to_string(), "（没有输出数字）".to_string(), FailureReason::Output)),
        }
    }
    out
}

/// Judge 自己的参考求值器（只支持 `+ - * 括号` 与非负整数）。
pub fn eval_expression(text: &str) -> Result<i64, String> {
    let bytes: Vec<char> = text.chars().filter(|c| !c.is_whitespace()).collect();
    let mut pos = 0usize;
    let v = parse_expr_ref(&bytes, &mut pos)?;
    if pos != bytes.len() {
        return Err(format!("表达式 `{}` 有剩余字符", text));
    }
    Ok(v)
}

fn parse_expr_ref(s: &[char], pos: &mut usize) -> Result<i64, String> {
    let mut acc = parse_term_ref(s, pos)?;
    while *pos < s.len() && (s[*pos] == '+' || s[*pos] == '-') {
        let op = s[*pos];
        *pos += 1;
        let rhs = parse_term_ref(s, pos)?;
        acc = if op == '+' { acc + rhs } else { acc - rhs };
    }
    Ok(acc)
}

fn parse_term_ref(s: &[char], pos: &mut usize) -> Result<i64, String> {
    let mut acc = parse_atom_ref(s, pos)?;
    while *pos < s.len() && s[*pos] == '*' {
        *pos += 1;
        acc *= parse_atom_ref(s, pos)?;
    }
    Ok(acc)
}

fn parse_atom_ref(s: &[char], pos: &mut usize) -> Result<i64, String> {
    if *pos >= s.len() {
        return Err("表达式提前结束".into());
    }
    if s[*pos] == '(' {
        *pos += 1;
        let v = parse_expr_ref(s, pos)?;
        if *pos >= s.len() || s[*pos] != ')' {
            return Err("括号不匹配".into());
        }
        *pos += 1;
        return Ok(v);
    }
    let mut n = 0i64;
    let start = *pos;
    while *pos < s.len() && s[*pos].is_ascii_digit() {
        n = n * 10 + (s[*pos] as u8 - b'0') as i64;
        *pos += 1;
    }
    if *pos == start {
        return Err(format!("`{}` 不是数字", s[*pos]));
    }
    Ok(n)
}

// ─────────────────────────────────────────────────────────────────────────────
//  compile_and_run：把玩家"编译器"的输出真正跑起来
// ─────────────────────────────────────────────────────────────────────────────

/// 玩家提交的是一个编译器（程序模式）：读星咒源码，输出星之语汇编。
/// 这里把它的输出交给本项目的汇编器 + 模拟器实际执行，验证语义正确。
///
/// `judgeArgs`：
/// - `program`：要喂给玩家编译器的星咒源码
/// - `args`：调用目标函数时的参数
/// - `expectedRet`：期望的返回值
fn compile_and_run(config: &LevelConfig, runner: &Runner, args: &Value) -> Vec<TestVerdict> {
    let program = match args.get("program").and_then(|v| v.as_str()) {
        Some(p) => p,
        None => {
            return vec![fail(
                "编译并运行",
                "关卡配置",
                "judgeArgs.program（要编译的星咒源码）".to_string(),
                "（缺失）".to_string(),
                FailureReason::Compile,
            )]
        }
    };
    let call_args: Vec<i64> = args
        .get("args")
        .and_then(|v| v.as_array())
        .map(|a| a.iter().filter_map(|x| x.as_i64()).collect())
        .unwrap_or_default();
    let fn_name = args.get("fn").and_then(|v| v.as_str()).unwrap_or("solve");
    let want_ret = args.get("expectedRet").and_then(|v| v.as_i64());

    // 1) 让玩家的编译器跑一遍，拿到它输出的汇编
    let state = run_program(config, runner, program);
    if state.pause_kind == "error" {
        return vec![fail(
            "编译并运行",
            "玩家编译器的运行",
            "正常结束".to_string(),
            state.pause_detail.clone().unwrap_or_default(),
            FailureReason::Runtime,
        )];
    }
    let produced = state.output.clone();
    if produced.trim().is_empty() {
        return vec![fail(
            "编译并运行",
            "编译器输出",
            "一段星之语汇编".to_string(),
            "（没有任何输出）".to_string(),
            FailureReason::Output,
        )];
    }

    // 2) 把输出交给汇编器
    let Ok(asm) = riscv_assembler::assemble(&produced) else {
        return vec![fail(
            "编译并运行",
            "汇编器能否接受编译器输出",
            "可以汇编".to_string(),
            "汇编失败（输出的不是合法星之语）".to_string(),
            FailureReason::Compile,
        )];
    };

    // 3) 真正跑一遍，检查返回值
    if let Some(want) = want_ret {
        let Some(&target) = asm.symbols.get(fn_name) else {
            return vec![fail(
                "编译并运行",
                &format!("编译结果里是否有函数 `{}`", fn_name),
                "有".to_string(),
                format!("没有（只有 {:?}）", asm.symbols.keys().collect::<Vec<_>>()),
                FailureReason::MissingFunction,
            )];
        };
        let mut cfg = asm.base_config(riscv_simulator::SimulatorConfig::new());
        cfg.pause_on = PauseOn::batch();
        cfg.max_instructions = 1_000_000;
        cfg.initial_regs.insert("sp".to_string(), crate::runner::DEFAULT_STACK_TOP);
        let mut sim = Simulator::new();
        sim.configure(cfg);
        asm.apply_to(&mut sim).expect("装载失败");
        let boot_src = {
            let mut s = String::from(".text\n");
            for (i, a) in call_args.iter().enumerate() {
                s.push_str(&format!("li a{}, {}\n", i, *a as i32));
            }
            s.push_str(&format!("li t5, {}\njalr ra, t5, 0\nli a7, 0\necall\n", target));
            s
        };
        let boot = riscv_assembler::assemble_with(
            &boot_src,
            &riscv_assembler::Options { base_addr: crate::runner::BOOT_ADDR, ..Default::default() },
        )
        .expect("引导代码汇编失败");
        sim.load_binary_at(crate::runner::BOOT_ADDR, &boot.words).expect("装载失败");
        sim.set_pc(crate::runner::BOOT_ADDR);
        let r = sim.run().expect("运行失败");
        if r.reason.kind() == "error" {
            return vec![fail(
                "编译并运行",
                "编译产物能否正常运行",
                "正常结束".to_string(),
                r.reason.describe(),
                FailureReason::Runtime,
            )];
        }
        let got = sim.get_reg("a0").unwrap_or(0) as i32 as i64;
        if got != want {
            return vec![fail(
                "编译并运行",
                &format!("{}({}) 的返回值", fn_name, call_args.iter().map(|a| a.to_string()).collect::<Vec<_>>().join(", ")),
                want.to_string(),
                got.to_string(),
                FailureReason::Return,
            )];
        }
    }

    vec![pass("编译并运行（结果一致）", Some(produced))]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reference_evaluator_works() {
        assert_eq!(eval_expression("1+2*3").unwrap(), 7);
        assert_eq!(eval_expression("(1+2)*3").unwrap(), 9);
        assert_eq!(eval_expression("10-2-3").unwrap(), 5);
        assert_eq!(eval_expression("2*3+4*5").unwrap(), 26);
        assert!(eval_expression("1+*2").is_err());
    }

    #[test]
    fn bracket_matching_reference() {
        assert!(is_balanced("()"));
        assert!(is_balanced("([()])"));
        assert!(!is_balanced("([)]"));
        assert!(!is_balanced("(("));
        assert!(!is_balanced(")("));
    }

    #[test]
    fn rng_is_deterministic() {
        let mut a = Rng::new(42);
        let mut b = Rng::new(42);
        for _ in 0..10 {
            assert_eq!(a.range(0, 100), b.range(0, 100));
        }
    }

    #[test]
    fn judge_registry_has_the_documented_names() {
        let names = names();
        for expected in ["sort_check", "brackets_check", "expr_check", "compile_and_run"] {
            assert!(names.contains(&expected), "缺少 judge `{}`", expected);
        }
    }

    #[test]
    fn int_parsing_handles_separators() {
        assert_eq!(parse_ints("1 2\n3"), vec![1, 2, 3]);
        assert_eq!(parse_ints("-5, 7"), vec![-5, 7]);
        assert_eq!(parse_ints("没有数字"), Vec::<i64>::new());
    }
}
