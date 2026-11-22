//! **关卡自检与一致性守卫**：确保 `content/levels/` 下每个关卡可解、DAG 合法且无配置漂移。

use crate::judge::Verdict;
use crate::levels::LevelStore;
use std::collections::BTreeSet;

/// 对全部关卡跑自检，返回报告文本。失败时 `Err` 里列出有问题的关卡。
pub fn check_all() -> Result<String, String> {
    let store = LevelStore::default_repo();
    let ids = store.level_ids();
    if ids.is_empty() {
        return Err(format!("在 {} 里没有找到任何关卡", store.content_dir().display()));
    }

    let mut ok = Vec::new();
    let mut bad = Vec::new();
    let mut missing_solution = Vec::new();

    for id in &ids {
        match store.self_check(id) {
            Ok(Verdict { passed: true, summary, total_steps, .. }) => {
                ok.push(format!("{} ✓ {}（{} 步）", id, summary, total_steps))
            }
            Ok(v) => bad.push(format!("{} ✗ {}", id, v.summary)),
            Err(e) => {
                if e.contains("没有参考解") {
                    missing_solution.push(format!("{}：{}", id, e));
                } else {
                    bad.push(format!("{} ✗ {}", id, e));
                }
            }
        }
    }

    if bad.is_empty() && missing_solution.is_empty() {
        let mut report = format!("全部 {} 个关卡自检通过：\n", ok.len());
        for l in &ok {
            report.push_str("  ");
            report.push_str(l);
            report.push('\n');
        }
        Ok(report)
    } else {
        let mut msg = String::new();
        if !bad.is_empty() {
            msg.push_str("以下关卡用参考解跑不过（测例或参考解有问题）：\n");
            for l in &bad {
                msg.push_str("  ");
                msg.push_str(l);
                msg.push('\n');
            }
        }
        if !missing_solution.is_empty() {
            msg.push_str("以下关卡缺少参考解：\n");
            for l in &missing_solution {
                msg.push_str("  ");
                msg.push_str(l);
                msg.push('\n');
            }
        }
        Err(msg)
    }
}

#[test]
fn every_level_is_solvable_with_its_reference_solution() {
    match check_all() {
        Ok(report) => println!("{}", report),
        Err(msg) => panic!("{}", msg),
    }
}

