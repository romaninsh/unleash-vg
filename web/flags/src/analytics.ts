// Google Analytics, on the hosted demo only. The same GA4 property as vantage-ui.com, so with the
// default cookie_domain ('auto') a visit carries across *.vantage-ui.com. Anywhere else (localhost,
// *.run.app, e2e runs) track() logs to the console and nothing is loaded or sent.
// Page views come from GA's enhanced measurement (browser history changes), not from here.

export const MEASUREMENT_ID = "G-R3BJYDRX24";
export const PRODUCTION_HOST = "flags.demo.vantage-ui.com";

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

export type Params = Record<string, string | number | boolean>;

/** Loads gtag once, on the production host; true when events go to GA. */
function ready(): boolean {
  if (location.hostname !== PRODUCTION_HOST) return false;
  if (window.gtag) return true;
  window.dataLayer = window.dataLayer ?? [];
  // gtag.js reads `arguments` objects off the data layer, not arrays
  window.gtag = function gtag() {
    window.dataLayer!.push(arguments);
  };
  window.gtag("js", new Date());
  window.gtag("config", MEASUREMENT_ID, { content_group: "demo-flags" });
  const script = document.createElement("script");
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${MEASUREMENT_ID}`;
  document.head.appendChild(script);
  return true;
}

export function track(name: string, params: Params = {}) {
  if (ready()) window.gtag!("event", name, params);
  else console.log(`[ga] ${name}`, params);
}

/** At start-up: loads the tag (for page views) and reports clicks on links that leave the app. */
export function startAnalytics() {
  ready();
  document.addEventListener("click", (e) => {
    const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
    if (a && a.host && a.host !== location.host) track("outbound_click", { link_url: a.href });
  }, true);
}
