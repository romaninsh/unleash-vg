import { useState, type ReactNode } from 'react';
import type { Brand, FlagRow } from './api.ts';
import { FLAG_GROUPS, GROUP_ORDER, groupOf } from './flag-groups.ts';

/**
 * A fake white-label banking app. Flags are laid out by their group (see flag-groups.ts); flags
 * the bench doesn't know show as generic tiles under "Other", so it works with any flag set.
 * Group "App" flags are drawn specially (theme, banners, chat) instead of as tiles.
 */

function hue(key: string) {
  let h = 0;
  for (const c of key) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}

/** Value the app would act on: the SDK result, falling back to the Frontend API. */
function effective(r: FlagRow | undefined): boolean | null {
  if (!r) return null;
  return r.sdk ?? r.frontend;
}

function Badge({ row }: { row: FlagRow }) {
  const v = effective(row);
  return (
    <span
      className={`badge ${v ? 'on' : 'off'} ${row.match === false ? 'mismatch' : ''}`}
      title={`Frontend API: ${row.frontend ?? 'n/a'} · SDK: ${row.sdk ?? 'n/a'}`}
    >
      {row.name}: {v === null ? 'n/a' : v ? 'ON' : 'OFF'}
      {row.match === false && ` (FE ${row.frontend ? 'ON' : 'OFF'} ≠ SDK ${row.sdk ? 'ON' : 'OFF'})`}
    </span>
  );
}

export function MockBank(props: {
  brand?: Brand;
  customer: string;
  rows: FlagRow[];
  onSelectFlag: (name: string) => void;
}) {
  const [realistic, setRealistic] = useState(false);
  const byName = new Map(props.rows.map((r) => [r.name, r]));
  const on = (name: string) => effective(byName.get(name)) === true;

  const dark = on('dark-mode');
  const h = hue(props.brand?.key ?? 'none');

  const sections = new Map<string, ReactNode[]>();
  const add = (section: string, node: ReactNode) => {
    if (!sections.has(section)) sections.set(section, []);
    sections.get(section)!.push(node);
  };

  // Unknown flags go to "Other", capped so large flag sets (tens of thousands) stay drawable;
  // a flag whose two answers disagree is always shown.
  const OTHER_CAP = 12;
  let otherShown = 0;
  let otherHidden = 0;
  for (const r of props.rows) {
    if (groupOf(r.name) === 'App' && FLAG_GROUPS[r.name]) continue;
    const w = FLAG_GROUPS[r.name];
    const v = effective(r);
    if (realistic && v !== true) continue;
    if (!w) {
      if (otherShown >= OTHER_CAP && r.match !== false) {
        otherHidden++;
        continue;
      }
      otherShown++;
    }
    add(
      groupOf(r.name),
      <div
        key={r.name}
        className={`tile ${v ? 'tile-on' : 'tile-off'} ${r.match === false ? 'tile-mismatch' : ''}`}
        onClick={() => props.onSelectFlag(r.name)}
      >
        <div className="tile-main">
          <span className="icon">{w?.icon ?? '⚑'}</span>
          <span>{w?.label ?? r.name}</span>
        </div>
        <Badge row={r} />
      </div>,
    );
  }

  const special = (name: string, node: ReactNode) => {
    const r = byName.get(name);
    if (!r) return null;
    const v = effective(r);
    if (realistic && v !== true) return null;
    return (
      <div className={`special ${v ? '' : 'special-off'}`} onClick={() => props.onSelectFlag(name)}>
        {node}
        <Badge row={r} />
      </div>
    );
  };

  return (
    <div className="bank-wrap">
      <div className="bank-tools">
        <label className="check">
          <input type="checkbox" checked={realistic} onChange={(e) => setRealistic(e.target.checked)} />
          realistic view (hide OFF features)
        </label>
      </div>
      <div
        className={`phone ${dark ? 'dark' : ''}`}
        style={{ ['--brand' as any]: `hsl(${h} 65% 42%)`, ['--brand-soft' as any]: `hsl(${h} 70% 93%)` }}
      >
        <div className="phone-head">
          <div className="logo">{(props.brand?.displayName ?? '?').slice(0, 1)}</div>
          <div>
            <div className="bank-name">{props.brand?.displayName ?? 'No brand selected'}</div>
            <div className="bank-sub">
              {props.brand ? props.brand.key : 'default rules apply'} ·{' '}
              {props.customer ? `customer ${props.customer}` : 'anonymous'}
            </div>
          </div>
        </div>
        {special('maintenance-banner', <div className="maintenance">🛠️ Scheduled maintenance tonight 22:00–23:00</div>)}
        {special('dark-mode', <div className="mini">🌙 Dark mode</div>)}
        {special(
          'new-dashboard-layout',
          <div className="mini">{on('new-dashboard-layout') ? '🆕 New dashboard layout' : 'Classic dashboard layout'}</div>,
        )}
        <div className="balance">
          <div className="muted">Current account</div>
          <div className="amount">£2,481.07</div>
        </div>
        {props.rows.length === 0 && <div className="empty">No flags yet — waiting for the target.</div>}
        {[...sections.entries()]
          .sort((a, b) => GROUP_ORDER.indexOf(a[0] as any) - GROUP_ORDER.indexOf(b[0] as any))
          .map(([name, nodes]) => (
          <div key={name} className="section">
            <h3>{name}</h3>
            <div className="tiles">{nodes}</div>
            {name === 'Other' && otherHidden > 0 && (
              <div className="muted">+{otherHidden.toLocaleString()} more flags not drawn — see the flag table</div>
            )}
          </div>
        ))}
        {special('chat-support', <div className="chat">💬 Chat with us</div>)}
      </div>
    </div>
  );
}
