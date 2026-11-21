import { useEffect, useRef, useState } from 'react';
import {
  Bug,
  CheckCircle2,
  FastForward,
  Play,
  RotateCcw,
  StepBack,
  StepForward,
  Terminal,
  X,
} from 'lucide-react';
import { joinHiddenSuffix, splitHiddenReadonlySuffix } from '../../domain/editorConstraints';
import { FULL_UI_DISCLOSURE, type UiDisclosure } from '../../domain/knowledge';
import type { EngineClient } from '../../engine/EngineClient';
import { defaultEngineClient } from '../../engine/OnlineWasmClient';
import {
  clearDraft,
  loadDraft,
  recordSubmissionProgress,
  saveDraft,
} from '../../engine/progressStorage';
import type {
  Language,
  LevelPayload,
  MachineSnapshot,
  SubmitDto,
} from '../../engine/types';
import { CodeEditor, type CodeEditorHandle } from './CodeEditor';
import { MemoryPanel } from './MemoryPanel';
import { RegisterPanel } from './RegisterPanel';
import { TestResultsPanel } from './TestResultsPanel';

export interface PlaygroundWorkspaceProps {
  level: LevelPayload | null;
  sandboxLanguage?: Language;
  initialSandboxCode?: string;
  engine?: EngineClient;
  editorRef?: React.RefObject<CodeEditorHandle | null>;
  disclosure?: UiDisclosure;
  guideHint?: string | null;
  onUserEdit?: () => void;
  onSubmitted?: (result: SubmitDto) => void;
}

const DEFAULT_SANDBOX_ASM = `# RV32IM 汇编沙盒
addi t0, zero, 12
addi t1, zero, 30
add  t2, t0, t1
ecall`;

const DEFAULT_SANDBOX_C = `// C 子集沙盒
int add(int a, int b) {
  return a + b;
}

int main() {
  return add(19, 23);
}`;

