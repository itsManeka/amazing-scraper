export type ScraperErrorCode =
  | 'csrf_not_found'
  | 'blocked'
  | 'session_expired'
  | 'no_coupon';

/**
 * Domain error thrown during the scraping pipeline.
 * `code` identifies the failure type; `context` carries optional diagnostic data.
 */
export class ScraperError extends Error {
  constructor(
    public readonly code: ScraperErrorCode,
    public readonly context?: Record<string, unknown>,
  ) {
    super(code);
    this.name = 'ScraperError';
  }
}
