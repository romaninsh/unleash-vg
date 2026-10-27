import { useEffect, useState } from 'react';
import { api, type Brand, type StressSnapshot } from './api.ts';
import { CATEGORICAL, HistogramChart, LineChart, PercentLinesChart, type Series } from './Charts.tsx';
import { assess, LEVEL_LABEL, tileStyle, type Level, type Verdict } from './thresholds.ts';

function Tile(props: {
  label: string;
  value: string;
  sub?: string;
  verdict?: Verdict;
  labels?: Partial<Record<Level, string>>;
}) {
  const v = props.verdict;
  const word = v ? (props.labels?.[v.level] ?? LEVEL_LABEL[v.level]) : '';
  return (
    <div className={`tile-stat level-${v?.level ?? 'none'}`} style={tileStyle(v)} title={v?.limit}>
      <div className="tile-label">
        {props.label}
        {word && <span className="tile-level">{word}</span>}
      </div>
      <div className="tile-value">{props.value}</div>
      {props.sub && <div className="tile-sub">{props.sub}</div>}
    </div>
  );
}

const ERROR_LABELS = { warning: '▲ Some errors', serious: '▲ Errors', critical: '✖ Failing' };
const WRONG_LABELS = { serious: '✖ Wrong answers', critical: '✖ Wrong answers' };
const NO_BRAND = '';

/** Brand → colour by fixed position in the brand list (+ "no brand" last), independent of data. */
function brandColors(brands: Brand[]): Map<string, { label: string; color: string }> {
  const keys = [...brands.map((b) => b.key).sort(), NO_BRAND];
  const names = new Map(brands.map((b) => [b.key, b.displayName]));
  return new Map(
    keys.slice(0, CATEGORICAL.length).map((k, i) => [
      k,
      { label: k === NO_BRAND ? '(no brand)' : `${names.get(k) ?? k}`, color: CATEGORICAL[i]! },
    ]),
  );
}

function WatchChart({ s, brands }: { s: StressSnapshot; brands: Brand[] }) {
  const flag = s.watch.flag;
  if (!flag) return null;
  const seconds = s.watch.seconds.filter((w) => w.flag === flag);
  const colors = brandColors(brands);
  const present = new Set(seconds.flatMap((w) => Object.keys(w.byBrand)));
  const series: Series[] = [...colors.entries()]
    .filter(([k]) => present.has(k))
    .map(([k, c]) => ({
      key: k,
      label: c.label,
      color: c.color,
      points: seconds.map((w) => {
        const v = w.byBrand[k];
        return { x: w.t, y: v && v.total ? (v.on / v.total) * 100 : null, n: v?.total ?? 0 };
      }),
    }));
  const dropped = [...present].filter((k) => !colors.has(k));
  const last = seconds.at(-1);
  return (
    <div className="watch">
      <PercentLinesChart
        title={`${flag}: share of Frontend API answers with the flag ON, per second and brand`}
        series={series}
        xMax={Math.max(s.options.durationSec, last?.t ?? 0)}
      />
      {dropped.length > 0 && <div className="muted">Not plotted (more than 8 series): {dropped.join(', ')}</div>}
      {seconds.length === 0 && (
        <div className="muted">Waiting for Frontend API answers… (only the Frontend API answers carry flag values)</div>
      )}
    </div>
  );
}

const ms = (v: number) => `${v < 10 ? v.toFixed(2) : v.toFixed(1)} ms`;
const isError = (status: string) => !/^[23]\d\d$/.test(status);

