import {
  RotatingUserAgentProvider,
  USER_AGENT_POOL,
} from '../../src/infrastructure/http/RotatingUserAgentProvider';

describe('RotatingUserAgentProvider', () => {
  it('returns a string from the pool', () => {
    const provider = new RotatingUserAgentProvider();
    const ua = provider.get();

    expect(USER_AGENT_POOL).toContain(ua);
  });

  it('rotates sequentially through the pool', () => {
    const provider = new RotatingUserAgentProvider();
    const seen: string[] = [];

    for (let i = 0; i < USER_AGENT_POOL.length; i++) {
      seen.push(provider.get());
    }

    const uniqueCount = new Set(seen).size;
    expect(uniqueCount).toBe(USER_AGENT_POOL.length);
  });

  it('wraps around after exhausting the pool', () => {
    const provider = new RotatingUserAgentProvider();
    const firstRound: string[] = [];

    for (let i = 0; i < USER_AGENT_POOL.length; i++) {
      firstRound.push(provider.get());
    }

    const secondRound: string[] = [];
    for (let i = 0; i < USER_AGENT_POOL.length; i++) {
      secondRound.push(provider.get());
    }

    expect(secondRound).toEqual(firstRound);
  });

  it('pool is not empty', () => {
    expect(USER_AGENT_POOL.length).toBeGreaterThanOrEqual(10);
  });

  it('all UAs look like real browser strings', () => {
    for (const ua of USER_AGENT_POOL) {
      expect(ua).toMatch(/Mozilla\/5\.0/);
    }
  });
});
