import { HttpClient } from '../ports/HttpClient';
import { Logger } from '../ports/Logger';

/**
 * Helper service for preventive session recycling.
 * Tracks HTTP requests and recycles the HTTP client session (resets cookies, etc.)
 * after a configured threshold of requests to prevent session degradation.
 *
 * Idempotent: calling maybeRecycle() without reaching the threshold is safe.
 * If afterRequests <= 0, recycler remains inert (legacy mode — no recycling).
 */
export class SessionRecycler {
  private requestCount: number = 0;

  constructor(
    private readonly httpClient: HttpClient,
    private readonly afterRequests: number,
    private readonly logger: Logger,
  ) {}

  /**
   * Records a successful HTTP request.
   * Internal counter is incremented; may trigger preventive recycling if threshold is reached.
   */
  recordRequest(): void {
    if (this.afterRequests <= 0) {
      return; // Legacy mode — no recycling
    }

    this.requestCount++;

    if (this.requestCount >= this.afterRequests) {
      this.maybeRecycle();
    }
  }

  /**
   * Triggers session recycling if the threshold is reached and httpClient supports resetSession.
   * Resets the internal counter after recycling.
   * Idempotent: safe to call without reaching the threshold.
   */
  maybeRecycle(): void {
    if (this.afterRequests <= 0) {
      return; // Legacy mode — no recycling
    }

    if (this.requestCount >= this.afterRequests) {
      if (typeof this.httpClient.resetSession === 'function') {
        this.httpClient.resetSession();
        this.logger.info('session_recycled_preventive', {
          requestsSinceReset: this.requestCount,
        });
      }

      this.requestCount = 0;
    }
  }

  /**
   * Resets the request counter (used after reactive recycling to avoid double-recycling).
   */
  resetCounter(): void {
    this.requestCount = 0;
  }
}
