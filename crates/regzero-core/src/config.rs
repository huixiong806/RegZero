//! 关卡配置：解析 `compiler-content/src/tests/*.json`。
//!
//! 关卡作者怎么写测例，见 `documents/关卡编写规范.md`。这里尽量**宽容**：
//! 内存与寄存器的几种写法都接受，缺失字段用合理的默认值。

use serde_json::Value;
use std::collections::BTreeMap;

/// 关卡用的源语言。
///
/// 序列化成 `"asm"` / `"c"`（前端与关卡页 JSON 里都这么写）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Language {
    /// 星之语（汇编）
    #[default]
    Asm,
    /// 星咒（C 子集）
    C,
}

impl Language {
    pub fn parse(s: &str) -> Option<Self> {
        match s.to_ascii_lowercase().as_str() {
            "asm" | "asm-riscv" => Some(Language::Asm),
            "c" | "starlang" => Some(Language::C),
            _ => None,
        }
    }
}

/// 内存里的一个"值"。
///
/// **数组语义**：`"0x2000": [5, 1, 9, 3]` 表示**四个 32 位整数**依次放在
/// `0x2000`、`0x2004`、`0x2008`、`0x200C`（每个占一个字）。这跟
/// `int a[4]` 在内存里的样子一致，也是关卡作者最自然的写法。
/// 要放真正的字节序列请用 `{"string": "..."}` 或一个一个写 `"0x2000": 65`。
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MemExpect {
    /// 一个 32 位字
    Word(i64),
    /// 一串 32 位整数（每个占 4 字节）
    Words(Vec<i64>),
    /// 从该地址起的一个 C 字符串（含结尾的 0）
    String(String),
}

impl MemExpect {
    /// 展开成 (相对偏移, 字节) 列表。
    pub fn bytes(&self) -> Vec<(u32, u8)> {
        let mut out = Vec::new();
        match self {
            MemExpect::Word(v) => {
                for (i, b) in (*v as i32).to_le_bytes().iter().enumerate() {
                    out.push((i as u32, *b));
                }
            }
            MemExpect::Words(values) => {
                for (n, v) in values.iter().enumerate() {
                    let base = n as u32 * 4;
                    for (i, b) in (*v as i32).to_le_bytes().iter().enumerate() {
                        out.push((base + i as u32, *b));
                    }
                }
            }
            MemExpect::String(s) => {
                for (i, b) in s.bytes().enumerate() {
                    out.push((i as u32, b));
                }
                out.push((s.len() as u32, 0));
            }
        }
        out
    }

    /// 这个值占多少字节。
    pub fn size(&self) -> u32 {
        match self {
            MemExpect::Word(_) => 4,
            MemExpect::Words(v) => v.len() as u32 * 4,
            MemExpect::String(s) => s.len() as u32 + 1,
        }
    }

    /// 面向玩家的描述（比对失败时展示）。
    pub fn describe(&self) -> String {
        match self {
            MemExpect::Word(v) => v.to_string(),
            MemExpect::Words(v) => {
                format!("{:?}", v.iter().map(|x| *x as i32).collect::<Vec<_>>())
            }
            MemExpect::String(s) => format!("{:?}", s),
        }
    }
}

/// 一条测例。
#[derive(Debug, Clone, Default)]
pub struct TestCase {
    pub name: String,
    /// 函数模式：`{ "fn": "solve", "args": [3, 7] }`
    pub call: Option<CallSpec>,
    /// 初始寄存器值
    pub initial_regs: BTreeMap<String, i64>,
    /// 初始内存（字 / 字符串 / 字节串）
    pub initial_memory: BTreeMap<u32, MemExpect>,
    /// 栈指针初值（默认 `0xF000`）
    pub initial_sp: Option<u32>,
    /// 输入字符流（来自测例的 `input.text`）
    pub input_text: String,
    /// 期望的输出字符流
    pub output_text: Option<String>,
    /// 期望的退出码
    pub expected_exit: Option<i64>,
    /// 期望的返回值（函数模式）
    pub expected_ret: Option<i64>,
    /// 期望的寄存器终值（只比对列出的）
    pub expected_regs: BTreeMap<String, i64>,
    /// 期望的内存终值（只比对列出的）
    pub expected_memory: BTreeMap<u32, MemExpect>,
    /// 是否关闭"每次 MMIO 写就暂停"（输出量大的关卡用）
    pub batch_output: bool,
    /// 单条测例的指令数上限覆盖
    pub max_instructions: Option<u64>,
}

