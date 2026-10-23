import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import {
  addDays,
  bucketUnit,
  buildChartData,
  formatDurationShort,
  maxBarsForSpan,
  resolveDefaultBars,
  resolveRange,
  sliderNotches,
  spanDays,
  startOfDay,
  toDayKey,
  knownXInterval,
  xAxisLabels,
  xLabelChoices,
  yAxisScale,
  Y_INTERVALS,
  PRESET_LABELS,
  syncCategoryViews,
  changeCategoryViews,
  moveCategoryInViews,
  categoryDropIndex,
  segmentsInStackOrder,
  type ChartBucket,
  type ChartCategory,
  type ChartPreset,
  type ChartSession,
  type WeekStartsOn,
} from './session-stats';

export type ChartDefaults = Record<ChartPreset, { mode: 'hour' | 'day' | 'week' | 'month' | 'year' | 'custom'; bars: number }>;

type ChartPrefs = {
  preset: ChartPreset;
  customStart: string;
  customEnd: string;
  lastBars: Partial<Record<ChartPreset, number>>;
  yInterval: number | null;
  xInterval: string | null;
  viewCount: number;
  viewStacks: string[][];
  viewsArranged: boolean;
  showStacks: boolean;
  chartHeight: number | null;
  axisFontSize: number | null;
};

const DAY_MS = 86400000;
const PAN_PAST_MS = 5 * 365 * DAY_MS;

function knownYInterval(value: unknown): number | null {
  const n = Number(value);
  return Y_INTERVALS.some((item) => item.seconds === n) ? n : null;
}

const PREFS_KEY = 'focus-tracker-sessions-chart';
const UNCATEGORIZED_COLOR = '#9aa69f';
const ERROR_RED = '#b3261e';

const PRESETS = Object.keys(PRESET_LABELS) as ChartPreset[];

function themeColor(variable: string, fallback: string): string {
  try {
    const raw = getComputedStyle(document.documentElement).getPropertyValue(variable).trim();
    return raw ? `hsl(${raw})` : fallback;
  } catch {
    return fallback;
  }
}

function defaultCustomRange(): { customStart: string; customEnd: string } {
  const end = new Date();
  return { customStart: toDayKey(addDays(end, -29)), customEnd: toDayKey(end) };
}

function readStacks(value: unknown): string[][] {
  if (!Array.isArray(value)) return [];
  return value.filter(Array.isArray).map((column) => column.filter((id): id is string => typeof id === 'string'));
}

function readPrefs(): ChartPrefs {
  const fallback: ChartPrefs = {
    preset: 'month',
    ...defaultCustomRange(),
    lastBars: {},
    yInterval: null,
    xInterval: null,
    viewCount: 1,
    viewStacks: [],
    viewsArranged: false,
    showStacks: true,
    chartHeight: null,
    axisFontSize: null,
  };
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<ChartPrefs> & { bars?: unknown };
    const preset = PRESETS.includes(parsed.preset as ChartPreset) ? (parsed.preset as ChartPreset) : fallback.preset;
    const customStart = typeof parsed.customStart === 'string' && parsed.customStart ? parsed.customStart : fallback.customStart;
    const customEnd = typeof parsed.customEnd === 'string' && parsed.customEnd ? parsed.customEnd : fallback.customEnd;
    const lastBars: Partial<Record<ChartPreset, number>> = {};
    if (parsed.lastBars && typeof parsed.lastBars === 'object') {
      for (const p of PRESETS) {
        const v = (parsed.lastBars as Record<string, unknown>)[p];
        if (typeof v === 'number' && v >= 1) lastBars[p] = Math.floor(v);
      }
    } else if (typeof parsed.bars === 'number' && parsed.bars >= 1) {
      lastBars[preset] = Math.floor(parsed.bars);
    }
    const viewCount = typeof parsed.viewCount === 'number' && parsed.viewCount >= 1 ? Math.floor(parsed.viewCount) : 1;
    return {
      preset,
      customStart,
      customEnd,
      lastBars,
      yInterval: knownYInterval(parsed.yInterval),
      xInterval: knownXInterval(parsed.xInterval),
      viewCount,
      viewStacks: readStacks(parsed.viewStacks),
      viewsArranged: parsed.viewsArranged === true,
      showStacks: parsed.showStacks !== false,
      chartHeight: readOptionalRange(parsed.chartHeight, CHART_HEIGHT_MIN, CHART_HEIGHT_MAX),
      axisFontSize: readOptionalRange(parsed.axisFontSize, AXIS_FONT_MIN, AXIS_FONT_MAX),
    };
  } catch {
    return fallback;
  }
}

const CHART_W = 720;
const CHART_HEIGHT_DEFAULT = 320;
const CHART_HEIGHT_MIN = 160;
const CHART_HEIGHT_MAX = 720;
const AXIS_FONT_DEFAULT = 11;
const AXIS_FONT_MIN = 8;
const AXIS_FONT_MAX = 24;
const HEIGHT_AUTO = CHART_HEIGHT_MIN - 10;
const FONT_AUTO = AXIS_FONT_MIN - 1;
const SLIDER_THUMB = 16;

function readOptionalRange(value: unknown, min: number, max: number): number | null {
  if (value == null || value === 'auto') return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.min(max, Math.max(min, Math.round(n)));
}

