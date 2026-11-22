//! 前后端共享传输结构体（DTO），统一 `camelCase`。
//!
//! 同时服务于 `crates/regzero-wasm` 与未来的 `crates/regzero-bridge`，
//! 对应的 TypeScript 类型定义在 `web/src/engine/types.ts`。

use crate::config::{Language, MemExpect, TestCase};
use crate::judge::Verdict;
use crate::levels::{EditorConfig, LevelKind, LevelMeta};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// 关卡地图里的一项摘要。
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct LevelSummary {
    pub id: String,
    pub chapter: u32,
    pub order: f64,
    pub kind: LevelKind,
    pub title: String,
    pub language: Language,
    pub mode: String,
    pub allow_local_file: bool,
    pub prerequisites: Vec<String>,
    pub concepts: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub par_instructions: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub par_steps: Option<u64>,
    pub passed: bool,
    pub unlocked: bool,
    pub attempts: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub best_score: Option<u32>,
    #[serde(default)]
    pub met_par: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub best_steps: Option<u64>,
}

/// 测例摘要（供前端测例选择器与 Before/After 预览展示）。
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct TestCasePreview {
    pub index: usize,
    pub name: String,
    pub initial_regs: BTreeMap<String, i64>,
    pub initial_memory: BTreeMap<String, String>,
    pub expected_regs: BTreeMap<String, i64>,
    pub expected_memory: BTreeMap<String, String>,
}

impl TestCasePreview {
    /// 从领域层 `TestCase` 构造可读摘要。
    pub fn from_case(index: usize, case: &TestCase) -> Self {
        let fmt_mem = |m: &BTreeMap<u32, MemExpect>| -> BTreeMap<String, String> {
            m.iter()
                .map(|(addr, val)| (format!("0x{:04X}", addr), val.describe()))
                .collect()
        };
        Self {
            index,
            name: case.name.clone(),
            initial_regs: case.initial_regs.clone(),
            initial_memory: fmt_mem(&case.initial_memory),
            expected_regs: case.expected_regs.clone(),
            expected_memory: fmt_mem(&case.expected_memory),
        }
    }
}

/// 加载单关后前端所需的完整数据包。
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct LevelPayload {
    pub id: String,
    pub meta: LevelMeta,
    pub lesson_markdown: String,
    pub editor: EditorConfig,
    pub initial_code: String,
    pub available_ops: Vec<String>,
    pub forbidden_regs: Vec<String>,
    pub tests_preview: Vec<TestCasePreview>,
    /// 本关用于计算 `parSteps` 的固定基准测例总数（公开 + 固定种子隐藏测例）
    #[serde(default)]
    pub benchmark_count: usize,
    /// 参考解（卡住展开 3 级提示或自检时可选展示）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub solution: Option<String>,
}

/// 一次运行或单步后的机器状态快照。
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct MachineSnapshot {
    pub pc: u32,
    /// 当前 PC 对应的源码行（1-based；0 表示无对应源码行）
    pub pc_line: u32,
    pub regs: BTreeMap<String, u32>,
    /// 当前非零内存字视图（地址十六进制字符串 → 32 位有符号整数，最多返回 64 字）
    pub memory_words: BTreeMap<String, i32>,
    pub tick: u64,
    pub instructions: u64,
    pub output: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub exit_code: Option<i32>,
    pub pause_kind: String,
    pub pause_detail: String,
    pub halted: bool,
    pub can_step: bool,
    pub can_step_back: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub generated_assembly: Option<String>,
}

/// 刚刚执行的那一条指令的结构化数据通路事件（供前端实时驱动 5 阶段 CPU 动画）。
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ExecutedOpDto {
    /// 动画大类：`alu` / `branch` / `jump` / `load` / `store` / `halt` / `other`
    pub kind: String,
    /// 指令助记符（如 `add`、`addi`、`mv`、`sub`、`blt`、`j`、`ecall`）
    pub op: String,
    /// 可读指令文本（供 1.取指 指令盒展示，如 `add t2, t0, t1`）
    pub asm_text: String,
    /// 执行该指令时的 PC 地址
    pub pc: u32,
    /// 运算符或比较符号（`+`/`-`/`×`/`÷`/`%`/`<`/`>=`/`==`/`!=`）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub symbol: Option<String>,
    /// 该指令对应的源码行号（1-based；0 表示无源码映射）
    pub line: u32,
    /// 执行后的下一条源码行号（用于判断分支/回跳循环方向）
    pub next_line: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rs1: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rs1_val: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rs2: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rs2_val: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub imm: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rd: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rd_old_val: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rd_new_val: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mem_addr: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mem_val: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub branch_taken: Option<bool>,
}

