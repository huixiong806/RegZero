import { useState } from 'react';
import { CornerDownRight, HardDrive, RotateCcw, Zap } from 'lucide-react';
import type { ManualCpuAluOp, ManualCpuSandboxConfig } from '../../engine/types';
import {
  getStageSeconds,
  stageOrder,
  type DatapathStage,
  type PlaybackSpeed,
} from './datapathTimeline';
import type { SourceOperand } from './model';
import type { CpuPulseEvent, PulseSource } from './pulseModel';

export const OPERAND_DRAG_MIME = 'application/x-rz-operand';
export const ALU_RESULT_DRAG_MIME = 'application/x-rz-alu-result';

export type ActiveSlot = 'left' | 'right' | 'dest' | 'copySrc';

interface AluDeskProps {
  config: ManualCpuSandboxConfig;
  regs: Record<string, number>;
  left: SourceOperand | null;
  right: SourceOperand | null;
  op: ManualCpuAluOp;
  destReg: string | null;
  activeSlot: ActiveSlot;
  pulse?: CpuPulseEvent | null;
  activeStage: DatapathStage;
  speed?: PlaybackSpeed;
  memoryUnlocked: boolean;
  showStageNames?: boolean;
  playbackMode?: boolean;
  onSelectSlot: (slot: ActiveSlot) => void;
  onSelectOp: (op: ManualCpuAluOp) => void;
  onDropToSlot: (slot: 'left' | 'right', payload: SourceOperand) => void;
  onDropToDest: (payload: SourceOperand) => void;
  onExecuteAlu: () => void;
}

function parseDragPayload(raw: string): SourceOperand | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const obj = parsed as Partial<SourceOperand>;
    if (obj.kind === 'reg' && typeof obj.name === 'string') return { kind: 'reg', name: obj.name };
    if (obj.kind === 'const' && obj.card) return { kind: 'const', card: obj.card };
    return null;
  } catch {
    return null;
  }
}

function slotLabel(
  operand: SourceOperand | null,
  regs: Record<string, number>,
): { top: string; val: string; isConst: boolean } {
  if (!operand) return { top: '输入', val: '?', isConst: false };
  if (operand.kind === 'reg') {
    return { top: operand.name, val: String(regs[operand.name] ?? 0), isConst: false };
  }
  return { top: `#${operand.card.label}`, val: String(operand.card.value), isConst: true };
}

function pulseSourceLabel(src: PulseSource | undefined): { top: string; val: string; isConst: boolean } {
  if (!src) return { top: '输入', val: '—', isConst: false };
  if (src.kind === 'reg') return { top: src.name, val: String(src.value), isConst: false };
  return { top: '立即数', val: String(src.value), isConst: true };
}

/**
 * 竖向 5 阶段 CPU 数据通路下段：
 * 3. 执行（双输入 + 梯形运算/比较器）→ 4. 访存（早期直通旁路 / 内存 RAM）→ 5. 写回（存入槽 + 右侧回流总线起点）。
 */
