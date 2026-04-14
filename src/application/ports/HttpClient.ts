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
}
