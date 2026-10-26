import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type BrandResult, type Evaluation, type Exchange, type StressSnapshot, type TargetInfo } from './api.ts';
import { FlagTable } from './FlagTable.tsx';
import { Inspector } from './Inspector.tsx';
import { MockBank } from './MockBank.tsx';
import { Stress } from './Stress.tsx';

const NO_BRAND = '';

function randomCustomer() {
  return String(1000 + Math.floor(Math.random() * 9000));
}

export function App() {
  const [targets, setTargets] = useState<TargetInfo[]>([]);
  const [refreshMs, setRefreshMs] = useState(5000);
  const [loadError, setLoadError] = useState<string>();
  const [target, setTarget] = useState('');
  const [environment, setEnvironment] = useState('production');
  const [brands, setBrands] = useState<BrandResult>();
  const [brand, setBrand] = useState(NO_BRAND);
  const [customer, setCustomer] = useState('1001');
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [evaluation, setEvaluation] = useState<Evaluation>();
  const [evalError, setEvalError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [exchanges, setExchanges] = useState<Exchange[]>([]);
  const [selectedExchange, setSelectedExchange] = useState<number>();
  const [selectedFlag, setSelectedFlag] = useState<string>();
  const [view, setView] = useState<'explorer' | 'stress'>(
    localStorage.getItem('bench.view') === 'stress' ? 'stress' : 'explorer',
  );
  const [stress, setStress] = useState<StressSnapshot>();
  const [stressHistory, setStressHistory] = useState<StressSnapshot[]>([]);
  const [stressLimits, setStressLimits] = useState({ concurrency: 256, durationSec: 600 });

  useEffect(() => localStorage.setItem('bench.view', view), [view]);

  useEffect(() => {
    api
      .stress()
      .then((r) => {
        setStress(r.current);
        setStressHistory(r.history);
        setStressLimits(r.limits);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    api
      .targets()
      .then((r) => {
        setTargets(r.targets);
        setRefreshMs(r.sdkRefreshMs);
        const saved = localStorage.getItem('bench.target');
        setTarget(r.targets.find((t) => t.name === saved)?.name ?? r.targets[0]?.name ?? '');
      })
      .catch((e) => setLoadError(e.message));
    api.exchanges().then(setExchanges).catch(() => {});
    const es = new EventSource('/bench/stream');
    es.addEventListener('exchange', (ev) => {
      const ex = JSON.parse((ev as MessageEvent).data) as Exchange;
      setExchanges((prev) => [ex, ...prev].slice(0, 300));
    });
    es.addEventListener('stress', (ev) => {
      const snap = JSON.parse((ev as MessageEvent).data) as StressSnapshot;
      setStress(snap);
      if (snap.state === 'done' || snap.state === 'failed') {
        setStressHistory((prev) => [snap, ...prev.filter((p) => p.id !== snap.id)].slice(0, 20));
      }
    });
    return () => es.close();
  }, []);

  useEffect(() => {
    if (!target) return;
    localStorage.setItem('bench.target', target);
    setBrands(undefined);
    setBrand(NO_BRAND);
    api
      .brands(target)
      .then((r) => {
        setBrands(r);
        const first = r.brands.find((b) => b.active);
        if (first) setBrand(first.key);
      })
      .catch((e) => setBrands({ brands: [], source: '?', error: e.message }));
  }, [target]);

  const seq = useRef(0);
  const run = useCallback(async () => {
    if (!target) return;
    const mine = ++seq.current;
    setBusy(true);
    try {
      const r = await api.evaluate({ target, environment, brand, customer: customer.trim() });
      if (mine === seq.current) {
        setEvaluation(r);
        setEvalError(undefined);
      }
    } catch (e) {
      if (mine === seq.current) setEvalError((e as Error).message);
    } finally {
      if (mine === seq.current) setBusy(false);
    }
  }, [target, environment, brand, customer]);

  // The explorer stays quiet on the stress tab so it doesn't add load or noise to a run.
  useEffect(() => {
    if (view !== 'explorer') return;
    const t = setTimeout(run, 250);
    return () => clearTimeout(t);
  }, [run, view]);

  useEffect(() => {
    if (!autoRefresh || view !== 'explorer') return;
    const t = setInterval(run, refreshMs);
    return () => clearInterval(t);
  }, [run, autoRefresh, refreshMs, view]);

  const targetInfo = targets.find((t) => t.name === target);
  const envInfo = targetInfo?.environments.find((e) => e.key === environment);
  const brandInfo = brands?.brands.find((b) => b.key === brand);

  if (loadError) return <div className="fatal">Cannot load bench config: {loadError}</div>;

  return (
    <div className="layout">
      <header className="toolbar">
        <strong className="title">Flag test bench</strong>
        <nav className="tabs">
          <button className={view === 'explorer' ? 'active' : ''} onClick={() => setView('explorer')}>
            Explorer
          </button>
          <button className={view === 'stress' ? 'active' : ''} onClick={() => setView('stress')}>
            Stress test
            {(stress?.state === 'running' || stress?.state === 'stopping') && <span className="dot" />}
          </button>
        </nav>
        <label>
          Target
          <select value={target} onChange={(e) => setTarget(e.target.value)}>
            {targets.map((t) => (
              <option key={t.name} value={t.name}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Environment
          <select value={environment} onChange={(e) => setEnvironment(e.target.value)}>
            {targetInfo?.environments.map((e) => (
              <option key={e.key} value={e.key}>
                {e.key}
                {!e.backend && !e.frontend ? ' (no tokens)' : ''}
              </option>
            ))}
          </select>
        </label>
        <label>
          Brand
          <select value={brand} onChange={(e) => setBrand(e.target.value)}>
            <option value={NO_BRAND}>(no brand)</option>
            {brands?.brands.map((b) => (
              <option key={b.key} value={b.key}>
                {b.displayName} · {b.key}
                {b.active ? '' : ' (inactive)'}
              </option>
            ))}
          </select>
        </label>
        <label hidden={view !== 'explorer'}>
          Customer ID
          <span className="inline">
            <input
              value={customer}
              placeholder="(none)"
              onChange={(e) => setCustomer(e.target.value)}
              size={10}
            />
            <button title="Random customer" onClick={() => setCustomer(randomCustomer())}>
              🎲
            </button>
            <button title="No customer" onClick={() => setCustomer('')}>
              ∅
            </button>
          </span>
        </label>
        {view === 'explorer' && (
          <>
            <label className="check">
              <input type="checkbox" checked={autoRefresh} onChange={(e) => setAutoRefresh(e.target.checked)} />
              auto-refresh {refreshMs / 1000}s
            </label>
            <button onClick={run} disabled={busy}>
              {busy ? 'Evaluating…' : 'Evaluate now'}
            </button>
          </>
        )}
        <button
          hidden={view !== 'explorer'}
          title="Destroy and recreate the SDK instance for this target/environment"
          onClick={async () => {
            await api.resetSdk(target, environment);
            run();
          }}
        >
          Reset SDK
        </button>
      </header>

      <div className="status-strip">
        <span>
          {targetInfo?.baseUrl} · context fields: brand=<code>{targetInfo?.contextFields.brand}</code> customer=
          <code>{targetInfo?.contextFields.customer}</code>
        </span>
        <span className={brands?.error ? 'bad' : ''}>
          brands from {brands?.source ?? '…'}
          {brands?.error ? ` — ${brands.error}` : ` (${brands?.brands.length ?? 0})`}
        </span>
        {envInfo && (
          <span>
            tokens: backend {envInfo.backend ? '✓' : '✗'} · frontend {envInfo.frontend ? '✓' : '✗'}
          </span>
        )}
        {evalError && <span className="bad">evaluate failed: {evalError}</span>}
      </div>

      {view === 'stress' && (
        <main className="stress-main">
          <Stress
            target={target}
            environment={environment}
            brand={brand}
            brands={brands?.brands ?? []}
            snapshot={stress}
            history={stressHistory}
            limits={stressLimits}
          />
        </main>
      )}

      {view === 'explorer' && (
      <>
      <main className="panels">
        <section className="panel bank-panel">
          <MockBank
            brand={brandInfo ?? (brand ? { key: brand, displayName: brand, active: true } : undefined)}
            customer={customer.trim()}
            rows={evaluation?.rows ?? []}
            onSelectFlag={setSelectedFlag}
          />
        </section>
        <section className="panel flags-panel">
          <FlagTable
            evaluation={evaluation}
            selectedFlag={selectedFlag}
            onSelectFlag={setSelectedFlag}
            onShowExchange={setSelectedExchange}
          />
        </section>
      </main>

      <Inspector
        exchanges={exchanges}
        selected={selectedExchange}
        onSelect={setSelectedExchange}
        onClear={async () => {
          await api.clearExchanges();
          setExchanges([]);
          setSelectedExchange(undefined);
        }}
      />
      </>
      )}
    </div>
  );
}
