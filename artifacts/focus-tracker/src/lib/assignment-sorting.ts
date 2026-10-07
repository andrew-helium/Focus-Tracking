export type AssignmentSort = 'start' | 'end' | 'category';

export type SortableAssignment = {
  title: string;
  startDate: string;
  endDate: string;
  categoryId: string;
};

export function sortAssignments<T extends SortableAssignment>(
  tasks: readonly T[],
  sortBy: AssignmentSort,
  categoryName: (categoryId: string) => string | undefined,
): T[] {
  return [...tasks].sort((a, b) => {
    if (sortBy === 'category') {
      const aCategory = categoryName(a.categoryId);
      const bCategory = categoryName(b.categoryId);
      if (aCategory && !bCategory) return -1;
      if (!aCategory && bCategory) return 1;
      return (aCategory || '').localeCompare(bCategory || '', undefined, { sensitivity: 'base' });
    }

    const dateKey = sortBy === 'start' ? 'startDate' : 'endDate';
    const aDate = a[dateKey];
    const bDate = b[dateKey];
    if (!aDate && bDate) return 1;
    if (aDate && !bDate) return -1;
    return aDate.localeCompare(bDate);
  });
}
