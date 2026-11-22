/**
 * 渐进式信息披露（Progressive Disclosure）领域层。
 *
 * 严格零 React 依赖、零关卡 ID 硬编码：
 * 一切 Wiki 段落解锁与底层 UI 细节（如 x5/x6/x7、sp、ALL 32、HEX）均由
 * 关卡元数据声明的 `concepts[]` 与玩家进度共同派生。
 */

import type {
  LevelSummary,
  LevelUiConfig,
  UserProgress,
  WikiEntry,
  WikiSection,
  WikiTableColumn,
  WikiTableRow,
} from '../engine/types';

/** 控制界面与 CPU 舞台可见性的统一结构（单关由 `meta.ui` 独立配置，自由沙盒使用全量配置）。 */
export interface UiDisclosure {
  /** 是否在寄存器卡片右上角展示底层硬件编号（如 x5、x6、x7）。 */
  showRegXName: boolean;
  /** 是否展示「32 格 / ALL 32」全部寄存器展开切换按钮。 */
  showAllRegsToggle: boolean;
  /** 是否展示「DEC / HEX」十六进制切换按钮。 */
  showHexToggle: boolean;
  /** 是否展示「DEC / U32 / HEX / BIN」无符号与二进制视图切换。 */
  showBinToggle: boolean;
  /** 是否在顶部 PC 栏展示真实 16 进制字节地址（如 0x0004 · 第 2 行）。 */
  showPcAddress: boolean;
  /**
   * 是否自动把“未在 focusRegs 里但非零”的寄存器（如模拟器默认初始化的 sp=0xF000）
   * 展示在寄存器面板中。
   */
  showUntrackedNonZeroRegs: boolean;
  /** 是否在编辑器中展示只读收尾的 `ecall` 行（为 false 时自动隐藏，提交时无损拼回）。 */
  showEcallSuffix: boolean;
  /** 是否展示「试运行」「单步调试」与测例选择器。 */
  showDebugControls: boolean;
  /** 是否展示右侧「立即数」端口与 Y 型汇流总线。 */
  showImmediatePort: boolean;
  /** 是否展示右侧「跳转 / 循环 PC 回流轨」。 */
  showJumpRail: boolean;
  /** 是否允许展示「内存监视器」与「访存」阶段模块。 */
  showMemoryPanel: boolean;
  /** 是否展示顶部 5 阶段微架构状态灯带与阶段术语（取指/译码/执行/访存/写回）。 */
  showPipelineStages: boolean;
}

/** 独立自由沙盒使用的全量披露配置。 */
export const FULL_UI_DISCLOSURE: UiDisclosure = {
  showRegXName: true,
  showAllRegsToggle: true,
  showHexToggle: true,
  showBinToggle: true,
  showPcAddress: true,
  showUntrackedNonZeroRegs: true,
  showEcallSuffix: true,
  showDebugControls: true,
  showImmediatePort: true,
  showJumpRail: true,
  showMemoryPanel: true,
  showPipelineStages: true,
};

/**
 * 将单关 `meta.json` 中的独立 `ui` 配置解析为 `UiDisclosure`。
 * 严格零跨关继承：缺省项一律为 `false`，方便单独微调任意关卡或由玩家自定义关卡。
 */
export function resolveLevelUiDisclosure(ui?: LevelUiConfig): UiDisclosure {
  return {
    showRegXName: Boolean(ui?.regXName),
    showAllRegsToggle: Boolean(ui?.allRegsToggle),
    showHexToggle: Boolean(ui?.hexToggle),
    showBinToggle: Boolean(ui?.binToggle),
    showPcAddress: Boolean(ui?.pcAddress),
    showUntrackedNonZeroRegs: Boolean(ui?.untrackedRegs),
    showEcallSuffix: Boolean(ui?.ecallSuffix),
    showDebugControls: Boolean(ui?.debugControls),
    showImmediatePort: Boolean(ui?.immediatePort),
    showJumpRail: Boolean(ui?.jumpRail),
    showMemoryPanel: Boolean(ui?.memoryStage),
    showPipelineStages: Boolean(ui?.pipelineStages),
  };
}

