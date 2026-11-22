//! RegZero（零号寄存器）领域层。
//!
//! 承载游戏核心逻辑：关卡与 Wiki 加载、运行器、判定器、DAG 进度存档、共享 DTO 与自检。
//! 不依赖任何桌面壳或浏览器运行时，同时编译到原生与 `wasm32-unknown-unknown`。

pub mod config;
pub mod dto;
pub mod embedded;
pub mod fuzz;
pub mod judge;
pub mod levels;
pub mod progress;
pub mod runner;

#[cfg(test)]
mod selfcheck;

pub use config::{CallSpec, Goal, Language, LevelConfig, MemExpect, TestCase};
pub use fuzz::GeneratedSpec;
pub use judge::{judge, Diff, FailureReason, FailureSite, TestVerdict, Verdict};
pub use levels::{
    EditorConfig, GoalSummary, HintItem, LevelBundle, LevelError, LevelKind, LevelMeta,
    LevelSource, LevelStore,
};
pub use progress::{LevelProgress, Settings, UserProgress};
pub use runner::{CaseOutcome, CodeError, ErrorKind, MachineState, Runner};
