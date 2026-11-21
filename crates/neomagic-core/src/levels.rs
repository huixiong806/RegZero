//! 关卡与 Wiki 加载器：从 `content/levels/cN_M/` 与 `content/wiki/` 读取结构化内容。
//!
//! 单关目录约定（见 `documents/关卡编写规范.md`）：
//!
//! ```text
//! content/levels/c1_1/
//!   ├── meta.json      ← 元信息、DAG 前置、沙盘配置、编辑约束、3 级提示
//!   ├── lesson.md      ← 精简任务说明（≤300 字）
//!   ├── starter.s|c    ← 初始脚手架代码
//!   ├── tests.json     ← 测例、白名单、判定目标
//!   └── solution.s|c   ← 参考解（引擎自检使用）
//! ```

use crate::config::{Language, LevelConfig};
use crate::judge::{judge, Verdict};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};

/// 关卡节点类型：概念关 / 巩固关 / 硬核支线挑战关。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LevelKind {
    #[default]
    Lesson,
    Practice,
    Challenge,
}

/// 关卡顶部一句话目标卡（Before → After）。
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GoalSummary {
    pub before: String,
    pub after: String,
}

/// 首次进场的多页口语化微引导（每页 1~2 句话，结束后动画收起至「规则」按钮）。
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BriefingSlide {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tag: Option<String>,
    pub text: String,
}

/// 按需展开的分级提示（1 思路 / 2 步骤 / 3 代码片段）。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HintItem {
    pub level: u8,
    #[serde(rename = "type")]
    pub kind: String,
    pub content: String,
}

/// 编辑器工具栏按钮配置。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolbarConfig {
    #[serde(default = "yes")]
    pub run: bool,
    #[serde(default = "yes")]
    pub debug: bool,
    #[serde(default = "yes")]
    pub submit: bool,
    #[serde(default = "yes")]
    pub load: bool,
    #[serde(default = "yes")]
    pub save: bool,
}

fn yes() -> bool {
    true
}

impl Default for ToolbarConfig {
    fn default() -> Self {
        Self { run: true, debug: true, submit: true, load: true, save: true }
    }
}

/// 关卡编辑器约束配置（直接序列化给前端）。
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EditorConfig {
    #[serde(default)]
    pub level: String,
    #[serde(default)]
    pub language: Language,
    #[serde(default = "yes")]
    pub line_numbers: bool,
    /// 前 N 行只读
    #[serde(default)]
    pub readonly_prefix: usize,
    /// 后 N 行只读
    #[serde(default)]
    pub readonly_suffix: usize,
    /// 隐藏行（1-based）
    #[serde(default)]
    pub hidden: Vec<usize>,
    /// 高亮行（1-based）
    #[serde(default)]
    pub highlight: Vec<usize>,
    /// 行号（1-based）→ 提示文本
    #[serde(default)]
    pub suggested: BTreeMap<usize, String>,
    /// 工具栏显隐
    #[serde(default)]
    pub toolbar: ToolbarConfig,
}

/// 单关 `meta.json` 完整元信息。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LevelMeta {
    pub id: String,
    pub chapter: u32,
    /// 章内排序键（支持小数，例如 `4.5` 表示挂在 `1-4` 旁的支线 `1-4S`）
    #[serde(default)]
    pub order: f64,
    #[serde(default)]
    pub kind: LevelKind,
    pub title: String,
    #[serde(default = "default_mode")]
    pub mode: String,
    #[serde(default)]
    pub allow_local_file: bool,
    #[serde(default)]
    pub language: Language,
    /// DAG 前置依赖关卡 ID 列表
    #[serde(default)]
    pub prerequisites: Vec<String>,
    /// 可选最优指令条数挑战指标（含程序全部机器码指令）
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub par_instructions: Option<usize>,
    #[serde(default)]
    pub concepts: Vec<String>,
    #[serde(default)]
    pub goal_summary: GoalSummary,
    /// 首次进入该关弹出的多页口语化微引导卡片
    #[serde(default)]
    pub briefing: Vec<BriefingSlide>,
    /// 数据驱动沙盘配置（保持 JSON 开放结构，便于 4 套沙盘独立演进）
    #[serde(default)]
    pub sandbox: serde_json::Value,
    #[serde(default)]
    pub editor: EditorConfig,
    #[serde(default)]
    pub hints: Vec<HintItem>,
    #[serde(default)]
    pub wiki_refs: Vec<String>,
}

fn default_mode() -> String {
    "online".to_string()
}

