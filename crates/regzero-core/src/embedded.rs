//! 编译期嵌入的关卡内容。
//!
//! 关卡内容（关卡页 Markdown、测例 JSON、参考解）在**打包**时会被
//! `build.rs` 读一遍、生成 `FILES` 清单塞进二进制，这样装好的游戏
//! 不依赖仓库目录也能跑。
//!
//! 开发时通常走文件系统（见 [`crate::levels::LevelStore::prefer_repo_or_embedded`]），
//! 改完关卡刷新就能看到，不用重编译。

/// 清单：`(相对 compiler-content/ 的路径, 文件内容)`。
#[cfg(feature = "embedded-content")]
mod manifest {
    include!(concat!(env!("OUT_DIR"), "/embedded_manifest.rs"));
}

#[cfg(feature = "embedded-content")]
pub static FILES: &[(&str, &[u8])] = manifest::FILES;

/// 没开特性时是空清单（只有文件系统后端可用）。
#[cfg(not(feature = "embedded-content"))]
pub static FILES: &[(&str, &[u8])] = &[];

/// 按相对路径取文件内容，例如 `read("src/c1_1.md")`。
pub fn read(rel: &str) -> Option<&'static [u8]> {
    // 统一分隔符，免得 Windows 上因为 `\` 找不到
    let want = rel.replace('\\', "/");
    FILES.iter().find(|(p, _)| *p == want).map(|(_, b)| *b)
}

/// 全部嵌入文件的相对路径。
pub fn paths() -> impl Iterator<Item = &'static str> {
    FILES.iter().map(|(p, _)| *p)
}

/// 嵌入了几个文件（诊断用）。
pub fn count() -> usize {
    FILES.len()
}
