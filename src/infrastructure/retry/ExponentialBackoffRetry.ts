import { RetryPolicy, RetryContext, RetryDecision } from '../../application/ports/RetryPolicy';

/**
 * Exponential backoff with jitter retry strategy.
 *
 * - `errorType: 'http'` (403, 503) and `'network'` (statusCode 0): retries with exponential backoff.
 * - `errorType: 'session'`: returns `{ shouldRetry: false }` immediately, deferring to session refresh logic.
 * - After `maxRetries` attempts: returns `{ shouldRetry: false }`.
 */
export class ExponentialBackoffRetry implements RetryPolicy {
  constructor(
    private readonly maxRetries: number = 3,
    private readonly baseDelayMs: number = 2000,
    private readonly maxDelayMs: number = 30000,
  ) {}

  evaluate(ctx: RetryContext): RetryDecision {
    if (ctx.errorType === 'session') {
      return { shouldRetry: false, delayMs: 0 };
    }

    if (ctx.attempt >= this.maxRetries) {
      return { shouldRetry: false, delayMs: 0 };
    }

    if (ctx.errorType === 'network' || ctx.statusCode === 403 || ctx.statusCode === 503) {
      const exponentialDelay = this.baseDelayMs * Math.pow(2, ctx.attempt);
      const jitter = Math.random() * this.baseDelayMs;
      const delayMs = Math.min(exponentialDelay + jitter, this.maxDelayMs);

      return { shouldRetry: true, delayMs };
    }

    return { shouldRetry: false, delayMs: 0 };
  }
}
