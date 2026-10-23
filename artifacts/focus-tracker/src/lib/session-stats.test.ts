import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildChartData,
  resolveDefaultBars,
  unitBarsForSpan,
  fillBuckets,
  formatDurationShort,
  maxBarsForSpan,
  niceTimeTicks,
  ticksUpTo,
  yAxisScale,
  resolveRange,
  sliceBuckets,
  sliderNotches,
  spanDays,
  xAxisLabels,
  xLabelChoices,
  spreadCategoryViews,
  condenseCategoryViews,
  expandCategoryViews,
  changeCategoryViews,
  syncCategoryViews,
  categoryDropIndex,
  moveCategoryInViews,
  segmentsInStackOrder,
  type ChartSession,
} from './session-stats.ts';

const DAY = 86400000;

const sess = (overrides: Partial<ChartSession> = {}): ChartSession => ({
  startedAt: '2026-10-20T10:00:00',
  endedAt: '2026-10-20T10:25:00',
  durationSeconds: 1500,
  categoryId: 'cat-a',
  ...overrides,
});

test('week preset spans exactly 7 days ending today', () => {
  const now = new Date(2026, 9, 22, 15, 30).getTime(); // Oct 22 2026, local
  const range = resolveRange('week', '', '', now);
  assert.equal(range.error, undefined);
  assert.equal(spanDays(range.startMs, range.endMs), 7);
  assert.equal(new Date(range.startMs).getDate(), 16);
});

test('custom range rejects bad input', () => {
  const now = new Date(2026, 9, 22, 12).getTime();
  assert.match(resolveRange('custom', 'not-a-date', '2026-10-22', now).error ?? '', /start and end/);
  assert.match(resolveRange('custom', '2026-10-22', '2026-10-20', now).error ?? '', /before start/);
  assert.match(resolveRange('custom', '2020-01-01', '2026-10-22', now).error ?? '', /2 years/);
  assert.equal(resolveRange('custom', '2026-10-01', '2026-10-31', now).error, undefined);
});

test('slider caps at one bar per day, per hour for short spans', () => {
  assert.equal(maxBarsForSpan(0, DAY), 24);
  assert.equal(maxBarsForSpan(0, 30 * DAY), 30);
  assert.equal(maxBarsForSpan(0, 365 * DAY), 365);
});

test('notches mark 1 bar per day/week/month/year', () => {
  const month = sliderNotches(0, 30 * DAY);
  assert.deepEqual(month.map((n) => n.value), [1, 4, 30]);
  assert.deepEqual(month.map((n) => n.label), ['All', '1 bar/week', '1 bar/day']);
  const year = sliderNotches(0, 365 * DAY);
  assert.deepEqual(year.map((n) => n.value), [1, 12, 52, 365]);
  const twoYears = sliderNotches(0, 730 * DAY);
  assert.deepEqual(twoYears.map((n) => n.value), [1, 2, 24, 104, 730]);
  assert.equal(twoYears[1].label, '1 bar/year');
  const today = sliderNotches(0, DAY);
  assert.deepEqual(today.map((n) => n.value), [1, 24]);
  assert.equal(today[1].label, '1 bar/hour');
});

test('slices tile the range exactly', () => {
  const start = new Date(2026, 9, 1).getTime();
  const end = new Date(2026, 9, 31).getTime();
  const buckets = sliceBuckets(start, end, 10);
  assert.equal(buckets.length, 10);
  assert.equal(buckets[0].startMs, start);
  assert.equal(buckets[9].endMs, end);
  for (let i = 0; i < 9; i += 1) assert.equal(buckets[i].endMs, buckets[i + 1].startMs);
});