/// 函数调用描述。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CallSpec {
    pub function: String,
    pub args: Vec<i64>,
}

/// 判定方式。
#[derive(Debug, Clone)]
pub enum Goal {
    /// 静态判定：逐条测例比对
    Static { tests: Vec<TestCase> },
    /// 只比对输出与退出码（不比对寄存器）
    Output { tests: Vec<TestCase> },
    /// 由内置 Judge 判定（随机/多轮）
    Scripted { judge: String, args: Value },
}

/// 一个关卡的完整判定配置。
#[derive(Debug, Clone)]
pub struct LevelConfig {
    /// 关卡 ID，如 `"1-5"`
    pub level: String,
    pub language: Language,
    /// 允许的指令助记符（空 = 全部允许）
    pub available_ops: Vec<String>,
    /// 禁止访问的寄存器
    pub forbidden_regs: Vec<String>,
    /// 单测例指令数上限
    pub max_instructions: u64,
    pub goal: Goal,
}

impl LevelConfig {
    /// 从 JSON 文本解析。
    pub fn parse(text: &str) -> Result<Self, String> {
        let v: Value = serde_json::from_str(text).map_err(|e| format!("测例 JSON 语法错误：{}", e))?;
        Self::from_json(&v, "（未知关卡）")
    }

    /// 从 JSON 值解析；`fallback_level` 是 JSON 里缺 `level` 时用的名字。
    pub fn from_json(v: &Value, fallback_level: &str) -> Result<Self, String> {
        let level = v
            .get("level")
            .and_then(|x| x.as_str())
            .unwrap_or(fallback_level)
            .to_string();

        let language = match v.get("language").and_then(|x| x.as_str()) {
            Some(s) => Language::parse(s)
                .ok_or_else(|| format!("关卡 {} 的 language 只能是 \"asm\" 或 \"c\"（写的是 {}）", level, s))?,
            None => Language::Asm,
        };

        let available_ops = string_list(v.get("availableOps"));
        let forbidden_regs = string_list(v.get("forbiddenRegs"));
        let max_instructions = v
            .get("maxInstructions")
            .and_then(|x| x.as_u64())
            .unwrap_or(100_000);

        let goal_v = v
            .get("goal")
            .ok_or_else(|| format!("关卡 {} 缺少 goal 字段", level))?;
        let goal_type = goal_v.get("type").and_then(|x| x.as_str()).unwrap_or("static");

        let top_initial = parse_state(v.get("initial")).map_err(|e| format!("关卡 {}：{}", level, e))?;
        let top_input = v.get("input").and_then(|x| x.get("text")).and_then(|x| x.as_str()).unwrap_or("").to_string();
        let top_output = v.get("output").and_then(|x| x.get("text")).and_then(|x| x.as_str()).map(|s| s.to_string());

        let goal = match goal_type {
            "static" | "output" => {
                let raw = goal_v
                    .get("tests")
                    .and_then(|x| x.as_array())
                    .ok_or_else(|| format!("关卡 {} 的 goal 缺少 tests 数组", level))?;
                if raw.is_empty() {
                    return Err(format!("关卡 {} 的 goal.tests 至少要有一条测例", level));
                }
                let mut tests = Vec::new();
                for (i, t) in raw.iter().enumerate() {
                    tests.push(parse_test_case(
                        t,
                        i,
                        &level,
                        &top_initial,
                        &top_input,
                        top_output.as_deref(),
                        max_instructions,
                    )?);
                }
                if goal_type == "static" {
                    Goal::Static { tests }
                } else {
                    Goal::Output { tests }
                }
            }
            "scripted" => {
                let judge = goal_v
                    .get("judge")
                    .and_then(|x| x.as_str())
                    .ok_or_else(|| format!("关卡 {} 的 scripted goal 缺少 judge 名字", level))?
                    .to_string();
                let args = goal_v.get("judgeArgs").cloned().unwrap_or(Value::Null);
                Goal::Scripted { judge, args }
            }
            other => {
                return Err(format!(
                    "关卡 {} 的 goal.type 只能是 static / output / scripted（写的是 {}）",
                    level, other
                ))
            }
        };

        Ok(Self { level, language, available_ops, forbidden_regs, max_instructions, goal })
    }

