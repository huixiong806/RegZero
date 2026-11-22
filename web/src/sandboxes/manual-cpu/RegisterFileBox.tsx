import { useState, type RefObject } from 'react';
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
import {
  RADIX_LABEL,
  formatDatapathValue,
  formatRegisterCardValue,
  splitBitsIntoBytes,
  type RegRadix,
} from './radixFormat';

interface RegisterFileBoxProps {
  focusRegs: readonly string[];
  regRoles?: Record<string, string>;
  regs: Record<string, number>;
  goalRegs: Record<string, number>;
  constantCards?: readonly ConstantCard[];
  showRegXName: boolean;
  allowExpandAll: boolean;
  radix: RegRadix;
  availableRadices: readonly RegRadix[];
  onChangeRadix: (next: RegRadix) => void;
  immediateUnlocked?: boolean;
  memoryUnlocked?: boolean;
  regBoxRef?: RefObject<HTMLDivElement | null>;
  busRef?: RefObject<HTMLDivElement | null>;
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
  radix,
  availableRadices,
  onChangeRadix,
  immediateUnlocked = false,
  memoryUnlocked = false,
  regBoxRef,
  busRef,
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

  const activeRadix: RegRadix = availableRadices.includes(radix) ? radix : 'dec';

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
    if (pulse.storeDataSource) readRegs.add(pulse.storeDataSource.name);
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
          if (playbackMode && pulse?.storeDataSource && !list.includes(pulse.storeDataSource.name)) {
            list.push(pulse.storeDataSource.name);
          }
          return list;
        })();

  const isMatrix32 = regList.length > 8;
  const isCompactMultiRow = regList.length > 4 && regList.length <= 8;
  const isFourColGrid = !isMatrix32 && regList.length >= 4;
  const hasAnyRole = !isMatrix32 && regList.some((name) => Boolean(regRoles?.[name]));

  // 紧凑芯片网格：全部标签已精简为 2~4 字真实契约，4 格单行、5~8 格紧凑双行，既完整不截断又不占多余高度
  const gridColsClass = isMatrix32
    ? 'grid-cols-8 gap-1'
    : regList.length === 1
      ? 'grid-cols-1 gap-2'
      : regList.length === 2
        ? 'grid-cols-2 gap-1.5'
        : regList.length === 3
          ? 'grid-cols-3 gap-1.5'
          : 'grid-cols-4 gap-1.5';

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
          ref={regBoxRef}
          className={`relative min-w-0 flex-1 rounded-2xl border bg-slate-950/90 px-2.5 py-1.5 transition ${
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

            <div className="flex items-center gap-1">
              {availableRadices.length > 1 && (
                <div className="inline-flex items-center rounded-md border border-slate-800 bg-slate-900 p-0.5 font-mono text-[9px]">
                  {availableRadices.map((r) => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => onChangeRadix(r)}
                      className={`rounded px-1 py-0 font-bold transition ${
                        activeRadix === r
                          ? 'bg-cyan-400 text-slate-950'
                          : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      {RADIX_LABEL[r]}
                    </button>
                  ))}
                </div>
              )}
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
          </div>

          {/* 1~32 格自适应寄存器槽位阵：BIN 模式下自动切为超紧凑单行 32-bit 比特条（每行仅 ~22px，无多余标签，悬停看十进制/十六进制/用途），上下按字节严格对齐 */}
          {activeRadix === 'bin' ? (
            <div className={isMatrix32 ? 'max-h-[236px] space-y-1 overflow-y-auto pr-0.5' : 'space-y-1'}>
              {/* 4 字节位号标尺（左侧留出与寄存器名等宽的 w-7 占位，与下方 4 个字节槽精确 1:1 竖向对齐） */}
              <div className="flex items-center gap-1.5 px-1.5 font-mono text-[8.5px] leading-none text-slate-600 select-none">
                <span className="w-7 shrink-0 text-left text-[8px] text-slate-600">BIT</span>
                <div className="grid flex-1 grid-cols-4 gap-1 text-center">
                  <span>31 ·· 24</span>
                  <span>23 ·· 16</span>
                  <span>15 ·· 8</span>
                  <span>7 ·· 0</span>
                </div>
              </div>
              {regList.map((regName) => {
                const info = getRegisterInfo(regName);
                const rawVal = regs[regName] ?? 0;
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
                const roleLabel = regRoles?.[regName] ?? '';
                const bytes = splitBitsIntoBytes(val);
                const hexCompact = `0x${(val >>> 0).toString(16).toUpperCase().padStart(8, '0')}`;
                const animKey = `${regName}-bin-${
                  isWritten
                    ? `w-${pulse?.nonce ?? 0}`
                    : isRead
                      ? `r-${pulse?.nonce ?? 0}`
                      : 'i'
                }`;

                return (
                  <div
                    key={animKey}
                    title={`${regName}${info ? ` (${info.xName})` : ''} = ${val} (${hexCompact})${roleLabel ? ` · ${roleLabel}` : ''}`}
                    draggable={!playbackMode && canDragOperand}
                    onDragStart={handleDragStart({ kind: 'reg', name: regName })}
                    onClick={() => !playbackMode && onSelectOperand({ kind: 'reg', name: regName })}
                    className={`relative flex items-center gap-1.5 rounded-lg border px-1.5 py-0.5 select-none transition ${
                      playbackMode ? 'cursor-default' : 'cursor-pointer'
                    } ${
                      isWarn
                        ? 'rz-flash-warn'
                        : isWritten
                          ? 'rz-flash-write border-emerald-400 bg-emerald-950/35'
                          : isRead
                            ? 'rz-pulse-read border-cyan-400 bg-cyan-950/30'
                            : goalHit
                              ? 'border-emerald-500/70 bg-emerald-950/20'
                              : 'border-slate-800 bg-slate-900/85 hover:border-cyan-400/70'
                    }`}
                  >
                    <span className="pointer-events-none w-7 shrink-0 truncate font-mono text-[10px] font-bold text-amber-300">
                      {regName}
                    </span>

                    <div
                      className={`pointer-events-none grid flex-1 grid-cols-4 gap-1 font-mono text-[10px] leading-none ${
                        isWritten ? 'rz-pop-new' : ''
                      }`}
                    >
                      {bytes.map(([hi, lo], byteIdx) => (
                        <div
                          key={byteIdx}
                          className="flex items-center justify-center gap-0.5 rounded bg-slate-950/75 px-0.5 py-0.5"
                        >
                          {[hi, lo].map((nibble, nibIdx) => (
                            <span key={nibIdx} className="inline-flex">
                              {nibble.split('').map((bit, bitIdx) => (
                                <span
                                  key={bitIdx}
                                  className={
                                    bit === '1'
                                      ? isWritten
                                        ? 'font-bold text-emerald-300'
                                        : 'font-bold text-cyan-300'
                                      : 'text-slate-600'
                                  }
                                >
                                  {bit}
                                </span>
                              ))}
                            </span>
                          ))}
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
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
                const xNameTag = showRegXName ? info?.xName ?? '' : '';
                const roleLabel = regRoles?.[regName] ?? '';
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
                          ? 'rz-flash-write border-emerald-400 bg-emerald-950/50'
                          : isRead
                            ? 'rz-pulse-read border-cyan-400 bg-cyan-950/40'
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
                        className={`pointer-events-none max-w-full truncate font-bold ${
                          activeRadix === 'dec' ? 'text-[11px]' : 'text-[9px]'
                        } ${
                          isWritten
                            ? 'rz-pop-new text-emerald-200'
                            : val !== 0
                              ? 'text-cyan-200'
                              : 'text-slate-600'
                        }`}
                      >
                        {formatRegisterCardValue(val, activeRadix, true)}
                      </span>
                    </button>
                  );
                }

                return (
                  <div
                    key={animKey}
                    title={`${regName}${info ? ` (${info.xName})` : ''} = ${val}${roleLabel ? ` · ${roleLabel}` : ''}`}
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
                    className={`relative flex flex-col justify-between overflow-visible select-none rounded-xl border px-1.5 py-1 text-center transition ${
                      playbackMode ? 'cursor-default' : 'cursor-pointer'
                    } ${
                      isWarn
                        ? 'rz-flash-warn'
                        : isWritten
                          ? 'rz-flash-write'
                          : isRead
                            ? 'rz-pulse-read'
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
                    <div className="pointer-events-none flex items-center justify-between gap-1 font-mono text-[10px] leading-tight">
                      <span className="font-bold text-amber-300">{regName}</span>
                      {xNameTag && (
                        <span className="font-mono text-[9px] text-slate-500">{xNameTag}</span>
                      )}
                    </div>

                    <div className="pointer-events-none relative flex min-h-[20px] items-center justify-center">
                      {showEjectOld && (
                        <span
                          aria-hidden="true"
                          className="rz-eject-old pointer-events-none absolute left-1/2 top-0 rounded bg-rose-500/20 px-1 font-mono text-xs font-bold text-rose-300 line-through"
                        >
                          {formatDatapathValue(pulse.oldDestVal!, activeRadix)}
                        </span>
                      )}
                      <span
                        className={`font-mono font-bold ${
                          activeRadix === 'hex'
                            ? isFourColGrid
                              ? 'text-[9px] tracking-tighter'
                              : 'text-xs tracking-tight'
                            : activeRadix === 'u32'
                              ? isFourColGrid
                                ? 'text-xs tracking-tighter'
                                : 'text-sm tracking-tight'
                              : isCompactMultiRow
                                ? 'text-sm tracking-tight'
                                : 'text-base tracking-tight'
                        } ${isWritten ? 'rz-pop-new text-emerald-200' : 'text-cyan-200'}`}
                      >
                        {formatRegisterCardValue(val, activeRadix, false)}
                      </span>
                    </div>

                    {hasAnyRole && (
                      <div className="pointer-events-none min-h-[12px] break-words font-sans text-[9.5px] leading-tight text-slate-400">
                        {roleLabel}
                      </div>
                    )}

                    {goalVal !== undefined && (
                      <div
                        className={`pointer-events-none mt-0.5 truncate font-mono text-[9px] ${
                          goalHit ? 'text-emerald-400' : 'text-slate-500'
                        }`}
                      >
                        {goalHit
                          ? '✓'
                          : `→ ${formatDatapathValue(goalVal, activeRadix)}`}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
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
                    className="rz-pop-new flex items-center justify-center rounded-xl border border-amber-400/75 bg-amber-500/15 px-2 py-2 font-mono shadow-[0_0_12px_rgba(251,191,36,0.28)]"
                  >
                    <span className="text-base font-bold text-amber-200">
                      #{formatDatapathValue(playbackConst.value, activeRadix)}
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

      {/* 固定高度总线通道（真实硬件拓扑：有立即数口时，寄存器 rs2 与立即数端口通过 Y 型汇流口共同接入右输入引脚；存内存时端口 B 经跳线分流直通右侧访存轨） */}
      {showBus &&
        (() => {
          const rightIsConst = pulse?.rightSource?.kind === 'const';
          const rightIsReg = pulse?.rightSource?.kind === 'reg';
          const leftLit = inDecodeOrExec && Boolean(pulse?.leftSource);
          const regRightLit = inDecodeOrExec && rightIsReg;
          const immRightLit = inDecodeOrExec && rightIsConst;
          const isStoreTapActive =
            pulse?.kind === 'store' &&
            Boolean(pulse.storeDataSource) &&
            (ord >= 2 && ord <= 4);
          const showStoreTapWire = showConstPort && (memoryUnlocked || isStoreTapActive);

          return (
            <div ref={busRef} className="relative h-[44px] w-full" aria-hidden="true">
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
                  className={inDecode && pulse?.leftSource ? 'rz-wire-flow' : undefined}
                />

                {showConstPort ? (
                  <>
                    {/* 寄存器右读口（端口 B，57.5%）折线汇入右输入口（75%） */}
                    <path
                      d="M 230 0 L 230 16.7 L 300 30.8 L 300 44"
                      fill="none"
                      stroke={inDecode && rightIsReg ? '#22d3ee' : regRightLit ? '#0891b2' : '#1e293b'}
                      strokeWidth={inDecode && rightIsReg ? 2.6 : regRightLit ? 2 : 1.6}
                      className={inDecode && rightIsReg ? 'rz-wire-flow' : undefined}
                    />
                    {/* 立即数端口正下方（88%）折线汇入右输入口（75%） */}
                    <path
                      d="M 352 0 L 352 16.7 L 300 30.8 L 300 44"
                      fill="none"
                      stroke={inDecode && rightIsConst ? '#fbbf24' : immRightLit ? '#d97706' : '#1e293b'}
                      strokeWidth={inDecode && rightIsConst ? 2.6 : immRightLit ? 2 : 1.6}
                      className={inDecode && rightIsConst ? 'rz-wire-flow' : undefined}
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
                    {/* 存内存直通分流线：从寄存器端口 B（x=230）引出，以电路跳线拱桥跨过立即数竖线（x=352），直通右侧外轨送往访存单元 */}
                    {showStoreTapWire && (
                      <>
                        <path
                          d="M 230 0 L 230 12 L 346 12 A 6 6 0 0 1 358 12 L 400 12"
                          fill="none"
                          stroke={isStoreTapActive ? '#a78bfa' : '#1e293b'}
                          strokeWidth={isStoreTapActive ? 2.6 : 1.4}
                          strokeDasharray={isStoreTapActive ? '6 5' : undefined}
                          className={isStoreTapActive ? 'rz-wire-flow' : undefined}
                        />
                        <circle
                          cx="230"
                          cy="12"
                          r="2.6"
                          fill={isStoreTapActive ? '#a78bfa' : '#334155'}
                        />
                      </>
                    )}
                  </>
                ) : (
                  /* 无立即数口（如 1-1）：右总线直连寄存器底部 75% → 右输入口 75% */
                  <path
                    d="M 300 0 L 300 44"
                    fill="none"
                    stroke={inDecode && rightIsReg ? '#22d3ee' : regRightLit ? '#0891b2' : '#1e293b'}
                    strokeWidth={inDecode && rightIsReg ? 2.6 : regRightLit ? 2 : 1.6}
                    className={inDecode && rightIsReg ? 'rz-wire-flow' : undefined}
                  />
                )}
              </svg>

              {/* 左操作数滑动胶囊（沿 25% 铜线直落左输入口） */}
              {pulse && inDecode && pulse.leftSource && (
                <span
                  key={`bus-l-${pulse.nonce}`}
                  style={{ left: '25%', animationDuration: busDropDur }}
                  className="rz-bus-drop pointer-events-none absolute top-0 z-10 inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-cyan-300/80 bg-cyan-950/95 px-2 py-0.5 font-mono text-[11px] font-bold text-cyan-100 shadow-[0_0_12px_rgba(34,211,238,0.4)]"
                >
                  <span className="text-amber-300">
                    {pulse.leftSource.kind === 'reg' ? pulse.leftSource.name : '#'}
                  </span>
                  <span className="text-slate-500">|</span>
                  <span>{formatDatapathValue(pulse.leftSource.value, activeRadix)}</span>
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
                        ? 'rz-bus-drop-imm-r'
                        : 'rz-bus-drop-reg-r'
                      : 'rz-bus-drop'
                  } pointer-events-none absolute top-0 z-10 inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 font-mono text-[11px] font-bold shadow ${
                    rightIsConst
                      ? 'border-amber-300/80 bg-amber-950/95 text-amber-100 shadow-[0_0_12px_rgba(251,191,36,0.4)]'
                      : 'border-cyan-300/80 bg-cyan-950/95 text-cyan-100 shadow-[0_0_12px_rgba(34,211,238,0.4)]'
                  }`}
                >
                  {rightIsConst ? (
                    <span>#{formatDatapathValue(pulse.rightSource.value, activeRadix)}</span>
                  ) : (
                    <>
                      <span className="text-amber-300">
                        {pulse.rightSource.kind === 'reg' ? pulse.rightSource.name : '#'}
                      </span>
                      <span className="text-slate-500">|</span>
                      <span>{formatDatapathValue(pulse.rightSource.value, activeRadix)}</span>
                    </>
                  )}
                </span>
              )}

              {/* 存内存待写数据滑动胶囊（译码阶段从寄存器端口 B 滑出、跨过立即数线直奔右侧外轨，进入执行阶段后由右外轨无缝接力下落） */}
              {pulse && inDecode && pulse.kind === 'store' && pulse.storeDataSource && (
                <span
                  key={`bus-store-${pulse.nonce}`}
                  style={{ animationDuration: busDropDur }}
                  className="rz-store-tap-out pointer-events-none absolute top-0 z-20 inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-violet-200/90 bg-violet-950/95 px-2 py-0.5 font-mono text-[11px] font-bold text-violet-100 shadow-[0_0_14px_rgba(167,139,250,0.55)]"
                >
                  <span className="text-amber-300">{pulse.storeDataSource.name}</span>
                  <span className="text-violet-400/70">|</span>
                  <span>{formatDatapathValue(pulse.storeDataSource.value, activeRadix)}</span>
                </span>
              )}
            </div>
          );
        })()}
    </div>
  );
}
