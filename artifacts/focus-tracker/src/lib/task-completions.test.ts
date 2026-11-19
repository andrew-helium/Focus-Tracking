import assert from 'node:assert/strict';
import test from 'node:test';
import { filterCompletions, readCompletions, type CompletionSource, type TaskCompletion } from './task-completions.ts';

const task = (overrides: Partial<CompletionSource> = {}): CompletionSource => ({
  id: 'task-1',
  title: 'Write notes',
  description: 'Outline the first section',
  categoryId: 'cat-writing',
  length: 'short',
  startDate: '2026-10-01',
  endDate: '',
  createdAt: '2026-10-01T15:00:00.000Z',
  ...overrides,
});

test('seeds one instance for a checked task and a recurring check when no log exists yet', () => {
  const completions = readCompletions([
    task({ completed: true }),
    task({ id: 'recur', title: 'Daily review', length: 'long', recurring: true, lastCompletedDate: '2026-10-04', completed: false }),
    task({ id: 'open', title: 'Still open', completed: false }),
  ], undefined);

  assert.deepEqual(completions.map(item => [item.taskId, item.section, item.title, item.description]), [
    ['task-1', 'assignment', 'Write notes', 'Outline the first section'],
    ['recur', 'project', 'Daily review', 'Outline the first section'],
  ]);
  assert.equal(completions[1]?.completedAt, new Date('2026-10-04T12:00:00').toISOString());
});

test('keeps a saved log, including an empty one, and drops malformed rows', () => {
  assert.deepEqual(readCompletions([task({ completed: true })], []), []);
  const kept = readCompletions([task({ completed: true })], [
    { id: 'c1', taskId: 'task-1', title: 'Write notes', description: 'Kept notes', categoryId: 'cat-writing', section: 'assignment', completedAt: '2026-10-02T12:00:00.000Z' },
    { id: '', taskId: 'task-1', title: 'Missing id', section: 'assignment', completedAt: '2026-10-03T12:00:00.000Z' },
    { id: 'c2', taskId: 'task-1', title: 'Bad section', section: 'other', completedAt: '2026-10-03T12:00:00.000Z' },
  ]);
  assert.deepEqual(kept.map(item => [item.id, item.description]), [['c1', 'Kept notes']]);
});

const completion = (overrides: Partial<TaskCompletion>): TaskCompletion => ({
  id: overrides.id || 'c',
  taskId: 'task',
  title: 'Task',
  description: '',
  categoryId: 'cat-writing',
  section: 'assignment',
  engagement: 'deep',
  completedAt: '2026-11-19T15:00:00.000Z',
  ...overrides,
});

test('filters completions by words, mode, date, category, and recency', () => {
  const items = [
    completion({ id: 'older', title: 'Outline', description: 'Quiet notes', engagement: 'shallow', completedAt: '2026-11-01T15:00:00.000Z' }),
    completion({ id: 'middle', title: 'Draft', description: 'Keep the verbs', engagement: 'deep', completedAt: '2026-11-18T15:00:00.000Z' }),
    completion({ id: 'newest', title: 'Revise', description: 'Read it aloud', categoryId: 'cat-reading', engagement: 'deep', completedAt: '2026-11-19T18:00:00.000Z' }),
  ];
  const now = new Date('2026-11-19T20:00:00.000Z').getTime();
  const names = { 'cat-writing': 'Writing', 'cat-reading': 'Reading' };

  assert.deepEqual(filterCompletions(items, { now, todayKey: '2026-11-19' }).map(item => item.id), ['newest', 'middle', 'older']);
  assert.deepEqual(filterCompletions(items, { sort: 'old', now, todayKey: '2026-11-19' }).map(item => item.id), ['older', 'middle', 'newest']);
  assert.deepEqual(filterCompletions(items, { search: 'verbs', now, categoryNames: names }).map(item => item.id), ['middle']);
  assert.deepEqual(filterCompletions(items, { search: 'reading', now, categoryNames: names }).map(item => item.id), ['newest']);
  assert.deepEqual(filterCompletions(items, { mode: 'shallow', now }).map(item => item.id), ['older']);
  assert.deepEqual(filterCompletions(items, { date: 'today', now, todayKey: '2026-11-19' }).map(item => item.id), ['newest']);
  assert.deepEqual(filterCompletions(items, { date: 'week', now, todayKey: '2026-11-19' }).map(item => item.id), ['newest', 'middle']);
  assert.deepEqual(filterCompletions(items, { categoryIds: ['cat-reading'], now }).map(item => item.id), ['newest']);
  assert.deepEqual(filterCompletions(items, { date: 'custom', customStart: '2026-11-18', customEnd: '2026-11-19', now }).map(item => item.id), ['newest', 'middle']);
});
