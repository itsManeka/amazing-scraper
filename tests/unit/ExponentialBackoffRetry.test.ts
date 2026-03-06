import { ExponentialBackoffRetry } from '../../src/infrastructure/retry/ExponentialBackoffRetry';
import { RetryContext } from '../../src/application/ports/RetryPolicy';

describe('ExponentialBackoffRetry', () => {
  const policy = new ExponentialBackoffRetry(3, 2000, 30000);

  describe('errorType: session', () => {
    it('never retries regardless of attempt count', () => {
      const ctx: RetryContext = { attempt: 0, statusCode: 403, errorType: 'session' };
      const decision = policy.evaluate(ctx);

      expect(decision.shouldRetry).toBe(false);
      expect(decision.delayMs).toBe(0);
    });
  });

  describe('errorType: http', () => {
    it('retries on 403 with exponential delay', () => {
      const decision = policy.evaluate({ attempt: 0, statusCode: 403, errorType: 'http' });

      expect(decision.shouldRetry).toBe(true);
      expect(decision.delayMs).toBeGreaterThanOrEqual(2000);
      expect(decision.delayMs).toBeLessThanOrEqual(4000);
    });

    it('retries on 503 with exponential delay', () => {
      const decision = policy.evaluate({ attempt: 0, statusCode: 503, errorType: 'http' });

      expect(decision.shouldRetry).toBe(true);
      expect(decision.delayMs).toBeGreaterThanOrEqual(2000);
    });

    it('does not retry on 200', () => {
      const decision = policy.evaluate({ attempt: 0, statusCode: 200, errorType: 'http' });
      expect(decision.shouldRetry).toBe(false);
    });

    it('does not retry on 404', () => {
      const decision = policy.evaluate({ attempt: 0, statusCode: 404, errorType: 'http' });
      expect(decision.shouldRetry).toBe(false);
    });
  });

  describe('errorType: network', () => {
    it('retries on network error (statusCode 0)', () => {
      const decision = policy.evaluate({ attempt: 0, statusCode: 0, errorType: 'network' });

      expect(decision.shouldRetry).toBe(true);
      expect(decision.delayMs).toBeGreaterThanOrEqual(2000);
    });
  });

  describe('exponential growth', () => {
    it('delay grows with attempt number', () => {
      jest.spyOn(Math, 'random').mockReturnValue(0);

      const d0 = policy.evaluate({ attempt: 0, statusCode: 503, errorType: 'http' });
      const d1 = policy.evaluate({ attempt: 1, statusCode: 503, errorType: 'http' });
      const d2 = policy.evaluate({ attempt: 2, statusCode: 503, errorType: 'http' });

      expect(d0.delayMs).toBe(2000);
      expect(d1.delayMs).toBe(4000);
      expect(d2.delayMs).toBe(8000);

      jest.spyOn(Math, 'random').mockRestore();
    });
  });

  describe('maxDelayMs cap', () => {
    it('delay does not exceed maxDelayMs', () => {
      const shortCapPolicy = new ExponentialBackoffRetry(10, 2000, 5000);
      jest.spyOn(Math, 'random').mockReturnValue(0.99);

      const decision = shortCapPolicy.evaluate({ attempt: 5, statusCode: 503, errorType: 'http' });

      expect(decision.delayMs).toBeLessThanOrEqual(5000);

      jest.spyOn(Math, 'random').mockRestore();
    });
  });

  describe('maxRetries exhaustion', () => {
    it('stops retrying after maxRetries attempts', () => {
      const decision = policy.evaluate({ attempt: 3, statusCode: 503, errorType: 'http' });

      expect(decision.shouldRetry).toBe(false);
      expect(decision.delayMs).toBe(0);
    });

    it('retries on the last valid attempt', () => {
      const decision = policy.evaluate({ attempt: 2, statusCode: 503, errorType: 'http' });
      expect(decision.shouldRetry).toBe(true);
    });
  });

  describe('default constructor values', () => {
    it('uses defaults when no arguments provided', () => {
      const defaultPolicy = new ExponentialBackoffRetry();
      const decision = defaultPolicy.evaluate({ attempt: 0, statusCode: 503, errorType: 'http' });

      expect(decision.shouldRetry).toBe(true);
      expect(decision.delayMs).toBeGreaterThan(0);
    });
  });
});
