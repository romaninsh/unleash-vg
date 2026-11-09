// "What each part took", on the splash below the three runs: each thing the flag service needed,
// what a hand-built service has to write for it, and what it took here. Every Vantage line names
// something in this repository; the counts come from about.ts (measured 9 November 2026). The
// hand-built side is what you'd have to write, not an estimate of hours.
import { ABOUT } from "./about";

export type Comparison = { title: string; byHand: string; vantage: string };

const b = ABOUT.build, mcp = ABOUT.mcpCalls;

export const COMPARISON: Comparison[] = [
  {
    title: "Lists follow other people's changes",
    byHand: "A WebSocket server, change capture from the database, a subscription per open list, reconnect and catch-up.",
    vantage: "Vantage subscribes to SurrealDB's LIVE SELECT; query tables re-read on a timer (`refresh: 3` in api/flags.yaml). No sync code in web/flags.",
  },
  {
    title: "The web API",
    byHand: "Routes, request validation and response shapes per resource, with paging, sorting and filtering.",
    vantage: `api/flags.yaml: ${b.apiEntities} entities in ${b.apiLines} lines, each a \`columns:\` list with its \`filter:\` and sort.`,
  },
  {
    title: "Who may change what",
    byHand: "A permission check in every write endpoint, so a hidden button is never the only guard.",
    vantage: `A \`scope:\` rule on each of the ${b.scopedEntities} editable entities in api/flags.yaml; the server refuses writes outside it.`,
  },
  {
    title: "Audit log: who changed what, before and after",
    byHand: "Middleware or triggers on every write, a log table, and an endpoint to read it.",
    vantage: `\`log_changes:\` on ${b.loggedTables} tables writes into audit_event; tests/events.surql makes it append-only.`,
  },
  {
    title: "A typed client for the web app",
    byHand: "An OpenAPI spec and a client, kept in step with the server by hand.",
    vantage: `src/vantage.gen.ts, generated from the API's schema: ${b.generatedLines.toLocaleString("en-GB")} lines, never edited.`,
  },
  {
    title: "An admin app for the people who run it",
    byHand: "A second front end, or a paid admin tool wired to the database.",
    vantage: `The Vantage desktop app, from the same YAML: ${b.pages} pages, ${b.actions} actions and a ${b.menuLines}-line menu.`,
  },
  {
    title: "The Unleash SDK API",
    byHand: "A service for Unleash's client and frontend APIs, with its own data access layer.",
    vantage: `service/: ${b.rustLines.toLocaleString("en-GB")} lines of Rust on the Vantage crates, reading the same SurrealDB.`,
  },
  {
    title: "Running it locally",
    byHand: "Compose files, start scripts and health checks for the database and the SDK API.",
    vantage: `composer.yaml, ${b.composerLines} lines: Vantage UI starts SurrealDB and the SDK API and shows them in its Services panel.`,
  },
  {
    title: "Local, CI and production settings",
    byHand: "A config loader and secret handling per environment.",
    vantage: "Three profiles in application.yaml (9 lines), read by two datasource files.",
  },
  {
    title: "The development loop",
    byHand: "Node on the machine, a watcher, and a dev proxy to the API.",
    vantage: "Vantage UI builds web/flags in a container and serves it on the API's origin; the open tab reloads after each build.",
  },
  {
    title: "Deploying it",
    byHand: "Images for the API and the front end, static hosting with deep-link fallback, and a proxy between them.",
    vantage: `One ${b.dockerfileLines}-line Dockerfile on vantage-server, which serves the built web app and its API together.`,
  },
  {
    title: "The agent checking its own work",
    byHand: "Reading code and screenshots, and guessing what the server did.",
    vantage: `Vantage's MCP tools: the re-run called them ${mcp.total} times (logs ${mcp.logs}, data scripts ${mcp.dataScripts}, page opens ${mcp.pageOpens}).`,
  },
];
