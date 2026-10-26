import { useEffect, useState } from 'react';
import { api, type Evaluation, type FlagRow } from './api.ts';

/** Rows drawn at most; big flag sets (tens of thousands) are narrowed with the filter. */
const MAX_ROWS = 300;
import { GROUP_ORDER, groupOf } from './flag-groups.ts';

function Val({ v }: { v: boolean | null }) {
  if (v === null) return <span className="val na">n/a</span>;
  return <span className={`val ${v ? 'on' : 'off'}`}>{v ? 'ON' : 'OFF'}</span>;
}

function PathStatus({ label, ok, error, extra }: { label: string; ok: boolean; error?: string; extra?: string }) {
  return (
    <div className={`path ${ok ? 'ok' : 'bad'}`}>
      <strong>{label}</strong> {ok ? '✓' : '✗'} {ok ? extra : error}
    </div>
  );
}

export function FlagTable(props: {
  evaluation?: Evaluation;
  selectedFlag?: string;
  onSelectFlag: (name: string | undefined) => void;
  onShowExchange: (id: number) => void;
}) {
  const { evaluation: ev } = props;
  const [filter, setFilter] = useState('');
  const [onlyMismatch, setOnlyMismatch] = useState(false);
  const [definition, setDefinition] = useState<unknown>();

  useEffect(() => {
    setDefinition(undefined);
    if (!ev || !props.selectedFlag) return;
    let live = true;
    api
      .definition(ev.target, ev.environment, props.selectedFlag)
      .then((d) => live && setDefinition(d))
      .catch((e) => live && setDefinition({ error: e.message }));
    return () => {
      live = false;
    };
    // Re-fetch on each evaluation so the shown rules stay current with auto-refresh.
  }, [ev?.target, ev?.environment, ev?.evaluatedAt, props.selectedFlag]);

  if (!ev) return <div className="empty">Waiting for first evaluation…</div>;

  const mismatches = ev.rows.filter((r) => r.match === false).length;
  // Mismatches first so they can never hide past the row cap.
  const matching = ev.rows
    .filter((r) => r.name.includes(filter.trim()) && (!onlyMismatch || r.match === false))
    .sort(
      (a, b) =>
        Number(b.match === false) - Number(a.match === false) ||
        GROUP_ORDER.indexOf(groupOf(a.name)) - GROUP_ORDER.indexOf(groupOf(b.name)) ||
        a.name.localeCompare(b.name),
    );
  const rows = matching.slice(0, MAX_ROWS);
  const selected = ev.rows.find((r) => r.name === props.selectedFlag);

  return (
    <div className="flag-table">
      <div className="paths">
        <PathStatus
          label="Frontend API"
          ok={ev.frontend.ok}
          error={ev.frontend.error}
          extra="GET /api/frontend"
        />
        <PathStatus
          label="Node SDK ← Client API"
          ok={ev.sdk.ok}
          error={ev.sdk.error}
          extra={`${ev.sdk.status.flagCount ?? 0} flags, synced ${ev.sdk.status.lastSyncAt?.slice(11, 19) ?? '—'}`}
        />
        {ev.frontend.exchangeId && (
          <button className="link" onClick={() => props.onShowExchange(ev.frontend.exchangeId!)}>
            show frontend response ↓
          </button>
        )}
      </div>
      <details className="context">
        <summary>Context sent ({new Date(ev.evaluatedAt).toLocaleTimeString()})</summary>
        <pre>{JSON.stringify(ev.context, null, 2)}</pre>
      </details>
      <div className="table-tools">
        <input placeholder="filter flags" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <label className="check">
          <input type="checkbox" checked={onlyMismatch} onChange={(e) => setOnlyMismatch(e.target.checked)} />
          only mismatches
        </label>
        <span className={mismatches ? 'bad' : 'good'}>
          {mismatches ? `${mismatches} mismatch${mismatches > 1 ? 'es' : ''}` : 'all paths agree'}
          {` · ${ev.rows.length.toLocaleString()} flags`}
        </span>
      </div>
      {matching.length > MAX_ROWS && (
        <div className="muted">
          Showing {MAX_ROWS} of {matching.length.toLocaleString()} flags (mismatches first) — narrow with the filter.
        </div>
      )}
      <table>
        <thead>
          <tr>
            <th>Group</th>
            <th>Flag</th>
            <th title="Evaluated by the target server">Frontend API</th>
            <th title="Evaluated locally by unleash-client from /api/client/features">SDK</th>
            <th>Match</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r: FlagRow) => (
            <tr
              key={r.name}
              className={`${r.match === false ? 'mismatch' : ''} ${r.name === props.selectedFlag ? 'selected' : ''}`}
              onClick={() => props.onSelectFlag(r.name === props.selectedFlag ? undefined : r.name)}
            >
              <td className="muted">{groupOf(r.name)}</td>
              <td>
                {r.name}
                {r.stale && <span className="tag">stale</span>}
              </td>
              <td>
                <Val v={r.frontend} />
              </td>
              <td>
                <Val v={r.sdk} />
              </td>
              <td>{r.match === null ? '—' : r.match ? '✓' : '✗'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {selected && (
        <div className="definition">
          <div className="definition-head">
            <strong>{selected.name}</strong> — compiled definition from <code>/api/client/features</code>
          </div>
          <pre>{definition === undefined ? 'loading…' : JSON.stringify(definition, null, 2)}</pre>
        </div>
      )}
    </div>
  );
}
