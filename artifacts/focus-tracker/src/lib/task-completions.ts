import { localDateKey } from './recurrence.ts';
import { prioritySection, type PrioritySection, type TaskLength } from './task-priority.ts';

export type CompletionEngagement = 'deep' | 'shallow' | '';
export type CompletionDateFilter = 'all' | 'today' | 'week' | 'month' | 'year' | 'custom';
export type CompletionModeFilter = 'all' | 'deep' | 'shallow';
export type CompletionSort = 'new' | 'old';

export type TaskCompletion = {
  id: string;
  taskId: string;
  title: string;
  description: string;
  categoryId: string;
  section: PrioritySection;
  engagement: CompletionEngagement;
  completedAt: string;
};

export type CompletionQuery = {
  search?: string;
  date?: CompletionDateFilter;
  customStart?: string;
  customEnd?: string;
  mode?: CompletionModeFilter;
  sort?: CompletionSort;
  categoryIds?: readonly string[] | null;
  categoryNames?: Readonly<Record<string, string>>;
  now?: number;
  todayKey?: string;
};

export type CompletionSource = {
  id: string;
  title: string;
  categoryId: string;
  length: TaskLength;
  startDate: string;
  endDate: string;
  description?: string;
  engagement?: 'deep' | 'shallow';
  createdAt?: string;
  completed?: boolean;
  recurring?: boolean;
  lastCompletedDate?: string;
};

function engagementOf(value: unknown): CompletionEngagement {
  return value === 'deep' || value === 'shallow' ? value : '';
}

function noonIso(date: string): string {
  const value = new Date(`${date}T12:00:00`);
  return Number.isNaN(value.getTime()) ? new Date().toISOString() : value.toISOString();
}

function parseCompletion(value: unknown): TaskCompletion[] {
  if (!value || typeof value !== 'object') return [];
  const item = value as Partial<TaskCompletion>;
  if (typeof item.id !== 'string' || !item.id) return [];
  if (typeof item.taskId !== 'string' || !item.taskId) return [];
  if (typeof item.title !== 'string') return [];
  if (typeof item.completedAt !== 'string' || !item.completedAt) return [];
  if (item.section !== 'project' && item.section !== 'assignment' && item.section !== 'errand') return [];
  return [{
    id: item.id,
    taskId: item.taskId,
    title: item.title,
    description: typeof item.description === 'string' ? item.description : '',
    categoryId: typeof item.categoryId === 'string' ? item.categoryId : '',
    section: item.section,
    engagement: engagementOf(item.engagement),
    completedAt: item.completedAt,
  }];
}

function seedTask(task: CompletionSource): TaskCompletion[] {
  if (task.recurring && task.lastCompletedDate) {
    return [{
      id: `seed-${task.id}-${task.lastCompletedDate}`,
      taskId: task.id,
      title: task.title,
      description: task.description || '',
      categoryId: task.categoryId,
      section: prioritySection(task),
      engagement: engagementOf(task.engagement),
      completedAt: noonIso(task.lastCompletedDate),
    }];
  }
  if (!task.recurring && task.completed) {
    const date = task.endDate || task.startDate;
    return [{
      id: `seed-${task.id}`,
      taskId: task.id,
      title: task.title,
      description: task.description || '',
      categoryId: task.categoryId,
      section: prioritySection(task),
      engagement: engagementOf(task.engagement),
      completedAt: date ? noonIso(date) : (task.createdAt || new Date().toISOString()),
    }];
  }
  return [];
}

/** Missing history is filled once from tasks that are already checked. A saved list, including an empty one, is kept as-is. */
export function readCompletions(tasks: readonly CompletionSource[], raw: unknown): TaskCompletion[] {
  if (raw !== undefined) return Array.isArray(raw) ? raw.flatMap(parseCompletion) : [];
  return tasks.flatMap(seedTask);
}

const completionDayMs = 86400000;

/** Search, date, mode, category, and recency order for a completion log. An invalid custom range leaves the dates unfiltered. */
export function filterCompletions(items: readonly TaskCompletion[], query: CompletionQuery = {}): TaskCompletion[] {
  const search = (query.search ?? '').trim().toLowerCase();
  const date = query.date ?? 'all';
  const mode = query.mode ?? 'all';
  const sort = query.sort ?? 'new';
  const now = query.now ?? Date.now();
  const todayKey = query.todayKey ?? localDateKey(new Date(now));
  const names = query.categoryNames ?? {};
  let customStart = 0;
  let customEnd = 0;
  let customValid = false;
  if (date === 'custom' && query.customStart && query.customEnd) {
    customStart = new Date(`${query.customStart}T00:00:00`).getTime();
    customEnd = new Date(`${query.customEnd}T23:59:59.999`).getTime();
    customValid = !Number.isNaN(customStart) && !Number.isNaN(customEnd) && customStart <= customEnd;
  }
  const matched = items.filter(item => {
    if (query.categoryIds && !query.categoryIds.includes(item.categoryId)) return false;
    if (mode !== 'all' && item.engagement !== mode) return false;
    const ms = new Date(item.completedAt).getTime();
    if (date === 'today' && localDateKey(new Date(item.completedAt)) !== todayKey) return false;
    if (date === 'week' && now - ms >= 7 * completionDayMs) return false;
    if (date === 'month' && now - ms >= 30 * completionDayMs) return false;
    if (date === 'year' && now - ms >= 365 * completionDayMs) return false;
    if (date === 'custom' && customValid && (ms < customStart || ms > customEnd)) return false;
    if (!search) return true;
    const categoryName = (names[item.categoryId] || '').toLowerCase();
    return `${item.title}\n${item.description}\n${categoryName}`.toLowerCase().includes(search);
  });
  return [...matched].sort((a, b) => {
    const byTime = sort === 'old' ? a.completedAt.localeCompare(b.completedAt) : b.completedAt.localeCompare(a.completedAt);
    return byTime !== 0 ? byTime : a.id.localeCompare(b.id);
  });
}
