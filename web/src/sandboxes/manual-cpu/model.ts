import type {
  ConstantCard,
  ManualCpuAluOp,
  ManualCpuSandboxConfig,
} from '../../engine/types';

/** 沙盘中可作为左/右输入源的标识：寄存器名或常量卡值。 */
export type SourceOperand =
  | { kind: 'reg'; name: string }
  | { kind: 'const'; card: ConstantCard };

export type RecordedOpKind = 'add' | 'addi' | 'sub' | 'mv' | 'mul' | 'div' | 'rem' | 'li';

export interface SyntaxSlot {
  label: string;
  role: 'dest' | 'input' | 'const';
}

export interface SyntaxPattern {
  op: RecordedOpKind;
  slots: readonly SyntaxSlot[];
}

const SYNTAX_PATTERNS: Record<RecordedOpKind, SyntaxPattern> = {
  add: {
    op: 'add',
    slots: [
      { label: '存入', role: 'dest' },
      { label: '输入 1', role: 'input' },
      { label: '输入 2', role: 'input' },
    ],
  },
  addi: {
    op: 'addi',
    slots: [
      { label: '存入', role: 'dest' },
      { label: '输入', role: 'input' },
      { label: '常量', role: 'const' },
    ],
  },
  sub: {
    op: 'sub',
    slots: [
      { label: '存入', role: 'dest' },
      { label: '左输入', role: 'input' },
      { label: '右输入', role: 'input' },
    ],
  },
  mv: {
    op: 'mv',
    slots: [
      { label: '存入', role: 'dest' },
      { label: '来源', role: 'input' },
    ],
  },
  mul: {
    op: 'mul',
    slots: [
      { label: '存入', role: 'dest' },
      { label: '左输入', role: 'input' },
      { label: '右输入', role: 'input' },
    ],
  },
  div: {
    op: 'div',
    slots: [
      { label: '存入', role: 'dest' },
      { label: '左输入', role: 'input' },
      { label: '右输入', role: 'input' },
    ],
  },
  rem: {
    op: 'rem',
    slots: [
      { label: '存入', role: 'dest' },
      { label: '左输入', role: 'input' },
      { label: '右输入', role: 'input' },
    ],
  },
  li: {
    op: 'li',
    slots: [
      { label: '存入', role: 'dest' },
      { label: '常量', role: 'const' },
    ],
  },
};

export interface RecordedStep {
  asm: string;
  opKind?: RecordedOpKind;
  /** 不剧透具体指令答案的中文语义摘要（用于沙盘操作回显）。 */
  summary: string;
  explanation: string;
}

/** 按首次使用顺序收集玩家在沙盘中触发过的抽象指令格式（用于同色语法骨架展示）。 */
export function collectUsedSyntaxPatterns(recordings: readonly RecordedStep[]): SyntaxPattern[] {
  const seen = new Set<RecordedOpKind>();
  const out: SyntaxPattern[] = [];
  for (const step of recordings) {
    if (!step.opKind || seen.has(step.opKind)) continue;
    seen.add(step.opKind);
    out.push(SYNTAX_PATTERNS[step.opKind]);
  }
  return out;
}

export interface FeedbackBanner {
  tone: 'info' | 'warn' | 'success';
  message: string;
}

interface SnapshotFrame {
  regs: Record<string, number>;
  memory: Record<string, number>;
  pcIndex: number;
  halted: boolean;
  recordings: RecordedStep[];
}

export interface ManualCpuState {
  caseIndex: number;
  regs: Record<string, number>;
  memory: Record<string, number>;
  pcIndex: number;
  halted: boolean;
  recordings: RecordedStep[];
  undoStack: SnapshotFrame[];
  lastWrittenReg: string | null;
  lastWrittenMem: string | null;
  feedback: FeedbackBanner | null;
  completed: boolean;
}

/** 32 位有符号整数截断辅助（与 RV32IM 硬件一致）。 */
export function i32(v: number): number {
  return v | 0;
}

function getActiveCase(config: ManualCpuSandboxConfig, caseIndex: number) {
  const cases = config.pcTrack?.cases;
  if (cases && cases.length > 0) {
    const safe = cases[caseIndex] ?? cases[0]!;
    return {
      initialRegs: safe.initial.regs,
      initialMemory: safe.initial.memory ?? {},
      goalRegs: safe.goal.regs ?? {},
      goalMemory: safe.goal.memory ?? {},
    };
  }
  return {
    initialRegs: config.warmupPuzzle.initial.regs,
    initialMemory: config.warmupPuzzle.initial.memory ?? {},
    goalRegs: config.warmupPuzzle.goal.regs ?? {},
    goalMemory: config.warmupPuzzle.goal.memory ?? {},
  };
}

