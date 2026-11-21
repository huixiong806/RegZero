import { ArrowLeft, ArrowRight, Award, BookOpen, CheckCircle2, Flame, Layers, Lightbulb, Sparkles } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { LevelMeta, LevelSummary } from '../../engine/types';

interface GoalCardProps {
  meta: LevelMeta;
  passed: boolean;
  justPassed: boolean;
  nextMain?: LevelSummary;
  nextSide?: LevelSummary;
  lessonBtnRef?: React.RefObject<HTMLButtonElement | null>;
  pulseLessonBtn?: boolean;
  onOpenLesson: () => void;
  onOpenHints: () => void;
  onOpenWiki: (topic: string) => void;
}

const KIND_STYLE = {
  lesson: { cls: 'text-cyan-300 bg-cyan-500/15 border-cyan-500/35', icon: Sparkles, label: '概念' },
  practice: { cls: 'text-emerald-300 bg-emerald-500/15 border-emerald-500/35', icon: Layers, label: '巩固' },
  challenge: { cls: 'text-amber-300 bg-amber-500/15 border-amber-500/35', icon: Flame, label: '支线' },
} as const;

/**
 * 极简单行关卡顶栏：把返回、目标图形胶囊、按需抽屉入口与通关跳转收进一条紧凑栏，
 * 把 90% 屏幕面积让给左侧图形沙盘与右侧代码工作台。
 */
export function GoalCard({
  meta,
  passed,
  justPassed,
  nextMain,
  nextSide,
  lessonBtnRef,
  pulseLessonBtn = false,
  onOpenLesson,
  onOpenHints,
  onOpenWiki,
}: GoalCardProps) {
  const badge = KIND_STYLE[meta.kind];
  const KindIcon = badge.icon;

  return (
    <div className="flex flex-wrap items-center justify-between gap-2.5 rounded-2xl border border-slate-800 bg-slate-900/90 px-3.5 py-2.5">
      {/* 左：返回 + 关卡标题 + 类型/Par 徽章 */}
      <div className="flex flex-wrap items-center gap-2">
        <Link
          to="/"
          title="返回技能树"
          className="rounded-lg border border-slate-800 bg-slate-950 p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>

        <span className="rounded-md bg-slate-800 px-2 py-0.5 font-mono text-xs font-bold text-white">
          {meta.id}
        </span>
        <h1 className="text-sm font-bold text-white sm:text-base">{meta.title}</h1>
        <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${badge.cls}`}>
          <KindIcon className="h-3 w-3" /> {badge.label}
        </span>

        {meta.parInstructions !== undefined && (
          <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/35 bg-amber-950/30 px-2 py-0.5 font-mono text-[11px] text-amber-300">
            <Award className="h-3 w-3" /> ≤{meta.parInstructions}
          </span>
        )}

        {passed && !justPassed && (
          <CheckCircle2 className="h-4 w-4 text-emerald-400" aria-label="已通关" />
        )}
      </div>

      {/* 右：按需展开按钮 + 通关快捷下一关 */}
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          ref={lessonBtnRef}
          type="button"
          onClick={onOpenLesson}
          className={`inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1 text-xs font-medium text-slate-300 transition hover:border-cyan-500/50 hover:text-cyan-200 ${
            pulseLessonBtn ? 'rz-pulse-anchor' : ''
          }`}
        >
          <BookOpen className="h-3.5 w-3.5 text-cyan-400" /> 规则
        </button>

        {meta.hints.length > 0 && (
          <button
            type="button"
            onClick={onOpenHints}
            className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1 text-xs font-medium text-slate-300 hover:border-amber-500/50 hover:text-amber-200"
          >
            <Lightbulb className="h-3.5 w-3.5 text-amber-400" /> 提示
          </button>
        )}

        {meta.wikiRefs[0] && (
          <button
            type="button"
            onClick={() => onOpenWiki(meta.wikiRefs[0]!)}
            className="hidden items-center gap-1 rounded-lg border border-slate-800 bg-slate-950 px-2.5 py-1 text-xs text-slate-400 hover:text-cyan-300 sm:inline-flex"
          >
            图鉴
          </button>
        )}

        {justPassed && nextSide && (
          <Link
            to={`/level/${nextSide.id}`}
            className="inline-flex items-center gap-1 rounded-lg border border-amber-400/60 bg-amber-500/20 px-2.5 py-1 text-xs font-bold text-amber-200 hover:bg-amber-500/30"
          >
            <Flame className="h-3.5 w-3.5" /> {nextSide.id}
          </Link>
        )}

        {justPassed && nextMain && (
          <Link
            to={`/level/${nextMain.id}`}
            className="inline-flex items-center gap-1 rounded-lg bg-emerald-400 px-3 py-1 text-xs font-bold text-slate-950 shadow hover:bg-emerald-300"
          >
            下一关 {nextMain.id} <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        )}
      </div>
    </div>
  );
}
