import {
  ArrowRight,
  Check,
  CornerDownRight,
  Pause,
  Play,
  RotateCcw,
  StepForward,
  Wrench,
} from 'lucide-react';
import type { ManualCpuSandboxConfig } from '../../engine/types';
import { PLAYBACK_SPEEDS, type PlaybackSpeed } from './datapathTimeline';
import type { ManualCpuState } from './model';
import { resolvePcTrackInstruction } from './pcTrackModel';

interface PcTrackDeskProps {
  config: ManualCpuSandboxConfig;
  caseIndex: number;
  pcIndex: number;
  halted: boolean;
  playing: boolean;
  speed: PlaybackSpeed;
  slotChoices: Record<number, number>;
  passedCases: ReadonlySet<number>;
  feedback: ManualCpuState['feedback'];
  onSwitchCase: (index: number) => void;
  onSelectSlotOption: (lineIndex: number, optionIndex: number) => void;
  onTogglePlay: () => void;
  onStep: () => void;
  onReset: () => void;
  onChangeSpeed: (speed: PlaybackSpeed) => void;
  onFocusEditor?: () => void;
}

/**
 * 统一 CPU 舞台顶部的「修 Bug 小例程」交互指令轨。
 * 玩家先点「试跑」在下方 CPU 动画里亲眼看到穿透/死循环等 Bug，
 * 再直接在空位槽切换跳转指令修好它，零剧透本关主任务答案。
 */
