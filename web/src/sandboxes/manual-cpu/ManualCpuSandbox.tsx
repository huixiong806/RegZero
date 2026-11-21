import { useEffect, useState } from 'react';
import { ArrowRight, Check, RotateCcw, Target, Terminal, Undo2 } from 'lucide-react';
import { getRegisterInfo } from '../../domain/registers';
import type { ManualCpuAluOp, ManualCpuSandboxConfig } from '../../engine/types';
import {
  ALU_RESULT_DRAG_MIME,
  AluDesk,
  OPERAND_DRAG_MIME,
  type ActiveSlot,
} from './AluDesk';
import { PcTrackDesk } from './PcTrackDesk';
import {
  applyAluOperation,
  applyDirectCopy,
  collectUsedSyntaxPatterns,
  createManualCpuState,
  undoManualCpu,
  type ManualCpuState,
  type SourceOperand,
  type SyntaxSlot,
} from './model';
import { applyPcTrackStep } from './pcTrackModel';

export interface ManualCpuSandboxProps {
  config: ManualCpuSandboxConfig;
  showRegXName?: boolean;
  onFocusEditor?: () => void;
}

export function ManualCpuSandbox({
  config,
  showRegXName = false,
  onFocusEditor,
}: ManualCpuSandboxProps) {
  const [state, setState] = useState<ManualCpuState>(() => createManualCpuState(config, 0));
  const [left, setLeft] = useState<SourceOperand | null>(null);
  const [right, setRight] = useState<SourceOperand | null>(null);
  const [copySrc, setCopySrc] = useState<SourceOperand | null>(null);
  const [activeSlot, setActiveSlot] = useState<ActiveSlot>('left');
  const [op, setOp] = useState<ManualCpuAluOp>(config.aluOps?.[0] ?? '+');
  const [destReg, setDestReg] = useState<string | null>(null);
  const [dragOverReg, setDragOverReg] = useState<string | null>(null);
  const [flashNonce, setFlashNonce] = useState(0);

  useEffect(() => {
    setState(createManualCpuState(config, 0));
    setLeft(null);
    setRight(null);
    setCopySrc(null);
    setActiveSlot('left');
    setOp(config.aluOps?.[0] ?? '+');
    setDestReg(null);
    setDragOverReg(null);
  }, [config]);

  const hasAlu = config.modules.includes('alu');
  const hasConstants = config.modules.includes('constants') && (config.constantCards?.length ?? 0) > 0;
  const hasPcTrack = config.modules.includes('pcTrack');

  const assignDestOperand = (operand: SourceOperand) => {
    if (operand.kind !== 'reg') {
      setState((prev) => ({
        ...prev,
        feedback: { tone: 'warn', message: '常量卡只能作为输入，不能作为输出目标，请拖入寄存器。' },
      }));
      return;
    }
    if (operand.name === 'zero') {
      setState((prev) => ({
        ...prev,
        feedback: { tone: 'warn', message: 'zero (x0) 恒为 0，不能作为输出目标，请换一个寄存器。' },
      }));
      return;
    }
    setDestReg(operand.name);
    setState((prev) => (prev.feedback?.tone === 'warn' ? { ...prev, feedback: null } : prev));
    if (!left) setActiveSlot('left');
    else if (!right) setActiveSlot('right');
  };

  const handleSelectOperand = (operand: SourceOperand) => {
    if (!hasAlu && !config.allowCopy) return;
    if (activeSlot === 'copySrc') {
      setCopySrc(operand);
      return;
    }
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

  const handleDragStart = (operand: SourceOperand) => (e: React.DragEvent) => {
    e.dataTransfer.setData(OPERAND_DRAG_MIME, JSON.stringify(operand));
    e.dataTransfer.effectAllowed = 'copy';
  };

  const handleDragOverReg = (targetReg: string) => (e: React.DragEvent) => {
    const canDropResult =
      hasAlu && Boolean(left && right) && e.dataTransfer.types.includes(ALU_RESULT_DRAG_MIME);
    const canDropCopy =
      Boolean(config.allowCopy) && e.dataTransfer.types.includes(OPERAND_DRAG_MIME);
    if (!canDropResult && !canDropCopy) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    if (dragOverReg !== targetReg) setDragOverReg(targetReg);
  };

  const handleDragLeaveReg = (targetReg: string) => () => {
    setDragOverReg((prev) => (prev === targetReg ? null : prev));
  };

  const handleDropOnReg = (targetReg: string) => (e: React.DragEvent) => {
    e.preventDefault();
    setDragOverReg(null);

    if (hasAlu && left && right && e.dataTransfer.getData(ALU_RESULT_DRAG_MIME)) {
      if (targetReg !== 'zero') setDestReg(targetReg);
      setState((prev) => applyAluOperation(prev, config, left, op, right, targetReg));
      setFlashNonce((n) => n + 1);
      return;
    }

    if (!config.allowCopy) return;
    try {
      const parsed = JSON.parse(e.dataTransfer.getData(OPERAND_DRAG_MIME)) as SourceOperand;
      if (parsed && (parsed.kind === 'reg' || parsed.kind === 'const')) {
        setState((prev) => applyDirectCopy(prev, config, parsed, targetReg));
        setFlashNonce((n) => n + 1);
      }
    } catch {
      // 忽略无效拖拽数据
    }
  };

  const handleReset = (nextCaseIndex = state.caseIndex) => {
    setState(createManualCpuState(config, nextCaseIndex));
    setLeft(null);
    setRight(null);
    setCopySrc(null);
    setDestReg(null);
    setDragOverReg(null);
    setActiveSlot('left');
  };

  const activeGoalRegs =
    config.pcTrack?.cases?.[state.caseIndex]?.goal.regs ?? config.warmupPuzzle.goal.regs ?? {};

  return (
    <div className="space-y-3 rounded-2xl border border-slate-800 bg-slate-900/75 p-3.5">
      {/* 极简图形目标头 + 图标控制 */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <Target className="h-3.5 w-3.5 text-cyan-400" />
          {Object.entries(activeGoalRegs).map(([reg, want]) => {
            const hit = (state.regs[reg] ?? 0) === want;
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

        <div className="flex items-center gap-1">
          <button
            type="button"
            title="撤销一步"
            disabled={state.undoStack.length === 0}
            onClick={() => setState((prev) => undoManualCpu(prev))}
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
      </div>

      {/* 寄存器芯片卡片阵 */}
      <div className="grid grid-cols-3 gap-2">
        {config.focusRegs.map((regName) => {
          const val = state.regs[regName] ?? 0;
          const info = getRegisterInfo(regName);
          const goalVal = activeGoalRegs[regName];
          const goalHit = goalVal !== undefined && val === goalVal;
          const flashed = state.lastWrittenReg === regName;
          const isWarnFlash = flashed && state.feedback?.tone === 'warn';

          const isDragOver = dragOverReg === regName;
          const cornerTag = showRegXName
            ? info?.xName ?? ''
            : config.regRoles?.[regName] ?? '';

          return (
            <div
              key={`${regName}-${flashed ? flashNonce : 0}`}
              draggable={hasAlu || Boolean(config.allowCopy)}
              onDragStart={handleDragStart({ kind: 'reg', name: regName })}
              onDragOver={handleDragOverReg(regName)}
              onDragLeave={handleDragLeaveReg(regName)}
              onDrop={handleDropOnReg(regName)}
              onClick={() => handleSelectOperand({ kind: 'reg', name: regName })}
              className={`cursor-pointer select-none rounded-xl border px-3 py-2 text-center transition ${
                isWarnFlash ? 'nmc-flash-warn' : flashed ? 'nmc-flash-write' : ''
              } ${
                isDragOver
                  ? 'scale-[1.02] border-emerald-300 bg-emerald-500/20 shadow-[0_0_16px_rgba(52,211,153,0.3)]'
                  : goalHit
                    ? 'border-emerald-400/80 bg-emerald-950/35 shadow-[0_0_12px_rgba(16,185,129,0.18)]'
                    : 'border-slate-700/90 bg-slate-950/90 hover:border-cyan-400/70'
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
              <div className="pointer-events-none mt-1 font-mono text-2xl font-bold tracking-tight text-cyan-200">
                {val}
              </div>
              {goalVal !== undefined && (
                <div
                  className={`pointer-events-none mt-0.5 font-mono text-[10px] ${
                    goalHit ? 'text-emerald-400' : 'text-slate-500'
                  }`}
                >
                  {goalHit ? '✓' : `→ ${goalVal}`}
                </div>
              )}
            </div>
          );
        })}

        {/* 常量卡片直接并入芯片阵 */}
        {hasConstants &&
          config.constantCards!.map((card) => (
            <button
              key={`${card.kind}-${card.label}`}
              type="button"
              draggable
              onDragStart={handleDragStart({ kind: 'const', card })}
              onClick={() => handleSelectOperand({ kind: 'const', card })}
              className="flex flex-col items-center justify-center rounded-xl border border-amber-500/50 bg-amber-500/10 px-3 py-2 font-mono transition hover:border-amber-400 hover:bg-amber-500/20"
            >
              <span className="font-sans text-[10px] font-bold text-amber-400">常量</span>
              <span className="mt-1 text-2xl font-bold text-amber-200">#{card.label}</span>
            </button>
          ))}
      </div>

      {/* 运算芯片台 */}
      {hasAlu && (
        <AluDesk
          config={config}
          regs={state.regs}
          left={left}
          right={right}
          op={op}
          destReg={destReg}
          activeSlot={activeSlot}
          copySrc={copySrc}
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
            setState((prev) => applyAluOperation(prev, config, left, op, right, destReg));
            setFlashNonce((n) => n + 1);
          }}
          onExecuteCopy={(target) => {
            if (!copySrc) return;
            setState((prev) => applyDirectCopy(prev, config, copySrc, target));
            setFlashNonce((n) => n + 1);
          }}
        />
      )}

      {/* PC 指令轨道 */}
      {hasPcTrack && (
        <PcTrackDesk
          config={config}
          caseIndex={state.caseIndex}
          pcIndex={state.pcIndex}
          halted={state.halted}
          regs={state.regs}
          onSwitchCase={(idx) => handleReset(idx)}
          onStep={(choice) => {
            setState((prev) => applyPcTrackStep(prev, config, choice));
            setFlashNonce((n) => n + 1);
          }}
        />
      )}

      {/* 仅在触发警告/防错时弹出简洁气泡，平时保持视觉纯净 */}
      {state.feedback?.tone === 'warn' && (
        <div className="rounded-xl border border-amber-500/60 bg-amber-950/40 px-3 py-2 text-xs text-amber-200">
          {state.feedback.message}
        </div>
      )}

      {/* 操作语义记录 + 同色指令语法骨架（不剧透答案，只建立「绿色存入在前、青色输入在后」的语序锚点） */}
      {config.recordToAsm !== false && (() => {
        const patterns = collectUsedSyntaxPatterns(state.recordings);
        const slotTone = (role: SyntaxSlot['role']) => {
          if (role === 'dest') {
            return 'border-emerald-500/50 bg-emerald-500/15 text-emerald-200';
          }
          if (role === 'const') {
            return 'border-amber-500/50 bg-amber-500/15 text-amber-200';
          }
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
                        <span key={`${p.op}-${slot.label}`} className="inline-flex items-center gap-1">
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
