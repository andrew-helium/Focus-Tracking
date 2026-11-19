import assert from 'node:assert/strict';
import test from 'node:test';
import { dropBeside, moveToPriority, normalizePriorities, shiftPrioritiesAfterRelease, sortByPriorityThenDate, sortUpcoming, taskStillInProgress, type RankedTask } from './task-priority.ts';

type Item = RankedTask;

const item = (id: string, length: 'short' | 'long', overrides: Partial<Item> = {}): Item => ({
  id,
  length,
  startDate: '2026-10-07',
  endDate: '',
  ...overrides,
});

const order = (tasks: readonly Item[]) => tasks.map(task => `${task.priority}:${task.id}`);

test('keeps shared priority numbers and only fills tasks that do not have one', () => {
  const tasks = normalizePriorities([
    item('shared-a', 'short', { priority: 1, startDate: '2026-10-03' }),
    item('shared-b', 'short', { priority: 1, startDate: '2026-10-01' }),
    item('missing', 'short', { startDate: '2026-10-02' }),
    item('project', 'long', { priority: 4 }),
  ]);

  assert.deepEqual(order(tasks.filter(task => task.length === 'short')), ['1:shared-a', '1:shared-b', '2:missing']);
  assert.equal(tasks.find(task => task.id === 'project')?.priority, 1);
});

test('keeps typed numbers inside 1 through the size of that list', () => {
  const start = [
    item('a', 'short', { priority: 1 }),
    item('b', 'short', { priority: 2 }),
    item('project', 'long', { priority: 1 }),
  ];

  const high = moveToPriority(start, 'a', 9);
  const low = moveToPriority(start, 'b', 0);

  assert.equal(high.find(task => task.id === 'a')?.priority, 2);
  assert.equal(high.find(task => task.id === 'b')?.priority, 2);
  assert.equal(low.find(task => task.id === 'b')?.priority, 1);
  assert.equal(low.find(task => task.id === 'project')?.priority, 1);
});

test('dragging up increases each task passed, and dragging down decreases them', () => {
  const start = [
    item('a', 'short', { priority: 1, startDate: '2026-10-01' }),
    item('b', 'short', { priority: 2, startDate: '2026-10-02' }),
    item('c', 'short', { priority: 3, startDate: '2026-10-03' }),
    item('hidden', 'short', { priority: 2, startDate: '2026-10-04' }),
  ];
  const visible = ['a', 'b', 'c'];

  const upward = dropBeside(start, visible, 'c', 'a', 'before', 'start');
  assert.equal(upward.find(task => task.id === 'c')?.priority, 1);
  assert.equal(upward.find(task => task.id === 'a')?.priority, 2);
  assert.equal(upward.find(task => task.id === 'b')?.priority, 3);
  assert.equal(upward.find(task => task.id === 'hidden')?.priority, 2);

  const downward = dropBeside(start, visible, 'a', 'c', 'after', 'start');
  assert.equal(downward.find(task => task.id === 'b')?.priority, 1);
  assert.equal(downward.find(task => task.id === 'c')?.priority, 2);
  assert.equal(downward.find(task => task.id === 'a')?.priority, 3);
  assert.equal(downward.find(task => task.id === 'hidden')?.priority, 2);
});

test('numbers errands apart from assignments and projects', () => {
  const tasks = normalizePriorities([
    item('assignment-a', 'short', { priority: 1 }),
    item('assignment-b', 'short', { priority: 12 }),
    item('project', 'long', { priority: 4 }),
    item('errand-a', 'short', { categoryId: 'cat-errands', priority: 1 }),
    item('errand-b', 'long', { categoryId: 'cat-errands', priority: 2 }),
    item('errand-new', 'short', { categoryId: 'cat-errands' }),
  ]);

  assert.equal(tasks.find(task => task.id === 'assignment-a')?.priority, 1);
  assert.equal(tasks.find(task => task.id === 'assignment-b')?.priority, 2);
  assert.equal(tasks.find(task => task.id === 'project')?.priority, 1);
  assert.equal(tasks.find(task => task.id === 'errand-a')?.priority, 1);
  assert.equal(tasks.find(task => task.id === 'errand-b')?.priority, 2);
  assert.equal(tasks.find(task => task.id === 'errand-new')?.priority, 3);
});

