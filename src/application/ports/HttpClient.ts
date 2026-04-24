export interface HttpResponse {
  status: number;
  data: string;
}

/**
 * Optional per-request guards supported by {@link HttpClient.get}.
 *
 * - `allowedRedirectHosts`: when defined, the client MUST reject any redirect
 *   whose target hostname is not listed. This is a defense-in-depth control
 *   against SSRF via chained cross-host redirects. When the array is empty
 *   or omitted, no redirect hostname restriction is applied and the client
 *   follows redirects according to its default policy.
 */
export interface HttpGetOptions {
  allowedRedirectHosts?: string[];
}

/**
 * Port for HTTP operations.
 * Implementations must preserve cookies across requests within the same session.
 */
export interface HttpClient {
  /**
   * Performs a GET request.
   * @param url - Target URL
   * @param headers - Optional request headers
   * @param options - Optional per-request guards (see {@link HttpGetOptions})
   */
  get(
    url: string,
    headers?: Record<string, string>,
    options?: HttpGetOptions,
  ): Promise<HttpResponse>;

  /**
   * Performs a POST request.
   * @param url - Target URL
   * @param data - Key-value payload
   * @param options - `formEncoded: true` serializes as application/x-www-form-urlencoded
   * @param headers - Optional request headers
   */
  post(
    url: string,
    data: Record<string, unknown>,
    options: { formEncoded: boolean },
    headers?: Record<string, string>,
  ): Promise<HttpResponse>;

  /**
   * Resets the HTTP session by discarding all accumulated cookies and creating
   * a fresh session state. This operation is idempotent — calling it multiple times
   * in sequence has no side effects beyond the first call.
   *
   * This method is optional and may not be implemented by all HttpClient instances
   * (e.g., custom implementations provided by consumers). Call-sites that depend on
   * session recycling must check for method availability: `if (typeof client.resetSession === 'function')`
   *
   * @remarks
   * - Called by session recycling logic to mitigate progressive session degradation
   *   observed with repeated requests to Amazon (e.g., empty titles, missing price blocks).
   * - Default request headers and other client configuration persist after reset.
   * - Emits a log entry at INFO level with key `'HTTP session recycled'`.
   *
   * @example
   * ```typescript
   * const client = createHttpClient();
   * // ... perform requests ...
   * if (typeof client.resetSession === 'function') {
   *   client.resetSession(); // Start fresh session
   * }
   * ```
   */
  resetSession?(): void;
}
