// companyinfo.ge lookup — a public mirror of Georgia's business registry.
// Used only to find a company's identification/registration code
// (საიდენტიფიკაციო კოდი), which neither Google Places nor a general web
// search reliably returns. No API key: it's the same public endpoint the
// companyinfo.ge frontend itself calls (api.companyinfo.ge).

export type CompanyInfoGeResult = {
  identification_code: string
  legal_name: string
  address: string
}

const empty: CompanyInfoGeResult = {
  identification_code: '',
  legal_name: '',
  address: '',
}

export async function searchIdentificationCode(
  name: string
): Promise<CompanyInfoGeResult> {
  if (!name?.trim()) return empty

  try {
    const params = new URLSearchParams({
      name: name.trim(),
      idCode: '',
      address: '',
      email: '',
      legalForm: '',
      status: '',
      registered_after: '',
      registered_before: '',
    })
    const res = await fetch(
      `https://api.companyinfo.ge/api/corporations/search?${params.toString()}`,
      {
        headers: {
          accept: 'application/json, text/plain, */*',
          origin: 'https://companyinfo.ge',
          referer: 'https://companyinfo.ge/',
          'user-agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        },
      }
    )
    if (!res.ok) return empty

    const data = (await res.json()) as {
      items?: { idCode?: string; name?: string; address?: string }[]
    }
    const item = data.items?.[0]
    if (!item) return empty

    return {
      identification_code: (item.idCode ?? '').trim(),
      legal_name: (item.name ?? '').trim(),
      address: (item.address ?? '').trim(),
    }
  } catch {
    return empty
  }
}
