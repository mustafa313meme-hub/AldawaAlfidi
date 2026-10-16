import { agingBucket, dailyTarget, daysInclusive, percent, toCsv } from './reports-logic';

describe('percent', () => {
  it('computes with two decimals, half up', () => {
    expect(percent(12_345, 20_000)).toBe(61.73);
    expect(percent(1, 3)).toBe(33.33);
    expect(percent(2, 3)).toBe(66.67);
  });
  it('can exceed 100 and is 0 for no sales', () => {
    expect(percent(30_000, 20_000)).toBe(150);
    expect(percent(0, 20_000)).toBe(0);
  });
  it('is null when there is no target', () => {
    expect(percent(5, 0)).toBe(null);
    expect(percent(5, -1)).toBe(null);
  });
  it('treats negative achievement (returns > sales) as 0', () => {
    expect(percent(-500, 1_000)).toBe(0);
  });
});

describe('target helpers', () => {
  it('counts calendar days inclusively', () => {
    expect(daysInclusive('2026-10-01', '2026-10-31')).toBe(31);
    expect(daysInclusive('2026-10-05', '2026-10-05')).toBe(1);
  });
  it('daily target rounds up so the days cover the target', () => {
    expect(dailyTarget(3_100_000, '2026-10-01', '2026-10-31')).toBe(100_000);
    const d = dailyTarget(1_000_000, '2026-10-01', '2026-10-31');
    expect(d * 31 >= 1_000_000).toBe(true);
    expect(d).toBe(32_259);
  });
});

describe('agingBucket', () => {
  it('buckets by age in days', () => {
    expect([0, 30, 31, 60, 61, 90, 91, 400].map(agingBucket)).toEqual(['0-30', '0-30', '31-60', '31-60', '61-90', '61-90', '90+', '90+']);
  });
});

describe('toCsv', () => {
  const cols = [{ key: 'name', header: 'الاسم' }, { key: 'amount', header: 'المبلغ' }];
  it('starts with a BOM and uses CRLF', () => {
    const out = toCsv(cols, [{ name: 'صيدلية الأمل', amount: 1500 }]);
    expect(out.charCodeAt(0)).toBe(0xfeff);
    expect(out).toBe('\uFEFFالاسم,المبلغ\r\nصيدلية الأمل,1500\r\n');
  });
  it('quotes commas, quotes and newlines', () => {
    const out = toCsv(cols, [{ name: 'a,"b"\nc', amount: 1 }]);
    expect(out.includes('"a,""b""\nc",1')).toBe(true);
  });
  it('neutralises formula injection in text but keeps negative numbers', () => {
    const out = toCsv(cols, [{ name: '=HYPERLINK("x")', amount: -500 }, { name: '+1', amount: 2 }]);
    expect(out.includes(`"'=HYPERLINK(""x"")",-500`)).toBe(true);
    expect(out.includes("'+1,2")).toBe(true);
  });
  it('writes null as empty and dates as ISO', () => {
    const out = toCsv([{ key: 'a', header: 'a' }, { key: 'd', header: 'd' }], [{ a: null, d: new Date('2026-10-09T00:00:00Z') }]);
    expect(out.endsWith(',2026-10-09T00:00:00.000Z\r\n')).toBe(true);
  });
});
