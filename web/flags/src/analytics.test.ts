import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// analytics.ts loads gtag once per page, so each case gets a fresh module and window
async function trackOn(hostname: string) {
  vi.stubGlobal("location", { hostname, host: hostname });
  const append = vi.spyOn(document.head, "appendChild").mockImplementation((n) => n);
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  const { track } = await import("./analytics");
  track("demo_action", { action: "toggle_flag" });
  return { append, log };
}

describe("track", () => {
  beforeEach(() => {
    vi.resetModules();
    delete window.gtag;
    delete window.dataLayer;
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("only logs, and loads nothing, off the production host", async () => {
    const { append, log } = await trackOn("localhost");
    expect(append).not.toHaveBeenCalled();
    expect(window.gtag).toBeUndefined();
    expect(log).toHaveBeenCalledWith("[ga] demo_action", { action: "toggle_flag" });
  });

  it("loads gtag on flags.demo.vantage-ui.com and sends the event", async () => {
    const { append, log } = await trackOn("flags.demo.vantage-ui.com");
    expect(append).toHaveBeenCalledTimes(1);
    expect((append.mock.calls[0]![0] as HTMLScriptElement).src).toBe("https://www.googletagmanager.com/gtag/js?id=G-R3BJYDRX24");
    const calls = window.dataLayer!.map((a) => Array.from(a as IArguments));
    expect(calls).toContainEqual(["config", "G-R3BJYDRX24", { content_group: "demo-flags" }]);
    expect(calls).toContainEqual(["event", "demo_action", { action: "toggle_flag" }]);
    expect(log).not.toHaveBeenCalled();
  });
});
