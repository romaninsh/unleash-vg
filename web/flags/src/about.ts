// What the splash screen (Splash.tsx) says about how this app was made. Every number is measured,
// not estimated; refresh them rather than editing by hand:
//   sessions: python3 -I scripts/session_stats.py <session .jsonl>, for each run in `runs` below
//             (Claude Code keeps the logs under ~/.claude/projects/<project>/<session id>.jsonl);
//             the model is the assistant messages' message.model, the Vantage version is what
//             the run's check_version tool call returned
//   prompt:   the first line of the re-run's first user message, verbatim
//   spec:     the .md files in docs/spec and their lines
//   code:     git ls-files, all lines counted:
//             YAML   table/ page/ action/ api/ menu/ form/ view/ datasource/ and application.yaml
//             Rhai   script/
//             web    web/flags/src, without vantage.gen.ts (generated) and the splash's own files
//                    (Splash.tsx, splash.css, about.ts, comparison.ts)
//             Rust   service/src
//   tests:    test( in web/flags/e2e/flags.e2e.ts, it( / test( in web/flags/src/**/*.test.ts(x),
//             check lines in tests/rules_test.sh

export type Run = {
  label: string; vantage: string | null; date: string;
  prompts: number; activeHours: number; wallHours: number; modelTurns: number; toolCalls: number;
  outputTokens: number; inputTokens: number; cacheReadShare: number;
};

// Three builds from the same spec by the same agent. The first is the one the splash quotes: a
// clean re-run, not the build this repository grew from, so read it as what building from the
// spec takes. The spec was revised between 17 and 19 October.
export const RUNS: Run[] = [
  {
    label: "Vantage UI 1.7", vantage: "1.7.0", date: "19 October 2026",
    prompts: 1, activeHours: 0.7, wallHours: 0.7, modelTurns: 206, toolCalls: 455,
    outputTokens: 224_978, inputTokens: 105_586_560, cacheReadShare: 0.993,
  },
  {
    label: "Earlier Vantage, 1.5", vantage: "1.5.2", date: "17 October 2026",
    prompts: 35, activeHours: 3.9, wallHours: 9.2, modelTurns: 726, toolCalls: 1390,
    outputTokens: 691_015, inputTokens: 315_666_315, cacheReadShare: 0.994,
  },
  {
    label: "Without Vantage, any tools or language", vantage: null, date: "17 October 2026",
    prompts: 26, activeHours: 5.7, wallHours: 8.2, modelTurns: 494, toolCalls: 755,
    outputTokens: 557_024, inputTokens: 245_382_709, cacheReadShare: 0.996,
  },
];

export const ABOUT = {
  agent: "Claude Opus 5.5",       // claude-opus-5-5 in all three runs
  measuredOn: "9 November 2026",
  session: RUNS[0]!,
  mcpCalls: { total: 119, logs: 32, dataScripts: 22, pageOpens: 22 }, // the re-run's Vantage MCP tool calls
  prompt: 'Build "Flags": a feature-flag service for a white-label banking platform',
  spec: { documents: 11, lines: 1175 },                    // docs/spec/*.md
  build: {
    tables: 39, pages: 11, actions: 11,
    yamlFiles: 69, yamlLines: 1655, rhaiLines: 320,        // the Vantage app
    webFiles: 26, webLines: 2624, generatedLines: 1776,    // this web app; vantage.gen.ts apart
    apiEntities: 22, apiLines: 172, scopedEntities: 8,     // api/flags.yaml
    loggedTables: 16, menuLines: 16, composerLines: 38, dockerfileLines: 32,
    rustFiles: 10, rustLines: 1550,                        // the SDK API, service/src
    tests: 69, e2eTests: 25, unitTests: 14, ruleChecks: 30,
  },
} as const;
