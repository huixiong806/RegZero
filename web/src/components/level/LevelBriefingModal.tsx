import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, BookOpen, Sparkles } from 'lucide-react';
import type { BriefingSlide } from '../../engine/types';
import { t } from '../../i18n';
import { renderInline } from './SimpleMarkdown';

interface LevelBriefingModalProps {
  levelId: string;
  title: string;
  slides: readonly BriefingSlide[];
  targetAnchorRef: React.RefObject<HTMLButtonElement | null>;
  onLanded?: () => void;
  onComplete: () => void;
}

const COLLAPSE_DURATION_MS = 420;

/**
 * 首次进场多页微引导弹窗：
 * 每页仅展示 1~2 句口语化概念或目标，结束后缩放飞入右上角「规则」按钮，
 * 通过空间动效自然告知玩家“详细书面说明收在「规则」按钮里”。
 */
export function LevelBriefingModal({
  levelId,
  title,
  slides,
  targetAnchorRef,
  onLanded,
  onComplete,
}: LevelBriefingModalProps) {
  const [index, setIndex] = useState(0);
  const [collapsing, setCollapsing] = useState(false);
  const [flyOffset, setFlyOffset] = useState<{ dx: number; dy: number }>({ dx: 0, dy: 0 });
  const cardRef = useRef<HTMLDivElement | null>(null);
  const timerRef = useRef<number | null>(null);

  const isLast = index >= slides.length - 1;
  const current = slides[index];

  const triggerCollapse = useCallback(() => {
    if (collapsing) return;
    const cardRect = cardRef.current?.getBoundingClientRect();
    const targetRect = targetAnchorRef.current?.getBoundingClientRect();
    if (cardRect && targetRect) {
      const dx = targetRect.left + targetRect.width / 2 - (cardRect.left + cardRect.width / 2);
      const dy = targetRect.top + targetRect.height / 2 - (cardRect.top + cardRect.height / 2);
      setFlyOffset({ dx, dy });
    }
    setCollapsing(true);
    timerRef.current = window.setTimeout(() => {
      onLanded?.();
      onComplete();
    }, COLLAPSE_DURATION_MS);
  }, [collapsing, onComplete, onLanded, targetAnchorRef]);

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (collapsing) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        triggerCollapse();
      } else if (e.key === 'ArrowRight' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        if (isLast) triggerCollapse();
        else setIndex((i) => Math.min(slides.length - 1, i + 1));
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        setIndex((i) => Math.max(0, i - 1));
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [collapsing, isLast, slides.length, triggerCollapse]);

  if (!current) return null;

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center p-4 transition-opacity duration-300 ${
        collapsing ? 'pointer-events-none bg-slate-950/0 opacity-100' : 'bg-slate-950/75 backdrop-blur-xs'
      }`}
    >
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-label={t('briefing.ariaLabel', { id: levelId })}
        style={
          collapsing
            ? {
                transform: `translate(${flyOffset.dx}px, ${flyOffset.dy}px) scale(0.08)`,
                opacity: 0.12,
                transition: `transform ${COLLAPSE_DURATION_MS}ms cubic-bezier(0.32, 0, 0.18, 1), opacity 360ms ease-in`,
              }
            : {
                transform: 'translate(0px, 0px) scale(1)',
                opacity: 1,
                transition: 'transform 220ms ease-out, opacity 220ms ease-out',
              }
        }
        className="w-full max-w-lg overflow-hidden rounded-3xl border border-cyan-500/40 bg-slate-900 shadow-[0_24px_80px_rgba(8,145,178,0.22)]"
      >
        {/* 顶栏：关卡标签 + 当前页分类 + 进度指示 */}
        <div className="flex items-center justify-between gap-2 border-b border-slate-800 bg-slate-950/70 px-5 py-3.5">
          <div className="flex items-center gap-2">
            <span className="rounded-md bg-cyan-500/20 px-2 py-0.5 font-mono text-xs font-bold text-cyan-300">
              {levelId}
            </span>
            {current.tag && (
              <span className="inline-flex items-center gap-1 rounded-full border border-slate-700 bg-slate-900 px-2.5 py-0.5 text-[11px] font-semibold text-slate-200">
                <Sparkles className="h-3 w-3 text-cyan-400" />
                {current.tag}
              </span>
            )}
          </div>
          <span className="font-mono text-xs text-slate-500">
            {index + 1} / {slides.length}
          </span>
        </div>

        {/* 主体：大字号、极简 1~2 句话 */}
        <div className="min-h-[148px] px-6 py-7">
          <div className="text-xs font-medium text-slate-500">{title}</div>
          <p className="mt-3 text-base leading-8 text-slate-100 sm:text-[17px]">
            {renderInline(current.text)}
          </p>
        </div>

        {/* 进度圆点 + 翻页/收起控制 */}
        <div className="flex items-center justify-between gap-3 border-t border-slate-800/90 bg-slate-950/60 px-5 py-3.5">
          <button
            type="button"
            onClick={triggerCollapse}
            className="text-xs font-medium text-slate-500 transition hover:text-slate-200"
          >
            {t('briefing.skip')}
          </button>

          <div className="flex items-center gap-1.5" aria-label={t('briefing.ariaLabel', { id: levelId })}>
            {slides.map((_, i) => (
              <button
                key={i}
                type="button"
                aria-label={t('briefing.slideAria', { n: i + 1 })}
                onClick={() => setIndex(i)}
                className={`h-2 rounded-full transition-all ${
                  i === index
                    ? 'w-5 bg-cyan-400'
                    : i < index
                      ? 'w-2 bg-cyan-500/45 hover:bg-cyan-400/70'
                      : 'w-2 bg-slate-700 hover:bg-slate-500'
                }`}
              />
            ))}
          </div>

          <div className="flex items-center gap-2">
            {index > 0 && (
              <button
                type="button"
                onClick={() => setIndex((i) => Math.max(0, i - 1))}
                className="inline-flex items-center gap-1 rounded-xl border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs font-medium text-slate-300 hover:bg-slate-800 hover:text-white"
              >
                <ArrowLeft className="h-3.5 w-3.5" /> {t('briefing.prev')}
              </button>
            )}

            {isLast ? (
              <button
                type="button"
                onClick={triggerCollapse}
                className="inline-flex items-center gap-1.5 rounded-xl bg-cyan-400 px-4 py-1.5 text-xs font-bold text-slate-950 shadow hover:bg-cyan-300"
              >
                <BookOpen className="h-3.5 w-3.5" /> {t('briefing.start')}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setIndex((i) => Math.min(slides.length - 1, i + 1))}
                className="inline-flex items-center gap-1 rounded-xl bg-cyan-400 px-4 py-1.5 text-xs font-bold text-slate-950 shadow hover:bg-cyan-300"
              >
                {t('briefing.next')} <ArrowRight className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