/// 单关的静态教学内容（`meta.json` + `lesson.md` + `starter`）。
#[derive(Debug, Clone)]
pub struct LevelSource {
    pub dir: PathBuf,
    pub meta: LevelMeta,
    pub lesson_markdown: String,
    pub editor: EditorConfig,
    pub initial_code: String,
}

/// 关卡加载错误。
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LevelError {
    NotFound(String),
    BadMeta { path: PathBuf, message: String },
    BadTestConfig { path: PathBuf, message: String },
    LevelIdMismatch { expected: String, actual: String },
}

impl std::fmt::Display for LevelError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            LevelError::NotFound(id) => write!(f, "找不到关卡 {}", id),
            LevelError::BadMeta { path, message } => {
                write!(f, "{} 的元数据有问题：{}", path.display(), message)
            }
            LevelError::BadTestConfig { path, message } => {
                write!(f, "{} 的测例有问题：{}", path.display(), message)
            }
            LevelError::LevelIdMismatch { expected, actual } => {
                write!(f, "关卡 ID 不一致：期望 {}，配置里写的是 {}", expected, actual)
            }
        }
    }
}

/// 单关完整数据包（元数据 + 正文 + 初始代码 + 测例 + 参考解）。
#[derive(Debug, Clone)]
pub struct LevelBundle {
    pub id: String,
    pub source: LevelSource,
    pub config: LevelConfig,
    pub solution: Option<String>,
}

/// 关卡与 Wiki 仓库（支持磁盘目录与编译期嵌入双后端）。
#[derive(Debug, Clone)]
pub struct LevelStore {
    content: Content,
}

#[derive(Debug, Clone)]
enum Content {
    Dir(PathBuf),
    Embedded,
}

impl Content {
    fn read(&self, rel: &str) -> Option<String> {
        match self {
            Content::Dir(root) => std::fs::read_to_string(root.join(rel)).ok(),
            Content::Embedded => {
                crate::embedded::read(rel).map(|b| String::from_utf8_lossy(b).to_string())
            }
        }
    }

    fn exists(&self, rel: &str) -> bool {
        match self {
            Content::Dir(root) => root.join(rel).exists(),
            Content::Embedded => crate::embedded::read(rel).is_some(),
        }
    }

    /// 枚举 `levels/` 下所有包含 `meta.json` 与 `tests.json` 的关卡目录名（如 `c1_1`、`c1_4s`）。
    fn level_dirs(&self) -> Vec<String> {
        let mut dirs: BTreeSet<String> = BTreeSet::new();
        match self {
            Content::Dir(root) => {
                let Ok(entries) = std::fs::read_dir(root.join("levels")) else {
                    return Vec::new();
                };
                for entry in entries.flatten() {
                    if entry.path().is_dir() {
                        let name = entry.file_name().to_string_lossy().to_string();
                        if self.exists(&format!("levels/{}/meta.json", name))
                            && self.exists(&format!("levels/{}/tests.json", name))
                        {
                            dirs.insert(name);
                        }
                    }
                }
            }
            Content::Embedded => {
                for rel in crate::embedded::paths() {
                    let Some(rest) = rel.strip_prefix("levels/") else { continue };
                    let Some((dir, file)) = rest.split_once('/') else { continue };
                    if file == "meta.json" && self.exists(&format!("levels/{}/tests.json", dir)) {
                        dirs.insert(dir.to_string());
                    }
                }
            }
        }
        dirs.into_iter().collect()
    }

    /// 枚举 `wiki/` 下所有结构化词条名（不含 `.json` 后缀）。
    fn wiki_topics(&self) -> Vec<String> {
        let mut topics: BTreeSet<String> = BTreeSet::new();
        match self {
            Content::Dir(root) => {
                let Ok(entries) = std::fs::read_dir(root.join("wiki")) else {
                    return Vec::new();
                };
                for entry in entries.flatten() {
                    let name = entry.file_name().to_string_lossy().to_string();
                    if let Some(stem) = name.strip_suffix(".json") {
                        topics.insert(stem.to_string());
                    }
                }
            }
            Content::Embedded => {
                for rel in crate::embedded::paths() {
                    let Some(name) = rel.strip_prefix("wiki/") else { continue };
                    if !name.contains('/') {
                        if let Some(stem) = name.strip_suffix(".json") {
                            topics.insert(stem.to_string());
                        }
                    }
                }
            }
        }
        topics.into_iter().collect()
    }
}

impl LevelStore {
    /// 用 `content` 目录构造。
    pub fn new(content_dir: impl Into<PathBuf>) -> Self {
        Self { content: Content::Dir(content_dir.into()) }
    }

