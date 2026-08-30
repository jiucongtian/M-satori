export interface StandardLocation {
  locationId: string;
  displayName: string;
  countryCode: string;
  administrativePath: string[];
  timezone: string;
  coordinates: { latitude: number; longitude: number };
}

export interface LocationProvider {
  search(query: string, limit: number): Promise<StandardLocation[]>;
  get(locationId: string): Promise<StandardLocation | null>;
}

export const LOCATION_PROVIDER = Symbol('LOCATION_PROVIDER');
