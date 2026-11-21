import { useEffect, useMemo, useState } from 'react';
import { BookOpen, X } from 'lucide-react';
import { filterWikiEntries, type KnowledgeState } from '../../domain/knowledge';
import { defaultEngineClient } from '../../engine/OnlineWasmClient';
import type { WikiEntry } from '../../engine/types';
import { WikiContent } from '../wiki/WikiContent';

interface WikiDrawerProps {
  topic: string | null;
  knowledge: KnowledgeState;
  highlightConcepts?: ReadonlySet<string>;
  onSelectTopic?: (topic: string) => void;
  onClose: () => void;
}

export function WikiDrawer({
  topic,
  knowledge,
  highlightConcepts,
  onSelectTopic,
  onClose,
}: WikiDrawerProps) {
  const [rawEntries, setRawEntries] = useState<WikiEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!topic) return;
    let active = true;
    setLoading(true);
    setError(null);
    defaultEngineClient
      .listWiki()
      .then((list) => {
        if (active) setRawEntries(list);
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [topic]);

  const visibleEntries = useMemo(
    () => filterWikiEntries(rawEntries, knowledge, highlightConcepts),
    [rawEntries, knowledge, highlightConcepts],
  );

  if (!topic) return null;

  const current = visibleEntries.find((e) => e.topic === topic) ?? visibleEntries[0] ?? null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/60 backdrop-blur-xs">
      <div className="flex h-full w-full max-w-lg flex-col border-l border-slate-800 bg-slate-900 shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
          <span className="inline-flex items-center gap-2 text-sm font-bold text-white">
            <BookOpen className="h-4 w-4 text-cyan-400" />
            {current?.title ?? '概念图鉴'}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-800 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* 已解锁词条快捷切换标签 */}
        {visibleEntries.length > 1 && (
          <div className="flex flex-wrap gap-1.5 border-b border-slate-800/80 bg-slate-950/50 px-4 py-2">
            {visibleEntries.map((item) => (
              <button
                key={item.topic}
                type="button"
                onClick={() => onSelectTopic?.(item.topic)}
                className={`rounded-lg px-2.5 py-1 text-xs font-medium transition ${
                  current?.topic === item.topic
                    ? 'bg-cyan-500/20 text-cyan-200 ring-1 ring-cyan-500/40'
                    : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
                }`}
              >
                {item.title}
              </button>
            ))}
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-4">
          {error ? (
            <div className="text-xs text-rose-300">{error}</div>
          ) : loading && !current ? (
            <div className="text-xs text-slate-400">正在加载词条…</div>
          ) : current ? (
            <WikiContent entry={current} showTitle={false} />
          ) : (
            <div className="text-xs text-slate-400">该词条将在后续关卡解锁。</div>
          )}
        </div>
      </div>
    </div>
  );
}