export function Stress(props: {
  target: string;
  environment: string;
  brand: string;
  brands: Brand[];
  snapshot?: StressSnapshot;
  history: StressSnapshot[];
  limits: { concurrency: number; durationSec: number };
}) {
  const [mode, setMode] = useState<'frontend' | 'client' | 'mixed'>('frontend');
  const [wantConcurrency, setConcurrency] = useState(32);
  const [wantDuration, setDuration] = useState(20);
  // a deployed bench caps both (server/stress.ts LIMITS)
  const concurrency = Math.min(wantConcurrency, props.limits.concurrency);
  const duration = Math.min(wantDuration, props.limits.durationSec);
  const [brandMode, setBrandMode] = useState<'random' | 'selected' | 'none'>('random');
  const [customerMode, setCustomerMode] = useState<'range' | 'uuid'>('range');
  const [customerMax, setCustomerMax] = useState(1_000_000);
  const [conditional, setConditional] = useState(true);
  const [checkPct, setCheckPct] = useState(2);
  const [error, setError] = useState<string>();
  const [flags, setFlags] = useState<string[]>([]);
  const [watchFlag, setWatchFlag] = useState(localStorage.getItem('bench.watch') ?? '');
  const s = props.snapshot;
  const running = s?.state === 'running' || s?.state === 'stopping';

  useEffect(() => setError(undefined), [props.target, props.environment]);

  useEffect(() => {
    if (!props.target) return;
    api
      .flags(props.target, props.environment)
      .then((r) => setFlags(r.flags))
      .catch(() => setFlags([]));
  }, [props.target, props.environment]);

  const changeWatch = (flag: string) => {
    setWatchFlag(flag);
    localStorage.setItem('bench.watch', flag);
    if (running) api.stressWatch(flag).catch((e) => setError(e.message));
  };

  const start = async () => {
    setError(undefined);
    try {
      await api.stressStart({
        target: props.target,
        environment: props.environment,
        mode,
        concurrency,
        durationSec: duration,
        brandMode,
        selectedBrand: props.brand,
        brands: props.brands.filter((b) => b.active).map((b) => b.key),
        customerMode,
        customerMin: 1,
        customerMax,
        conditional,
        checkSample: checkPct / 100,
        watchFlag: watchFlag || undefined,
      });
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const activeBrands = props.brands.filter((b) => b.active).length;

  return (
    <div className="stress">
      <div className="stress-form">
        <div className="stress-target">
          Target <strong>{props.target}</strong> · <strong>{props.environment}</strong>
        </div>
        <label>
          Endpoint
          <select value={mode} onChange={(e) => setMode(e.target.value as any)} disabled={running}>
            <option value="frontend">Frontend API (GET /api/frontend)</option>
            <option value="client">Client API (GET /api/client/features)</option>
            <option value="mixed">Mixed: 80% frontend / 20% client</option>
          </select>
        </label>
        <label>
          Concurrent workers
          <input
            type="number"
            min={1}
            max={props.limits.concurrency}
            value={concurrency}
            onChange={(e) => setConcurrency(Number(e.target.value))}
            disabled={running}
          />
        </label>
        <label>
          Duration (s)
          <input
            type="number"
            min={1}
            max={props.limits.durationSec}
            value={duration}
            onChange={(e) => setDuration(Number(e.target.value))}
            disabled={running}
          />
        </label>
        <label>
          Brand per request
          <select value={brandMode} onChange={(e) => setBrandMode(e.target.value as any)} disabled={running}>
            <option value="random">random of {activeBrands} active brands</option>
            <option value="selected">selected: {props.brand || '(none)'}</option>
            <option value="none">no brand</option>
          </select>
        </label>
        <label>
          Customer IDs
          <span className="inline">
            <select value={customerMode} onChange={(e) => setCustomerMode(e.target.value as any)} disabled={running}>
              <option value="range">random 1…N</option>
              <option value="uuid">random UUID</option>
            </select>
            {customerMode === 'range' && (
              <input
                type="number"
                min={1}
                value={customerMax}
                onChange={(e) => setCustomerMax(Number(e.target.value))}
                disabled={running}
                style={{ width: 100 }}
              />
            )}
          </span>
        </label>
        <label>
          Check vs SDK (%)
          <input
            type="number"
            min={0}
            max={100}
            value={checkPct}
            onChange={(e) => setCheckPct(Number(e.target.value))}
            disabled={running || mode === 'client'}
          />
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={conditional}
            onChange={(e) => setConditional(e.target.checked)}
            disabled={running || mode === 'frontend'}
          />
          Client API with If-None-Match (304s, like polling SDKs)
        </label>
        <label title="Plot this flag's ON share per second. Can be changed while a run is going.">
          Watch flag (live)
          <select value={watchFlag} onChange={(e) => changeWatch(e.target.value)} disabled={mode === 'client'}>
            <option value="">(none)</option>
            {watchFlag && !flags.includes(watchFlag) && <option value={watchFlag}>{watchFlag}</option>}
            {flags.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </label>
        {running ? (
          <button className="danger" onClick={() => api.stressStop()}>
            {s?.state === 'stopping' ? 'Stopping…' : 'Stop'}
          </button>
        ) : (
          <button className="primary" onClick={start} disabled={!props.target}>
            Start stress test
          </button>
        )}
        {error && <span className="bad">{error}</span>}
      </div>

      {!s ? (
        <div className="empty">
          No run yet. Each worker sends requests back-to-back with a random customer (and brand), so concurrency ≈
          requests in flight. Latency is measured until the full response body is read.
        </div>
      ) : (
        <Results s={s} brands={props.brands} />
      )}

      {props.history.length > 0 && <History runs={props.history} />}
    </div>
  );
}

function Results({ s, brands }: { s: StressSnapshot; brands: Brand[] }) {
  const errorStatuses = Object.entries(s.statuses).filter(([k]) => isError(k));
  const errRate = s.requests ? (s.errors / s.requests) * 100 : 0;
  const v = assess(s);
  return (
    <div className="stress-results">
      <div className="run-line">
        <span className={`run-state ${s.state}`}>{s.state}</span> {s.options.target} · {s.options.environment} ·{' '}
        {s.options.mode} · {s.options.concurrency} workers · {s.elapsedSec}s / {s.options.durationSec}s
        {s.failure && <span className="bad"> — {s.failure}</span>}
        <progress value={s.elapsedSec} max={s.options.durationSec} />
      </div>

      <div className="tiles-row">
        <Tile
          label="Throughput"
          value={`${s.rps.toLocaleString()} req/s`}
          sub={`${s.requests.toLocaleString()} requests`}
          verdict={v?.throughput}
          labels={{ serious: '▲ Low', critical: '✖ Too low' }}
        />
        <Tile label="p50 latency" value={ms(s.latency.p50)} sub={`mean ${ms(s.latency.mean)}`} verdict={v?.p50} />
        <Tile label="p95 latency" value={ms(s.latency.p95)} sub={`p90 ${ms(s.latency.p90)}`} verdict={v?.p95} />
        <Tile label="p99 latency" value={ms(s.latency.p99)} sub={`max ${ms(s.latency.max)}`} verdict={v?.p99} />
        <Tile
          label="Errors"
          value={`${s.errors.toLocaleString()}`}
          sub={`${errRate.toFixed(2)}% of requests`}
          verdict={v?.errors}
          labels={ERROR_LABELS}
        />
        <Tile
          label="Wrong answers"
          value={s.options.mode === 'client' ? 'n/a' : `${s.checks.mismatches}`}
          sub={s.options.mode === 'client' ? 'client API is not evaluated' : `of ${s.checks.compared} checked vs SDK`}
          verdict={s.options.mode === 'client' || !s.checks.compared ? undefined : v?.wrong}
          labels={WRONG_LABELS}
        />
      </div>
      {!v && <div className="muted">Colours appear after {200} requests; limits are in the tile tooltips.</div>}

      <WatchChart s={s} brands={brands} />

      <div className="charts-row">
        <LineChart
          title="Throughput (requests per second)"
          unit="req/s"
          xUnit="s"
          points={s.timeline.map((b) => ({ x: b.t, y: b.requests }))}
        />
        <LineChart
          title="p95 latency per second (ms)"
          unit="ms"
          xUnit="s"
          points={s.timeline.map((b) => ({ x: b.t, y: b.p95 }))}
        />
        <HistogramChart title="Latency distribution (ms)" buckets={s.histogram} />
      </div>

      <div className="stress-tables">
        <div>
          <h4>Per endpoint</h4>
          <table>
            <thead>
              <tr>
                <th>Endpoint</th>
                <th>count</th>
                <th>p50</th>
                <th>p95</th>
                <th>p99</th>
                <th>max</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(s.byEndpoint).map(([k, l]) => (
                <tr key={k}>
                  <td>{k}</td>
                  <td>{l.count.toLocaleString()}</td>
                  <td>{ms(l.p50)}</td>
                  <td>{ms(l.p95)}</td>
                  <td>{ms(l.p99)}</td>
                  <td>{ms(l.max)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div>
          <h4>Responses</h4>
          <table>
            <thead>
              <tr>
                <th>Status</th>
                <th>count</th>
                <th>share</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(s.statuses)
                .sort((a, b) => b[1] - a[1])
                .map(([k, v]) => (
                  <tr key={k} className={isError(k) ? 'mismatch' : ''}>
                    <td>
                      {isError(k) ? '⚠ ' : ''}
                      {k}
                    </td>
                    <td>{v.toLocaleString()}</td>
                    <td>{((v / Math.max(1, s.requests)) * 100).toFixed(1)}%</td>
                  </tr>
                ))}
            </tbody>
          </table>
          <div className="muted">received {(s.bytes / 1024 / 1024).toFixed(1)} MB</div>
        </div>
      </div>

      {(s.errorSamples.length > 0 || errorStatuses.length > 0) && (
        <div className="samples bad-box">
          <h4>Error samples</h4>
          {s.errorSamples.map((e) => (
            <pre key={e}>{e}</pre>
          ))}
        </div>
      )}
      {s.checks.note && <div className="samples bad-box">{s.checks.note}</div>}
      {s.checks.samples.length > 0 && (
        <div className="samples bad-box">
          <h4>Wrong answers (Frontend API ≠ official SDK on the same context)</h4>
          {s.checks.samples.map((m, i) => (
            <pre key={i}>
              {JSON.stringify(m.context)}
              {m.onlyFrontend.length ? `\n  ON only in Frontend API: ${m.onlyFrontend.join(', ')}` : ''}
              {m.onlySdk.length ? `\n  ON only in SDK:          ${m.onlySdk.join(', ')}` : ''}
            </pre>
          ))}
        </div>
      )}

      <details>
        <summary>Per-second data (table)</summary>
        <table>
          <thead>
            <tr>
              <th>second</th>
              <th>requests</th>
              <th>errors</th>
              <th>p50 ms</th>
              <th>p95 ms</th>
            </tr>
          </thead>
          <tbody>
            {s.timeline.map((b) => (
              <tr key={b.t}>
                <td>{b.t}</td>
                <td>{b.requests}</td>
                <td>{b.errors}</td>
                <td>{b.p50}</td>
                <td>{b.p95}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}

function History({ runs }: { runs: StressSnapshot[] }) {
  return (
    <div className="history">
      <h4>Finished runs (compare backends)</h4>
      <table>
        <thead>
          <tr>
            <th>time</th>
            <th>target</th>
            <th>env</th>
            <th>endpoint</th>
            <th>workers</th>
            <th>req/s</th>
            <th>p50</th>
            <th>p95</th>
            <th>p99</th>
            <th>errors</th>
            <th>wrong</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((r) => (
            <tr key={r.id} className={r.errors || r.checks.mismatches || r.failure ? 'mismatch' : ''}>
              <td>{new Date(r.startedAt).toLocaleTimeString()}</td>
              <td>{r.options.target}</td>
              <td>{r.options.environment}</td>
              <td>{r.options.mode}</td>
              <td>{r.options.concurrency}</td>
              <td>{r.failure ? '—' : r.rps.toLocaleString()}</td>
              <td>{r.failure ? '—' : ms(r.latency.p50)}</td>
              <td>{r.failure ? '—' : ms(r.latency.p95)}</td>
              <td>{r.failure ? '—' : ms(r.latency.p99)}</td>
              <td>{r.failure ? 'failed' : r.errors}</td>
              <td>{r.options.mode === 'client' ? '—' : r.checks.mismatches}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
