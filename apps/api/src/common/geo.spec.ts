import { bboxFor, haversineMeters } from './geo';

describe('geo', () => {
  it('is zero for identical points and symmetric', () => {
    expect(haversineMeters(33.3152, 44.3661, 33.3152, 44.3661)).toBe(0);
    expect(Math.round(haversineMeters(33.3, 44.4, 33.31, 44.41))).toBe(Math.round(haversineMeters(33.31, 44.41, 33.3, 44.4)));
  });
  it('matches a known distance (0.01 deg latitude ≈ 1112 m)', () => {
    const d = haversineMeters(33.0, 44.0, 33.01, 44.0);
    expect(d > 1100 && d < 1125).toBe(true);
  });
  it('bounding box contains points inside the radius', () => {
    const b = bboxFor(33.3152, 44.3661, 500);
    const inside = haversineMeters(33.3152, 44.3661, 33.3170, 44.3680) < 500;
    expect(inside).toBe(true);
    expect(33.3170 >= b.minLat && 33.3170 <= b.maxLat && 44.3680 >= b.minLon && 44.3680 <= b.maxLon).toBe(true);
  });
});