test('a session splits across the hours it covers', () => {
  const shells = sliceBuckets(new Date(2026, 9, 22).getTime(), new Date(2026, 9, 23).getTime(), 24);
  const buckets = fillBuckets(shells, [
    sess({ startedAt: '2026-10-22T10:40:00', endedAt: '2026-10-22T11:20:00', durationSeconds: 2400 }),
  ]);
  assert.equal(buckets[10].totalSeconds, 20 * 60);
  assert.equal(buckets[11].totalSeconds, 20 * 60);
  assert.equal(buckets[9].totalSeconds, 0);
  assert.equal(buckets[10].sessions, 1);
  assert.equal(buckets[11].sessions, 1);
});

test('a session splits across midnight, a month boundary, and a year boundary', () => {
  const days = sliceBuckets(new Date(2026, 9, 21).getTime(), new Date(2026, 9, 23).getTime(), 2);
  const overnight = fillBuckets(days, [
    sess({ startedAt: '2026-10-21T23:00:00', endedAt: '2026-10-22T01:00:00', durationSeconds: 7200 }),
  ]);
  assert.equal(overnight[0].totalSeconds, 3600);
  assert.equal(overnight[1].totalSeconds, 3600);

  const month = sliceBuckets(new Date(2026, 0, 31).getTime(), new Date(2026, 1, 2).getTime(), 2);
  const acrossMonth = fillBuckets(month, [
    sess({ startedAt: '2026-01-31T23:30:00', endedAt: '2026-02-01T01:00:00', durationSeconds: 5400 }),
  ]);
  assert.equal(acrossMonth[0].totalSeconds, 30 * 60);
  assert.equal(acrossMonth[1].totalSeconds, 60 * 60);

  const year = sliceBuckets(new Date(2026, 11, 31).getTime(), new Date(2027, 0, 2).getTime(), 2);
  const acrossYear = fillBuckets(year, [
    sess({ startedAt: '2026-12-31T22:00:00', endedAt: '2027-01-01T04:00:00', durationSeconds: 6 * 3600 }),
  ]);
  assert.equal(acrossYear[0].totalSeconds, 2 * 3600);
  assert.equal(acrossYear[1].totalSeconds, 4 * 3600);
});

test('time outside the chart window is left out and the session is counted once', () => {
  const now = new Date(2026, 9, 22, 15).getTime();
  const data = buildChartData(
    [sess({ startedAt: '2026-10-21T23:00:00', endedAt: '2026-10-22T01:00:00', durationSeconds: 7200 })],
    'today',
    24,
    '',
    '',
    now,
  );
  assert.equal(data.sessionCount, 1);
  assert.equal(data.totalSeconds, 3600);
  assert.equal(data.buckets[0].totalSeconds, 3600);
  assert.equal(data.buckets[1].totalSeconds, 0);
});

test('sessions of the same task combine inside a bar', () => {
  const shells = sliceBuckets(new Date(2026, 9, 22).getTime(), new Date(2026, 9, 23).getTime(), 24);
  const buckets = fillBuckets(shells, [
    sess({ taskId: 'essay', taskTitle: 'Essay', startedAt: '2026-10-22T10:00:00', durationSeconds: 600 }),
    sess({ taskId: 'essay', taskTitle: 'Essay', startedAt: '2026-10-22T10:20:00', durationSeconds: 900 }),
    sess({ taskId: 'notes', taskTitle: 'Notes', startedAt: '2026-10-22T10:40:00', durationSeconds: 300 }),
    sess({ taskId: 'essay', taskTitle: 'Essay', startedAt: '2026-10-22T10:50:00', durationSeconds: 20 * 60 }),
  ]);
  assert.deepEqual(
    buckets[10].byTask.map((task) => [task.title, task.seconds]),
    [['Essay', 2100], ['Notes', 300]],
  );
  assert.deepEqual(
    buckets[11].byTask.map((task) => [task.title, task.seconds]),
    [['Essay', 600]],
  );
});

