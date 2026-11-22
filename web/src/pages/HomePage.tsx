import {
  ArrowRight,
  Award,
  Check,
  Flame,
  Layers,
  Lock,
  Play,
  Sparkles,
  Trophy,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAppContext } from '../app/AppShell';
import { buildChapterSpine, nextRecommendedLevel } from '../domain/dag';
import type { LevelSummary } from '../engine/types';

const ROADMAP = [
  { ch: 1, title: 'RISC-V 汇编', active: true },
  { ch: 2, title: 'C 语言核心', active: false },
  { ch: 3, title: '数据结构与算法', active: false },
  { ch: 4, title: 'DrawVM 迷你编译器', active: false },
  { ch: 5, title: '核心 C 编译器', active: false },
  { ch: 6, title: '编译器扩展', active: false },
  { ch: 7, title: '优化与高阶算法', active: false },
];

export function HomePage() {
  const { levels, levelsLoading: loading, levelsError: error } = useAppContext();

  const chapter1 = levels.filter((l) => l.chapter === 1);
  const spine = buildChapterSpine(chapter1);
  const recommended = nextRecommendedLevel(chapter1);
  const passedCount = chapter1.filter((l) => l.passed).length;
  const parLevels = chapter1.filter(
    (l) => l.parSteps !== undefined || l.parInstructions !== undefined,
  );
  const goldCount = parLevels.filter((l) => l.passed && l.metPar).length;
  const pct = chapter1.length > 0 ? Math.round((passedCount / chapter1.length) * 100) : 0;

  return (
    <div className="space-y-5">
      {/* 极简章节进度条 + 快捷入口 */}
      <section className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-800 bg-slate-900/80 px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-cyan-500/15 font-mono text-sm font-bold text-cyan-300 ring-1 ring-cyan-500/40">
            {pct}%
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-base font-bold text-white">CH1 · RISC-V 汇编</h1>
              <span className="font-mono text-xs text-slate-400">
                {passedCount}/{chapter1.length}
              </span>
              {parLevels.length > 0 && (
                <span className="inline-flex items-center gap-1 rounded-full border border-amber-400/40 bg-amber-500/15 px-2 py-0.5 font-mono text-[11px] font-bold text-amber-300">
                  <Trophy className="h-3 w-3" /> {goldCount}/{parLevels.length} 金牌
                </span>
              )}
            </div>
            <div className="mt-1 h-1.5 w-44 overflow-hidden rounded-full bg-slate-800">
              <div
                className="h-full rounded-full bg-gradient-to-r from-cyan-400 to-emerald-400 transition-all"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {recommended && (
            <Link
              to={`/level/${recommended.id}`}
              className="inline-flex items-center gap-1.5 rounded-xl bg-cyan-400 px-4 py-2 text-xs font-bold text-slate-950 shadow hover:bg-cyan-300"
            >
              <Play className="h-3.5 w-3.5" /> {passedCount === 0 ? `开始 ${recommended.id}` : `继续 ${recommended.id}`}
            </Link>
          )}
        </div>
      </section>

      {/* 图形化 DAG 技能树画布 */}
      <section className="rounded-2xl border border-slate-800 bg-slate-950/70 p-5">
        {/* 极简图例 */}
        <div className="mb-4 flex flex-wrap items-center gap-4 text-[11px] text-slate-400">
          <span className="inline-flex items-center gap-1.5">
            <Sparkles className="h-3.5 w-3.5 text-cyan-400" /> 概念
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Layers className="h-3.5 w-3.5 text-emerald-400" /> 巩固
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Flame className="h-3.5 w-3.5 text-amber-400" /> 支线挑战
          </span>
        </div>

        {loading && <div className="py-10 text-center text-xs text-slate-500">正在加载关卡…</div>}
        {error && (
          <div className="rounded-xl border border-rose-500/40 bg-rose-950/30 p-3 text-xs text-rose-200">
            {error}
          </div>
        )}

        {!loading && !error && (
          <div className="mx-auto max-w-4xl">
            {spine.map((node, idx) => {
              const prevPassed = idx === 0 ? true : spine[idx - 1]!.main.passed;
              const isPostGameCluster =
                idx === spine.length - 1 && node.sideChallenges.length >= 3;
              return (
                <div key={node.main.id}>
                  {/* 主干垂直电路线 */}
                  {idx > 0 && (
                    <div className="flex justify-start pl-7">
                      <div
                        className={`h-6 w-0.5 transition ${
                          prevPassed ? 'bg-emerald-400/70 shadow-[0_0_8px_rgba(52,211,153,0.6)]' : 'bg-slate-800'
                        }`}
                      />
                    </div>
                  )}

                  <div className="flex flex-col gap-2.5 md:flex-row md:items-center">
                    <div className="md:w-[54%]">
                      <DagNodeCard item={node.main} />
                    </div>

                    {!isPostGameCluster && node.sideChallenges.length > 0 && (
                      <div className="flex items-center md:w-[46%]">
                        {/* 支线水平分叉电路线 */}
                        <svg
                          viewBox="0 0 44 24"
                          className="hidden h-6 w-11 shrink-0 md:block"
                          aria-hidden="true"
                        >
                          <path
                            d="M 0 12 L 44 12"
                            stroke={node.main.passed ? '#f59e0b' : '#334155'}
                            strokeWidth={node.main.passed ? 2 : 1.5}
                            strokeDasharray="4 3"
                          />
                          <circle
                            cx="40"
                            cy="12"
                            r="3"
                            fill={node.main.passed ? '#f59e0b' : '#334155'}
                          />
                        </svg>
                        <div className="flex-1 space-y-2">
                          {node.sideChallenges.map((ch) => (
                            <DagNodeCard key={ch.id} item={ch} />
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* 主线通关后开启的整组进阶性能挑战区（数据驱动：末节点挂接 ≥3 个挑战关时自动展开） */}
                  {isPostGameCluster && (
                    <div className="mt-1">
                      <div className="flex justify-start pl-7">
                        <div
                          className={`h-6 w-0.5 transition ${
                            node.main.passed
                              ? 'bg-amber-400/80 shadow-[0_0_8px_rgba(251,191,36,0.5)]'
                              : 'bg-slate-800'
                          }`}
                        />
                      </div>
                      <div className="rounded-2xl border border-amber-500/30 bg-amber-950/10 p-3.5">
                        <div className="mb-2.5 flex items-center justify-between gap-2">
                          <span className="inline-flex items-center gap-1.5 text-xs font-bold text-amber-300">
                            <Flame className="h-3.5 w-3.5" /> 通关进阶 · 性能挑战试炼
                          </span>
                          <span className="font-mono text-[11px] text-slate-400">
                            按动态执行步数计金牌 · 不限代码行数
                          </span>
                        </div>
                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                          {node.sideChallenges.map((ch) => (
                            <DagNodeCard key={ch.id} item={ch} />
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* 7 章极简路线胶囊条 */}
      <section className="flex flex-wrap items-center gap-2">
        {ROADMAP.map((r) => (
          <div
            key={r.ch}
            className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs ${
              r.active
                ? 'border-cyan-500/50 bg-cyan-500/15 font-bold text-cyan-200'
                : 'border-slate-800 bg-slate-900/50 text-slate-500'
            }`}
          >
            <span className="font-mono">C{r.ch}</span>
            <span>{r.title}</span>
          </div>
        ))}
      </section>
    </div>
  );
}

function DagNodeCard({ item }: { item: LevelSummary }) {
  const Icon = item.kind === 'challenge' ? Flame : item.kind === 'practice' ? Layers : Sparkles;
  const hasGold = Boolean(
    item.passed &&
      item.metPar &&
      (item.parSteps !== undefined || item.parInstructions !== undefined),
  );
  const passedNoGold = Boolean(
    item.passed &&
      !item.metPar &&
      (item.parSteps !== undefined || item.parInstructions !== undefined),
  );
  const iconTone = hasGold
    ? 'text-amber-200 bg-gradient-to-br from-amber-400/35 to-yellow-500/20 ring-1 ring-amber-400/70 shadow-[0_0_12px_rgba(251,191,36,0.35)]'
    : item.kind === 'challenge'
      ? 'text-amber-400 bg-amber-500/15'
      : item.kind === 'practice'
        ? 'text-emerald-400 bg-emerald-500/15'
        : 'text-cyan-400 bg-cyan-500/15';

  const content = (
    <div
      className={`flex items-center justify-between gap-3 rounded-xl border px-3 py-2.5 transition ${
        !item.unlocked
          ? 'cursor-not-allowed border-slate-800/70 bg-slate-950/60 opacity-45'
          : hasGold
            ? 'border-amber-400/80 bg-gradient-to-r from-amber-950/40 via-slate-900 to-emerald-950/20 shadow-[0_0_18px_rgba(251,191,36,0.2)] hover:border-amber-300'
            : item.passed
              ? 'border-emerald-500/50 bg-emerald-950/20 hover:border-emerald-400'
              : item.kind === 'challenge'
                ? 'border-amber-500/45 bg-amber-950/15 hover:border-amber-400'
                : 'border-slate-700 bg-slate-900 hover:border-cyan-400'
      }`}
    >
      <div className="flex min-w-0 items-center gap-2.5">
        <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${iconTone}`}>
          {hasGold ? (
            <Trophy className="h-4 w-4 text-amber-300" />
          ) : item.passed ? (
            <Check className="h-4 w-4 text-emerald-300" />
          ) : (
            <Icon className="h-4 w-4" />
          )}
        </span>
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="font-mono text-xs font-bold text-slate-200">{item.id}</span>
            <span className="truncate text-sm font-semibold text-white">{item.title}</span>
          </div>
          {item.parSteps !== undefined ? (
            hasGold ? (
              <div className="mt-0.5 inline-flex items-center gap-1 rounded bg-amber-400/20 px-1.5 py-0.5 font-mono text-[10px] font-bold text-amber-200">
                <Trophy className="h-2.5 w-2.5 text-amber-300" />
                性能金牌{item.bestSteps !== undefined ? ` · ${item.bestSteps}/${item.parSteps} 步` : ''}
              </div>
            ) : passedNoGold ? (
              <div className="mt-0.5 inline-flex items-center gap-1 font-mono text-[10px] text-slate-400">
                <Award className="h-3 w-3 text-amber-500/70" />
                {item.bestSteps !== undefined ? `${item.bestSteps}/≤${item.parSteps} 步` : `≤${item.parSteps} 步`}
                <span className="text-amber-400/80">· 未获金牌</span>
              </div>
            ) : (
              <div className="mt-0.5 inline-flex items-center gap-1 font-mono text-[10px] text-amber-300">
                <Award className="h-3 w-3" /> ⚡ 基准 ≤{item.parSteps} 步
              </div>
            )
          ) : (
            item.parInstructions !== undefined && (
              <div className="mt-0.5 inline-flex items-center gap-1 font-mono text-[10px] text-amber-300">
                <Award className="h-3 w-3" /> ≤{item.parInstructions}
              </div>
            )
          )}
        </div>
      </div>

      {!item.unlocked ? (
        <Lock className="h-4 w-4 shrink-0 text-slate-600" />
      ) : (
        <ArrowRight className="h-4 w-4 shrink-0 text-slate-500" />
      )}
    </div>
  );

  if (!item.unlocked) return content;
  return <Link to={`/level/${item.id}`}>{content}</Link>;
}