export function PlaygroundWorkspace({
  level,
  sandboxLanguage = 'asm',
  initialSandboxCode,
  engine = defaultEngineClient,
  editorRef,
  disclosure = FULL_UI_DISCLOSURE,
  guideHint,
  onUserEdit,
  onSubmitted,
}: PlaygroundWorkspaceProps) {
  const internalEditorRef = useRef<CodeEditorHandle | null>(null);
  const resolvedEditorRef = editorRef ?? internalEditorRef;

  const language: Language = level ? level.meta.language : sandboxLanguage;
  const draftKey = level ? `level.${level.id}` : `sandbox.${language}`;
  const defaultCode = level
    ? level.initialCode
    : initialSandboxCode ?? (language === 'c' ? DEFAULT_SANDBOX_C : DEFAULT_SANDBOX_ASM);

  const [code, setCode] = useState<string>(() => loadDraft(draftKey) ?? defaultCode);
  const [caseIndex, setCaseIndex] = useState(0);
  const [sandboxInput, setSandboxInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [debugging, setDebugging] = useState(false);
  const [snapshot, setSnapshot] = useState<MachineSnapshot | null>(null);
  const [changedRegs, setChangedRegs] = useState<Record<string, number>>({});
  const [changedMem, setChangedMem] = useState<Record<number, number>>({});
  const [inspectedMem, setInspectedMem] = useState<Record<string, number>>({});
  const [flashNonce, setFlashNonce] = useState(0);
  const [submitResult, setSubmitResult] = useState<SubmitDto | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    setCode(loadDraft(draftKey) ?? defaultCode);
    setCaseIndex(0);
    setDebugging(false);
    setSnapshot(null);
    setChangedRegs({});
    setChangedMem({});
    setInspectedMem({});
    setSubmitResult(null);
    setErrorMsg(null);
    void engine.debugQuit();
  }, [draftKey, defaultCode, engine]);

  const hideSuffix = Boolean(level && language === 'asm' && !disclosure.showEcallSuffix);
  const { visibleCode, hiddenSuffix, visibleReadonlySuffix } = splitHiddenReadonlySuffix(
    code,
    level?.editor.readonlySuffix ?? 0,
    hideSuffix,
  );

  const handleVisibleCodeChange = (nextVisible: string) => {
    const nextFull = joinHiddenSuffix(nextVisible, hiddenSuffix);
    setCode(nextFull);
    saveDraft(draftKey, nextFull);
    onUserEdit?.();
  };

  const handleResetCode = () => {
    clearDraft(draftKey);
    setCode(defaultCode);
    setErrorMsg(null);
  };

  const handleRun = async () => {
    setBusy(true);
    setErrorMsg(null);
    setDebugging(false);
    try {
      const snap = level
        ? await engine.runCode(level.id, code, caseIndex)
        : await engine.runSandbox(language, code, sandboxInput);
      setSnapshot(snap);
      setChangedRegs({});
      setChangedMem({});
      setInspectedMem({});
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleDebugStart = async (targetCaseIndex?: number) => {
    const idx = targetCaseIndex ?? caseIndex;
    if (targetCaseIndex !== undefined) setCaseIndex(idx);
    setBusy(true);
    setErrorMsg(null);
    try {
      const snap = level
        ? await engine.debugStart(level.id, code, idx)
        : await engine.debugStartSandbox(language, code, sandboxInput);
      setSnapshot(snap);
      setDebugging(true);
      setChangedRegs({});
      setChangedMem({});
      setInspectedMem({});
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
      setDebugging(false);
    } finally {
      setBusy(false);
    }
  };

  const handleStep = async (direction: 'forward' | 'back') => {
    setBusy(true);
    setErrorMsg(null);
    try {
      const res =
        direction === 'forward' ? await engine.debugStep(1) : await engine.debugStepBack(1);
      setSnapshot(res);
      setChangedRegs(res.regChanges);
      setChangedMem(res.memChanges);
      setFlashNonce((n) => n + 1);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleContinue = async () => {
    setBusy(true);
    setErrorMsg(null);
    try {
      const snap = await engine.debugContinue();
      setSnapshot(snap);
      setChangedRegs({});
      setChangedMem({});
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleDebugReset = async () => {
    setBusy(true);
    setErrorMsg(null);
    try {
      const snap = await engine.debugReset();
      setSnapshot(snap);
      setChangedRegs({});
      setChangedMem({});
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleDebugQuit = async () => {
    await engine.debugQuit();
    setDebugging(false);
    setChangedRegs({});
    setChangedMem({});
  };

  const handleSubmit = async () => {
    if (!level) return;
    setBusy(true);
    setErrorMsg(null);
    setDebugging(false);
    try {
      const res = await engine.submitCode(level.id, code);
      setSubmitResult(res);
      recordSubmissionProgress(res);
      onSubmitted?.(res);

      // 无编译错误时同步展示首个测例（或首个失败测例）的寄存器结果，让单按钮体验完整闭环
      if (res.errors.length === 0) {
        const previewIdx = res.tests.find((t) => !t.passed)?.failure?.caseIndex ?? 0;
        const snap = await engine.runCode(level.id, code, previewIdx).catch(() => null);
        if (snap) {
          setSnapshot(snap);
          setChangedRegs({});
          setChangedMem({});
          setInspectedMem({});
        }
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const focusRegs =
    level && level.meta.sandbox.type === 'manual-cpu' ? level.meta.sandbox.focusRegs : undefined;
  const regRoles =
    level && level.meta.sandbox.type === 'manual-cpu' ? level.meta.sandbox.regRoles : undefined;
  const errorLines = submitResult ? submitResult.errors.map((e) => e.line).filter((n) => n > 0) : [];
  const mergedMemory = { ...(snapshot?.memoryWords ?? {}), ...inspectedMem };
  const showMemory = disclosure.showMemoryPanel && (!level || Object.keys(mergedMemory).length > 0);
  const showRegsPanel = !level || snapshot !== null;
  const showAdvancedControls = !level || disclosure.showDebugControls;

  return (
    <div className="flex h-full flex-col gap-3">
      {/* 编辑器 + 主次分明工具栏 */}
      <div className="flex flex-col overflow-hidden rounded-2xl border border-slate-800 bg-slate-950">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 bg-slate-900/90 px-3 py-2">
          {/* 左：可用指令提示 + （解锁后）测例选择 */}
          <div className="flex flex-wrap items-center gap-1.5">
            {level && level.availableOps.length > 0 ? (
              <>
                <span className="text-[11px] text-slate-500">可用指令</span>
                {level.availableOps
                  .filter((op) => op !== 'ecall')
                  .map((op) => (
                    <span
                      key={op}
                      className="rounded-md border border-cyan-500/30 bg-cyan-500/10 px-1.5 py-0.5 font-mono text-[11px] font-bold text-cyan-300"
                    >
                      {op}
                    </span>
                  ))}
              </>
            ) : (
              <span className="rounded-md bg-cyan-500/15 px-2 py-0.5 font-mono text-[11px] font-bold text-cyan-300">
                {language === 'asm' ? 'RV32IM 汇编' : 'C 语言'}
              </span>
            )}

            {level && showAdvancedControls && level.testsPreview.length > 0 && (
              <select
                aria-label="测例选择"
                value={caseIndex}
                onChange={(e) => setCaseIndex(Number(e.target.value))}
                className="ml-1 max-w-[150px] truncate rounded-md border border-slate-700 bg-slate-950 px-2 py-0.5 font-mono text-[11px] text-slate-300 outline-none focus:border-cyan-500"
              >
                {level.testsPreview.map((tc) => (
                  <option key={tc.index} value={tc.index}>
                    测例 {tc.index + 1} · {tc.name}
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* 右：单一主视觉按钮 + 渐进开放的次级调试按钮 */}
          <div className="flex items-center gap-1.5">
            {showAdvancedControls && (
              <>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void handleRun()}
                  title="仅运行当前选中测例"
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800/80 px-2.5 py-1 text-xs font-medium text-slate-200 hover:bg-slate-700 disabled:opacity-50"
                >
                  <Play className="h-3.5 w-3.5 text-sky-400" /> {level ? '试运行' : '运行'}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void handleDebugStart()}
                  title="逐条指令单步排查"
                  className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-xs font-medium transition disabled:opacity-50 ${
                    debugging
                      ? 'border-amber-400 bg-amber-400 font-bold text-slate-950'
                      : 'border-slate-700 bg-slate-800/80 text-slate-200 hover:border-amber-500/50 hover:text-amber-200'
                  }`}
                >
                  <Bug className="h-3.5 w-3.5 text-amber-400" /> 单步调试
                </button>
              </>
            )}
            {level && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void handleSubmit()}
                className="inline-flex items-center gap-1 rounded-lg bg-emerald-400 px-3 py-1 text-xs font-bold text-slate-950 shadow hover:bg-emerald-300 disabled:opacity-50"
              >
                <CheckCircle2 className="h-3.5 w-3.5" />
                {showAdvancedControls ? '提交验证' : '运行并提交'}
              </button>
            )}
            <button
              type="button"
              onClick={handleResetCode}
              title="重置初始代码"
              className="rounded-lg border border-slate-800 bg-slate-950 p-1.5 text-slate-500 hover:bg-slate-800 hover:text-slate-200"
            >
              <RotateCcw className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {/* 阶段过渡轻引导（点击「去编码 →」后出现） */}
        {guideHint && (
          <div className="border-b border-cyan-500/30 bg-cyan-950/30 px-3 py-1.5 text-xs text-cyan-200">
            {guideHint}
          </div>
        )}

        {/* 调试时间轴条（仅调试模式展开） */}
        {debugging && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-amber-500/30 bg-amber-950/25 px-3 py-1.5">
            <div className="flex items-center gap-1">
              <button
                type="button"
                disabled={busy || !snapshot?.canStepBack}
                onClick={() => void handleStep('back')}
                className="inline-flex items-center gap-1 rounded-md bg-slate-900 px-2 py-1 text-xs font-semibold text-amber-200 hover:bg-slate-800 disabled:opacity-35"
              >
                <StepBack className="h-3.5 w-3.5" /> 倒退
              </button>
              <button
                type="button"
                disabled={busy || !snapshot?.canStep}
                onClick={() => void handleStep('forward')}
                className="inline-flex items-center gap-1 rounded-md bg-amber-400 px-2.5 py-1 text-xs font-bold text-slate-950 hover:bg-amber-300 disabled:opacity-35"
              >
                <StepForward className="h-3.5 w-3.5" /> 单步
              </button>
              <button
                type="button"
                disabled={busy || !snapshot?.canStep}
                onClick={() => void handleContinue()}
                title="运行到底"
                className="rounded-md bg-slate-900 p-1 text-amber-200 hover:bg-slate-800 disabled:opacity-35"
              >
                <FastForward className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void handleDebugReset()}
                title="回到起点"
                className="rounded-md bg-slate-900 p-1 text-slate-300 hover:bg-slate-800"
              >
                <RotateCcw className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => void handleDebugQuit()}
                title="退出调试"
                className="rounded-md p-1 text-slate-400 hover:bg-slate-800 hover:text-rose-300"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>

            {snapshot && (
              <div className="flex items-center gap-1.5 font-mono text-[11px]">
                <span className="rounded bg-slate-900 px-2 py-0.5 text-cyan-300">
                  第 {snapshot.tick} 步
                </span>
                {snapshot.pcLine > 0 && (
                  <span className="rounded bg-slate-900 px-2 py-0.5 text-slate-300">
                    第 {snapshot.pcLine} 行
                  </span>
                )}
              </div>
            )}
          </div>
        )}

        <div className="h-[250px] lg:h-[290px]">
          <CodeEditor
            ref={resolvedEditorRef}
            value={visibleCode}
            onChange={handleVisibleCodeChange}
            language={language}
            readonlyPrefix={level?.editor.readonlyPrefix ?? 0}
            readonlySuffix={visibleReadonlySuffix}
            highlightLines={level?.editor.highlight ?? []}
            suggested={level?.editor.suggested ?? {}}
            pcLine={debugging ? snapshot?.pcLine ?? 0 : 0}
            errorLines={errorLines}
          />
        </div>
      </div>

      {errorMsg && (
        <div className="rounded-xl border border-rose-500/50 bg-rose-950/35 px-3 py-2 font-mono text-xs text-rose-200 whitespace-pre-wrap">
          {errorMsg}
        </div>
      )}

      <TestResultsPanel
        result={submitResult}
        disclosure={disclosure}
        onDebugCase={(idx) => void handleDebugStart(idx)}
      />

      {!level && (
        <div className="flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-900/60 px-3 py-1.5">
          <span className="shrink-0 font-mono text-[11px] text-slate-400">输入</span>
          <input
            type="text"
            value={sandboxInput}
            onChange={(e) => setSandboxInput(e.target.value)}
            placeholder="可选 MMIO 输入文本"
            className="w-full rounded bg-slate-950 px-2 py-1 font-mono text-xs text-slate-200 outline-none focus:ring-1 focus:ring-cyan-500"
          />
        </div>
      )}

      {/* 寄存器芯片板（关卡模式下运行/提交后才展示，避免初始全 0 与左侧沙盘打架） */}
      {showRegsPanel && (
        <RegisterPanel
          title={level ? '运行结果' : '寄存器状态'}
          regs={snapshot?.regs ?? {}}
          focusRegs={focusRegs}
          regRoles={regRoles}
          changedRegs={changedRegs}
          flashNonce={flashNonce}
          disclosure={disclosure}
        />
      )}

      {/* 内存监视器（仅解锁内存概念或自由沙盒时展示，防止泄露代码段机器码） */}
      {showMemory && (
        <MemoryPanel
          memoryWords={mergedMemory}
          changedMemAddrs={changedMem}
          flashNonce={flashNonce}
          canInspectRange={debugging}
          onInspectAddress={async (addr) => {
            try {
              const words = await engine.debugReadMemory(addr, 8);
              setInspectedMem(words);
            } catch (err) {
              setErrorMsg(err instanceof Error ? err.message : String(err));
            }
          }}
        />
      )}

      {/* 输出终端（有输出或生成汇编时展示） */}
      {(snapshot?.output || snapshot?.generatedAssembly) && (
        <div className="space-y-2 rounded-xl border border-slate-800 bg-slate-900/70 p-3">
          <div className="flex items-center justify-between text-xs font-semibold text-slate-300">
            <span className="inline-flex items-center gap-1.5">
              <Terminal className="h-3.5 w-3.5 text-emerald-400" /> 程序输出
            </span>
            {snapshot?.exitCode !== undefined && (
              <span className="font-mono text-[11px] text-slate-400">退出码 {snapshot.exitCode}</span>
            )}
          </div>
          {snapshot?.output && (
            <pre className="max-h-28 overflow-auto rounded-lg bg-slate-950 p-2 font-mono text-xs text-emerald-300">
              {snapshot.output}
            </pre>
          )}
          {snapshot?.generatedAssembly && (
            <details className="rounded-lg border border-slate-800 bg-slate-950/70 p-2">
              <summary className="cursor-pointer font-mono text-xs text-cyan-300">
                生成的汇编代码（{snapshot.generatedAssembly.split('\n').length} 行）
              </summary>
              <pre className="mt-2 max-h-44 overflow-auto font-mono text-[11px] text-slate-300">
                {snapshot.generatedAssembly}
              </pre>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
