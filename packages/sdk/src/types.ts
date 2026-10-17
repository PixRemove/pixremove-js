/** Anything that holds the image bytes. File paths are the CLI's job. */
export type ImageInput = Uint8Array | ArrayBuffer | Blob;

/**
 * Quality tier. `standard` is the default; `precise` costs twice as much and
 * keeps fine edges (hair, fur, glass) better. A `prompt` always runs on the
 * guided tier, whatever is set here.
 */
export type RemovalTier = 'standard' | 'precise' | (string & {});

export type RemoveBackgroundOptions = {
  tier?: RemovalTier;
  /**
   * What to keep, in plain words ("only the bag", "the person on the left").
   * Turns the run into a guided cut-out, priced at the guided tier.
   */
  prompt?: string;
  /** Shown in the run history on pixremove.com. Defaults to `image.png` / `image.jpg`. */
  filename?: string;
  /**
   * Your name for this run (8–64 chars of `A-Za-z0-9_-`). Retrying with the
   * same key returns the same run instead of charging twice. The SDK makes
   * one up when you leave it out, so its own retries are always safe.
   */
  idempotencyKey?: string;
  /** Give up waiting after this long. Default 120 000 ms. */
  timeoutMs?: number;
  signal?: AbortSignal;
};

export type RemoveBackgroundResult = {
  taskId: string;
  /** The cut-out as a transparent PNG. */
  data: Uint8Array;
  mimeType: 'image/png';
  width: number;
  height: number;
  creditsCharged: number;
};

export type TaskStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';

export type Task = {
  id: string;
  status: TaskStatus | (string & {});
  active: boolean;
  creditsCharged: number;
  errorCode: string | null;
  errorMessage: string | null;
  canvas: { width: number; height: number } | null;
  /** Where the finished cut-out can be fetched, relative to the API base URL. */
  cutoutPath: string | null;
};

export type CreatedTask = {
  taskId: string;
  status: string;
  creditsHeld: number;
  /** True when an earlier request with the same idempotency key already made this run. */
  replayed: boolean;
};

export type Account = {
  signedIn: boolean;
  /** Credit balance. */
  credits: number | null;
  limits: {
    /** Credits one standard removal costs. */
    removalCost: number;
    /** Runs one account may have in flight at once. */
    concurrency: number;
    maxBatch: number;
  } | null;
  user: { id: string; name: string; email: string; image: string | null } | null;
};
