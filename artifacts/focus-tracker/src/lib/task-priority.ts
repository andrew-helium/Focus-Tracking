import type { AssignmentSort } from './assignment-sorting.ts';
import { isTaskActive, today, type Recurrence, type RecurringTask } from './recurrence.ts';

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
} & Partial<RecurringTask>;

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

function asRecurring(task: RankedTask): RecurringTask {
  const recurrence: Recurrence = task.recurrence ?? 'weekly';
  return {
    recurring: Boolean(task.recurring),
    recurrence,
    startDate: task.startDate,
    endDate: task.endDate,
    completed: Boolean(task.completed),
    weeklyDays: task.weeklyDays ?? [],
    monthlyDays: task.monthlyDays ?? [],
    intervalDays: task.intervalDays ?? 7,
    remindBefore: Boolean(task.remindBefore),
    remindDays: task.remindDays ?? 1,
    lastCompletedDate: task.lastCompletedDate,
  };
}

/** A task stays in progress until it is checked and, when it has an end date, that date has passed. An unchecked task stays after its end date. */
export function taskStillInProgress(task: RankedTask, currentDate = today()): boolean {
  if (task.recurring) {
    if (!task.endDate || task.endDate >= currentDate) return true;
    const checked = Boolean(task.lastCompletedDate) && !isTaskActive(asRecurring(task), currentDate);
    return !checked;
  }
  if (!task.completed) return true;
  return Boolean(task.endDate && task.endDate >= currentDate);
}

/** Tasks still on In progress keep a number in their own list, including recurring tasks that are waiting for the next date. */
export function countsForPriority(task: RankedTask): boolean {
  return taskStillInProgress(task);
}

function releaseDepartedPriorities<T extends RankedTask>(tasks: T[]): void {
  for (const section of ['project', 'assignment', 'errand'] as const) {
    const active = tasks.filter(task => prioritySection(task) === section && countsForPriority(task));
    const released = [...new Set(tasks.flatMap(task => (
      prioritySection(task) === section && !countsForPriority(task) && hasPriority(task.priority) ? [task.priority] : []
    )))].sort((a, b) => a - b);
    for (let index = 0; index < released.length; index += 1) {
      const releasedPriority = released[index];
      if (active.some(task => task.priority === releasedPriority)) continue;
      for (const task of active) {
        if (hasPriority(task.priority) && task.priority > releasedPriority) task.priority -= 1;
      }
      for (let later = index + 1; later < released.length; later += 1) {
        if (released[later] > releasedPriority) released[later] -= 1;
      }
    }
  }
}

function nextOpenPriority(used: ReadonlySet<number>): number {
  let value = 1;
  while (used.has(value)) value += 1;
  return value;
}

/** When a priority value is no longer used, higher numbers in that list move up to fill it. A number someone else still has stays put. */
export function shiftPrioritiesAfterRelease<T extends RankedTask>(tasks: readonly T[], released: RankedTask): T[] {
  if (!hasPriority(released.priority)) return tasks.map(task => ({ ...task }));
  const section = prioritySection(released);
  const releasedPriority = released.priority;
  const stillUsed = tasks.some(task => task.id !== released.id && prioritySection(task) === section && countsForPriority(task) && task.priority === releasedPriority);
  if (stillUsed) return tasks.map(task => ({ ...task }));
  return tasks.map(task => {
    if (task.id === released.id || prioritySection(task) !== section || !countsForPriority(task) || !hasPriority(task.priority)) return { ...task };
    if (task.priority > releasedPriority) return { ...task, priority: task.priority - 1 };
    return { ...task };
  });
}

export function normalizePriorities<T extends RankedTask>(tasks: readonly T[]): T[] {
  const next = tasks.map(task => ({ ...task }));
  releaseDepartedPriorities(next);
  for (const section of ['project', 'assignment', 'errand'] as const) {
    const active = next.filter(task => prioritySection(task) === section && countsForPriority(task));
    const count = active.length;
    for (const task of active) {
      if (hasPriority(task.priority)) task.priority = clampPriority(task.priority, count);
    }
    const used = new Set(active.flatMap(task => hasPriority(task.priority) ? [task.priority] : []));
    const missing = active.filter(task => !hasPriority(task.priority)).sort((a, b) => {
      const byDate = (a.startDate || '9999').localeCompare(b.startDate || '9999');
      return byDate !== 0 ? byDate : a.id.localeCompare(b.id);
    });
    for (const task of missing) {
      const priority = nextOpenPriority(used);
      task.priority = priority;
      used.add(priority);
    }
  }
  return next;
}

export function moveToPriority<T extends RankedTask>(tasks: readonly T[], id: string, nextPriority: number): T[] {
  const normalized = normalizePriorities(tasks);
  const current = normalized.find(task => task.id === id);
  if (!current || !Number.isInteger(nextPriority)) return normalized;
  const count = normalized.filter(task => prioritySection(task) === prioritySection(current) && countsForPriority(task) === countsForPriority(current)).length;
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
  const count = normalized.filter(task => prioritySection(task) === section && countsForPriority(task)).length;
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
