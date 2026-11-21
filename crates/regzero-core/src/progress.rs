//! 全局存档：`{应用数据目录}/user_progress.json`。
//!
//! 与编辑器草稿（localStorage）分开：草稿是"还没提交的代码"，存档是"通关记录"。
//! 格式（字段、默认值、版本迁移、损坏备份）见 `documents/存档格式.md`。

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

/// 存档格式版本。格式有破坏性变化时要 +1，并在 `migrate` 里处理旧版本。
pub const PROGRESS_VERSION: u32 = 1;

/// 存档文件名。
pub const PROGRESS_FILE: &str = "user_progress.json";

/// 单个关卡的通关记录。
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LevelProgress {
    #[serde(default)]
    pub level_id: String,
    #[serde(default)]
    pub passed: bool,
    /// 首次通过时间（ISO 8601）
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub completed_at: Option<String>,
    #[serde(default)]
    pub attempts: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub best_score: Option<u32>,
}

/// 全局存档。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UserProgress {
    #[serde(default = "default_version")]
    pub version: u32,
    #[serde(default)]
    pub last_modified: String,
    /// 关卡 ID → 记录
    #[serde(default)]
    pub levels: BTreeMap<String, LevelProgress>,
    #[serde(default)]
    pub settings: Settings,
}

fn default_version() -> u32 {
    PROGRESS_VERSION
}

impl Default for UserProgress {
    fn default() -> Self {
        Self {
            version: PROGRESS_VERSION,
            last_modified: now_iso(),
            levels: BTreeMap::new(),
            settings: Settings::default(),
        }
    }
}

/// 玩家设置。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    #[serde(default = "yes")]
    pub show_hints: bool,
    /// 自由探索模式：开启后所有关卡无需前置直接解锁（适合有基础的玩家）。
    #[serde(default)]
    pub free_explore: bool,
}

fn yes() -> bool {
    true
}

impl Default for Settings {
    fn default() -> Self {
        Self { show_hints: true, free_explore: false }
    }
}

impl UserProgress {
    /// 从文件读；文件不存在或损坏时返回一份空存档（并把坏文件备份成 `.bak`）。
    pub fn load(path: &Path) -> Self {
        let Ok(text) = std::fs::read_to_string(path) else {
            return Self::default();
        };
        match serde_json::from_str::<UserProgress>(&text) {
            Ok(p) => p.migrate(),
            Err(_) => {
                let _ = std::fs::rename(path, path.with_extension("json.bak"));
                Self::default()
            }
        }
    }