    /// 这个关卡的全部测例（scripted 关卡返回空）。
    pub fn tests(&self) -> &[TestCase] {
        match &self.goal {
            Goal::Static { tests } | Goal::Output { tests } => tests,
            Goal::Scripted { .. } => &[],
        }
    }

    /// 判定时是否先切到"程序初始状态"再比基线。
    pub fn is_output_only(&self) -> bool {
        matches!(self.goal, Goal::Output { .. })
    }
}

/// 顶层/测例共享的初始状态。
#[derive(Debug, Clone, Default)]
struct InitialState {
    regs: BTreeMap<String, i64>,
    memory: BTreeMap<u32, MemExpect>,
    sp: Option<u32>,
}

fn parse_state(v: Option<&Value>) -> Result<InitialState, String> {
    let mut st = InitialState::default();
    let Some(v) = v else { return Ok(st) };
    let obj = v.as_object().ok_or("initial 必须是一个对象")?;
    // 嵌套写法
    if let Some(regs) = obj.get("regs") {
        st.regs = parse_regs(Some(regs))?;
    }
    if let Some(mem) = obj.get("memory") {
        st.memory = parse_memory(Some(mem))?;
    }
    if let Some(sp) = obj.get("sp").and_then(|x| x.as_u64()) {
        st.sp = Some(sp as u32);
    }
    // 扁平写法：直接写在 initial 里
    for (k, val) in obj {
        if k == "regs" || k == "memory" || k == "sp" || k == "file" {
            continue;
        }
        if let Some(addr) = parse_addr(k) {
            st.memory.insert(addr, parse_mem_expect(val)?);
        } else if is_reg_name(k) {
            st.regs.insert(k.clone(), parse_int(val)?);
        }
    }
    Ok(st)
}