export function PcTrackDesk({
  config,
  caseIndex,
  pcIndex,
  halted,
  playing,
  speed,
  slotChoices,
  passedCases,
  feedback,
  onSwitchCase,
  onSelectSlotOption,
  onTogglePlay,
  onStep,
  onReset,
  onChangeSpeed,
  onFocusEditor,
}: PcTrackDeskProps) {
  const track = config.pcTrack;
  if (!track) return null;

  const cases = track.cases ?? [];
  const allCasesPassed =
    cases.length > 0 ? cases.every((_, idx) => passedCases.has(idx)) : passedCases.has(0);

  return (
    <div className="mb-2 space-y-2 rounded-2xl border border-slate-800 bg-slate-950/90 p-2.5">
      {/* 顶行：修 Bug 例程说明 + 试跑/单步/重置/倍速控制 */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-[11px] font-semibold text-amber-300">
          <Wrench className="h-3.5 w-3.5 shrink-0" />
          <span>{track.demoSummary ?? '先修好这个小例程，看看标签与跳转如何工作'}</span>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={onTogglePlay}
            className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-bold transition ${
              playing
                ? 'bg-amber-400 text-slate-950 hover:bg-amber-300'
                : 'bg-cyan-400 text-slate-950 hover:bg-cyan-300'
            }`}
          >
            {playing ? (
              <>
                <Pause className="h-3 w-3" /> 暂停
              </>
            ) : (
              <>
                <Play className="h-3 w-3" /> {halted ? '重播试跑' : '试跑'}
              </>
            )}
          </button>
          <button
            type="button"
            onClick={onStep}
            disabled={halted}
            title="单步执行"
            className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-900 px-2 py-1 text-[11px] font-medium text-slate-200 hover:border-cyan-500/60 hover:text-white disabled:opacity-40"
          >
            <StepForward className="h-3 w-3" /> 单步
          </button>
          <button
            type="button"
            onClick={onReset}
            title="重置例程"
            className="rounded-lg border border-slate-800 bg-slate-900 p-1 text-slate-400 hover:bg-slate-800 hover:text-white"
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </button>
          <div className="inline-flex items-center rounded-md border border-slate-800 bg-slate-900 p-0.5 font-mono">
            {PLAYBACK_SPEEDS.map((spd) => (
              <button
                key={spd}
                type="button"
                onClick={() => onChangeSpeed(spd)}
                className={`rounded px-1.5 py-0.5 text-[10px] font-bold transition ${
                  speed === spd
                    ? 'bg-cyan-400 text-slate-950'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                {spd}x
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* 测试场景切换（附已通过标记） */}
      {cases.length > 1 && (
        <div className="flex flex-wrap gap-1.5">
          {cases.map((c, idx) => {
            const passed = passedCases.has(idx);
            return (
              <button
                key={c.label}
                type="button"
                onClick={() => onSwitchCase(idx)}
                className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 font-mono text-[11px] transition ${
                  idx === caseIndex
                    ? 'border-cyan-400/80 bg-cyan-500/20 font-bold text-cyan-100'
                    : passed
                      ? 'border-emerald-500/50 bg-emerald-950/30 text-emerald-300'
                      : 'border-slate-800 bg-slate-900 text-slate-400 hover:text-slate-200'
                }`}
              >
                {passed && <Check className="h-3 w-3 text-emerald-300" />}
                {c.label}
              </button>
            );
          })}
        </div>
      )}

      {/* 指令轨（带 PC 光标、标签路标与可点击修 Bug 槽位） */}
      <div className="space-y-1">
        {track.program.map((rawInst, idx) => {
          const inst = resolvePcTrackInstruction(rawInst, slotChoices[idx]);
          const active = !halted && idx === pcIndex;
          const hasSlot = Boolean(rawInst.slotOptions && rawInst.slotOptions.length > 0);
          const selectedOpt = slotChoices[idx] ?? 0;
          const targetIdx = inst.target
            ? track.program.findIndex((p) => p.label === inst.target)
            : -1;
          const isBackward = targetIdx >= 0 && targetIdx <= idx;

          return (
            <div
              key={`${idx}-${rawInst.label ?? rawInst.op}`}
              className={`flex flex-wrap items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5 font-mono text-xs transition ${
                active
                  ? 'border-cyan-400 bg-cyan-500/15 text-white shadow-[0_0_12px_rgba(34,211,238,0.22)]'
                  : hasSlot && inst.op === 'nop'
                    ? 'border-dashed border-amber-500/60 bg-amber-950/20 text-amber-200'
                    : 'border-slate-800/80 bg-slate-900/60 text-slate-300'
              }`}
            >
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`inline-flex w-9 shrink-0 justify-center rounded px-1 py-0.5 text-[10px] font-bold ${
                    active ? 'bg-cyan-400 text-slate-950' : 'bg-slate-800 text-slate-500'
                  }`}
                >
                  {active ? 'PC▶' : idx + 1}
                </span>
                {rawInst.label && (
                  <span className="rounded bg-violet-500/20 px-1.5 py-0.5 text-[10px] font-bold text-violet-300">
                    {rawInst.label}:
                  </span>
                )}

                {hasSlot && rawInst.slotOptions ? (
                  <div className="flex flex-wrap items-center gap-1">
                    {rawInst.slotOptions.map((opt, optIdx) => {
                      const picked = selectedOpt === optIdx;
                      return (
                        <button
                          key={opt.label}
                          type="button"
                          onClick={() => onSelectSlotOption(idx, optIdx)}
                          className={`rounded-md border px-2 py-0.5 text-[11px] font-bold transition ${
                            picked
                              ? opt.op === 'nop'
                                ? 'border-amber-400 bg-amber-400/20 text-amber-200'
                                : 'border-emerald-400 bg-emerald-400/20 text-emerald-200'
                              : 'border-slate-700 bg-slate-950 text-slate-400 hover:border-slate-500 hover:text-slate-200'
                          }`}
                        >
                          {opt.label}
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <span className={active ? 'font-bold text-cyan-100' : ''}>{inst.asm}</span>
                )}
              </div>

              {inst.target && (
                <span
                  className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                    isBackward
                      ? 'bg-amber-500/20 text-amber-300'
                      : 'bg-sky-500/15 text-sky-300'
                  }`}
                >
                  {isBackward ? (
                    <RotateCcw className="h-3 w-3" />
                  ) : (
                    <CornerDownRight className="h-3 w-3" />
                  )}
                  {inst.target}
                </span>
              )}
            </div>
          );
        })}
      </div>

      {/* 故障发现 / 修补成功反馈条 */}
      {feedback && (feedback.tone === 'warn' || feedback.tone === 'success') && (
        <div
          className={`flex flex-wrap items-center justify-between gap-2 rounded-xl border px-3 py-2 text-xs ${
            feedback.tone === 'success'
              ? 'border-emerald-400/60 bg-emerald-950/35 text-emerald-200'
              : 'border-amber-500/60 bg-amber-950/35 text-amber-200'
          }`}
        >
          <span>{feedback.message}</span>
          {feedback.tone === 'success' && onFocusEditor && (
            <button
              type="button"
              onClick={onFocusEditor}
              className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-emerald-400 px-2.5 py-1 text-xs font-bold text-slate-950 hover:bg-emerald-300"
            >
              {allCasesPassed ? '去写本关代码' : '直接去写代码'} <ArrowRight className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
