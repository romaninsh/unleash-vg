import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

export const BACKEND_TOKEN = 'default:production.backend-test-token';
export const FRONTEND_TOKEN = 'default:production.frontend-test-token';

/** Spec 03, worked example 2: ON for all, OFF for bank-b, bank-c 10% + customers 1001/1002. */
export const FEATURES = {
  version: 2,
  features: [
    {
      name: 'debit-card-payments',
      type: 'release',
      project: 'default',
      enabled: true,
      stale: false,
      impressionData: false,
      variants: [],
      strategies: [
        {
          name: 'flexibleRollout',
          constraints: [{ contextName: 'brand', operator: 'IN', values: ['bank-c'], inverted: false, caseInsensitive: false }],
          parameters: { rollout: '10', stickiness: 'userId', groupId: 'debit-card-payments' },
          variants: [],
        },
        {
          name: 'flexibleRollout',
          constraints: [
            { contextName: 'brand', operator: 'IN', values: ['bank-c'], inverted: false, caseInsensitive: false },
            { contextName: 'userId', operator: 'IN', values: ['1001', '1002'], inverted: false, caseInsensitive: false },
          ],
          parameters: { rollout: '100', stickiness: 'default', groupId: 'debit-card-payments' },
          variants: [],
        },
        {
          name: 'flexibleRollout',
          constraints: [
            { contextName: 'brand', operator: 'NOT_IN', values: ['bank-b', 'bank-c'], inverted: false, caseInsensitive: false },
          ],
          parameters: { rollout: '100', stickiness: 'default', groupId: 'debit-card-payments' },
          variants: [],
        },
      ],
    },
    {
      name: 'sso-login',
      type: 'release',
      project: 'default',
      enabled: true,
      stale: true,
      impressionData: false,
      variants: [],
      strategies: [
        {
          name: 'flexibleRollout',
          constraints: [],
          parameters: { rollout: '100', stickiness: 'default', groupId: 'sso-login' },
          variants: [],
        },
      ],
    },
    { name: 'dark-mode', type: 'release', project: 'default', enabled: false, stale: false, impressionData: false, variants: [], strategies: [] },
  ],
  query: { environment: 'production' },
};

export interface FakeTarget {
  url: string;
  requests: { method: string; path: string; query: URLSearchParams }[];
  close(): Promise<void>;
}

/**
 * Minimal Unleash-compatible target. Its Frontend API is deliberately buggy for `dark-mode`
 * (reports it ON) so tests can check that the bench flags the disagreement.
 */
export async function startFakeTarget(): Promise<FakeTarget> {
  const requests: FakeTarget['requests'] = [];
  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://fake');
    requests.push({ method: req.method ?? 'GET', path: url.pathname, query: url.searchParams });
    const auth = req.headers.authorization;
    const send = (status: number, body?: unknown, headers: Record<string, string> = {}) => {
      res.writeHead(status, { 'content-type': 'application/json', ...headers });
      res.end(body === undefined ? undefined : JSON.stringify(body));
    };
    req.resume();
    req.on('end', () => {
      if (url.pathname === '/api/client/features') {
        if (auth !== BACKEND_TOKEN) return send(401, { error: 'unauthorized' });
        const etag = '"fake:1:v1"';
        if (req.headers['if-none-match'] === etag) {
          res.writeHead(304);
          return res.end();
        }
        return send(200, FEATURES, { etag });
      }
      if (url.pathname === '/api/client/register' || url.pathname === '/api/client/metrics') {
        res.writeHead(202);
        return res.end();
      }
      if (url.pathname === '/api/frontend') {
        if (auth !== FRONTEND_TOKEN) return send(401, { error: 'unauthorized' });
        const brand = url.searchParams.get('properties[brand]');
        const toggles = [{ name: 'sso-login', enabled: true }, { name: 'dark-mode', enabled: true }];
        if (brand !== 'bank-b' && brand !== 'bank-c') toggles.push({ name: 'debit-card-payments', enabled: true });
        return send(200, {
          toggles: toggles.map((t) => ({ ...t, impressionData: false, variant: { name: 'disabled', enabled: false } })),
        });
      }
      send(404, { error: 'not found' });
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    close: () => new Promise((r) => server.close(() => r())),
  };
}
