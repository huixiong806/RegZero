//! **通用数据驱动测例生成器（Plan B2）**：
//!
//! 只需在 `tests.json` 中声明 `"generated"` 输入分布，即可：
//! 1. 用固定种子生成确定性的「隐藏基准测例」（计入 `parSteps` 性能金牌）；
//! 2. 用动态种子生成「防打表随机测例」（不计入 `parSteps`，失败时前端钉住该 `seed` 实现跨会话 100% 复现与单步调试）；
//! 3. 直接复用关卡自带的 `solution.s` 作为通用参考裁判，零一次性 Rust 裁判代码。

use crate::config::{LevelConfig, MemExpect, TestCase};
use crate::runner::Runner;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// `tests.json` 中的声明式测例生成配置。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GeneratedSpec {
    /// 隐藏基准测例使用的固定种子（确保 `parSteps` 基准 100% 确定且可复现）
    pub seed: u64,
    /// 隐藏基准测例条数（计入 `parSteps` 动态步数）
    #[serde(default)]
    pub fixed_count: usize,
    /// 动态随机抽测条数（仅判正确性防打表，不计入 `parSteps`）
    #[serde(default)]
    pub random_count: usize,
    /// 要向参考解比对的寄存器名称列表（如 `["t2"]`）
    #[serde(default)]
    pub check_regs: Vec<String>,
    /// 要向参考解比对的内存区域列表
    #[serde(default)]
    pub check_memory: Vec<MemoryCheckSpec>,
    /// 是否比对标准输出文本（MMIO / `ecall` 输出）
    #[serde(default)]
    pub check_output: bool,
    /// 是否比对退出码
    #[serde(default)]
    pub check_exit: bool,
    /// 随机输入生成规格
    pub inputs: InputGenSpec,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryCheckSpec {
    /// 十六进制内存地址，如 `"0x1000"`
    pub addr: String,
    /// `"word"`（单字）、`"sameAsInput"`（与该地址初始数组/字符串同长度）或 `"string"`（以 0 结尾字符串）
    #[serde(default = "default_mem_check_kind")]
    pub kind: String,
}

