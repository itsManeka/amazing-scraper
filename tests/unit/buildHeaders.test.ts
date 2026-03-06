import { buildGetHeaders, buildPostHeaders } from '../../src/infrastructure/http/buildHeaders';

const CHROME_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const FIREFOX_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0';
const SAFARI_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Safari/605.1.15';
const EDGE_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0';
const CHROME_MAC_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const CHROME_LINUX_UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

describe('buildGetHeaders', () => {
  it('includes all required base fields', () => {
    const headers = buildGetHeaders(CHROME_UA);

    expect(headers['user-agent']).toBe(CHROME_UA);
    expect(headers['accept-language']).toContain('pt-BR');
    expect(headers['accept']).toContain('text/html');
    expect(headers['accept-encoding']).toContain('gzip');
    expect(headers['cache-control']).toBe('max-age=0');
    expect(headers['upgrade-insecure-requests']).toBe('1');
  });

  it('includes sec-ch-ua headers coherent with Chrome UA', () => {
    const headers = buildGetHeaders(CHROME_UA);

    expect(headers['sec-ch-ua']).toContain('"Chromium";v="131"');
    expect(headers['sec-ch-ua']).toContain('"Google Chrome";v="131"');
    expect(headers['sec-ch-ua-mobile']).toBe('?0');
    expect(headers['sec-ch-ua-platform']).toBe('"Windows"');
    expect(headers['sec-fetch-dest']).toBe('document');
    expect(headers['sec-fetch-mode']).toBe('navigate');
    expect(headers['sec-fetch-site']).toBe('same-origin');
    expect(headers['sec-fetch-user']).toBe('?1');
  });

  it('generates correct sec-ch-ua for Edge UA', () => {
    const headers = buildGetHeaders(EDGE_UA);

    expect(headers['sec-ch-ua']).toContain('"Microsoft Edge";v="131"');
    expect(headers['sec-ch-ua']).toContain('"Chromium";v="131"');
    expect(headers['sec-ch-ua-platform']).toBe('"Windows"');
  });

  it('detects macOS platform from UA', () => {
    const headers = buildGetHeaders(CHROME_MAC_UA);
    expect(headers['sec-ch-ua-platform']).toBe('"macOS"');
  });

  it('detects Linux platform from UA', () => {
    const headers = buildGetHeaders(CHROME_LINUX_UA);
    expect(headers['sec-ch-ua-platform']).toBe('"Linux"');
  });

  it('omits sec-ch-ua headers for Firefox UA', () => {
    const headers = buildGetHeaders(FIREFOX_UA);

    expect(headers['sec-ch-ua']).toBeUndefined();
    expect(headers['sec-ch-ua-mobile']).toBeUndefined();
    expect(headers['sec-ch-ua-platform']).toBeUndefined();
    expect(headers['sec-fetch-dest']).toBeUndefined();
  });

  it('omits sec-ch-ua headers for Safari UA', () => {
    const headers = buildGetHeaders(SAFARI_UA);

    expect(headers['sec-ch-ua']).toBeUndefined();
  });

  it('includes referer when provided', () => {
    const headers = buildGetHeaders(CHROME_UA, 'https://www.amazon.com.br/dp/B0TEST');
    expect(headers['referer']).toBe('https://www.amazon.com.br/dp/B0TEST');
  });

  it('omits referer when not provided', () => {
    const headers = buildGetHeaders(CHROME_UA);
    expect(headers['referer']).toBeUndefined();
  });
});

describe('buildPostHeaders', () => {
  const REFERER = 'https://www.amazon.com.br/promotion/psp/PROMO123';

  it('includes AJAX-specific fields', () => {
    const headers = buildPostHeaders(CHROME_UA, REFERER);

    expect(headers['x-requested-with']).toBe('XMLHttpRequest');
    expect(headers['content-type']).toBe('application/x-www-form-urlencoded; charset=UTF-8');
    expect(headers['origin']).toBe('https://www.amazon.com.br');
    expect(headers['referer']).toBe(REFERER);
  });

  it('uses AJAX-specific sec-fetch values for Chrome', () => {
    const headers = buildPostHeaders(CHROME_UA, REFERER);

    expect(headers['sec-fetch-dest']).toBe('empty');
    expect(headers['sec-fetch-mode']).toBe('cors');
    expect(headers['sec-fetch-site']).toBe('same-origin');
    expect(headers['sec-fetch-user']).toBeUndefined();
  });

  it('includes accept for JSON', () => {
    const headers = buildPostHeaders(CHROME_UA, REFERER);
    expect(headers['accept']).toContain('application/json');
  });

  it('omits sec-ch-ua for Firefox POST', () => {
    const headers = buildPostHeaders(FIREFOX_UA, REFERER);

    expect(headers['sec-ch-ua']).toBeUndefined();
    expect(headers['x-requested-with']).toBe('XMLHttpRequest');
  });
});
