export type ScraperErrorCode =
  | 'csrf_not_found'
  | 'blocked'
  | 'session_expired'
  | 'no_coupon';

export interface ScraperErrorOptions {
  retryable?: boolean;
  suggestedCooldownMs?: number;
}

/**
 * Domain error thrown during the scraping pipeline.
 * `code` identifies the failure type; `context` carries optional diagnostic data.
 * `retryable` and `suggestedCooldownMs` help consumers decide whether and when to retry.
 */
export class ScraperError extends Error {
  public readonly retryable: boolean;
  public readonly suggestedCooldownMs?: number;

  constructor(
    public readonly code: ScraperErrorCode,
    public readonly context?: Record<string, unknown>,
    options?: ScraperErrorOptions,
  ) {
    super(code);
    this.name = 'ScraperError';
    this.retryable = options?.retryable ?? false;
    this.suggestedCooldownMs = options?.suggestedCooldownMs;
  }
}
