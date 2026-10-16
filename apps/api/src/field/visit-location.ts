import { haversineMeters } from '../common/geo';

export type LocationStatus = 'NotProvided' | 'Verified' | 'PoorAccuracy' | 'TooFar' | 'NoCustomerLocation';

export interface LocationInput {
  latitude?: number | null;
  longitude?: number | null;
  accuracyM?: number | null;
  customerLat?: number | null;
  customerLng?: number | null;
  maxAccuracyM: number;
  maxDistanceM: number;
}

/**
 * GPS is evidence, not proof (SRS §32): a poor or missing accuracy never counts as "verified",
 * and "too far" is only asserted when the reading itself is accurate enough to trust.
 */
export function evaluateVisitLocation(i: LocationInput): { status: LocationStatus; distanceM: number | null } {
  if (i.latitude == null || i.longitude == null) return { status: 'NotProvided', distanceM: null };
  if (i.customerLat == null || i.customerLng == null) return { status: 'NoCustomerLocation', distanceM: null };
  const distanceM = Math.round(haversineMeters(i.latitude, i.longitude, i.customerLat, i.customerLng));
  if (i.accuracyM == null || i.accuracyM > i.maxAccuracyM) return { status: 'PoorAccuracy', distanceM };
  return { status: distanceM > i.maxDistanceM ? 'TooFar' : 'Verified', distanceM };
}