fn parse_test_case(
    v: &Value,
    index: usize,
    level: &str,
    top_initial: &InitialState,
    top_input: &str,
    top_output: Option<&str>,
    default_max: u64,
) -> Result<TestCase, String> {
    let name = v
        .get("name")
        .and_then(|x| x.as_str())
        .map(|s| s.to_string())
        .unwrap_or_else(|| format!("测例 {}", index + 1));

    let mut tc = TestCase {
        name,
        initial_regs: top_initial.regs.clone(),
        initial_memory: top_initial.memory.clone(),
        initial_sp: top_initial.sp,
        input_text: top_input.to_string(),
        output_text: top_output.map(|s| s.to_string()),
        batch_output: false,
        max_instructions: Some(default_max),
        ..Default::default()
    };

    if let Some(call) = v.get("call") {
        let function = call
            .get("fn")
            .or_else(|| call.get("function"))
            .and_then(|x| x.as_str())
            .ok_or_else(|| format!("关卡 {}：call 里要写 \"fn\": \"函数名\"", level))?
            .to_string();
        let args = call
            .get("args")
            .and_then(|x| x.as_array())
            .map(|a| a.iter().map(parse_int).collect::<Result<Vec<_>, _>>())
            .transpose()?
            .unwrap_or_default();
        tc.call = Some(CallSpec { function, args });
    }

    // 测例自己的 initial 覆盖顶层
    let own = parse_state(v.get("initial")).map_err(|e| format!("关卡 {} 的测例 {}：{}", level, tc.name, e))?;
    tc.initial_regs.extend(own.regs);
    tc.initial_memory.extend(own.memory);
    if own.sp.is_some() {
        tc.initial_sp = own.sp;
    }

    if let Some(t) = v.get("input").and_then(|x| x.get("text")).and_then(|x| x.as_str()) {
        tc.input_text = t.to_string();
    }
    if let Some(t) = v.get("output").and_then(|x| x.get("text")).and_then(|x| x.as_str()) {
        tc.output_text = Some(t.to_string());
    }
    if let Some(po) = v.get("pauseOn") {
        if po.get("mmio_write").and_then(|x| x.as_bool()) == Some(false) {
            tc.batch_output = true;
        }
    }
    if let Some(n) = v.get("maxInstructions").and_then(|x| x.as_u64()) {
        tc.max_instructions = Some(n);
    }

    let expected = parse_state(v.get("expected")).map_err(|e| format!("关卡 {} 的测例 {}：{}", level, tc.name, e))?;
    tc.expected_regs = expected.regs;
    tc.expected_memory = expected.memory;
    if let Some(ret) = v.get("expected").and_then(|x| x.get("ret")) {
        tc.expected_ret = Some(parse_int(ret)?);
    }
    if let Some(code) = v.get("expected").and_then(|x| x.get("exitCode")) {
        tc.expected_exit = Some(parse_int(code)?);
    }
    if let Some(code) = v.get("expectedExitCode") {
        tc.expected_exit = Some(parse_int(code)?);
    }

    Ok(tc)
}

fn parse_regs(v: Option<&Value>) -> Result<BTreeMap<String, i64>, String> {
    let mut out = BTreeMap::new();
    let Some(v) = v else { return Ok(out) };
    let obj = v.as_object().ok_or("regs 必须是一个对象")?;
    for (k, val) in obj {
        out.insert(k.clone(), parse_int(val)?);
    }
    Ok(out)
}

fn parse_memory(v: Option<&Value>) -> Result<BTreeMap<u32, MemExpect>, String> {
    let mut out = BTreeMap::new();
    let Some(v) = v else { return Ok(out) };
    let obj = v.as_object().ok_or("memory 必须是一个对象")?;
    for (k, val) in obj {
        let addr = parse_addr(k).ok_or_else(|| {
            format!("内存地址 `{}` 要写成 0x 开头的十六进制（例如 \"0x1000\"）", k)
        })?;
        out.insert(addr, parse_mem_expect(val)?);
    }
    Ok(out)
}

fn parse_mem_expect(v: &Value) -> Result<MemExpect, String> {
    if let Some(s) = v.get("string").and_then(|x| x.as_str()) {
        return Ok(MemExpect::String(s.to_string()));
    }
    if let Some(arr) = v.as_array() {
        let mut values = Vec::with_capacity(arr.len());
        for x in arr {
            let n = parse_int(x)?;
            if !(-(1 << 31)..(1 << 31)).contains(&n) {
                return Err(format!("内存数组里的值要在 32 位整数范围内（写的是 {}）", n));
            }
            values.push(n);
        }
        return Ok(MemExpect::Words(values));
    }
    Ok(MemExpect::Word(parse_int(v)?))
}