/// 单步 / 倒退结果：在快照上附加变化差量与数据通路事件，驱动前端实时电路动画。
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct StepPayload {
    #[serde(flatten)]
    pub snapshot: MachineSnapshot,
    /// 本步发生变化的寄存器（规范名 → 新值）
    pub reg_changes: BTreeMap<String, u32>,
    /// 本步发生变化的内存字节（地址 → 新字节），最多 64 条
    pub mem_changes: BTreeMap<u32, u8>,
    /// 单步前进刚执行的指令数据通路事件（倒退或多步跳转时为 None）
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub executed: Option<ExecutedOpDto>,
}

/// 单条测例判定结果。
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct TestVerdictDto {
    pub name: String,
    pub passed: bool,
    pub steps: u64,
    #[serde(default)]
    pub hidden: bool,
    #[serde(default)]
    pub is_random: bool,
    pub detail: String,
    pub diffs: Vec<DiffDto>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub actual_output: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub failure: Option<FailureDto>,
}

/// 结构化期望与实际差异。
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DiffDto {
    pub what: String,
    pub expected: String,
    pub actual: String,
}

/// 失败现场定位信息（支持前端「一键调试失败测例」）。
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct FailureDto {
    pub case_index: usize,
    pub pc: u32,
    pub line: u32,
    pub reason: String,
    pub reason_text: String,
    pub regs: BTreeMap<String, u32>,
}

/// 汇编/编译阶段错误。
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ErrorDto {
    pub line: u32,
    pub message: String,
    pub kind: String,
}

/// 提交代码后的综合判定结果。
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SubmitDto {
    pub level: String,
    pub passed: bool,
    pub score: u32,
    /// 静态编译产出的机器码指令条数
    #[serde(skip_serializing_if = "Option::is_none")]
    pub instruction_count: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub par_instructions: Option<usize>,
    /// 固定基准测例动态执行的总指令步数（性能优化主指标）
    pub total_steps: u64,
    /// 计入 `total_steps` 的固定基准测例条数
    #[serde(default)]
    pub benchmark_count: usize,
    /// 可选性能金牌目标步数上限
    #[serde(skip_serializing_if = "Option::is_none")]
    pub par_steps: Option<u64>,
    pub met_par: bool,
    /// 隐藏与随机抽测通过条数
    #[serde(default)]
    pub hidden_passed: usize,
    /// 隐藏与随机抽测总条数
    #[serde(default)]
    pub hidden_total: usize,
    /// 本次提交使用的动态随机种子（失败时供前端钉住跨会话复现）
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub dynamic_seed: Option<u32>,
    pub summary: String,
    pub tests: Vec<TestVerdictDto>,
    pub errors: Vec<ErrorDto>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub generated_assembly: Option<String>,
}

/// 结构化概念图鉴词条（支持按知识点渐进披露词条、段落、表格列与表格行）。
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WikiEntry {
    pub topic: String,
    pub title: String,
    #[serde(default)]
    pub order: u32,
    /// 整篇词条可见所需的概念集合（任一满足即解锁；空数组表示常驻可见）。
    #[serde(default)]
    pub unlock_any: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub summary: Option<String>,
    pub sections: Vec<WikiSection>,
}

/// 词条内的单个渐进分段（说明段或可逐行生长的速查表）。
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WikiSection {
    pub id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub heading: Option<String>,
    /// 任一概念满足即显示本段；空数组表示随词条可见。
    #[serde(default)]
    pub unlock_any: Vec<String>,
    #[serde(flatten)]
    pub body: WikiSectionBody,
}

/// 词条分段内容体。
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum WikiSectionBody {
    Markdown {
        markdown: String,
    },
    Table {
        columns: Vec<WikiTableColumn>,
        rows: Vec<WikiTableRow>,
    },
}

/// 渐进速查表列定义（支持整列按概念解锁，例如隐藏 `x0-x31` 硬件编号列）。
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WikiTableColumn {
    pub id: String,
    pub label: String,
    #[serde(default)]
    pub unlock_any: Vec<String>,
}

/// 渐进速查表行定义（支持逐关追加指令或寄存器行）。
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WikiTableRow {
    pub id: String,
    #[serde(default)]
    pub unlock_any: Vec<String>,
    pub cells: BTreeMap<String, String>,
}