/** 由玩家进度与关卡树派生出的统一知识状态。 */
export interface KnowledgeState {
  /** 开启「自由探索」或自由沙盒时为 true，全部图鉴与硬件细节立即可见。 */
  revealAll: boolean;
  /** 当前已解锁/已接触的全部概念标签集合。 */
  knownConcepts: ReadonlySet<string>;
  /** 派生出的界面细节披露开关。 */
  ui: UiDisclosure;
}

export interface FilteredWikiTableRow extends WikiTableRow {
  isNew: boolean;
}

export type FilteredWikiSection =
  | {
      id: string;
      heading?: string;
      kind: 'markdown';
      markdown: string;
      isNew: boolean;
    }
  | {
      id: string;
      heading?: string;
      kind: 'table';
      columns: WikiTableColumn[];
      rows: FilteredWikiTableRow[];
      isNew: boolean;
    };

export interface FilteredWikiEntry {
  topic: string;
  title: string;
  order: number;
  summary?: string;
  sections: FilteredWikiSection[];
}

/** 根据「自由探索」与已解锁概念集合派生 UI 细节披露策略。 */
export function deriveUiDisclosure(
  knownConcepts: ReadonlySet<string>,
  revealAll: boolean,
): UiDisclosure {
  if (revealAll) return FULL_UI_DISCLOSURE;
  return {
    showRegXName: knownConcepts.has('reg-hardware-id'),
    showAllRegsToggle: knownConcepts.has('reg-hardware-id') || knownConcepts.has('all-registers'),
    showHexToggle:
      knownConcepts.has('hex') || knownConcepts.has('memory-address') || knownConcepts.has('stack'),
    showBinToggle: knownConcepts.has('binary') || knownConcepts.has('twos-complement') || knownConcepts.has('bitwise'),
    showPcAddress: knownConcepts.has('program-as-data') || knownConcepts.has('jal'),
    showUntrackedNonZeroRegs: knownConcepts.has('stack') || knownConcepts.has('all-registers'),
    showEcallSuffix: knownConcepts.has('ecall') || knownConcepts.has('syscall'),
    showDebugControls:
      knownConcepts.has('debugger') ||
      knownConcepts.has('composition') ||
      knownConcepts.has('pc') ||
      knownConcepts.has('loop'),
    showImmediatePort: knownConcepts.has('immediate') || knownConcepts.has('addi'),
    showJumpRail:
      knownConcepts.has('pc') ||
      knownConcepts.has('blt') ||
      knownConcepts.has('bge') ||
      knownConcepts.has('j') ||
      knownConcepts.has('loop'),
    showMemoryPanel:
      knownConcepts.has('memory') ||
      knownConcepts.has('memory-address') ||
      knownConcepts.has('stack'),
    showPipelineStages: knownConcepts.has('cpu-stages'),
  };
}

/**
 * 汇总玩家当前已掌握/已解锁的概念集合与图鉴披露状态。
 *
 * 规则：
 * - 所有已通关或已解锁关卡的 `concepts` 都会进入 `knownConcepts`（确保图鉴单调增长、绝不倒退）；
 * - 若传入 `activeLevelId`（例如玩家通过链接直达某关），也会并入该关的 `concepts`；
 * - 单关界面与 CPU 舞台可见性请直接用 `resolveLevelUiDisclosure(level.meta.ui)`，不再跨关继承；
 * - 开启「自由探索」时 `revealAll = true`，开放全部图鉴。
 */
export function buildKnowledgeState(
  levels: readonly LevelSummary[],
  progress: UserProgress,
  activeLevelId?: string,
): KnowledgeState {
  const revealAll = Boolean(progress.settings.freeExplore);
  const known = new Set<string>();

  for (const lvl of levels) {
    const isCurrent = activeLevelId !== undefined && lvl.id === activeLevelId;
    if (revealAll || lvl.passed || lvl.unlocked || isCurrent) {
      for (const c of lvl.concepts) {
        known.add(c);
      }
    }
  }

  return {
    revealAll,
    knownConcepts: known,
    ui: deriveUiDisclosure(known, revealAll),
  };
}

