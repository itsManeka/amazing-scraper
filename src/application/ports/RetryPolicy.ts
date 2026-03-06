export type RetryErrorType = 'network' | 'http' | 'session';

export interface RetryContext {
  attempt: number;
  /** HTTP status code, or 0 for network errors (no HTTP response). */
  statusCode: number;
  errorType: RetryErrorType;
}

export interface RetryDecision {
  shouldRetry: boolean;
  delayMs: number;
}

/**
 * Port for retry strategy.
 * Implementations decide whether a failed request should be retried and how long to wait.
 */
export interface RetryPolicy {
  evaluate(ctx: RetryContext): RetryDecision;
}
