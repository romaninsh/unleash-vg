// tests/probe.mjs - what the web probes share: a signed-in connection to the flags web API over
// the raw protocol (node 22+), and the checks that decide the probe's exit code. A probe that
// can't reach the server fails at once: a socket error, a close while a reply is pending, a
// refused sign-in or a reply that takes over 5 s exits 1 before any later check runs.
import { isDeepStrictEqual } from "node:util";

const REPLY_WAIT_MS = 5000;
let checks = 0, failed = 0;

function abort(why) {
  console.log(`FAIL: ${why}`);
  process.exit(1);
}

export function connect(apiUrl, token) {
  const url = apiUrl.replace(/^http/, "ws") + "/v1/ws";
  return new Promise((resolve) => {
    const ws = new WebSocket(url);
    const pending = new Map(), pushed = [];
    let id = 0, closing = false;
    const send = (frame) => new Promise((res) => {
      frame.id = ++id;
      const timer = setTimeout(() => abort(`no reply to ${frame.t} on ${frame.table ?? ""} in ${REPLY_WAIT_MS / 1000} s`), REPLY_WAIT_MS);
      pending.set(frame.id, (reply) => { clearTimeout(timer); res(reply); });
      ws.send(JSON.stringify(frame));
    });
    ws.onmessage = (m) => {
      const f = JSON.parse(m.data);
      if (f.id && pending.has(f.id)) { pending.get(f.id)(f); pending.delete(f.id); }
      else pushed.push(f);
    };
    ws.onerror = () => abort(`can't reach ${url}`);
    ws.onclose = () => { if (!closing && pending.size) abort(`${url} closed the connection`); };
    ws.onopen = async () => {
      const hello = await send({ t: "hello", protocol: 1, token });
      if (hello.t !== "welcome") abort(`sign-in as ${token.split(":")[0]} refused: ${hello.message ?? hello.t}`);
      // pushed: the frames that answer no request (a subscription's members / changed updates)
      resolve({ send, pushed, close: () => { closing = true; ws.close(); }, principal: hello.principal });
    };
  });
}

export function check(label, pass, detail) {
  checks++;
  if (!pass) failed++;
  console.log(`${pass ? "ok  " : "FAIL"} ${label}${pass ? "" : `: ${detail}`}`);
}

const outcome = (reply) => `${reply.t}${reply.message ? ` (${reply.message})` : ""}`;

export function ok(label, reply) {
  check(label, !["rejected", "error", "timeout"].includes(reply.t), outcome(reply));
}

export function refused(label, reply, match) {
  check(label, reply.t === "rejected" && (!match || match.test(reply.message ?? "")), outcome(reply));
}

export function equal(label, actual, expected) {
  check(label, isDeepStrictEqual(actual, expected), `got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
}

export function done() {
  console.log(`${checks} checks, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
}

// The records of an open_table / open_records reply as a list.
export const rows = (reply) => (Array.isArray(reply.records) ? reply.records : Object.values(reply.records ?? {}));

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
