import { AlertTriangle, Award, Check, Lock, Play, ShieldCheck, Trophy, X } from 'lucide-react';
import { FULL_UI_DISCLOSURE, type UiDisclosure } from '../../domain/knowledge';
import { formatDiffSubject } from '../../domain/registers';
import type { SubmitDto } from '../../engine/types';

interface TestResultsPanelProps {
  result: SubmitDto | null;
  disclosure?: UiDisclosure;
  canReplayCase?: boolean;
  onDebugCase: (caseIndex: number, dynamicSeed?: number) => void;
}

export function TestResultsPanel({
  result,
  disclosure = FULL_UI_DISCLOSURE,
  canReplayCase = false,
  onDebugCase,
}: TestResultsPanelProps) {
  if (!result) return null;

  const publicTests = result.tests
    .map((t, idx) => ({ t, idx }))
    .filter(({ t }) => !t.hidden);
  const failedTests = result.tests
    .map((t, idx) => ({ t, idx }))
    .filter(({ t }) => !t.passed);

  const showPerfSteps =
    result.totalSteps > 0 &&
    (disclosure.showDebugControls || result.parSteps !== undefined);
  const showInstrCount =
    result.parSteps === undefined &&
    result.instructionCount !== undefined &&
    (disclosure.showDebugControls || result.parInstructions !== undefined);
  const allowClickCase = canReplayCase || disclosure.showDebugControls;

  const hasParGoal = result.parSteps !== undefined || result.parInstructions !== undefined;
  const goldAchieved = result.passed && result.metPar && hasParGoal;
  const passedWithoutGold = result.passed && !result.metPar && result.parSteps !== undefined;
  const stepsOverPar =
    passedWithoutGold && result.parSteps !== undefined
      ? Math.max(0, result.totalSteps - result.parSteps)
      : 0;

  return (
    <div
      className={`space-y-2.5 rounded-xl border p-3 transition ${
        goldAchieved
          ? 'border-amber-400/75 bg-gradient-to-br from-amber-950/35 via-slate-900/95 to-emerald-950/25 shadow-[0_0_24px_rgba(251,191,36,0.2)]'
          : result.passed
            ? 'border-emerald-500/45 bg-slate-900/85'
            : 'border-slate-800 bg-slate-900/80'
      }`}
    >
      {/* 通关与金牌结果主横幅（金牌 vs 普通通关具备强烈视觉反差） */}
      {goldAchieved && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-400/60 bg-gradient-to-r from-amber-400/20 via-yellow-400/15 to-emerald-400/10 px-3 py-2">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-amber-400/25 ring-1 ring-amber-300/70">
              <Trophy className="h-4 w-4 text-amber-300" />
            </span>
            <div>
              <div className="text-xs font-extrabold tracking-wide text-amber-200">
                性能金牌达成！
              </div>
              <div className="font-mono text-[11px] text-amber-100/85">
                {result.parSteps !== undefined
                  ? `基准 ${result.benchmarkCount} 组共 ${result.totalSteps} 步（金牌线 ≤${result.parSteps} 步）`
                  : `共 ${result.instructionCount} 条指令（最优线 ≤${result.parInstructions}）`}
              </div>
            </div>
          </div>
          <span className="rounded-full border border-amber-300/70 bg-amber-400/25 px-2.5 py-0.5 font-mono text-[11px] font-extrabold text-amber-200">
            GOLD
          </span>
        </div>
      )}

      {passedWithoutGold && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-emerald-500/40 bg-emerald-950/25 px-3 py-2">
          <div className="flex items-center gap-2 text-xs font-semibold text-emerald-200">
            <Check className="h-4 w-4 text-emerald-400" />
            <span>全部测例通过！</span>
          </div>
          <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/45 bg-amber-950/40 px-2.5 py-0.5 font-mono text-[11px] text-amber-200">
            <Award className="h-3 w-3 text-amber-400" />
            距性能金牌还差 {stepsOverPar} 步（{result.totalSteps} / ≤{result.parSteps}）
          </span>
        </div>
      )}

      {/* 公开测例胶囊点阵 + 隐藏/随机抽测徽章 + 步数 */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          {publicTests.map(({ t, idx }) => (
            <button
              key={`${idx}-${t.name}`}
              type="button"
              title={allowClickCase ? `${t.name}（点击重放动画）` : t.name}
              disabled={!allowClickCase}
              onClick={() => {
                if (allowClickCase) {
                  onDebugCase(t.failure?.caseIndex ?? idx, result.dynamicSeed);
                }
              }}
              className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 font-mono text-xs font-bold transition ${
                t.passed
                  ? allowClickCase
                    ? 'cursor-pointer border-emerald-500/40 bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25'
                    : 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300'
                  : allowClickCase
                    ? 'cursor-pointer border-rose-500/60 bg-rose-500/20 text-rose-200 hover:bg-rose-500/30'
                    : 'border-rose-500/50 bg-rose-500/15 text-rose-200'
              }`}
            >
              {t.passed ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
              测例 {idx + 1}
            </button>
          ))}

          {result.hiddenTotal > 0 && (
            <span
              className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 font-mono text-xs font-semibold ${
                result.hiddenPassed === result.hiddenTotal
                  ? 'border-cyan-500/40 bg-cyan-500/10 text-cyan-200'
                  : 'border-rose-500/55 bg-rose-500/15 text-rose-200'
              }`}
            >
              <ShieldCheck className="h-3.5 w-3.5" />
              隐藏/随机 {result.hiddenPassed}/{result.hiddenTotal}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 font-mono text-[11px]">
          {showPerfSteps && (
            <span
              title={
                result.benchmarkCount > 0
                  ? `统计范围：全部 ${result.benchmarkCount} 组固定基准测例（不含随机抽测）`
                  : undefined
              }
              className={`rounded px-2 py-0.5 ${
                goldAchieved
                  ? 'bg-amber-400/20 font-bold text-amber-200'
                  : 'bg-slate-950 text-cyan-200'
              }`}
            >
              ⚡ {result.totalSteps} 步
              {result.parSteps !== undefined ? ` / ≤${result.parSteps}` : ''}
              {result.benchmarkCount > 0 ? ` (${result.benchmarkCount}组)` : ''}
            </span>
          )}
          {showInstrCount && (
            <span className="rounded bg-slate-950 px-2 py-0.5 text-slate-300">
              {result.instructionCount} 条指令
              {result.parInstructions !== undefined ? ` / ≤${result.parInstructions}` : ''}
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

      {/* 展开失败测例（隐藏/随机仅披露第一条失败点并支持单步复现） */}
      {failedTests.length > 0 && (
        <div className="space-y-1.5">
          {failedTests.map(({ t, idx }) => (
            <div
              key={`${idx}-${t.name}`}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-rose-500/35 bg-rose-950/20 px-2.5 py-1.5 text-xs"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1 font-mono font-bold text-rose-300">
                  {t.isRandom && <Lock className="h-3 w-3 text-amber-300" />}
                  {t.hidden ? t.name : `测例 ${idx + 1}`}
                </span>
                {t.isRandom && (
                  <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-medium text-amber-200">
                    已锁定复现
                  </span>
                )}
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

              {allowClickCase && (
                <button
                  type="button"
                  onClick={() => onDebugCase(t.failure?.caseIndex ?? idx, result.dynamicSeed)}
                  className="inline-flex items-center gap-1 rounded-md border border-cyan-400/50 bg-cyan-500/15 px-2 py-0.5 text-[11px] font-semibold text-cyan-200 hover:bg-cyan-500/25"
                >
                  <Play className="h-3 w-3" /> {t.hidden ? '单步排查' : '看动画'}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
