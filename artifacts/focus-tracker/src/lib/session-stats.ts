// Pure date-bucketing logic for the Sessions visualization.
// Buckets are equal time slices of the selected range: the bar-count slider
// runs from 1 bar (whole range) up to one bar per day (or per hour for
// ranges of 3 days or less). Notches mark where each slice averages
// 1 hour / day / week / month / year so the scale stays readable.
// No DOM or React here so this module is unit-testable with node:test.

export type ChartSession = {
  startedAt: string;
  endedAt: string;
  durationSeconds: number;
  categoryId: string;
  taskId?: string;
  taskTitle?: string;
};

export type ChartCategory = { id: string; name: string; color: string };

export type ChartPreset = 'today' | 'week' | 'month' | 'year' | 'custom';

/** 0 = Sunday, 1 = Monday. Matches Date.getDay(). */
export type WeekStartsOn = 0 | 1;

export type BucketShell = {
  key: string;
  label: string;
  fullLabel: string;
  startMs: number;
  endMs: number;
};

export type ChartTaskTime = { key: string; title: string; categoryId: string; seconds: number };

export type ChartBucket = BucketShell & {
  totalSeconds: number;
  sessions: number;
  byCategory: { categoryId: string; seconds: number }[];
  byTask: ChartTaskTime[];
};

export type ChartRange = { startMs: number; endMs: number; error?: string };

export type ChartData = {
  error?: string;
  buckets: ChartBucket[];
  totalSeconds: number;
  sessionCount: number;
  activeBuckets: number;
  bestBucket: { label: string; fullLabel: string; totalSeconds: number } | null;
  rangeLabel: string;
  startMs: number;
  endMs: number;
  spanDays: number;
  bars: number;
  weekAligned: boolean;
};

export type SliderNotch = { value: number; label: string };

export const PRESET_LABELS: Record<ChartPreset, string> = {
  today: 'Today',
  week: 'Past week',
  month: 'Past month',
  year: 'Past year',
  custom: 'Custom',
};

const DAY_MS = 86400000;
const HOUR_MS = 3600000;
const MAX_CUSTOM_DAYS = 730;

const pad2 = (n: number): string => String(n).padStart(2, '0');