test('removing or completing a task moves higher numbers up inside that list', () => {
  const tasks = [
    item('first', 'long', { priority: 1 }),
    item('also-first', 'long', { priority: 1 }),
    item('second', 'long', { priority: 2 }),
    item('third', 'long', { priority: 3 }),
    item('assignment', 'short', { priority: 2 }),
    item('assignment-one', 'short', { priority: 1 }),
  ];

  const removed = normalizePriorities(shiftPrioritiesAfterRelease(tasks.filter(task => task.id !== 'first'), tasks[0]));
  assert.equal(removed.find(task => task.id === 'also-first')?.priority, 1);
  assert.equal(removed.find(task => task.id === 'second')?.priority, 2);
  assert.equal(removed.find(task => task.id === 'third')?.priority, 3);
  assert.equal(removed.find(task => task.id === 'assignment')?.priority, 2);

  const withoutOnes = removed.filter(task => task.id !== 'also-first');
  const filled = normalizePriorities(shiftPrioritiesAfterRelease(withoutOnes, removed.find(task => task.id === 'also-first')!));
  assert.equal(filled.find(task => task.id === 'second')?.priority, 1);
  assert.equal(filled.find(task => task.id === 'third')?.priority, 2);

  const completed = tasks.map(task => task.id === 'also-first' ? { ...task, completed: true } : task);
  const shifted = normalizePriorities(shiftPrioritiesAfterRelease(completed, tasks[1]));
  assert.equal(shifted.find(task => task.id === 'first')?.priority, 1);
  assert.equal(shifted.find(task => task.id === 'second')?.priority, 2);
  assert.equal(shifted.find(task => task.id === 'third')?.priority, 3);
});

test('a new task takes the next number in its own list', () => {
  const projects = Array.from({ length: 6 }, (_, index) => item(`project-${index + 1}`, 'long', { priority: index + 1 }));
  const tasks = normalizePriorities([
    ...projects,
    item('done-project', 'long', { priority: 9, completed: true }),
    item('new-project', 'long'),
    item('assignment-a', 'short', { priority: 1 }),
    item('assignment-b', 'short', { priority: 2 }),
    item('new-assignment', 'short'),
    item('errand-a', 'short', { categoryId: 'cat-errands', priority: 1 }),
    item('new-errand', 'long', { categoryId: 'cat-errands' }),
  ]);

  assert.equal(tasks.find(task => task.id === 'new-project')?.priority, 7);
  assert.equal(tasks.find(task => task.id === 'done-project')?.priority, 9);
  assert.equal(tasks.find(task => task.id === 'new-assignment')?.priority, 3);
  assert.equal(tasks.find(task => task.id === 'new-errand')?.priority, 2);

  const gapped = normalizePriorities([
    item('kept', 'short', { priority: 1 }),
    item('shared', 'short', { priority: 1 }),
    item('high', 'short', { priority: 4 }),
    item('recur', 'short', { priority: 2, recurring: true, lastCompletedDate: '2026-10-01' }),
    item('fresh', 'short'),
  ]);
  assert.equal(gapped.find(task => task.id === 'fresh')?.priority, 3);
  assert.equal(gapped.find(task => task.id === 'high')?.priority, 4);
  assert.equal(gapped.find(task => task.id === 'shared')?.priority, 1);
});

