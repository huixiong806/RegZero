//! 构建脚本：把 `content/` 下的关卡内容与 Wiki 词条在编译期嵌进二进制。
//!
//! 只有开了 `embedded-content` 特性时才会生成清单文件 `embedded_manifest.rs`
//! （位于 `OUT_DIR`），内容形如：
//!
//! ```text
//! pub static FILES: &[(&str, &[u8])] = &[("levels/c1_1/meta.json", b"..."), ...];
//! ```
//!
//! 同时把 `content/**` 登记为 `rerun-if-changed`，确保修改任意关卡或 Wiki 后重新编译。

use std::path::{Path, PathBuf};

fn main() {
    println!("cargo:rerun-if-changed=build.rs");

    let manifest_dir = PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").unwrap());
    // crates/regzero-core → 仓库根
    let repo_root = manifest_dir.parent().and_then(|p| p.parent()).unwrap().to_path_buf();
    let content = repo_root.join("content");

    println!("cargo:rerun-if-changed={}", content.display());

    if std::env::var_os("CARGO_FEATURE_EMBEDDED_CONTENT").is_none() {
        return;
    }

    let mut entries: Vec<(String, PathBuf)> = Vec::new();
    for sub in ["levels", "wiki"] {
        let dir = content.join(sub);
        if dir.is_dir() {
            println!("cargo:rerun-if-changed={}", dir.display());
            collect(&dir, &dir, sub, &mut entries);
        }
    }
    entries.sort();

    let mut out = String::new();
    out.push_str("// 由 build.rs 生成，请勿手改。\n");
    out.push_str("pub static FILES: &[(&str, &[u8])] = &[\n");
    for (rel, abs) in &entries {
        println!("cargo:rerun-if-changed={}", abs.display());
        let bytes = std::fs::read(abs)
            .unwrap_or_else(|e| panic!("读不了 {}：{}", abs.display(), e));
        out.push_str(&format!("    ({:?}, &{:?}),\n", rel.replace('\\', "/"), bytes));
    }
    out.push_str("];\n");

    let dest = PathBuf::from(std::env::var("OUT_DIR").unwrap()).join("embedded_manifest.rs");
    std::fs::write(&dest, out).expect("写不了嵌入清单");
}

/// 递归收集目录下的所有文件，键为 `prefix/相对路径`。
fn collect(base: &Path, dir: &Path, prefix: &str, out: &mut Vec<(String, PathBuf)>) {
    let Ok(rd) = std::fs::read_dir(dir) else { return };
    for entry in rd.flatten() {
        let path = entry.path();
        if path.is_dir() {
            println!("cargo:rerun-if-changed={}", path.display());
            collect(base, &path, prefix, out);
        } else if path.is_file() {
            let rel = path
                .strip_prefix(base)
                .map(|p| p.to_string_lossy().replace('\\', "/"))
                .unwrap_or_else(|_| path.to_string_lossy().to_string());
            out.push((format!("{}/{}", prefix, rel), path));
        }
    }
}