/// 将领域层 `Verdict` 转换为标准 `SubmitDto`（优先按动态执行步数 `par_steps` 评性能金牌）。
pub fn verdict_to_submit_dto(
    level: &str,
    verdict: Verdict,
    instruction_count: Option<usize>,
    par_instructions: Option<usize>,
    par_steps: Option<u64>,
    dynamic_seed: Option<u32>,
) -> SubmitDto {
    let met_par = if let Some(par_s) = par_steps {
        verdict.passed && verdict.total_steps <= par_s
    } else {
        match (verdict.passed, instruction_count, par_instructions) {
            (true, Some(count), Some(par)) => count <= par,
            _ => false,
        }
    };

    let mut hidden_total = 0usize;
    let mut hidden_passed = 0usize;
    let mut visible_tests = Vec::new();
    let mut first_hidden_fail_shown = false;

    for t in verdict.tests {
        if t.hidden {
            hidden_total += 1;
            if t.passed {
                hidden_passed += 1;
                continue;
            }
            // 隐藏/随机测例失败时，只向前端暴露第一条失败点供排查与单步调试，其余继续保密
            if first_hidden_fail_shown {
                continue;
            }
            first_hidden_fail_shown = true;
        }
        visible_tests.push(TestVerdictDto {
            name: t.name,
            passed: t.passed,
            steps: t.steps,
            hidden: t.hidden,
            is_random: t.is_random,
            detail: t.detail,
            diffs: t
                .diffs
                .into_iter()
                .map(|d| DiffDto { what: d.what, expected: d.expected, actual: d.actual })
                .collect(),
            actual_output: t.actual_output,
            failure: t.failure_site.map(|f| FailureDto {
                case_index: f.case_index,
                pc: f.pc,
                line: f.line,
                reason: format!("{:?}", f.reason),
                reason_text: f.reason.describe().to_string(),
                regs: f.regs.into_iter().collect(),
            }),
        });
    }

    SubmitDto {
        level: level.to_string(),
        passed: verdict.passed,
        score: verdict.score,
        instruction_count,
        par_instructions,
        total_steps: verdict.total_steps,
        benchmark_count: verdict.benchmark_count,
        par_steps,
        met_par,
        hidden_passed,
        hidden_total,
        dynamic_seed,
        summary: verdict.summary,
        tests: visible_tests,
        errors: verdict
            .errors
            .into_iter()
            .map(|e| ErrorDto { line: e.line, message: e.message, kind: format!("{:?}", e.kind) })
            .collect(),
        generated_assembly: verdict.generated_assembly,
    }
}

/// 将稀疏字节内存整理为 4 字节对齐的 32 位有符号字快照（最多取前 64 个非零字）。
pub fn sparse_bytes_to_words(mem: &BTreeMap<u32, u8>, extra_addrs: &[u32]) -> BTreeMap<String, i32> {
    let mut word_addrs = std::collections::BTreeSet::new();
    for &addr in mem.keys() {
        word_addrs.insert(addr & !3);
    }
    for &addr in extra_addrs {
        word_addrs.insert(addr & !3);
    }
    let mut out = BTreeMap::new();
    for base in word_addrs.into_iter().take(64) {
        let b0 = *mem.get(&base).unwrap_or(&0);
        let b1 = *mem.get(&(base + 1)).unwrap_or(&0);
        let b2 = *mem.get(&(base + 2)).unwrap_or(&0);
        let b3 = *mem.get(&(base + 3)).unwrap_or(&0);
        let val = i32::from_le_bytes([b0, b1, b2, b3]);
        if val != 0 || extra_addrs.contains(&base) {
            out.insert(format!("0x{:04X}", base), val);
        }
    }
    out
}

