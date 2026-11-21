import { useEffect, useImperativeHandle, useRef, forwardRef } from 'react';
import { HighlightStyle, StreamLanguage, syntaxHighlighting } from '@codemirror/language';
import { Compartment, EditorState, RangeSetBuilder } from '@codemirror/state';
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  keymap,
  lineNumbers,
  highlightActiveLine,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view';
import { tags } from '@lezer/highlight';
import { getReadonlyLineSet, touchesReadonlyLines } from '../../domain/editorConstraints';
import type { Language } from '../../engine/types';

export interface CodeEditorHandle {
  focusEditableLine: () => void;
}

export interface CodeEditorProps {
  value: string;
  onChange: (next: string) => void;
  language: Language;
  readonlyPrefix?: number;
  readonlySuffix?: number;
  highlightLines?: number[];
  suggested?: Record<string, string>;
  pcLine?: number;
  errorLines?: number[];
}

const ASM_KEYWORDS = new Set([
  'add', 'addi', 'sub', 'mul', 'div', 'divu', 'rem', 'remu',
  'and', 'andi', 'or', 'ori', 'xor', 'xori', 'sll', 'slli', 'srl', 'srli', 'sra', 'srai',
  'slt', 'slti', 'sltu', 'sltiu', 'lui', 'auipc',
  'lb', 'lh', 'lw', 'lbu', 'lhu', 'sb', 'sh', 'sw',
  'beq', 'bne', 'blt', 'bge', 'bltu', 'bgeu', 'beqz', 'bnez', 'blez', 'bgez', 'bltz', 'bgtz',
  'bgt', 'ble', 'bgtu', 'bleu', 'jal', 'jalr', 'j', 'jr', 'ret', 'call',
  'li', 'la', 'mv', 'not', 'neg', 'nop', 'seqz', 'snez', 'ecall', 'ebreak', 'fence', 'slp',
]);

const C_KEYWORDS = new Set([
  'int', 'char', 'void', 'struct', 'return', 'if', 'else', 'while', 'for', 'do', 'break', 'continue', 'sizeof',
]);

const REG_PATTERN = /^(zero|ra|sp|gp|tp|fp|t[0-6]|s(?:1[01]|[0-9])|a[0-7]|x(?:3[01]|[12]?[0-9]))\b/;

function makeLanguageExtension(lang: Language) {
  return StreamLanguage.define({
    token(stream) {
      if (stream.eatSpace()) return null;
      if (lang === 'asm' && stream.match('#')) {
        stream.skipToEnd();
        return 'comment';
      }
      if (lang === 'c' && stream.match('//')) {
        stream.skipToEnd();
        return 'comment';
      }
      if (stream.match(/^0x[0-9a-fA-F]+/) || stream.match(/^-?\d+/)) {
        return 'number';
      }
      if (lang === 'asm' && stream.match(/^[a-zA-Z_][a-zA-Z0-9_]*:/)) {
        return 'labelName';
      }
      if (lang === 'asm' && stream.match(REG_PATTERN)) {
        return 'variableName';
      }
      if (stream.match(/^[a-zA-Z_][a-zA-Z0-9_]*/)) {
        const word = stream.current();
        if (lang === 'asm' && ASM_KEYWORDS.has(word.toLowerCase())) return 'keyword';
        if (lang === 'c' && C_KEYWORDS.has(word)) return 'keyword';
        return 'name';
      }
      stream.next();
      return null;
    },
  });
}

const darkHighlight = HighlightStyle.define([
  { tag: tags.keyword, color: '#38bdf8', fontWeight: '600' },
  { tag: tags.variableName, color: '#fbbf24' },
  { tag: tags.number, color: '#a78bfa' },
  { tag: tags.labelName, color: '#34d399', fontWeight: '700' },
  { tag: tags.comment, color: '#64748b', fontStyle: 'italic' },
]);

class GhostHintWidget extends WidgetType {
  private readonly text: string;
  private readonly prefix: string;
  constructor(text: string, language: Language) {
    super();
    this.text = text;
    this.prefix = language === 'asm' ? '  # 示例：' : '  // 示例：';
  }
  toDOM(): HTMLElement {
    const span = document.createElement('span');
    span.textContent = `${this.prefix}${this.text}`;
    span.className = 'pointer-events-none select-none text-slate-600 italic';
    return span;
  }
}

