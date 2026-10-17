import { describe, expect, it } from 'vitest';
import { PixRemove, PixRemoveError, readImageInfo } from '../src/index.js';

/** Smallest valid PNG header: signature + IHDR with the given size. */
function png(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(33);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  const view = new DataView(bytes.buffer);
  view.setUint32(8, 13);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

/** JPEG with an APP0 segment before the SOF0 frame. */
function jpeg(width: number, height: number): Uint8Array {
  return new Uint8Array([
    0xff, 0xd8,
    0xff, 0xe0, 0x00, 0x04, 0x00, 0x00,
    0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 0xff, width >> 8, width & 0xff, 0x03,
    0, 0, 0, 0, 0, 0, 0, 0, 0,
  ]);
}

type Call = { url: string; method: string; headers: Record<string, string>; body: unknown };

function fakeApi(routes: Array<(call: Call) => Response | undefined>) {
  const calls: Call[] = [];
  const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit) => {
    const call: Call = {
      url: String(input),
      method: init?.method ?? 'GET',
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: init?.body,
    };
    calls.push(call);
    for (const route of routes) {
      const response = route(call);
      if (response) return response;
    }
    return new Response('no route', { status: 599 });
  };
  return { calls, fetch: fetchImpl as typeof fetch };
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });

const doneTask = {
  id: 't1',
  status: 'succeeded',
  active: false,
  creditsCharged: 2,
  errorCode: null,
  errorMessage: null,
  canvas: { width: 640, height: 480 },
  cutoutPath: '/api/tasks/t1/layer/cutout',
};

describe('readImageInfo', () => {
  it('reads PNG and JPEG sizes', () => {
    expect(readImageInfo(png(640, 480))).toEqual({ mimeType: 'image/png', width: 640, height: 480 });
    expect(readImageInfo(jpeg(1200, 800))).toEqual({
      mimeType: 'image/jpeg',
      width: 1200,
      height: 800,
    });
  });

  it('rejects other formats', () => {
    const webp = new TextEncoder().encode('RIFF\0\0\0\0WEBPVP8 ');
    expect(() => readImageInfo(webp)).toThrow(/Only PNG and JPEG/);
  });
});

describe('removeBackground', () => {
  it('uploads, starts, polls and downloads with the API key', async () => {
    let polls = 0;
    const api = fakeApi([
      (c) => (c.url.endsWith('/api/v1/upload') ? json({ key: 'src/1.png' }, 201) : undefined),
      (c) =>
        c.url.endsWith('/api/v1/remove-background')
          ? json({ taskId: 't1', status: 'queued', creditsHeld: 2, replayed: false }, 201)
          : undefined,
      (c) =>
        c.url.endsWith('/api/v1/tasks/t1')
          ? json(++polls < 2 ? { ...doneTask, status: 'running', active: true, cutoutPath: null } : doneTask)
          : undefined,
      (c) => (c.url.endsWith('/layer/cutout') ? new Response(new Uint8Array([1, 2, 3])) : undefined),
    ]);
    const client = new PixRemove({ apiKey: 'pr_test', fetch: api.fetch, baseUrl: 'https://x.test/' });

    const result = await client.removeBackground(png(640, 480), { prompt: 'only the cat' });

    expect(result).toMatchObject({ taskId: 't1', creditsCharged: 2, width: 640, height: 480 });
    expect([...result.data]).toEqual([1, 2, 3]);
    expect(api.calls.every((c) => c.headers['x-api-key'] === 'pr_test')).toBe(true);
    expect(api.calls[0]!.headers['content-type']).toBe('image/png');
    const start = JSON.parse(String(api.calls[1]!.body));
    expect(start).toMatchObject({
      sourceKey: 'src/1.png',
      mimeType: 'image/png',
      width: 640,
      height: 480,
      sizeBytes: 33,
      prompt: 'only the cat',
    });
    expect(start.idempotencyKey).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
    expect(api.calls.at(-1)!.url).toBe('https://x.test/api/tasks/t1/layer/cutout');
  });

  it('retries a 429 on start with the same idempotency key', async () => {
    let starts = 0;
    const api = fakeApi([
      (c) => (c.url.endsWith('/upload') ? json({ key: 'k' }, 201) : undefined),
      (c) =>
        c.url.endsWith('/remove-background')
          ? ++starts === 1
            ? json({ error: { code: 'rate_limit', message: 'slow down' } }, 429, { 'retry-after': '0.01' })
            : json({ taskId: 't1', status: 'queued', creditsHeld: 2, replayed: false }, 201)
          : undefined,
      (c) => (c.url.endsWith('/tasks/t1') ? json(doneTask) : undefined),
      (c) => (c.url.endsWith('/cutout') ? new Response(new Uint8Array([9])) : undefined),
    ]);
    const client = new PixRemove({ apiKey: 'k', fetch: api.fetch });

    await client.removeBackground(png(10, 10));

    const bodies = api.calls.filter((c) => c.url.endsWith('/remove-background')).map((c) => JSON.parse(String(c.body)));
    expect(bodies).toHaveLength(2);
    expect(bodies[0].idempotencyKey).toBe(bodies[1].idempotencyKey);
  });

  it('surfaces API errors with their code and details', async () => {
    const api = fakeApi([
      (c) => (c.url.endsWith('/upload') ? json({ key: 'k' }, 201) : undefined),
      (c) =>
        c.url.endsWith('/remove-background')
          ? json(
              { error: { code: 'insufficient_credits', message: 'Top up', details: { required: 2, balance: 0 } } },
              402
            )
          : undefined,
    ]);
    const client = new PixRemove({ apiKey: 'k', fetch: api.fetch });

    const error = await client.removeBackground(png(10, 10)).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(PixRemoveError);
    expect(error).toMatchObject({ status: 402, code: 'insufficient_credits', details: { required: 2, balance: 0 } });
  });

  it('throws task_failed when the run fails', async () => {
    const api = fakeApi([
      (c) => (c.url.endsWith('/upload') ? json({ key: 'k' }, 201) : undefined),
      (c) =>
        c.url.endsWith('/remove-background')
          ? json({ taskId: 't1', status: 'queued', creditsHeld: 2, replayed: false }, 201)
          : undefined,
      (c) =>
        c.url.endsWith('/tasks/t1')
          ? json({ ...doneTask, status: 'failed', cutoutPath: null, errorCode: 'moderation', errorMessage: 'Refused' })
          : undefined,
    ]);
    const client = new PixRemove({ apiKey: 'k', fetch: api.fetch });

    await expect(client.removeBackground(png(10, 10))).rejects.toMatchObject({
      code: 'task_failed',
      taskId: 't1',
      message: 'Refused',
      details: { errorCode: 'moderation' },
    });
  });

  it('times out instead of polling forever', async () => {
    const api = fakeApi([
      (c) => (c.url.endsWith('/upload') ? json({ key: 'k' }, 201) : undefined),
      (c) =>
        c.url.endsWith('/remove-background')
          ? json({ taskId: 't1', status: 'queued', creditsHeld: 2, replayed: false }, 201)
          : undefined,
      (c) => (c.url.endsWith('/tasks/t1') ? json({ ...doneTask, status: 'running', active: true }) : undefined),
    ]);
    const client = new PixRemove({ apiKey: 'k', fetch: api.fetch });

    await expect(client.removeBackground(png(10, 10), { timeoutMs: 50 })).rejects.toMatchObject({
      code: 'timeout',
    });
  });

  it('requires an API key', () => {
    expect(() => new PixRemove({ apiKey: '' })).toThrow(/Missing apiKey/);
  });
});