/** 根据关卡 `sandbox` 配置创建初始状态（纯函数，无关卡 ID 硬编码）。 */
export function createManualCpuState(
  config: ManualCpuSandboxConfig,
  caseIndex = 0,
): ManualCpuState {
  const active = getActiveCase(config, caseIndex);
  const regs: Record<string, number> = {};
  for (const name of config.focusRegs) {
    regs[name] = name === 'zero' ? 0 : i32(active.initialRegs[name] ?? 0);
  }
  for (const [k, v] of Object.entries(active.initialRegs)) {
    regs[k] = k === 'zero' ? 0 : i32(v);
  }
  const memory: Record<string, number> = {};
  for (const addr of config.watchMemory ?? []) {
    memory[addr] = i32(active.initialMemory[addr] ?? 0);
  }
  for (const [k, v] of Object.entries(active.initialMemory)) {
    memory[k] = i32(v);
  }

  return {
    caseIndex,
    regs,
    memory,
    pcIndex: 0,
    halted: false,
    recordings: [],
    undoStack: [],
    lastWrittenReg: null,
    lastWrittenMem: null,
    feedback: null,
    completed: false,
  };
}

export function isGoalMet(
  config: ManualCpuSandboxConfig,
  caseIndex: number,
  regs: Record<string, number>,
  memory: Record<string, number>,
  halted: boolean,
): boolean {
  const active = getActiveCase(config, caseIndex);
  if (config.modules.includes('pcTrack') && !halted) {
    return false;
  }
  for (const [reg, want] of Object.entries(active.goalRegs)) {
    if (i32(regs[reg] ?? 0) !== i32(want)) return false;
  }
  for (const [addr, want] of Object.entries(active.goalMemory)) {
    if (i32(memory[addr] ?? 0) !== i32(want)) return false;
  }
  return true;
}

export function pushUndo(state: ManualCpuState): SnapshotFrame[] {
  return [
    ...state.undoStack,
    {
      regs: { ...state.regs },
      memory: { ...state.memory },
      pcIndex: state.pcIndex,
      halted: state.halted,
      recordings: [...state.recordings],
    },
  ];
}

/** 守卫：检测是否覆盖了一个“目标里还需要、且其他寄存器没有备份”的值。 */
function checkOverwriteLostValue(
  config: ManualCpuSandboxConfig,
  caseIndex: number,
  prevRegs: Record<string, number>,
  nextRegs: Record<string, number>,
  targetReg: string,
): FeedbackBanner | null {
  if (!config.warmupPuzzle.guards?.includes('warnOverwriteLostValue')) return null;
  const oldVal = i32(prevRegs[targetReg] ?? 0);
  const newVal = i32(nextRegs[targetReg] ?? 0);
  if (oldVal === newVal) return null;

  const active = getActiveCase(config, caseIndex);
  const stillNeededElsewhere = Object.entries(active.goalRegs).some(
    ([reg, want]) => reg !== targetReg && i32(want) === oldVal,
  );
  if (!stillNeededElsewhere) return null;

  const stillExistsSomewhere = Object.values(nextRegs).some((v) => i32(v) === oldVal);
  if (stillExistsSomewhere) return null;

  return {
    tone: 'warn',
    message: `注意：${targetReg} 原来的 ${oldVal} 被覆盖掉了，且没有备份！点「撤销一步」，先借空闲暂存槽备份吧。`,
  };
}

