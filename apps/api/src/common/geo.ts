const R = 6_371_000; // mean Earth radius, metres
const rad = (d: number) => (d * Math.PI) / 180;

export function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = rad(lat2 - lat1);
  const dLon = rad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Bounding box for a radius search (cheap pre-filter before exact haversine). */
export function bboxFor(lat: number, lon: number, radiusM: number) {
  const dLat = (radiusM / R) * (180 / Math.PI);
  const dLon = dLat / Math.max(Math.cos(rad(lat)), 0.01);
  return { minLat: lat - dLat, maxLat: lat + dLat, minLon: lon - dLon, maxLon: lon + dLon };
}