fn parse_int(v: &Value) -> Result<i64, String> {
    // 数值：能放进 i32 就按字面值；超出 i32 范围（如 4294967295）按
    // "32 位比特模式"解释成有符号数（4294967295 → -1）。
    if let Some(n) = v.as_i64() {
        if (i32::MIN as i64..=i32::MAX as i64).contains(&n) {
            return Ok(n);
        }
        return Ok(n as i32 as i64);
    }
    if let Some(n) = v.as_u64() {
        return Ok(n as i32 as i64);
    }
    if let Some(s) = v.as_str() {
        let s = s.trim();
        let (neg, body) = s.strip_prefix('-').map(|b| (true, b)).unwrap_or((false, s));
        let n = if let Some(hex) = body.strip_prefix("0x").or_else(|| body.strip_prefix("0X")) {
            i64::from_str_radix(hex, 16).map_err(|_| format!("`{}` 不是合法的十六进制数", s))?
        } else {
            body.parse::<i64>().map_err(|_| format!("`{}` 不是整数", s))?
        };
        return Ok(if neg { -n } else { n });
    }
    if let Some(b) = v.as_bool() {
        return Ok(if b { 1 } else { 0 });
    }
    Err(format!("这里的值应该是一个整数，实际是 {}", v))
}

fn parse_addr(s: &str) -> Option<u32> {
    let t = s.trim();
    let body = t.strip_prefix("0x").or_else(|| t.strip_prefix("0X"))?;
    u32::from_str_radix(body, 16).ok()
}

fn is_reg_name(s: &str) -> bool {
    riscv_simulator::reg_index(s).is_some()
}