/// 关卡元数据、编辑约束、DAG 前置、Par 指标、结构化 Wiki 与无魔法词汇一致性守卫。
#[test]
fn every_level_page_and_test_config_are_consistent() {
    let store = LevelStore::default_repo();
    let ids = store.level_ids();
    assert!(!ids.is_empty(), "没有找到任何关卡");
    let known_ids: BTreeSet<String> = ids.iter().cloned().collect();
    let wiki_entries = store.list_wiki().expect("所有 content/wiki/*.json 必须能正确解析");
    assert!(!wiki_entries.is_empty(), "没有找到任何结构化 Wiki 词条");
    let wiki_map: std::collections::BTreeMap<String, crate::dto::WikiEntry> =
        wiki_entries.iter().cloned().map(|w| (w.topic.clone(), w)).collect();
    let forbidden_story_words = ["魔导", "星之语", "星咒", "记忆晶阵", "星泠", "岩舟"];

    let mut problems = Vec::new();
    for entry in &wiki_entries {
        problems.extend(check_wiki_entry(entry, &forbidden_story_words));
    }

    for id in &ids {
        match store.load(id) {
            Ok(bundle) => {
                let meta = &bundle.source.meta;
                if meta.language != bundle.config.language {
                    problems.push(format!(
                        "{}：meta.json 写的是 {:?}，tests.json 写的是 {:?}",
                        id, meta.language, bundle.config.language
                    ));
                }
                if bundle.source.initial_code.trim().is_empty() {
                    problems.push(format!("{}：缺少初始代码 starter", id));
                }
                if bundle.source.lesson_markdown.trim().is_empty() {
                    problems.push(format!("{}：lesson.md 为空", id));
                }
                if meta.hints.is_empty() {
                    problems.push(format!("{}：缺少分级提示 hints", id));
                }
                if meta.goal_summary.before.trim().is_empty()
                    || meta.goal_summary.after.trim().is_empty()
                {
                    problems.push(format!("{}：goalSummary 的 before/after 不能为空", id));
                }

                // 校验 DAG 前置全部存在且不自引用
                for pre in &meta.prerequisites {
                    if pre == id {
                        problems.push(format!("{}：prerequisites 不能引用自身", id));
                    } else if !known_ids.contains(pre) {
                        problems.push(format!("{}：前置关卡 {} 不存在", id, pre));
                    }
                }

                // 校验关卡引用的 wikiRefs 全部存在
                for topic in &meta.wiki_refs {
                    if !wiki_map.contains_key(topic) {
                        problems.push(format!("{}：wikiRefs 引用了不存在的词条 `{}`", id, topic));
                    }
                }

                // 校验静态 Par 指令数：参考解必须满足 <= parInstructions
                if let (Some(par), Some(sol)) = (meta.par_instructions, &bundle.solution) {
                    match crate::runner::Runner::new(bundle.config.clone(), sol) {
                        Ok(runner) => {
                            let count = runner.words().len();
                            if count > par {
                                problems.push(format!(
                                    "{}：参考解共 {} 条指令，超过了 parInstructions = {}",
                                    id, count, par
                                ));
                            }
                        }
                        Err(e) => problems.push(format!("{}：参考解编译失败：{:?}", id, e)),
                    }
                }

                // 校验动态性能金牌目标：参考解在完整固定基准集上的运行总步数必须满足 <= parSteps
                if let (Some(par_s), Some(sol)) = (meta.par_steps, &bundle.solution) {
                    match bundle.config.expand_with_oracle(Some(sol), None) {
                        Ok(expanded) => {
                            let v = crate::judge(&expanded, sol);
                            if !v.passed {
                                problems.push(format!("{}：参考解未通过判定：{}", id, v.summary));
                            } else if v.total_steps > par_s {
                                problems.push(format!(
                                    "{}：参考解在 {} 组基准测例中共执行 {} 步，超过了性能金牌目标 parSteps = {}",
                                    id, v.benchmark_count, v.total_steps, par_s
                                ));
                            }
                        }
                        Err(e) => problems.push(format!("{}：展开生成测例失败：{}", id, e)),
                    }
                }

                // 校验首次进场微引导（briefing）非空且无废弃剧情词
                for (bi, slide) in meta.briefing.iter().enumerate() {
                    if slide.text.trim().is_empty() {
                        problems.push(format!("{}：briefing[{}] 的 text 不能为空", id, bi));
                    }
                    for word in forbidden_story_words {
                        if slide.text.contains(word) {
                            problems.push(format!(
                                "{}：briefing[{}] 检测到废弃魔法/剧情词 `{}`",
                                id, bi, word
                            ));
                        }
                    }
                }

                // 校验无历史魔法/剧情词汇残留
                for word in forbidden_story_words {
                    if meta.title.contains(word)
                        || bundle.source.lesson_markdown.contains(word)
                        || bundle.source.initial_code.contains(word)
                    {
                        problems.push(format!("{}：检测到废弃魔法/剧情词 `{}`", id, word));
                    }
                }

                problems.extend(check_editor_constraints(&bundle));
            }
            Err(e) => problems.push(format!("{}：{}", id, e)),
        }
    }
    assert!(problems.is_empty(), "关卡配置不一致：\n{}", problems.join("\n"));
}

#[cfg(test)]
fn check_wiki_entry(entry: &crate::dto::WikiEntry, forbidden: &[&str]) -> Vec<String> {
    let mut problems = Vec::new();
    if entry.title.trim().is_empty() {
        problems.push(format!("wiki/{}：title 不能为空", entry.topic));
    }
    if entry.sections.is_empty() {
        problems.push(format!("wiki/{}：sections 不能为空", entry.topic));
    }
    let check_text = |text: &str, ctx: &str, problems: &mut Vec<String>| {
        for word in forbidden {
            if text.contains(word) {
                problems.push(format!("wiki/{} ({})：检测到废弃剧情词 `{}`", entry.topic, ctx, word));
            }
        }
    };
    check_text(&entry.title, "title", &mut problems);
    if let Some(summary) = &entry.summary {
        check_text(summary, "summary", &mut problems);
    }
    let mut seen_sections = BTreeSet::new();
    for sec in &entry.sections {
        if !seen_sections.insert(sec.id.as_str()) {
            problems.push(format!("wiki/{}：重复的 section id `{}`", entry.topic, sec.id));
        }
        if let Some(h) = &sec.heading {
            check_text(h, &sec.id, &mut problems);
        }
        match &sec.body {
            crate::dto::WikiSectionBody::Markdown { markdown } => {
                if markdown.trim().is_empty() {
                    problems.push(format!("wiki/{}：markdown 段 `{}` 不能为空", entry.topic, sec.id));
                }
                check_text(markdown, &sec.id, &mut problems);
            }
            crate::dto::WikiSectionBody::Table { columns, rows } => {
                if columns.is_empty() || rows.is_empty() {
                    problems.push(format!(
                        "wiki/{}：table 段 `{}` 的 columns 与 rows 均不能为空",
                        entry.topic, sec.id
                    ));
                }
                let col_ids: BTreeSet<&str> = columns.iter().map(|c| c.id.as_str()).collect();
                for row in rows {
                    for (k, v) in &row.cells {
                        if !col_ids.contains(k.as_str()) {
                            problems.push(format!(
                                "wiki/{}：table `{}` 行 `{}` 引用了未定义列 `{}`",
                                entry.topic, sec.id, row.id, k
                            ));
                        }
                        check_text(v, &row.id, &mut problems);
                    }
                }
            }
        }
    }
    problems
}

