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

  describe('terms-popup-lampada.html fixture (F21)', () => {
    let lampadaFragment: string;

    beforeAll(() => {
      lampadaFragment = fs.readFileSync(
        path.join(__dirname, '..', 'fixtures', 'terms-popup-lampada.html'),
        'utf-8',
      );
    });

    it('returns a non-empty string for the lampada popover fragment', () => {
      const result = parser.extractIndividualCouponTerms(lampadaFragment);
      expect(result).not.toBeNull();
      expect(typeof result).toBe('string');
      expect(result!.length).toBeGreaterThan(0);
    });

    it('does not contain any \\u00a0 (non-breaking space) in the output', () => {
      const result = parser.extractIndividualCouponTerms(lampadaFragment);
      expect(result).not.toBeNull();
      expect(result).not.toContain('\u00a0');
    });

    it('starts with the expected opening sentence "* Promoção válida exclusivamente"', () => {
      const result = parser.extractIndividualCouponTerms(lampadaFragment);
      expect(result).not.toBeNull();
      expect(result!.startsWith('* Promoção válida exclusivamente')).toBe(true);
    });
  });

  describe('terms-popup-lampada-raw.html fixture (F21 T1 re-opened — raw server response)', () => {
    let rawFragment: string;

    beforeAll(() => {
      rawFragment = fs.readFileSync(
        path.join(__dirname, '..', 'fixtures', 'terms-popup-lampada-raw.html'),
        'utf-8',
      );
    });

    it('extracts non-empty terms text from the raw popup response (script-inline fallback)', () => {
      const result = parser.extractIndividualCouponTerms(rawFragment);
      expect(result).not.toBeNull();
      expect(typeof result).toBe('string');
      expect(result!.length).toBeGreaterThan(100);
    });

    it('starts with "* Promoção válida exclusivamente" after script-inline extraction', () => {
      const result = parser.extractIndividualCouponTerms(rawFragment);
      expect(result).not.toBeNull();
      expect(result!.startsWith('* Promoção válida exclusivamente')).toBe(true);
    });

    it('contains "Válido até 30 de abril de 2026" from the script-inline JSON', () => {
      const result = parser.extractIndividualCouponTerms(rawFragment);
      expect(result).toContain('Válido até 30 de abril de 2026');
    });

    it('does not contain any residual HTML tags (<br>, <span>, etc.)', () => {
      const result = parser.extractIndividualCouponTerms(rawFragment);
      expect(result).not.toBeNull();
      expect(result).not.toMatch(/<[a-zA-Z/][^>]*>/);
    });

    it('does not contain \\u00a0 (non-breaking space) after normalisation', () => {
      const result = parser.extractIndividualCouponTerms(rawFragment);
      expect(result).not.toBeNull();
      expect(result).not.toContain('\u00a0');
    });
  });

  describe('renderTnC script fallback — edge cases (F21 ReDoS hardening)', () => {
    it('returns null when TNC_CONTENT is an empty string in the script JSON', () => {
      const html = `
        <html><body>
          <script>
            tncComponent.renderTnC({"tncSectionContentMap":{"TNC_CONTENT":""}})
          </script>
        </body></html>
      `;
      expect(parser.extractIndividualCouponTerms(html)).toBeNull();
    });

    it('returns null when the renderTnC JSON payload is malformed', () => {
      // Missing closing quote on the value -> JSON.parse throws, caught by try/catch.
      const html = `
        <html><body>
          <script>
            tncComponent.renderTnC({"tncSectionContentMap":{"TNC_CONTENT": "unterminated})
          </script>
        </body></html>
      `;
      expect(parser.extractIndividualCouponTerms(html)).toBeNull();
    });

    it('returns null when no script contains a tncComponent.renderTnC call', () => {
      const html = `
        <html><body>
          <script>console.log('no renderTnC here');</script>
          <script>var x = { foo: 1 };</script>
          <p>no terms anywhere</p>
        </body></html>
      `;
      expect(parser.extractIndividualCouponTerms(html)).toBeNull();
    });
  });
});
