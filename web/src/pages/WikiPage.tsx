import { useEffect, useMemo, useState } from 'react';
import { BookOpen } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { useAppContext } from '../app/AppShell';
import { WikiContent } from '../components/wiki/WikiContent';
import { filterWikiEntries } from '../domain/knowledge';
import { defaultEngineClient } from '../engine/OnlineWasmClient';
import type { WikiEntry } from '../engine/types';

export function WikiPage() {
  const { topic } = useParams();
  const { knowledge } = useAppContext();
  const [rawEntries, setRawEntries] = useState<WikiEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    defaultEngineClient
      .listWiki()
      .then((list) => {
        if (active) setRawEntries(list);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const visibleEntries = useMemo(
    () => filterWikiEntries(rawEntries, knowledge),
    [rawEntries, knowledge],
  );

  const current = visibleEntries.find((e) => e.topic === topic) ?? visibleEntries[0];

  return (
    <div className="grid gap-5 lg:grid-cols-12">
      <aside className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4 lg:col-span-3">
        <div className="mb-3 flex items-center justify-between gap-2">
          <span className="inline-flex items-center gap-2 text-sm font-bold text-white">
            <BookOpen className="h-4 w-4 text-cyan-400" /> 概念图鉴
          </span>
          {knowledge.revealAll && (
            <span className="rounded-full border border-amber-400/50 bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold text-amber-200">
              全量
            </span>
          )}
        </div>

        <div className="space-y-1">
          {visibleEntries.map((item) => (
            <Link
              key={item.topic}
              to={`/wiki/${item.topic}`}
              className={`block rounded-lg px-3 py-2 text-xs font-medium transition ${
                current?.topic === item.topic
                  ? 'bg-cyan-500/20 text-cyan-200 ring-1 ring-cyan-500/40'
                  : 'text-slate-300 hover:bg-slate-800'
              }`}
            >
              {item.title}
            </Link>
          ))}
        </div>

        {!knowledge.revealAll && (
          <p className="mt-4 border-t border-slate-800/80 pt-3 text-[11px] leading-relaxed text-slate-500">
            图鉴会随你的通关进度不断补充新词条与新指令。
          </p>
        )}
      </aside>

      <article className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6 lg:col-span-9">
        {loading ? (
          <div className="text-xs text-slate-400">正在加载概念图鉴…</div>
        ) : current ? (
          <WikiContent entry={current} />
        ) : (
          <div className="text-xs text-slate-400">进入第一关后即可解锁初始概念图鉴。</div>
        )}
      </article>
    </div>
  );
}