fn check_editor_constraints(bundle: &crate::levels::LevelBundle) -> Vec<String> {
    let mut problems = Vec::new();
    let id = &bundle.id;
    let total = bundle.source.initial_code.lines().count();
    let c = &bundle.source.editor;

    for (name, n) in [
        ("readonlyPrefix", c.readonly_prefix),
        ("readonlySuffix", c.readonly_suffix),
    ] {
        if n > total {
            problems.push(format!(
                "{}：editor.{} = {}，但初始代码只有 {} 行",
                id, name, n, total
            ));
        }
    }
    if c.readonly_prefix + c.readonly_suffix >= total && total > 0 {
        problems.push(format!(
            "{}：readonlyPrefix({}) + readonlySuffix({}) 锁死了全部 {} 行",
            id, c.readonly_prefix, c.readonly_suffix, total
        ));
    }
    for (which, lines) in [("hidden", &c.hidden), ("highlight", &c.highlight)] {
        for &n in lines {
            if n == 0 || n > total {
                problems.push(format!(
                    "{}：editor.{} 里的 {} 超出 1..={} 范围",
                    id, which, n, total
                ));
            }
        }
    }
    for &line in c.suggested.keys() {
        if line == 0 || line > total {
            problems.push(format!(
                "{}：editor.suggested 的键 {} 超出 1..={} 范围",
                id, line, total
            ));
        }
    }
    problems
}

/// 嵌入内容必须与磁盘目录完全一致（WASM 打包的生命线）。
#[test]
#[cfg(feature = "embedded-content")]
fn embedded_content_matches_the_repository() {
    assert!(crate::embedded::count() > 0, "嵌入清单为空，build.rs 未生成内容");

    let disk = LevelStore::default_repo();
    let embedded = LevelStore::embedded();

    let disk_ids = disk.level_ids();
    let emb_ids = embedded.level_ids();
    assert_eq!(disk_ids, emb_ids, "嵌入关卡列表与仓库不一致");
    assert_eq!(disk.wiki_topics(), embedded.wiki_topics(), "嵌入 Wiki 列表与仓库不一致");

    for id in &disk_ids {
        let d = disk.load(id).unwrap_or_else(|e| panic!("磁盘读不到 {}：{}", id, e));
        let e = embedded.load(id).unwrap_or_else(|err| panic!("嵌入读不到 {}：{}", id, err));
        assert_eq!(d.source.initial_code, e.source.initial_code, "{} 初始代码不一致", id);
        assert_eq!(d.source.lesson_markdown, e.source.lesson_markdown, "{} 正文不一致", id);
        assert_eq!(d.solution, e.solution, "{} 参考解不一致", id);
        assert_eq!(d.source.meta.title, e.source.meta.title, "{} 标题不一致", id);
    }
}

#[test]
fn judge_registry_is_wired_up() {
    let store = LevelStore::default_repo();
    let known = crate::judge::scripted::names();
    for id in store.level_ids() {
        let Ok(cfg) = store.load_config(&id) else { continue };
        if let crate::config::Goal::Scripted { judge, .. } = &cfg.goal {
            assert!(
                known.contains(&judge.as_str()),
                "关卡 {} 用了未注册的 judge `{}`（可用：{:?}）",
                id,
                judge,
                known
            );
        }
    }
}

#[test]
fn dag_unlock_allows_main_progression_without_side_challenge() {
    let store = LevelStore::default_repo();
    let prereqs = store.prerequisite_map();
    let mut progress = crate::progress::UserProgress::default();

    assert!(progress.is_unlocked_dag("1-1", &prereqs));
    assert!(!progress.is_unlocked_dag("1-2", &prereqs));

    for id in ["1-1", "1-2", "1-3", "1-4"] {
        progress.record(id, true, 100);
    }
    // 1-4 通关后，支线 1-4S 与主线 1-5 同时解锁，且未过 1-4S 不阻塞 1-5
    assert!(progress.is_unlocked_dag("1-4S", &prereqs));
    assert!(progress.is_unlocked_dag("1-5", &prereqs));
    assert!(!progress.is_unlocked_dag("1-6", &prereqs));

    // 开启自由探索模式后全部解锁
    progress.settings.free_explore = true;
    assert!(progress.is_unlocked_dag("1-7S", &prereqs));
}