    /// 写入文件（自动创建目录）。
    pub fn save(&mut self, path: &Path) -> std::io::Result<()> {
        self.last_modified = now_iso();
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir)?;
        }
        let text = serde_json::to_string_pretty(self)?;
        std::fs::write(path, text)
    }

    /// 版本迁移（目前只有 v1，占位以便将来扩展）。
    fn migrate(mut self) -> Self {
        if self.version > PROGRESS_VERSION {
            // 来自更新版本的存档：尽量读，但不覆盖它的 version
            return self;
        }
        if self.version < PROGRESS_VERSION {
            self.version = PROGRESS_VERSION;
        }
        self
    }

    /// 记录一次提交结果。
    pub fn record(&mut self, level_id: &str, passed: bool, score: u32) -> &LevelProgress {
        let entry = self.levels.entry(level_id.to_string()).or_default();
        entry.level_id = level_id.to_string();
        entry.attempts += 1;
        entry.best_score = Some(entry.best_score.map_or(score, |b| b.max(score)));
        if passed && !entry.passed {
            entry.passed = true;
            entry.completed_at = Some(now_iso());
        }
        entry
    }

    pub fn is_passed(&self, level_id: &str) -> bool {
        self.levels.get(level_id).map(|l| l.passed).unwrap_or(false)
    }

    /// **"该去的那一关"**：第一个还没通过的关卡（按 `all_levels` 的顺序）。
    ///
    /// 侧边栏用它来提醒"你现在应该打这一关"，也用来在提示里报出上一关的名字。
    /// 全通关时返回 `None`。
    ///
    /// 注意它**不是**解锁判定的依据 —— 解锁规则见 [`Self::unlocked_levels`]
    /// （那个才是唯一入口，因为它能正确处理"玩过的关卡"和"以后往中间插关卡"的情况）。
    pub fn first_unlocked_level(&self, all_levels: &[String]) -> Option<String> {
        all_levels.iter().find(|id| !self.is_passed(id)).cloned()
    }

    /// 现在可以进的关卡 ID（按 `all_levels` 的顺序）。
    ///
    /// **规则**：一关解锁当且仅当 **它是第 1 关，或者它的上一关已经通过**。
    /// 这是用户原话"通过才解锁"的字面翻译，有两个好处：
    ///
    /// - 玩家**玩过的关卡永远是解锁的**（复习/重打），不会出现"我明明通了却显示锁着"；
    /// - 以后**往中间插关卡**或**修存档**时，不会因为历史顺序和当前顺序不一致而凭空多出锁。
    ///
    /// 历史上这里用的是"从第 1 关起连续通过的那一段 + 紧接着的那一关"，目的是让
    /// "手改存档把第 5 关写成通过"不能放行后面的关卡。**后来主动放弃了这条**：
    /// 用户明确要求"单机游戏不难为玩家、故意的不拦"，而防手改存档正属于"防作弊"，
    /// 代价却是正常场景下可能出现"已通过的关卡显示成锁着"。为了一个玩家本来就能
    /// 从地址栏绕过的场景去增加正常路径的怪异行为，不划算。
    pub fn unlocked_levels(&self, all_levels: &[String]) -> Vec<String> {
        all_levels
            .iter()
            .enumerate()
            .filter(|(i, _)| *i == 0 || self.is_passed(&all_levels[i - 1]))
            .map(|(_, id)| id.clone())
            .collect()
    }

    /// 这一关解锁了吗（线性旧接口，保留兼容单元测试）。
    pub fn is_unlocked(&self, level_id: &str, all_levels: &[String]) -> bool {
        self.unlocked_levels(all_levels).iter().any(|id| id == level_id)
    }

    /// **DAG 技能树解锁判定**（新版核心入口）：
    /// - 若开启了 `settings.free_explore`，且关卡在表中存在，则直接解锁；
    /// - 否则，该关卡所有 `prerequisites` 全部已通过时解锁（无前置的起点关天然解锁）；
    /// - 已通过的关卡始终保持解锁状态。
    pub fn is_unlocked_dag(
        &self,
        level_id: &str,
        prereq_map: &BTreeMap<String, Vec<String>>,
    ) -> bool {
        let Some(prereqs) = prereq_map.get(level_id) else {
            return false;
        };
        if self.settings.free_explore || self.is_passed(level_id) {
            return true;
        }
        prereqs.iter().all(|p| self.is_passed(p))
    }

    /// 按 `all_levels` 顺序返回当前 DAG 规则下所有已解锁关卡 ID。
    pub fn unlocked_levels_dag(
        &self,
        all_levels: &[String],
        prereq_map: &BTreeMap<String, Vec<String>>,
    ) -> Vec<String> {
        all_levels
            .iter()
            .filter(|id| self.is_unlocked_dag(id, prereq_map))
            .cloned()
            .collect()
    }

    pub fn attempts(&self, level_id: &str) -> u32 {
        self.levels.get(level_id).map(|l| l.attempts).unwrap_or(0)
    }

    /// 一共通过了几关。
    pub fn passed_count(&self) -> usize {
        self.levels.values().filter(|l| l.passed).count()
    }

    /// 章节完成情况：章节号 → (已通过, 总数)。
    pub fn chapter_progress(&self, all_levels: &[String]) -> BTreeMap<String, (usize, usize)> {
        let mut out: BTreeMap<String, (usize, usize)> = BTreeMap::new();
        for id in all_levels {
            let chapter = id.split('-').next().unwrap_or("?").to_string();
            let e = out.entry(chapter).or_insert((0, 0));
            e.1 += 1;
            if self.is_passed(id) {
                e.0 += 1;
            }
        }
        out
    }
}

/// 默认存档路径：优先用 Tauri 传入的应用数据目录，否则退回当前目录。
pub fn default_progress_path(app_data_dir: Option<&Path>) -> PathBuf {
    match app_data_dir {
        Some(d) => d.join(PROGRESS_FILE),
        None => std::env::current_dir()
            .unwrap_or_else(|_| PathBuf::from("."))
            .join(PROGRESS_FILE),
    }
}

