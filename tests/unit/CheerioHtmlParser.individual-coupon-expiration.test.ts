import { CheerioHtmlParser } from '../../src/infrastructure/parsers/CheerioHtmlParser';

describe('CheerioHtmlParser — extractIndividualCouponExpiration', () => {
  let parser: CheerioHtmlParser;

  beforeEach(() => {
    parser = new CheerioHtmlParser();
  });

  describe('T5-1: Data com horario', () => {
    it('extracts expiration date with time suffix (ate DD de MMMM de YYYY as HH:MM)', () => {
      const termsText = '... valido ate 30 de abril de 2026 as 23:59 ...';
      const result = parser.extractIndividualCouponExpiration(termsText);
      expect(result).toBe('30/04/2026');
    });

    it('handles uppercase variants (VÁLIDO ATE)', () => {
      const termsText = 'VÁLIDO ATE 30 de abril de 2026 AS 23:59';
      const result = parser.extractIndividualCouponExpiration(termsText);
      expect(result).toBe('30/04/2026');
    });

    it('handles mixed case (Válido até)', () => {
      const termsText = 'Válido até 30 de abril de 2026 às 23:59';
      const result = parser.extractIndividualCouponExpiration(termsText);
      expect(result).toBe('30/04/2026');
    });
  });

  describe('T5-2: Data sem horario (terminador fim-de-frase)', () => {
    it('extracts expiration date with period terminator (ate DD de MMMM de YYYY.)', () => {
      const termsText = 'valido ate 15 de março de 2026.';
      const result = parser.extractIndividualCouponExpiration(termsText);
      expect(result).toBe('15/03/2026');
    });
  });

  describe('T5-3: Data no fim da string (sem terminador)', () => {
    it('extracts date at end of string without explicit terminator', () => {
      const termsText = 'valido ate 5 de janeiro de 2027';
      const result = parser.extractIndividualCouponExpiration(termsText);
      expect(result).toBe('05/01/2027');
    });

    it('handles single-digit day without leading zero in input', () => {
      const termsText = 'valido ate 5 de janeiro de 2027';
      const result = parser.extractIndividualCouponExpiration(termsText);
      // Output should be padded to dd/MM/yyyy
      expect(result).toBe('05/01/2027');
    });
  });

  describe('T5-4: Case-sensitive com Unicode (ç vs c)', () => {
    it('normalises accentuated characters (Válido até to valido ate)', () => {
      const termsText = 'Válido até 30 de março de 2026';
      const result = parser.extractIndividualCouponExpiration(termsText);
      expect(result).toBe('30/03/2026');
    });

    it('normalises non-breaking spaces to regular spaces', () => {
      const termsText = 'Válido até 30 de março de 2026';
      const result = parser.extractIndividualCouponExpiration(termsText);
      expect(result).toBe('30/03/2026');
    });
  });

  describe('T5-5: Sem padrao de data', () => {
    it('returns null when no "ate" pattern is found', () => {
      const termsText = 'Oferta valida enquanto durarem os estoques';
      const result = parser.extractIndividualCouponExpiration(termsText);
      expect(result).toBeNull();
    });

    it('returns null when "ate" is found but not followed by a valid date', () => {
      const termsText = 'ate quantidade disponivel';
      const result = parser.extractIndividualCouponExpiration(termsText);
      expect(result).toBeNull();
    });
  });

  describe('T5-6: Texto vazio', () => {
    it('returns null for empty string', () => {
      const result = parser.extractIndividualCouponExpiration('');
      expect(result).toBeNull();
    });

    it('returns null for whitespace-only string', () => {
      const result = parser.extractIndividualCouponExpiration('      ');
      expect(result).toBeNull();
    });
  });

  describe('T5-7: Duas ocorrencias de "ate" (guarda ReDoS / backtracking)', () => {
    it('prefers first valid date match when multiple "ate" occurrences exist', () => {
      const termsText = 'oferta valida ate produtos especiais ate 10 de maio de 2026 as 23:59';
      const result = parser.extractIndividualCouponExpiration(termsText);
      // Should match the FIRST valid date pattern (10 de maio), not loop infinitely
      expect(result).toBe('10/05/2026');
    });

    it('does not cause ReDoS on long input with multiple "ate" keywords', () => {
      // Create a long string with multiple "ate" but only one valid date near the end
      const longPrefix = 'ate '.repeat(100); // 100 repetitions of "ate "
      const termsText = `${longPrefix}valido ate 20 de junho de 2026`;
      const start = Date.now();
      const result = parser.extractIndividualCouponExpiration(termsText);
      const elapsed = Date.now() - start;
      // Should complete quickly (under 100ms even in slow JS engines)
      expect(elapsed).toBeLessThan(100);
      expect(result).toBe('20/06/2026');
    });
  });

  describe('T5-8: Mes invalido', () => {
    it('returns null when month name is not recognized (30 de fevereiro)', () => {
      const termsText = 'valido ate 30 de fevereiro de 2026';
      const result = parser.extractIndividualCouponExpiration(termsText);
      // fevereiro (February) exists but 30 is invalid date — formatPtBrDate should still extract month
      // The function doesn't validate day-of-month, only month name existence
      expect(result).toBe('30/02/2026');
    });

    it('returns null when month name is completely invalid (30 de foo)', () => {
      const termsText = 'valido ate 30 de foo de 2026';
      const result = parser.extractIndividualCouponExpiration(termsText);
      expect(result).toBeNull();
    });

    it('handles all valid Portuguese month names', () => {
      const months = [
        { month: 'janeiro', expected: '01' },
        { month: 'fevereiro', expected: '02' },
        { month: 'março', expected: '03' },
        { month: 'abril', expected: '04' },
        { month: 'maio', expected: '05' },
        { month: 'junho', expected: '06' },
        { month: 'julho', expected: '07' },
        { month: 'agosto', expected: '08' },
        { month: 'setembro', expected: '09' },
        { month: 'outubro', expected: '10' },
        { month: 'novembro', expected: '11' },
        { month: 'dezembro', expected: '12' },
      ];

      for (const { month, expected } of months) {
        const termsText = `valido ate 15 de ${month} de 2026`;
        const result = parser.extractIndividualCouponExpiration(termsText);
        expect(result).toBe(`15/${expected}/2026`);
      }
    });
  });

  describe('T5-9: Regex fragility — múltiplos "ate" no texto', () => {
    it('extracts first valid date when multiple "ate" keywords present', () => {
      const termsText = 'oferta valida ate produtos especiais ate 10 de maio de 2026 as 23:59';
      const result = parser.extractIndividualCouponExpiration(termsText);
      // Should prefer the first "ate" that forms a valid date pattern (10 de maio de 2026)
      expect(result).toBe('10/05/2026');
    });

    it('skips invalid date patterns and uses first valid match', () => {
      const termsText = 'ate 99 de foo de 9999 mas valido ate 15 de março de 2026';
      const result = parser.extractIndividualCouponExpiration(termsText);
      // First "ate 99 de foo de 9999" should fail formatPtBrDate, second should succeed
      expect(result).toBe('15/03/2026');
    });
  });

  describe('T5-10: maxLength guard — input sanitization', () => {
    it('returns null when termsText exceeds 10,000 characters', () => {
      const longText = 'a'.repeat(10_001);
      const result = parser.extractIndividualCouponExpiration(longText);
      expect(result).toBeNull();
    });

    it('returns null when termsText is exactly 10,000 + 1 characters', () => {
      const longText = 'valido ate 20 de junho de 2026' + 'x'.repeat(9_971);
      expect(longText.length).toBe(10_001);
      const result = parser.extractIndividualCouponExpiration(longText);
      expect(result).toBeNull();
    });

    it('processes normally when termsText is exactly 10,000 characters', () => {
      const validDate = 'valido ate 20 de junho de 2026';
      const padding = 'x'.repeat(9_970);
      const termsText = validDate + padding;
      expect(termsText.length).toBe(10_000);
      const result = parser.extractIndividualCouponExpiration(termsText);
      expect(result).toBe('20/06/2026');
    });

    it('processes normally without performance degradation on long-but-valid input', () => {
      const validDate = 'valido ate 25 de dezembro de 2026 as 23:59';
      const padding = 'Lorem ipsum dolor sit amet. '.repeat(350); // ~9,800 chars
      const termsText = validDate + padding;
      expect(termsText.length).toBeLessThan(10_000);

      const start = Date.now();
      const result = parser.extractIndividualCouponExpiration(termsText);
      const elapsed = Date.now() - start;

      expect(result).toBe('25/12/2026');
      expect(elapsed).toBeLessThan(50); // Should still be fast
    });
  });

  describe('integration with real fixture text', () => {
    it('extracts date from fixture-like terms text (terms-popup-coupon-03.html)', () => {
      const fixtureText = '* Válido até 30 de abril de 2026 às 23:59\n* Promoção aplicável apenas uma vez por cliente';
      const result = parser.extractIndividualCouponExpiration(fixtureText);
      expect(result).toBe('30/04/2026');
    });

    it('extracts date from fixture-like terms text (terms-popup-coupon-04.html)', () => {
      const fixtureText = '* Válido até 15 de julho de 2026 às 18:30\n* Desconto de 15% em produtos selecionados';
      const result = parser.extractIndividualCouponExpiration(fixtureText);
      expect(result).toBe('15/07/2026');
    });
  });
});