/// 将刚执行的 32 位 RV32IM 机器码及其执行前后寄存器状态解码为前端数据通路脉冲事件。
pub fn describe_executed_op(
    word: u32,
    pc_before: u32,
    pc_after: u32,
    line: u32,
    next_line: u32,
    regs_before: &BTreeMap<String, u32>,
    regs_after: &BTreeMap<String, u32>,
) -> Option<ExecutedOpDto> {
    use riscv_simulator::{decode, reg_abi_name, Instruction};

    let inst = decode(word).ok()?;
    let reg_val = |map: &BTreeMap<String, u32>, idx: u8| -> i32 {
        if idx == 0 {
            return 0;
        }
        let key = format!("x{}", idx);
        map.get(&key).copied().unwrap_or(0) as i32
    };
    let abi = |idx: u8| reg_abi_name(idx as usize).to_string();

    let mut dto = ExecutedOpDto {
        kind: "other".into(),
        op: inst.mnemonic().into(),
        asm_text: inst.mnemonic().into(),
        pc: pc_before,
        symbol: None,
        line,
        next_line,
        rs1: None,
        rs1_val: None,
        rs2: None,
        rs2_val: None,
        imm: None,
        rd: None,
        rd_old_val: None,
        rd_new_val: None,
        mem_addr: None,
        mem_val: None,
        branch_taken: None,
    };

    match inst {
        Instruction::Add { rd, rs1, rs2 }
        | Instruction::Sub { rd, rs1, rs2 }
        | Instruction::Mul { rd, rs1, rs2 }
        | Instruction::Div { rd, rs1, rs2 }
        | Instruction::Divu { rd, rs1, rs2 }
        | Instruction::Rem { rd, rs1, rs2 }
        | Instruction::Remu { rd, rs1, rs2 }
        | Instruction::And { rd, rs1, rs2 }
        | Instruction::Or { rd, rs1, rs2 }
        | Instruction::Xor { rd, rs1, rs2 }
        | Instruction::Sll { rd, rs1, rs2 }
        | Instruction::Srl { rd, rs1, rs2 }
        | Instruction::Sra { rd, rs1, rs2 } => {
            dto.kind = "alu".into();
            dto.asm_text = format!("{} {}, {}, {}", inst.mnemonic(), abi(rd), abi(rs1), abi(rs2));
            dto.symbol = Some(
                match inst {
                    Instruction::Add { .. } => "+",
                    Instruction::Sub { .. } => "-",
                    Instruction::Mul { .. } => "×",
                    Instruction::Div { .. } | Instruction::Divu { .. } => "÷",
                    Instruction::Rem { .. } | Instruction::Remu { .. } => "%",
                    Instruction::And { .. } => "&",
                    Instruction::Or { .. } => "|",
                    Instruction::Xor { .. } => "^",
                    Instruction::Sll { .. } => "<<",
                    Instruction::Srl { .. } | Instruction::Sra { .. } => ">>",
                    _ => "+",
                }
                .into(),
            );
            dto.rs1 = Some(abi(rs1));
            dto.rs1_val = Some(reg_val(regs_before, rs1));
            dto.rs2 = Some(abi(rs2));
            dto.rs2_val = Some(reg_val(regs_before, rs2));
            if rd != 0 {
                dto.rd = Some(abi(rd));
                dto.rd_old_val = Some(reg_val(regs_before, rd));
                dto.rd_new_val = Some(reg_val(regs_after, rd));
            }
        }
        Instruction::Addi { rd, rs1, imm } => {
            // 真实 RISC-V 硬件中 `mv rd, rs1` 本质就是 `addi rd, rs1, 0`，统一走 5 阶段 ALU 数据通路
            dto.kind = "alu".into();
            dto.symbol = Some("+".into());
            if imm == 0 && rs1 != 0 && rd != 0 {
                dto.op = "mv".into();
                dto.asm_text = format!("addi {}, {}, 0  (mv)", abi(rd), abi(rs1));
            } else {
                dto.asm_text = format!("addi {}, {}, {}", abi(rd), abi(rs1), imm);
            }
            dto.rs1 = Some(abi(rs1));
            dto.rs1_val = Some(reg_val(regs_before, rs1));
            dto.imm = Some(imm);
            if rd != 0 {
                dto.rd = Some(abi(rd));
                dto.rd_old_val = Some(reg_val(regs_before, rd));
                dto.rd_new_val = Some(reg_val(regs_after, rd));
            }
        }
        Instruction::Andi { rd, rs1, imm }
        | Instruction::Ori { rd, rs1, imm }
        | Instruction::Xori { rd, rs1, imm } => {
            dto.kind = "alu".into();
            dto.asm_text = format!("{} {}, {}, {}", inst.mnemonic(), abi(rd), abi(rs1), imm);
            dto.symbol = Some(
                match inst {
                    Instruction::Andi { .. } => "&",
                    Instruction::Ori { .. } => "|",
                    _ => "^",
                }
                .into(),
            );
            dto.rs1 = Some(abi(rs1));
            dto.rs1_val = Some(reg_val(regs_before, rs1));
            dto.imm = Some(imm);
            if rd != 0 {
                dto.rd = Some(abi(rd));
                dto.rd_old_val = Some(reg_val(regs_before, rd));
                dto.rd_new_val = Some(reg_val(regs_after, rd));
            }
        }
        Instruction::Slli { rd, rs1, shamt }
        | Instruction::Srli { rd, rs1, shamt }
        | Instruction::Srai { rd, rs1, shamt } => {
            dto.kind = "alu".into();
            dto.asm_text = format!("{} {}, {}, {}", inst.mnemonic(), abi(rd), abi(rs1), shamt);
            dto.symbol = Some(
                match inst {
                    Instruction::Slli { .. } => "<<",
                    Instruction::Srli { .. } => ">>>",
                    _ => ">>",
                }
                .into(),
            );
            dto.rs1 = Some(abi(rs1));
            dto.rs1_val = Some(reg_val(regs_before, rs1));
            dto.imm = Some(shamt as i32);
            if rd != 0 {
                dto.rd = Some(abi(rd));
                dto.rd_old_val = Some(reg_val(regs_before, rd));
                dto.rd_new_val = Some(reg_val(regs_after, rd));
            }
        }
        Instruction::Lui { rd, imm } => {
            dto.kind = "alu".into();
            dto.asm_text = format!("lui {}, 0x{:X}", abi(rd), (imm as u32) >> 12);
            dto.symbol = Some("<<".into());
            dto.rs1 = Some("zero".into());
            dto.rs1_val = Some(0);
            dto.imm = Some(imm);
            if rd != 0 {
                dto.rd = Some(abi(rd));
                dto.rd_old_val = Some(reg_val(regs_before, rd));
                dto.rd_new_val = Some(reg_val(regs_after, rd));
            }
        }
        Instruction::Beq { rs1, rs2, .. }
        | Instruction::Bne { rs1, rs2, .. }
        | Instruction::Blt { rs1, rs2, .. }
        | Instruction::Bge { rs1, rs2, .. }
        | Instruction::Bltu { rs1, rs2, .. }
        | Instruction::Bgeu { rs1, rs2, .. } => {
            dto.kind = "branch".into();
            dto.asm_text = format!(
                "{} {}, {}, L{}",
                inst.mnemonic(),
                abi(rs1),
                abi(rs2),
                if next_line > 0 { next_line } else { line }
            );
            dto.symbol = Some(
                match inst {
                    Instruction::Beq { .. } => "==",
                    Instruction::Bne { .. } => "!=",
                    Instruction::Blt { .. } | Instruction::Bltu { .. } => "<",
                    Instruction::Bge { .. } | Instruction::Bgeu { .. } => ">=",
                    _ => "?",
                }
                .into(),
            );
            dto.rs1 = Some(abi(rs1));
            dto.rs1_val = Some(reg_val(regs_before, rs1));
            dto.rs2 = Some(abi(rs2));
            dto.rs2_val = Some(reg_val(regs_before, rs2));
            dto.branch_taken = Some(pc_after != pc_before.wrapping_add(4));
        }
        Instruction::Jal { rd, .. } => {
            dto.kind = "jump".into();
            if rd == 0 {
                dto.op = "j".into();
                dto.asm_text = if next_line > 0 {
                    format!("j L{}", next_line)
                } else {
                    "j".into()
                };
            } else {
                dto.asm_text = format!("jal {}, L{}", abi(rd), next_line);
                dto.rd = Some(abi(rd));
                dto.rd_old_val = Some(reg_val(regs_before, rd));
                dto.rd_new_val = Some(reg_val(regs_after, rd));
            }
            dto.branch_taken = Some(true);
        }
        Instruction::Jalr { rd, rs1, .. } => {
            dto.kind = "jump".into();
            dto.asm_text = format!("jalr {}, {}", abi(rd), abi(rs1));
            dto.rs1 = Some(abi(rs1));
            dto.rs1_val = Some(reg_val(regs_before, rs1));
            if rd != 0 {
                dto.rd = Some(abi(rd));
                dto.rd_old_val = Some(reg_val(regs_before, rd));
                dto.rd_new_val = Some(reg_val(regs_after, rd));
            }
            dto.branch_taken = Some(true);
        }
        Instruction::Lw { rd, rs1, imm }
        | Instruction::Lh { rd, rs1, imm }
        | Instruction::Lb { rd, rs1, imm }
        | Instruction::Lhu { rd, rs1, imm }
        | Instruction::Lbu { rd, rs1, imm } => {
            dto.kind = "load".into();
            dto.symbol = Some("+".into());
            dto.asm_text = format!("{} {}, {}({})", inst.mnemonic(), abi(rd), imm, abi(rs1));
            let base = reg_val(regs_before, rs1);
            dto.rs1 = Some(abi(rs1));
            dto.rs1_val = Some(base);
            dto.imm = Some(imm);
            dto.mem_addr = Some((base as u32).wrapping_add(imm as u32));
            if rd != 0 {
                let loaded = reg_val(regs_after, rd);
                dto.rd = Some(abi(rd));
                dto.rd_old_val = Some(reg_val(regs_before, rd));
                dto.rd_new_val = Some(loaded);
                dto.mem_val = Some(loaded);
            }
        }
        Instruction::Sw { rs1, rs2, imm }
        | Instruction::Sh { rs1, rs2, imm }
        | Instruction::Sb { rs1, rs2, imm } => {
            dto.kind = "store".into();
            dto.symbol = Some("+".into());
            dto.asm_text = format!("{} {}, {}({})", inst.mnemonic(), abi(rs2), imm, abi(rs1));
            let base = reg_val(regs_before, rs1);
            let stored = reg_val(regs_before, rs2);
            dto.rs1 = Some(abi(rs1));
            dto.rs1_val = Some(base);
            dto.rs2 = Some(abi(rs2));
            dto.rs2_val = Some(stored);
            dto.imm = Some(imm);
            dto.mem_addr = Some((base as u32).wrapping_add(imm as u32));
            dto.mem_val = Some(stored);
        }
        Instruction::Ecall | Instruction::Ebreak => {
            dto.kind = "halt".into();
            dto.asm_text = inst.mnemonic().into();
        }
        _ => {}
    }

    Some(dto)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 契约守卫：确保所有前端读取的关键字段均为 camelCase。
    #[test]
    fn dto_serialization_uses_camel_case_contract() {
        let snap = MachineSnapshot {
            pc: 4,
            pc_line: 2,
            regs: BTreeMap::from([("x5".into(), 10)]),
            memory_words: BTreeMap::from([("0x1000".into(), 42)]),
            tick: 1,
            instructions: 1,
            output: String::new(),
            exit_code: None,
            pause_kind: "step".into(),
            pause_detail: "单步暂停".into(),
            halted: false,
            can_step: true,
            can_step_back: true,
            generated_assembly: None,
        };
        let step = StepPayload {
            snapshot: snap,
            reg_changes: BTreeMap::from([("x5".into(), 10)]),
            mem_changes: BTreeMap::new(),
            executed: None,
        };
        let v = serde_json::to_value(&step).unwrap();
        assert_eq!(v["pcLine"], 2);
        assert_eq!(v["canStep"], true);
        assert_eq!(v["canStepBack"], true);
        assert_eq!(v["pauseKind"], "step");
        assert_eq!(v["memoryWords"]["0x1000"], 42);
        assert_eq!(v["regChanges"]["x5"], 10);
        assert!(v.get("memChanges").is_some());
    }

    #[test]
    fn describe_executed_op_decodes_add_and_mv() {
        // add t2, t0, t1 => rd=7, rs1=5, rs2=6
        let add_word: u32 = (6 << 20) | (5 << 15) | (7 << 7) | 0x33;
        let before = BTreeMap::from([("x5".into(), 3), ("x6".into(), 5), ("x7".into(), 0)]);
        let after = BTreeMap::from([("x5".into(), 3), ("x6".into(), 5), ("x7".into(), 8)]);
        let op = describe_executed_op(add_word, 0, 4, 2, 3, &before, &after).unwrap();
        assert_eq!(op.kind, "alu");
        assert_eq!(op.op, "add");
        assert_eq!(op.symbol.as_deref(), Some("+"));
        assert_eq!(op.rs1.as_deref(), Some("t0"));
        assert_eq!(op.rs2.as_deref(), Some("t1"));
        assert_eq!(op.rd.as_deref(), Some("t2"));
        assert_eq!(op.rd_old_val, Some(0));
        assert_eq!(op.rd_new_val, Some(8));

        // mv t3, t0 (addi x28, x5, 0) 统一走 5 阶段 ALU (+0) 通路
        let mv_word: u32 = (5 << 15) | (28 << 7) | 0x13;
        let mv_op = describe_executed_op(mv_word, 4, 8, 3, 4, &before, &after).unwrap();
        assert_eq!(mv_op.kind, "alu");
        assert_eq!(mv_op.op, "mv");
        assert_eq!(mv_op.imm, Some(0));
        assert_eq!(mv_op.rs1.as_deref(), Some("t0"));
        assert_eq!(mv_op.rd.as_deref(), Some("t3"));
    }
}