test('bad sessions are skipped', () => {
  const shells = sliceBuckets(new Date(2026, 10, 1).getTime(), new Date(2026, 10, 3).getTime(), 2);
  const buckets = fillBuckets(shells, [
    sess({ startedAt: 'garbage', durationSeconds: 600 }),
    sess({ startedAt: '2026-11-01T10:00:00', durationSeconds: 0 }),
    sess({ startedAt: '2026-11-01T10:00:00', durationSeconds: 600 }),
  ]);
  assert.equal(buckets[0].totalSeconds, 600);
  assert.equal(buckets[0].sessions, 1);
});

test('duration formatting stays compact', () => {
  assert.equal(formatDurationShort(0), '0');
  assert.equal(formatDurationShort(45), '45s');
  assert.equal(formatDurationShort(1500), '25m');
  assert.equal(formatDurationShort(5400), '1.5h');
  assert.equal(formatDurationShort(7200), '2h');
});

test('axis ticks are round numbers', () => {
  assert.deepEqual(niceTimeTicks(0), [0]);
  assert.deepEqual(niceTimeTicks(5400), [0, 1800, 3600, 5400, 7200]);
});

test('axis interval sets the grid step and a drag sets the top', () => {
  assert.deepEqual(yAxisScale(5400, null, null).ticks, niceTimeTicks(5400));
  assert.deepEqual(yAxisScale(5000, null, 1800), { top: 5400, ticks: [0, 1800, 3600, 5400] });
  assert.deepEqual(yAxisScale(10000, 3600, 1800), { top: 3600, ticks: [0, 1800, 3600] });
  assert.deepEqual(ticksUpTo(0, 3600), [0]);
});

test('bar count is clamped instead of breaking', () => {
  const now = new Date(2026, 9, 22, 12).getTime();
  const data = buildChartData([], 'month', 999, '', '', now);
  assert.equal(data.bars, 30);
  assert.equal(data.buckets.length, 30);
});

test('unit bar counts match the slider notches', () => {
  assert.equal(unitBarsForSpan('day', 30), 30);
  assert.equal(unitBarsForSpan('week', 30), 4);
  assert.equal(unitBarsForSpan('month', 365), 12);
  assert.equal(unitBarsForSpan('hour', 1), 24);
});

test('x label choices follow the timeframe', () => {
  assert.deepEqual(xLabelChoices(0, DAY).map((c) => c.id), ['auto', 'hour-1', 'hour-2', 'hour-3', 'hour-4', 'hour-6', 'hour-12']);
  assert.deepEqual(xLabelChoices(0, 7 * DAY).map((c) => c.label), ['Auto', '1 day']);
  assert.deepEqual(xLabelChoices(0, 30 * DAY).map((c) => c.label), ['Auto', '1 day', '1 week']);
  assert.deepEqual(xLabelChoices(0, 365 * DAY).map((c) => c.label), ['Auto', '1 week', '1 month']);
  assert.equal(xLabelChoices(0, 365 * DAY).some((c) => c.id.startsWith('hour')), false);
});

test('x labels land on the chosen interval', () => {
  const start = new Date(2026, 9, 22).getTime();
  const hours = xAxisLabels(start, new Date(2026, 9, 23).getTime(), 'hour', 6);
  assert.deepEqual(hours.map((l) => l.atMs), [start, start + 6 * 3600000, start + 12 * 3600000, start + 18 * 3600000]);
  assert.deepEqual(hours.map((l) => l.text), ['12a', '6a', '12p', '6p']);
  const weekStart = new Date(2026, 9, 16).getTime();
  const days = xAxisLabels(weekStart, new Date(2026, 9, 23).getTime(), 'day', 1);
  assert.equal(days.length, 7);
  assert.equal(days[0].atMs, weekStart);
  const weeks = xAxisLabels(new Date(2026, 8, 23).getTime(), new Date(2026, 9, 23).getTime(), 'week', 1);
  assert.deepEqual(weeks.map((l) => new Date(l.atMs).getDate()), [27, 4, 11, 18]);
  const months = xAxisLabels(new Date(2026, 0, 1).getTime(), new Date(2027, 0, 1).getTime(), 'month', 1);
  assert.equal(months.length, 12);
  assert.equal(new Date(months[0].atMs).getMonth(), 0);
  assert.equal(new Date(months[11].atMs).getMonth(), 11);
});

