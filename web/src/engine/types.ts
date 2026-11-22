/**
 * 前后端共享契约类型（camelCase），与 `crates/regzero-core/src/dto.rs` 严格对齐。
 */

export type Language = 'asm' | 'c';
export type LevelKind = 'lesson' | 'practice' | 'challenge';
export type PlaygroundWorkMode = 'online' | 'local-file' | 'local-project';

export interface GoalSummary {
  before: string;
  after: string;
}

export interface BriefingSlide {
  tag?: string;
  text: string;
}

export interface HintItem {
  level: number;
  type: 'diagram' | 'steps' | 'snippet' | string;
  content: string;
}

export interface ToolbarConfig {
  run: boolean;
  debug: boolean;
  submit: boolean;
  load: boolean;
  save: boolean;
}

export interface EditorConfig {
  level: string;
  language: Language;
  lineNumbers: boolean;
  readonlyPrefix: number;
  readonlySuffix: number;
  hidden: number[];
  highlight: number[];
  suggested: Record<string, string>;
  toolbar: ToolbarConfig;
}

/** 沙盘 1（manual-cpu）可插拔子模块标识。 */
export type ManualCpuModule =
  | 'regs'
  | 'constants'
  | 'alu'
  | 'memory'
  | 'pcTrack'
  | 'stack'
  | 'mmio';

export type ManualCpuAluOp = '+' | '-' | '×' | '÷' | '%';

export type ManualCpuGuard =
  | 'warnOverwriteLostValue'
  | 'requireBaseRegForMemory';

export interface ConstantCard {
  label: string;
  value: number;
  kind: 'immediate' | 'address';
}

export interface PcTrackSlotOption {
  label: string;
  op: 'nop' | 'j' | 'blt' | 'bge' | 'beq' | 'bne';
  a?: string;
  b?: string;
  target?: string;
  asm: string;
}

export interface PcTrackInstruction {
  label?: string;
  op: 'nop' | 'blt' | 'bge' | 'beq' | 'bne' | 'j' | 'mv' | 'add' | 'addi' | 'sub' | 'halt';
  a?: string;
  b?: string;
  dst?: string;
  src?: string;
  imm?: number;
  target?: string;
  asm: string;
  /** 若提供，则该行为玩家可点击修补的「修 Bug 槽位」。 */
  slotOptions?: PcTrackSlotOption[];
}

export interface PcTrackCase {
  label: string;
  initial: {
    regs: Record<string, number>;
    memory?: Record<string, number>;
  };
  goal: {
    regs?: Record<string, number>;
    memory?: Record<string, number>;
  };
}

export interface ManualCpuSandboxConfig {
  type: 'manual-cpu';
  /** 是否在首次未通关时先柔化聚焦左侧手动热身（仅建议用于 1-1 / 1-2 破冰关）。 */
  focusWarmupFirst?: boolean;
  modules: ManualCpuModule[];
  recordToAsm?: boolean;
  focusRegs: string[];
  regRoles?: Record<string, string>;
  constantCards?: ConstantCard[];
  aluOps?: ManualCpuAluOp[];
  allowCopy?: boolean;
  watchMemory?: string[];
  pcTrack?: {
    /** 示范修 Bug 小例程的简短说明（避免与本关主任务混淆）。 */
    demoSummary?: string;
    /** 运行结束但未达成目标时的排障提示（引导发现 Bug）。 */
    failHint?: string;
    /** 修好并达成目标时的顿悟提示。 */
    successHint?: string;
    cases?: PcTrackCase[];
    program: PcTrackInstruction[];
  };
  warmupPuzzle: {
    prompt: string;
    initial: {
      regs: Record<string, number>;
      memory?: Record<string, number>;
    };
    goal: {
      regs?: Record<string, number>;
      memory?: Record<string, number>;
    };
    guards?: ManualCpuGuard[];
  };
}

/** 未来第 2~7 章沙盘配置的开放联合类型（便于 SandboxRegistry 扩展）。 */
export interface PlaceholderSandboxConfig {
  type: 'memory-canvas' | 'lexer-ast-lab' | 'pipeline-stage';
  [key: string]: unknown;
}

export type SandboxConfig = ManualCpuSandboxConfig | PlaceholderSandboxConfig;

/** 单关独立的界面与 CPU 舞台可见性配置（零跨关继承，缺省项均为 false）。 */
export interface LevelUiConfig {
  immediatePort?: boolean;
  jumpRail?: boolean;
  memoryStage?: boolean;
  pipelineStages?: boolean;
  debugControls?: boolean;
  regXName?: boolean;
  allRegsToggle?: boolean;
  hexToggle?: boolean;
  binToggle?: boolean;
  pcAddress?: boolean;
  untrackedRegs?: boolean;
  ecallSuffix?: boolean;
}

