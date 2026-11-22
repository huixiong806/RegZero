import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import {
  ArrowRight,
  Check,
  Cpu,
  Hand,
  Play,
  RotateCcw,
  Square,
  Target,
  Terminal,
  Undo2,
} from 'lucide-react';
import type { ManualCpuAluOp, ManualCpuSandboxConfig } from '../../engine/types';
import { AluDesk, type ActiveSlot } from './AluDesk';
import {
  buildStageSequence,
  getStageDurationMs,
  getStageSeconds,
  totalSequenceMs,
  type DatapathStage,
  type PlaybackSpeed,
} from './datapathTimeline';
import { PcTrackDesk } from './PcTrackDesk';
import { RegisterFileBox } from './RegisterFileBox';
import { StageStrip } from './StageStrip';
import {
  applyAluOperation,
  collectUsedSyntaxPatterns,
  createManualCpuState,
  undoManualCpu,
  type ManualCpuState,
  type SourceOperand,
  type SyntaxSlot,
} from './model';
import { stepPcTrackWithPulse } from './pcTrackModel';
import {
  manualAluToPulse,
  type CpuPulseEvent,
  type LiveCpuPlayback,
} from './pulseModel';
import { formatDatapathValue, type RegRadix } from './radixFormat';

export interface ManualCpuSandboxProps {
  config: ManualCpuSandboxConfig;
  showRegXName?: boolean;
  allowExpandAllRegs?: boolean;
  showHexToggle?: boolean;
  showBinToggle?: boolean;
  showPcAddress?: boolean;
  immediateUnlocked?: boolean;
  showJumpRail?: boolean;
  memoryUnlocked?: boolean;
  showPipelineStages?: boolean;
  playback?: LiveCpuPlayback | null;
  onExitPlayback?: () => void;
  onFocusEditor?: () => void;
}

