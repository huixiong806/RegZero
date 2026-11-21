//! 前后端共享传输结构体（DTO），统一 `camelCase`。
//!
//! 同时服务于 `crates/nmc-wasm` 与未来的 `crates/nmc-bridge`，
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
    pub passed: bool,
    pub unlocked: bool,
    pub attempts: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub best_score: Option<u32>,
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

/// 单步 / 倒退结果：在快照上附加变化差量，驱动前端闪烁动画。
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct StepPayload {
    #[serde(flatten)]
    pub snapshot: MachineSnapshot,
    /// 本步发生变化的寄存器（规范名 → 新值）
    pub reg_changes: BTreeMap<String, u32>,
    /// 本步发生变化的内存字节（地址 → 新字节），最多 64 条
    pub mem_changes: BTreeMap<u32, u8>,
}

/// 单条测例判定结果。
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct TestVerdictDto {
    pub name: String,
    pub passed: bool,
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
    /// 静态编译产出的机器码指令条数（可用于指令数 Par 挑战）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub instruction_count: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub par_instructions: Option<usize>,
    pub met_par: bool,
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

/// 将领域层 `Verdict` 转换为标准 `SubmitDto`。
pub fn verdict_to_submit_dto(
    level: &str,
    verdict: Verdict,
    instruction_count: Option<usize>,
    par_instructions: Option<usize>,
) -> SubmitDto {
    let met_par = match (verdict.passed, instruction_count, par_instructions) {
        (true, Some(count), Some(par)) => count <= par,
        _ => false,
    };
    SubmitDto {
        level: level.to_string(),
        passed: verdict.passed,
        score: verdict.score,
        instruction_count,
        par_instructions,
        met_par,
        summary: verdict.summary,
        tests: verdict
            .tests
            .into_iter()
            .map(|t| TestVerdictDto {
                name: t.name,
                passed: t.passed,
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
            })
            .collect(),
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
}
