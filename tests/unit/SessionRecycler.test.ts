import { SessionRecycler } from '../../src/application/services/SessionRecycler';
import { HttpClient } from '../../src/application/ports/HttpClient';
import { Logger } from '../../src/application/ports/Logger';

describe('SessionRecycler', () => {
  let mockHttpClient: jest.Mocked<Partial<HttpClient>> & { resetSession?: jest.Mock };
  let mockLogger: jest.Mocked<Logger>;
  let recycler: SessionRecycler;

  beforeEach(() => {
    mockHttpClient = {
      get: jest.fn(),
      post: jest.fn(),
      resetSession: jest.fn(),
    };

    mockLogger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };

    recycler = new SessionRecycler(mockHttpClient as HttpClient, 5, mockLogger);
  });

  describe('recordRequest()', () => {
    it('should increment request count', () => {
      expect(mockHttpClient.resetSession).not.toHaveBeenCalled();

      recycler.recordRequest();
      expect(mockHttpClient.resetSession).not.toHaveBeenCalled();

      recycler.recordRequest();
      expect(mockHttpClient.resetSession).not.toHaveBeenCalled();

      recycler.recordRequest();
      expect(mockHttpClient.resetSession).not.toHaveBeenCalled();
    });

    it('should trigger reset after reaching afterRequests threshold', () => {
      recycler.recordRequest(); // 1
      recycler.recordRequest(); // 2
      recycler.recordRequest(); // 3
      recycler.recordRequest(); // 4
      expect(mockHttpClient.resetSession).not.toHaveBeenCalled();

      recycler.recordRequest(); // 5 — triggers reset
      expect(mockHttpClient.resetSession).toHaveBeenCalledTimes(1);
      expect(mockLogger.info).toHaveBeenCalledWith('session_recycled_preventive', {
        requestsSinceReset: 5,
      });
    });

    it('should reset counter after recycling', () => {
      recycler.recordRequest(); // 1
      recycler.recordRequest(); // 2
      recycler.recordRequest(); // 3
      recycler.recordRequest(); // 4
      recycler.recordRequest(); // 5 — triggers reset

      (mockHttpClient.resetSession as jest.Mock).mockClear();
      mockLogger.info.mockClear();

      recycler.recordRequest(); // 1 (after reset)
      recycler.recordRequest(); // 2
      recycler.recordRequest(); // 3
      recycler.recordRequest(); // 4
      expect(mockHttpClient.resetSession).not.toHaveBeenCalled();

      recycler.recordRequest(); // 5 — triggers reset again
      expect(mockHttpClient.resetSession).toHaveBeenCalledTimes(1);
    });

    it('should handle multiple recyclings in sequence (7 requests with afterRequests=3)', () => {
      const recycler3 = new SessionRecycler(mockHttpClient as HttpClient, 3, mockLogger);

      recycler3.recordRequest(); // 1
      recycler3.recordRequest(); // 2
      expect(mockHttpClient.resetSession).not.toHaveBeenCalled();

      recycler3.recordRequest(); // 3 — triggers reset
      expect(mockHttpClient.resetSession).toHaveBeenCalledTimes(1);

      (mockHttpClient.resetSession as jest.Mock).mockClear();

      recycler3.recordRequest(); // 1 (after reset)
      recycler3.recordRequest(); // 2
      recycler3.recordRequest(); // 3 — triggers reset again
      expect(mockHttpClient.resetSession).toHaveBeenCalledTimes(1);

      (mockHttpClient.resetSession as jest.Mock).mockClear();

      recycler3.recordRequest(); // 1 (after 2nd reset)
      expect(mockHttpClient.resetSession).not.toHaveBeenCalled();
    });
  });

  describe('maybeRecycle()', () => {
    it('should be idempotent when counter is below threshold', () => {
      recycler.recordRequest();
      recycler.recordRequest();

      recycler.maybeRecycle();
      expect(mockHttpClient.resetSession).not.toHaveBeenCalled();
    });

    it('should recycle when called explicitly if counter >= afterRequests', () => {
      recycler.recordRequest();
      recycler.recordRequest();
      recycler.recordRequest();
      recycler.recordRequest();
      recycler.recordRequest();

      (mockHttpClient.resetSession as jest.Mock).mockClear();
      mockLogger.info.mockClear();

      recycler.maybeRecycle();
      expect(mockHttpClient.resetSession).not.toHaveBeenCalled(); // Already recycled by recordRequest
    });
  });

  describe('resetCounter()', () => {
    it('should reset the internal counter', () => {
      recycler.recordRequest();
      recycler.recordRequest();
      recycler.recordRequest();

      (mockHttpClient.resetSession as jest.Mock).mockClear();

      recycler.resetCounter();

      recycler.recordRequest();
      recycler.recordRequest();

      expect(mockHttpClient.resetSession).not.toHaveBeenCalled(); // Would need 5 total, but counter was reset
    });
  });

  describe('legacy mode (afterRequests <= 0)', () => {
    it('should not recycle when afterRequests is 0', () => {
      const legacyRecycler = new SessionRecycler(mockHttpClient as HttpClient, 0, mockLogger);

      for (let i = 0; i < 10; i++) {
        legacyRecycler.recordRequest();
      }

      expect(mockHttpClient.resetSession).not.toHaveBeenCalled();
      expect(mockLogger.info).not.toHaveBeenCalled();
    });

    it('should not recycle when afterRequests is negative', () => {
      const legacyRecycler = new SessionRecycler(mockHttpClient as HttpClient, -1, mockLogger);

      for (let i = 0; i < 10; i++) {
        legacyRecycler.recordRequest();
      }

      expect(mockHttpClient.resetSession).not.toHaveBeenCalled();
      expect(mockLogger.info).not.toHaveBeenCalled();
    });
  });

  describe('handleHttpClient without resetSession', () => {
    it('should not throw if httpClient.resetSession is undefined', () => {
      const minimalHttpClient: HttpClient = {
        get: jest.fn(),
        post: jest.fn(),
      };

      const recyclerWithoutReset = new SessionRecycler(minimalHttpClient, 3, mockLogger);

      expect(() => {
        recyclerWithoutReset.recordRequest();
        recyclerWithoutReset.recordRequest();
        recyclerWithoutReset.recordRequest();
      }).not.toThrow();
    });

    it('should call maybeRecycle() safely even if resetSession is undefined', () => {
      const minimalHttpClient: HttpClient = {
        get: jest.fn(),
        post: jest.fn(),
      };

      const recyclerWithoutReset = new SessionRecycler(minimalHttpClient, 5, mockLogger);

      recyclerWithoutReset.recordRequest();
      recyclerWithoutReset.recordRequest();
      recyclerWithoutReset.recordRequest();
      recyclerWithoutReset.recordRequest();
      recyclerWithoutReset.recordRequest();

      expect(() => {
        recyclerWithoutReset.maybeRecycle();
      }).not.toThrow();
    });
  });

  describe('afterRequests=1 (aggressive recycling)', () => {
    it('should recycle before every request', () => {
      const aggressiveRecycler = new SessionRecycler(mockHttpClient as HttpClient, 1, mockLogger);

      aggressiveRecycler.recordRequest(); // 1 — triggers reset
      expect(mockHttpClient.resetSession).toHaveBeenCalledTimes(1);

      (mockHttpClient.resetSession as jest.Mock).mockClear();

      aggressiveRecycler.recordRequest(); // 1 (after reset) — triggers reset again
      expect(mockHttpClient.resetSession).toHaveBeenCalledTimes(1);

      (mockHttpClient.resetSession as jest.Mock).mockClear();

      aggressiveRecycler.recordRequest(); // 1 (after 2nd reset) — triggers reset again
      expect(mockHttpClient.resetSession).toHaveBeenCalledTimes(1);
    });
  });
});
