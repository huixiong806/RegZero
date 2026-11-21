import { useState } from 'react';
import { Grid3X3 } from 'lucide-react';
import { RV32_REGISTERS, getRegisterInfo } from '../../domain/registers';
import type { ConstantCard } from '../../engine/types';
import { ALU_RESULT_DRAG_MIME, OPERAND_DRAG_MIME } from './AluDesk';
import {
  getStageSeconds,
  stageOrder,
  type DatapathStage,
  type PlaybackSpeed,
} from './datapathTimeline';
import type { SourceOperand } from './model';
import type { CpuPulseEvent } from './pulseModel';

interface RegisterFileBoxProps {
  focusRegs: readonly string[];
  regRoles?: Record<string, string>;
  regs: Record<string, number>;
  goalRegs: Record<string, number>;
  constantCards?: readonly ConstantCard[];
  showRegXName: boolean;
  allowExpandAll: boolean;
  immediateUnlocked?: boolean;
  showStageNames?: boolean;
  showBus?: boolean;
  speed?: PlaybackSpeed;
  wbLanded?: boolean;
  playbackMode: boolean;
  activeStage: DatapathStage;
  pulse: CpuPulseEvent | null;
  warnReg?: string | null;
  canDragOperand: boolean;
  canDropResult: boolean;
  onSelectOperand: (operand: SourceOperand) => void;
  onDropResultOnReg: (targetReg: string) => void;
}

const GROUP_ACCENT: Record<'special' | 'temp' | 'arg' | 'saved', string> = {
  special: 'bg-slate-500/70',
  temp: 'bg-amber-400/80',
  arg: 'bg-cyan-400/80',
  saved: 'bg-violet-400/80',
};

/**
 * 统一「寄存器堆」硬件盒 + 独立「常量口」：
 * - 自适应 1~4（单行）、5~8（紧凑双行）、9~32（8×4 精简硅片矩阵）；
 * - 译码阶段点亮被读格子并在底部读口弹出 `[寄存器名 | 数值]` 数据标签；
 * - 写回阶段到达瞬间才将目标格从旧值切换为新值，并触发旧值顶飞动效。
 */