/** Auto height follows the full chart row, so extra views keep the same height. */
function autoChartHeight(rowWidth: number): number {
  const raw = Math.round((Math.max(1, rowWidth) * CHART_HEIGHT_DEFAULT) / CHART_W / 10) * 10;
  return Math.min(CHART_HEIGHT_MAX, Math.max(CHART_HEIGHT_MIN, raw));
}

/** Auto font size stays in proportion to the graph height. */
function autoAxisFont(height: number): number {
  const raw = Math.round((height / CHART_HEIGHT_DEFAULT) * AXIS_FONT_DEFAULT);
  return Math.min(AXIS_FONT_MAX, Math.max(AXIS_FONT_MIN, raw));
}

type ChartHover = { view: number; index: number; kind: 'tasks' | 'categories'; categoryId: string };

export function SessionsChart({
  sessions,
  categories,
  categoryIds,
  chartDefaults,
  rememberLast,
  weekStartsOn,
}: {
  sessions: ChartSession[];
  categories: ChartCategory[];
  categoryIds: string[];
  chartDefaults: ChartDefaults;
  rememberLast: boolean;
  weekStartsOn: WeekStartsOn;
}) {
  const [prefs, setPrefs] = useState<ChartPrefs>(readPrefs);
  const [barsOverride, setBarsOverride] = useState<number | null>(null);
  const [hover, setHover] = useState<ChartHover | null>(null);
  const [panMs, setPanMs] = useState(0);
  const [yMaxOverride, setYMaxOverride] = useState<number | null>(null);
  const [dropHint, setDropHint] = useState<{ view: number; index: number } | null>(null);
  const [chartWidth, setChartWidth] = useState(CHART_W);
  const [rowWidth, setRowWidth] = useState(CHART_W);
  const chartBoxRef = useRef<HTMLDivElement | null>(null);
  const chartRowRef = useRef<HTMLDivElement | null>(null);
  const dragId = useRef('');

  useEffect(() => {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    } catch {
      /* private mode — prefs just won't persist */
    }
  }, [prefs]);

  const muted = useMemo(() => themeColor('--muted-foreground', '#6b7280'), []);
  const grid = useMemo(() => themeColor('--border', '#e5e0d5'), []);
  const card = useMemo(() => themeColor('--card', '#ffffff'), []);
  const cardFg = useMemo(() => themeColor('--card-foreground', '#1c1c1c'), []);
  const primary = useMemo(() => themeColor('--primary', '#2f6b5e'), []);

  const colorOf = (categoryId: string): string => {
    if (!categoryId) return UNCATEGORIZED_COLOR;
    return categories.find((c) => c.id === categoryId)?.color ?? UNCATEGORIZED_COLOR;
  };
  const nameOf = (categoryId: string): string => {
    if (!categoryId) return 'Uncategorized';
    return categories.find((c) => c.id === categoryId)?.name ?? 'Uncategorized';
  };

  const range = useMemo(
    () => resolveRange(prefs.preset, prefs.customStart, prefs.customEnd),
    [prefs.preset, prefs.customStart, prefs.customEnd],
  );
  const clampPan = (next: number): number => {
    if (range.error) return 0;
    const span = range.endMs - range.startMs;
    const todayEnd = startOfDay(new Date()).getTime() + DAY_MS;
    const minStart = todayEnd - PAN_PAST_MS;
    const maxEnd = todayEnd + span;
    let start = range.startMs + next;
    let end = range.endMs + next;
    if (end > maxEnd) {
      const shift = end - maxEnd;
      start -= shift;
      end -= shift;
    }
    if (start < minStart) {
      const shift = minStart - start;
      start += shift;
    }
    return start - range.startMs;
  };
  const pan = range.error ? 0 : clampPan(panMs);
  const viewStart = range.startMs + pan;
  const viewEnd = range.endMs + pan;
  const maxBars = useMemo(() => maxBarsForSpan(viewStart, viewEnd), [viewStart, viewEnd]);
  const notches = useMemo(() => sliderNotches(viewStart, viewEnd), [viewStart, viewEnd]);
  const spanFloat = (viewEnd - viewStart) / DAY_MS;

  const remembered = rememberLast ? prefs.lastBars[prefs.preset] : undefined;
  const rememberedValid = typeof remembered === 'number' && remembered >= 1 && remembered <= maxBars ? Math.floor(remembered) : undefined;
  const fallbackDef = { mode: 'day' as const, bars: 30 };
  const def = chartDefaults[prefs.preset] ?? fallbackDef;
  const defaulted = resolveDefaultBars(def.mode, def.bars, spanFloat, maxBars);
  const bars = barsOverride ?? rememberedValid ?? defaulted;

  const data = useMemo(
    () =>
      buildChartData(
        sessions,
        prefs.preset,
        bars,
        prefs.customStart,
        prefs.customEnd,
        Date.now(),
        pan === 0 ? null : { startMs: viewStart, endMs: viewEnd },
        weekStartsOn,
      ),
    [sessions, prefs.preset, bars, prefs.customStart, prefs.customEnd, pan, viewStart, viewEnd, weekStartsOn],
  );

  const resetAxes = () => {
    setPanMs(0);
    setYMaxOverride(null);
    setHover(null);
  };

  const choosePreset = (preset: ChartPreset) => {
    setPrefs((prev) => ({ ...prev, preset }));
    setBarsOverride(null);
    resetAxes();
  };

  const changeCustom = (field: 'customStart' | 'customEnd', value: string) => {
    setPrefs((prev) => ({ ...prev, [field]: value }));
    setBarsOverride(null);
    resetAxes();
  };

  const setBars = (value: number) => {
    const v = Math.min(maxBars, Math.max(1, Math.floor(value) || 1));
    setBarsOverride(v);
    if (rememberLast) setPrefs((prev) => ({ ...prev, lastBars: { ...prev.lastBars, [prev.preset]: v } }));
  };

  const maxViews = Math.max(1, categoryIds.length);
  const viewStacks = useMemo(
    () => syncCategoryViews(prefs.viewStacks, categoryIds, Math.min(maxViews, prefs.viewCount), prefs.viewsArranged),
    [prefs.viewStacks, prefs.viewCount, prefs.viewsArranged, categoryIds, maxViews],
  );
  const setViews = (value: number) => {
    setPrefs((prev) => {
      const current = syncCategoryViews(prev.viewStacks, categoryIds, Math.min(maxViews, prev.viewCount), prev.viewsArranged);
      const changed = changeCategoryViews(current, value, categoryIds, prev.viewsArranged);
      return { ...prev, viewCount: changed.stacks.length, viewStacks: changed.stacks, viewsArranged: changed.arranged };
    });
    setHover(null);
  };
  const placeCategory = (categoryId: string, toView: number, toIndex: number) => {
    setPrefs((prev) => {
      const current = syncCategoryViews(prev.viewStacks, categoryIds, Math.min(maxViews, prev.viewCount), prev.viewsArranged);
      return {
        ...prev,
        viewsArranged: true,
        viewCount: current.length,
        viewStacks: moveCategoryInViews(current, categoryId, toView, toIndex),
      };
    });
    setDropHint(null);
    dragId.current = '';
  };

  const buckets = data.buckets;
  const secondsInView = (bucket: ChartBucket, order: string[]): number => {
    const ids = new Set(order);
    return bucket.byCategory.reduce((sum, seg) => (ids.has(seg.categoryId) ? sum + seg.seconds : sum), 0);
  };
  const maxTotal = viewStacks.reduce(
    (max, order) => buckets.reduce((inner, bucket) => Math.max(inner, secondsInView(bucket, order)), max),
    0,
  );
  const scaled = yAxisScale(maxTotal, yMaxOverride, prefs.yInterval);
  const ticks = scaled.ticks;
  const top = scaled.top;
  const axesMoved = pan !== 0 || yMaxOverride != null;
  const showStacks = prefs.showStacks;
  const chartHeight = prefs.chartHeight ?? autoChartHeight(rowWidth);
  const axisFontSize = prefs.axisFontSize ?? autoAxisFont(chartHeight);
  const marginLeft = Math.max(40, Math.round(axisFontSize * 4.4));
  const marginRight = 12;
  const marginTop = Math.max(10, Math.round(axisFontSize * 0.7));
  const plotW = Math.max(40, chartWidth - marginLeft - marginRight);
  const xChoices = xLabelChoices(viewStart, viewEnd);
  const xSelected = xChoices.find((choice) => choice.id === prefs.xInterval) ?? xChoices[0];
  const manualLabels = xSelected.unit ? xAxisLabels(data.startMs, data.endMs, xSelected.unit, xSelected.step, weekStartsOn) : null;
  const labelEvery = Math.max(1, Math.ceil(buckets.length / 12));
  const axisLabels =
    manualLabels ??
    buckets.filter((_, index) => index % labelEvery === 0).map((bucket) => ({ atMs: bucket.startMs, text: bucket.label }));
  const rotateXLabels = axisLabels.length * axisFontSize * 4.2 > plotW;
  const desiredBottom = rotateXLabels ? Math.max(48, Math.round(axisFontSize * 5)) : Math.max(24, Math.round(axisFontSize + 18));
  const xAxisBottom = Math.min(desiredBottom, Math.max(18, chartHeight - marginTop - 40));
  const plotH = Math.max(24, chartHeight - marginTop - xAxisBottom);
  const svgHeight = marginTop + plotH + xAxisBottom;
  const margin = { left: marginLeft, right: marginRight, top: marginTop, bottom: xAxisBottom };

  useEffect(() => {
    const chartNode = chartBoxRef.current;
    const rowNode = chartRowRef.current;
    if (!chartNode && !rowNode) return;
    const update = () => {
      if (chartNode) {
        const next = Math.round(chartNode.clientWidth);
        if (next > 0) setChartWidth((prev) => (prev === next ? prev : next));
      }
      if (rowNode) {
        const next = Math.round(rowNode.clientWidth);
        if (next > 0) setRowWidth((prev) => (prev === next ? prev : next));
      }
    };
    update();
    const observer = new ResizeObserver(update);
    if (chartNode) observer.observe(chartNode);
    if (rowNode) observer.observe(rowNode);
    return () => observer.disconnect();
  }, [viewStacks.length, showStacks, data.error]);

  const svgUnit = (axis: 'x' | 'y', svg: SVGSVGElement | null): number => {
    const rect = svg?.getBoundingClientRect();
    if (!rect) return 1;
    const size = axis === 'x' ? rect.width / chartWidth : rect.height / svgHeight;
    return size > 0 ? size : 1;
  };

  const startYDrag = (event: ReactPointerEvent) => {
    event.preventDefault();
    const originY = event.clientY;
    const originMax = top;
    const svg = event.currentTarget instanceof SVGElement ? event.currentTarget.ownerSVGElement : null;
    const scale = svgUnit('y', svg);
    const move = (ev: PointerEvent) => {
      const dy = (ev.clientY - originY) / scale;
      setYMaxOverride(Math.max(60, originMax * Math.exp(dy / plotH)));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const startXDrag = (event: ReactPointerEvent) => {
    if (range.error) return;
    event.preventDefault();
    const originX = event.clientX;
    const originPan = pan;
    const span = viewEnd - viewStart;
    const svg = event.currentTarget instanceof SVGElement ? event.currentTarget.ownerSVGElement : null;
    const scale = svgUnit('x', svg);
    const move = (ev: PointerEvent) => {
      const dx = (ev.clientX - originX) / scale;
      let next = originPan - (dx / plotW) * span;
      if (data.weekAligned) next = Math.round(next / (7 * DAY_MS)) * (7 * DAY_MS);
      setPanMs(clampPan(next));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  const y = (v: number): number => margin.top + plotH - (v / top) * plotH;
  const spanMs = Math.max(1, data.endMs - data.startMs);
  const xAt = (ms: number): number => margin.left + ((ms - data.startMs) / spanMs) * plotW;
  const bestUnit = bucketUnit((data.endMs - data.startMs) / Math.max(1, bars));
  const bestUnitLabel = bestUnit[0].toUpperCase() + bestUnit.slice(1);

  const categoryTotals = useMemo(() => {
    const totals = new Map<string, number>();
    for (const bucket of buckets) for (const seg of bucket.byCategory) totals.set(seg.categoryId, (totals.get(seg.categoryId) ?? 0) + seg.seconds);
    return totals;
  }, [buckets]);

  const hoverBucket = hover && hover.index >= 0 && hover.index < buckets.length ? buckets[hover.index] : null;
  const hoverOrder = hover ? viewStacks[hover.view] ?? [] : [];
  const hoverLeftPct = hoverBucket
    ? Math.min(82, Math.max(18, (((xAt(hoverBucket.startMs) + xAt(hoverBucket.endMs)) / 2 / chartWidth) * 100)))
    : 0;
  const hoverCategory = hover?.kind === 'tasks' && hoverBucket ? hoverBucket.byCategory.find((seg) => seg.categoryId === hover.categoryId) : null;
  const hoverTasks = hover?.kind === 'tasks' && hoverBucket ? hoverBucket.byTask.filter((task) => task.categoryId === hover.categoryId) : [];
  const hoverOverview = hoverBucket ? hoverOrder.flatMap((id) => {
    const seg = hoverBucket.byCategory.find((item) => item.categoryId === id);
    return seg && seg.seconds > 0 ? [seg] : [];
  }) : [];
  const hoverViewSeconds = hoverOverview.reduce((sum, seg) => sum + seg.seconds, 0);
  const headingSlots = Math.max(1, ...viewStacks.map((stack) => stack.length));

  return (
    <div>
      <div className="toolbar" style={{ marginBottom: 4 }}>
        <div className="segmented" role="group" aria-label="Chart time range">
          {PRESETS.map((p) => (
            <button
              key={p}
              type="button"
              className={prefs.preset === p ? 'selected' : ''}
              aria-pressed={prefs.preset === p}
              onClick={() => choosePreset(p)}
              data-testid={`button-chart-preset-${p}`}
            >
              {PRESET_LABELS[p]}
            </button>
          ))}
        </div>
      </div>
      {prefs.preset === 'custom' && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 4 }}>
          <input
            type="date"
            className="input"
            style={{ width: 152 }}
            aria-label="Custom range start date"
            value={prefs.customStart}
            onChange={(e) => changeCustom('customStart', e.target.value)}
            data-testid="input-chart-start"
          />
          <span className="row-sub">to</span>
          <input
            type="date"
            className="input"
            style={{ width: 152 }}
            aria-label="Custom range end date"
            value={prefs.customEnd}
            onChange={(e) => changeCustom('customEnd', e.target.value)}
            data-testid="input-chart-end"
          />
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: 'auto minmax(0, 1fr) auto', columnGap: 12, rowGap: 8, alignItems: 'center', margin: '6px 0 2px' }}>
        <span className="quiet-label" style={{ whiteSpace: 'nowrap', gridColumn: 1, gridRow: 1 }}>
          Views
        </span>
        <input
          type="range"
          min={1}
          max={maxViews}
          step={1}
          value={Math.min(maxViews, viewStacks.length)}
          onChange={(e) => setViews(Number(e.target.value))}
          aria-label="Number of views"
          data-testid="input-chart-views"
          style={{ gridColumn: 2, gridRow: 1, width: '100%', accentColor: primary, margin: 0 }}
        />
        <span className="badge" data-testid="chart-view-count" style={{ whiteSpace: 'nowrap', gridColumn: 3, gridRow: 1 }}>
          {viewStacks.length} {viewStacks.length === 1 ? 'view' : 'views'}
        </span>
        <span className="quiet-label" style={{ whiteSpace: 'nowrap', gridColumn: 1, gridRow: 2 }}>
          Bars
        </span>
        <input
          type="range"
          min={1}
          max={maxBars}
          step={1}
          value={bars}
          onChange={(e) => setBars(Number(e.target.value))}
          aria-label="Number of bars"
          data-testid="input-chart-bars"
          style={{ gridColumn: 2, gridRow: 2, width: '100%', accentColor: primary, margin: 0 }}
        />
        <span className="badge" data-testid="chart-bar-count" style={{ whiteSpace: 'nowrap', gridColumn: 3, gridRow: 2 }}>
          {data.weekAligned ? `${buckets.length} ${buckets.length === 1 ? 'week' : 'weeks'}` : `${bars} ${bars === 1 ? 'bar' : 'bars'}`}
        </span>
        <div style={{ position: 'relative', height: 46, gridColumn: 2, gridRow: 3 }} data-testid="chart-notch-row">
          <div
            data-testid="chart-notch-axis"
            style={{
              position: 'absolute',
              left: SLIDER_THUMB / 2,
              right: SLIDER_THUMB / 2,
              top: 5,
              height: 2,
              background: grid,
              borderRadius: 1,
            }}
          />
          {notches.map((n, i) => {
            const fraction = maxBars <= 1 ? 0 : (n.value - 1) / (maxBars - 1);
            const align = fraction <= 0 ? 'left' : fraction >= 1 ? 'right' : 'center';
            const active = n.value === bars;
            const tickWidth = active ? 3 : 2;
            return (
              <button
                key={n.value}
                type="button"
                onClick={() => setBars(n.value)}
                title={`${n.value} ${n.value === 1 ? 'bar' : 'bars'}`}
                data-testid={`button-chart-notch-${n.value}`}
                style={{
                  position: 'absolute',
                  left: `calc(${fraction} * (100% - ${SLIDER_THUMB}px) + ${SLIDER_THUMB / 2}px)`,
                  top: 0,
                  transform:
                    align === 'left'
                      ? `translateX(-${tickWidth / 2}px)`
                      : align === 'right'
                        ? `translateX(calc(-100% + ${tickWidth / 2}px))`
                        : 'translateX(-50%)',
                  background: 'none',
                  border: 'none',
                  padding: 0,
                  cursor: 'pointer',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: align === 'left' ? 'flex-start' : align === 'right' ? 'flex-end' : 'center',
                  gap: 3,
                }}
              >
                <span
                  data-testid="chart-notch-tick"
                  style={{ width: tickWidth, height: 9, background: active ? primary : muted, borderRadius: 1, flex: 'none' }}
                />
                <span
                  style={{
                    fontSize: 10,
                    lineHeight: 1.2,
                    color: muted,
                    fontWeight: active ? 700 : 400,
                    whiteSpace: 'nowrap',
                    marginTop: i % 2 === 1 ? 13 : 0,
                  }}
                >
                  {n.label}
                </span>
              </button>
            );
          })}
        </div>
      </div>
      <div className="toolbar" style={{ margin: '4px 0 8px' }}>
        <label className="row-sub" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          Y interval
          <select
            className="select compact"
            aria-label="Y axis interval"
            value={prefs.yInterval ?? 'auto'}
            onChange={(e) => setPrefs((prev) => ({ ...prev, yInterval: e.target.value === 'auto' ? null : Number(e.target.value) }))}
            data-testid="select-chart-y-interval"
          >
            {Y_INTERVALS.map((item) => (
              <option key={item.label} value={item.seconds ?? 'auto'}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <label className="row-sub" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          X interval
          <select
            className="select compact"
            aria-label="X axis interval"
            value={xSelected.id}
            onChange={(e) => setPrefs((prev) => ({ ...prev, xInterval: e.target.value === 'auto' ? null : e.target.value }))}
            data-testid="select-chart-x-interval"
          >
            {xChoices.map((choice) => (
              <option key={choice.id} value={choice.id}>
                {choice.label}
              </option>
            ))}
          </select>
        </label>
        {axesMoved && (
          <button type="button" className="btn btn-quiet btn-small" onClick={resetAxes} data-testid="button-chart-reset-axes">
            Reset axes
          </button>
        )}
      </div>
      <div className="row-sub" data-testid="chart-range-label" style={{ marginBottom: 10 }}>
        {data.rangeLabel}
        {yMaxOverride != null && <span data-testid="chart-y-max"> · scale {formatDurationShort(top)}</span>}
      </div>
      {data.error && (
        <div className="row-sub" style={{ color: ERROR_RED, marginBottom: 10 }} data-testid="chart-range-error">
          {data.error}
        </div>
      )}
      {!data.error && (
        <>
          {maxTotal === 0 && (
            <div className="empty" style={{ marginBottom: 8 }}>
              <strong>No sessions in this range yet</strong>
            </div>
          )}
          {maxTotal > 0 && (
          <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', marginBottom: 12 }}>
            <div>
              <div className="quiet-label">Total focus</div>
              <div style={{ fontWeight: 650, fontSize: 17 }} data-testid="stat-chart-total">
                {formatDurationShort(data.totalSeconds)}
              </div>
            </div>
            <div>
              <div className="quiet-label">Sessions</div>
              <div style={{ fontWeight: 650, fontSize: 17 }} data-testid="stat-chart-sessions">
                {data.sessionCount}
              </div>
            </div>
            <div>
              <div className="quiet-label">Daily average</div>
              <div style={{ fontWeight: 650, fontSize: 17 }} data-testid="stat-chart-avg">
                {formatDurationShort(Math.round(data.totalSeconds / data.spanDays))}/day
              </div>
            </div>
            <div>
              <div className="quiet-label">Best {bestUnitLabel}</div>
              <div style={{ fontWeight: 650, fontSize: 17 }} data-testid="stat-chart-best">
                {data.bestBucket ? `${data.bestBucket.label} · ${formatDurationShort(data.bestBucket.totalSeconds)}` : '—'}
              </div>
            </div>
          </div>
          )}
          <div className="chart-with-stacks">
            <button
              type="button"
              className="btn btn-quiet btn-small chart-stacks-button"
              aria-pressed={showStacks}
              aria-expanded={showStacks}
              onClick={() => setPrefs((prev) => ({ ...prev, showStacks: !prev.showStacks }))}
              data-testid="button-chart-stacks"
            >
              {showStacks ? <ChevronUp size={16} aria-hidden="true" /> : <ChevronDown size={16} aria-hidden="true" />}
              {showStacks ? 'Hide stacks' : 'Show stacks'}
            </button>
          <div ref={chartRowRef} className="chart-views" data-testid="chart-views">
            {viewStacks.map((order, viewIndex) => (
            <section
              key={viewIndex}
              className="chart-view"
              data-testid="chart-view"
              onDragOver={(event) => {
                if (dragId.current) event.preventDefault();
              }}
              onDrop={(event) => {
                event.preventDefault();
                const moving = dragId.current;
                if (!moving) return;
                placeCategory(moving, viewIndex, categoryDropIndex(order, null, moving, 'after'));
              }}
            >
            {showStacks && (
            <div className="chart-view-heading" style={{ minHeight: headingSlots * 32 }} data-testid="chart-view-heading">
              {order.length === 0 && <div className="chart-view-empty">Drop a category here</div>}
              {order.map((id) => (
                <button
                  key={id || 'none'}
                  type="button"
                  draggable
                  className={dropHint?.view === viewIndex && order[dropHint.index] === id ? 'chart-view-chip is-drop' : 'chart-view-chip'}
                  data-testid="chart-view-category"
                  data-category={id || 'none'}
                  title={`${nameOf(id)} · ${formatDurationShort(categoryTotals.get(id) ?? 0)}. Drag to change this stack.`}
                  onDragStart={(event) => {
                    dragId.current = id;
                    event.dataTransfer.setData('text/plain', id || 'uncategorized');
                    event.dataTransfer.effectAllowed = 'move';
                  }}
                  onDragEnd={() => {
                    dragId.current = '';
                    setDropHint(null);
                  }}
                  onDragOver={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    setDropHint({ view: viewIndex, index: order.indexOf(id) });
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    const moving = dragId.current;
                    if (!moving) return;
                    const rect = event.currentTarget.getBoundingClientRect();
                    const place = event.clientY > rect.top + rect.height / 2 ? 'after' : 'before';
                    placeCategory(moving, viewIndex, categoryDropIndex(order, id, moving, place));
                  }}
                >
                  <span className="dot" style={{ '--cat-color': colorOf(id), width: 8, height: 8 } as React.CSSProperties} />
                  <span>{nameOf(id)}</span>
                </button>
              ))}
            </div>
            )}
            <div ref={viewIndex === 0 ? chartBoxRef : undefined} style={{ position: 'relative', height: svgHeight }}>
            <svg
              viewBox={`0 0 ${chartWidth} ${svgHeight}`}
              style={{ width: '100%', height: svgHeight, display: 'block', touchAction: 'none' }}
              role="img"
              aria-label={`Focus time chart for ${order.map((id) => nameOf(id)).join(', ') || 'no categories'}: ${data.rangeLabel}`}
              data-testid="sessions-chart"
              onMouseLeave={() => setHover(null)}
            >
              <clipPath id={`sessions-plot-clip-${viewIndex}`}>
                <rect x={margin.left} y={margin.top} width={plotW} height={plotH} />
              </clipPath>
              {ticks.map((t) => (
                <g key={t}>
                  <line x1={margin.left} x2={chartWidth - margin.right} y1={y(t)} y2={y(t)} style={{ stroke: grid, strokeWidth: 1 }} />
                  <text x={margin.left - 8} y={y(t) + axisFontSize * 0.35} textAnchor="end" fontSize={axisFontSize} style={{ fill: muted }}>
                    {formatDurationShort(t)}
                  </text>
                </g>
              ))}
              <line
                x1={margin.left}
                x2={chartWidth - margin.right}
                y1={y(0)}
                y2={y(0)}
                style={{ stroke: muted, strokeWidth: 1 }}
              />
              {buckets.map((b, i) => {
                const x = xAt(b.startMs);
                const barW = Math.max(0.5, xAt(b.endMs) - x);
                let acc = 0;
                const viewTotal = secondsInView(b, order);
                const aboveH = Math.max(0, y(viewTotal) - margin.top);
                const dimmed = hover !== null && hover.view === viewIndex && hover.index !== i;
                return (
                  <g key={b.key} clipPath={`url(#sessions-plot-clip-${viewIndex})`} opacity={dimmed ? 0.4 : 1} style={{ transition: 'opacity 120ms' }}>
                    <title>{`${b.fullLabel}: ${formatDurationShort(viewTotal)}`}</title>
                    {aboveH > 0 && (
                      <rect
                        x={x}
                        y={margin.top}
                        width={barW}
                        height={aboveH}
                        fill="transparent"
                        pointerEvents="all"
                        data-testid="chart-bar-above"
                        onMouseEnter={() => setHover({ view: viewIndex, index: i, kind: 'categories', categoryId: '' })}
                      />
                    )}
                    {segmentsInStackOrder(order, b.byCategory).map((seg) => {
                      const h = (seg.seconds / top) * plotH;
                      const rectY = y(acc + seg.seconds);
                      acc += seg.seconds;
                      return (
                        <rect
                          key={seg.categoryId || 'none'}
                          x={x}
                          y={rectY}
                          width={barW}
                          height={Math.max(h, 2.5)}
                          rx={0}
                          fill={colorOf(seg.categoryId)}
                          style={{ cursor: 'pointer' }}
                          data-testid="chart-bar-segment"
                          data-category={seg.categoryId || 'none'}
                          onMouseEnter={() => setHover({ view: viewIndex, index: i, kind: 'tasks', categoryId: seg.categoryId })}
                        />
                      );
                    })}
                  </g>
                );
              })}
              {axisLabels.map((label) => {
                const x = xAt(label.atMs);
                const frac = (label.atMs - data.startMs) / spanMs;
                const anchor = frac < 0.04 ? 'start' : frac > 0.96 ? 'end' : 'middle';
                return (
                  <g key={`${label.atMs}-${label.text}`}>
                    <line
                      x1={x}
                      x2={x}
                      y1={margin.top + plotH}
                      y2={margin.top + plotH + 4}
                      style={{ stroke: muted, strokeWidth: 1 }}
                      data-testid="chart-x-tick"
                    />
                    {rotateXLabels ? (
                      <text
                        transform={`translate(${x}, ${margin.top + plotH + 8}) rotate(90)`}
                        textAnchor="start"
                        fontSize={axisFontSize}
                        style={{ fill: muted }}
                        data-testid="chart-x-label"
                      >
                        {label.text}
                      </text>
                    ) : (
                      <text
                        x={x}
                        y={margin.top + plotH + axisFontSize + 8}
                        textAnchor={anchor}
                        fontSize={axisFontSize}
                        style={{ fill: muted }}
                        data-testid="chart-x-label"
                      >
                        {label.text}
                      </text>
                    )}
                  </g>
                );
              })}
              <rect
                x={0}
                y={margin.top}
                width={margin.left}
                height={plotH}
                fill="transparent"
                style={{ cursor: 'ns-resize' }}
                role="slider"
                aria-label="Duration axis"
                aria-valuemin={0}
                aria-valuemax={Math.round(top)}
                aria-valuenow={Math.round(top)}
                data-testid="chart-axis-y"
                onPointerDown={startYDrag}
                onDoubleClick={() => setYMaxOverride(null)}
              >
                <title>Drag to scale the duration axis. Double-click to reset.</title>
              </rect>
              <rect
                x={margin.left}
                y={margin.top + plotH}
                width={plotW}
                height={xAxisBottom}
                fill="transparent"
                style={{ cursor: range.error ? 'default' : 'ew-resize' }}
                role="slider"
                aria-label="Time axis"
                data-testid="chart-axis-x"
                onPointerDown={startXDrag}
                onDoubleClick={() => setPanMs(0)}
              >
                <title>Drag to move the time window. Double-click to reset.</title>
              </rect>
              {buckets.map((b, i) => (
                <rect
                  key={`below-${b.key}`}
                  x={xAt(b.startMs)}
                  y={margin.top + plotH}
                  width={Math.max(0.5, xAt(b.endMs) - xAt(b.startMs))}
                  height={xAxisBottom}
                  fill="transparent"
                  pointerEvents="all"
                  style={{ cursor: range.error ? 'default' : 'ew-resize' }}
                  data-testid="chart-bar-below"
                  onMouseEnter={() => setHover({ view: viewIndex, index: i, kind: 'categories', categoryId: '' })}
                  onPointerDown={startXDrag}
                  onDoubleClick={() => setPanMs(0)}
                />
              ))}
            </svg>
            {hoverBucket && hover && hover.view === viewIndex && (
              <div
                style={{
                  position: 'absolute',
                  left: `${hoverLeftPct}%`,
                  top: 0,
                  transform: 'translateX(-50%)',
                  maxWidth: 240,
                  minWidth: 150,
                  background: card,
                  color: cardFg,
                  border: `1px solid ${grid}`,
                  borderRadius: 10,
                  padding: '8px 10px',
                  fontSize: 12,
                  pointerEvents: 'none',
                  zIndex: 5,
                  boxShadow: '0 4px 14px rgba(0,0,0,0.12)',
                }}
                data-testid="chart-tooltip"
              >
                {hover.kind === 'tasks' && hoverCategory ? (
                  <>
                    <div style={{ fontWeight: 650, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span className="dot" style={{ '--cat-color': colorOf(hover.categoryId), width: 8, height: 8 } as React.CSSProperties} />
                      <span style={{ flex: 1 }}>{nameOf(hover.categoryId)}</span>
                      <span>{formatDurationShort(hoverCategory.seconds)}</span>
                    </div>
                    <div style={{ marginBottom: 4, color: muted }}>{hoverBucket.fullLabel}</div>
                    {hoverTasks.map((task) => (
                      <div key={task.key} data-testid="chart-tooltip-task" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ flex: 1 }}>{task.title}</span>
                        <span>{formatDurationShort(task.seconds)}</span>
                      </div>
                    ))}
                  </>
                ) : (
                  <>
                    <div style={{ fontWeight: 650, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ flex: 1 }}>{hoverBucket.fullLabel}</span>
                      <span>{formatDurationShort(hoverViewSeconds)}</span>
                    </div>
                    {hoverOverview.map((seg) => (
                      <div key={seg.categoryId || 'none'} data-testid="chart-tooltip-category" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span className="dot" style={{ '--cat-color': colorOf(seg.categoryId), width: 8, height: 8 } as React.CSSProperties} />
                        <span style={{ flex: 1 }}>{nameOf(seg.categoryId)}</span>
                        <span>{formatDurationShort(seg.seconds)}</span>
                      </div>
                    ))}
                  </>
                )}
              </div>
            )}
            </div>
            </section>
            ))}
          </div>
          </div>
          <div
            style={{ display: 'grid', gridTemplateColumns: 'auto minmax(0, 1fr) auto', columnGap: 12, rowGap: 8, alignItems: 'center', marginTop: 14 }}
            data-testid="chart-size-controls"
          >
            <span className="quiet-label" style={{ whiteSpace: 'nowrap', gridColumn: 1, gridRow: 1 }}>Height</span>
            <input
              type="range"
              min={HEIGHT_AUTO}
              max={CHART_HEIGHT_MAX}
              step={10}
              value={prefs.chartHeight ?? HEIGHT_AUTO}
              onChange={(event) => {
                const next = Number(event.target.value);
                setPrefs((prev) => ({ ...prev, chartHeight: next < CHART_HEIGHT_MIN ? null : next }));
              }}
              aria-label="Graph height"
              data-testid="input-chart-height"
              style={{ gridColumn: 2, gridRow: 1, width: '100%', accentColor: primary, margin: 0 }}
            />
            <span className="badge" data-testid="chart-height-value" style={{ whiteSpace: 'nowrap', gridColumn: 3, gridRow: 1 }} title={prefs.chartHeight == null ? `${chartHeight}px` : undefined}>
              {prefs.chartHeight == null ? 'Auto' : `${chartHeight}px`}
            </span>
            <div style={{ position: 'relative', height: 28, gridColumn: 2, gridRow: 2 }} data-testid="chart-height-notch-row">
              <button
                type="button"
                onClick={() => setPrefs((prev) => ({ ...prev, chartHeight: null }))}
                data-testid="button-chart-height-auto"
                style={{
                  position: 'absolute',
                  left: SLIDER_THUMB / 2,
                  top: 0,
                  transform: `translateX(-${(prefs.chartHeight == null ? 3 : 2) / 2}px)`,
                  background: 'none',
                  border: 'none',
                  padding: 0,
                  cursor: 'pointer',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'flex-start',
                  gap: 3,
                }}
              >
                <span style={{ width: prefs.chartHeight == null ? 3 : 2, height: 9, background: prefs.chartHeight == null ? primary : muted, borderRadius: 1, flex: 'none' }} />
                <span style={{ fontSize: 10, lineHeight: 1.2, color: muted, fontWeight: prefs.chartHeight == null ? 700 : 400, whiteSpace: 'nowrap' }}>Auto</span>
              </button>
            </div>
            <span className="quiet-label" style={{ whiteSpace: 'nowrap', gridColumn: 1, gridRow: 3 }}>Font Size</span>
            <input
              type="range"
              min={FONT_AUTO}
              max={AXIS_FONT_MAX}
              step={1}
              value={prefs.axisFontSize ?? FONT_AUTO}
              onChange={(event) => {
                const next = Number(event.target.value);
                setPrefs((prev) => ({ ...prev, axisFontSize: next < AXIS_FONT_MIN ? null : next }));
              }}
              aria-label="Font size"
              data-testid="input-chart-label-size"
              style={{ gridColumn: 2, gridRow: 3, width: '100%', accentColor: primary, margin: 0 }}
            />
            <span className="badge" data-testid="chart-label-size-value" style={{ whiteSpace: 'nowrap', gridColumn: 3, gridRow: 3 }} title={prefs.axisFontSize == null ? `${axisFontSize}px` : undefined}>
              {prefs.axisFontSize == null ? 'Auto' : `${axisFontSize}px`}
            </span>
            <div style={{ position: 'relative', height: 28, gridColumn: 2, gridRow: 4 }} data-testid="chart-font-notch-row">
              <button
                type="button"
                onClick={() => setPrefs((prev) => ({ ...prev, axisFontSize: null }))}
                data-testid="button-chart-font-auto"
                style={{
                  position: 'absolute',
                  left: SLIDER_THUMB / 2,
                  top: 0,
                  transform: `translateX(-${(prefs.axisFontSize == null ? 3 : 2) / 2}px)`,
                  background: 'none',
                  border: 'none',
                  padding: 0,
                  cursor: 'pointer',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'flex-start',
                  gap: 3,
                }}
              >
                <span style={{ width: prefs.axisFontSize == null ? 3 : 2, height: 9, background: prefs.axisFontSize == null ? primary : muted, borderRadius: 1, flex: 'none' }} />
                <span style={{ fontSize: 10, lineHeight: 1.2, color: muted, fontWeight: prefs.axisFontSize == null ? 700 : 400, whiteSpace: 'nowrap' }}>Auto</span>
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
