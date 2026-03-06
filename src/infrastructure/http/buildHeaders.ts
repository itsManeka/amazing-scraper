import { AMAZON_BASE_URL } from './amazonConstants';

/**
 * Extracts the browser brand and major version from a User-Agent string
 * to generate coherent `sec-ch-ua` headers.
 */
function extractBrandHints(ua: string): { secChUa: string; platform: string } | null {
  const chromeMatch = ua.match(/Chrome\/([\d]+)/);
  const edgeMatch = ua.match(/Edg\/([\d]+)/);
  const firefoxMatch = ua.match(/Firefox\/([\d]+)/);

  if (edgeMatch) {
    const ver = edgeMatch[1];
    return {
      secChUa: `"Microsoft Edge";v="${ver}", "Chromium";v="${ver}", "Not_A Brand";v="24"`,
      platform: ua.includes('Macintosh') ? '"macOS"' : ua.includes('Linux') ? '"Linux"' : '"Windows"',
    };
  }

  if (chromeMatch && !firefoxMatch) {
    const ver = chromeMatch[1];
    return {
      secChUa: `"Chromium";v="${ver}", "Not_A Brand";v="24", "Google Chrome";v="${ver}"`,
      platform: ua.includes('Macintosh') ? '"macOS"' : ua.includes('Linux') ? '"Linux"' : '"Windows"',
    };
  }

  // Firefox and Safari don't send sec-ch-ua headers
  return null;
}

/**
 * Builds realistic GET headers for HTML page navigation.
 * `sec-ch-ua*` fields are derived from the UA to maintain fingerprint coherence.
 */
export function buildGetHeaders(ua: string, referer?: string): Record<string, string> {
  const headers: Record<string, string> = {
    'user-agent': ua,
    'accept-language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
    'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'accept-encoding': 'gzip, deflate, br',
    'cache-control': 'max-age=0',
    'upgrade-insecure-requests': '1',
  };

  const hints = extractBrandHints(ua);
  if (hints) {
    headers['sec-ch-ua'] = hints.secChUa;
    headers['sec-ch-ua-mobile'] = '?0';
    headers['sec-ch-ua-platform'] = hints.platform;
    headers['sec-fetch-dest'] = 'document';
    headers['sec-fetch-mode'] = 'navigate';
    headers['sec-fetch-site'] = 'same-origin';
    headers['sec-fetch-user'] = '?1';
  }

  if (referer) {
    headers['referer'] = referer;
  }

  return headers;
}

/**
 * Builds realistic POST headers for Amazon AJAX pagination calls.
 * Includes `x-requested-with`, `content-type`, and AJAX-specific `sec-fetch-*` values.
 */
export function buildPostHeaders(ua: string, referer: string): Record<string, string> {
  const headers: Record<string, string> = {
    'user-agent': ua,
    'accept-language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
    'accept': 'application/json, text/javascript, */*; q=0.01',
    'accept-encoding': 'gzip, deflate, br',
    'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
    'x-requested-with': 'XMLHttpRequest',
    'origin': AMAZON_BASE_URL,
    'referer': referer,
  };

  const hints = extractBrandHints(ua);
  if (hints) {
    headers['sec-ch-ua'] = hints.secChUa;
    headers['sec-ch-ua-mobile'] = '?0';
    headers['sec-ch-ua-platform'] = hints.platform;
    headers['sec-fetch-dest'] = 'empty';
    headers['sec-fetch-mode'] = 'cors';
    headers['sec-fetch-site'] = 'same-origin';
  }

  return headers;
}