fn string_list(v: Option<&Value>) -> Vec<String> {
    v.and_then(|x| x.as_array())
        .map(|a| a.iter().filter_map(|x| x.as_str().map(|s| s.to_string())).collect())
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_a_simple_static_goal() {
        let cfg = LevelConfig::parse(
            r#"{
                "level": "1-1",
                "availableOps": ["add", "ecall"],
                "forbiddenRegs": [],
                "maxInstructions": 5000,
                "goal": { "type": "static", "tests": [
                    { "name": "1+1", "initial": { "regs": { "x1": 1, "x2": 1 } },
                      "expected": { "regs": { "x3": 2 } } }
                ] }
            }"#,
        )
        .unwrap();
        assert_eq!(cfg.level, "1-1");
        assert_eq!(cfg.language, Language::Asm);
        assert_eq!(cfg.available_ops, vec!["add", "ecall"]);
        let tests = cfg.tests();
        assert_eq!(tests.len(), 1);
        assert_eq!(tests[0].initial_regs.get("x1"), Some(&1));
        assert_eq!(tests[0].expected_regs.get("x3"), Some(&2));
    }

    #[test]
    fn flat_memory_keys_are_accepted() {
        let cfg = LevelConfig::parse(
            r#"{
                "level": "2-4", "language": "c",
                "availableOps": [], "forbiddenRegs": [], "maxInstructions": 100000,
                "goal": { "type": "static", "tests": [
                    { "name": "数组", "initial": { "0x2000": [3, 1, 2] },
                      "expected": { "ret": 0, "0x2000": [1, 2, 3] } }
                ] }
            }"#,
        )
        .unwrap();
        let t = &cfg.tests()[0];
        assert_eq!(t.initial_memory.get(&0x2000), Some(&MemExpect::Words(vec![3, 1, 2])));
        assert_eq!(t.expected_memory.get(&0x2000), Some(&MemExpect::Words(vec![1, 2, 3])));
        assert_eq!(t.expected_ret, Some(0));
    }

    #[test]
    fn memory_arrays_are_word_arrays() {
        // `[5, 1, 9, 3]` = 四个 32 位整数，落在 0x2000/0x2004/0x2008/0x200C
        let e = MemExpect::Words(vec![5, 1, 9, 3]);
        let bytes = e.bytes();
        assert_eq!(bytes.len(), 16);
        assert_eq!(bytes[0], (0, 5));
        assert_eq!(bytes[4], (4, 1));
        assert_eq!(bytes[8], (8, 9));
        assert_eq!(bytes[12], (12, 3));
        assert_eq!(e.size(), 16);
        // 负数按补码写
        let neg = MemExpect::Words(vec![-1]);
        assert_eq!(neg.bytes(), vec![(0, 0xFF), (1, 0xFF), (2, 0xFF), (3, 0xFF)]);
    }

    #[test]
    fn nested_memory_form_is_also_accepted() {
        let cfg = LevelConfig::parse(
            r#"{
                "level": "1-5", "availableOps": [], "forbiddenRegs": [],
                "goal": { "type": "static", "tests": [
                    { "initial": { "memory": { "0x1000": 42 } },
                      "expected": { "memory": { "0x2000": 42 } } }
                ] }
            }"#,
        )
        .unwrap();
        let t = &cfg.tests()[0];
        assert_eq!(t.initial_memory.get(&0x1000), Some(&MemExpect::Word(42)));
        assert_eq!(t.expected_memory.get(&0x2000), Some(&MemExpect::Word(42)));
    }
    #[test]
    fn call_mode_and_text_io() {
        let cfg = LevelConfig::parse(
            r#"{
                "level": "2-1", "language": "c", "availableOps": [], "forbiddenRegs": [],
                "goal": { "type": "static", "tests": [
                    { "name": "求和", "call": { "fn": "solve", "args": [3, 7] }, "expected": { "ret": 10 } },
                    { "name": "回显", "input": { "text": "abc" }, "output": { "text": "ABC" } }
                ] }
            }"#,
        )
        .unwrap();
        let tests = cfg.tests();
        assert_eq!(tests[0].call.as_ref().unwrap().function, "solve");
        assert_eq!(tests[0].call.as_ref().unwrap().args, vec![3, 7]);
        assert_eq!(tests[0].expected_ret, Some(10));
        assert_eq!(tests[1].input_text, "abc");
        assert_eq!(tests[1].output_text.as_deref(), Some("ABC"));
    }

    #[test]
    fn scripted_goal_parses() {
        let cfg = LevelConfig::parse(
            r#"{
                "level": "3-7", "availableOps": [], "forbiddenRegs": [],
                "goal": { "type": "scripted", "judge": "expr_check", "judgeArgs": { "rounds": 5 } }
            }"#,
        )
        .unwrap();
        match cfg.goal {
            Goal::Scripted { judge, .. } => assert_eq!(judge, "expr_check"),
            other => panic!("期望 scripted，实际 {:?}", other),
        }
    }

    #[test]
    fn bad_configs_are_reported_in_chinese() {
        assert!(LevelConfig::parse("{").unwrap_err().contains("语法错误"));
        assert!(LevelConfig::parse(r#"{"level":"1-1"}"#).unwrap_err().contains("goal"));
        let e = LevelConfig::parse(
            r#"{"level":"1-1","goal":{"type":"static","tests":[]}}"#,
        )
        .unwrap_err();
        assert!(e.contains("至少要有一条"), "{}", e);
        let e = LevelConfig::parse(
            r#"{"level":"1-1","language":"rust","goal":{"type":"static","tests":[{}]}}"#,
        )
        .unwrap_err();
        assert!(e.contains("language"), "{}", e);
    }

    #[test]
    fn unsigned_32bit_values_are_interpreted_as_bit_patterns() {
        // `4294967295`（= 0xFFFFFFFF）这种"无符号 32 位"写法要当成 -1
        let cfg = LevelConfig::parse(
            r#"{"level":"2-10","goal":{"type":"static","tests":[
                {"expected":{"regs":{"x1":4294967295}}}]}}"#,
        )
        .unwrap();
        assert_eq!(cfg.tests()[0].expected_regs.get("x1"), Some(&-1i64));
    }

    #[test]
    fn plain_positive_values_are_kept_as_written() {
        let cfg = LevelConfig::parse(
            r#"{"level":"2-4","goal":{"type":"static","tests":[
                {"expected":{"regs":{"x1":8192},"0x2000":8192}}]}}"#,
        )
        .unwrap();
        assert_eq!(cfg.tests()[0].expected_regs.get("x1"), Some(&8192i64));
        assert_eq!(cfg.tests()[0].expected_memory.get(&0x2000), Some(&MemExpect::Word(8192)));
    }
}
