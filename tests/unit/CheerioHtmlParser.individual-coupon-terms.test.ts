import * as fs from 'fs';
import * as path from 'path';
import { CheerioHtmlParser } from '../../src/infrastructure/parsers/CheerioHtmlParser';

describe('CheerioHtmlParser — extractIndividualCouponTerms', () => {
  let parser: CheerioHtmlParser;
  let fragment: string;

  beforeAll(() => {
    fragment = fs.readFileSync(
      path.join(__dirname, '..', 'fixtures', 'terms-popup-fragment.html'),
      'utf-8',
    );
  });

  beforeEach(() => {
    parser = new CheerioHtmlParser();
  });

  it('extracts non-empty terms text from the popover fragment', () => {
    const result = parser.extractIndividualCouponTerms(fragment);
    expect(result).not.toBeNull();
    expect(result!.length).toBeGreaterThan(100);
  });

  it('includes the expiration sentence "Válido até"', () => {
    const result = parser.extractIndividualCouponTerms(fragment);
    expect(result).toContain('Válido até 30 de abril de 2026');
  });

  it('normalises &nbsp; / \\u00a0 to regular spaces', () => {
    const result = parser.extractIndividualCouponTerms(fragment);
    expect(result).toContain('R$ 80');
    expect(result).toContain('R$ 20');
    expect(result).not.toContain('\u00a0');
  });

  it('matches the [id^="promo_tnc_content_"] prefix regardless of suffix', () => {
    const html = `
      <html><body>
        <span id="promo_tnc_content_XYZ123_ab" class="a-size-base">only rule.</span>
      </body></html>
    `;
    expect(parser.extractIndividualCouponTerms(html)).toBe('only rule.');
  });

  it('returns null when the selector is absent', () => {
    expect(parser.extractIndividualCouponTerms('<html><body><p>nothing</p></body></html>')).toBeNull();
  });

  it('returns null when the selector matches but contains only whitespace', () => {
    const html = '<span id="promo_tnc_content_XYZ_aa">   \u00a0  </span>';
    expect(parser.extractIndividualCouponTerms(html)).toBeNull();
  });

  it('returns null for an empty HTML string', () => {
    expect(parser.extractIndividualCouponTerms('')).toBeNull();
  });
});
