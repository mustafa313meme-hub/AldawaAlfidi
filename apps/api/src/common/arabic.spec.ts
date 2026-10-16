import { buildSearchText, normalizeSearch } from './arabic';

describe('normalizeSearch', () => {
  it('unifies alef / yeh / teh marbuta variants', () => {
    expect(normalizeSearch('أموكسيسيلين')).toBe(normalizeSearch('اموكسيسيلين'));
    expect(normalizeSearch('صيدلية')).toBe(normalizeSearch('صيدليه'));
    expect(normalizeSearch('مستشفى')).toBe(normalizeSearch('مستشفي'));
  });
  it('strips tashkeel and tatweel', () => {
    expect(normalizeSearch('دَوَاء')).toBe(normalizeSearch('دواء'));
    expect(normalizeSearch('دــواء')).toBe('دواء');
  });
  it('maps Arabic-Indic digits and lowercases', () => {
    expect(normalizeSearch('Panadol ٥٠٠ MG')).toBe('panadol 500 mg');
  });
  it('builds one searchable string from parts', () => {
    expect(buildSearchText('بنادول', null, 'Paracetamol', 'P-000001', undefined)).toBe('بنادول paracetamol p-000001');
  });
});
