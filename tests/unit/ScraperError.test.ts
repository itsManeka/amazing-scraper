import { ScraperError } from '../../src/domain/errors';

describe('ScraperError', () => {
  describe('backward compatibility', () => {
    it('works with only code', () => {
      const err = new ScraperError('blocked');

      expect(err.code).toBe('blocked');
      expect(err.message).toBe('blocked');
      expect(err.name).toBe('ScraperError');
      expect(err.context).toBeUndefined();
      expect(err.retryable).toBe(false);
      expect(err.suggestedCooldownMs).toBeUndefined();
    });

    it('works with code and context', () => {
      const ctx = { url: 'https://example.com', status: 403 };
      const err = new ScraperError('blocked', ctx);

      expect(err.code).toBe('blocked');
      expect(err.context).toEqual(ctx);
      expect(err.retryable).toBe(false);
      expect(err.suggestedCooldownMs).toBeUndefined();
    });
  });

  describe('retryable and suggestedCooldownMs', () => {
    it('sets retryable to true when specified', () => {
      const err = new ScraperError('blocked', { reason: 'CAPTCHA' }, { retryable: true });

      expect(err.retryable).toBe(true);
      expect(err.suggestedCooldownMs).toBeUndefined();
    });

    it('sets suggestedCooldownMs when specified', () => {
      const err = new ScraperError(
        'blocked',
        { reason: 'CAPTCHA' },
        { retryable: true, suggestedCooldownMs: 120_000 },
      );

      expect(err.retryable).toBe(true);
      expect(err.suggestedCooldownMs).toBe(120_000);
    });

    it('defaults retryable to false when options is empty object', () => {
      const err = new ScraperError('blocked', undefined, {});

      expect(err.retryable).toBe(false);
      expect(err.suggestedCooldownMs).toBeUndefined();
    });

    it('sets retryable to false explicitly', () => {
      const err = new ScraperError('session_expired', { phase: 'pagination' }, { retryable: false });

      expect(err.retryable).toBe(false);
    });
  });

  describe('instanceof and error chain', () => {
    it('is an instance of Error', () => {
      const err = new ScraperError('blocked');
      expect(err).toBeInstanceOf(Error);
      expect(err).toBeInstanceOf(ScraperError);
    });
  });
});
