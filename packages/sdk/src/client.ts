import { ERROR_CODE, PixRemoveError } from './errors.js';
import { readImageInfo, type ImageMime } from './image.js';
import type {
  Account,
  CreatedTask,
  ImageInput,
  RemoveBackgroundOptions,
  RemoveBackgroundResult,
  Task,
} from './types.js';

export const DEFAULT_BASE_URL = 'https://pixremove.com';
const API_PREFIX = '/api/v1';
/** The API rejects larger sources; checking here saves the upload. */
export const MAX_INPUT_BYTES = 30 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 120_000;

export type PixRemoveOptions = {
  /** Create one at pixremove.com → Settings → API keys. */
  apiKey: string;
  baseUrl?: string;
  /** Retries for rate limits, 5xx answers and dropped connections. Default 3. */
  maxRetries?: number;
  /** Swap in your own fetch (proxies, tests). Defaults to the global one. */
  fetch?: typeof fetch;
};

type RequestOptions = {
  method?: string;
  headers?: Record<string, string>;
  body?: BodyInit;
  signal?: AbortSignal;
  /** Safe to send again after a 5xx or a dropped connection. */
  retryable?: boolean;
};

export class PixRemove {
  readonly baseUrl: string;
  readonly #apiKey: string;
  readonly #maxRetries: number;
  readonly #fetch: typeof fetch;

  constructor(options: PixRemoveOptions) {
    if (!options?.apiKey) {
      throw new PixRemoveError({
        status: 0,
        code: ERROR_CODE.UNAUTHENTICATED,
        message: 'Missing apiKey. Create one at https://pixremove.com/settings/api-keys.',
      });
    }
    this.#apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.#maxRetries = options.maxRetries ?? 3;
    this.#fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  }

  /**
   * Remove the background and wait for the result: upload, start the run,
   * poll until it finishes, download the transparent PNG.
   */
  async removeBackground(
    image: ImageInput,
    options: RemoveBackgroundOptions = {}
  ): Promise<RemoveBackgroundResult> {
    const signal = withTimeout(options.signal, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    const bytes = await toBytes(image);
    const info = readImageInfo(bytes);

    const sourceKey = await this.upload(bytes, info.mimeType, signal);
    const created = await this.createTask(
      {
        sourceKey,
        filename: options.filename ?? (info.mimeType === 'image/png' ? 'image.png' : 'image.jpg'),
        mimeType: info.mimeType,
        sizeBytes: bytes.byteLength,
        width: info.width,
        height: info.height,
        prompt: options.prompt,
        idempotencyKey: options.idempotencyKey ?? newIdempotencyKey(),
      },
      signal
    );
    const task = await this.waitForTask(created.taskId, { signal });
    const data = await this.downloadCutout(task, signal);

    return {
      taskId: task.id,
      data,
      mimeType: 'image/png',
      width: task.canvas?.width ?? info.width,
      height: task.canvas?.height ?? info.height,
      creditsCharged: task.creditsCharged,
    };
  }

  /** Balance and limits for the key's account. */
  async getAccount(signal?: AbortSignal): Promise<Account> {
    const response = await this.#request(`${API_PREFIX}/me`, { signal, retryable: true });
    return (await response.json()) as Account;
  }

  /** Put a PNG or JPEG into storage; returns the key `createTask` takes. */
  async upload(bytes: Uint8Array, mimeType: ImageMime, signal?: AbortSignal): Promise<string> {
    if (bytes.byteLength > MAX_INPUT_BYTES) {
      throw new PixRemoveError({
        status: 413,
        code: ERROR_CODE.INPUT,
        message: `Image must be under ${MAX_INPUT_BYTES / 1024 / 1024} MB.`,
      });
    }
    const response = await this.#request(`${API_PREFIX}/upload`, {
      method: 'POST',
      headers: { 'content-type': mimeType },
      body: bytes as Uint8Array<ArrayBuffer>,
      signal,
      // A repeated upload only leaves an unused object behind.
      retryable: true,
    });
    const { key } = (await response.json()) as { key: string };
    return key;
  }