fn default_mem_check_kind() -> String {
    "sameAsInput".to_string()
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InputGenSpec {
    #[serde(default)]
    pub regs: BTreeMap<String, IntRangeSpec>,
    #[serde(default)]
    pub arrays: Vec<ArrayGenSpec>,
    #[serde(default)]
    pub strings: Vec<StringGenSpec>,
    #[serde(default)]
    pub text_stream: Option<TextStreamGenSpec>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IntRangeSpec {
    #[serde(default)]
    pub min: i64,
    #[serde(default)]
    pub max: i64,
    /// 是否禁止生成 `0`（如除数）
    #[serde(default)]
    pub non_zero: bool,
    /// 为 true 时生成任意 32 位比特模式（适合位运算/Rule 110/Popcount）
    #[serde(default)]
    pub u32_bits: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArrayGenSpec {
    pub addr: String,
    #[serde(default)]
    pub addr_reg: Option<String>,
    #[serde(default)]
    pub len_reg: Option<String>,
    /// `sortedWords` 模式下可选：把目标查找值写入该寄存器（50% 命中 / 50% 未命中）
    #[serde(default)]
    pub target_reg: Option<String>,
    pub len: [usize; 2],
    pub elem: [i64; 2],
    /// `"words"` | `"sortedWords"` | `"pairsWithOneSingle"`
    #[serde(default = "default_array_kind")]
    pub kind: String,
}

fn default_array_kind() -> String {
    "words".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StringGenSpec {
    pub addr: String,
    #[serde(default)]
    pub addr_reg: Option<String>,
    pub len: [usize; 2],
    /// `"lower"`（小写英文字母）
    #[serde(default = "default_charset")]
    pub charset: String,
}

fn default_charset() -> String {
    "lower".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextStreamGenSpec {
    /// `"mixedAscii"` | `"intList"` | `"rle"` | `"rpn"`
    pub kind: String,
    #[serde(default = "default_stream_len")]
    pub len: [usize; 2],
}

fn default_stream_len() -> [usize; 2] {
    [4, 10]
}

/// 确定性线性同余伪随机数（零外部依赖，原生与 WASM 产出完全一致）。
pub struct DetRng(u64);

impl DetRng {
    pub fn new(seed: u64) -> Self {
        let mixed = seed
            .wrapping_mul(6364136223846793005)
            .wrapping_add(1442695040888963407)
            ^ 0x9E37_79B9_7F4A_7C15;
        Self(mixed | 1)
    }

    pub fn next_u64(&mut self) -> u64 {
        self.0 = self
            .0
            .wrapping_mul(6364136223846793005)
            .wrapping_add(1442695040888963407);
        self.0 ^ (self.0 >> 29)
    }

    pub fn next_u32(&mut self) -> u32 {
        (self.next_u64() >> 16) as u32
    }

    pub fn range_i64(&mut self, lo: i64, hi: i64) -> i64 {
        if hi <= lo {
            return lo;
        }
        let span = (hi as i128 - lo as i128 + 1) as u128;
        let v = (self.next_u64() as u128) % span;
        (lo as i128 + v as i128) as i64
    }

    pub fn range_usize(&mut self, lo: usize, hi: usize) -> usize {
        if hi <= lo {
            return lo;
        }
        lo + (self.next_u64() as usize) % (hi - lo + 1)
    }
}

fn parse_hex_addr(s: &str) -> u32 {
    let t = s.trim();
    let body = t.strip_prefix("0x").or_else(|| t.strip_prefix("0X")).unwrap_or(t);
    u32::from_str_radix(body, 16).unwrap_or(0x1000)
}

/// 生成一组隐藏基准测例或动态随机测例，并用参考解 `solution_code` 自动算出期望值。
pub fn synthesize_cases(
    config: &LevelConfig,
    solution_code: &str,
    spec: &GeneratedSpec,
    seed: u64,
    count: usize,
    is_random: bool,
) -> Result<Vec<TestCase>, String> {
    if count == 0 {
        return Ok(Vec::new());
    }
    let oracle = Runner::new(config.clone(), solution_code)
        .map_err(|errs| format!("参考解编译失败（无法生成标准答案）：{:?}", errs))?;

    let mut rng = DetRng::new(seed);
    let mut out = Vec::with_capacity(count);

    for idx in 0..count {
        let mut tc = build_input_case(&mut rng, spec, idx, is_random, config.max_instructions);
        let outcome = oracle.run_case(&tc);
        if outcome.state.pause_kind == "error" {
            return Err(format!(
                "参考解在生成测例 #{} 上运行失败：{}",
                idx + 1,
                outcome.state.pause_detail.unwrap_or_default()
            ));
        }

        // 记录参考解的寄存器终值
        for reg in &spec.check_regs {
            if let Some(canon) = riscv_simulator::reg_index(reg).map(riscv_simulator::reg_name) {
                let raw = outcome.state.regs.get(&canon).copied().unwrap_or(0);
                tc.expected_regs.insert(reg.clone(), raw as i32 as i64);
            }
        }

        // 记录参考解的内存终值
        for mc in &spec.check_memory {
            let addr = parse_hex_addr(&mc.addr);
            match mc.kind.as_str() {
                "word" => {
                    let v = read_le_i32(&outcome.state.memory, addr);
                    tc.expected_memory.insert(addr, MemExpect::Word(v as i64));
                }
                "string" => {
                    let s = read_c_string(&outcome.state.memory, addr, 256);
                    tc.expected_memory.insert(addr, MemExpect::String(s));
                }
                _ => {
                    // sameAsInput：根据该地址初始内存形状读回
                    match tc.initial_memory.get(&addr) {
                        Some(MemExpect::Words(w)) => {
                            let mut vals = Vec::with_capacity(w.len());
                            for i in 0..w.len() {
                                vals.push(read_le_i32(&outcome.state.memory, addr + i as u32 * 4) as i64);
                            }
                            tc.expected_memory.insert(addr, MemExpect::Words(vals));
                        }
                        Some(MemExpect::String(_)) => {
                            let s = read_c_string(&outcome.state.memory, addr, 256);
                            tc.expected_memory.insert(addr, MemExpect::String(s));
                        }
                        _ => {
                            let v = read_le_i32(&outcome.state.memory, addr);
                            tc.expected_memory.insert(addr, MemExpect::Word(v as i64));
                        }
                    }
                }
            }
        }

        if spec.check_output {
            tc.output_text = Some(outcome.state.output);
        }
        if spec.check_exit {
            tc.expected_exit = outcome.state.exit_code.map(|c| c as i64);
        }

        out.push(tc);
    }

    Ok(out)
}

fn read_le_i32(mem: &BTreeMap<u32, u8>, addr: u32) -> i32 {
    let b0 = mem.get(&addr).copied().unwrap_or(0);
    let b1 = mem.get(&(addr + 1)).copied().unwrap_or(0);
    let b2 = mem.get(&(addr + 2)).copied().unwrap_or(0);
    let b3 = mem.get(&(addr + 3)).copied().unwrap_or(0);
    i32::from_le_bytes([b0, b1, b2, b3])
}

fn read_c_string(mem: &BTreeMap<u32, u8>, addr: u32, max_len: usize) -> String {
    let mut bytes = Vec::new();
    for i in 0..max_len {
        let b = mem.get(&(addr + i as u32)).copied().unwrap_or(0);
        if b == 0 {
            break;
        }
        bytes.push(b);
    }
    String::from_utf8_lossy(&bytes).to_string()
}

fn build_input_case(
    rng: &mut DetRng,
    spec: &GeneratedSpec,
    idx: usize,
    is_random: bool,
    max_instructions: u64,
) -> TestCase {
    let mut tc = TestCase {
        name: if is_random {
            format!("随机抽测 #{}", idx + 1)
        } else {
            format!("隐藏测例 #{}", idx + 1)
        },
        hidden: true,
        is_random,
        max_instructions: Some(max_instructions),
        ..Default::default()
    };

    // 1. 标量寄存器
    for (reg, range) in &spec.inputs.regs {
        let val = if range.u32_bits {
            rng.next_u32() as i32 as i64
        } else {
            let mut v = rng.range_i64(range.min, range.max);
            if range.non_zero && v == 0 {
                v = if range.max > 0 { 1 } else { -1 };
            }
            v
        };
        tc.initial_regs.insert(reg.clone(), val);
    }

    // 2. 数组内存
    for arr in &spec.inputs.arrays {
        let addr = parse_hex_addr(&arr.addr);
        if let Some(r) = &arr.addr_reg {
            tc.initial_regs.insert(r.clone(), addr as i64);
        }
        let values: Vec<i64> = match arr.kind.as_str() {
            "sortedWords" => {
                let len = rng.range_usize(arr.len[0], arr.len[1]);
                let mut cur = rng.range_i64(arr.elem[0], arr.elem[0] + 20);
                let mut v = Vec::with_capacity(len);
                for _ in 0..len {
                    cur += rng.range_i64(1, 11);
                    v.push(cur);
                }
                if let Some(t_reg) = &arr.target_reg {
                    let target = if !v.is_empty() && (rng.next_u32() & 1) == 0 {
                        v[rng.range_usize(0, v.len() - 1)]
                    } else if !v.is_empty() {
                        // 刻意挑选一个极大概率未命中的值（或落在相邻两数中间）
                        let pick = v[rng.range_usize(0, v.len() - 1)] + 1;
                        if v.binary_search(&pick).is_ok() {
                            v[v.len() - 1] + 5
                        } else {
                            pick
                        }
                    } else {
                        rng.range_i64(arr.elem[0], arr.elem[1])
                    };
                    tc.initial_regs.insert(t_reg.clone(), target);
                }
                v
            }
            "pairsWithOneSingle" => {
                let pairs = rng.range_usize(arr.len[0] / 2, arr.len[1] / 2);
                let mut v = Vec::with_capacity(pairs * 2 + 1);
                let unique = rng.range_i64(arr.elem[0], arr.elem[1]);
                v.push(unique);
                for _ in 0..pairs {
                    let mut x = rng.range_i64(arr.elem[0], arr.elem[1]);
                    if x == unique {
                        x += 1;
                    }
                    v.push(x);
                    v.push(x);
                }
                // Fisher-Yates 洗牌打乱顺序
                for i in (1..v.len()).rev() {
                    let j = rng.range_usize(0, i);
                    v.swap(i, j);
                }
                v
            }
            _ => {
                let len = rng.range_usize(arr.len[0], arr.len[1]);
                (0..len).map(|_| rng.range_i64(arr.elem[0], arr.elem[1])).collect()
            }
        };

        if let Some(lr) = &arr.len_reg {
            tc.initial_regs.insert(lr.clone(), values.len() as i64);
        }
        if !values.is_empty() {
            tc.initial_memory.insert(addr, MemExpect::Words(values));
        }
    }

    // 3. C 字符串内存
    for st in &spec.inputs.strings {
        let addr = parse_hex_addr(&st.addr);
        if let Some(r) = &st.addr_reg {
            tc.initial_regs.insert(r.clone(), addr as i64);
        }
        let len = rng.range_usize(st.len[0], st.len[1]);
        let mut s = String::with_capacity(len);
        for _ in 0..len {
            let c = (b'a' + (rng.next_u32() % 26) as u8) as char;
            s.push(c);
        }
        tc.initial_memory.insert(addr, MemExpect::String(s));
    }

    // 4. MMIO / ecall 输入流
    if let Some(ts) = &spec.inputs.text_stream {
        tc.input_text = generate_text_stream(rng, ts, idx);
    }

    tc
}

fn generate_text_stream(rng: &mut DetRng, ts: &TextStreamGenSpec, idx: usize) -> String {
    match ts.kind.as_str() {
        "mixedAscii" => {
            const ALPHABET: &[u8] =
                b"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 !?,.-+:@`{[";
            let len = rng.range_usize(ts.len[0], ts.len[1]);
            (0..len)
                .map(|_| ALPHABET[rng.range_usize(0, ALPHABET.len() - 1)] as char)
                .collect()
        }
        "intList" => {
            let n = rng.range_usize(ts.len[0].max(1), ts.len[1].max(1));
            let all_neg = idx % 3 == 1;
            let mut parts = Vec::with_capacity(n + 1);
            parts.push(n.to_string());
            for _ in 0..n {
                let v = if all_neg {
                    rng.range_i64(-200, -1)
                } else {
                    rng.range_i64(-150, 150)
                };
                parts.push(v.to_string());
            }
            parts.join(" ")
        }
        "rle" => {
            const SYMS: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZ!@#$*-+ ";
            let segs = rng.range_usize(ts.len[0].max(1), ts.len[1].max(1));
            let mut s = String::new();
            for _ in 0..segs {
                let count = rng.range_usize(1, 14);
                let ch = SYMS[rng.range_usize(0, SYMS.len() - 1)] as char;
                s.push_str(&format!("{}{}", count, ch));
            }
            s
        }
        "rpn" => {
            let ops_count = rng.range_usize(ts.len[0].max(1), ts.len[1].max(1));
            let mut tokens = Vec::new();
            let mut depth: usize = 0;
            let mut ops_left = ops_count;
            let mut nums_left = ops_count + 1;
            while nums_left > 0 || ops_left > 0 {
                let can_op = depth >= 2 && ops_left > 0;
                let must_op = nums_left == 0;
                if must_op || (can_op && (rng.next_u32() % 3) == 0) {
                    let op = match rng.next_u32() % 3 {
                        0 => "+",
                        1 => "-",
                        _ => "*",
                    };
                    tokens.push(op.to_string());
                    depth -= 1;
                    ops_left -= 1;
                } else {
                    let val = rng.range_i64(0, 19);
                    tokens.push(val.to_string());
                    depth += 1;
                    nums_left -= 1;
                }
            }
            tokens.join(" ")
        }
        _ => String::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn det_rng_is_reproducible_across_runs() {
        let mut a = DetRng::new(202601);
        let mut b = DetRng::new(202601);
        for _ in 0..20 {
            assert_eq!(a.next_u64(), b.next_u64());
        }
    }

    #[test]
    fn generated_rpn_stream_is_always_balanced() {
        let mut rng = DetRng::new(42);
        let spec = TextStreamGenSpec { kind: "rpn".to_string(), len: [2, 6] };
        for i in 0..10 {
            let expr = generate_text_stream(&mut rng, &spec, i);
            let mut depth: i32 = 0;
            for tok in expr.split_whitespace() {
                if matches!(tok, "+" | "-" | "*") {
                    depth -= 1;
                    assert!(depth >= 1, "栈下溢：{}", expr);
                } else {
                    assert!(tok.parse::<i64>().is_ok());
                    depth += 1;
                }
            }
            assert_eq!(depth, 1, "最终栈深度不为 1：{}", expr);
        }
    }
}
