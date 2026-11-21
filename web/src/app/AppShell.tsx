import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { BookOpen, Cpu, Compass, Map, TerminalSquare } from 'lucide-react';
import { Link, NavLink, Outlet } from 'react-router-dom';
import { buildKnowledgeState, type KnowledgeState } from '../domain/knowledge';
import { defaultEngineClient } from '../engine/OnlineWasmClient';
import { loadProgress, resetAllProgress, updateSettings } from '../engine/progressStorage';
import type { LevelSummary, UserProgress } from '../engine/types';

function loadInitialProgress(): UserProgress {
  if (typeof window !== 'undefined') {
    const params = new URLSearchParams(window.location.search);
    if (params.get('reset') === '1') {
      const fresh = resetAllProgress();
      params.delete('reset');
      const nextSearch = params.toString();
      const nextUrl = `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ''}${window.location.hash}`;
      window.history.replaceState(null, '', nextUrl);
      return fresh;
    }
  }
  return loadProgress();
}

interface AppContextValue {
  progress: UserProgress;
  levels: LevelSummary[];
  levelsLoading: boolean;
  levelsError: string | null;
  wikiTitles: Record<string, string>;
  knowledge: KnowledgeState;
  refreshProgress: () => void;
  toggleFreeExplore: () => void;
}

const initialProgress = loadInitialProgress();

const AppContext = createContext<AppContextValue>({
  progress: initialProgress,
  levels: [],
  levelsLoading: true,
  levelsError: null,
  wikiTitles: {},
  knowledge: buildKnowledgeState([], initialProgress),
  refreshProgress: () => undefined,
  toggleFreeExplore: () => undefined,
});

export function useAppContext(): AppContextValue {
  return useContext(AppContext);
}

export function AppShell() {
  const [progress, setProgress] = useState<UserProgress>(() => loadInitialProgress());
  const [levels, setLevels] = useState<LevelSummary[]>([]);
  const [levelsLoading, setLevelsLoading] = useState(true);
  const [levelsError, setLevelsError] = useState<string | null>(null);
  const [wikiTitles, setWikiTitles] = useState<Record<string, string>>({});

  useEffect(() => {
    let active = true;
    defaultEngineClient
      .listWiki()
      .then((list) => {
        if (!active) return;
        const map: Record<string, string> = {};
        for (const item of list) map[item.topic] = item.title;
        setWikiTitles(map);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    defaultEngineClient
      .listLevels(progress)
      .then((list) => {
        if (!active) return;
        setLevels(list);
        setLevelsError(null);
      })
      .catch((err) => {
        if (active) setLevelsError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (active) setLevelsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [progress]);

  const knowledge = useMemo(
    () => buildKnowledgeState(levels, progress),
    [levels, progress],
  );

  const refreshProgress = () => setProgress(loadProgress());

  const toggleFreeExplore = () => {
    const next = updateSettings({ freeExplore: !progress.settings.freeExplore });
    setProgress(next);
  };

  const navClass = ({ isActive }: { isActive: boolean }) =>
    `inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
      isActive
        ? 'bg-cyan-500/20 text-cyan-200 ring-1 ring-cyan-500/40'
        : 'text-slate-300 hover:bg-slate-800 hover:text-white'
    }`;

  return (
    <AppContext.Provider
      value={{
        progress,
        levels,
        levelsLoading,
        levelsError,
        wikiTitles,
        knowledge,
        refreshProgress,
        toggleFreeExplore,
      }}
    >
      <div className="flex min-h-screen flex-col bg-slate-950 text-slate-100">
        <header className="sticky top-0 z-30 border-b border-slate-800/90 bg-slate-950/90 backdrop-blur">
          <div className="mx-auto flex max-w-[1440px] flex-wrap items-center justify-between gap-3 px-4 py-2.5">
            <div className="flex items-center gap-4">
              <Link to="/" className="flex items-center gap-2 text-sm font-bold text-white">
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-cyan-500 text-slate-950">
                  <Cpu className="h-4 w-4" />
                </span>
                <span>Neo Magic Compiler</span>
              </Link>

              <nav className="flex items-center gap-1">
                <NavLink to="/" end className={navClass}>
                  <Map className="h-3.5 w-3.5" /> 关卡技能树
                </NavLink>
                <NavLink to="/playground" className={navClass}>
                  <TerminalSquare className="h-3.5 w-3.5" /> 自由练习
                </NavLink>
                <NavLink to="/wiki" className={navClass}>
                  <BookOpen className="h-3.5 w-3.5" /> 概念图鉴
                </NavLink>
              </nav>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={toggleFreeExplore}
                title="开启后无需前置即可跳关，并展示全部图鉴与底层硬件信息"
                className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium transition ${
                  progress.settings.freeExplore
                    ? 'border-amber-400/60 bg-amber-500/20 text-amber-200'
                    : 'border-slate-800 bg-slate-900 text-slate-400 hover:text-slate-200'
                }`}
              >
                <Compass className="h-3.5 w-3.5" />
                <span>自由探索</span>
              </button>
            </div>
          </div>
        </header>

        <main className="mx-auto w-full max-w-[1440px] flex-1 px-4 py-5">
          <Outlet />
        </main>
      </div>
    </AppContext.Provider>
  );
}