    /// 用编译期嵌入的内容构造（供 WASM 与单文件分发使用）。
    pub fn embedded() -> Self {
        assert!(
            cfg!(feature = "embedded-content"),
            "LevelStore::embedded() 需要 neomagic-core 的 embedded-content 特性"
        );
        Self { content: Content::Embedded }
    }

    /// 从仓库根路径定位 `content/`。
    pub fn from_repo_root(root: impl AsRef<Path>) -> Self {
        Self::new(root.as_ref().join("content"))
    }

    /// 定位当前仓库的 `content/` 目录。
    pub fn default_repo() -> Self {
        let here = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let root = here.parent().and_then(|p| p.parent()).unwrap_or(&here).to_path_buf();
        Self::from_repo_root(root)
    }

    /// 开发时优先读磁盘目录，打包环境自动回退编译期嵌入内容。
    pub fn prefer_repo_or_embedded() -> Self {
        let store = Self::default_repo();
        if store.content_root().join("levels").is_dir() {
            store
        } else {
            Self::embedded()
        }
    }

    /// 内容根目录（嵌入模式下返回可读占位）。
    pub fn content_root(&self) -> PathBuf {
        match &self.content {
            Content::Dir(d) => d.clone(),
            Content::Embedded => PathBuf::from("<嵌入内容>"),
        }
    }

    pub fn content_dir(&self) -> PathBuf {
        self.content_root()
    }

    /// 返回按 `(chapter, order, id)` 排好序的全部关卡 ID。
    pub fn level_ids(&self) -> Vec<String> {
        let mut items: Vec<(u32, i64, String)> = Vec::new();
        for dir in self.content.level_dirs() {
            let rel = format!("levels/{}/meta.json", dir);
            let Some(text) = self.content.read(&rel) else { continue };
            let Ok(meta) = serde_json::from_str::<LevelMeta>(&text) else { continue };
            let order_key = (meta.order * 1000.0).round() as i64;
            items.push((meta.chapter, order_key, meta.id));
        }
        items.sort_by(|a, b| (a.0, a.1, &a.2).cmp(&(b.0, b.1, &b.2)));
        items.into_iter().map(|(_, _, id)| id).collect()
    }

    /// 全部关卡 ID（别名）。
    pub fn all(&self) -> Vec<String> {
        self.level_ids()
    }

    /// 关卡 ID（如 `"1-4S"`）对应的目录名（如 `"c1_4s"`）。
    fn dir_name(id: &str) -> String {
        format!("c{}", id.to_ascii_lowercase().replace('-', "_"))
    }

    /// 读取关卡元信息与静态页面/初始代码。
    pub fn load_source(&self, id: &str) -> Result<LevelSource, LevelError> {
        let dir_name = Self::dir_name(id);
        let meta_rel = format!("levels/{}/meta.json", dir_name);
        let meta_path = self.content_root().join(&meta_rel);
        let Some(meta_text) = self.content.read(&meta_rel) else {
            return Err(LevelError::NotFound(id.to_string()));
        };
        let mut meta: LevelMeta = serde_json::from_str(&meta_text).map_err(|e| {
            LevelError::BadMeta { path: meta_path.clone(), message: e.to_string() }
        })?;
        if meta.id != id {
            return Err(LevelError::LevelIdMismatch {
                expected: id.to_string(),
                actual: meta.id,
            });
        }

        // 补齐 editor 中的冗余字段，确保前后端一致
        meta.editor.level = meta.id.clone();
        meta.editor.language = meta.language;

        let lesson_markdown = self
            .content
            .read(&format!("levels/{}/lesson.md", dir_name))
            .unwrap_or_default()
            .replace("\r\n", "\n");

        let ext = language_ext(meta.language);
        let mut initial_code = self
            .content
            .read(&format!("levels/{}/starter.{}", dir_name, ext))
            .unwrap_or_default()
            .replace("\r\n", "\n");
        while initial_code.ends_with('\n') {
            initial_code.pop();
        }

        let editor = meta.editor.clone();
        Ok(LevelSource {
            dir: self.content_root().join(format!("levels/{}", dir_name)),
            meta,
            lesson_markdown,
            editor,
            initial_code,
        })
    }

    /// 读取测例与判定配置。
    pub fn load_config(&self, id: &str) -> Result<LevelConfig, LevelError> {
        let dir_name = Self::dir_name(id);
        let rel = format!("levels/{}/tests.json", dir_name);
        let path = self.content_root().join(&rel);
        let Some(text) = self.content.read(&rel) else {
            return Err(LevelError::NotFound(id.to_string()));
        };
        let cfg = LevelConfig::parse(&text).map_err(|e| LevelError::BadTestConfig {
            path: path.clone(),
            message: e,
        })?;
        if !cfg.level.is_empty() && cfg.level != id && cfg.level != "（未知关卡）" {
            return Err(LevelError::LevelIdMismatch {
                expected: id.to_string(),
                actual: cfg.level,
            });
        }
        Ok(cfg)
    }

