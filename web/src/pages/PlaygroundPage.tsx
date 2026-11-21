import { useEffect, useState } from 'react';
import { FolderCode, FileCode2, Globe, Info } from 'lucide-react';
import { useAppContext } from '../app/AppShell';
import { PlaygroundWorkspace } from '../components/playground/PlaygroundWorkspace';
import { defaultEngineClient } from '../engine/OnlineWasmClient';
import type {
  Language,
  LevelPayload,
  PlaygroundWorkMode,
} from '../engine/types';

export function PlaygroundPage() {
  const { levels, refreshProgress } = useAppContext();
  const [workMode, setWorkMode] = useState<PlaygroundWorkMode>('online');
  const [contextKey, setContextKey] = useState<string>('sandbox:asm');
  const [activeLevel, setActiveLevel] = useState<LevelPayload | null>(null);

  useEffect(() => {
    if (contextKey.startsWith('sandbox:')) {
      setActiveLevel(null);
      return;
    }
    const levelId = contextKey.slice('level:'.length);
    let active = true;
    defaultEngineClient
      .loadLevel(levelId)
      .then((payload) => {
        if (active) setActiveLevel(payload);
      })
      .catch(() => {
        if (active) setActiveLevel(null);
      });
    return () => {
      active = false;
    };
  }, [contextKey]);

  const sandboxLang: Language = contextKey === 'sandbox:c' ? 'c' : 'asm';

  return (
    <div className="space-y-4">
      {/* 独立 Playground 三模式顶栏 */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-800 bg-slate-900/80 p-3.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => setWorkMode('online')}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
              workMode === 'online'
                ? 'bg-cyan-500 text-slate-950'
                : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
            }`}
          >
            <Globe className="h-3.5 w-3.5" /> 在线编辑
          </button>
          <button
            type="button"
            onClick={() => setWorkMode('local-file')}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
              workMode === 'local-file'
                ? 'bg-amber-500 text-slate-950'
                : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
            }`}
          >
            <FileCode2 className="h-3.5 w-3.5" /> 本地单文件监听
          </button>
          <button
            type="button"
            onClick={() => setWorkMode('local-project')}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
              workMode === 'local-project'
                ? 'bg-violet-500 text-slate-950'
                : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
            }`}
          >
            <FolderCode className="h-3.5 w-3.5" /> 本地 C 工程
          </button>
        </div>

        {/* 上下文切换：自由沙盒或任意关卡测例 */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-400">运行环境：</span>
          <select
            aria-label="Playground 上下文选择"
            value={contextKey}
            onChange={(e) => setContextKey(e.target.value)}
            className="rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-slate-200 outline-none focus:border-cyan-500"
          >
            <option value="sandbox:asm">自由沙盒 · RV32IM 汇编</option>
            <option value="sandbox:c">自由沙盒 · C 子集 (starlang)</option>
            {levels.length > 0 && (
              <optgroup label="加载关卡测例调试">
                {levels.map((l) => (
                  <option key={l.id} value={`level:${l.id}`}>
                    {l.id} · {l.title}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        </div>
      </div>

      {/* 本地桥接模式占位提示（已预留 EngineClient 切换口） */}
      {workMode !== 'online' && (
        <div className="flex items-start gap-2.5 rounded-xl border border-amber-500/40 bg-amber-950/25 px-4 py-3 text-xs text-amber-200">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
          <div className="space-y-1">
            <div className="font-semibold">
              {workMode === 'local-file'
                ? '本地单文件监听模式（Phase 2 通过 regzero-bridge 启用）'
                : '本地 C 工程模式（Phase 3 通过 regzero-bridge + regzero.project.json 启用）'}
            </div>
            <p className="text-amber-200/80">
              本模式已预留统一 EngineClient 与 127.0.0.1:17320 协议边界。上线 regzero-bridge 后，你在本地 VS Code 保存代码将自动同步到此工作台运行、单步回放并展示 Diff。现在可以先切回「在线编辑」体验完整调试器。
            </p>
          </div>
        </div>
      )}

      {/* 主工作台 */}
      <PlaygroundWorkspace
        level={activeLevel}
        sandboxLanguage={sandboxLang}
        onSubmitted={() => refreshProgress()}
      />
    </div>
  );
}