/** 计算某一关卡相对于其所有前置祖先新引入的概念（用于在图鉴中轻柔标注「本关新增」）。 */
export function getLevelNewConcepts(
  levels: readonly LevelSummary[],
  levelId: string,
): ReadonlySet<string> {
  const byId = new Map(levels.map((l) => [l.id, l]));
  const target = byId.get(levelId);
  if (!target) return new Set();

  const ancestorConcepts = new Set<string>();
  const visited = new Set<string>();
  const stack = [...target.prerequisites];

  while (stack.length > 0) {
    const id = stack.pop()!;
    if (visited.has(id)) continue;
    visited.add(id);
    const node = byId.get(id);
    if (!node) continue;
    for (const c of node.concepts) ancestorConcepts.add(c);
    for (const pre of node.prerequisites) stack.push(pre);
  }

  const fresh = new Set<string>();
  for (const c of target.concepts) {
    if (!ancestorConcepts.has(c)) fresh.add(c);
  }
  return fresh;
}

function matchesUnlockAny(unlockAny: readonly string[], known: ReadonlySet<string>): boolean {
  if (unlockAny.length === 0) return true;
  return unlockAny.some((concept) => known.has(concept));
}

function isFreshByConcepts(
  unlockAny: readonly string[],
  highlight?: ReadonlySet<string>,
): boolean {
  if (!highlight || highlight.size === 0 || unlockAny.length === 0) return false;
  return unlockAny.some((concept) => highlight.has(concept));
}

function filterSection(
  section: WikiSection,
  knowledge: KnowledgeState,
  highlight?: ReadonlySet<string>,
): FilteredWikiSection | null {
  if (!knowledge.revealAll && !matchesUnlockAny(section.unlockAny, knowledge.knownConcepts)) {
    return null;
  }

  if (section.kind === 'markdown') {
    return {
      id: section.id,
      heading: section.heading,
      kind: 'markdown',
      markdown: section.markdown,
      isNew: !knowledge.revealAll && isFreshByConcepts(section.unlockAny, highlight),
    };
  }

  const columns = knowledge.revealAll
    ? section.columns
    : section.columns.filter((col) => matchesUnlockAny(col.unlockAny, knowledge.knownConcepts));
  const rows: FilteredWikiTableRow[] = (
    knowledge.revealAll
      ? section.rows
      : section.rows.filter((row) => matchesUnlockAny(row.unlockAny, knowledge.knownConcepts))
  ).map((row) => ({
    ...row,
    isNew: !knowledge.revealAll && isFreshByConcepts(row.unlockAny, highlight),
  }));

  if (columns.length === 0 || rows.length === 0) return null;

  return {
    id: section.id,
    heading: section.heading,
    kind: 'table',
    columns,
    rows,
    isNew:
      !knowledge.revealAll &&
      (isFreshByConcepts(section.unlockAny, highlight) || rows.some((r) => r.isNew)),
  };
}

/** 按当前知识进度过滤单篇词条；未解锁或无可见分段时返回 `null`（完全隐藏）。 */
export function filterWikiEntry(
  entry: WikiEntry,
  knowledge: KnowledgeState,
  highlightConcepts?: ReadonlySet<string>,
): FilteredWikiEntry | null {
  if (!knowledge.revealAll && !matchesUnlockAny(entry.unlockAny, knowledge.knownConcepts)) {
    return null;
  }

  const sections: FilteredWikiSection[] = [];
  for (const sec of entry.sections) {
    const filtered = filterSection(sec, knowledge, highlightConcepts);
    if (filtered) sections.push(filtered);
  }
  if (sections.length === 0) return null;

  return {
    topic: entry.topic,
    title: entry.title,
    order: entry.order,
    summary: entry.summary,
    sections,
  };
}

/** 按当前知识进度过滤全部词条并保持原顺序，未解锁词条完全隐藏。 */
export function filterWikiEntries(
  entries: readonly WikiEntry[],
  knowledge: KnowledgeState,
  highlightConcepts?: ReadonlySet<string>,
): FilteredWikiEntry[] {
  const out: FilteredWikiEntry[] = [];
  for (const entry of entries) {
    const filtered = filterWikiEntry(entry, knowledge, highlightConcepts);
    if (filtered) out.push(filtered);
  }
  return out;
}