export function RegisterFileBox({
  focusRegs,
  regRoles,
  regs,
  goalRegs,
  constantCards = [],
  showRegXName,
  allowExpandAll,
  immediateUnlocked = false,
  showStageNames = false,
  showBus = false,
  speed = 1,
  wbLanded = false,
  playbackMode,
  activeStage,
  pulse,
  warnReg,
  canDragOperand,
  canDropResult,
  onSelectOperand,
  onDropResultOnReg,
}: RegisterFileBoxProps) {
  const [expandAll32, setExpandAll32] = useState(false);
  const [dragOverReg, setDragOverReg] = useState<string | null>(null);

  const ord = stageOrder(activeStage);
  const inDecode = activeStage === 'decode';
  const inDecodeOrExec = ord >= 2 && ord <= 3;
  const inWriteback = activeStage === 'writeback';
  const writeLanded = inWriteback && wbLanded;
  const beforeWriteLand = Boolean(pulse && ((ord >= 1 && ord < 5) || (inWriteback && !wbLanded)));

  const readRegs = new Set<string>();
  if (pulse && inDecode) {
    if (pulse.leftSource?.kind === 'reg') readRegs.add(pulse.leftSource.name);
    if (pulse.rightSource?.kind === 'reg') readRegs.add(pulse.rightSource.name);
  }
  const writtenReg = pulse && writeLanded ? pulse.destReg : undefined;

  // 组装展示列表：聚焦列表（含当前读写到的寄存器）或全部 32 个寄存器
  const regList: string[] =
    expandAll32 && allowExpandAll
      ? RV32_REGISTERS.map((r) => r.abi)
      : (() => {
          const list = [...focusRegs];
          if (playbackMode && pulse?.destReg && !list.includes(pulse.destReg)) {
            list.push(pulse.destReg);
          }
          if (playbackMode && pulse?.leftSource?.kind === 'reg' && !list.includes(pulse.leftSource.name)) {
            list.push(pulse.leftSource.name);
          }
          if (playbackMode && pulse?.rightSource?.kind === 'reg' && !list.includes(pulse.rightSource.name)) {
            list.push(pulse.rightSource.name);
          }
          return list;
        })();

  const isMatrix32 = regList.length > 8;
  const isCompact2Row = regList.length > 4 && regList.length <= 8;

  const gridColsClass = isMatrix32
    ? 'grid-cols-8 gap-1'
    : isCompact2Row
      ? 'grid-cols-4 gap-1.5'
      : regList.length === 1
        ? 'grid-cols-1 gap-2'
        : regList.length === 2
          ? 'grid-cols-2 gap-2'
          : regList.length === 4
            ? 'grid-cols-4 gap-1.5'
            : 'grid-cols-3 gap-2';

  const playbackConst =
    playbackMode && pulse?.rightSource?.kind === 'const' ? pulse.rightSource : null;
  // 一旦关卡解锁立即数（1-2 起）或配置了常量卡，该端口即常驻固定占位，彻底杜绝演示中忽隐忽现导致的横向挤压抖动
  const showConstPort = immediateUnlocked || constantCards.length > 0 || Boolean(playbackConst);

  const handleDragStart = (operand: SourceOperand) => (e: React.DragEvent) => {
    if (playbackMode || !canDragOperand) return;
    e.dataTransfer.setData(OPERAND_DRAG_MIME, JSON.stringify(operand));
    e.dataTransfer.effectAllowed = 'copy';
  };

  const busDropDur = `${getStageSeconds('decode', speed).toFixed(2)}s`;

  return (
    <div>
      <div
        className={
          showConstPort
            ? 'grid grid-cols-[3fr_1fr] items-stretch gap-2'
            : 'flex items-stretch'
        }
      >
        {/* 寄存器堆芯片主体 */}
        <div
          className={`relative min-w-0 flex-1 rounded-2xl border bg-slate-950/90 px-2.5 py-2 transition ${
            writeLanded
              ? 'border-emerald-400/75 shadow-[0_0_18px_rgba(52,211,153,0.18)]'
              : inDecode && readRegs.size > 0
                ? 'border-cyan-400/70 shadow-[0_0_18px_rgba(34,211,238,0.14)]'
                : 'border-slate-800'
          }`}
        >
          {/* 顶栏丝印 + 可选 32 格硅片矩阵切换（固定 h-5 杜绝高度抖动） */}
          <div className="mb-1.5 flex h-5 items-center justify-between gap-2">
            <div className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-slate-700 ring-1 ring-slate-600" />
              <span className="text-[11px] font-semibold tracking-wide text-slate-400">
                {showStageNames ? '寄存器堆' : '寄存器'}
              </span>
              {showStageNames && inDecode && readRegs.size > 0 && (
                <span className="rounded bg-cyan-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-cyan-300">
                  读取中
                </span>
              )}
              {showStageNames && writeLanded && writtenReg && (
                <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-300">
                  写入 {writtenReg}
                </span>
              )}
            </div>

            {allowExpandAll && (
              <button
                type="button"
                onClick={() => setExpandAll32((v) => !v)}
                className="inline-flex items-center gap-1 rounded-md border border-slate-800 bg-slate-900 px-1.5 py-0.5 font-mono text-[10px] text-slate-400 hover:border-cyan-500/50 hover:text-cyan-200"
              >
                <Grid3X3 className="h-3 w-3" />
                {expandAll32 ? '聚焦' : '32 格'}
              </button>
            )}
          </div>

          {/* 1~32 格自适应寄存器槽位阵 */}
          <div className={`grid ${gridColsClass}`}>
            {regList.map((regName) => {
              const info = getRegisterInfo(regName);
              const rawVal = regs[regName] ?? 0;
              // 写回胶囊抵达寄存器前始终保留旧值，触达瞬间翻转为新值并顶飞旧值！
              const holdOldValue =
                beforeWriteLand &&
                pulse?.destReg === regName &&
                pulse.oldDestVal !== undefined;
              const val = holdOldValue ? pulse.oldDestVal! : rawVal;

              const goalVal = goalRegs[regName];
              const goalHit = goalVal !== undefined && val === goalVal && !holdOldValue;
              const isWritten = writtenReg === regName;
              const isRead = !isWritten && readRegs.has(regName);
              const isWarn = !playbackMode && warnReg === regName;
              const isDragOver = !playbackMode && dragOverReg === regName;
              const showEjectOld =
                isWritten &&
                pulse?.oldDestVal !== undefined &&
                pulse.oldDestVal !== val;
              const cornerTag = showRegXName ? info?.xName ?? '' : regRoles?.[regName] ?? '';
              const animKey = `${regName}-${
                isWritten
                  ? `w-${pulse?.nonce ?? 0}`
                  : isRead
                    ? `r-${pulse?.nonce ?? 0}`
                    : 'i'
              }`;

              if (isMatrix32) {
                return (
                  <button
                    key={animKey}
                    type="button"
                    title={`${regName}${info ? ` (${info.xName})` : ''} = ${val}${regRoles?.[regName] ? ` · ${regRoles[regName]}` : ''}`}
                    draggable={!playbackMode && canDragOperand}
                    onDragStart={handleDragStart({ kind: 'reg', name: regName })}
                    onClick={() => !playbackMode && onSelectOperand({ kind: 'reg', name: regName })}
                    className={`relative flex flex-col items-center overflow-hidden rounded-lg border px-1 py-1 font-mono transition ${
                      isWritten
                        ? 'nmc-flash-write border-emerald-400 bg-emerald-950/50'
                        : isRead
                          ? 'nmc-pulse-read border-cyan-400 bg-cyan-950/40'
                          : val !== 0
                            ? 'border-slate-700 bg-slate-900 text-cyan-200 hover:border-cyan-500/60'
                            : 'border-slate-800/80 bg-slate-950/60 text-slate-600 hover:border-slate-700'
                    }`}
                  >
                    <span
                      className={`absolute inset-x-0 top-0 h-0.5 ${
                        info ? GROUP_ACCENT[info.group] : 'bg-slate-700'
                      }`}
                    />
                    <span className="pointer-events-none text-[9px] font-bold text-amber-300/90">
                      {regName}
                    </span>
                    <span
                      className={`pointer-events-none max-w-full truncate text-[11px] font-bold ${
                        isWritten
                          ? 'nmc-pop-new text-emerald-200'
                          : val !== 0
                            ? 'text-cyan-200'
                            : 'text-slate-600'
                      }`}
                    >
                      {val}
                    </span>
                  </button>
                );
              }

              return (
                <div
                  key={animKey}
                  draggable={!playbackMode && canDragOperand}
                  onDragStart={handleDragStart({ kind: 'reg', name: regName })}
                  onDragOver={(e) => {
                    if (
                      !playbackMode &&
                      canDropResult &&
                      e.dataTransfer.types.includes(ALU_RESULT_DRAG_MIME)
                    ) {
                      e.preventDefault();
                      e.dataTransfer.dropEffect = 'copy';
                      if (dragOverReg !== regName) setDragOverReg(regName);
                    }
                  }}
                  onDragLeave={() => setDragOverReg((p) => (p === regName ? null : p))}
                  onDrop={(e) => {
                    if (playbackMode) return;
                    e.preventDefault();
                    setDragOverReg(null);
                    if (canDropResult && e.dataTransfer.getData(ALU_RESULT_DRAG_MIME)) {
                      onDropResultOnReg(regName);
                    }
                  }}
                  onClick={() => !playbackMode && onSelectOperand({ kind: 'reg', name: regName })}
                  className={`relative overflow-visible select-none rounded-xl border px-2 py-1.5 text-center transition ${
                    playbackMode ? 'cursor-default' : 'cursor-pointer'
                  } ${
                    isWarn
                      ? 'nmc-flash-warn'
                      : isWritten
                        ? 'nmc-flash-write'
                        : isRead
                          ? 'nmc-pulse-read'
                          : ''
                  } ${
                    isDragOver
                      ? 'scale-[1.02] border-emerald-300 bg-emerald-500/20'
                      : isWritten
                        ? 'border-emerald-400 bg-emerald-950/35'
                        : isRead
                          ? 'border-cyan-400 bg-cyan-950/30'
                          : goalHit
                            ? 'border-emerald-500/70 bg-emerald-950/25'
                            : 'border-slate-800 bg-slate-900/90 hover:border-cyan-400/70'
                  }`}
                >
                  <div className="pointer-events-none flex items-center justify-between gap-1 font-mono text-[10px]">
                    <span className="font-bold text-amber-300">{regName}</span>
                    {cornerTag && (
                      <span
                        className={`truncate ${
                          showRegXName ? 'font-mono text-slate-600' : 'font-sans text-slate-500'
                        }`}
                      >
                        {cornerTag}
                      </span>
                    )}
                  </div>

                  <div className="pointer-events-none relative mt-0.5 flex items-center justify-center">
                    {showEjectOld && (
                      <span
                        aria-hidden="true"
                        className="nmc-eject-old pointer-events-none absolute left-1/2 top-0 rounded bg-rose-500/20 px-1 font-mono text-xs font-bold text-rose-300 line-through"
                      >
                        {pulse.oldDestVal}
                      </span>
                    )}
                    <span
                      className={`font-mono font-bold tracking-tight ${
                        isCompact2Row ? 'text-base' : 'text-lg'
                      } ${isWritten ? 'nmc-pop-new text-emerald-200' : 'text-cyan-200'}`}
                    >
                      {val}
                    </span>
                  </div>

                  {goalVal !== undefined && (
                    <div
                      className={`pointer-events-none font-mono text-[9px] ${
                        goalHit ? 'text-emerald-400' : 'text-slate-500'
                      }`}
                    >
                      {goalHit ? '✓' : `→ ${goalVal}`}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* 独立「立即数」端口（从指令本身译出固定常量，与寄存器物理分离；3fr:1fr 比例与下方 Y 型汇流总线精确对齐） */}
        {showConstPort && (
          <div
            className={`flex min-w-0 flex-col justify-between rounded-2xl border px-2 py-2 transition ${
              playbackConst && inDecodeOrExec
                ? 'border-amber-400/75 bg-amber-950/25 shadow-[0_0_14px_rgba(251,191,36,0.18)]'
                : !playbackMode && constantCards.length > 0
                  ? 'border-amber-500/40 bg-amber-950/15'
                  : 'border-slate-800 bg-slate-950/70'
            }`}
          >
            <span
              className={`h-5 text-center text-[11px] font-semibold leading-5 ${
                playbackConst && inDecodeOrExec
                  ? 'text-amber-200'
                  : !playbackMode && constantCards.length > 0
                    ? 'text-amber-300'
                    : 'text-slate-500'
              }`}
            >
              立即数
            </span>
            <div className="my-auto space-y-1.5 pt-1">
              {playbackMode ? (
                playbackConst && inDecodeOrExec ? (
                  <div
                    key={`imm-${pulse?.nonce ?? 0}`}
                    className="nmc-pop-new flex items-center justify-center rounded-xl border border-amber-400/75 bg-amber-500/15 px-2 py-2 font-mono shadow-[0_0_12px_rgba(251,191,36,0.28)]"
                  >
                    <span className="text-base font-bold text-amber-200">
                      #{playbackConst.value}
                    </span>
                  </div>
                ) : (
                  <div className="flex items-center justify-center rounded-xl border border-dashed border-slate-800 bg-slate-900/40 px-2 py-2 font-mono">
                    <span className="text-sm font-bold text-slate-600">—</span>
                  </div>
                )
              ) : constantCards.length > 0 ? (
                constantCards.map((card) => (
                  <button
                    key={`${card.kind}-${card.label}`}
                    type="button"
                    draggable
                    onDragStart={handleDragStart({ kind: 'const', card })}
                    onClick={() => onSelectOperand({ kind: 'const', card })}
                    className="flex w-full items-center justify-center rounded-xl border border-amber-500/50 bg-amber-500/10 px-2 py-2 font-mono transition hover:border-amber-300 hover:bg-amber-500/20"
                  >
                    <span className="text-base font-bold text-amber-200">#{card.label}</span>
                  </button>
                ))
              ) : (
                <div className="flex items-center justify-center rounded-xl border border-dashed border-slate-800 bg-slate-900/40 px-2 py-2 font-mono">
                  <span className="text-sm font-bold text-slate-600">—</span>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* 固定高度总线通道（真实硬件拓扑：有立即数口时，寄存器 rs2 与立即数端口通过 Y 型汇流口共同接入右输入引脚） */}
      {showBus &&
        (() => {
          const rightIsConst = pulse?.rightSource?.kind === 'const';
          const rightIsReg = pulse?.rightSource?.kind === 'reg';
          const leftLit = inDecodeOrExec && Boolean(pulse?.leftSource);
          const regRightLit = inDecodeOrExec && rightIsReg;
          const immRightLit = inDecodeOrExec && rightIsConst;

          return (
            <div className="relative h-[44px] w-full" aria-hidden="true">
              <svg
                viewBox="0 0 400 44"
                preserveAspectRatio="none"
                className="h-full w-full overflow-visible"
              >
                {/* 左操作数总线（始终直连寄存器底部 25% → 左输入口 25%） */}
                <path
                  d="M 100 0 L 100 44"
                  fill="none"
                  stroke={inDecode && pulse?.leftSource ? '#22d3ee' : leftLit ? '#0891b2' : '#1e293b'}
                  strokeWidth={inDecode && pulse?.leftSource ? 2.6 : leftLit ? 2 : 1.6}
                  className={inDecode && pulse?.leftSource ? 'nmc-wire-flow' : undefined}
                />

                {showConstPort ? (
                  <>
                    {/* 寄存器右读口（57.5%）折线汇入右输入口（75%） */}
                    <path
                      d="M 230 0 L 230 16.7 L 300 30.8 L 300 44"
                      fill="none"
                      stroke={inDecode && rightIsReg ? '#22d3ee' : regRightLit ? '#0891b2' : '#1e293b'}
                      strokeWidth={inDecode && rightIsReg ? 2.6 : regRightLit ? 2 : 1.6}
                      className={inDecode && rightIsReg ? 'nmc-wire-flow' : undefined}
                    />
                    {/* 立即数端口正下方（88%）折线汇入右输入口（75%） */}
                    <path
                      d="M 352 0 L 352 16.7 L 300 30.8 L 300 44"
                      fill="none"
                      stroke={inDecode && rightIsConst ? '#fbbf24' : immRightLit ? '#d97706' : '#1e293b'}
                      strokeWidth={inDecode && rightIsConst ? 2.6 : immRightLit ? 2 : 1.6}
                      className={inDecode && rightIsConst ? 'nmc-wire-flow' : undefined}
                    />
                    {/* 汇流节点（真实 CPU 的右操作数二选一汇流点） */}
                    <circle
                      cx="300"
                      cy="30.8"
                      r="3"
                      fill={
                        immRightLit ? '#fbbf24' : regRightLit ? '#22d3ee' : '#334155'
                      }
                    />
                  </>
                ) : (
                  /* 无立即数口（如 1-1）：右总线直连寄存器底部 75% → 右输入口 75% */
                  <path
                    d="M 300 0 L 300 44"
                    fill="none"
                    stroke={inDecode && rightIsReg ? '#22d3ee' : regRightLit ? '#0891b2' : '#1e293b'}
                    strokeWidth={inDecode && rightIsReg ? 2.6 : regRightLit ? 2 : 1.6}
                    className={inDecode && rightIsReg ? 'nmc-wire-flow' : undefined}
                  />
                )}
              </svg>

              {/* 左操作数滑动胶囊（沿 25% 铜线直落左输入口） */}
              {pulse && inDecode && pulse.leftSource && (
                <span
                  key={`bus-l-${pulse.nonce}`}
                  style={{ left: '25%', animationDuration: busDropDur }}
                  className="nmc-bus-drop pointer-events-none absolute top-0 z-10 inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-cyan-300/80 bg-cyan-950/95 px-2 py-0.5 font-mono text-[11px] font-bold text-cyan-100 shadow-[0_0_12px_rgba(34,211,238,0.4)]"
                >
                  <span className="text-amber-300">
                    {pulse.leftSource.kind === 'reg' ? pulse.leftSource.name : '#'}
                  </span>
                  <span className="text-slate-500">|</span>
                  <span>{pulse.leftSource.value}</span>
                </span>
              )}

              {/* 右操作数滑动胶囊（来自立即数端口则从 88% 滑出，来自寄存器则从 57.5%/75% 滑出） */}
              {pulse && inDecode && pulse.rightSource && (
                <span
                  key={`bus-r-${pulse.nonce}`}
                  style={{
                    ...(showConstPort ? {} : { left: '75%' }),
                    animationDuration: busDropDur,
                  }}
                  className={`${
                    showConstPort
                      ? rightIsConst
                        ? 'nmc-bus-drop-imm-r'
                        : 'nmc-bus-drop-reg-r'
                      : 'nmc-bus-drop'
                  } pointer-events-none absolute top-0 z-10 inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 font-mono text-[11px] font-bold shadow ${
                    rightIsConst
                      ? 'border-amber-300/80 bg-amber-950/95 text-amber-100 shadow-[0_0_12px_rgba(251,191,36,0.4)]'
                      : 'border-cyan-300/80 bg-cyan-950/95 text-cyan-100 shadow-[0_0_12px_rgba(34,211,238,0.4)]'
                  }`}
                >
                  {rightIsConst ? (
                    <span>#{pulse.rightSource.value}</span>
                  ) : (
                    <>
                      <span className="text-amber-300">
                        {pulse.rightSource.kind === 'reg' ? pulse.rightSource.name : '#'}
                      </span>
                      <span className="text-slate-500">|</span>
                      <span>{pulse.rightSource.value}</span>
                    </>
                  )}
                </span>
              )}
            </div>
          );
        })()}
    </div>
  );
}