export function toDayKey(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function parseDayKey(key: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key.trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const dt = new Date(y, mo - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null;
  return dt;
}

export function startOfDay(d: Date): Date {
  const c = new Date(d);
  c.setHours(0, 0, 0, 0);
  return c;
}

export function addDays(d: Date, n: number): Date {
  const c = new Date(d);
  c.setDate(c.getDate() + n);
  return c;
}

export function startOfWeek(ms: number, weekStartsOn: WeekStartsOn): number {
  const start = startOfDay(new Date(ms));
  const delta = (start.getDay() - weekStartsOn + 7) % 7;
  return addDays(start, -delta).getTime();
}

/** Pull the start back to a week boundary so the oldest week is complete. A window that still reaches today keeps the current week unfinished. */
export function alignWeekRange(
  startMs: number,
  endMs: number,
  weekStartsOn: WeekStartsOn,
  nowMs = Date.now(),
): { startMs: number; endMs: number } {
  const todayEnd = startOfDay(new Date(nowMs)).getTime() + DAY_MS;
  const start = startOfWeek(startMs, weekStartsOn);
  let end = endMs;
  if (end < todayEnd) {
    const weekEnd = addDays(new Date(startOfWeek(end - 1, weekStartsOn)), 7).getTime();
    end = Math.min(weekEnd, todayEnd);
  }
  if (end <= start) end = Math.min(addDays(new Date(start), 7).getTime(), Math.max(end, todayEnd));
  return { startMs: start, endMs: end };
}

export function isWeekGranularity(startMs: number, endMs: number, bars: number): boolean {
  const slice = (endMs - startMs) / Math.max(1, Math.floor(bars) || 1);
  return bucketUnit(slice) === 'week';
}

export function spanDays(startMs: number, endMs: number): number {
  return Math.max(1, Math.round((endMs - startMs) / DAY_MS));
}

/** Most bars the slider offers: one per hour for short spans, else one per day. */
export function maxBarsForSpan(startMs: number, endMs: number): number {
  const span = spanDays(startMs, endMs);
  if (span <= 3) return Math.max(1, Math.round((endMs - startMs) / HOUR_MS));
  return span;
}

export function resolveRange(
  preset: ChartPreset,
  customStart: string,
  customEnd: string,
  nowMs = Date.now(),
): ChartRange {
  const todayStart = startOfDay(new Date(nowMs)).getTime();
  const endOfToday = todayStart + DAY_MS;
  if (preset === 'today') return { startMs: todayStart, endMs: endOfToday };
  if (preset === 'week') return { startMs: startOfDay(addDays(new Date(todayStart), -6)).getTime(), endMs: endOfToday };
  if (preset === 'month') return { startMs: startOfDay(addDays(new Date(todayStart), -29)).getTime(), endMs: endOfToday };
  if (preset === 'year') return { startMs: startOfDay(addDays(new Date(todayStart), -364)).getTime(), endMs: endOfToday };
  const start = parseDayKey(customStart);
  const end = parseDayKey(customEnd);
  const fallback = { startMs: startOfDay(addDays(new Date(todayStart), -29)).getTime(), endMs: endOfToday };
  if (!start || !end) return { ...fallback, error: 'Pick a start and end date.' };
  const startMs = startOfDay(start).getTime();
  const endMs = startOfDay(end).getTime() + DAY_MS;
  if (endMs <= startMs) return { startMs, endMs: startMs + DAY_MS, error: 'End date is before start date.' };
  if (spanDays(startMs, endMs) > MAX_CUSTOM_DAYS) {
    return { ...fallback, error: 'Choose a range up to 2 years.' };
  }
  return { startMs, endMs };
}

/** Average bucket size, for scale labels. */
export function bucketUnit(sliceMs: number): 'hour' | 'day' | 'week' | 'month' | 'year' {
  if (sliceMs >= 340 * DAY_MS) return 'year';
  if (sliceMs >= 27 * DAY_MS) return 'month';
  if (sliceMs >= 6.5 * DAY_MS) return 'week';
  if (sliceMs >= 20 * HOUR_MS) return 'day';
  return 'hour';
}

/** Slider landmarks: 1 bar, ~1 bar per hour/day/week/month/year, and the max. */
export function sliderNotches(startMs: number, endMs: number): SliderNotch[] {
  const max = maxBarsForSpan(startMs, endMs);
  const span = spanDays(startMs, endMs);
  const out: SliderNotch[] = [{ value: 1, label: 'All' }];
  if (max > span && span > 1) out.push({ value: span, label: '1 bar/day' });
  const candidates: [number, string][] = [
    [span / 7, '1 bar/week'],
    [span / 30.44, '1 bar/month'],
    [span / 365.25, '1 bar/year'],
  ];
  for (const [raw, label] of candidates) {
    const value = Math.round(raw);
    if (value >= 2 && value < max && !out.some((n) => n.value === value)) out.push({ value, label });
  }
  if (max > 1 && !out.some((n) => n.value === max)) {
    out.push({ value: max, label: `1 bar/${bucketUnit((endMs - startMs) / max)}` });
  }
  return out.sort((a, b) => a.value - b.value);
}

/** Sensible starting bar count for a fresh range (lands on a notch). */
export function defaultBars(preset: ChartPreset, span: number, max: number): number {
  let bars: number;
  if (preset === 'today') bars = max;
  else if (span <= 31) bars = span;
  else if (span <= 92) bars = Math.round(span / 7);
  else bars = Math.round(span / 30.44);
  return Math.min(max, Math.max(1, bars));
}

function hourShort(d: Date): string {
  const h = d.getHours();
  if (h === 0) return '12a';
  if (h < 12) return `${h}a`;
  if (h === 12) return '12p';
  return `${h - 12}p`;
}

function hourLong(d: Date): string {
  const h = d.getHours();
  const suffix = h < 12 ? 'AM' : 'PM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}${suffix}`;
}

function dayShort(d: Date): string {
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export type XLabelUnit = 'hour' | 'day' | 'week' | 'month';

export type XLabelChoice = { id: string; label: string; unit: XLabelUnit | null; step: number };

const HOUR_LABEL_STEPS = [1, 2, 3, 4, 6, 12];

/** Label steps that fit a window. An hour step is only offered for a single day. */
export function xLabelChoices(startMs: number, endMs: number): XLabelChoice[] {
  const days = Math.max(0, (endMs - startMs) / DAY_MS);
  const choices: XLabelChoice[] = [{ id: 'auto', label: 'Auto', unit: null, step: 1 }];
  if (days <= 1.5) {
    for (const step of HOUR_LABEL_STEPS) {
      choices.push({ id: `hour-${step}`, label: step === 1 ? '1 hour' : `${step} hours`, unit: 'hour', step });
    }
    return choices;
  }
  if (days <= 62) choices.push({ id: 'day-1', label: '1 day', unit: 'day', step: 1 });
  if (days >= 13 && days <= 400) choices.push({ id: 'week-1', label: '1 week', unit: 'week', step: 1 });
  if (days >= 56) choices.push({ id: 'month-1', label: '1 month', unit: 'month', step: 1 });
  return choices;
}

const X_INTERVAL_IDS = new Set(['hour-1', 'hour-2', 'hour-3', 'hour-4', 'hour-6', 'hour-12', 'day-1', 'week-1', 'month-1']);

export function knownXInterval(value: unknown): string | null {
  return typeof value === 'string' && X_INTERVAL_IDS.has(value) ? value : null;
}

export type XAxisLabel = { atMs: number; text: string };

/** Tick labels on calendar boundaries: hours from midnight, days, week starts, or month starts. */
export function xAxisLabels(
  startMs: number,
  endMs: number,
  unit: XLabelUnit,
  step: number,
  weekStartsOn: WeekStartsOn = 0,
): XAxisLabel[] {
  const labels: XAxisLabel[] = [];
  const span = endMs - startMs;
  if (unit === 'hour') {
    const cursor = startOfDay(new Date(startMs));
    while (cursor.getTime() < startMs || cursor.getHours() % step !== 0) cursor.setHours(cursor.getHours() + 1);
    while (cursor.getTime() < endMs) {
      labels.push({ atMs: cursor.getTime(), text: hourShort(cursor) });
      cursor.setHours(cursor.getHours() + step);
    }
    return labels;
  }
  if (unit === 'day') {
    let cursor = startOfDay(new Date(startMs));
    if (cursor.getTime() < startMs) cursor = addDays(cursor, 1);
    while (cursor.getTime() < endMs) {
      labels.push({ atMs: cursor.getTime(), text: dayShort(cursor) });
      cursor = addDays(cursor, step);
    }
    return labels;
  }
  if (unit === 'week') {
    let cursor = startOfDay(new Date(startMs));
    cursor = addDays(cursor, (weekStartsOn - cursor.getDay() + 7) % 7);
    while (cursor.getTime() < endMs) {
      if (cursor.getTime() >= startMs) labels.push({ atMs: cursor.getTime(), text: dayShort(cursor) });
      cursor = addDays(cursor, 7 * step);
    }
    return labels;
  }
  let cursor = new Date(new Date(startMs).getFullYear(), new Date(startMs).getMonth(), 1);
  if (cursor.getTime() < startMs) cursor = new Date(cursor.getFullYear(), cursor.getMonth() + step, 1);
  const withYear = span > 370 * DAY_MS;
  while (cursor.getTime() < endMs) {
    labels.push({
      atMs: cursor.getTime(),
      text: cursor.toLocaleDateString(undefined, withYear ? { month: 'short', year: '2-digit' } : { month: 'short' }),
    });
    cursor = new Date(cursor.getFullYear(), cursor.getMonth() + step, 1);
  }
  return labels;
}

export function sliceBuckets(startMs: number, endMs: number, count: number): BucketShell[] {
  const n = Math.max(1, Math.floor(count));
  const sliceMs = (endMs - startMs) / n;
  const hourly = sliceMs < 20 * HOUR_MS;
  const out: BucketShell[] = [];
  for (let i = 0; i < n; i += 1) {
    const s = i === 0 ? startMs : startMs + i * sliceMs;
    const e = i === n - 1 ? endMs : startMs + (i + 1) * sliceMs;
    const startD = new Date(s);
    const endD = new Date(Math.max(s + 1, e - 1));
    const sameDay = toDayKey(startD) === toDayKey(endD);
    out.push({
      key: `slice-${i}`,
      label: n === 1 ? 'All' : hourly ? hourShort(startD) : dayShort(startD),
      fullLabel: hourly
        ? `${dayShort(startD)}, ${hourLong(startD)} – ${hourLong(new Date(e))}`
        : sameDay
          ? startD.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })
          : `${dayShort(startD)} – ${dayShort(endD)}`,
      startMs: s,
      endMs: e,
    });
  }
  return out;
}

/** One bar per calendar week. The last bar stops at endMs, so the current week can be short. */
export function sliceWeekBuckets(startMs: number, endMs: number, weekStartsOn: WeekStartsOn): BucketShell[] {
  const out: BucketShell[] = [];
  let cursor = startOfWeek(startMs, weekStartsOn);
  let i = 0;
  while (cursor < endMs && i < 200) {
    const next = addDays(new Date(cursor), 7).getTime();
    const e = Math.min(next, endMs);
    const startD = new Date(cursor);
    const endD = new Date(Math.max(cursor + 1, e - 1));
    out.push({
      key: `week-${i}`,
      label: dayShort(startD),
      fullLabel: `${dayShort(startD)} – ${dayShort(endD)}`,
      startMs: cursor,
      endMs: e,
    });
    cursor = next;
    i += 1;
  }
  return out;
}

function sessionSpan(session: ChartSession): { start: number; end: number } | null {
  const start = Date.parse(session.startedAt);
  if (Number.isNaN(start)) return null;
  const seconds = Math.max(0, Math.floor(Number(session.durationSeconds) || 0));
  if (seconds <= 0) return null;
  return { start, end: start + seconds * 1000 };
}

/** Turn overlap lengths into whole seconds that still add up to the overlapped time. */
function allocateSeconds(overlapsMs: number[]): number[] {
  const raw = overlapsMs.map((ms) => ms / 1000);
  const target = Math.round(raw.reduce((sum, value) => sum + value, 0));
  const parts = raw.map((value) => Math.floor(value));
  let remain = target - parts.reduce((sum, value) => sum + value, 0);
  const order = raw
    .map((value, index) => ({ index, frac: value - Math.floor(value) }))
    .sort((a, b) => b.frac - a.frac || a.index - b.index);
  for (const item of order) {
    if (remain <= 0) break;
    parts[item.index] += 1;
    remain -= 1;
  }
  return parts;
}

function taskKey(session: ChartSession, categoryId: string): { key: string; title: string } {
  const taskId = typeof session.taskId === 'string' ? session.taskId : '';
  const title = typeof session.taskTitle === 'string' ? session.taskTitle.trim() : '';
  if (taskId) return { key: taskId, title: title || 'No task' };
  if (title) return { key: `title:${title}`, title };
  return { key: `none:${categoryId}`, title: 'No task' };
}

export function fillBuckets(shells: BucketShell[], sessions: ChartSession[]): ChartBucket[] {
  const buckets: ChartBucket[] = shells.map((s) => ({ ...s, totalSeconds: 0, sessions: 0, byCategory: [], byTask: [] }));
  for (const session of sessions) {
    const span = sessionSpan(session);
    if (!span) continue;
    const hits: { index: number; overlap: number }[] = [];
    for (let i = 0; i < buckets.length; i += 1) {
      const overlap = Math.min(span.end, buckets[i].endMs) - Math.max(span.start, buckets[i].startMs);
      if (overlap > 0) hits.push({ index: i, overlap });
    }
    if (!hits.length) continue;
    const shares = allocateSeconds(hits.map((hit) => hit.overlap));
    const catId = typeof session.categoryId === 'string' ? session.categoryId : '';
    const task = taskKey(session, catId);
    hits.forEach((hit, i) => {
      const seconds = shares[i];
      if (seconds <= 0) return;
      const bucket = buckets[hit.index];
      bucket.totalSeconds += seconds;
      bucket.sessions += 1;
      const existing = bucket.byCategory.find((c) => c.categoryId === catId);
      if (existing) existing.seconds += seconds;
      else bucket.byCategory.push({ categoryId: catId, seconds });
      const existingTask = bucket.byTask.find((item) => item.key === task.key);
      if (existingTask) {
        existingTask.seconds += seconds;
        if (existingTask.categoryId !== catId) {
          const current = bucket.byCategory.find((c) => c.categoryId === existingTask.categoryId)?.seconds ?? 0;
          const next = bucket.byCategory.find((c) => c.categoryId === catId)?.seconds ?? 0;
          if (next > current) existingTask.categoryId = catId;
        }
      } else bucket.byTask.push({ key: task.key, title: task.title, categoryId: catId, seconds });
    });
  }
  for (const bucket of buckets) {
    bucket.byCategory.sort((a, b) => b.seconds - a.seconds);
    bucket.byTask.sort((a, b) => b.seconds - a.seconds);
  }
  return buckets;
}

export function formatDurationShort(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  if (s === 0) return '0';
  if (s < 60) return `${s}s`;
  if (s < 3600) {
    const m = Math.round(s / 60);
    return m < 60 ? `${m}m` : '1h';
  }
  const h = s / 3600;
  return h < 10 ? `${Math.round(h * 10) / 10}h` : `${Math.round(h)}h`;
}

const TICK_STEPS = [60, 300, 900, 1800, 3600, 5400, 7200, 10800, 21600, 43200, 86400, 172800, 604800];

export const Y_INTERVALS: { seconds: number | null; label: string }[] = [
  { seconds: null, label: 'Auto' },
  { seconds: 15 * 60, label: '15 min' },
  { seconds: 30 * 60, label: '30 min' },
  { seconds: 60 * 60, label: '1 hour' },
  { seconds: 2 * 60 * 60, label: '2 hours' },
  { seconds: 4 * 60 * 60, label: '4 hours' },
  { seconds: 8 * 60 * 60, label: '8 hours' },
  { seconds: 24 * 60 * 60, label: '1 day' },
];

function niceStep(maxSeconds: number, count = 5): number {
  return TICK_STEPS.find((s) => s * (count - 1) >= maxSeconds) ?? Math.ceil(maxSeconds / (count - 1) / 3600) * 3600;
}

export function niceTimeTicks(maxSeconds: number, count = 5): number[] {
  if (maxSeconds <= 0) return [0];
  const step = niceStep(maxSeconds, count);
  let top = Math.ceil(maxSeconds / step) * step;
  if (top <= maxSeconds) top += step;
  const ticks: number[] = [];
  for (let v = 0; v <= top; v += step) ticks.push(v);
  return ticks;
}

/** Gridlines from 0 through max. A null interval picks a readable step; a set interval is kept, coarsened only when it would draw more than 8 lines. */
export function ticksUpTo(maxSeconds: number, intervalSeconds: number | null): number[] {
  const max = Math.max(0, maxSeconds);
  if (max <= 0) return [0];
  let step = intervalSeconds && intervalSeconds > 0 ? intervalSeconds : niceStep(max);
  if (max / step > 8) {
    const base = intervalSeconds && intervalSeconds > 0 ? intervalSeconds : step;
    step = Math.ceil(max / 8 / base) * base;
  }
  const ticks = [0];
  for (let v = step; v <= max + step * 0.001; v += step) ticks.push(Math.round(v));
  if (ticks[ticks.length - 1] > max + 1) ticks.pop();
  return ticks.length ? ticks : [0];
}

/** Top of the duration axis, plus the gridlines that fit it. */
export function yAxisScale(dataMaxSeconds: number, overrideSeconds: number | null, intervalSeconds: number | null): { top: number; ticks: number[] } {
  const dataMax = Math.max(0, dataMaxSeconds);
  if (overrideSeconds == null && (intervalSeconds == null || intervalSeconds <= 0)) {
    const ticks = niceTimeTicks(dataMax);
    return { top: ticks[ticks.length - 1] || 1, ticks };
  }
  if (overrideSeconds == null && intervalSeconds) {
    const top = Math.max(intervalSeconds, Math.ceil(Math.max(dataMax, 1) / intervalSeconds) * intervalSeconds);
    return { top, ticks: ticksUpTo(top, intervalSeconds) };
  }
  const top = Math.max(60, overrideSeconds ?? 60);
  return { top, ticks: ticksUpTo(top, intervalSeconds) };
}

export type BarsUnit = 'hour' | 'day' | 'week' | 'month' | 'year';

/** Bars for "1 bar per <unit>" over a span measured in fractional days. */
export function unitBarsForSpan(unit: BarsUnit, span: number): number {
  switch (unit) {
    case 'hour': return Math.max(1, Math.round(span * 24));
    case 'day': return Math.max(1, Math.round(span));
    case 'week': return Math.max(1, Math.round(span / 7));
    case 'month': return Math.max(1, Math.round(span / 30.44));
    case 'year': return Math.max(1, Math.round(span / 365.25));
  }
}

/** Resolve a configured default ({mode, bars}) to a bar count, clamped to [1, max]. */
export function resolveDefaultBars(mode: string, customBars: unknown, span: number, max: number): number {
  if (mode === 'custom') {
    const custom = Math.floor(Number(customBars));
    if (custom >= 1) return Math.min(max, custom);
  } else if (mode === 'hour' || mode === 'day' || mode === 'week' || mode === 'month' || mode === 'year') {
    return Math.min(max, unitBarsForSpan(mode, span));
  }
  return Math.min(max, Math.max(1, Math.round(span)));
}

function formatRangeDay(d: Date, withYear: boolean): string {  return d.toLocaleDateString(
    undefined,
    withYear ? { month: 'short', day: 'numeric', year: 'numeric' } : { month: 'short', day: 'numeric' },
  );
}

export function buildChartData(
  sessions: ChartSession[],
  preset: ChartPreset,
  bars: number,
  customStart: string,
  customEnd: string,
  nowMs = Date.now(),
  windowMs?: { startMs: number; endMs: number } | null,
  weekStartsOn: WeekStartsOn = 0,
): ChartData {
  const base = resolveRange(preset, customStart, customEnd, nowMs);
  let range = base;
  if (!base.error && windowMs && windowMs.endMs - windowMs.startMs >= 60_000 && windowMs.endMs - windowMs.startMs <= MAX_CUSTOM_DAYS * DAY_MS) {
    range = { startMs: windowMs.startMs, endMs: windowMs.endMs };
  }
  const weekly = !range.error && preset !== 'today' && preset !== 'week' && isWeekGranularity(range.startMs, range.endMs, bars);
  if (weekly) {
    const aligned = alignWeekRange(range.startMs, range.endMs, weekStartsOn, nowMs);
    range = { startMs: aligned.startMs, endMs: aligned.endMs };
  }
  const span = spanDays(range.startMs, range.endMs);
  const max = maxBarsForSpan(range.startMs, range.endMs);
  const effective = Math.min(max, Math.max(1, Math.floor(bars) || 1));
  const buckets = fillBuckets(
    weekly ? sliceWeekBuckets(range.startMs, range.endMs, weekStartsOn) : sliceBuckets(range.startMs, range.endMs, effective),
    sessions,
  );
  let totalSeconds = 0;
  let activeBuckets = 0;
  let best: ChartBucket | null = null;
  for (const b of buckets) {
    totalSeconds += b.totalSeconds;
    if (b.totalSeconds > 0) activeBuckets += 1;
    if (!best || b.totalSeconds > best.totalSeconds) best = b;
  }
  const sessionCount = sessions.reduce((count, session) => {
    const span = sessionSpan(session);
    return span && span.end > range.startMs && span.start < range.endMs ? count + 1 : count;
  }, 0);
  const startD = new Date(range.startMs);
  const endD = new Date(range.endMs - 1);
  const sameDay = toDayKey(startD) === toDayKey(endD);
  const rangeLabel = sameDay
    ? startD.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
    : startD.getFullYear() === endD.getFullYear()
      ? `${formatRangeDay(startD, false)} – ${formatRangeDay(endD, true)}`
      : `${formatRangeDay(startD, true)} – ${formatRangeDay(endD, true)}`;
  return {
    error: range.error,
    buckets,
    totalSeconds,
    sessionCount,
    activeBuckets,
    bestBucket: best && best.totalSeconds > 0 ? { label: best.label, fullLabel: best.fullLabel, totalSeconds: best.totalSeconds } : null,
    rangeLabel,
    startMs: range.startMs,
    endMs: range.endMs,
    spanDays: span,
    bars: buckets.length,
    weekAligned: weekly,
  };
}

/** Split categories across views. Earlier views receive the extra categories. */
export function spreadCategoryViews(categoryIds: string[], viewCount: number): string[][] {
  const ids = [...categoryIds];
  const slots = Math.max(1, Math.floor(viewCount) || 1);
  const stacks: string[][] = Array.from({ length: slots }, () => []);
  if (!ids.length) return stacks;
  const base = Math.floor(ids.length / slots);
  let extra = ids.length % slots;
  let cursor = 0;
  for (let i = 0; i < slots; i += 1) {
    const count = base + (extra > 0 ? 1 : 0);
    if (extra > 0) extra -= 1;
    stacks[i] = ids.slice(cursor, cursor + count);
    cursor += count;
  }
  return stacks;
}

/**
 * Add views by peeling the fullest stack. Its top category moves into the new view first,
 * and ties go to the rightmost stack so the views on the left stay fuller.
 */
export function expandCategoryViews(stacks: string[][], nextCount: number): string[][] {
  const next = Math.max(1, Math.floor(nextCount) || 1);
  const columns = (stacks.length ? stacks : [[]]).map((column) => [...column]);
  while (columns.length < next) {
    columns.push([]);
    const total = columns.reduce((sum, column) => sum + column.length, 0);
    const share = Math.floor(total / columns.length);
    const newest = columns.length - 1;
    while (columns[newest].length < share) {
      let fullest = -1;
      for (let i = 0; i < newest; i += 1) {
        if (fullest < 0 || columns[i].length >= columns[fullest].length) fullest = i;
      }
      if (fullest < 0 || columns[fullest].length === 0) break;
      const top = columns[fullest].shift();
      if (top === undefined) break;
      columns[newest].push(top);
    }
  }
  return columns;
}

/** Fold the rightmost heading onto the view beside it, keeping that heading on top. */
export function condenseCategoryViews(stacks: string[][], nextCount: number): string[][] {
  const next = Math.max(1, Math.floor(nextCount) || 1);
  const columns = stacks.map((column) => [...column]);
  while (columns.length > next) {
    const right = columns.pop() ?? [];
    const left = columns.pop() ?? [];
    columns.push([...right, ...left]);
  }
  while (columns.length < next) columns.push([]);
  return columns;
}

export function changeCategoryViews(
  stacks: string[][],
  nextCount: number,
  categoryIds: string[],
  arranged: boolean,
): { stacks: string[][]; arranged: boolean } {
  const max = Math.max(1, categoryIds.length);
  const next = Math.min(max, Math.max(1, Math.floor(nextCount) || 1));
  const columns = stacks.length ? stacks : [[]];
  const current = columns.length;
  if (next < current) return { stacks: condenseCategoryViews(columns, next), arranged: true };
  if (next > current) return { stacks: expandCategoryViews(columns, next), arranged: true };
  return { stacks: columns.map((column) => [...column]), arranged };
}

/** Keep the user's stacks when the selected categories change, and refill from the spread until they arrange them. */
export function syncCategoryViews(stacks: string[][], categoryIds: string[], viewCount: number, arranged: boolean): string[][] {
  const max = Math.max(1, categoryIds.length);
  const count = Math.min(max, Math.max(1, Math.floor(viewCount) || 1));
  if (!arranged) return spreadCategoryViews(categoryIds, count);
  const allowed = new Set(categoryIds);
  const columns = stacks.map((column) => column.filter((id) => allowed.has(id)));
  const seen = new Set(columns.flat());
  for (const id of categoryIds) {
    if (seen.has(id)) continue;
    if (!columns.length) columns.push([]);
    let best = 0;
    for (let i = 1; i < columns.length; i += 1) {
      if (columns[i].length < columns[best].length) best = i;
    }
    columns[best] = [...columns[best], id];
    seen.add(id);
  }
  return changeCategoryViews(columns, count, categoryIds, true).stacks;
}

export function categoryDropIndex(column: string[], targetId: string | null, dragId: string, place: 'before' | 'after'): number {
  const without = column.filter((id) => id !== dragId);
  if (!targetId) return without.length;
  const index = without.indexOf(targetId);
  if (index < 0) return without.length;
  return place === 'after' ? index + 1 : index;
}

export function moveCategoryInViews(stacks: string[][], categoryId: string, toView: number, toIndex: number): string[][] {
  const columns = stacks.map((column) => column.filter((id) => id !== categoryId));
  if (!columns.length) return [[categoryId]];
  const view = Math.min(columns.length - 1, Math.max(0, toView));
  const index = Math.min(columns[view].length, Math.max(0, toIndex));
  const next = columns[view].slice();
  next.splice(index, 0, categoryId);
  columns[view] = next;
  return columns;
}

/** Heading order is top to bottom. Drawing runs bottom to top so the first name sits on top of the bar. */
export function segmentsInStackOrder<T extends { categoryId: string; seconds: number }>(orderTopToBottom: string[], segments: T[]): T[] {
  const byId = new Map(segments.map((segment) => [segment.categoryId, segment]));
  const drawn: T[] = [];
  for (let i = orderTopToBottom.length - 1; i >= 0; i -= 1) {
    const segment = byId.get(orderTopToBottom[i]);
    if (segment && segment.seconds > 0) drawn.push(segment);
  }
  return drawn;
}