/// 当前时间的 ISO 8601 字符串（在 `wasm32` 目标上避免 `SystemTime::now()` panic）。
pub fn now_iso() -> String {
    #[cfg(target_arch = "wasm32")]
    {
        String::new()
    }
    #[cfg(not(target_arch = "wasm32"))]
    {
        use std::time::{SystemTime, UNIX_EPOCH};
        let secs = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        format_iso(secs)
    }
}

/// 把 Unix 秒格式化成 `YYYY-MM-DDTHH:MM:SSZ`。
fn format_iso(secs: u64) -> String {
    let days = secs / 86_400;
    let rem = secs % 86_400;
    let (h, mi, s) = (rem / 3600, (rem % 3600) / 60, rem % 60);
    let (y, m, d) = civil_from_days(days as i64);
    format!("{:04}-{:02}-{:02}T{:02}:{:02}:{:02}Z", y, m, d, h, mi, s)
}

/// 天数 → (年, 月, 日)（Howard Hinnant 的算法）。
fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146_096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (if m <= 2 { y + 1 } else { y }, m, d)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn iso_formatting_is_correct() {
        // 1970-01-01T00:00:00Z
        assert_eq!(format_iso(0), "1970-01-01T00:00:00Z");
        // 2000-01-01T00:00:00Z = 946684800
        assert_eq!(format_iso(946_684_800), "2000-01-01T00:00:00Z");
        // 2024-02-29T12:34:56Z = 1709210096
        assert_eq!(format_iso(1_709_210_096), "2024-02-29T12:34:56Z");
    }

    #[test]
    fn recording_attempts_and_passes() {
        let mut p = UserProgress::default();
        p.record("1-1", false, 0);
        p.record("1-1", true, 100);
        assert!(p.is_passed("1-1"));
        assert_eq!(p.attempts("1-1"), 2);
        assert_eq!(p.levels["1-1"].best_score, Some(100));
        assert!(p.levels["1-1"].completed_at.is_some());
        // 已经通过之后再失败也不会取消通过
        p.record("1-1", false, 0);
        assert!(p.is_passed("1-1"));
        assert_eq!(p.passed_count(), 1);
    }

    #[test]
    fn round_trip_through_a_file() {
        let dir = std::env::temp_dir().join(format!("regzero-test-{}", std::process::id()));
        let path = dir.join(PROGRESS_FILE);
        let _ = std::fs::remove_dir_all(&dir);

        let mut p = UserProgress::default();
        p.record("1-1", true, 100);
        p.save(&path).unwrap();
        let back = UserProgress::load(&path);
        assert!(back.is_passed("1-1"));
        assert_eq!(back.attempts("1-1"), 1);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn corrupt_file_is_backed_up_and_reset() {
        let dir = std::env::temp_dir().join(format!("regzero-test-bad-{}", std::process::id()));
        let path = dir.join(PROGRESS_FILE);
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(&path, "{ 这不是 JSON").unwrap();
        let p = UserProgress::load(&path);
        assert_eq!(p.passed_count(), 0);
        assert!(dir.join("user_progress.json.bak").exists());
        let _ = std::fs::remove_dir_all(&dir);
    }

    // ── 进度门禁（"通过才解锁"）──────────────────────────────────────────

    /// 一份排序好的关卡表（和 `LevelStore::level_ids()` 的形状一样，只是不读磁盘）。
    fn level_ids() -> Vec<String> {
        vec![
            "1-1".to_string(),
            "1-2".to_string(),
            "1-3".to_string(),
            "1-4".to_string(),
            "1-5".to_string(),
            "1-6".to_string(),
            "2-1".to_string(),
        ]
    }

    fn pass(p: &mut UserProgress, ids: &[&str]) {
        for id in ids {
            p.record(id, true, 100);
        }
    }

    /// 全新存档：只有第 1 关解锁，第 2 关起全锁。
    #[test]
    fn fresh_save_unlocks_only_the_first_level() {
        let p = UserProgress::default();
        let all = level_ids();
        assert!(p.is_unlocked("1-1", &all), "第 1 关永远解锁");
        for id in ["1-2", "1-3", "1-6", "2-1"] {
            assert!(!p.is_unlocked(id, &all), "全新存档里 {} 不该解锁", id);
        }
        assert_eq!(p.unlocked_levels(&all), vec!["1-1".to_string()]);
        assert_eq!(p.first_unlocked_level(&all).as_deref(), Some("1-1"));
    }

    /// 通过 1-1 → 1-2 解锁，1-3 仍锁。
    #[test]
    fn passing_a_level_unlocks_exactly_the_next_one() {
        let mut p = UserProgress::default();
        let all = level_ids();
        pass(&mut p, &["1-1"]);
        assert!(p.is_unlocked("1-1", &all), "已通过的关卡要能重进重打");
        assert!(p.is_unlocked("1-2", &all));
        assert!(!p.is_unlocked("1-3", &all), "1-2 还没过，1-3 不能开");
        assert_eq!(p.unlocked_levels(&all), vec!["1-1".to_string(), "1-2".to_string()]);
    }

    /// 通过到一半（1-1、1-2 过，1-3 没过）→ 1-4 必须仍锁。
    #[test]
    fn a_gap_in_the_chain_keeps_everything_after_it_locked() {
        let mut p = UserProgress::default();
        let all = level_ids();
        pass(&mut p, &["1-1", "1-2"]);
        assert!(p.is_unlocked("1-3", &all), "该去的那一关是开着的");
        assert!(!p.is_unlocked("1-4", &all), "1-3 没过，1-4 不能提前看");
        assert!(!p.is_unlocked("2-1", &all));
        assert_eq!(p.unlocked_levels(&all).len(), 3);
    }

    /// 孤立通过的关卡（只可能来自手改存档）：手改成本很低，**我们不做防作弊**
    /// （用户明确要求："单机游戏不难为玩家，故意的不拦"）。
    ///
    /// 这条测试把"规则的边界在哪"钉清楚，免得以后有人以为解锁是"从头连着过才算"：
    /// 手改存档把 `1-5` 写成通过之后 ——
    /// - `1-5` **自己仍算锁着**（它的上一关 `1-4` 没通过）；
    /// - `1-6` **会解锁**（规则字面就是"上一关通过即解锁"，而 `1-5` 确实通过了）。
    ///
    /// 为什么不去堵这个口子：要堵就得改成"从头连着通过才算"，代价是**正常路径上**
    /// 一旦出现任何间隙（以后往中间插关卡、老存档版本不一致），玩家会看到
    /// "我明明通过的关卡显示成锁着的"。为了一个手改存档的场景牺牲正常体验，不划算。
    #[test]
    fn an_orphan_pass_is_kept_simple_on_purpose() {
        let mut p = UserProgress::default();
        let all = level_ids();
        pass(&mut p, &["1-5"]);
        assert!(!p.is_unlocked("1-5", &all), "上一关 1-4 没过，所以 1-5 自己仍算锁着");
        assert!(p.is_unlocked("1-6", &all), "规则就是「上一关通过即解锁」——1-5 通过了");
        assert!(!p.is_unlocked("1-2", &all), "跳关不能把前面的关卡也放出来");
        assert!(!p.is_unlocked("2-1", &all), "1-15 没过，第二章不能开");
        assert_eq!(p.unlocked_levels(&all).len(), 2, "只有 1-1 与 1-6");
    }

    /// 全部通过：没有"该去的那一关"了，全部可重打。
    #[test]
    fn a_finished_game_has_everything_unlocked() {
        let mut p = UserProgress::default();
        let all = level_ids();
        for id in &all {
            p.record(id, true, 100);
        }
        assert!(all.iter().all(|id| p.is_unlocked(id, &all)));
        assert_eq!(p.first_unlocked_level(&all), None);
        assert_eq!(p.unlocked_levels(&all).len(), all.len());
    }

    /// 关卡表里没有这一关：报"没解锁"，而不是 panic 或默认放行。
    ///
    /// 宁可多拦一关，也不能因为查不到就放行 —— 门禁的失败方向必须是"拦住"。
    #[test]
    fn an_unknown_level_id_is_treated_as_locked() {
        let p = UserProgress::default();
        let all = level_ids();
        assert!(!p.is_unlocked("99-99", &all));
        assert!(!p.is_unlocked("1-1", &[]), "没有关卡表时不该假设第 1 关存在");
    }

    #[test]
    fn chapter_progress_counts() {
        let mut p = UserProgress::default();
        p.record("1-1", true, 100);
        p.record("1-2", false, 0);
        let all = vec!["1-1".to_string(), "1-2".to_string(), "2-1".to_string()];
        let ch = p.chapter_progress(&all);
        assert_eq!(ch["1"], (1, 2));
        assert_eq!(ch["2"], (0, 1));
    }
}
