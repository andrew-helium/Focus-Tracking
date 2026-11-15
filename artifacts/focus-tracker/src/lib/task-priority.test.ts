import assert from 'node:assert/strict';
import test from 'node:test';
import { dropBeside, moveToPriority, normalizePriorities, sortByPriorityThenDate, sortUpcoming, type RankedTask } from './task-priority.ts';

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
