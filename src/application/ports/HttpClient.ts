export interface HttpResponse {
  status: number;
  data: string;
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
   */
  get(url: string, headers?: Record<string, string>): Promise<HttpResponse>;

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
