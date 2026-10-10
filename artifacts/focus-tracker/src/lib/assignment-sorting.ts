export type AssignmentSort = 'start' | 'end';

export type SortableAssignment = {
  title: string;
  startDate: string;
  endDate: string;
  categoryId: string;
};

export function sortAssignments<T extends SortableAssignment>(
  tasks: readonly T[],
  sortBy: AssignmentSort,
): T[] {
  const dateKey = sortBy === 'start' ? 'startDate' : 'endDate';
  return [...tasks].sort((a, b) => {
    const aDate = a[dateKey];
    const bDate = b[dateKey];
    if (!aDate && bDate) return 1;
    if (aDate && !bDate) return -1;
    return aDate.localeCompare(bDate);
  });
}
