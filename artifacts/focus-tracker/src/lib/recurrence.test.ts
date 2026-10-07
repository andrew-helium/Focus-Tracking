import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isRecurringTaskFinished,
  isTaskActive,
  isTaskDue,
  isTaskWaitingToRecur,
  nextDateAfterCompletion,
  nextScheduledDate,
  type RecurringTask,
} from './recurrence.ts';

const task = (overrides: Partial<RecurringTask> = {}): RecurringTask => ({
  recurring: true,
  recurrence: 'weekly',
  startDate: '2026-10-01',
  endDate: '2026-11-30',
  completed: false,
  weeklyDays: [1, 3],
  monthlyDays: [1],
  ...overrides,
});

test('weekly schedules use the selected weekdays and reactivate on the next one', () => {
  const value = task({ lastCompletedDate: '2026-10-05' }); // Monday

  assert.equal(nextDateAfterCompletion(value, '2026-10-05'), '2026-10-07');
  assert.equal(isTaskWaitingToRecur(value, '2026-10-06'), true);
  assert.equal(isTaskActive(value, '2026-10-07'), true);
});

test('a new weekly task is not due until its first selected weekday', () => {
  const value = task({
    startDate: '2026-10-05',
    weeklyDays: [3],
  });

  assert.equal(isTaskDue(value, '2026-10-06'), false);
  assert.equal(isTaskDue(value, '2026-10-07'), true);
});

test('monthly day 31 skips months that do not contain that date', () => {
  const value = task({
    recurrence: 'monthly',
    monthlyDays: [31],
    startDate: '2026-01-01',
    endDate: '2026-04-30',
  });

  assert.equal(nextScheduledDate(value, '2026-02-01'), '2026-03-31');
});

test('weekday tasks wait until the next Monday after completion', () => {
  const value = task({ recurrence: 'weekdays' });

  assert.equal(nextDateAfterCompletion(value, '2026-10-08'), '2026-10-12');
});

test('the end date is inclusive and prevents future recurrences', () => {
  const value = task({
    weeklyDays: [1],
    startDate: '2026-10-01',
    endDate: '2026-10-12',
    lastCompletedDate: '2026-10-12',
  });

  assert.equal(nextDateAfterCompletion(value, '2026-10-12'), undefined);
  assert.equal(isRecurringTaskFinished(value), true);
});
