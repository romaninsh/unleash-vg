import { useEffect, useRef, useState } from "react";
import { ABOUT, RUNS } from "./about";
import { COMPARISON } from "./comparison";
import "./splash.css";

// The first thing a browser session sees, over the sign-in page: what this app is, that it is a
// demo built with Vantage, and how it was made, in measured numbers (about.ts). Once per session
// (sessionStorage); "About this demo" in the sidebar opens it again.
// Colours are the sidebar's (styles.css), a shade darker, with the app's blue accent.

const SEEN = "flags.splash.seen";

export const openAbout = () => window.dispatchEvent(new Event("flags:about"));

// `code` in a comparison line renders as code
const withCode = (text: string) =>
  text.split("`").map((part, i) => (i % 2 ? <code key={i}>{part}</code> : part));

const fmt = (n: number) => n.toLocaleString("en-GB");
const s = ABOUT.session, b = ABOUT.build;
const speedup = Math.floor(RUNS[2]!.activeHours / s.activeHours);

type Stat = [value: string, label: string, note: string];

const SESSION: Stat[] = [
  [fmt(s.prompts), "prompt from the person", "pointing at the spec; the agent did the rest"],
  [`${s.activeHours} h`, "agent time, start to finish", `${s.date}, Vantage UI ${s.vantage}`],
  [fmt(s.modelTurns), "model turns", `${fmt(s.toolCalls)} tool calls`],
  [`${(s.outputTokens / 1e6).toFixed(2)} M`, "output tokens", `${Math.round(s.inputTokens / 1e6)} M input, ${(s.cacheReadShare * 100).toFixed(1)}% from cache`],
];

const REPO: Stat[] = [
  [`${b.tables} · ${b.pages} · ${b.actions}`, "tables · pages · actions", `${fmt(b.yamlLines)} lines of Vantage YAML, ${b.rhaiLines} of Rhai`],
  [fmt(b.webLines), "lines of web app", `${b.webFiles} files, React + TypeScript`],
  [fmt(b.rustLines), "lines of Rust", "the Unleash SDK API, in service/"],
  [fmt(b.tests), "automated tests", `${b.e2eTests} end-to-end, ${b.unitTests} unit, ${b.ruleChecks} database rules`],
];

function Stats({ title, stats }: { title: string; stats: Stat[] }) {
  return (
    <section className="splash-stats" aria-label={title}>
      <h2 className="splash-kicker">{title}</h2>
      <dl>
        {stats.map(([value, label, note]) => (
          <div key={label} className="splash-tile">
            <dd>{value}</dd>
            <dt>{label}</dt>
            <p>{note}</p>
          </div>
        ))}
      </dl>
    </section>
  );
}

export function Splash() {
  const [open, setOpen] = useState(() => sessionStorage.getItem(SEEN) !== "1");
  const button = useRef<HTMLButtonElement>(null);
  const close = () => { sessionStorage.setItem(SEEN, "1"); setOpen(false); };

  useEffect(() => {
    const again = () => setOpen(true);
    window.addEventListener("flags:about", again);
    return () => window.removeEventListener("flags:about", again);
  }, []);
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => button.current?.focus(), 50);
    // the splash has the keyboard while it shows: Enter or Esc closes it (Enter on another
    // button or link does that one's job instead), and nothing reaches the page underneath
    const onKey = (e: KeyboardEvent) => {
      const other = e.key === "Enter" && document.activeElement !== button.current
        && document.activeElement?.matches("button, a");
      if ((e.key === "Escape" || e.key === "Enter") && !other) { e.preventDefault(); e.stopImmediatePropagation(); close(); }
    };
    window.addEventListener("keydown", onKey, true);
    return () => { clearTimeout(t); window.removeEventListener("keydown", onKey, true); };
  }, [open]);

  if (!open) return null;
  return (
    <div className="splash" role="dialog" aria-modal="true" aria-labelledby="splash-title">
      <div className="splash-frame">
        <div className="splash-card">
          <div className="splash-top">
            <img src="/vantage-logo.svg" alt="Vantage" />
            <p className="splash-kicker">Demo built with Vantage UI</p>
          </div>

          <div className="splash-hero">
            <div className="splash-intro">
              <h1 id="splash-title">Flags. Flipped.</h1>
              <p className="splash-lead">
                A feature-flag service that Unleash SDKs use unchanged: flags × environments × brands, each flag on,
                off or a percentage, with customer allowlists and per-brand overrides.
              </p>
              <figure className="splash-prompt">
                <figcaption className="splash-kicker">One prompt, one written spec</figcaption>
                <blockquote>{ABOUT.prompt}</blockquote>
                <p>
                  The build prompt's first line. The prompt points the agent ({ABOUT.agent}) at the spec,{" "}
                  {ABOUT.spec.documents} documents and {fmt(ABOUT.spec.lines)} lines, now in <code>docs/spec</code>, and
                  lists the technical constraints.
                </p>
              </figure>
              <p>
                The admin is a Vantage app: tables, pages and rules in YAML over SurrealDB. This web admin runs on its
                live API. The brands, flags and people are sample data, and everyone shares the same demo.
              </p>
              <div className="splash-buttons">
                <button ref={button} type="button" className="splash-primary" onClick={close}>Explore Demo →</button>
                <a href="https://vantage-ui.com/download/" target="_blank" rel="noreferrer" className="splash-outline">
                  Build your own ↗
                </a>
              </div>
              <button type="button" className="splash-more"
                onClick={() => document.getElementById("splash-compare")?.scrollIntoView({ behavior: "smooth", block: "start" })}>
                The same spec, built three ways ↓
              </button>
            </div>

            <div className="splash-numbers">
              <Stats title="Measured on a clean re-run from the spec" stats={SESSION} />
              <Stats title="This repository" stats={REPO} />
              <p className="splash-small">
                The re-run is not the build this repository grew from; read its numbers as what building from the
                spec takes. Active time leaves out pauses over 10 minutes.
              </p>
            </div>
          </div>

          <section id="splash-compare" className="splash-compare" aria-labelledby="splash-compare-title">
            <p className="splash-kicker">Same spec, same agent, three builds</p>
            <h2 id="splash-compare-title">LLM with Vantage built it {speedup} times faster</h2>
            <ol className="splash-runs">
              {RUNS.map((r, i) => (
                <li key={r.label} className={i === 0 ? "current" : undefined}>
                  <h3>{r.label}</h3>
                  <p className="splash-run-head">{fmt(r.prompts)} {r.prompts === 1 ? "prompt" : "prompts"} · {r.activeHours} h</p>
                  <p>
                    {fmt(r.modelTurns)} model turns, {fmt(r.toolCalls)} tool calls
                    {r.wallHours !== r.activeHours && `, ${r.wallHours} h on the clock`}. {r.date}.
                  </p>
                </li>
              ))}
            </ol>
            <p className="splash-small">
              Each from its session log (scripts/session_stats.py), all by {ABOUT.agent}. The spec was revised between
              the 17 October runs and the re-run.
            </p>

            <h3 className="splash-kicker splash-parts">What each part took</h3>
            <ol className="splash-list">
              {COMPARISON.map((c, i) => (
                <li key={c.title}>
                  <h4><span>{String(i + 1).padStart(2, "0")}</span>{c.title}</h4>
                  <p className="byhand"><b aria-label="By hand">✕</b><span><em>By hand: </em>{withCode(c.byHand)}</span></p>
                  <p className="vantage"><b aria-label="Vantage">✓</b><span><em>Vantage: </em>{withCode(c.vantage)}</span></p>
                </li>
              ))}
            </ol>
          </section>
        </div>
      </div>
    </div>
  );
}