export function AluDesk({
  config,
  regs,
  left,
  right,
  op,
  destReg,
  activeSlot,
  pulse = null,
  activeStage,
  speed = 1,
  memoryUnlocked,
  showStageNames = false,
  playbackMode = false,
  onSelectSlot,
  onSelectOp,
  onDropToSlot,
  onDropToDest,
  onExecuteAlu,
}: AluDeskProps) {
  const [dragOverTarget, setDragOverTarget] = useState<'left' | 'right' | 'dest' | null>(null);

  const ops = config.aluOps && config.aluOps.length > 0 ? config.aluOps : (['+'] as ManualCpuAluOp[]);
  const ord = stageOrder(activeStage);

  const isAluOrMemPulse =
    pulse?.kind === 'alu' || pulse?.kind === 'load' || pulse?.kind === 'store';
  const isFlowPulse = pulse?.kind === 'branch' || pulse?.kind === 'jump';
  const inExecute = activeStage === 'execute';
  const inMemory = activeStage === 'memory';
  const inWriteback = activeStage === 'writeback';
  const passedExecute = ord >= 3;
  const arrivedAtOutput = ord >= 4;

  // 演示模式下，等取数胶囊沿竖向总线滑抵输入引脚（进入 execute）瞬间再点亮引脚数值，避免瞬移穿帮
  const leftView = playbackMode
    ? pulseSourceLabel(ord >= 3 && (isAluOrMemPulse || isFlowPulse) ? pulse?.leftSource : undefined)
    : slotLabel(left, regs);
  const rightView = playbackMode
    ? pulseSourceLabel(ord >= 3 && (isAluOrMemPulse || isFlowPulse) ? pulse?.rightSource : undefined)
    : slotLabel(right, regs);

  // 演示模式下，等绿色结果胶囊从梯形底部滑出并抵达存入槽（writeback）瞬间再点亮存入槽
  const displayDest = playbackMode
    ? arrivedAtOutput && pulse?.destReg
      ? pulse.destReg
      : null
    : destReg;
  const displayDestVal =
    playbackMode && arrivedAtOutput && pulse?.destReg ? pulse.newDestVal : undefined;
  const inputsReady = playbackMode
    ? Boolean(ord >= 3 && (isAluOrMemPulse || isFlowPulse) && pulse?.leftSource)
    : Boolean(left && right);
  const canExecute = !playbackMode && Boolean(left && right && destReg);

  const handleDragOverSlot = (target: 'left' | 'right' | 'dest') => (e: React.DragEvent) => {
    if (playbackMode || !e.dataTransfer.types.includes(OPERAND_DRAG_MIME)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    if (dragOverTarget !== target) setDragOverTarget(target);
  };

  const handleDragLeaveSlot = (target: 'left' | 'right' | 'dest') => () => {
    setDragOverTarget((prev) => (prev === target ? null : prev));
  };

  const handleDrop = (slot: 'left' | 'right') => (e: React.DragEvent) => {
    if (playbackMode) return;
    e.preventDefault();
    setDragOverTarget(null);
    const payload = parseDragPayload(e.dataTransfer.getData(OPERAND_DRAG_MIME));
    if (payload) onDropToSlot(slot, payload);
  };

  const handleDropDest = (e: React.DragEvent) => {
    if (playbackMode) return;
    e.preventDefault();
    setDragOverTarget(null);
    const payload = parseDragPayload(e.dataTransfer.getData(OPERAND_DRAG_MIME));
    if (payload) onDropToDest(payload);
  };

  const handleDragResultStart = (e: React.DragEvent) => {
    if (playbackMode || !inputsReady) return;
    e.dataTransfer.setData(ALU_RESULT_DRAG_MIME, '1');
    e.dataTransfer.effectAllowed = 'copy';
  };

  const destActive = !playbackMode && activeSlot === 'dest';
  const destOver = !playbackMode && dragOverTarget === 'dest';

  const leftActiveWire = playbackMode ? Boolean(ord >= 3 && pulse?.leftSource) : Boolean(left);
  const rightActiveWire = playbackMode ? Boolean(ord >= 3 && pulse?.rightSource) : Boolean(right);
  const pulseKey = pulse?.nonce ?? 0;

  const isRealMemOp = pulse?.kind === 'load' || pulse?.kind === 'store';
  const showMemoryStage = memoryUnlocked || isRealMemOp;
  // 与 datapathTimeline execute 单一真源精确接力：前半段双输入滑入芯片，后半段绿色结果滑出到底部存入槽
  const inDur = `${getStageSeconds('execute', speed, 0.48).toFixed(2)}s`;
  const outDur = `${getStageSeconds('execute', speed, 0.5).toFixed(2)}s`;
  const memAddrHex =
    pulse?.memAddr !== undefined
      ? `0x${(pulse.memAddr >>> 0).toString(16).toUpperCase().padStart(4, '0')}`
      : '';

  return (
    <div className="space-y-1.5">
      {/* 3. 执行单元（固定几何高度，动画全程绝不增删区块，杜绝上下跳动） */}
      <div
        className={`rounded-2xl border bg-slate-950/90 px-3 pt-2.5 pb-1.5 transition ${
          inExecute
            ? 'border-cyan-400/75 shadow-[0_0_20px_rgba(34,211,238,0.16)]'
            : 'border-slate-800'
        }`}
      >
        {showStageNames && (
          <div className="mb-1.5 flex h-4 items-center justify-between">
            <span className="text-[11px] font-semibold text-slate-400">执行单元</span>
          </div>
        )}

        {/* 上方双输入引脚（与上方竖向总线精确对齐） */}
        <div className="grid grid-cols-2 gap-3 px-1">
          {(['left', 'right'] as const).map((slot) => {
            const view = slot === 'left' ? leftView : rightView;
            const filled = slot === 'left' ? leftActiveWire : rightActiveWire;
            const active = !playbackMode && activeSlot === slot;
            const over = !playbackMode && dragOverTarget === slot;
            return (
              <button
                key={slot}
                type="button"
                disabled={playbackMode}
                onClick={() => !playbackMode && onSelectSlot(slot)}
                onDragOver={handleDragOverSlot(slot)}
                onDragLeave={handleDragLeaveSlot(slot)}
                onDrop={handleDrop(slot)}
                className={`flex flex-col items-center justify-center rounded-xl border-2 px-2.5 py-1.5 font-mono transition disabled:cursor-default ${
                  over
                    ? 'scale-[1.02] border-cyan-300 bg-cyan-500/25 shadow-[0_0_16px_rgba(34,211,238,0.35)]'
                    : active
                      ? 'border-cyan-400 bg-cyan-500/15 shadow-[0_0_14px_rgba(34,211,238,0.2)]'
                      : filled
                        ? view.isConst
                          ? 'border-amber-400/70 bg-amber-950/25'
                          : 'border-cyan-500/55 bg-slate-900'
                        : 'border-dashed border-slate-700 bg-slate-900/50 hover:border-slate-500'
                }`}
              >
                <span
                  className={`pointer-events-none text-[10px] font-semibold ${
                    view.isConst ? 'text-amber-300' : 'text-slate-400'
                  }`}
                >
                  {view.top}
                </span>
                <span
                  className={`pointer-events-none text-base font-bold ${
                    filled
                      ? view.isConst
                        ? 'text-amber-200'
                        : 'text-cyan-200'
                      : 'text-slate-600'
                  }`}
                >
                  {view.val}
                </span>
              </button>
            );
          })}
        </div>

        {/* SVG 铜线 + 梯形运算器 + 两段无断层发光数据流（输入滑入 → 结果滑出） */}
        <div className="relative mx-auto flex flex-col items-center">
          <svg
            key={inExecute ? `exec-${pulseKey}` : 'exec-idle'}
            viewBox="0 0 320 96"
            className={`h-[96px] w-full max-w-[320px] overflow-visible select-none ${
              inExecute ? 'rz-chip-charge' : ''
            }`}
            aria-label="执行运算单元"
          >
            <path
              d="M 76 0 L 76 12 L 108 20"
              fill="none"
              stroke={leftActiveWire ? '#22d3ee' : '#334155'}
              strokeWidth={inExecute && pulse?.leftSource ? 3 : leftActiveWire ? 2 : 1.5}
              strokeDasharray={leftActiveWire && !inExecute ? undefined : '4 3'}
              className={inExecute && pulse?.leftSource ? 'rz-wire-flow' : undefined}
            />
            <path
              d="M 244 0 L 244 12 L 212 20"
              fill="none"
              stroke={
                rightActiveWire ? (rightView.isConst ? '#fbbf24' : '#22d3ee') : '#334155'
              }
              strokeWidth={inExecute && pulse?.rightSource ? 3 : rightActiveWire ? 2 : 1.5}
              strokeDasharray={rightActiveWire && !inExecute ? undefined : '4 3'}
              className={inExecute && pulse?.rightSource ? 'rz-wire-flow' : undefined}
            />

            <polygon
              points="72,20 142,20 160,32 178,20 248,20 220,70 100,70"
              fill={
                inExecute
                  ? 'rgba(14, 116, 144, 0.45)'
                  : inputsReady
                    ? 'rgba(8, 51, 68, 0.78)'
                    : 'rgba(15, 23, 42, 0.92)'
              }
              stroke={inExecute ? '#38bdf8' : inputsReady ? '#22d3ee' : '#334155'}
              strokeWidth={inExecute ? 2.5 : inputsReady ? 2 : 1.5}
            />

            <path
              d="M 160 70 L 160 96"
              fill="none"
              stroke={passedExecute && !isFlowPulse ? '#34d399' : '#334155'}
              strokeWidth={passedExecute && !isFlowPulse ? 2.5 : 1.5}
              strokeDasharray={passedExecute && !isFlowPulse ? undefined : '4 3'}
              className={(inExecute || inMemory) && !isFlowPulse ? 'rz-wire-flow' : undefined}
            />

            {/* 执行前半段：左/右操作数胶囊沿铜线无缝滑入中央运算符 */}
            {inExecute && pulse?.leftSource && (
              <g>
                <rect
                  x="-18"
                  y="-9"
                  width="36"
                  height="18"
                  rx="9"
                  fill="#06b6d4"
                  stroke="#cffafe"
                  strokeWidth="1.2"
                />
                <text
                  x="0"
                  y="3.5"
                  textAnchor="middle"
                  fill="#020617"
                  fontSize="10.5"
                  fontWeight="800"
                  fontFamily="ui-monospace, monospace"
                >
                  {pulse.leftSource.value}
                </text>
                <animateMotion begin="0s" dur={inDur} fill="freeze" path="M 76 0 L 76 12 L 138 42" />
                <animate
                  attributeName="opacity"
                  begin="0s"
                  dur={inDur}
                  values="0.2;1;1;0"
                  keyTimes="0;0.15;0.82;1"
                  fill="freeze"
                />
              </g>
            )}
            {inExecute && pulse?.rightSource && (
              <g>
                <rect
                  x="-18"
                  y="-9"
                  width="36"
                  height="18"
                  rx="9"
                  fill={rightView.isConst ? '#f59e0b' : '#06b6d4'}
                  stroke={rightView.isConst ? '#fef3c7' : '#cffafe'}
                  strokeWidth="1.2"
                />
                <text
                  x="0"
                  y="3.5"
                  textAnchor="middle"
                  fill="#020617"
                  fontSize="10.5"
                  fontWeight="800"
                  fontFamily="ui-monospace, monospace"
                >
                  {pulse.rightSource.value}
                </text>
                <animateMotion begin="0s" dur={inDur} fill="freeze" path="M 244 0 L 244 12 L 182 42" />
                <animate
                  attributeName="opacity"
                  begin="0s"
                  dur={inDur}
                  values="0.2;1;1;0"
                  keyTimes="0;0.15;0.82;1"
                  fill="freeze"
                />
              </g>
            )}

            {/* 执行后半段：绿色运算结果胶囊从芯片底部无缝涌出并直落存入槽 */}
            {inExecute && isAluOrMemPulse && pulse?.newDestVal !== undefined && (
              <g opacity="0">
                <rect
                  x="-20"
                  y="-9.5"
                  width="40"
                  height="19"
                  rx="9.5"
                  fill="#10b981"
                  stroke="#d1fae5"
                  strokeWidth="1.2"
                />
                <text
                  x="0"
                  y="3.5"
                  textAnchor="middle"
                  fill="#022c22"
                  fontSize="10.5"
                  fontWeight="800"
                  fontFamily="ui-monospace, monospace"
                >
                  {pulse.newDestVal}
                </text>
                <animateMotion begin={inDur} dur={outDur} fill="freeze" path="M 160 54 L 160 95" />
                <animate
                  attributeName="opacity"
                  begin={inDur}
                  dur={outDur}
                  values="0;1;1;0"
                  keyTimes="0;0.14;0.84;1"
                  fill="freeze"
                />
              </g>
            )}
          </svg>

          {/* 嵌在芯片中央的运算符胶囊（在双输入汇合瞬间点亮脉冲） */}
          <div className="absolute top-[34px] flex items-center gap-1 rounded-full border border-slate-700 bg-slate-900/95 p-0.5 shadow">
            {playbackMode ? (
              <span
                key={`op-${pulseKey}`}
                style={inExecute ? { animationDelay: inDur } : undefined}
                className={`flex h-6 min-w-[26px] items-center justify-center rounded-full px-2 font-mono text-xs font-bold select-none ${
                  inExecute
                    ? 'rz-pop-new bg-cyan-400 text-slate-950 shadow-[0_0_12px_rgba(34,211,238,0.65)]'
                    : 'bg-slate-800 text-slate-300'
                }`}
              >
                {pulse?.symbol ?? (isFlowPulse ? '跳转' : ops[0])}
              </span>
            ) : ops.length === 1 ? (
              <span className="flex h-6 min-w-[26px] items-center justify-center rounded-full bg-cyan-400 px-2 font-mono text-xs font-bold text-slate-950 shadow select-none">
                {ops[0]}
              </span>
            ) : (
              ops.map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => onSelectOp(item)}
                  className={`h-6 min-w-[26px] rounded-full px-2 font-mono text-xs font-bold transition ${
                    op === item
                      ? 'bg-cyan-400 text-slate-950 shadow'
                      : 'text-slate-400 hover:bg-slate-800 hover:text-white'
                  }`}
                >
                  {item}
                </button>
              ))
            )}
          </div>

          {/* 分支 / 循环判断结果悬浮浮标（绝对定位于输出槽上方，零高度变化） */}
          {isFlowPulse && pulse && ord >= 3 && (
            <div
              key={`flow-${pulseKey}`}
              className={`rz-pop-new absolute bottom-0.5 flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold shadow ${
                pulse.branchTaken &&
                pulse.nextLine !== undefined &&
                pulse.line !== undefined &&
                pulse.nextLine <= pulse.line
                  ? 'border-amber-400/75 bg-amber-950/95 text-amber-200'
                  : pulse.branchTaken
                    ? 'border-cyan-400/75 bg-cyan-950/95 text-cyan-200'
                    : 'border-slate-700 bg-slate-900/95 text-slate-300'
              }`}
            >
              {pulse.branchTaken ? (
                pulse.nextLine !== undefined &&
                pulse.line !== undefined &&
                pulse.nextLine <= pulse.line ? (
                  <span className="inline-flex items-center gap-1">
                    <RotateCcw className="h-3 w-3 text-amber-300" />
                    回跳循环 → 第 {pulse.nextLine} 行
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1">
                    <CornerDownRight className="h-3 w-3 text-cyan-300" />
                    跳转 → {pulse.nextLine ? `第 ${pulse.nextLine} 行` : '目标'}
                  </span>
                )
              ) : (
                <span>条件不成立 · 下一行</span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* 4. 访存阶段（仅解锁内存或真实执行 lw/sw 时出现；前期彻底隐藏，避免引入未学概念） */}
      {showMemoryStage && (
        <div
          className={`flex items-center justify-between rounded-xl border px-3 py-1.5 text-[11px] transition ${
            inMemory && isRealMemOp
              ? 'border-violet-400 bg-violet-950/40 text-violet-200 shadow-[0_0_14px_rgba(167,139,250,0.28)]'
              : inMemory
                ? 'border-emerald-500/50 bg-emerald-950/20 text-emerald-300'
                : 'border-slate-700 bg-slate-950/80 text-slate-300'
          }`}
        >
          <span className="inline-flex items-center gap-1.5 font-semibold">
            <HardDrive className="h-3.5 w-3.5 opacity-75" />
            访存
          </span>
          {isRealMemOp && ord >= 4 ? (
            <span className="font-mono text-violet-200">
              {pulse?.kind === 'load'
                ? `读 ${memAddrHex} → ${pulse.memVal ?? 0}`
                : `写 ${memAddrHex} ← ${pulse?.memVal ?? 0}`}
            </span>
          ) : (
            <span className="font-mono text-[10px]">本指令不访存 · 直通</span>
          )}
        </div>
      )}

      {/* 5. 写回 / 存入区：存入槽 + 手动触发按钮（右侧接通绿色回流总线绕回寄存器） */}
      <div
        className={`rounded-2xl border bg-slate-950/90 px-3 py-2 transition ${
          inWriteback
            ? 'border-emerald-400 bg-emerald-950/25 shadow-[0_0_18px_rgba(52,211,153,0.22)]'
            : arrivedAtOutput && displayDest
              ? 'border-emerald-500/40'
              : 'border-slate-800'
        }`}
      >
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
          <span className="font-mono text-[10px] font-semibold text-emerald-400/90">
            {playbackMode && inWriteback && displayDest
              ? showStageNames
                ? '⤴ 写回寄存器'
                : `⤴ 存入 ${displayDest}`
              : showStageNames
                ? '写回'
                : ''}
          </span>

          <button
            type="button"
            disabled={playbackMode}
            aria-label="输出目标寄存器"
            draggable={!playbackMode && inputsReady}
            onDragStart={handleDragResultStart}
            onClick={() => !playbackMode && onSelectSlot('dest')}
            onDragOver={handleDragOverSlot('dest')}
            onDragLeave={handleDragLeaveSlot('dest')}
            onDrop={handleDropDest}
            className={`col-start-2 flex min-w-[104px] flex-col items-center justify-center rounded-xl border-2 px-3.5 py-1 font-mono transition disabled:cursor-default ${
              destOver
                ? 'scale-[1.02] border-emerald-300 bg-emerald-500/25 shadow-[0_0_16px_rgba(52,211,153,0.35)]'
                : destActive
                  ? 'border-emerald-400 bg-emerald-500/15 shadow-[0_0_14px_rgba(52,211,153,0.22)]'
                  : displayDest
                    ? inWriteback
                      ? 'rz-pop-new border-emerald-300 bg-emerald-500/20'
                      : 'border-emerald-500/55 bg-slate-900 hover:border-emerald-400'
                    : 'border-dashed border-slate-700 bg-slate-900/50 hover:border-emerald-500/60'
            }`}
          >
            <span className="pointer-events-none font-sans text-[10px] font-semibold text-emerald-400">
              存入
            </span>
            <span
              className={`pointer-events-none text-sm font-bold ${
                displayDest ? 'text-emerald-200' : 'text-slate-600'
              }`}
            >
              {displayDest
                ? displayDestVal !== undefined
                  ? `${displayDest} ← ${displayDestVal}`
                  : displayDest
                : playbackMode
                  ? '—'
                  : '?'}
            </span>
          </button>

          {!playbackMode ? (
            <button
              type="button"
              disabled={!canExecute}
              onClick={onExecuteAlu}
              className="col-start-3 inline-flex items-center justify-self-end gap-1 whitespace-nowrap rounded-xl bg-cyan-400 px-3 py-1.5 text-xs font-bold text-slate-950 shadow transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:bg-slate-800 disabled:text-slate-500"
            >
              <Zap className="h-3.5 w-3.5" /> 执行
            </button>
          ) : (
            <span className="col-start-3" />
          )}
        </div>
      </div>
    </div>
  );
}
