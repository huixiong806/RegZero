import { AlertTriangle, Award, Bug, Check, X } from 'lucide-react';
import { FULL_UI_DISCLOSURE, type UiDisclosure } from '../../domain/knowledge';
import { formatDiffSubject } from '../../domain/registers';
import type { SubmitDto } from '../../engine/types';

interface TestResultsPanelProps {
  result: SubmitDto | null;
  disclosure?: UiDisclosure;
  onDebugCase: (caseIndex: number) => void;
}

export function TestResultsPanel({
  result,
  disclosure = FULL_UI_DISCLOSURE,
  onDebugCase,
}: TestResultsPanelProps) {
  if (!result) return null;

  const failedTests = result.tests
    .map((t, index) => ({ t, index }))
    .filter(({ t }) => !t.passed);
  const showInstrCount =
    result.instructionCount !== undefined &&
    (disclosure.showDebugControls || result.parInstructions !== undefined);

  return (
    <div className="space-y-2 rounded-xl border border-slate-800 bg-slate-900/80 p-3">
      {/* 紧凑测例胶囊点阵 */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          {result.tests.map((t, idx) => (
            <button
              key={`${idx}-${t.name}`}
              type="button"
              title={t.name}
              disabled={t.passed || !disclosure.showDebugControls}
              onClick={() => {
                if (!t.passed && disclosure.showDebugControls) {
                  onDebugCase(t.failure?.caseIndex ?? idx);
                }
              }}
              className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 font-mono text-xs font-bold transition ${
                t.passed
                  ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300'
                  : disclosure.showDebugControls
                    ? 'cursor-pointer border-rose-500/60 bg-rose-500/20 text-rose-200 hover:bg-rose-500/30'
                    : 'border-rose-500/50 bg-rose-500/15 text-rose-200'
              }`}
            >
              {t.passed ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
              测例 {idx + 1}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2 font-mono text-[11px]">
          {showInstrCount && (
            <span className="rounded bg-slate-950 px-2 py-0.5 text-slate-300">
              {result.instructionCount} 条指令
              {result.parInstructions !== undefined ? ` / ≤${result.parInstructions}` : ''}
            </span>
          )}
          {result.metPar && (
            <span className="inline-flex items-center gap-1 rounded bg-amber-500/20 px-2 py-0.5 font-bold text-amber-300">
              <Award className="h-3 w-3" /> 最优达成
            </span>
          )}
        </div>
      </div>

      {/* 编译/约束错误 */}
      {result.errors.length > 0 && (
        <div className="space-y-1 rounded-lg border border-rose-500/40 bg-rose-950/30 px-2.5 py-2 font-mono text-xs text-rose-200">
          {result.errors.map((err, i) => (
            <div key={i} className="flex items-start gap-1.5">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-rose-400" />
              <span>
                {err.line > 0 ? `第 ${err.line} 行：` : ''}
                {err.message}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* 仅展开失败测例的清晰中文对比 */}
      {failedTests.length > 0 && (
        <div className="space-y-1.5">
          {failedTests.map(({ t, index }) => (
            <div
              key={index}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-rose-500/35 bg-rose-950/20 px-2.5 py-1.5 text-xs"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono font-bold text-rose-300">测例 {index + 1}</span>
                {t.diffs.length > 0 ? (
                  t.diffs.map((d, di) => (
                    <span
                      key={di}
                      className="inline-flex items-center gap-1.5 rounded bg-slate-950/90 px-2 py-0.5 text-[11px]"
                    >
                      <span className="font-medium text-slate-300">
                        {formatDiffSubject(d.what, disclosure.showRegXName)}
                      </span>
                      <span className="font-mono text-emerald-300">
                        期望 {d.expected.split('（')[0]}
                      </span>
                      <span className="text-slate-600">·</span>
                      <span className="font-mono text-rose-300">
                        实际 {d.actual.split('（')[0]}
                      </span>
                    </span>
                  ))
                ) : (
                  <span className="text-rose-200">{t.detail}</span>
                )}
              </div>

              {disclosure.showDebugControls && (
                <button
                  type="button"
                  onClick={() => onDebugCase(t.failure?.caseIndex ?? index)}
                  className="inline-flex items-center gap-1 rounded-md border border-amber-400/50 bg-amber-500/15 px-2 py-0.5 text-[11px] font-semibold text-amber-200 hover:bg-amber-500/25"
                >
                  <Bug className="h-3 w-3" /> 单步排查
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
