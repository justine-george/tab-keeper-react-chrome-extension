import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

// KAN-561. A saved page that restores lazily: data: no longer does (it opens directly), and context.route
// misses a window's first tab, which navigates before Playwright attaches. One loopback server per worker.
const server = createServer((request, response) => {
  const url = new URL(request.url ?? '/', 'http://x');
  const name = decodeURIComponent(url.pathname.slice(1));
  response.setHeader('Content-Type', 'text/html; charset=utf-8');
  setTimeout(
    () => response.end(`<title>${name}</title>`),
    Number(url.searchParams.get('hold') ?? 0)
  );
});
await new Promise<void>((listening) =>
  server.listen(0, '127.0.0.1', listening)
);
server.unref();
const { port } = server.address() as AddressInfo;

// A real http page titled `name`.
export const standIn = (name: string): string =>
  `http://127.0.0.1:${port}/${encodeURIComponent(name)}`;

// The same page, answered `ms` after it is asked for: a tab that stays loading that long.
export const heldStandIn = (name: string, ms: number): string =>
  `${standIn(name)}?hold=${ms}`;