test('configured defaults resolve and clamp', () => {
  assert.equal(resolveDefaultBars('week', 0, 30, 30), 4);
  assert.equal(resolveDefaultBars('custom', 10, 30, 30), 10);
  assert.equal(resolveDefaultBars('custom', 999, 30, 30), 30);
  assert.equal(resolveDefaultBars('custom', 0, 30, 30), 30);
  assert.equal(resolveDefaultBars('bogus', 0, 30, 30), 30);
});

test('month and year week bars follow the chosen week start', () => {
  const now = new Date(2026, 9, 22, 15).getTime();
  const early = sess({ startedAt: '2026-09-20T10:00:00', durationSeconds: 3600 });
  const todaySession = sess({ startedAt: '2026-10-22T09:00:00', durationSeconds: 600 });
  const sunday = buildChartData([early, todaySession], 'month', 4, '', '', now, null, 0);
  assert.equal(sunday.weekAligned, true);
  assert.equal(new Date(sunday.buckets[0].startMs).getDay(), 0);
  assert.equal(sunday.buckets[0].endMs - sunday.buckets[0].startMs, 7 * DAY);
  assert.equal(new Date(sunday.buckets[0].startMs).getDate(), 20);
  const lastSunday = sunday.buckets[sunday.buckets.length - 1];
  assert.equal(new Date(lastSunday.startMs).getDay(), 0);
  assert.equal(lastSunday.endMs, new Date(2026, 9, 23).getTime());
  assert.ok(lastSunday.endMs - lastSunday.startMs < 7 * DAY);
  assert.equal(sunday.buckets[0].totalSeconds, 3600);
  assert.equal(lastSunday.totalSeconds, 600);
  for (let i = 0; i < sunday.buckets.length - 1; i += 1) assert.equal(sunday.buckets[i].endMs, sunday.buckets[i + 1].startMs);

  const monday = buildChartData([early, todaySession], 'month', 4, '', '', now, null, 1);
  assert.equal(new Date(monday.buckets[0].startMs).getDay(), 1);
  assert.equal(new Date(monday.buckets[0].startMs).getDate(), 21);
  assert.equal(monday.buckets[0].endMs - monday.buckets[0].startMs, 7 * DAY);
  assert.equal(monday.buckets[0].totalSeconds, 0);
  const lastMonday = monday.buckets[monday.buckets.length - 1];
  assert.equal(new Date(lastMonday.startMs).getDate(), 19);
  assert.equal(lastMonday.endMs, new Date(2026, 9, 23).getTime());
  assert.equal(lastMonday.totalSeconds, 600);

  const labels = xAxisLabels(sunday.startMs, sunday.endMs, 'week', 1, 0);
  assert.deepEqual(labels.map((label) => label.atMs), sunday.buckets.map((bucket) => bucket.startMs));
  const mondayLabels = xAxisLabels(new Date(2026, 8, 23).getTime(), new Date(2026, 9, 23).getTime(), 'week', 1, 1);
  assert.deepEqual(mondayLabels.map((label) => new Date(label.atMs).getDate()), [28, 5, 12, 19]);
  assert.ok(mondayLabels.every((label) => new Date(label.atMs).getDay() === 1));

  const year = buildChartData([], 'year', 52, '', '', now, null, 0);
  assert.equal(year.weekAligned, true);
  assert.equal(new Date(year.buckets[0].startMs).getDay(), 0);
  assert.equal(year.buckets[0].endMs - year.buckets[0].startMs, 7 * DAY);
  assert.ok(year.buckets[year.buckets.length - 1].endMs - year.buckets[year.buckets.length - 1].startMs < 7 * DAY);

  const daily = buildChartData([], 'month', 30, '', '', now, null, 0);
  assert.equal(daily.weekAligned, false);
  assert.equal(daily.buckets.length, 30);
});