/** 执行一次 ALU 运算并自动录制为真实 RISC-V 汇编指令。 */
export function applyAluOperation(
  state: ManualCpuState,
  config: ManualCpuSandboxConfig,
  left: SourceOperand,
  op: ManualCpuAluOp,
  right: SourceOperand,
  destReg: string,
): ManualCpuState {
  if (destReg === 'zero') {
    return {
      ...state,
      feedback: { tone: 'warn', message: 'zero (x0) 恒为 0，写入它不会改变数值，请换一个目标寄存器。' },
    };
  }

  // 常量运算规则：RISC-V 中 addi 允许「寄存器 + 常量」
  if (left.kind === 'const' && right.kind === 'const') {
    return {
      ...state,
      feedback: { tone: 'warn', message: '请至少选择一个寄存器作为输入，不要把两个常量卡直接相加。' },
    };
  }
  if ((left.kind === 'const' || right.kind === 'const') && op !== '+') {
    return {
      ...state,
      feedback: { tone: 'warn', message: '本运算中常量卡仅配合 +（addi）使用。' },
    };
  }

  const aVal = left.kind === 'reg' ? i32(state.regs[left.name] ?? 0) : i32(left.card.value);
  const bVal = right.kind === 'reg' ? i32(state.regs[right.name] ?? 0) : i32(right.card.value);

  if ((op === '÷' || op === '%') && bVal === 0) {
    return {
      ...state,
      feedback: { tone: 'warn', message: '除数不能为 0，请换一个非零寄存器。' },
    };
  }

  let result = 0;
  let asm = '';
  let opKind: RecordedOpKind = 'add';
  let summary = '';
  let explanation = '';

  if (left.kind === 'const' || right.kind === 'const') {
    const regSrc = left.kind === 'reg' ? left.name : (right as { kind: 'reg'; name: string }).name;
    const card = left.kind === 'const' ? left.card : (right as { kind: 'const'; card: ConstantCard }).card;
    const regVal = i32(state.regs[regSrc] ?? 0);
    result = i32(aVal + bVal);
    opKind = 'addi';
    asm = `addi ${destReg}, ${regSrc}, ${card.value}`;
    summary = `${regSrc}(${regVal}) + 常量(${card.value}) → 存入 ${destReg}(${result})`;
    explanation = `${destReg} = ${regSrc}(${regVal}) + ${card.value} = ${result}`;
  } else {
    switch (op) {
      case '+':
        result = i32(aVal + bVal);
        opKind = 'add';
        asm = `add ${destReg}, ${left.name}, ${right.name}`;
        break;
      case '-':
        result = i32(aVal - bVal);
        opKind = 'sub';
        asm = `sub ${destReg}, ${left.name}, ${right.name}`;
        break;
      case '×':
        result = Math.imul(aVal, bVal);
        opKind = 'mul';
        asm = `mul ${destReg}, ${left.name}, ${right.name}`;
        break;
      case '÷':
        result = i32(Math.trunc(aVal / bVal));
        opKind = 'div';
        asm = `div ${destReg}, ${left.name}, ${right.name}`;
        break;
      case '%':
        result = i32(aVal % bVal);
        opKind = 'rem';
        asm = `rem ${destReg}, ${left.name}, ${right.name}`;
        break;
    }
    summary = `${left.name}(${aVal}) ${op} ${right.name}(${bVal}) → 存入 ${destReg}(${result})`;
    explanation = `${destReg} = ${aVal} ${op} ${bVal} = ${result}`;
  }

  const nextRegs = { ...state.regs, [destReg]: result };
  const warn = checkOverwriteLostValue(config, state.caseIndex, state.regs, nextRegs, destReg);
  const completed = isGoalMet(config, state.caseIndex, nextRegs, state.memory, state.halted);

  return {
    ...state,
    regs: nextRegs,
    recordings: [...state.recordings, { asm, opKind, summary, explanation }],
    undoStack: pushUndo(state),
    lastWrittenReg: destReg,
    lastWrittenMem: null,
    completed,
    feedback: completed
      ? { tone: 'success', message: '试算达成目标！现在可以去右侧写出对应的指令了。' }
      : warn ?? { tone: 'info', message: summary },
  };
}

/** 执行寄存器间直接搬运（`mv`）或把常量卡装入寄存器（`li` / `addi`）。 */
export function applyDirectCopy(
  state: ManualCpuState,
  config: ManualCpuSandboxConfig,
  source: SourceOperand,
  destReg: string,
): ManualCpuState {
  if (destReg === 'zero') {
    return {
      ...state,
      feedback: { tone: 'warn', message: 'zero (x0) 恒为 0，无法写入。' },
    };
  }
  if (source.kind === 'reg' && source.name === destReg) {
    return state;
  }

  const nextVal =
    source.kind === 'reg' ? i32(state.regs[source.name] ?? 0) : i32(source.card.value);
  const opKind: RecordedOpKind =
    source.kind === 'reg' ? 'mv' : source.card.kind === 'address' ? 'li' : 'addi';
  const asm =
    source.kind === 'reg'
      ? `mv ${destReg}, ${source.name}`
      : source.card.kind === 'address'
        ? `li ${destReg}, ${source.card.label}`
        : `addi ${destReg}, zero, ${source.card.value}`;
  const summary =
    source.kind === 'reg'
      ? `复制 ${source.name}(${nextVal}) → 存入 ${destReg}(${nextVal})`
      : `装入常量(${source.card.label}) → 存入 ${destReg}(${nextVal})`;
  const explanation = summary;

  const nextRegs = { ...state.regs, [destReg]: nextVal };
  const warn = checkOverwriteLostValue(config, state.caseIndex, state.regs, nextRegs, destReg);
  const completed = isGoalMet(config, state.caseIndex, nextRegs, state.memory, state.halted);

  return {
    ...state,
    regs: nextRegs,
    recordings: [...state.recordings, { asm, opKind, summary, explanation }],
    undoStack: pushUndo(state),
    lastWrittenReg: destReg,
    lastWrittenMem: null,
    completed,
    feedback: completed
      ? { tone: 'success', message: '试算达成目标！现在可以去右侧写出对应的指令了。' }
      : warn ?? { tone: 'info', message: summary },
  };
}

/** 撤销最近一步手工操作。 */
export function undoManualCpu(state: ManualCpuState): ManualCpuState {
  if (state.undoStack.length === 0) return state;
  const prev = state.undoStack[state.undoStack.length - 1]!;
  return {
    ...state,
    regs: prev.regs,
    memory: prev.memory,
    pcIndex: prev.pcIndex,
    halted: prev.halted,
    recordings: prev.recordings,
    undoStack: state.undoStack.slice(0, -1),
    lastWrittenReg: null,
    lastWrittenMem: null,
    completed: false,
    feedback: { tone: 'info', message: '已撤销上一步操作。' },
  };
}
