import { useEffect, useRef, useState } from 'react';
import type { Exchange } from './api.ts';

function pretty(body: string | undefined): string {
  if (!body) return '(empty)';
  try {
    return JSON.stringify(JSON.parse(body), null, 2);
  } catch {
    return body;
  }
}

function statusClass(ex: Exchange) {
  if (ex.error || ex.status === undefined) return 'bad';
  if (ex.status === 304) return 'cached';
  if (ex.status >= 400) return 'bad';
  if (!(ex.responseHeaders['content-type'] ?? '').includes('json') && ex.status === 200) return 'warn';
  return 'good';
}

function shortPath(url: string) {
  try {
    const u = new URL(url);
    return decodeURIComponent(u.pathname + u.search);
  } catch {
    return url;
  }
}

export function Inspector(props: {
  exchanges: Exchange[];
  selected?: number;
  onSelect: (id: number | undefined) => void;
  onClear: () => void;
}) {
  const [source, setSource] = useState<'all' | 'frontend-api' | 'sdk'>('all');
  const [hide304, setHide304] = useState(false);
  const [open, setOpen] = useState(true);
  const detailRef = useRef<HTMLDivElement>(null);

  const list = props.exchanges.filter(
    (e) => (source === 'all' || e.source === source) && !(hide304 && e.status === 304),
  );
  const sel = props.exchanges.find((e) => e.id === props.selected);

  useEffect(() => {
    if (props.selected !== undefined) {
      setOpen(true);
      detailRef.current?.scrollIntoView({ block: 'nearest' });
    }
  }, [props.selected]);

  return (
    <section className={`inspector ${open ? '' : 'collapsed'}`}>
      <div className="inspector-bar">
        <button className="link" onClick={() => setOpen(!open)}>
          {open ? '▾' : '▸'} HTTP inspector ({props.exchanges.length})
        </button>
        <select value={source} onChange={(e) => setSource(e.target.value as any)}>
          <option value="all">all sources</option>
          <option value="frontend-api">Frontend API</option>
          <option value="sdk">Node SDK (client API, register, metrics)</option>
        </select>
        <label className="check">
          <input type="checkbox" checked={hide304} onChange={(e) => setHide304(e.target.checked)} /> hide 304
        </label>
        <button onClick={props.onClear}>Clear</button>
      </div>
      {open && (
        <div className="inspector-body">
          <ul className="exchange-list">
            {list.map((ex) => (
              <li
                key={ex.id}
                className={ex.id === props.selected ? 'selected' : ''}
                onClick={() => props.onSelect(ex.id === props.selected ? undefined : ex.id)}
              >
                <span className="time">{ex.at.slice(11, 19)}</span>
                <span className={`status ${statusClass(ex)}`}>{ex.status ?? 'ERR'}</span>
                <span className="method">{ex.method}</span>
                <span className="src">{ex.source === 'sdk' ? 'SDK' : 'FE'}</span>
                <span className="path">{shortPath(ex.url)}</span>
                <span className="ms">{ex.durationMs}ms</span>
              </li>
            ))}
          </ul>
          <div className="exchange-detail" ref={detailRef}>
            {!sel ? (
              <div className="empty">Select a request to see headers and body.</div>
            ) : (
              <>
                <div className="detail-line">
                  <span className={`status ${statusClass(sel)}`}>{sel.status ?? 'ERR'}</span> {sel.method}{' '}
                  <code>{sel.url}</code> · {sel.durationMs}ms · {sel.target}/{sel.environment}
                </div>
                {sel.error && <div className="bad">Network error: {sel.error}</div>}
                <div className="cols">
                  <div>
                    <h4>Request headers</h4>
                    <pre>{JSON.stringify(sel.requestHeaders, null, 2)}</pre>
                    {sel.requestBody && (
                      <>
                        <h4>Request body</h4>
                        <pre>{pretty(sel.requestBody)}</pre>
                      </>
                    )}
                  </div>
                  <div>
                    <h4>Response headers</h4>
                    <pre>{JSON.stringify(sel.responseHeaders, null, 2)}</pre>
                  </div>
                </div>
                <h4>Response body</h4>
                <pre className="body">{pretty(sel.responseBody)}</pre>
              </>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
