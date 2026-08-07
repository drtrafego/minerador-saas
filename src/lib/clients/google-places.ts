export type PlaceLead = {
  placeId: string;
  name: string;
  phone: string | null;
  email: string | null;
  website: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  rating: number | null;
  userRatingsTotal: number | null;
  types: string[];
  location: { lat: number; lng: number } | null;
  raw: Record<string, unknown>;
};
