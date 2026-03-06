/**
 * Port for providing User-Agent strings.
 * Implementations may rotate, randomize, or return a fixed UA.
 */
export interface UserAgentProvider {
  /** Returns a User-Agent string. */
  get(): string;
}