export function ManualCpuSandbox({
  config,
  showRegXName = false,
  allowExpandAllRegs = false,
  showHexToggle = false,
  showBinToggle = false,
  showPcAddress = false,
  immediateUnlocked = false,
  showJumpRail = false,
  memoryUnlocked = false,
  showPipelineStages = false,
  playback = null,
  onExitPlayback,
  onFocusEditor,
}: ManualCpuSandboxProps) {
  const [state, setState] = useState<ManualCpuState>(() => createManualCpuState(config, 0));
  const [left, setLeft] = useState<SourceOperand | null>(null);
  const [right, setRight] = useState<SourceOperand | null>(null);
  const [activeSlot, setActiveSlot] = useState<ActiveSlot>('left');
  const [op, setOp] = useState<ManualCpuAluOp>(config.aluOps?.[0] ?? '+');
  const [destReg, setDestReg] = useState<string | null>(null);
  const [manualPulse, setManualPulse] = useState<CpuPulseEvent | null>(null);
  const [pulseSeq, setPulseSeq] = useState(0);
  const [activeStage, setActiveStage] = useState<DatapathStage>('idle');
  const [wbLanded, setWbLanded] = useState(false);
  const [pcJumpDone, setPcJumpDone] = useState(false);
  const [slotChoices, setSlotChoices] = useState<Record<number, number>>({});
  const [demoPlaying, setDemoPlaying] = useState(false);
  const [demoSpeed, setDemoSpeed] = useState<PlaybackSpeed>(1);
  const [passedDemoCases, setPassedDemoCases] = useState<Set<number>>(() => new Set());
  const [radix, setRadix] = useState<RegRadix>('dec');

  // 实时测量中轴 6 处几何锚点，保证左写回轨、右存内存内轨与右跳转外轨在任何布局下像素级闭合
  const stageBodyRef = useRef<HTMLDivElement | null>(null);
  const pcBarRef = useRef<HTMLDivElement | null>(null);
  const regBoxRef = useRef<HTMLDivElement | null>(null);
  const busRef = useRef<HTMLDivElement | null>(null);
  const aluBoxRef = useRef<HTMLDivElement | null>(null);
  const memStageRef = useRef<HTMLDivElement | null>(null);
  const wbBoxRef = useRef<HTMLDivElement | null>(null);
  const [railGeo, setRailGeo] = useState({
    stageH: 480,
    pcY: 17,
    regY: 96,
    tapY: 162,
    aluY: 274,
    memY: 386,
    wbY: 446,
  });

  const availableRadices: readonly RegRadix[] = showBinToggle
    ? ['dec', 'u32', 'hex', 'bin']
    : showHexToggle
      ? ['dec', 'hex']
      : ['dec'];
  const activeRadix: RegRadix = availableRadices.includes(radix) ? radix : 'dec';

  useEffect(() => {
    setState(createManualCpuState(config, 0));
    setLeft(null);
    setRight(null);
    setActiveSlot('left');
    setOp(config.aluOps?.[0] ?? '+');
    setDestReg(null);
    setManualPulse(null);
    setActiveStage('idle');
    setWbLanded(false);
    setPcJumpDone(false);
    setSlotChoices({});
    setDemoPlaying(false);
    setPassedDemoCases(new Set());
  }, [config]);

  const hasAlu = config.modules.includes('alu');
  const hasConstants = config.modules.includes('constants') && (config.constantCards?.length ?? 0) > 0;
  const hasPcTrack = config.modules.includes('pcTrack') && Boolean(config.pcTrack);
  // 方案 A：recordToAsm === false 且无例程轨的关卡（1-6 及之后）纯由代码驱动，左侧 CPU 舞台作为实时执行监视器，不显示半残手动试算
  const isMonitorOnly = config.recordToAsm === false && !hasPcTrack;

  const isPlayback = Boolean(playback?.active);
  const isStageReadonly = isPlayback || hasPcTrack || isMonitorOnly;
  const hasTopBar = showPipelineStages || isPlayback || isMonitorOnly;
  const displayRegs = isPlayback ? playback!.regs : state.regs;
  const activePulse = isPlayback ? playback!.pulse : manualPulse;
  const speed: PlaybackSpeed = isPlayback ? playback!.speed : hasPcTrack ? demoSpeed : 1;

  // 监听中轴尺寸变化，像素级同步左右外轨与全部模块中线（PC / 寄存器 / 44px 总线分流口 / ALU / 访存 / 存入）
  useLayoutEffect(() => {
    const stageEl = stageBodyRef.current;
    if (!stageEl) return;

    const measure = () => {
      const stageRect = stageEl.getBoundingClientRect();
      if (stageRect.height < 40) return;
      const stageH = Math.round(stageRect.height);
      const centerY = (el: HTMLDivElement | null, fallbackRatio: number) => {
        const r = el?.getBoundingClientRect();
        return r && r.height > 0
          ? Number((r.top - stageRect.top + r.height / 2).toFixed(1))
          : Math.round(stageH * fallbackRatio);
      };
      const pcY = centerY(pcBarRef.current, 0.04);
      const regY = centerY(regBoxRef.current, 0.2);
      const busRect = busRef.current?.getBoundingClientRect();
      // 44px 总线中，水平分流线精确位于 y=12（按实际渲染高度等比换算，杜绝 1px 偏移）
      const tapY =
        busRect && busRect.height > 0
          ? Number((busRect.top - stageRect.top + (busRect.height * 12) / 44).toFixed(1))
          : Math.round(stageH * 0.34);
      const aluY = centerY(aluBoxRef.current, 0.58);
      const memY = centerY(memStageRef.current, 0.8);
      const wbY = centerY(wbBoxRef.current, 0.93);
      setRailGeo((prev) =>
        prev.stageH === stageH &&
        prev.pcY === pcY &&
        prev.regY === regY &&
        prev.tapY === tapY &&
        prev.aluY === aluY &&
        prev.memY === memY &&
        prev.wbY === wbY
          ? prev
          : { stageH, pcY, regY, tapY, aluY, memY, wbY },
      );
    };

    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(stageEl);
    for (const r of [pcBarRef, regBoxRef, busRef, aluBoxRef, memStageRef, wbBoxRef]) {
      if (r.current) ro.observe(r.current);
    }
    return () => ro.disconnect();
  }, [config, isPlayback, hasTopBar, memoryUnlocked, activeRadix, activePulse?.kind]);

  // 连续数据流时间轴驱动器：手玩、修 Bug 小例程与代码播放共用同一套精确接力节拍
  useEffect(() => {
    if (!activePulse) {
      setActiveStage('idle');
      setWbLanded(false);
      setPcJumpDone(false);
      return;
    }
    const frames = buildStageSequence(activePulse, isPlayback, memoryUnlocked);
    if (frames.length === 0) {
      setActiveStage('idle');
      setWbLanded(false);
      setPcJumpDone(false);
      return;
    }

    const isTakenJump =
      (activePulse.kind === 'branch' || activePulse.kind === 'jump') &&
      Boolean(activePulse.branchTaken);

    setWbLanded(false);
    setPcJumpDone(false);
    const timers: number[] = [];
    let elapsed = 0;
    for (const frame of frames) {
      const startAt = elapsed;
      const dur = getStageDurationMs(frame, speed);
      timers.push(
        window.setTimeout(() => {
          setActiveStage(frame.stage);
          if (frame.stage !== 'writeback') setWbLanded(false);
        }, startAt),
      );
      // 写回/跳转胶囊爬升 58% 时长后抵达目标（寄存器或顶部 PC），瞬间翻牌并顶飞旧值
      if (frame.stage === 'writeback') {
        timers.push(
          window.setTimeout(() => {
            setWbLanded(true);
            if (isTakenJump) setPcJumpDone(true);
          }, startAt + Math.round(dur * 0.58)),
        );
      }
      elapsed += dur;
    }
    // 全部阶段走完后平稳回落至 idle 态（保留 pcJumpDone，避免单步暂停时 PC 又回退成旧行号）
    timers.push(
      window.setTimeout(() => {
        setActiveStage('idle');
        setWbLanded(false);
      }, elapsed),
    );
    return () => {
      for (const id of timers) window.clearTimeout(id);
    };
  }, [activePulse, isPlayback, memoryUnlocked, speed]);

  const stepDemoOnce = useCallback(() => {
    const nextSeq = pulseSeq + 1;
    const outcome = stepPcTrackWithPulse(state, config, slotChoices, nextSeq);
    setState(outcome.state);
    if (outcome.pulse) {
      setPulseSeq(nextSeq);
      setManualPulse(outcome.pulse);
    } else {
      setManualPulse(null);
      setActiveStage('idle');
    }
    if (outcome.state.halted) {
      setDemoPlaying(false);
      if (outcome.state.completed) {
        setPassedDemoCases((prev) => {
          const next = new Set(prev);
          next.add(outcome.state.caseIndex);
          return next;
        });
      }
    }
  }, [config, pulseSeq, slotChoices, state]);

  // 修 Bug 小例程自动试跑驱动器：与统一 CPU 舞台动画节拍精确同步
  useEffect(() => {
    if (!hasPcTrack || isPlayback || !demoPlaying) return;
    if (state.halted) {
      setDemoPlaying(false);
      return;
    }
    const delay =
      state.recordings.length === 0
        ? Math.max(40, Math.round(320 / demoSpeed))
        : manualPulse
          ? totalSequenceMs(buildStageSequence(manualPulse, false), demoSpeed) +
            Math.max(30, Math.round(240 / demoSpeed))
          : Math.max(80, Math.round(520 / demoSpeed));
    const id = window.setTimeout(() => {
      stepDemoOnce();
    }, delay);
    return () => window.clearTimeout(id);
  }, [demoPlaying, demoSpeed, hasPcTrack, isPlayback, manualPulse, state.halted, state.recordings.length, stepDemoOnce]);

  const assignDestOperand = (operand: SourceOperand) => {
    if (isPlayback) return;
    if (operand.kind !== 'reg') {
      setState((prev) => ({
        ...prev,
        feedback: { tone: 'warn', message: '常量不能作为输出目标，请选择寄存器。' },
      }));
      return;
    }
    if (operand.name === 'zero') {
      setState((prev) => ({
        ...prev,
        feedback: { tone: 'warn', message: 'zero (x0) 恒为 0，不能作为输出目标。' },
      }));
      return;
    }
    setDestReg(operand.name);
    setState((prev) => (prev.feedback?.tone === 'warn' ? { ...prev, feedback: null } : prev));
    if (!left) setActiveSlot('left');
    else if (!right) setActiveSlot('right');
  };

  const handleSelectOperand = (operand: SourceOperand) => {
    if (isPlayback || !hasAlu) return;
    if (activeSlot === 'dest') {
      assignDestOperand(operand);
      return;
    }
    if (activeSlot === 'left') {
      setLeft(operand);
      setActiveSlot(!right ? 'right' : !destReg ? 'dest' : 'right');
    } else {
      setRight(operand);
      setActiveSlot(!destReg ? 'dest' : !left ? 'left' : 'left');
    }
  };

  const runManualAlu = (
    lhs: SourceOperand,
    operator: ManualCpuAluOp,
    rhs: SourceOperand,
    target: string,
  ) => {
    const next = applyAluOperation(state, config, lhs, operator, rhs, target);
    setState(next);
    if (next.recordings.length > state.recordings.length) {
      const nextSeq = pulseSeq + 1;
      setPulseSeq(nextSeq);
      setManualPulse(manualAluToPulse(lhs, operator, rhs, target, state.regs, next.regs, nextSeq));
    }
  };

  const handleReset = (nextCaseIndex = state.caseIndex) => {
    setState(createManualCpuState(config, nextCaseIndex));
    setLeft(null);
    setRight(null);
    setDestReg(null);
    setManualPulse(null);
    setActiveStage('idle');
    setWbLanded(false);
    setDemoPlaying(false);
    setActiveSlot('left');
  };

  const activeGoalRegs = isPlayback
    ? playback?.goalRegs ?? {}
    : isMonitorOnly
      ? {}
      : config.pcTrack?.cases?.[state.caseIndex]?.goal.regs ?? config.warmupPuzzle.goal.regs ?? {};

  const inFetch = activeStage === 'fetch';
  const inWriteback = activeStage === 'writeback' && Boolean(activePulse?.destReg);
  const isTakenJumpPulse =
    Boolean(activePulse?.branchTaken) &&
    (activePulse?.kind === 'branch' || activePulse?.kind === 'jump');
  const inBranchReturn = activeStage === 'writeback' && isTakenJumpPulse;
  const isLoopJump =
    isTakenJumpPulse &&
    activePulse?.line !== undefined &&
    activePulse?.nextLine !== undefined &&
    activePulse.nextLine <= activePulse.line;
  const pcJustJumped = isTakenJumpPulse && pcJumpDone && activePulse?.nextLine !== undefined;

  return (
    <div className="space-y-2.5 rounded-2xl border border-slate-800 bg-slate-900/75 p-3">
      {/* 顶栏：演示状态 / 目标胶囊 + 控制 */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        {isPlayback ? (
          <>
            <div className="flex flex-wrap items-center gap-1.5">
              <span
                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-bold ${
                  playback!.playing
                    ? 'border-cyan-400/60 bg-cyan-500/20 text-cyan-200'
                    : playback!.halted
                      ? 'border-emerald-400/60 bg-emerald-500/20 text-emerald-200'
                      : 'border-amber-400/60 bg-amber-500/20 text-amber-200'
                }`}
              >
                <Play className="h-3 w-3" />
                {playback!.playing
                  ? '正在演示代码'
                  : playback!.halted
                    ? '执行完成'
                    : '单步暂停'}
              </span>
              {playback!.caseLabel && (
                <span className="font-mono text-[11px] text-slate-400">{playback!.caseLabel}</span>
              )}
              <span className="rounded bg-slate-950 px-1.5 py-0.5 font-mono text-[10px] text-slate-400">
                第 {playback!.tick} 步
              </span>
            </div>

            {onExitPlayback && (
              <button
                type="button"
                onClick={onExitPlayback}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-950 px-2 py-1 text-[11px] font-medium text-slate-300 hover:border-cyan-500/50 hover:text-cyan-200"
              >
                {isMonitorOnly ? (
                  <>
                    <Square className="h-3 w-3" /> 停止演示
                  </>
                ) : (
                  <>
                    <Hand className="h-3 w-3" /> {hasPcTrack ? '回到例程' : '切回手动'}
                  </>
                )}
              </button>
            )}
          </>
        ) : isMonitorOnly ? (
          <>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-700 bg-slate-950 px-2.5 py-0.5 text-[11px] font-semibold text-slate-300">
              <span className="h-1.5 w-1.5 rounded-full bg-slate-500" />
              待命
            </span>
            <span className="text-[11px] text-slate-500">
              点右侧「演示 / 提交验证」观察执行流
            </span>
          </>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-1.5">
              <Target className="h-3.5 w-3.5 text-cyan-400" />
              {hasPcTrack && (
                <span className="text-[11px] font-medium text-slate-400">例程期望</span>
              )}
              {Object.entries(activeGoalRegs).map(([reg, want]) => {
                const hit = (displayRegs[reg] ?? 0) === want;
                return (
                  <span
                    key={reg}
                    className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-xs font-bold transition ${
                      hit
                        ? 'border-emerald-400/70 bg-emerald-500/20 text-emerald-200'
                        : 'border-slate-700 bg-slate-950 text-slate-300'
                    }`}
                  >
                    {reg} = {formatDatapathValue(want, activeRadix)}
                    {hit && <Check className="h-3 w-3 text-emerald-300" />}
                  </span>
                );
              })}
            </div>

            {!hasPcTrack && (
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  title="撤销一步"
                  disabled={state.undoStack.length === 0}
                  onClick={() => {
                    setState((prev) => undoManualCpu(prev));
                    setManualPulse(null);
                    setActiveStage('idle');
                  }}
                  className="rounded-lg border border-slate-800 bg-slate-950 p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white disabled:opacity-35"
                >
                  <Undo2 className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  title="重置沙盘"
                  onClick={() => handleReset(state.caseIndex)}
                  className="rounded-lg border border-slate-800 bg-slate-950 p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {/* 5 阶段单周期状态灯带（仅解锁 cpu-stages 概念后展示，避免前期引入未学微架构术语） */}
      {showPipelineStages && (
        <StageStrip
          activeStage={activeStage}
          memoryUnlocked={memoryUnlocked}
          memoryActiveInOp={activePulse?.kind === 'load' || activePulse?.kind === 'store'}
        />
      )}

      {/* 修 Bug 小例程指令轨（位于统一 CPU 底板正上方，绝不改变下方底板比例与总线对齐） */}
      {!isPlayback && hasPcTrack && (
        <PcTrackDesk
          config={config}
          caseIndex={state.caseIndex}
          pcIndex={state.pcIndex}
          halted={state.halted}
          playing={demoPlaying}
          speed={demoSpeed}
          slotChoices={slotChoices}
          passedCases={passedDemoCases}
          feedback={state.feedback}
          onSwitchCase={(idx) => handleReset(idx)}
          onSelectSlotOption={(lineIdx, optIdx) => {
            setSlotChoices((prev) => ({ ...prev, [lineIdx]: optIdx }));
            setPassedDemoCases(new Set());
            handleReset(state.caseIndex);
          }}
          onTogglePlay={() => {
            if (demoPlaying) {
              setDemoPlaying(false);
              return;
            }
            if (state.halted) {
              setState(createManualCpuState(config, state.caseIndex));
              setManualPulse(null);
              setActiveStage('idle');
              setWbLanded(false);
            }
            setDemoPlaying(true);
          }}
          onStep={() => {
            setDemoPlaying(false);
            stepDemoOnce();
          }}
          onReset={() => handleReset(state.caseIndex)}
          onChangeSpeed={setDemoSpeed}
          onFocusEditor={onFocusEditor}
        />
      )}

      {/* 竖向数据通路主体 + 左侧写回回流总线（直连寄存器左侧）+ 右侧存内存内轨与跳转外轨 */}
      <div ref={stageBodyRef} className="relative flex items-stretch gap-1.5">
        {/* 左外侧回流轨道：存入区中线 → 寄存器左侧中线 绿色写回总线（像素级闭合，绝不误接入右侧立即数端口） */}
        {(() => {
          const { stageH, regY, wbY } = railGeo;
          const wbPath = `M 30 ${wbY} L 10 ${wbY} L 10 ${regY} L 30 ${regY}`;
          const wbTravelDur = `${getStageSeconds('writeback', speed, 0.58).toFixed(2)}s`;
          const riseStyle = {
            '--rz-wb-top': `${regY}px`,
            '--rz-wb-bottom': `${wbY}px`,
            animationDuration: wbTravelDur,
          } as CSSProperties;

          return (
            <div className="relative hidden w-6 shrink-0 sm:block" aria-hidden="true">
              <svg
                viewBox={`0 0 24 ${stageH}`}
                className="h-full w-full overflow-visible"
              >
                <path
                  d={wbPath}
                  fill="none"
                  stroke={inWriteback ? '#34d399' : '#1e293b'}
                  strokeWidth={inWriteback ? 2.6 : 1.5}
                  strokeDasharray={inWriteback ? '6 5' : undefined}
                  className={inWriteback ? 'rz-wire-flow' : undefined}
                />
              </svg>
              {inWriteback && !wbLanded && activePulse?.newDestVal !== undefined && (
                <span
                  key={`wb-pill-${activePulse.nonce}`}
                  style={riseStyle}
                  className="rz-wb-rise pointer-events-none absolute left-[10px] z-10 flex h-5 min-w-[24px] items-center justify-center whitespace-nowrap rounded-full border border-emerald-200 bg-emerald-400 px-1.5 font-mono text-[10px] font-extrabold text-slate-950 shadow-[0_0_14px_rgba(52,211,153,0.7)]"
                >
                  {formatDatapathValue(activePulse.newDestVal, activeRadix)}
                </span>
              )}
            </div>
          );
        })()}

        {/* 中轴硬件模块 */}
        <div className="min-w-0 flex-1">
          {/* 1. 指令与 PC 栏（演示代码时展示当前指令与 PC 行号；监视器模式下常驻占位，启动播放零纵向跳动） */}
          {hasTopBar && (
            <div
              ref={pcBarRef}
              className={`mb-2 flex h-[34px] items-center justify-between gap-2 rounded-xl border px-3 transition ${
                pcJustJumped && activeStage === 'writeback'
                  ? isLoopJump
                    ? 'border-amber-400 bg-amber-950/35 shadow-[0_0_18px_rgba(251,191,36,0.28)]'
                    : 'border-cyan-300 bg-cyan-950/40 shadow-[0_0_18px_rgba(34,211,238,0.28)]'
                  : inFetch
                    ? 'border-cyan-400/80 bg-cyan-950/30 shadow-[0_0_16px_rgba(34,211,238,0.16)]'
                    : 'border-slate-800 bg-slate-950/85'
              }`}
            >
              <span className="inline-flex shrink-0 items-center gap-1.5 text-[11px] font-semibold text-slate-400">
                <Cpu className="h-3.5 w-3.5 text-cyan-400" />
                {showPipelineStages ? '取指' : '当前指令'}
              </span>
              {isPlayback ? (
                <div className="flex min-w-0 items-center gap-2 font-mono text-xs">
                  <span className="truncate font-bold text-cyan-200">
                    {activePulse?.asmText ?? '准备执行…'}
                  </span>
                  {activePulse?.line ? (
                    <span className="relative inline-flex shrink-0 items-center overflow-visible">
                      {pcJustJumped &&
                        activeStage === 'writeback' &&
                        activePulse.nextLine !== activePulse.line && (
                          <span
                            key={`old-pc-${activePulse.nonce}`}
                            aria-hidden="true"
                            className="rz-eject-old pointer-events-none absolute left-1/2 top-0 whitespace-nowrap rounded bg-rose-500/20 px-1 text-[10px] font-bold text-rose-300 line-through"
                          >
                            第 {activePulse.line} 行
                          </span>
                        )}
                      <span
                        key={pcJustJumped ? `pc-new-${activePulse.nonce}` : `pc-cur-${activePulse.nonce}`}
                        className={`rounded px-1.5 py-0.5 text-[10px] font-bold transition ${
                          pcJustJumped
                            ? isLoopJump
                              ? 'rz-pop-new border border-amber-400/70 bg-amber-500/20 text-amber-200'
                              : 'rz-pop-new border border-cyan-400/70 bg-cyan-500/20 text-cyan-200'
                            : 'bg-slate-900 text-slate-400'
                        }`}
                      >
                        {(() => {
                          const rawPc = pcJustJumped ? playback?.pc : activePulse.pc;
                          const hexPc =
                            showPcAddress && rawPc !== undefined
                              ? `0x${(rawPc >>> 0).toString(16).toUpperCase().padStart(4, '0')} · `
                              : '';
                          return pcJustJumped
                            ? `PC → ${hexPc}第 ${activePulse.nextLine} 行`
                            : `PC ${hexPc}第 ${activePulse.line} 行`;
                        })()}
                      </span>
                    </span>
                  ) : null}
                </div>
              ) : (
                <span className="truncate font-mono text-[11px] text-slate-600">
                  {isMonitorOnly ? '—' : '手动试算模式 · 点击或拖拽下方寄存器'}
                </span>
              )}
            </div>
          )}

          {/* 2. 寄存器 + 固定高度竖向总线（无缝衔接下方执行区，零上下跳动） */}
          <RegisterFileBox
            focusRegs={config.focusRegs}
            regRoles={config.regRoles}
            regs={displayRegs}
            goalRegs={activeGoalRegs}
            constantCards={!isStageReadonly && hasConstants ? config.constantCards : undefined}
            showRegXName={showRegXName}
            allowExpandAll={allowExpandAllRegs}
            radix={activeRadix}
            availableRadices={availableRadices}
            onChangeRadix={setRadix}
            immediateUnlocked={immediateUnlocked}
            memoryUnlocked={memoryUnlocked}
            regBoxRef={regBoxRef}
            busRef={busRef}
            showStageNames={showPipelineStages}
            showBus={hasAlu || isStageReadonly}
            speed={speed}
            wbLanded={wbLanded}
            playbackMode={isStageReadonly}
            activeStage={activeStage}
            pulse={activePulse}
            warnReg={!isStageReadonly && state.feedback?.tone === 'warn' ? state.lastWrittenReg : null}
            canDragOperand={!isStageReadonly && hasAlu}
            canDropResult={!isStageReadonly && hasAlu && Boolean(left && right)}
            onSelectOperand={handleSelectOperand}
            onDropResultOnReg={(targetReg) => {
              if (!left || !right) return;
              if (targetReg !== 'zero') setDestReg(targetReg);
              runManualAlu(left, op, right, targetReg);
            }}
          />

          {/* 3. 执行 → (可选 4. 访存) → 5. 写回（手玩、修 Bug 小例程与代码演示完全统一在同一 CPU 舞台！） */}
          {(hasAlu || isStageReadonly) && (
            <AluDesk
              config={config}
              regs={displayRegs}
              left={left}
              right={right}
              op={op}
              destReg={destReg}
              activeSlot={activeSlot}
              pulse={activePulse}
              activeStage={activeStage}
              speed={speed}
              radix={activeRadix}
              memoryUnlocked={memoryUnlocked}
              aluBoxRef={aluBoxRef}
              memStageRef={memStageRef}
              wbBoxRef={wbBoxRef}
              showStageNames={showPipelineStages}
              playbackMode={isStageReadonly}
              onSelectSlot={setActiveSlot}
              onSelectOp={setOp}
              onDropToSlot={(slot, payload) => {
                if (slot === 'left') {
                  setLeft(payload);
                  if (!right) setActiveSlot('right');
                  else if (!destReg) setActiveSlot('dest');
                } else {
                  setRight(payload);
                  if (!destReg) setActiveSlot('dest');
                  else if (!left) setActiveSlot('left');
                }
              }}
              onDropToDest={assignDestOperand}
              onExecuteAlu={() => {
                if (!left || !right || !destReg) return;
                runManualAlu(left, op, right, destReg);
              }}
            />
          )}
        </div>

        {/* 右外侧双车道总线轨道：内道（x=7）sw/sb 存内存直通轨（向下）；外道（x=24）分支/循环跳转回流 PC 轨（向上，仅在 ALU 出口以跳线拱桥跨过内道，拉开 17px 间距清晰不纠缠） */}
        {(() => {
          const { stageH, pcY, tapY, aluY, memY } = railGeo;
          const jumpTravelDur = `${getStageSeconds('writeback', speed, 0.58 * 0.9).toFixed(2)}s`;
          const showRightRail = showJumpRail || hasPcTrack || inBranchReturn;
          const isStoreDataActive =
            activePulse?.kind === 'store' &&
            Boolean(activePulse.storeDataSource) &&
            (activeStage === 'decode' || activeStage === 'execute' || activeStage === 'memory');
          // 精确三段接力：decode 在总线内从端口 B 横移出右缘 → execute 在右外轨直落访存入口 → memory 滑入访存中心汇合地址
          const isStoreDataDropping =
            activePulse?.kind === 'store' &&
            Boolean(activePulse.storeDataSource) &&
            activeStage === 'execute';
          const showStoreRail = memoryUnlocked || isStoreDataActive;
          const hasDualRightLanes = showRightRail && showStoreRail;
          const railW = hasDualRightLanes ? 32 : 24;
          const storeLaneX = hasDualRightLanes ? 7 : 12;
          const jumpLaneX = hasDualRightLanes ? 24 : 12;

          // 内道（存内存）：全程零交叉，像素级闭合端口 B 分流口与访存盒中线
          const storePath = `M -6 ${tapY} L ${storeLaneX} ${tapY} L ${storeLaneX} ${memY} L -6 ${memY}`;
          // 外道（跳转回流 PC）：双车道时在 ALU 出口用平滑半圆跳线拱桥跨过内道（x=7），拉开 17px 视觉间距
          const jumpPath = hasDualRightLanes
            ? `M -6 ${aluY} L ${storeLaneX - 5} ${aluY} A 5 5 0 0 1 ${storeLaneX + 5} ${aluY} L ${jumpLaneX} ${aluY} L ${jumpLaneX} ${pcY} L -6 ${pcY}`
            : `M -6 ${aluY} L ${jumpLaneX} ${aluY} L ${jumpLaneX} ${pcY} L -6 ${pcY}`;

          const jumpRiseStyle = {
            left: `${jumpLaneX}px`,
            '--rz-jump-from': `${aluY}px`,
            '--rz-jump-to': `${pcY}px`,
            animationDuration: jumpTravelDur,
          } as CSSProperties;
          const storeTravelDur = `${getStageSeconds('execute', speed).toFixed(2)}s`;
          const storeDropStyle = {
            left: `${storeLaneX}px`,
            '--rz-store-top': `${tapY}px`,
            '--rz-store-bottom': `${memY}px`,
            animationDuration: storeTravelDur,
          } as CSSProperties;

          return (
            <div
              className={`relative hidden shrink-0 sm:block ${hasDualRightLanes ? 'w-8' : 'w-6'}`}
              aria-hidden="true"
            >
              <svg
                viewBox={`0 0 ${railW} ${stageH}`}
                className="h-full w-full overflow-visible"
              >
                {/* 存内存内道直通数据轨（从寄存器端口 B 分流后绕过 ALU 直连访存单元写数据口） */}
                {showStoreRail && (
                  <path
                    d={storePath}
                    fill="none"
                    stroke={isStoreDataActive ? '#a78bfa' : '#1e293b'}
                    strokeWidth={isStoreDataActive ? 2.6 : 1.4}
                    strokeDasharray={isStoreDataActive ? '6 5' : undefined}
                    className={isStoreDataActive ? 'rz-wire-flow' : undefined}
                  />
                )}
                {/* 分支/跳转外道回流 PC 轨道 */}
                <path
                  d={jumpPath}
                  fill="none"
                  stroke={
                    inBranchReturn
                      ? isLoopJump
                        ? '#fbbf24'
                        : '#22d3ee'
                      : showRightRail
                        ? '#1e293b'
                        : 'transparent'
                  }
                  strokeWidth={inBranchReturn ? 2.6 : 1.5}
                  strokeDasharray={inBranchReturn ? '6 5' : undefined}
                  className={inBranchReturn ? 'rz-wire-flow' : undefined}
                />
              </svg>
              {inBranchReturn && !wbLanded && activePulse?.nextLine !== undefined && (
                <span
                  key={`jump-pill-${activePulse.nonce}`}
                  style={jumpRiseStyle}
                  className={`rz-jump-rise pointer-events-none absolute z-10 flex h-5 min-w-[28px] items-center justify-center rounded-full border px-1.5 font-mono text-[10px] font-extrabold text-slate-950 ${
                    isLoopJump
                      ? 'border-amber-200 bg-amber-400 shadow-[0_0_14px_rgba(251,191,36,0.75)]'
                      : 'border-cyan-100 bg-cyan-400 shadow-[0_0_14px_rgba(34,211,238,0.75)]'
                  }`}
                >
                  {isLoopJump ? `↺${activePulse.nextLine}` : `→${activePulse.nextLine}`}
                </span>
              )}
              {isStoreDataDropping && activePulse?.storeDataSource && (
                <span
                  key={`store-pill-${activePulse.nonce}`}
                  style={storeDropStyle}
                  className="rz-store-drop pointer-events-none absolute z-10 flex h-5 min-w-[26px] items-center justify-center whitespace-nowrap rounded-full border border-violet-200 bg-violet-500 px-1.5 font-mono text-[10px] font-extrabold text-white shadow-[0_0_14px_rgba(167,139,250,0.8)]"
                >
                  {formatDatapathValue(activePulse.storeDataSource.value, activeRadix)}
                </span>
              )}
            </div>
          );
        })()}
      </div>

      {/* 手动防错警告气泡（修 Bug 模式已有专属反馈栏，不重复显示） */}
      {!isPlayback && !hasPcTrack && state.feedback?.tone === 'warn' && (
        <div className="rounded-xl border border-amber-500/60 bg-amber-950/40 px-3 py-2 text-xs text-amber-200">
          {state.feedback.message}
        </div>
      )}

      {/* 手动模式下的操作语义记录 + 同色语法骨架 */}
      {!isPlayback &&
        !hasPcTrack &&
        config.recordToAsm !== false &&
        (() => {
          const patterns = collectUsedSyntaxPatterns(state.recordings);
          const slotTone = (role: SyntaxSlot['role']) => {
            if (role === 'dest') return 'border-emerald-500/50 bg-emerald-500/15 text-emerald-200';
            if (role === 'const') return 'border-amber-500/50 bg-amber-500/15 text-amber-200';
            return 'border-cyan-500/45 bg-cyan-500/15 text-cyan-200';
          };

          return (
            <div
              className={`space-y-2 rounded-xl border p-2.5 transition ${
                state.completed
                  ? 'border-emerald-400/70 bg-emerald-950/25'
                  : 'border-slate-800 bg-slate-950/80'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-slate-400">
                  <Terminal className="h-3.5 w-3.5 text-emerald-400" />
                  操作记录 ({state.recordings.length})
                </span>
                {state.completed && onFocusEditor && (
                  <button
                    type="button"
                    onClick={onFocusEditor}
                    className="inline-flex items-center gap-1 rounded-lg bg-emerald-400 px-2.5 py-1 text-xs font-bold text-slate-950 hover:bg-emerald-300"
                  >
                    去写指令 <ArrowRight className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>

              {state.recordings.length > 0 && (
                <div className="max-h-24 space-y-1 overflow-y-auto text-xs">
                  {state.recordings.map((step, i) => (
                    <div
                      key={`${i}-${step.summary}`}
                      className="rounded bg-slate-900/90 px-2 py-0.5 text-slate-200"
                    >
                      <span className="mr-2 font-mono text-slate-500">{i + 1}</span>
                      {step.summary}
                    </div>
                  ))}
                </div>
              )}

              {patterns.length > 0 && (
                <div className="space-y-1.5 border-t border-slate-800/80 pt-2">
                  <div className="text-[11px] font-medium text-slate-400">对应指令格式</div>
                  <div className="space-y-1.5">
                    {patterns.map((p) => (
                      <div
                        key={p.op}
                        className="flex flex-wrap items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-900/80 px-2.5 py-1.5 text-xs"
                      >
                        <span className="font-mono font-bold text-sky-300">{p.op}</span>
                        {p.slots.map((slot, idx) => (
                          <span
                            key={`${p.op}-${slot.label}`}
                            className="inline-flex items-center gap-1"
                          >
                            <span
                              className={`rounded-md border px-1.5 py-0.5 text-[11px] font-semibold ${slotTone(slot.role)}`}
                            >
                              {slot.label}
                            </span>
                            {idx < p.slots.length - 1 && (
                              <span className="font-mono text-slate-500">,</span>
                            )}
                          </span>
                        ))}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })()}
    </div>
  );
}