test('a checked task leaves in progress once its end date has passed', () => {
  const open = item('open', 'short', { completed: false, endDate: '2026-10-01' });
  const checkedFuture = item('future', 'short', { completed: true, endDate: '2026-10-20' });
  const checkedToday = item('today', 'short', { completed: true, endDate: '2026-10-10' });
  const checkedPast = item('past', 'short', { completed: true, endDate: '2026-10-09' });
  const checkedNoEnd = item('done', 'short', { completed: true, endDate: '' });

  assert.equal(taskStillInProgress(open, '2026-10-10'), true);
  assert.equal(taskStillInProgress(checkedFuture, '2026-10-10'), true);
  assert.equal(taskStillInProgress(checkedToday, '2026-10-10'), true);
  assert.equal(taskStillInProgress(checkedPast, '2026-10-10'), false);
  assert.equal(taskStillInProgress(checkedNoEnd, '2026-10-10'), false);

  const recurring = item('recur', 'long', {
    recurring: true,
    recurrence: 'daily',
    startDate: '2026-10-01',
    endDate: '2026-10-09',
    lastCompletedDate: '2026-10-09',
    completed: false,
  });
  const uncheckedRecurring = item('missed', 'long', {
    recurring: true,
    recurrence: 'daily',
    startDate: '2026-10-01',
    endDate: '2026-10-09',
    completed: false,
  });
  assert.equal(taskStillInProgress(recurring, '2026-10-10'), false);
  assert.equal(taskStillInProgress(uncheckedRecurring, '2026-10-10'), true);
  assert.equal(taskStillInProgress(recurring, '2026-10-09'), true);
});

test('numbers move up when a checked task passes its end date', () => {
  const tasks = normalizePriorities([
    item('checked-future', 'short', { priority: 1, completed: true, endDate: '2099-01-01' }),
    item('open', 'short', { priority: 2, endDate: '2000-01-01' }),
    item('checked-past', 'long', { priority: 1, completed: true, endDate: '2000-01-01' }),
    item('project-next', 'long', { priority: 2 }),
  ]);

  assert.equal(tasks.find(task => task.id === 'checked-future')?.priority, 1);
  assert.equal(tasks.find(task => task.id === 'open')?.priority, 2);
  assert.equal(tasks.find(task => task.id === 'project-next')?.priority, 1);
  assert.equal(tasks.find(task => task.id === 'checked-past')?.priority, 1);
});

test('upcoming Errands lists only errands, in priority order', () => {
  const tasks = [
    item('assignment-2', 'short', { priority: 2, startDate: '2026-10-01' }),
    item('project-1-later', 'long', { priority: 1, startDate: '2026-10-20' }),
    item('assignment-1', 'short', { priority: 1, startDate: '2026-10-01' }),
    item('errand-later', 'short', { categoryId: 'cat-errands', priority: 1, startDate: '2026-10-20' }),
    item('errand-sooner', 'long', { categoryId: 'cat-errands', priority: 1, startDate: '2026-10-02' }),
    item('errand-2', 'short', { categoryId: 'cat-errands', priority: 2, startDate: '2026-10-01' }),
    item('project-1-sooner', 'long', { priority: 1, startDate: '2026-10-02' }),
    item('project-2', 'long', { priority: 2, startDate: '2026-10-01' }),
  ];

  assert.deepEqual(sortUpcoming(tasks, 'errand').map(task => task.id), ['errand-sooner', 'errand-later', 'errand-2']);
  assert.deepEqual(sortUpcoming(tasks, 'project').map(task => task.id), ['project-1-sooner', 'project-1-later', 'project-2']);
  assert.deepEqual(sortUpcoming(tasks, 'assignment').map(task => task.id), ['assignment-1', 'assignment-2']);
});

test('sorts by priority first and uses the date order only for equal numbers', () => {
  const tasks = [
    item('later-start', 'short', { priority: 1, startDate: '2026-10-20', endDate: '2026-10-01' }),
    item('sooner-start', 'short', { priority: 1, startDate: '2026-10-02', endDate: '2026-10-30' }),
    item('higher', 'short', { priority: 2, startDate: '2026-10-01', endDate: '2026-10-01' }),
  ];

  assert.deepEqual(sortByPriorityThenDate(tasks, 'start').map(task => task.id), ['sooner-start', 'later-start', 'higher']);
  assert.deepEqual(sortByPriorityThenDate(tasks, 'end').map(task => task.id), ['later-start', 'sooner-start', 'higher']);
});