    /// 加载单关完整数据包。
    pub fn load(&self, id: &str) -> Result<LevelBundle, LevelError> {
        let source = self.load_source(id)?;
        let mut config = self.load_config(id)?;
        if config.language == Language::Asm && source.meta.language == Language::C {
            config.language = Language::C;
        }
        let ext = language_ext(config.language);
        let sol_rel = format!("levels/{}/solution.{}", Self::dir_name(id), ext);
        let solution = self.content.read(&sol_rel).map(|s| s.replace("\r\n", "\n"));
        Ok(LevelBundle { id: id.to_string(), source, config, solution })
    }

    /// 构建全仓关卡的 DAG 前置映射（`level_id -> prerequisites`）。
    pub fn prerequisite_map(&self) -> BTreeMap<String, Vec<String>> {
        let mut map = BTreeMap::new();
        for id in self.level_ids() {
            if let Ok(src) = self.load_source(&id) {
                map.insert(id, src.meta.prerequisites);
            }
        }
        map
    }

    /// 枚举全部 Wiki 词条 ID。
    pub fn wiki_topics(&self) -> Vec<String> {
        self.content.wiki_topics()
    }

    /// 读取并解析单篇结构化 Wiki 词条（`content/wiki/<topic>.json`）。
    pub fn load_wiki(&self, topic: &str) -> Result<crate::dto::WikiEntry, String> {
        let rel = format!("wiki/{}.json", topic);
        let raw = self
            .content
            .read(&rel)
            .ok_or_else(|| format!("找不到概念图鉴词条：{}", topic))?;
        let entry: crate::dto::WikiEntry = serde_json::from_str(&raw)
            .map_err(|e| format!("解析概念图鉴 {} 失败：{}", rel, e))?;
        if entry.topic != topic {
            return Err(format!(
                "概念图鉴 {} 的 topic 字段为 `{}`，与文件名不一致",
                rel, entry.topic
            ));
        }
        Ok(entry)
    }

    /// 按 `(order, topic)` 顺序读取全部结构化 Wiki 词条。
    pub fn list_wiki(&self) -> Result<Vec<crate::dto::WikiEntry>, String> {
        let mut out = Vec::new();
        for topic in self.wiki_topics() {
            out.push(self.load_wiki(&topic)?);
        }
        out.sort_by(|a, b| (a.order, &a.topic).cmp(&(b.order, &b.topic)));
        Ok(out)
    }

    /// 关卡自检：用参考解跑一遍判定确认可解。
    pub fn self_check(&self, id: &str) -> Result<Verdict, String> {
        let bundle = self.load(id).map_err(|e| e.to_string())?;
        let Some(solution) = &bundle.solution else {
            return Err(format!(
                "关卡 {} 没有参考解（应放在 content/levels/{}/solution.{}）",
                id,
                Self::dir_name(id),
                language_ext(bundle.config.language)
            ));
        };
        Ok(judge(&bundle.config, solution))
    }
}

fn language_ext(lang: Language) -> &'static str {
    match lang {
        Language::Asm => "s",
        Language::C => "c",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dir_name_handles_main_and_side_levels() {
        assert_eq!(LevelStore::dir_name("1-1"), "c1_1");
        assert_eq!(LevelStore::dir_name("1-4S"), "c1_4s");
        assert_eq!(LevelStore::dir_name("1-7S"), "c1_7s");
    }

    #[test]
    fn loads_repo_levels_in_order() {
        let store = LevelStore::default_repo();
        let ids = store.level_ids();
        assert!(ids.len() >= 9, "应至少加载 Phase 1 的 9 个关卡，实际：{:?}", ids);
        assert_eq!(ids[0], "1-1");
        assert!(ids.contains(&"1-4S".to_string()));
        assert!(ids.contains(&"1-7S".to_string()));
        // 1-4S (order 4.5) 应排在 1-4 (order 4) 与 1-5 (order 5) 之间
        let p4 = ids.iter().position(|x| x == "1-4").unwrap();
        let p4s = ids.iter().position(|x| x == "1-4S").unwrap();
        let p5 = ids.iter().position(|x| x == "1-5").unwrap();
        assert!(p4 < p4s && p4s < p5);
    }
}
