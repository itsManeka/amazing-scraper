/**
 * F21 smoke test — hits the real Amazon popover endpoint and exercises the
 * full FetchIndividualCouponTerms -> CheerioHtmlParser pipeline end-to-end.
 *
 * Run: npx ts-node scripts/f21-smoke-terms.ts
 */
import { AxiosHttpClient } from '../src/infrastructure/http/AxiosHttpClient';
import { RotatingUserAgentProvider } from '../src/infrastructure/http/RotatingUserAgentProvider';
import { CheerioHtmlParser } from '../src/infrastructure/parsers/CheerioHtmlParser';
import { ConsoleLogger } from '../src/infrastructure/logger/ConsoleLogger';
import { ExponentialBackoffRetry } from '../src/infrastructure/retry/ExponentialBackoffRetry';
import { FetchIndividualCouponTerms } from '../src/application/use-cases/FetchIndividualCouponTerms';

async function main() {
  const logger = new ConsoleLogger();
  // Keep the imports referenced even if unused directly here.
  void ExponentialBackoffRetry;
  const http = new AxiosHttpClient(logger);
  const parser = new CheerioHtmlParser();
  const uaProvider = new RotatingUserAgentProvider();
  const useCase = new FetchIndividualCouponTerms(http, parser, logger, uaProvider);

  const termsUrl = '/promotion/details/popup/ATVO4IBO0PTIE';
  const start = Date.now();
  const result = await useCase.execute(termsUrl);
  const elapsed = Date.now() - start;

  console.log('----- F21 SMOKE RESULT -----');
  console.log('termsUrl        :', termsUrl);
  console.log('elapsed (ms)    :', elapsed);
  console.log('result length   :', result?.length ?? 'null');
  console.log('first 200 chars :', result ? result.slice(0, 200) : 'null');
  console.log('contains <tag>? :', result ? /<[a-zA-Z/][^>]*>/.test(result) : 'n/a');
  console.log('contains \\u00a0?:', result ? result.includes('\u00a0') : 'n/a');

  // Also time the pure parser on a cached fixture (happy path)
  const fs = await import('fs');
  const path = await import('path');
  const rawFixture = fs.readFileSync(
    path.join(__dirname, '..', 'tests', 'fixtures', 'terms-popup-lampada-raw.html'),
    'utf-8',
  );
  const parserStart = Date.now();
  const iterations = 100;
  for (let i = 0; i < iterations; i++) {
    parser.extractIndividualCouponTerms(rawFixture);
  }
  const parserElapsed = Date.now() - parserStart;
  console.log('----- PARSER HAPPY PATH -----');
  console.log(`${iterations}x parser calls: ${parserElapsed} ms (avg ${(parserElapsed / iterations).toFixed(2)} ms/call)`);
}

main().catch((err) => {
  console.error('SMOKE FAILED:', err);
  process.exit(1);
});
