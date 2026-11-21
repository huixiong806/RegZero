/**
 * 编辑器行级只读前后缀保护的纯计算逻辑（供 CodeMirror 6 事务过滤器与单测共享）。
 */

export interface ReadonlyBounds {
  /** 前 N 行只读（1-based 行号 `1..=readonlyPrefix`） */
  readonlyPrefix: number;
  /** 后 N 行只读（最后 `readonlySuffix` 行） */
  readonlySuffix: number;
}

/**
 * 判断一次对 `lineCount` 行文档的区间修改 `[fromLine, toLine]`（1-based 闭区间）是否越界触碰了只读前后缀。
 */
export function touchesReadonlyLines(
  lineCount: number,
  fromLine: number,
  toLine: number,
  bounds: ReadonlyBounds,
): boolean {
  if (lineCount <= 0) return false;
  const prefix = Math.max(0, bounds.readonlyPrefix);
  const suffix = Math.max(0, bounds.readonlySuffix);
  if (prefix === 0 && suffix === 0) return false;

  const firstEditable = prefix + 1;
  const lastEditable = lineCount - suffix;
  if (firstEditable > lastEditable) return true;

  return fromLine < firstEditable || toLine > lastEditable;
}

/**
 * 计算当前文档中所有只读行号集合（1-based）。
 */
export function getReadonlyLineSet(lineCount: number, bounds: ReadonlyBounds): Set<number> {
  const set = new Set<number>();
  for (let i = 1; i <= Math.min(bounds.readonlyPrefix, lineCount); i++) {
    set.add(i);
  }
  for (let i = 0; i < Math.min(bounds.readonlySuffix, lineCount); i++) {
    set.add(lineCount - i);
  }
  return set;
}

export interface HiddenSuffixSplit {
  visibleCode: string;
  hiddenSuffix: string;
  visibleReadonlySuffix: number;
}

/**
 * 在尚未教授 `ecall` 前，剥离末尾只读收尾行（保持前方行号 1:1 不变），
 * 供编辑器纯净展示；保存草稿、运行与提交时再无损拼回完整源码。
 */
export function splitHiddenReadonlySuffix(
  fullCode: string,
  readonlySuffix: number,
  hideSuffix: boolean,
): HiddenSuffixSplit {
  if (!hideSuffix || readonlySuffix <= 0) {
    return { visibleCode: fullCode, hiddenSuffix: '', visibleReadonlySuffix: readonlySuffix };
  }
  const lines = fullCode.split('\n');
  if (lines.length <= readonlySuffix) {
    return { visibleCode: fullCode, hiddenSuffix: '', visibleReadonlySuffix: readonlySuffix };
  }
  return {
    visibleCode: lines.slice(0, lines.length - readonlySuffix).join('\n'),
    hiddenSuffix: lines.slice(lines.length - readonlySuffix).join('\n'),
    visibleReadonlySuffix: 0,
  };
}

/** 将编辑后的可见代码与隐藏后缀无损拼回完整源码。 */
export function joinHiddenSuffix(visibleCode: string, hiddenSuffix: string): string {
  if (!hiddenSuffix) return visibleCode;
  return `${visibleCode}\n${hiddenSuffix}`;
}
