import type { SubmitDto, UserProgress } from './types';

const PROGRESS_KEY = 'regzero.progress.v1';
const DRAFT_PREFIX = 'regzero.draft.v1.';
const PINNED_SEED_PREFIX = 'regzero.pinnedSeed.v1.';
const BRIEFING_KEY = 'regzero.briefing.v1';

export interface PinnedFailure {
  seed: number;
  caseIndex: number;
  caseName: string;
}

export function defaultProgress(): UserProgress {
  return {
    version: 1,
    lastModified: new Date().toISOString(),
    levels: {},
    settings: {
      showHints: true,
      freeExplore: false,
    },
  };
}

export function loadProgress(): UserProgress {
  try {
    const raw = window.localStorage.getItem(PROGRESS_KEY);
    if (!raw) return defaultProgress();
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return defaultProgress();
    const candidate = parsed as Partial<UserProgress>;
    return {
      version: typeof candidate.version === 'number' ? candidate.version : 1,
      lastModified:
        typeof candidate.lastModified === 'string'
          ? candidate.lastModified
          : new Date().toISOString(),
      levels:
        candidate.levels && typeof candidate.levels === 'object' ? candidate.levels : {},
      settings: {
        showHints: candidate.settings?.showHints ?? true,
        freeExplore: candidate.settings?.freeExplore ?? false,
      },
    };
  } catch {
    return defaultProgress();
  }
}

export function saveProgress(progress: UserProgress): UserProgress {
  const next: UserProgress = {
    ...progress,
    lastModified: new Date().toISOString(),
  };
  try {
    window.localStorage.setItem(PROGRESS_KEY, JSON.stringify(next));
  } catch {
    // 无痕模式或配额满时不中断游戏
  }
  return next;
}

export function recordSubmissionProgress(submit: SubmitDto): UserProgress {
  const current = loadProgress();
  const prev = current.levels[submit.level];
  const now = new Date().toISOString();
  const passed = submit.passed || Boolean(prev?.passed);
  const bestScore =
    prev?.bestScore !== undefined ? Math.max(prev.bestScore, submit.score) : submit.score;
  const bestSteps =
    submit.passed && submit.totalSteps > 0
      ? prev?.bestSteps !== undefined
        ? Math.min(prev.bestSteps, submit.totalSteps)
        : submit.totalSteps
      : prev?.bestSteps;

  current.levels[submit.level] = {
    levelId: submit.level,
    passed,
    completedAt: prev?.completedAt ?? (submit.passed ? now : undefined),
    attempts: (prev?.attempts ?? 0) + 1,
    bestScore,
    metPar: Boolean(prev?.metPar || submit.metPar),
    bestSteps,
  };
  return saveProgress(current);
}

/** 生成 32 位正整数动态随机种子（供 Plan B2 提交期防打表抽测）。 */
export function generateRandomSeed(): number {
  const n = Math.floor(Math.random() * 0x7fff_fffe) + 1;
  return n >>> 0;
}

export function loadPinnedFailure(levelId: string): PinnedFailure | null {
  try {
    const raw = window.localStorage.getItem(`${PINNED_SEED_PREFIX}${levelId}`);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const obj = parsed as Partial<PinnedFailure>;
    if (
      typeof obj.seed === 'number' &&
      typeof obj.caseIndex === 'number' &&
      typeof obj.caseName === 'string'
    ) {
      return { seed: obj.seed, caseIndex: obj.caseIndex, caseName: obj.caseName };
    }
    return null;
  } catch {
    return null;
  }
}

export function savePinnedFailure(levelId: string, pinned: PinnedFailure): void {
  try {
    window.localStorage.setItem(`${PINNED_SEED_PREFIX}${levelId}`, JSON.stringify(pinned));
  } catch {
    // 忽略存储异常
  }
}

export function clearPinnedFailure(levelId: string): void {
  try {
    window.localStorage.removeItem(`${PINNED_SEED_PREFIX}${levelId}`);
  } catch {
    // 忽略
  }
}

export function updateSettings(patch: Partial<UserProgress['settings']>): UserProgress {
  const current = loadProgress();
  current.settings = { ...current.settings, ...patch };
  return saveProgress(current);
}

export function loadDraft(key: string): string | null {
  try {
    return window.localStorage.getItem(`${DRAFT_PREFIX}${key}`);
  } catch {
    return null;
  }
}

export function saveDraft(key: string, code: string): void {
  try {
    window.localStorage.setItem(`${DRAFT_PREFIX}${key}`, code);
  } catch {
    // 忽略存储配额错误
  }
}

export function clearDraft(key: string): void {
  try {
    window.localStorage.removeItem(`${DRAFT_PREFIX}${key}`);
  } catch {
    // 忽略
  }
}

/** 判断某关的首次进场引导是否已经看过。 */
export function hasSeenBriefing(levelId: string): boolean {
  try {
    const raw = window.localStorage.getItem(BRIEFING_KEY);
    if (!raw) return false;
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.includes(levelId);
  } catch {
    return false;
  }
}

/** 标记某关的首次进场引导已阅读。 */
export function markBriefingSeen(levelId: string): void {
  try {
    const raw = window.localStorage.getItem(BRIEFING_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    const list = Array.isArray(parsed)
      ? parsed.filter((x): x is string => typeof x === 'string')
      : [];
    if (!list.includes(levelId)) {
      list.push(levelId);
      window.localStorage.setItem(BRIEFING_KEY, JSON.stringify(list));
    }
  } catch {
    // 忽略存储异常
  }
}

/** 清空本地通关进度、引导已读状态与全部代码草稿（用于全新体验或重置存档）。 */
export function resetAllProgress(): UserProgress {
  try {
    window.localStorage.removeItem(PROGRESS_KEY);
    window.localStorage.removeItem(BRIEFING_KEY);
    const toRemove: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (k && (k.startsWith(DRAFT_PREFIX) || k.startsWith(PINNED_SEED_PREFIX))) {
        toRemove.push(k);
      }
    }
    for (const k of toRemove) {
      window.localStorage.removeItem(k);
    }
  } catch {
    // 忽略存储异常
  }
  return defaultProgress();
}
