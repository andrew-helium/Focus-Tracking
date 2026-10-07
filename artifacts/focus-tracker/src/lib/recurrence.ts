export type Recurrence = 'daily' | 'weekdays' | 'weekly' | 'monthly';

export type RecurringTask = {
  recurring: boolean;
  recurrence: Recurrence;
  startDate: string;
  endDate: string;
  completed: boolean;
  weeklyDays: number[];
  monthlyDays: number[];
  lastCompletedDate?: string;
};

export const weekdayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const monthlyDayOptions = Array.from({ length: 31 }, (_, index) => index + 1);

export function localDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function today(): string {
  return localDateKey(new Date());
}

export function weekdayIndex(date: string): number {
  return new Date(`${date}T12:00:00`).getDay();
}

export function addDays(date: string, amount: number): string {
  const value = new Date(`${date}T12:00:00`);
  value.setDate(value.getDate() + amount);
  return localDateKey(value);
}

export function isScheduledOn(task: RecurringTask, date: string): boolean {
  if (!task.recurring || (task.startDate && date < task.startDate) || (task.endDate && date > task.endDate)) {
    return false;
  }

  const day = weekdayIndex(date);
  switch (task.recurrence) {
    case 'daily':
      return true;
    case 'weekdays':
      return day >= 1 && day <= 5;
    case 'weekly':
      return task.weeklyDays.includes(day);
    case 'monthly':
      return task.monthlyDays.includes(Number(date.slice(-2)));
  }
}

export function nextScheduledDate(task: RecurringTask, fromDate: string): string | undefined {
  if (!task.recurring) return undefined;
  let candidate = task.startDate && task.startDate > fromDate ? task.startDate : fromDate;

  // Every supported cadence has another occurrence within 31 days if one is selected.
  for (let offset = 0; offset <= 370; offset += 1) {
    if (task.endDate && candidate > task.endDate) return undefined;
    if (isScheduledOn(task, candidate)) return candidate;
    candidate = addDays(candidate, 1);
  }
  return undefined;
}

export function nextDateAfterCompletion(task: RecurringTask, completedDate: string): string | undefined {
  let firstPossibleDate = addDays(completedDate, 1);

  // A workweek recurrence starts a new cycle on Monday.
  if (task.recurrence === 'weekdays') {
    const day = weekdayIndex(completedDate);
    const daysUntilMonday = (8 - day) % 7 || 7;
    firstPossibleDate = addDays(completedDate, daysUntilMonday);
  }

  return nextScheduledDate(task, firstPossibleDate);
}

export function isTaskActive(task: RecurringTask, currentDate = today()): boolean {
  if (task.completed) return false;
  if (!task.recurring || !task.lastCompletedDate) return true;

  const nextDate = nextDateAfterCompletion(task, task.lastCompletedDate);
  return Boolean(nextDate && nextDate <= currentDate);
}

export function isTaskDue(task: RecurringTask, currentDate = today()): boolean {
  if (task.completed) return false;
  if (!task.recurring || task.lastCompletedDate) return isTaskActive(task, currentDate);

  const firstDate = nextScheduledDate(task, task.startDate || currentDate);
  return Boolean(firstDate && firstDate <= currentDate);
}

export function isTaskWaitingToRecur(task: RecurringTask, currentDate = today()): boolean {
  if (!task.recurring || task.completed || !task.lastCompletedDate || isTaskActive(task, currentDate)) {
    return false;
  }
  const nextDate = nextDateAfterCompletion(task, task.lastCompletedDate);
  return Boolean(nextDate && nextDate > currentDate);
}

export function isRecurringTaskFinished(task: RecurringTask): boolean {
  return Boolean(
    task.recurring &&
    !task.completed &&
    task.lastCompletedDate &&
    !nextDateAfterCompletion(task, task.lastCompletedDate),
  );
}

export function nextRecurrenceDate(task: RecurringTask, currentDate = today()): string | undefined {
  if (task.lastCompletedDate) return nextDateAfterCompletion(task, task.lastCompletedDate);
  return nextScheduledDate(task, currentDate);
}