test('category views spread wide and leave extras on the left', () => {
  const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
  assert.deepEqual(spreadCategoryViews(ids, 1), [ids]);
  assert.deepEqual(spreadCategoryViews(ids, 3), [['a', 'b', 'c'], ['d', 'e'], ['f', 'g']]);
  assert.deepEqual(spreadCategoryViews(ids, 4), [['a', 'b'], ['c', 'd'], ['e', 'f'], ['g']]);
  assert.deepEqual(spreadCategoryViews(ids, 7), ids.map((id) => [id]));
  assert.deepEqual(spreadCategoryViews([], 2), [[], []]);
});

test('fewer views stack the right heading on top of the one beside it', () => {
  const stacks = [['a', 'b', 'c'], ['d', 'e'], ['f', 'g']];
  assert.deepEqual(condenseCategoryViews(stacks, 2), [['a', 'b', 'c'], ['f', 'g', 'd', 'e']]);
  assert.deepEqual(condenseCategoryViews(stacks, 1), [['f', 'g', 'd', 'e', 'a', 'b', 'c']]);
  const folded = changeCategoryViews(spreadCategoryViews(['a', 'b', 'c', 'd', 'e', 'f', 'g'], 4), 3, ['a', 'b', 'c', 'd', 'e', 'f', 'g'], false);
  assert.equal(folded.arranged, true);
  assert.deepEqual(folded.stacks, [['a', 'b'], ['c', 'd'], ['g', 'e', 'f']]);
  const added = changeCategoryViews(folded.stacks, 4, ['a', 'b', 'c', 'd', 'e', 'f', 'g'], true);
  assert.deepEqual(added.stacks, [['a', 'b'], ['c', 'd'], ['e', 'f'], ['g']]);
  const fresh = changeCategoryViews([['a', 'b', 'c', 'd', 'e', 'f', 'g']], 3, ['a', 'b', 'c', 'd', 'e', 'f', 'g'], false);
  assert.equal(fresh.arranged, true);
  assert.deepEqual(fresh.stacks, [['e', 'f', 'g'], ['b', 'c'], ['d', 'a']]);
  assert.deepEqual(expandCategoryViews([['a', 'b', 'c', 'd', 'e'], ['f'], ['g']], 4), [['b', 'c', 'd', 'e'], ['f'], ['g'], ['a']]);
});

test('new categories fill the shortest view until the user arranges the stacks', () => {
  const kept = syncCategoryViews([['a', 'b', 'c'], ['d']], ['a', 'b', 'c', 'd', 'e'], 2, true);
  assert.deepEqual(kept, [['a', 'b', 'c'], ['d', 'e']]);
  const respread = syncCategoryViews([['a', 'b'], ['c']], ['a', 'b', 'c', 'd'], 2, false);
  assert.deepEqual(respread, [['a', 'b'], ['c', 'd']]);
});

test('heading order draws the top category above the ones under it', () => {
  const drawn = segmentsInStackOrder(['reading', 'writing'], [
    { categoryId: 'writing', seconds: 10 },
    { categoryId: 'reading', seconds: 4 },
    { categoryId: 'other', seconds: 8 },
  ]);
  assert.deepEqual(drawn.map((segment) => segment.categoryId), ['writing', 'reading']);
  const moved = moveCategoryInViews([['reading', 'writing'], ['learning']], 'writing', 1, categoryDropIndex(['learning'], null, 'writing', 'after'));
  assert.deepEqual(moved, [['reading'], ['learning', 'writing']]);
  const reordered = moveCategoryInViews([['reading', 'writing', 'learning']], 'learning', 0, categoryDropIndex(['reading', 'writing', 'learning'], 'reading', 'learning', 'before'));
  assert.deepEqual(reordered, [['learning', 'reading', 'writing']]);
});