  /** Start one run. Credits are held now and settled when it finishes. */
  async createTask(
    input: {
      sourceKey: string;
      filename: string;
      mimeType: ImageMime;
      sizeBytes: number;
      width: number;
      height: number;
      /** Reserved for quality tiers; leave unset. */
      tier?: string;
      prompt?: string;
      idempotencyKey?: string;
    },
    signal?: AbortSignal
  ): Promise<CreatedTask> {
    const response = await this.#request(`${API_PREFIX}/remove-background`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
      signal,
      // Without a key a retry could start (and charge) a second run.
      retryable: Boolean(input.idempotencyKey),
    });
    return (await response.json()) as CreatedTask;
  }

  async getTask(taskId: string, signal?: AbortSignal): Promise<Task> {
    const response = await this.#request(`${API_PREFIX}/tasks/${encodeURIComponent(taskId)}`, {
      signal,
      retryable: true,
    });
    return (await response.json()) as Task;
  }

  /**
   * Poll until the run leaves the queue. Resolves with a succeeded task and
   * throws `task_failed` (with the run's own code in `details`) otherwise.
   */
  async waitForTask(
    taskId: string,
    options: { signal?: AbortSignal; intervalMs?: number } = {}
  ): Promise<Task> {
    let delay = options.intervalMs ?? 1000;
    for (;;) {
      const task = await this.getTask(taskId, options.signal);
      if (!task.active) {
        if (task.status === 'succeeded' && task.cutoutPath) return task;
        throw new PixRemoveError({
          status: 0,
          code: ERROR_CODE.TASK_FAILED,
          message: task.errorMessage ?? `The run ended as "${task.status}".`,
          details: { status: task.status, errorCode: task.errorCode },
          taskId,
        });
      }
      await sleep(delay, options.signal);
      delay = Math.min(delay * 1.5, 3000);
    }
  }

  /** The finished cut-out as PNG bytes. */
  async downloadCutout(task: Task, signal?: AbortSignal): Promise<Uint8Array> {
    if (!task.cutoutPath) {
      throw new PixRemoveError({
        status: 0,
        code: ERROR_CODE.TASK_FAILED,
        message: 'This run has no cut-out yet.',
        taskId: task.id,
      });
    }
    const response = await this.#request(task.cutoutPath, { signal, retryable: true });
    return new Uint8Array(await response.arrayBuffer());
  }

  async #request(path: string, options: RequestOptions = {}): Promise<Response> {
    const url = new URL(path, `${this.baseUrl}/`).toString();
    for (let attempt = 0; ; attempt++) {
      let response: Response;
      try {
        response = await this.#fetch(url, {
          method: options.method ?? 'GET',
          headers: {
            'x-api-key': this.#apiKey,
            'user-agent': USER_AGENT,
            ...options.headers,
          },
          body: options.body,
          signal: options.signal,
        });
      } catch (cause) {
        if (options.signal?.aborted) throw abortError(options.signal, cause);
        if (options.retryable && attempt < this.#maxRetries) {
          await sleep(backoff(attempt), options.signal);
          continue;
        }
        throw new PixRemoveError({
          status: 0,
          code: ERROR_CODE.NETWORK,
          message: 'Could not reach PixRemove.',
          cause,
        });
      }

      if (response.ok) return response;

      // A rate limit means nothing was started, so it is always safe to retry.
      const canRetry =
        attempt < this.#maxRetries &&
        (response.status === 429 || (options.retryable && response.status >= 500));
      if (canRetry) {
        const retryAfter = Number(response.headers.get('retry-after'));
        await response.body?.cancel();
        await sleep(
          Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : backoff(attempt),
          options.signal
        );
        continue;
      }
      throw await toError(response);
    }
  }
}

const USER_AGENT = 'pixremove-js/0.1.1';

async function toError(response: Response): Promise<PixRemoveError> {
  let body: { error?: { code?: string; message?: string; details?: unknown } } = {};
  try {
    body = (await response.json()) as typeof body;
  } catch {
    // Not JSON (a proxy page, an empty 502): fall back to the status.
  }
  return new PixRemoveError({
    status: response.status,
    code: body.error?.code ?? (response.status >= 500 ? ERROR_CODE.INTERNAL : 'http_error'),
    message: body.error?.message ?? `PixRemove answered ${response.status}.`,
    details: body.error?.details,
  });
}

async function toBytes(image: ImageInput): Promise<Uint8Array> {
  if (image instanceof Uint8Array) return image;
  if (image instanceof ArrayBuffer) return new Uint8Array(image);
  if (typeof Blob !== 'undefined' && image instanceof Blob) {
    return new Uint8Array(await image.arrayBuffer());
  }
  throw new PixRemoveError({
    status: 0,
    code: ERROR_CODE.INPUT,
    message: 'Pass the image as a Uint8Array, ArrayBuffer or Blob.',
  });
}

function newIdempotencyKey(): string {
  return `sdk_${globalThis.crypto.randomUUID().replaceAll('-', '')}`;
}

function backoff(attempt: number): number {
  return Math.min(500 * 2 ** attempt, 8000) * (0.75 + Math.random() * 0.5);
}

function withTimeout(signal: AbortSignal | undefined, ms: number): AbortSignal {
  const timeout = AbortSignal.timeout(ms);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

function abortError(signal: AbortSignal, cause?: unknown): PixRemoveError {
  const timedOut = signal.reason instanceof DOMException && signal.reason.name === 'TimeoutError';
  return new PixRemoveError({
    status: 0,
    code: timedOut ? ERROR_CODE.TIMEOUT : 'aborted',
    message: timedOut ? 'Timed out waiting for PixRemove.' : 'The request was aborted.',
    cause: cause ?? signal.reason,
  });
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError(signal));
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError(signal!));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
