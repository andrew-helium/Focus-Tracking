export type GoogleSyncSettings = {
  clientId: string;
  sheetId: string;
  autoSync: boolean;
};

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
  }[];
};

const SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets';
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

export function extractSheetId(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return '';
  const match = trimmed.match(/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return match ? match[1] : trimmed;
}

function boolCell(value: boolean): string {
  return value ? 'TRUE' : 'FALSE';
}

const RECORD_LABEL: Record<(typeof TABS)[number], string> = {
  Categories: 'Category',
  Tasks: 'Task',
  Sessions: 'Session',
};

/** One table covering categories, tasks, and sessions. Empty cells are fields that record type does not use. */
export function storeToBackupCsvRows(store: SyncStore): string[][] {
  const tables = storeToRows(store);
  const columns = ['record'];
  for (const name of TABS) {
    for (const column of tables[name][0] ?? []) {
      if (!columns.includes(column)) columns.push(column);
    }
  }
  const rows: string[][] = [columns];
  for (const name of TABS) {
    const [header = [], ...body] = tables[name];
    const index = new Map(header.map((column, position) => [column, position]));
    for (const source of body) {
      rows.push(columns.map((column) => (column === 'record' ? RECORD_LABEL[name] : source[index.get(column) ?? -1] ?? '')));
    }
  }
  return rows;
}

export function storeToRows(store: SyncStore): Record<(typeof TABS)[number], string[][]> {
  const categoryName = (id: string) => store.categories.find((c) => c.id === id)?.name ?? '';
  return {
    Categories: [
      ['id', 'name', 'color'],
      ...store.categories.map((c) => [c.id, c.name, c.color]),
    ],
    Tasks: [
      ['id', 'title', 'description', 'categoryId', 'categoryName', 'engagement', 'length', 'priority', 'createdAt', 'startDate', 'endDate', 'recurring', 'recurrence', 'completed', 'weeklyDays', 'monthlyDays', 'lastCompletedDate'],
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
      ]),
    ],
    Sessions: [
      ['id', 'categoryId', 'categoryName', 'taskId', 'taskTitle', 'mode', 'startedAt', 'endedAt', 'durationSeconds', 'note'],
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
      ]),
    ],
  };
}

async function sheetsFetch(token: string, path: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(`https://sheets.googleapis.com/v4${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = (data as { error?: { message?: string } })?.error?.message || `Google Sheets error (${response.status})`;
    throw new Error(message);
  }
  return data;
}

export async function createSpreadsheet(token: string, title = 'Focus Tracker'): Promise<{ id: string; url: string }> {
  const data = (await sheetsFetch(token, '/spreadsheets', {
    method: 'POST',
    body: JSON.stringify({ properties: { title }, sheets: TABS.map((name) => ({ properties: { title: name } })) }),
  })) as { spreadsheetId?: string; spreadsheetUrl?: string };
  if (!data.spreadsheetId) throw new Error('Google did not return a spreadsheet id');
  return { id: data.spreadsheetId, url: data.spreadsheetUrl ?? `https://docs.google.com/spreadsheets/d/${data.spreadsheetId}` };
}

async function ensureTabs(token: string, sheetId: string): Promise<void> {
  const meta = (await sheetsFetch(token, `/spreadsheets/${sheetId}?fields=sheets.properties.title`)) as {
    sheets?: { properties?: { title?: string } }[];
  };
  const existing = new Set((meta.sheets ?? []).map((s) => s.properties?.title).filter(Boolean) as string[]);
  const missing = TABS.filter((name) => !existing.has(name));
  if (!missing.length) return;
  await sheetsFetch(token, `/spreadsheets/${sheetId}:batchUpdate`, {
    method: 'POST',
    body: JSON.stringify({ requests: missing.map((title) => ({ addSheet: { properties: { title } } })) }),
  });
}

export async function pushStore(token: string, sheetId: string, store: SyncStore): Promise<void> {
  await ensureTabs(token, sheetId);
  const rows = storeToRows(store);
  await sheetsFetch(token, `/spreadsheets/${sheetId}/values:batchClear`, {
    method: 'POST',
    body: JSON.stringify({ ranges: TABS.map((name) => `${name}!A1:Z`) }),
  });
  await sheetsFetch(token, `/spreadsheets/${sheetId}/values:batchUpdate`, {
    method: 'POST',
    body: JSON.stringify({
      valueInputOption: 'RAW',
      data: TABS.map((name) => ({ range: `${name}!A1`, values: rows[name] })),
    }),
  });
}
