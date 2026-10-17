/**
 * Every failure the SDK raises. `code` is the API's machine-readable code
 * (`insufficient_credits`, `rate_limit`, `input`, …) or one of the SDK's own
 * (`network`, `timeout`, `task_failed`), so callers can branch on it without
 * parsing messages.
 */
export class PixRemoveError extends Error {
  override readonly name = 'PixRemoveError';
  /** HTTP status, or 0 when the request never got an answer. */
  readonly status: number;
  readonly code: string;
  readonly details: unknown;
  /** Present when the failure belongs to one run. */
  readonly taskId: string | undefined;

  constructor(init: {
    status: number;
    code: string;
    message: string;
    details?: unknown;
    taskId?: string;
    cause?: unknown;
  }) {
    super(init.message, init.cause === undefined ? undefined : { cause: init.cause });
    this.status = init.status;
    this.code = init.code;
    this.details = init.details;
    this.taskId = init.taskId;
  }
}

/** Error codes the API and the SDK use. Other strings may appear later. */
export const ERROR_CODE = {
  UNAUTHENTICATED: 'unauthenticated',
  EMAIL_NOT_VERIFIED: 'email_not_verified',
  INPUT: 'input',
  INSUFFICIENT_CREDITS: 'insufficient_credits',
  MODERATION: 'moderation',
  RATE_LIMIT: 'rate_limit',
  NOT_FOUND: 'not_found',
  PROVIDER: 'provider',
  INTERNAL: 'internal',
  NETWORK: 'network',
  TIMEOUT: 'timeout',
  TASK_FAILED: 'task_failed',
} as const;
