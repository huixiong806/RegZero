import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import {
  ArrowRight,
  Check,
  Cpu,
  Hand,
  Play,
  RotateCcw,
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

export interface ManualCpuSandboxProps {
  config: ManualCpuSandboxConfig;
  showRegXName?: boolean;
  allowExpandAllRegs?: boolean;
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

  const isPlayback = Boolean(playback?.active);
  const isStageReadonly = isPlayback || hasPcTrack;
  const displayRegs = isPlayback ? playback!.regs : state.regs;
  const activePulse = isPlayback ? playback!.pulse : manualPulse;
  const speed: PlaybackSpeed = isPlayback ? playback!.speed : hasPcTrack ? demoSpeed : 1;

  // 连续数据流时间轴驱动器：手玩、修 Bug 小例程与代码播放共用同一套精确接力节拍
  useEffect(() => {
    if (!activePulse) {
      setActiveStage('idle');
      setWbLanded(false);
      setPcJumpDone(false);
      return;
    }
    const frames = buildStageSequence(activePulse, isPlayback);
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
  }, [activePulse, isPlayback, speed]);

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
                <Hand className="h-3 w-3" /> {hasPcTrack ? '回到例程' : '切回手动'}
              </button>
            )}
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
                    {reg} = {want}
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

      {/* 竖向数据通路主体 + 左侧写回回流总线（直连寄存器左侧）+ 右侧分支跳转回流总线（直连顶部指令栏） */}
      <div className="relative flex items-stretch gap-1.5">
        {/* 左外侧回流轨道：存入区 → 寄存器左侧 绿色写回总线（物理上永远接入寄存器，绝不误接入右侧立即数端口） */}
        {(() => {
          const hasTopBar = showPipelineStages || isPlayback;
          const wbTopY = hasTopBar ? 92 : 54;
          const wbTopPct = hasTopBar ? '25%' : '15%';
          const wbPath = `M 24 332 L 10 332 L 10 ${wbTopY} L 24 ${wbTopY}`;
          const wbTravelDur = `${getStageSeconds('writeback', speed, 0.58).toFixed(2)}s`;
          const riseStyle = {
            '--nmc-wb-top': wbTopPct,
            animationDuration: wbTravelDur,
          } as CSSProperties;

          return (
            <div className="relative hidden w-6 shrink-0 sm:block" aria-hidden="true">
              <svg
                viewBox="0 0 24 360"
                preserveAspectRatio="none"
                className="h-full w-full overflow-visible"
              >
                <path
                  d={wbPath}
                  fill="none"
                  stroke={inWriteback ? '#34d399' : '#1e293b'}
                  strokeWidth={inWriteback ? 2.6 : 1.5}
                  strokeDasharray={inWriteback ? '6 5' : undefined}
                  className={inWriteback ? 'nmc-wire-flow' : undefined}
                />
              </svg>
              {inWriteback && !wbLanded && activePulse?.newDestVal !== undefined && (
                <span
                  key={`wb-pill-${activePulse.nonce}`}
                  style={riseStyle}
                  className="nmc-wb-rise pointer-events-none absolute left-[10px] z-10 flex h-5 min-w-[24px] items-center justify-center rounded-full border border-emerald-200 bg-emerald-400 px-1.5 font-mono text-[10px] font-extrabold text-slate-950 shadow-[0_0_14px_rgba(52,211,153,0.7)]"
                >
                  {activePulse.newDestVal}
                </span>
              )}
            </div>
          );
        })()}

        {/* 中轴硬件模块 */}
        <div className="min-w-0 flex-1">
          {/* 1. 指令与 PC 栏（演示代码时展示当前指令与 PC 行号；跳转胶囊抵达瞬间在本周期内翻牌更新 PC 并顶飞旧行号） */}
          {(showPipelineStages || isPlayback) && (
            <div
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
                            className="nmc-eject-old pointer-events-none absolute left-1/2 top-0 whitespace-nowrap rounded bg-rose-500/20 px-1 text-[10px] font-bold text-rose-300 line-through"
                          >
                            第 {activePulse.line} 行
                          </span>
                        )}
                      <span
                        key={pcJustJumped ? `pc-new-${activePulse.nonce}` : `pc-cur-${activePulse.nonce}`}
                        className={`rounded px-1.5 py-0.5 text-[10px] font-bold transition ${
                          pcJustJumped
                            ? isLoopJump
                              ? 'nmc-pop-new border border-amber-400/70 bg-amber-500/20 text-amber-200'
                              : 'nmc-pop-new border border-cyan-400/70 bg-cyan-500/20 text-cyan-200'
                            : 'bg-slate-900 text-slate-400'
                        }`}
                      >
                        {pcJustJumped
                          ? `PC → 第 ${activePulse.nextLine} 行`
                          : `PC 第 ${activePulse.line} 行`}
                      </span>
                    </span>
                  ) : null}
                </div>
              ) : (
                <span className="truncate text-[11px] text-slate-500">
                  手动试算模式 · 点击或拖拽下方寄存器
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
            immediateUnlocked={immediateUnlocked}
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
              memoryUnlocked={memoryUnlocked}
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

        {/* 右外侧回流轨道：分支/循环跳转写回 PC（对称于左侧寄存器写回，携带目标行号胶囊直冲顶部 PC 栏） */}
        {(() => {
          const jumpTravelDur = `${getStageSeconds('writeback', speed, 0.58 * 0.9).toFixed(2)}s`;
          const showRightRail = showJumpRail || hasPcTrack || inBranchReturn;
          const jumpPath = 'M 0 225 L 14 225 L 14 18 L 0 18';
          return (
            <div className="relative hidden w-6 shrink-0 sm:block" aria-hidden="true">
              <svg
                viewBox="0 0 24 360"
                preserveAspectRatio="none"
                className="h-full w-full overflow-visible"
              >
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
                  className={inBranchReturn ? 'nmc-wire-flow' : undefined}
                />
              </svg>
              {inBranchReturn && !wbLanded && activePulse?.nextLine !== undefined && (
                <span
                  key={`jump-pill-${activePulse.nonce}`}
                  style={{ animationDuration: jumpTravelDur }}
                  className={`nmc-jump-rise pointer-events-none absolute left-[14px] z-10 flex h-5 min-w-[28px] items-center justify-center rounded-full border px-1.5 font-mono text-[10px] font-extrabold text-slate-950 ${
                    isLoopJump
                      ? 'border-amber-200 bg-amber-400 shadow-[0_0_14px_rgba(251,191,36,0.75)]'
                      : 'border-cyan-100 bg-cyan-400 shadow-[0_0_14px_rgba(34,211,238,0.75)]'
                  }`}
                >
                  {isLoopJump ? `↺${activePulse.nextLine}` : `→${activePulse.nextLine}`}
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
