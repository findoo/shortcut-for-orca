import { startProxy, type RunningProxy } from './proxy.ts';

describe('startProxy', () => {
  const open: RunningProxy[] = [];
  afterEach(async () => {
    await Promise.all(open.splice(0).map((p) => p.close().catch(() => {})));
  });

  it('serves, rejects a busy port, and frees it on close', async () => {
    const a = await startProxy(0, {});
    open.push(a);
    expect(a.port).toBeGreaterThan(0);
    const res = await fetch(`http://127.0.0.1:${a.port}/rest/api/2/myself`);
    expect(res.status).toBe(401);

    await expect(startProxy(a.port, {})).rejects.toThrow(/already in use/);

    await a.close();
    const c = await startProxy(a.port, {});
    open.push(c);
    expect(c.port).toBe(a.port);
  });
});
