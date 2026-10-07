import assert from 'node:assert/strict';
import test from 'node:test';
import { sortAssignments, type SortableAssignment } from './assignment-sorting.ts';

type Assignment = SortableAssignment & { id: string };

const assignment = (id: string, overrides: Partial<Assignment> = {}): Assignment => ({
  id,
  title: id,
  startDate: '2026-10-07',
  endDate: '',
  categoryId: '',
  ...overrides,
});

const categoryName = (id: string) => ({
  learning: 'Learning',
  reading: 'Reading',
  writing: 'Writing',
}[id]);

test('sorts by earliest start date and keeps missing dates last', () => {
  const tasks = [
    assignment('later', { startDate: '2026-10-10' }),
    assignment('early', { startDate: '2026-10-01' }),
    assignment('same-date', { startDate: '2026-10-01' }),
    assignment('undated', { startDate: '' }),
  ];

  assert.deepEqual(
    sortAssignments(tasks, 'start', categoryName).map(task => task.id),
    ['early', 'same-date', 'later', 'undated'],
  );
});

test('sorts by earliest end date and places ongoing assignments last', () => {
  const tasks = [
    assignment('ongoing'),
    assignment('later', { endDate: '2026-10-30' }),
    assignment('sooner', { endDate: '2026-10-12' }),
  ];

  assert.deepEqual(
    sortAssignments(tasks, 'end', categoryName).map(task => task.id),
    ['sooner', 'later', 'ongoing'],
  );
});

test('sorts by category A–Z and places uncategorized assignments last', () => {
  const tasks = [
    assignment('writing', { categoryId: 'writing' }),
    assignment('reading', { categoryId: 'reading' }),
    assignment('learning', { categoryId: 'learning' }),
    assignment('uncategorized'),
  ];

  assert.deepEqual(
    sortAssignments(tasks, 'category', categoryName).map(task => task.id),
    ['learning', 'reading', 'writing', 'uncategorized'],
  );
});
