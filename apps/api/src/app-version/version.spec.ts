import { compareVersions, evaluateUpdate, isValidAppVersions, parseVersion } from './version';

describe('compareVersions', () => {
  it('compares numerically, not as text', () => {
    expect(compareVersions('1.10.0', '1.9.9')).toBe(1);
    expect(compareVersions('1.2.0', '1.2')).toBe(0);
    expect(compareVersions('0.9', '1.0.0')).toBe(-1);
    expect(compareVersions('2.0.0.1', '2.0.0')).toBe(1);
  });
  it('rejects non-numeric versions', () => {
    expect(() => compareVersions('1.2.0-beta', '1.2.0')).toThrow();
    expect(() => compareVersions('abc', '1.0')).toThrow();
    expect(parseVersion('1.2.3.4.5')).toBe(null);
  });
});

describe('evaluateUpdate', () => {
  const cfg = { latest: '1.5.0', minSupported: '1.2.0', url: 'https://example.com/app' };
  it('forces an update below the minimum supported version (SRS §107)', () => {
    const r = evaluateUpdate('1.1.9', cfg);
    expect(r.forceUpdate).toBe(true);
    expect(r.message).toBe('يرجى تحديث التطبيق للاستمرار');
  });
  it('offers an optional update between minimum and latest', () => {
    const r = evaluateUpdate('1.3.0', cfg);
    expect(r.forceUpdate).toBe(false);
    expect(r.updateAvailable).toBe(true);
    expect(r.message).toBe(null);
  });
  it('is quiet when current', () => {
    const r = evaluateUpdate('1.5.0', cfg);
    expect(r.updateAvailable).toBe(false);
    expect(r.forceUpdate).toBe(false);
  });
  it('is quiet when nothing is configured', () => {
    expect(evaluateUpdate('0.0.1', undefined).forceUpdate).toBe(false);
  });
});

describe('isValidAppVersions', () => {
  it('accepts a sensible config', () => {
    expect(isValidAppVersions({ android: { latest: '1.5.0', minSupported: '1.2.0', url: 'https://x' }, ios: { latest: '1.4' } })).toBe(true);
  });
  it('rejects unknown platforms, bad versions and min above latest', () => {
    expect(isValidAppVersions({ windows: {} })).toBe(false);
    expect(isValidAppVersions({ android: { latest: 'v1' } })).toBe(false);
    expect(isValidAppVersions({ android: { latest: '1.0.0', minSupported: '2.0.0' } })).toBe(false);
    expect(isValidAppVersions({ android: { other: 1 } })).toBe(false);
    expect(isValidAppVersions([])).toBe(false);
  });
});
