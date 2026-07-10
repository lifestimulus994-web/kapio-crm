// Google Maps Places API (New) client — used to look up a real business and
// return its accurate, structured details (name, phone, website, address).
// Server-only: relies on GOOGLE_MAPS_API_KEY, which must never reach the browser.

export type PlaceResult = {
  official_name: string
  phone: string
  website: string
  address: string
  location: { lat: number; lng: number } | null
  place_id: string
  maps_url: string
}

export function placesEnabled(): boolean {
  return !!process.env.GOOGLE_MAPS_API_KEY
}

const empty: PlaceResult = {
  official_name: '',
  phone: '',
  website: '',
  address: '',
  location: null,
  place_id: '',
  maps_url: '',
}

// Find the single best-matching business for a (possibly misheard) name.
// Returns empty fields if the key is missing or nothing is found.
export async function searchCompanyOnPlaces(
  name: string,
  hint?: string
): Promise<PlaceResult> {
  const key = process.env.GOOGLE_MAPS_API_KEY
  if (!key || !name?.trim()) return empty

  const textQuery = [name.trim(), hint?.trim()].filter(Boolean).join(' ')

  try {
    const res = await fetch(
      'https://places.googleapis.com/v1/places:searchText',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': key,
          // Field mask controls which fields are returned (and billing SKU).
          'X-Goog-FieldMask': [
            'places.id',
            'places.displayName',
            'places.formattedAddress',
            'places.internationalPhoneNumber',
            'places.nationalPhoneNumber',
            'places.websiteUri',
            'places.location',
          ].join(','),
        },
        body: JSON.stringify({
          textQuery,
          languageCode: 'ka', // prefer Georgian names
          regionCode: 'GE', // bias toward Georgia
          maxResultCount: 1,
        }),
      }
    )

    if (!res.ok) return empty
    const data = (await res.json()) as {
      places?: {
        id?: string
        displayName?: { text?: string }
        formattedAddress?: string
        internationalPhoneNumber?: string
        nationalPhoneNumber?: string
        websiteUri?: string
        location?: { latitude?: number; longitude?: number }
      }[]
    }

    const p = data.places?.[0]
    if (!p) return empty

    const place_id = p.id ?? ''
    return {
      official_name: p.displayName?.text?.trim() ?? '',
      phone:
        (p.internationalPhoneNumber || p.nationalPhoneNumber || '').trim(),
      website: (p.websiteUri ?? '').trim(),
      address: (p.formattedAddress ?? '').trim(),
      location:
        p.location?.latitude != null && p.location?.longitude != null
          ? { lat: p.location.latitude, lng: p.location.longitude }
          : null,
      place_id,
      maps_url: place_id
        ? `https://www.google.com/maps/place/?q=place_id:${place_id}`
        : '',
    }
  } catch {
    return empty
  }
}
