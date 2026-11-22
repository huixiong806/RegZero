import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Target } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { useAppContext } from '../app/AppShell';
import { GoalCard } from '../components/level/GoalCard';
import { InfoDrawer } from '../components/level/InfoDrawer';
import { LevelBriefingModal } from '../components/level/LevelBriefingModal';
import { WikiDrawer } from '../components/level/WikiDrawer';
import type { CodeEditorHandle } from '../components/playground/CodeEditor';
import { PlaygroundWorkspace } from '../components/playground/PlaygroundWorkspace';
import {
  buildKnowledgeState,
  getLevelNewConcepts,
  resolveLevelUiDisclosure,
} from '../domain/knowledge';
import { defaultEngineClient } from '../engine/OnlineWasmClient';
import { hasSeenBriefing, markBriefingSeen } from '../engine/progressStorage';
import type { LevelPayload, SubmitDto } from '../engine/types';
import type { LiveCpuPlayback } from '../sandboxes/manual-cpu/pulseModel';
import { renderSandbox } from '../sandboxes/registry';

export function LevelPage() {
  const { id = '1-1' } = useParams();
  const { progress, levels, wikiTitles, refreshProgress } = useAppContext();
  const editorRef = useRef<CodeEditorHandle | null>(null);
  const lessonBtnRef = useRef<HTMLButtonElement | null>(null);
  const pulseTimerRef = useRef<number | null>(null);

  const [level, setLevel] = useState<LevelPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [drawerMode, setDrawerMode] = useState<'lesson' | 'hints' | null>(null);
  const [wikiTopic, setWikiTopic] = useState<string | null>(null);
  const [justPassed, setJustPassed] = useState(false);
  const [focusStage, setFocusStage] = useState<'sandbox' | 'code'>('code');
  const [editorGuide, setEditorGuide] = useState<string | null>(null);
  const [showBriefing, setShowBriefing] = useState(false);
  const [pulseLessonBtn, setPulseLessonBtn] = useState(false);
  const [livePlayback, setLivePlayback] = useState<LiveCpuPlayback | null>(null);
  const [exitPlaybackNonce, setExitPlaybackNonce] = useState(0);

  const alreadyPassed = Boolean(progress.levels[id]?.passed);

  useEffect(() => {
    return () => {
      if (pulseTimerRef.current !== null) window.clearTimeout(pulseTimerRef.current);
    };
  }, []);

  // 仅在切换关卡 id 时重新加载关卡内容并重置通关态，避免提交更新 progress 时卸载工作台
  useEffect(() => {
    let active = true;
    setLoading(true);
    setJustPassed(false);
    setDrawerMode(null);
    setEditorGuide(null);
    setShowBriefing(false);
    setPulseLessonBtn(false);
    setLivePlayback(null);
    defaultEngineClient
      .loadLevel(id)
      .then((payload) => {
        if (!active) return;
        setLevel(payload);
        setError(null);
        const wantsWarmup =
          payload.meta.sandbox.type === 'manual-cpu' &&
          Boolean(payload.meta.sandbox.focusWarmupFirst);
        setFocusStage(!alreadyPassed && wantsWarmup ? 'sandbox' : 'code');
        const slides = payload.meta.briefing ?? [];
        if (slides.length > 0 && !alreadyPassed && !hasSeenBriefing(payload.id)) {
          setShowBriefing(true);
        }
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const levelKnowledge = useMemo(
    () => buildKnowledgeState(levels, progress, id),
    [levels, progress, id],
  );
  const levelNewConcepts = useMemo(
    () => getLevelNewConcepts(levels, id),
    [levels, id],
  );
  // 单关 UI 与 CPU 舞台部件严格由本关 `meta.ui` 独立决定（零跨关继承，便于玩家自定义关卡）
  const levelUi = useMemo(
    () => resolveLevelUiDisclosure(level?.meta.ui),
    [level?.meta.ui],
  );

  const handleFocusEditor = () => {
    setFocusStage('code');
    setEditorGuide('结合左侧指令格式与上方本关目标，在编辑器中写下你的代码，然后点「运行并提交」。');
    editorRef.current?.focusEditableLine();
  };

  const handleSubmitted = (res: SubmitDto) => {
    refreshProgress();
    setEditorGuide(null);
    if (res.passed) {
      setJustPassed(true);
    }
  };

  if (loading) {
    return <div className="py-16 text-center text-sm text-slate-400">正在加载关卡 {id}…</div>;
  }
  if (error || !level) {
    return (
      <div className="space-y-3 rounded-2xl border border-rose-500/40 bg-rose-950/30 p-6">
        <div className="text-sm font-semibold text-rose-200">无法加载关卡 {id}</div>
        <div className="font-mono text-xs text-rose-300">{error}</div>
        <Link to="/" className="inline-flex items-center gap-1 text-xs text-cyan-300 hover:underline">
          <ArrowLeft className="h-3.5 w-3.5" /> 返回技能树
        </Link>
      </div>
    );
  }

  const record = progress.levels[level.id];
  const passed = Boolean(record?.passed);
  const metPar = Boolean(record?.metPar);
  const bestSteps = record?.bestSteps;
  const nextUnlocked = levels.filter(
    (l) => l.prerequisites.includes(level.id) && l.id !== level.id,
  );
  const nextMain = nextUnlocked.find((l) => l.kind !== 'challenge');
  const nextSide = nextUnlocked.find((l) => l.kind === 'challenge');

  const isManualCpu = level.meta.sandbox.type === 'manual-cpu';
  const isMonitorOnly =
    isManualCpu &&
    level.meta.sandbox.recordToAsm === false &&
    !level.meta.sandbox.pcTrack;
  const wantsWarmup = isManualCpu && Boolean(level.meta.sandbox.focusWarmupFirst);
  const isPlayingCode = Boolean(livePlayback?.active);
  const dimRight = wantsWarmup && !isPlayingCode && focusStage === 'sandbox';
  const dimLeft = wantsWarmup && !isPlayingCode && focusStage === 'code';

  return (
    <div className="space-y-3">
      <GoalCard
        meta={level.meta}
        passed={passed}
        metPar={metPar}
        bestSteps={bestSteps}
        benchmarkCount={level.benchmarkCount}
        justPassed={justPassed}
        nextMain={nextMain}
        nextSide={nextSide}
        lessonBtnRef={lessonBtnRef}
        pulseLessonBtn={pulseLessonBtn}
        onOpenLesson={() => setDrawerMode('lesson')}
        onOpenHints={() => setDrawerMode('hints')}
        onOpenWiki={(topic) => setWikiTopic(topic)}
      />

      {/* 常驻高亮的本关目标条：位于两栏之上，无论处于试算、编码还是动画播放阶段始终清晰可见 */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl border border-cyan-500/35 bg-cyan-950/20 px-4 py-2.5 text-xs shadow-[0_0_20px_rgba(34,211,238,0.06)]">
        <span className="inline-flex items-center gap-1.5 font-bold text-cyan-300">
          <Target className="h-4 w-4" /> 本关目标
        </span>
        <span className="text-slate-300">{level.meta.goalSummary.before}</span>
        <ArrowRight className="h-3.5 w-3.5 shrink-0 text-cyan-400" />
        <span className="font-semibold text-white">{level.meta.goalSummary.after}</span>
      </div>

      {/* 统一双栏：左 CPU 电路舞台（可手动试算 + 自动演示代码脉冲） / 右代码编辑与验证 */}
      <div className="grid gap-3.5 lg:grid-cols-12">
        <div
          onMouseDown={() => {
            if (!isPlayingCode) setFocusStage('sandbox');
          }}
          className={`space-y-1.5 transition-opacity duration-200 lg:col-span-5 ${
            dimLeft ? 'opacity-85 hover:opacity-100' : 'opacity-100'
          }`}
        >
          <div className="flex items-center justify-between px-1">
            <span
              className={`inline-flex items-center gap-1.5 text-[11px] font-semibold ${
                isPlayingCode || !dimLeft ? 'text-cyan-300' : 'text-slate-500'
              }`}
            >
              {wantsWarmup ? (
                <>
                  <span
                    className={`flex h-4 w-4 items-center justify-center rounded-full font-mono text-[10px] font-bold ${
                      isPlayingCode || !dimLeft
                        ? 'bg-cyan-400 text-slate-950'
                        : 'bg-slate-800 text-slate-400'
                    }`}
                  >
                    1
                  </span>
                  {isPlayingCode ? '代码执行舞台' : '先动手试算'}
                </>
              ) : isPlayingCode ? (
                'CPU 执行舞台'
              ) : isMonitorOnly ? (
                'CPU 执行监视器'
              ) : (
                'CPU 舞台（可选手动试算）'
              )}
            </span>
          </div>
          <div
            className={`rounded-2xl transition ${
              isPlayingCode
                ? 'ring-1 ring-cyan-400/60 shadow-[0_0_24px_rgba(34,211,238,0.12)]'
                : !dimLeft && wantsWarmup
                  ? 'ring-1 ring-cyan-500/35'
                  : ''
            }`}
          >
            {renderSandbox({
              config: level.meta.sandbox,
              disclosure: levelUi,
              playback: livePlayback,
              onExitPlayback: () => setExitPlaybackNonce((n) => n + 1),
              onFocusEditor: handleFocusEditor,
            })}
          </div>
        </div>

        <div
          onMouseDown={() => setFocusStage('code')}
          onFocusCapture={() => setFocusStage('code')}
          className={`space-y-1.5 transition-opacity duration-200 lg:col-span-7 ${
            dimRight ? 'opacity-55 hover:opacity-95' : 'opacity-100'
          }`}
        >
          <div className="flex items-center justify-between px-1">
            <span
              className={`inline-flex items-center gap-1.5 text-[11px] font-semibold ${
                !dimRight ? 'text-emerald-300' : 'text-slate-500'
              }`}
            >
              {wantsWarmup ? (
                <>
                  <span
                    className={`flex h-4 w-4 items-center justify-center rounded-full font-mono text-[10px] font-bold ${
                      !dimRight
                        ? 'bg-emerald-400 text-slate-950'
                        : 'bg-slate-800 text-slate-400'
                    }`}
                  >
                    2
                  </span>
                  写下指令并提交
                </>
              ) : (
                '编写指令并运行'
              )}
            </span>
          </div>
          <div
            className={`rounded-2xl transition ${
              !dimRight && wantsWarmup ? 'ring-1 ring-emerald-500/35' : ''
            }`}
          >
            <PlaygroundWorkspace
              level={level}
              editorRef={editorRef}
              disclosure={levelUi}
              guideHint={editorGuide}
              hideRegisterPanel={isManualCpu}
              exitPlaybackNonce={exitPlaybackNonce}
              onPlaybackChange={isManualCpu ? setLivePlayback : undefined}
              onUserEdit={() => setEditorGuide(null)}
              onSubmitted={handleSubmitted}
            />
          </div>
        </div>
      </div>

      <InfoDrawer
        mode={drawerMode}
        title={`${level.id} · ${level.meta.title}`}
        storySummary={level.meta.briefing?.[0]}
        beforeText={level.meta.goalSummary.before}
        afterText={level.meta.goalSummary.after}
        lessonMarkdown={level.lessonMarkdown}
        hints={level.meta.hints}
        wikiRefs={level.meta.wikiRefs}
        wikiTitles={wikiTitles}
        canReplayBriefing={(level.meta.briefing?.length ?? 0) > 0}
        onReplayBriefing={() => {
          setDrawerMode(null);
          setShowBriefing(true);
        }}
        onSwitchMode={setDrawerMode}
        onOpenWiki={(topic) => {
          setDrawerMode(null);
          setWikiTopic(topic);
        }}
        onClose={() => setDrawerMode(null)}
      />

      <WikiDrawer
        topic={wikiTopic}
        knowledge={levelKnowledge}
        highlightConcepts={levelNewConcepts}
        onSelectTopic={setWikiTopic}
        onClose={() => setWikiTopic(null)}
      />

      {showBriefing && level.meta.briefing && level.meta.briefing.length > 0 && (
        <LevelBriefingModal
          levelId={level.id}
          title={level.meta.title}
          slides={level.meta.briefing}
          targetAnchorRef={lessonBtnRef}
          onLanded={() => {
            setPulseLessonBtn(true);
            if (pulseTimerRef.current !== null) window.clearTimeout(pulseTimerRef.current);
            pulseTimerRef.current = window.setTimeout(() => setPulseLessonBtn(false), 900);
          }}
          onComplete={() => {
            markBriefingSeen(level.id);
            setShowBriefing(false);
          }}
        />
      )}
    </div>
  );
}