export interface LevelMeta {
  id: string;
  chapter: number;
  order: number;
  kind: LevelKind;
  title: string;
  mode: string;
  allowLocalFile: boolean;
  language: Language;
  prerequisites: string[];
  parInstructions?: number;
  parSteps?: number;
  concepts: string[];
  ui?: LevelUiConfig;
  goalSummary: GoalSummary;
  briefing?: BriefingSlide[];
  sandbox: SandboxConfig;
  editor: EditorConfig;
  hints: HintItem[];
  wikiRefs: string[];
}

export interface LevelSummary {
  id: string;
  chapter: number;
  order: number;
  kind: LevelKind;
  title: string;
  language: Language;
  mode: string;
  allowLocalFile: boolean;
  prerequisites: string[];
  concepts: string[];
  parInstructions?: number;
  parSteps?: number;
  passed: boolean;
  unlocked: boolean;
  attempts: number;
  bestScore?: number;
  metPar?: boolean;
  bestSteps?: number;
}

export interface TestCasePreview {
  index: number;
  name: string;
  initialRegs: Record<string, number>;
  initialMemory: Record<string, string>;
  expectedRegs: Record<string, number>;
  expectedMemory: Record<string, string>;
}

export interface LevelPayload {
  id: string;
  meta: LevelMeta;
  lessonMarkdown: string;
  editor: EditorConfig;
  initialCode: string;
  availableOps: string[];
  forbiddenRegs: string[];
  testsPreview: TestCasePreview[];
  benchmarkCount: number;
  solution?: string;
}

export interface MachineSnapshot {
  pc: number;
  pcLine: number;
  regs: Record<string, number>;
  memoryWords: Record<string, number>;
  tick: number;
  instructions: number;
  output: string;
  exitCode?: number;
  pauseKind: string;
  pauseDetail: string;
  halted: boolean;
  canStep: boolean;
  canStepBack: boolean;
  generatedAssembly?: string;
}

export interface ExecutedOpDto {
  kind: 'alu' | 'copy' | 'branch' | 'jump' | 'load' | 'store' | 'halt' | 'other' | string;
  op: string;
  asmText?: string;
  pc?: number;
  symbol?: string;
  line: number;
  nextLine: number;
  rs1?: string;
  rs1Val?: number;
  rs2?: string;
  rs2Val?: number;
  imm?: number;
  rd?: string;
  rdOldVal?: number;
  rdNewVal?: number;
  memAddr?: number;
  memVal?: number;
  branchTaken?: boolean;
}

export interface StepPayload extends MachineSnapshot {
  regChanges: Record<string, number>;
  memChanges: Record<number, number>;
  executed?: ExecutedOpDto;
}

export interface DiffDto {
  what: string;
  expected: string;
  actual: string;
}

export interface FailureDto {
  caseIndex: number;
  pc: number;
  line: number;
  reason: string;
  reasonText: string;
  regs: Record<string, number>;
}

export interface TestVerdictDto {
  name: string;
  passed: boolean;
  steps: number;
  hidden?: boolean;
  isRandom?: boolean;
  detail: string;
  diffs: DiffDto[];
  actualOutput?: string;
  failure?: FailureDto;
}

export interface ErrorDto {
  line: number;
  message: string;
  kind: string;
}

export interface SubmitDto {
  level: string;
  passed: boolean;
  score: number;
  instructionCount?: number;
  parInstructions?: number;
  totalSteps: number;
  benchmarkCount: number;
  parSteps?: number;
  metPar: boolean;
  hiddenPassed: number;
  hiddenTotal: number;
  dynamicSeed?: number;
  summary: string;
  tests: TestVerdictDto[];
  errors: ErrorDto[];
  generatedAssembly?: string;
}

export interface WikiTableColumn {
  id: string;
  label: string;
  unlockAny: string[];
}

export interface WikiTableRow {
  id: string;
  unlockAny: string[];
  cells: Record<string, string>;
}

export type WikiSection =
  | {
      id: string;
      heading?: string;
      unlockAny: string[];
      kind: 'markdown';
      markdown: string;
    }
  | {
      id: string;
      heading?: string;
      unlockAny: string[];
      kind: 'table';
      columns: WikiTableColumn[];
      rows: WikiTableRow[];
    };

export interface WikiEntry {
  topic: string;
  title: string;
  order: number;
  unlockAny: string[];
  summary?: string;
  sections: WikiSection[];
}

export interface LevelProgressRecord {
  levelId: string;
  passed: boolean;
  completedAt?: string;
  attempts: number;
  bestScore?: number;
  metPar?: boolean;
  bestSteps?: number;
}

export interface UserProgress {
  version: number;
  lastModified: string;
  levels: Record<string, LevelProgressRecord>;
  settings: {
    showHints: boolean;
    freeExplore: boolean;
  };
}