function buildLineDecorations(
  view: EditorView,
  opts: {
    language: Language;
    readonlyPrefix: number;
    readonlySuffix: number;
    highlightLines: number[];
    suggested: Record<string, string>;
    pcLine: number;
    errorLines: number[];
  },
): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const doc = view.state.doc;
  const total = doc.lines;
  const readonlySet = getReadonlyLineSet(total, {
    readonlyPrefix: opts.readonlyPrefix,
    readonlySuffix: opts.readonlySuffix,
  });
  const highlightSet = new Set(opts.highlightLines);
  const errorSet = new Set(opts.errorLines);

  for (let lineNo = 1; lineNo <= total; lineNo++) {
    const line = doc.line(lineNo);
    const classes: string[] = [];
    if (readonlySet.has(lineNo)) classes.push('cm-line-readonly');
    if (highlightSet.has(lineNo)) classes.push('cm-line-highlight');
    if (errorSet.has(lineNo)) classes.push('cm-line-error');
    if (opts.pcLine > 0 && lineNo === opts.pcLine) classes.push('cm-line-pc');
    if (classes.length > 0) {
      builder.add(line.from, line.from, Decoration.line({ class: classes.join(' ') }));
    }
    const hint = opts.suggested[String(lineNo)];
    if (hint && line.text.trim() === '') {
      builder.add(
        line.to,
        line.to,
        Decoration.widget({ widget: new GhostHintWidget(hint, opts.language), side: 1 }),
      );
    }
  }
  return builder.finish();
}

export const CodeEditor = forwardRef<CodeEditorHandle, CodeEditorProps>(function CodeEditor(
  {
    value,
    onChange,
    language,
    readonlyPrefix = 0,
    readonlySuffix = 0,
    highlightLines = [],
    suggested = {},
    pcLine = 0,
    errorLines = [],
  },
  ref,
) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const langCompartment = useRef(new Compartment());
  const decorCompartment = useRef(new Compartment());
  const filterCompartment = useRef(new Compartment());

  useImperativeHandle(ref, () => ({
    focusEditableLine: () => {
      const view = viewRef.current;
      if (!view) return;
      const targetLineNo = Math.min(view.state.doc.lines, readonlyPrefix + 1);
      const line = view.state.doc.line(Math.max(1, targetLineNo));
      view.dispatch({ selection: { anchor: line.to } });
      view.focus();
    },
  }));

  // 初始化 CodeMirror 6 实例
  useEffect(() => {
    if (!hostRef.current) return;
    const state = EditorState.create({
      doc: value,
      extensions: [
        lineNumbers(),
        highlightActiveLine(),
        syntaxHighlighting(darkHighlight),
        keymap.of([
          {
            key: 'Tab',
            run: (view) => {
              view.dispatch(view.state.replaceSelection('  '));
              return true;
            },
          },
        ]),
        EditorView.theme({
          '&': { height: '100%' },
          '.cm-scroller': { overflow: 'auto' },
          '.cm-content': { caretColor: '#22d3ee', padding: '10px 0' },
          '.cm-cursor': { borderLeftColor: '#22d3ee', borderLeftWidth: '2px' },
        }),
        langCompartment.current.of(makeLanguageExtension(language)),
        filterCompartment.current.of([]),
        decorCompartment.current.of([]),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            onChangeRef.current(update.state.doc.toString());
          }
        }),
      ],
    });
    const view = new EditorView({ state, parent: hostRef.current });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // 仅挂载时创建一次实例，后续通过 Compartment 与外部同步更新
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 同步外部代码（切换关卡或重置草稿）
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current !== value) {
      view.dispatch({
        changes: { from: 0, to: current.length, insert: value },
      });
    }
  }, [value]);

  // 同步语言高亮
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: langCompartment.current.reconfigure(makeLanguageExtension(language)),
    });
  }, [language]);

  // 同步只读前后缀事务拦截器 + 行装饰
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;

    const filterExt = EditorState.transactionFilter.of((tr) => {
      if (!tr.docChanged) return tr;
      // 外部整篇替换（切换关卡/重置代码）放行
      let touchesLocked = false;
      const oldDoc = tr.startState.doc;
      tr.changes.iterChangedRanges((fromA, toA) => {
        if (fromA === 0 && toA === oldDoc.length) return;
        const fromLine = oldDoc.lineAt(fromA).number;
        const toLine = oldDoc.lineAt(toA).number;
        if (touchesReadonlyLines(oldDoc.lines, fromLine, toLine, { readonlyPrefix, readonlySuffix })) {
          touchesLocked = true;
        }
      });
      return touchesLocked ? [] : tr;
    });

    const decorPlugin = ViewPlugin.fromClass(
      class {
        decorations: DecorationSet;
        constructor(v: EditorView) {
          this.decorations = buildLineDecorations(v, {
            language,
            readonlyPrefix,
            readonlySuffix,
            highlightLines,
            suggested,
            pcLine,
            errorLines,
          });
        }
        update(u: ViewUpdate) {
          if (u.docChanged || u.viewportChanged) {
            this.decorations = buildLineDecorations(u.view, {
              language,
              readonlyPrefix,
              readonlySuffix,
              highlightLines,
              suggested,
              pcLine,
              errorLines,
            });
          }
        }
      },
      { decorations: (v) => v.decorations },
    );

    view.dispatch({
      effects: [
        filterCompartment.current.reconfigure(filterExt),
        decorCompartment.current.reconfigure(decorPlugin),
      ],
    });
  }, [language, readonlyPrefix, readonlySuffix, highlightLines, suggested, pcLine, errorLines]);

  return (
    <div
      ref={hostRef}
      className="h-full min-h-[240px] w-full overflow-hidden rounded-b-xl border-t border-slate-800"
    />
  );
});
