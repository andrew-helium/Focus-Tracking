export type SyncStore = {
  categories: { id: string; name: string; color: string }[];
  tasks: {
    id: string;
    title: string;
    description: string;
    categoryId: string;
    engagement: string;
    length: string;
    priority: number;
    createdAt: string;
    startDate: string;
    endDate: string;
    recurring: boolean;
    recurrence: string;
    completed: boolean;
    weeklyDays: number[];
    monthlyDays: number[];
    intervalDays?: number;
    remindBefore?: boolean;
    remindDays?: number;
    lastCompletedDate?: string;
  }[];
  sessions: {
    id: string;
    categoryId: string;
    taskId: string;
    taskTitle: string;
    mode: string;
    startedAt: string;
    endedAt: string;
    durationSeconds: number;
    note: string;
    restMode?: string;
    restSeconds?: number;
  }[];
  completions?: {
    id: string;
    taskId: string;
    title: string;
    description?: string;
    engagement?: string;
    categoryId: string;
    section: 'project' | 'assignment' | 'errand';
    completedAt: string;
  }[];
};

const TABS = ['Categories', 'Tasks', 'Sessions'] as const;

declare global {
  interface Window {
    google?: {
      accounts?: {
        oauth2?: {
          initTokenClient: (config: {
            client_id: string;
            scope: string;
            callback: (response: { access_token?: string; expires_in?: number; error?: string }) => void;
          }) => { requestAccessToken: (options?: { prompt?: string }) => void };
        };
      };
    };
  }
}

let gisPromise: Promise<void> | null = null;
export function loadGis(): Promise<void> {
  if (typeof window === 'undefined') return Promise.reject(new Error('No window'));
  const extensionId = (globalThis as { chrome?: { runtime?: { id?: string } } }).chrome?.runtime?.id;
  if (extensionId) return Promise.reject(new Error('This extension cannot load Google sign-in from accounts.google.com. Add the Chrome extension client ID, then press Backup now again.'));
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  if (gisPromise) return gisPromise;
  gisPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => {
      gisPromise = null;
      reject(new Error('Could not load Google sign-in. Check your connection / ad blocker.'));
    };
    document.head.appendChild(script);
  });
  return gisPromise;
}

function boolCell(value: boolean): string {
  return value ? 'TRUE' : 'FALSE';
}

const RECORD_LABEL: Record<(typeof TABS)[number], string> = {
  Categories: 'Category',
  Tasks: 'Task',
  Sessions: 'Session',
};

const COMPLETION_COLUMNS = ['id', 'taskId', 'title', 'description', 'categoryId', 'categoryName', 'engagement', 'section', 'completedAt'] as const;

/** One table covering categories, tasks, sessions, and completed-task records. Empty cells are fields that record type does not use. */
export function storeToBackupCsvRows(store: SyncStore): string[][] {
  const tables = storeToRows(store);
  const categoryName = (id: string) => store.categories.find((c) => c.id === id)?.name ?? '';
  const completionHeader = [...COMPLETION_COLUMNS];
  const completionRows = (store.completions ?? []).map((item) => [
    item.id,
    item.taskId,
    item.title,
    item.description ?? '',
    item.categoryId,
    categoryName(item.categoryId),
    item.engagement ?? '',
    item.section,
    item.completedAt,
  ]);
  const columns = ['record'];
  for (const name of TABS) {
    for (const column of tables[name][0] ?? []) {
      if (!columns.includes(column)) columns.push(column);
    }
  }
  for (const column of completionHeader) {
    if (!columns.includes(column)) columns.push(column);
  }
  const rows: string[][] = [columns];
  for (const name of TABS) {
    const [header = [], ...body] = tables[name];
    const index = new Map(header.map((column, position) => [column, position]));
    for (const source of body) {
      rows.push(columns.map((column) => (column === 'record' ? RECORD_LABEL[name] : source[index.get(column) ?? -1] ?? '')));
    }
  }
  const completionIndex = new Map<string, number>(completionHeader.map((column, position) => [column, position]));
  for (const source of completionRows) {
    rows.push(columns.map((column) => (column === 'record' ? 'Completion' : source[completionIndex.get(column) ?? -1] ?? '')));
  }
  return rows;
}

function storeToRows(store: SyncStore): Record<(typeof TABS)[number], string[][]> {
  const categoryName = (id: string) => store.categories.find((c) => c.id === id)?.name ?? '';
  return {
    Categories: [
      ['id', 'name', 'color'],
      ...store.categories.map((c) => [c.id, c.name, c.color]),
    ],
    Tasks: [
      ['id', 'title', 'description', 'categoryId', 'categoryName', 'engagement', 'length', 'priority', 'createdAt', 'startDate', 'endDate', 'recurring', 'recurrence', 'completed', 'weeklyDays', 'monthlyDays', 'lastCompletedDate', 'intervalDays', 'remindBefore', 'remindDays'],
      ...store.tasks.map((t) => [
        t.id,
        t.title,
        t.description ?? '',
        t.categoryId ?? '',
        categoryName(t.categoryId ?? ''),
        t.engagement,
        t.length,
        String(t.priority ?? ''),
        t.createdAt ?? '',
        t.startDate ?? '',
        t.endDate ?? '',
        boolCell(Boolean(t.recurring)),
        t.recurrence ?? '',
        boolCell(Boolean(t.completed)),
        (t.weeklyDays ?? []).join(','),
        (t.monthlyDays ?? []).join(','),
        t.lastCompletedDate ?? '',
        String(t.intervalDays ?? ''),
        boolCell(Boolean(t.remindBefore)),
        String(t.remindDays ?? ''),
      ]),
    ],
    Sessions: [
      ['id', 'categoryId', 'categoryName', 'taskId', 'taskTitle', 'mode', 'startedAt', 'endedAt', 'durationSeconds', 'note', 'restMode', 'restSeconds'],
      ...store.sessions.map((s) => [
        s.id,
        s.categoryId ?? '',
        categoryName(s.categoryId ?? ''),
        s.taskId ?? '',
        s.taskTitle ?? '',
        s.mode,
        s.startedAt,
        s.endedAt,
        String(s.durationSeconds),
        s.note ?? '',
        s.restMode ?? '',
        String(s.restSeconds ?? 0),
      ]),
    ],
  };
}
