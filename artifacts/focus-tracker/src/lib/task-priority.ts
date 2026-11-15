import type { AssignmentSort } from './assignment-sorting.ts';

export type TaskLength = 'short' | 'long';
export type DropPlace = 'before' | 'after';
export type PrioritySection = 'project' | 'assignment' | 'errand';

export const ERRANDS_CATEGORY_ID = 'cat-errands';

export type RankedTask = {
  id: string;
  length: TaskLength;
  categoryId?: string;
  priority?: number;
  startDate: string;
  endDate: string;
};

export function prioritySection(task: { length: TaskLength; categoryId?: string }): PrioritySection {
  if (task.categoryId === ERRANDS_CATEGORY_ID) return 'errand';
  return task.length === 'long' ? 'project' : 'assignment';
}

export function hasPriority(priority: number | undefined): priority is number {
  return typeof priority === 'number' && Number.isInteger(priority);
}

function clampPriority(priority: number, count: number): number {
  if (count < 1) return 1;
  return Math.min(count, Math.max(1, priority));
}

export function normalizePriorities<T extends RankedTask>(tasks: readonly T[]): T[] {
  const next = tasks.map(task => ({ ...task }));
  for (const section of ['project', 'assignment', 'errand'] as const) {
    const group = next.filter(task => prioritySection(task) === section);
    const count = group.length;
    for (const task of group) {
      if (hasPriority(task.priority)) task.priority = clampPriority(task.priority, count);
    }
    let nextRank = group.reduce((max, task) => hasPriority(task.priority) ? Math.max(max, task.priority) : max, 0);
    const missing = group.filter(task => !hasPriority(task.priority)).sort((a, b) => {
      const byDate = (a.startDate || '9999').localeCompare(b.startDate || '9999');
      return byDate !== 0 ? byDate : a.id.localeCompare(b.id);
    });
    for (const task of missing) {
      nextRank = clampPriority(nextRank + 1, count);
      task.priority = nextRank;
    }
  }
  return next;
}

export function moveToPriority<T extends RankedTask>(tasks: readonly T[], id: string, nextPriority: number): T[] {
  const normalized = normalizePriorities(tasks);
  const current = normalized.find(task => task.id === id);
  if (!current || !Number.isInteger(nextPriority)) return normalized;
  const count = normalized.filter(task => prioritySection(task) === prioritySection(current)).length;
  const priority = clampPriority(nextPriority, count);
  return normalized.map(task => task.id === id ? { ...task, priority } : task);
}

export function dropBeside<T extends RankedTask>(
  tasks: readonly T[],
  visibleIds: readonly string[],
  fromId: string,
  toId: string,
  place: DropPlace,
  sortBy: AssignmentSort,
): T[] {
  if (fromId === toId || !visibleIds.includes(fromId) || !visibleIds.includes(toId)) return normalizePriorities(tasks);
  const normalized = normalizePriorities(tasks);
  const source = normalized.find(task => task.id === fromId);
  const target = normalized.find(task => task.id === toId);
  if (!source || !target || prioritySection(source) !== prioritySection(target) || !hasPriority(target.priority)) return normalized;
  const section = prioritySection(source);
  const visible = sortByPriorityThenDate(
    normalized.filter(task => prioritySection(task) === section && visibleIds.includes(task.id)),
    sortBy,
  );
  const fromIndex = visible.findIndex(task => task.id === fromId);
  const targetIndex = visible.findIndex(task => task.id === toId);
  if (fromIndex < 0 || targetIndex < 0) return normalized;
  const destination = place === 'before' ? targetIndex : targetIndex + 1;
  const movingUp = destination < fromIndex;
  const passed = movingUp ? visible.slice(destination, fromIndex) : visible.slice(fromIndex + 1, destination);
  const count = normalized.filter(task => prioritySection(task) === section).length;
  const updates = new Map<string, number>();
  for (const task of passed) {
    updates.set(task.id, clampPriority((task.priority ?? 1) + (movingUp ? 1 : -1), count));
  }
  const beside = updates.get(toId) ?? target.priority;
  updates.set(fromId, clampPriority(place === 'before' ? beside - 1 : beside + 1, count));
  return normalized.map(task => updates.has(task.id) ? { ...task, priority: updates.get(task.id)! } : task);
}

function compareDates(a: string, b: string): number {
  if (!a && b) return 1;
  if (a && !b) return -1;
  return a.localeCompare(b);
}

export type UpcomingGroup = PrioritySection;

export function sortUpcoming<T extends RankedTask>(tasks: readonly T[], group: UpcomingGroup): T[] {
  const filtered = tasks.filter(task => prioritySection(task) === group);
  return [...filtered].sort((a, b) => {
    const priorityDelta = (a.priority ?? 0) - (b.priority ?? 0);
    if (priorityDelta !== 0) return priorityDelta;
    const byDate = compareDates(a.startDate, b.startDate);
    if (byDate !== 0) return byDate;
    return a.id.localeCompare(b.id);
  });
}

export function sortByPriorityThenDate<T extends RankedTask>(tasks: readonly T[], sortBy: AssignmentSort): T[] {
  const dateKey = sortBy === 'start' ? 'startDate' : 'endDate';
  return [...tasks].sort((a, b) => {
    const priorityDelta = (a.priority ?? 0) - (b.priority ?? 0);
    if (priorityDelta !== 0) return priorityDelta;
    const byDate = compareDates(a[dateKey], b[dateKey]);
    if (byDate !== 0) return byDate;
    return a.id.localeCompare(b.id);
  });
}
