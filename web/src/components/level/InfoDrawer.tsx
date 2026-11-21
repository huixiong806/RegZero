import { BookOpen, Lightbulb, PlayCircle, X } from 'lucide-react';
import type { HintItem } from '../../engine/types';
import { t } from '../../i18n';
import { HintDrawer } from './HintDrawer';
import { SimpleMarkdown } from './SimpleMarkdown';

interface InfoDrawerProps {
  mode: 'lesson' | 'hints' | null;
  title: string;
  beforeText: string;
  afterText: string;
  lessonMarkdown: string;
  hints: HintItem[];
  wikiRefs: string[];
  wikiTitles?: Record<string, string>;
  canReplayBriefing?: boolean;
  onReplayBriefing?: () => void;
  onSwitchMode: (mode: 'lesson' | 'hints') => void;
  onOpenWiki: (topic: string) => void;
  onClose: () => void;
}

export function InfoDrawer({
  mode,
  title,
  beforeText,
  afterText,
  lessonMarkdown,
  hints,
  wikiRefs,
  wikiTitles = {},
  canReplayBriefing = false,
  onReplayBriefing,
  onSwitchMode,
  onOpenWiki,
  onClose,
}: InfoDrawerProps) {
  if (!mode) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/60 backdrop-blur-xs">
      <div className="flex h-full w-full max-w-md flex-col border-l border-slate-800 bg-slate-900 shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => onSwitchMode('lesson')}
              className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold ${
                mode === 'lesson'
                  ? 'bg-cyan-500/20 text-cyan-200'
                  : 'text-slate-400 hover:bg-slate-800'
              }`}
            >
              <BookOpen className="h-3.5 w-3.5" /> 规则说明
            </button>
            <button
              type="button"
              onClick={() => onSwitchMode('hints')}
              className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold ${
                mode === 'hints'
                  ? 'bg-amber-500/20 text-amber-200'
                  : 'text-slate-400 hover:bg-slate-800'
              }`}
            >
              <Lightbulb className="h-3.5 w-3.5" /> 3 级提示
            </button>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-800 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-4">
          <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-3 text-xs">
            <div className="flex items-center justify-between gap-2">
              <div className="font-bold text-white">{title}</div>
              {canReplayBriefing && onReplayBriefing && (
                <button
                  type="button"
                  onClick={onReplayBriefing}
                  className="inline-flex shrink-0 items-center gap-1 rounded-md border border-cyan-500/40 bg-cyan-500/10 px-2 py-0.5 text-[11px] font-medium text-cyan-300 transition hover:bg-cyan-500/20"
                >
                  <PlayCircle className="h-3 w-3" /> {t('briefing.replay')}
                </button>
              )}
            </div>
            <div className="mt-1.5 text-slate-400">{t('drawer.beforePrefix')}{beforeText}</div>
            <div className="mt-0.5 text-cyan-300">{t('drawer.afterPrefix')}{afterText}</div>
          </div>

          {mode === 'lesson' ? (
            <>
              <SimpleMarkdown content={lessonMarkdown} />
              {wikiRefs.length > 0 && (
                <div className="flex flex-wrap gap-1.5 pt-2">
                  {wikiRefs.map((topic) => (
                    <button
                      key={topic}
                      type="button"
                      onClick={() => onOpenWiki(topic)}
                      className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 bg-slate-950 px-2.5 py-1 text-xs text-cyan-300 hover:bg-slate-800"
                    >
                      <BookOpen className="h-3 w-3" /> {wikiTitles[topic] ?? topic}
                    </button>
                  ))}
                </div>
              )}
            </>
          ) : (
            <HintDrawer hints={hints} />
          )}
        </div>
      </div>
    </div>
  );
}
