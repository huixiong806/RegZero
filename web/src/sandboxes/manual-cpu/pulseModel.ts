/**
 * 统一微缩 CPU 5 阶段数据通路动画事件模型（纯函数，零 React 依赖）。
 *
 * 手动拖拽执行 与 代码单步/自动播放 共享同一套 `CpuPulseEvent`，
 * 让左右界面在视觉语言与 5 阶段动效上 100% 同构。
 */

import { RV32_REGISTERS, toSigned32 } from '../../domain/registers';
import type { ExecutedOpDto, ManualCpuAluOp } from '../../engine/types';
import type { PlaybackSpeed } from './datapathTimeline';
import type { SourceOperand } from './model';

export type PulseSource =
  | { kind: 'reg'; name: string; value: number }
  | { kind: 'const'; label: string; value: number };

export interface CpuPulseEvent {
  nonce: number;
  kind: 'alu' | 'copy' | 'branch' | 'jump' | 'load' | 'store' | 'halt' | 'other';
  op: string;
  asmText?: string;
  pc?: number;
  symbol?: string;
  leftSource?: PulseSource;
  rightSource?: PulseSource;
  /** 存内存指令（sw/sb）绕过 ALU 直接送往访存单元的写入源寄存器与数值 */
  storeDataSource?: { name: string; value: number };
  destReg?: string;
  oldDestVal?: number;
  newDestVal?: number;
  memAddr?: number;
  memVal?: number;
  branchTaken?: boolean;
  line?: number;
  nextLine?: number;
}

export interface LiveCpuPlayback {
  active: boolean;
  playing: boolean;
  speed: PlaybackSpeed;
  caseLabel?: string;
  /** 按 ABI 名称索引的实时寄存器值（如 `t0`, `t1`, `t2`, `zero`）。 */
  regs: Record<string, number>;
  /** 本测例期望的最终寄存器值（可选，用于在舞台上点亮达标反馈）。 */
  goalRegs?: Record<string, number>;
  pulse: CpuPulseEvent | null;
  /** 当前真实字节地址 PC（用于 `pcAddress` 开启后展示 `0x0000`、`0x0004` 等指令地址）。 */
  pc?: number;
  pcLine: number;
  tick: number;
  halted: boolean;
}

/** 将模拟器快照中的 `xN` 寄存器表归一为前端直观 ABI 名称表（有符号 32 位整数）。 */
export function mapSimRegsToAbi(simRegs: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const reg of RV32_REGISTERS) {
    const raw = simRegs[reg.xName] ?? simRegs[reg.abi] ?? 0;
    out[reg.abi] = toSigned32(raw);
  }
  return out;
}

/** 将后端 `ExecutedOpDto` 转换为前端 5 阶段电路脉冲事件。 */
export function executedOpToPulse(dto: ExecutedOpDto, nonce: number): CpuPulseEvent {
  const leftSource: PulseSource | undefined =
    dto.rs1 !== undefined
      ? { kind: 'reg', name: dto.rs1, value: dto.rs1Val ?? 0 }
      : undefined;

  let rightSource: PulseSource | undefined;
  if (dto.kind === 'store' && dto.imm !== undefined) {
    // 存内存指令在执行阶段由 ALU 计算「基址 rs1 + 偏移 imm」，rs2 是送往访存单元的写入值
    rightSource = { kind: 'const', label: String(dto.imm), value: dto.imm };
  } else if (dto.rs2 !== undefined) {
    rightSource = { kind: 'reg', name: dto.rs2, value: dto.rs2Val ?? 0 };
  } else if (dto.imm !== undefined) {
    rightSource = { kind: 'const', label: String(dto.imm), value: dto.imm };
  }

  const kind: CpuPulseEvent['kind'] =
    dto.kind === 'alu' ||
    dto.kind === 'copy' ||
    dto.kind === 'branch' ||
    dto.kind === 'jump' ||
    dto.kind === 'load' ||
    dto.kind === 'store' ||
    dto.kind === 'halt'
      ? dto.kind
      : 'other';

  const storeDataSource =
    dto.kind === 'store' && dto.rs2 !== undefined
      ? { name: dto.rs2, value: dto.rs2Val ?? dto.memVal ?? 0 }
      : undefined;

  return {
    nonce,
    kind,
    op: dto.op,
    asmText: dto.asmText,
    pc: dto.pc,
    symbol: dto.symbol,
    leftSource,
    rightSource,
    storeDataSource,
    destReg: dto.rd,
    oldDestVal: dto.rdOldVal,
    newDestVal: dto.rdNewVal,
    memAddr: dto.memAddr,
    memVal: dto.memVal,
    branchTaken: dto.branchTaken,
    line: dto.line,
    nextLine: dto.nextLine,
  };
}

/** 将手动沙盘的一次运算转为同一套 5 阶段脉冲事件（走 译码 → 执行 → 访存直通 → 写回）。 */
export function manualAluToPulse(
  left: SourceOperand,
  op: ManualCpuAluOp,
  right: SourceOperand,
  destReg: string,
  prevRegs: Record<string, number>,
  nextRegs: Record<string, number>,
  nonce: number,
): CpuPulseEvent {
  const toSource = (operand: SourceOperand): PulseSource =>
    operand.kind === 'reg'
      ? { kind: 'reg', name: operand.name, value: prevRegs[operand.name] ?? 0 }
      : { kind: 'const', label: operand.card.label, value: operand.card.value };

  const isConst = left.kind === 'const' || right.kind === 'const';
  return {
    nonce,
    kind: 'alu',
    op: isConst ? 'addi' : op,
    symbol: op,
    leftSource: toSource(left),
    rightSource: toSource(right),
    destReg,
    oldDestVal: prevRegs[destReg] ?? 0,
    newDestVal: nextRegs[destReg] ?? 0,
  };
}
