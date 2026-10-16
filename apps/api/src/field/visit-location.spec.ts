import { evaluateVisitLocation } from './visit-location';

const base = { customerLat: 33.3152, customerLng: 44.3661, maxAccuracyM: 100, maxDistanceM: 300 };

describe('evaluateVisitLocation', () => {
  it('NotProvided without coordinates', () => {
    expect(evaluateVisitLocation({ ...base })).toEqual({ status: 'NotProvided', distanceM: null });
  });
  it('NoCustomerLocation when the customer has no coordinates', () => {
    const r = evaluateVisitLocation({ ...base, customerLat: null, customerLng: null, latitude: 33.3, longitude: 44.3, accuracyM: 10 });
    expect(r).toEqual({ status: 'NoCustomerLocation', distanceM: null });
  });
  it('Verified when close and accurate', () => {
    const r = evaluateVisitLocation({ ...base, latitude: 33.3153, longitude: 44.3662, accuracyM: 12 });
    expect(r.status).toBe('Verified');
  });
  it('TooFar when accurate but far away', () => {
    const r = evaluateVisitLocation({ ...base, latitude: 33.33, longitude: 44.38, accuracyM: 10 });
    expect(r.status).toBe('TooFar');
  });
  it('PoorAccuracy is never treated as proof, near or far', () => {
    expect(evaluateVisitLocation({ ...base, latitude: 33.3153, longitude: 44.3662, accuracyM: 500 }).status).toBe('PoorAccuracy');
    expect(evaluateVisitLocation({ ...base, latitude: 33.33, longitude: 44.38, accuracyM: 500 }).status).toBe('PoorAccuracy');
  });
  it('missing accuracy counts as PoorAccuracy', () => {
    expect(evaluateVisitLocation({ ...base, latitude: 33.3153, longitude: 44.3662 }).status).toBe('PoorAccuracy');
  });
});
