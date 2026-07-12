import { promises as fs } from 'node:fs'
import path from 'node:path'
import { revalidatePath } from 'next/cache'
import { GoogleGenAI, Type, type FunctionDeclaration } from '@google/genai'
import { supabase } from '@/lib/supabase'
import { searchCompanyOnPlaces } from '@/lib/places'
import { searchIdentificationCode } from '@/lib/companyinfo'

// ---------- knowledge base ----------
// Loads the editable business knowledge file (crm/knowledge.md) that teaches
// the assistant about this company. Returns '' if the file is missing.
export async function loadKnowledge(): Promise<string> {
  try {
    const file = path.join(process.cwd(), 'knowledge.md')
    const text = await fs.readFile(file, 'utf8')
    return text.trim()
  } catch {
    return ''
  }
}

// Shared CRM "AI brain": the data snapshot we give the model, the tool
// (function-calling) definitions, and the executor that performs the writes.
// Used by both the text chat route and the voice-import route. Every entry
// point takes an AiScope built from the caller's own member record — a plain
// 'member' can only read/write records assigned to them (mirroring the exact
// visibility rule enforced on every CRM page), while owner/manager see and
// touch everything in the workspace. workspaceId alone is never enough: it
// stops cross-tenant leaks but not cross-employee leaks within one tenant.
export type AiScope = {
  workspaceId: string
  memberId: string
  elevated: boolean
}

// ---------- CRM context snapshot ----------
export async function buildContext(scope: AiScope) {
  let orgQuery = supabase
    .from('organizations')
    .select('id, name, industry, email, phone')
    .eq('workspace_id', scope.workspaceId)
    .eq('archived', false)
  let contactQuery = supabase
    .from('contacts')
    .select('id, first_name, last_name, job_title, email, phone, organization_id')
    .eq('workspace_id', scope.workspaceId)
    .eq('archived', false)
  let oppQuery = supabase
    .from('opportunities')
    .select('id, title, value_gel, stage, organization_id, contact_id')
    .eq('workspace_id', scope.workspaceId)
    .eq('archived', false)
  let taskQuery = supabase
    .from('tasks')
    .select(
      'id, title, status, priority, owner, start_date, due_date, start_at, end_at, organization_id, contact_id, opportunity_id'
    )
    .eq('workspace_id', scope.workspaceId)
    .eq('archived', false)

  if (!scope.elevated) {
    orgQuery = orgQuery.eq('assigned_to', scope.memberId)
    contactQuery = contactQuery.eq('assigned_to', scope.memberId)
    oppQuery = oppQuery.eq('assigned_to', scope.memberId)
    taskQuery = taskQuery.eq('assigned_to', scope.memberId)
  }

  const [orgs, contacts, opps, tasks] = await Promise.all([
    orgQuery,
    contactQuery,
    oppQuery,
    taskQuery,
  ])
  return JSON.stringify({
    organizations: orgs.data ?? [],
    contacts: contacts.data ?? [],
    opportunities: opps.data ?? [],
    tasks: tasks.data ?? [],
  })
}

// ---------- web enrichment (Google Maps Places + Google Search grounding) ----------
// Looks up a company's PUBLIC details. Google Maps Places provides the accurate,
// STRUCTURED name/phone/website/address (and corrects a misheard/split name by
// matching a real business); Gemini grounded in Google Search then fills the
// email (Places never returns email) plus anything Places missed. Never searches
// for secrets (passwords, etc.) — only publicly listed details.
type CompanyInfo = {
  official_name: string
  email: string
  phone: string
  website: string
  address: string
  identification_code: string
  sources: string[]
}

export async function findCompanyContacts(
  name: string,
  hint?: string
): Promise<CompanyInfo> {
  if (!name?.trim()) {
    return {
      official_name: '',
      email: '',
      phone: '',
      website: '',
      address: '',
      identification_code: '',
      sources: [],
    }
  }

  // 1. Google Maps Places — authoritative name/phone/website/address (no email).
  const place = await searchCompanyOnPlaces(name, hint)

  // 2. Gemini + Google Search — email and any gaps Places left, plus
  //    companyinfo.ge — Georgia's business registry mirror, the only reliable
  //    source for the identification/registration code (საიდენტიფიკაციო
  //    კოდი), which neither Places nor a general web search returns. Both
  //    seeded with the corrected Places name (if any) so they look up the
  //    right company.
  const [gem, registry] = await Promise.all([
    groundCompanyWithGemini(place.official_name || name, hint),
    searchIdentificationCode(place.official_name || name),
  ])

  const sources = Array.from(
    new Set([place.maps_url, ...gem.sources].filter(Boolean))
  ).slice(0, 4)

  return {
    official_name: place.official_name || gem.official_name || '',
    email: gem.email || '', // Places never returns email
    phone: place.phone || gem.phone || '',
    website: place.website || gem.website || '',
    address: place.address || gem.address || registry.address || '',
    identification_code: registry.identification_code || '',
    sources,
  }
}

// Gemini grounded in Google Search — best-effort public fields for a company.
async function groundCompanyWithGemini(
  name: string,
  hint?: string
): Promise<CompanyInfo> {
  const empty: CompanyInfo = {
    official_name: '',
    email: '',
    phone: '',
    website: '',
    address: '',
    identification_code: '',
    sources: [],
  }
  if (!name?.trim() || !process.env.GEMINI_API_KEY) return empty

  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })
  const prompt = `Identify this company and find its OFFICIAL, PUBLICLY-LISTED details.
The name may be MISHEARD or misspelled (it often comes from voice transcription),
possibly split into pieces. Figure out the real company it refers to.
Heard name: "${name}"${hint ? `\nExtra context: ${hint}` : ''}

Look at the company's official website / contact page / business listings.
Return ONLY a JSON object, no prose, in this exact shape:
{"official_name": "", "email": "", "phone": "", "website": "", "address": ""}
- "official_name": the correct, properly-spelled company name (fix the misheard
  name; keep a multi-word name as ONE name, do not split it).
- "website": the official homepage URL if found.
- "email": a general/public contact email (info@, contact@, sales@).
- "phone": the public business phone number, with country code if shown.
- "address": the public business address / location (city and street if listed).
Use an empty string for any field you cannot confidently find from public sources.
Do NOT guess or fabricate. Never return passwords or private credentials.`

  // Retry on transient 503 overloads (otherwise a temporary spike silently
  // looks like "nothing found").
  const isOverloaded = (e: unknown) =>
    /503|UNAVAILABLE|overloaded|high demand/i.test(
      e instanceof Error ? e.message : String(e)
    )
  async function ground() {
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        return await ai.models.generateContent({
          model: 'gemini-2.5-flash',
          contents: prompt,
          // Google Search grounding. (Cannot be combined with
          // functionDeclarations, which is why this is a standalone call.)
          config: { tools: [{ googleSearch: {} }] },
        })
      } catch (e) {
        if (!isOverloaded(e) || attempt === 3) throw e
        await new Promise((r) => setTimeout(r, 600 * 2 ** attempt))
      }
    }
    throw new Error('unreachable')
  }

  try {
    const res = await ground()

    const text = res.text ?? ''
    const match = text.match(/\{[\s\S]*\}/)
    let parsed: {
      official_name?: string
      email?: string
      phone?: string
      website?: string
      address?: string
    } = {}
    if (match) {
      try {
        parsed = JSON.parse(match[0])
      } catch {
        parsed = {}
      }
    }

    // Real source URLs Google Search used for grounding.
    const chunks =
      (
        res.candidates?.[0]?.groundingMetadata as
          | { groundingChunks?: { web?: { uri?: string } }[] }
          | undefined
      )?.groundingChunks ?? []
    const sources = Array.from(
      new Set(
        chunks
          .map((c) => c.web?.uri)
          .filter((u): u is string => typeof u === 'string')
      )
    ).slice(0, 3)

    return {
      official_name: (parsed.official_name ?? '').trim(),
      email: (parsed.email ?? '').trim(),
      phone: (parsed.phone ?? '').trim(),
      website: (parsed.website ?? '').trim(),
      address: (parsed.address ?? '').trim(),
      identification_code: '',
      sources,
    }
  } catch {
    return empty
  }
}

// ---------- helpers to resolve names -> ids (so we reuse existing records) ----------
// All scoped to the caller's workspace_id (and, for a plain member, to their
// own assigned_to) — a name/title match can never resolve to another
// tenant's row, nor to a teammate's row the caller isn't allowed to see.
async function resolveOrgId(scope: AiScope, name?: string): Promise<string | null> {
  if (!name) return null
  let q = supabase.from('organizations').select('id, name').eq('workspace_id', scope.workspaceId)
  if (!scope.elevated) q = q.eq('assigned_to', scope.memberId)
  const { data } = await q
  const target = name.toLowerCase().trim()
  const list = data ?? []
  // Exact match first; then a loose contains-match either way, so a misheard or
  // partial name (common with voice input) still resolves to the record.
  const exact = list.find((o) => o.name?.toLowerCase().trim() === target)
  if (exact) return exact.id
  const partial = list.find((o) => {
    const n = o.name?.toLowerCase().trim() ?? ''
    return n.length > 0 && (n.includes(target) || target.includes(n))
  })
  return partial?.id ?? null
}

async function resolveContactId(scope: AiScope, name?: string): Promise<string | null> {
  if (!name) return null
  let q = supabase.from('contacts').select('id, first_name, last_name').eq('workspace_id', scope.workspaceId)
  if (!scope.elevated) q = q.eq('assigned_to', scope.memberId)
  const { data } = await q
  const target = name.toLowerCase().trim()
  const hit = (data ?? []).find((c) => {
    const full = `${c.first_name ?? ''} ${c.last_name ?? ''}`
      .toLowerCase()
      .trim()
    return full === target || (c.first_name ?? '').toLowerCase() === target
  })
  return hit?.id ?? null
}

async function resolveOpportunityId(scope: AiScope, title?: string): Promise<string | null> {
  if (!title) return null
  let q = supabase.from('opportunities').select('id, title').eq('workspace_id', scope.workspaceId)
  if (!scope.elevated) q = q.eq('assigned_to', scope.memberId)
  const { data } = await q
  const target = title.toLowerCase().trim()
  const hit =
    (data ?? []).find((o) => o.title?.toLowerCase().trim() === target) ??
    (data ?? []).find((o) => o.title?.toLowerCase().includes(target))
  return hit?.id ?? null
}

// Exact-name lookup used to dedup creates (a retried request shouldn't insert
// a second record for the same company/person/deal/task). Scoped the same
// way as resolve* — a duplicate hiding in a teammate's private records is
// invisible to this check, so at worst a second record is created rather
// than leaking the teammate's data; that tradeoff is the correct one.
async function findExactOrgId(scope: AiScope, name: string): Promise<string | null> {
  let q = supabase
    .from('organizations')
    .select('id, name')
    .eq('workspace_id', scope.workspaceId)
    .ilike('name', name)
  if (!scope.elevated) q = q.eq('assigned_to', scope.memberId)
  const { data } = await q.limit(1).maybeSingle()
  return data?.id ?? null
}
async function findExactContactId(
  scope: AiScope,
  firstName: string,
  lastName: string
): Promise<string | null> {
  let q = supabase
    .from('contacts')
    .select('id, first_name, last_name')
    .eq('workspace_id', scope.workspaceId)
    .ilike('first_name', firstName)
    .ilike('last_name', lastName || '')
  if (!scope.elevated) q = q.eq('assigned_to', scope.memberId)
  const { data } = await q.limit(1).maybeSingle()
  return data?.id ?? null
}
async function findExactOpportunityId(scope: AiScope, title: string): Promise<string | null> {
  let q = supabase
    .from('opportunities')
    .select('id, title')
    .eq('workspace_id', scope.workspaceId)
    .ilike('title', title)
  if (!scope.elevated) q = q.eq('assigned_to', scope.memberId)
  const { data } = await q.limit(1).maybeSingle()
  return data?.id ?? null
}
async function findExactTaskId(scope: AiScope, title: string): Promise<string | null> {
  let q = supabase
    .from('tasks')
    .select('id, title')
    .eq('workspace_id', scope.workspaceId)
    .ilike('title', title)
  if (!scope.elevated) q = q.eq('assigned_to', scope.memberId)
  const { data } = await q.limit(1).maybeSingle()
  return data?.id ?? null
}

async function resolveTaskId(scope: AiScope, title?: string): Promise<string | null> {
  if (!title) return null
  let q = supabase.from('tasks').select('id, title').eq('workspace_id', scope.workspaceId)
  if (!scope.elevated) q = q.eq('assigned_to', scope.memberId)
  const { data } = await q
  const target = title.toLowerCase().trim()
  const hit =
    (data ?? []).find((t) => t.title?.toLowerCase().trim() === target) ??
    (data ?? []).find((t) => t.title?.toLowerCase().includes(target))
  return hit?.id ?? null
}

const STAGES = [
  'New Lead',
  'Contacted',
  'Needs Identified',
  'Proposal Sent',
  'Negotiation',
  'Won',
  'Lost',
]

// Tools that permanently change what's visible (archive) or that create real
// login credentials — require an explicit user confirmation before running,
// never fired straight off a model's tool call. Single source of truth so the
// chat route and any future caller agree on what counts as destructive.
export const DESTRUCTIVE_TOOLS = new Set([
  'archive_organization',
  'archive_contact',
  'archive_opportunity',
  'archive_task',
])

// ---------- tool definitions ----------
export const tools: FunctionDeclaration[] = [
  {
    name: 'create_organization',
    description:
      'Create a new organization/company in the CRM. Use when a company is mentioned that does not already exist.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        name: { type: Type.STRING, description: 'Company display name (required)' },
        legal_name: { type: Type.STRING },
        identification_code: {
          type: Type.STRING,
          description: 'Tax / registration ID',
        },
        email: { type: Type.STRING },
        phone: { type: Type.STRING },
        website: { type: Type.STRING },
        address: { type: Type.STRING },
        industry: { type: Type.STRING },
        notes: { type: Type.STRING },
      },
      required: ['name'],
    },
  },
  {
    name: 'update_organization',
    description:
      "Update an EXISTING organization/company, found by its current name. Use to FIX a wrong or misheard company name (set new_name) or to change email, phone, website, address, industry, notes, legal_name, or tax id (identification_code). Pass only the fields you want to change. To correct a misheard name AND refill the details, FIRST call find_company_contacts with the corrected name, then call update_organization with new_name plus the found email/phone/website/address/identification_code.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        organization_name: {
          type: Type.STRING,
          description:
            'Current name of the company to update (required — used to find it).',
        },
        new_name: {
          type: Type.STRING,
          description: 'Corrected company display name.',
        },
        legal_name: { type: Type.STRING },
        identification_code: {
          type: Type.STRING,
          description: 'Tax / registration ID',
        },
        email: { type: Type.STRING },
        phone: { type: Type.STRING },
        website: { type: Type.STRING },
        address: { type: Type.STRING },
        industry: { type: Type.STRING },
        notes: { type: Type.STRING },
      },
      required: ['organization_name'],
    },
  },
  {
    name: 'find_company_contacts',
    description:
      "Search the public web (Google) AND Georgia's official business registry (companyinfo.ge) for a company's details — corrected official name, email, phone, website, address/location, and identification_code (საიდენტიფიკაციო კოდი — the Georgian tax/registration ID). Also fixes a misheard or misspelled name (useful for voice input). ALWAYS call this BEFORE create_organization when adding a Georgian company, so the record uses the correct name, identification code, and is pre-filled. identification_code comes straight from the official registry and can be trusted; the rest is web-sourced and should be flagged as unverified.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        name: {
          type: Type.STRING,
          description:
            'Company name as heard/given (may be misspelled or split — that is fine).',
        },
        hint: {
          type: Type.STRING,
          description:
            'Optional extra context (city, country, industry) to disambiguate the company.',
        },
      },
      required: ['name'],
    },
  },
  {
    name: 'create_contact',
    description:
      'Create a new contact (person) in the CRM. Optionally link to a company by its name.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        first_name: { type: Type.STRING, description: 'First name (required)' },
        last_name: { type: Type.STRING },
        job_title: { type: Type.STRING },
        email: { type: Type.STRING },
        phone: { type: Type.STRING },
        notes: { type: Type.STRING },
        organization_name: {
          type: Type.STRING,
          description:
            'Name of an existing company to link this contact to (optional).',
        },
      },
      required: ['first_name'],
    },
  },
  {
    name: 'update_contact',
    description:
      'Update an EXISTING contact (person), found by their first and last name. Fix a misheard name (set new_first_name/new_last_name), or change job_title/email/phone/notes, or re-link them to a different company. Pass only the fields you want to change.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        first_name: {
          type: Type.STRING,
          description: 'Current first name of the contact to update (required — used to find them).',
        },
        last_name: {
          type: Type.STRING,
          description: 'Current last name of the contact, if known (helps disambiguate).',
        },
        new_first_name: { type: Type.STRING },
        new_last_name: { type: Type.STRING },
        job_title: { type: Type.STRING },
        email: { type: Type.STRING },
        phone: { type: Type.STRING },
        notes: { type: Type.STRING },
        organization_name: {
          type: Type.STRING,
          description: 'Name of an existing company to LINK this contact to.',
        },
      },
      required: ['first_name'],
    },
  },
  {
    name: 'get_record',
    description:
      "Fetch the FULL details of one organization, contact, opportunity, or task — including fields not present in the live CRM data snapshot above (e.g. an organization's address/notes/legal name, an opportunity's pain_points/next_action/notes, a task's description, or its comments/activity log). Call this whenever a question needs a field that isn't in the snapshot, INSTEAD OF saying you don't have the information.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        entity: {
          type: Type.STRING,
          description: "One of: 'organization', 'contact', 'opportunity', 'task'.",
        },
        name_or_id: {
          type: Type.STRING,
          description: 'The name/title (or id) of the record to fetch.',
        },
      },
      required: ['entity', 'name_or_id'],
    },
  },
  {
    name: 'archive_organization',
    description:
      'Archive (soft-delete) a company, found by its name. Archived records are hidden from view but not permanently destroyed. Use when the user asks to delete/remove a company.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        organization_name: { type: Type.STRING, description: 'Name of the company to archive (required).' },
      },
      required: ['organization_name'],
    },
  },
  {
    name: 'archive_contact',
    description:
      'Archive (soft-delete) a contact, found by their name. Archived records are hidden from view but not permanently destroyed. Use when the user asks to delete/remove a contact.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        contact_name: { type: Type.STRING, description: 'Full name of the contact to archive (required).' },
      },
      required: ['contact_name'],
    },
  },
  {
    name: 'archive_opportunity',
    description:
      'Archive (soft-delete) a deal, found by its title. Archived records are hidden from view but not permanently destroyed. Use when the user asks to delete/remove/cancel a deal.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        opportunity_title: { type: Type.STRING, description: 'Title of the deal to archive (required).' },
      },
      required: ['opportunity_title'],
    },
  },
  {
    name: 'archive_task',
    description:
      'Archive (soft-delete) a task, found by its title. Archived records are hidden from view but not permanently destroyed. Use when the user asks to delete/remove/cancel a task.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        task_title: { type: Type.STRING, description: 'Title of the task to archive (required).' },
      },
      required: ['task_title'],
    },
  },
  {
    name: 'create_opportunity',
    description:
      'Create a new sales opportunity (deal) in the pipeline. Optionally link to a company and a contact by name.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        title: {
          type: Type.STRING,
          description: 'Short title of the deal (required), e.g. "Website redesign".',
        },
        value_gel: {
          type: Type.NUMBER,
          description: 'Estimated deal value in Georgian Lari (GEL).',
        },
        stage: {
          type: Type.STRING,
          description: `Pipeline stage, one of: ${STAGES.join(', ')}. Defaults to 'New Lead'.`,
        },
        pain_points: {
          type: Type.STRING,
          description: 'Problems / needs the client wants to solve.',
        },
        next_action: { type: Type.STRING },
        notes: { type: Type.STRING },
        organization_name: { type: Type.STRING },
        contact_name: { type: Type.STRING },
      },
      required: ['title'],
    },
  },
  {
    name: 'create_task',
    description:
      'Create a new task, follow-up, meeting, call, or reminder. If the user states any day or clock time, you MUST pass start_at (a local ISO datetime with NO timezone suffix) plus duration_minutes so it lands on the weekly calendar. Optionally link it to a company, contact, or opportunity by name.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        title: { type: Type.STRING, description: 'Task title (required)' },
        description: { type: Type.STRING },
        start_date: {
          type: Type.STRING,
          description: 'Start date in YYYY-MM-DD format (optional).',
        },
        due_date: {
          type: Type.STRING,
          description: 'End / due date in YYYY-MM-DD format (optional).',
        },
        start_at: {
          type: Type.STRING,
          description:
            'Precise start time as ISO 8601 (e.g. 2026-06-23T14:00:00) to place the task on the weekly calendar at a specific time. Use this instead of start_date when the user gives a time.',
        },
        end_at: {
          type: Type.STRING,
          description: 'Precise end time as ISO 8601. Optional if duration_minutes is given.',
        },
        duration_minutes: {
          type: Type.NUMBER,
          description:
            'How long the task lasts, in minutes. Combined with start_at to compute the end time when end_at is omitted (e.g. 30, 60).',
        },
        priority: {
          type: Type.STRING,
          description:
            "One of: 'Low', 'Medium', 'High', 'Urgent'. Defaults to 'Medium'.",
        },
        owner: {
          type: Type.STRING,
          description: 'Person responsible for the task (optional).',
        },
        status: {
          type: Type.STRING,
          description: "One of: 'todo', 'in_progress', 'done'. Defaults to 'todo'.",
        },
        organization_name: { type: Type.STRING },
        contact_name: { type: Type.STRING },
        opportunity_title: { type: Type.STRING },
      },
      required: ['title'],
    },
  },
  {
    name: 'update_opportunity',
    description:
      "Update an existing opportunity (deal), found by its title. Move it to a new pipeline stage, change value/next action/notes, or LINK it to a company or contact by name. Pass only the fields you want to change.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        opportunity_title: {
          type: Type.STRING,
          description: 'Title of the existing deal to update (required).',
        },
        stage: {
          type: Type.STRING,
          description: `New pipeline stage, one of: ${STAGES.join(', ')}.`,
        },
        value_gel: { type: Type.NUMBER, description: 'New deal value in GEL.' },
        next_action: { type: Type.STRING },
        notes: { type: Type.STRING },
        lost_reason: {
          type: Type.STRING,
          description:
            "Why the deal was lost — required when stage is set to 'Lost'. One of: Price too high, Competitor, No budget, No response, Timing, Not qualified, Other.",
        },
        organization_name: {
          type: Type.STRING,
          description: 'Name of an existing company to LINK this deal to.',
        },
        contact_name: {
          type: Type.STRING,
          description: 'Name of an existing contact to LINK this deal to.',
        },
      },
      required: ['opportunity_title'],
    },
  },
  {
    name: 'update_task',
    description:
      "Update an existing task, found by its title. Use to mark it done/in progress, change priority/owner/dates/description, or to LINK it to a company, contact, or opportunity by name. Pass only the fields you want to change.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        task_title: {
          type: Type.STRING,
          description: 'Title of the existing task to update (required).',
        },
        status: {
          type: Type.STRING,
          description: "One of: 'todo', 'in_progress', 'done'.",
        },
        priority: {
          type: Type.STRING,
          description: "One of: 'Low', 'Medium', 'High', 'Urgent'.",
        },
        owner: { type: Type.STRING },
        description: { type: Type.STRING },
        start_date: {
          type: Type.STRING,
          description: 'Start date in YYYY-MM-DD format.',
        },
        due_date: {
          type: Type.STRING,
          description: 'End / due date in YYYY-MM-DD format.',
        },
        start_at: {
          type: Type.STRING,
          description:
            'Precise start time as ISO 8601 (e.g. 2026-06-23T14:00:00) to (re)schedule the task at a specific time on the weekly calendar.',
        },
        end_at: {
          type: Type.STRING,
          description: 'Precise end time as ISO 8601. Optional if duration_minutes is given.',
        },
        duration_minutes: {
          type: Type.NUMBER,
          description:
            'New duration in minutes; combined with start_at to recompute the end time when end_at is omitted.',
        },
        organization_name: {
          type: Type.STRING,
          description: 'Name of an existing company to LINK this task to.',
        },
        contact_name: {
          type: Type.STRING,
          description: 'Name of an existing contact to LINK this task to.',
        },
        opportunity_title: {
          type: Type.STRING,
          description: 'Title of an existing opportunity to LINK this task to.',
        },
      },
      required: ['task_title'],
    },
  },
  {
    name: 'add_task_comment',
    description:
      'Add a comment to an existing task, found by its title. The comment is timestamped automatically.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        task_title: {
          type: Type.STRING,
          description: 'Title of the task to comment on (required).',
        },
        body: { type: Type.STRING, description: 'The comment text (required).' },
        author: {
          type: Type.STRING,
          description: 'Who is leaving the comment (optional, defaults to the task owner).',
        },
      },
      required: ['task_title', 'body'],
    },
  },
  {
    name: 'add_opportunity_comment',
    description:
      "Add a comment / activity-log entry to an existing opportunity (deal), found by its title. Use this to record the real outcome of a call or task (e.g. what the client said, why something was rescheduled). The comment is timestamped automatically.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        opportunity_title: {
          type: Type.STRING,
          description: 'Title of the opportunity to comment on (required).',
        },
        body: { type: Type.STRING, description: 'The comment text (required).' },
        author: {
          type: Type.STRING,
          description: 'Who is leaving the comment (optional, defaults to "AI Assistant").',
        },
      },
      required: ['opportunity_title', 'body'],
    },
  },
  {
    name: 'add_organization_comment',
    description:
      'Add a comment / activity-log entry to an existing organization (company), found by its name. The comment is timestamped automatically.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        organization_name: {
          type: Type.STRING,
          description: 'Name of the company to comment on (required).',
        },
        body: { type: Type.STRING, description: 'The comment text (required).' },
        author: {
          type: Type.STRING,
          description: 'Who is leaving the comment (optional, defaults to "AI Assistant").',
        },
      },
      required: ['organization_name', 'body'],
    },
  },
  {
    name: 'add_contact_comment',
    description:
      'Add a comment / activity-log entry to an existing contact (person), found by their name. The comment is timestamped automatically.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        contact_name: {
          type: Type.STRING,
          description: 'Full name of the contact to comment on (required).',
        },
        body: { type: Type.STRING, description: 'The comment text (required).' },
        author: {
          type: Type.STRING,
          description: 'Who is leaving the comment (optional, defaults to "AI Assistant").',
        },
      },
      required: ['contact_name', 'body'],
    },
  },
]

// Logs an unexpected tool-call failure (a thrown error, not an ordinary
// {success:false} result) so it can be reviewed later — Vercel's own logs
// don't stick around long enough to debug a one-off complaint from memory.
async function logToolFailure(
  toolName: string,
  args: Record<string, unknown>,
  error: unknown
) {
  try {
    await supabase.from('tool_failures').insert({
      tool_name: toolName,
      args,
      error: error instanceof Error ? error.message : String(error),
    })
  } catch {
    // Logging must never itself break the request.
  }
}

// ---------- tool executor ----------
// Wraps the real dispatch below in error isolation + failure logging, so one
// unexpected throw (a network blip, a bad assumption) never crashes the
// whole chat/voice turn — every call site gets this automatically.
export async function runTool(
  name: string,
  args: Record<string, unknown>,
  scope: AiScope
): Promise<Record<string, unknown>> {
  try {
    return await runToolInner(name, args, scope)
  } catch (error) {
    await logToolFailure(name, args, error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unexpected error.',
    }
  }
}

async function runToolInner(
  name: string,
  args: Record<string, unknown>,
  scope: AiScope
): Promise<Record<string, unknown>> {
  const workspaceId = scope.workspaceId
  const str = (v: unknown) =>
    typeof v === 'string' && v.trim() ? v.trim() : null
  const num = (v: unknown) => {
    if (typeof v === 'number' && Number.isFinite(v)) return v
    const n = parseFloat(String(v ?? ''))
    return Number.isFinite(n) ? n : 0
  }
  // Derive calendar scheduling from tool args. A start_at makes it a timed
  // event; end_at is computed from start_at + duration_minutes when not given.
  // We also derive start_date / due_date so the task's dates stay filled in
  // (and so it shows on the calendar without needing an all_day column).
  const parseDate = (v: unknown) => {
    const s = str(v)
    if (!s) return null
    // The model often appends a 'Z' or offset to the time it picked, which would
    // shift the event by the local UTC offset on the calendar. This CRM runs in
    // a single timezone, so treat the value as local wall-clock time: strip any
    // trailing zone designator before parsing.
    const local = s.replace(/(Z|[+-]\d{2}:?\d{2})$/, '')
    const d = new Date(local)
    return Number.isNaN(d.getTime()) ? null : d
  }
  const ymdLocal = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
      d.getDate()
    ).padStart(2, '0')}`
  const schedFrom = (a: Record<string, unknown>) => {
    const start = parseDate(a.start_at)
    let end = parseDate(a.end_at)
    const dur = num(a.duration_minutes)
    if (start && !end && dur > 0) end = new Date(start.getTime() + dur * 60000)
    return {
      start: start ? start.toISOString() : null,
      end: end ? end.toISOString() : null,
      startDate: start ? ymdLocal(start) : null,
      dueDate: end ? ymdLocal(end) : start ? ymdLocal(start) : null,
    }
  }

  if (name === 'create_organization') {
    const orgName = str(args.name) ?? 'Untitled'
    const existingId = await findExactOrgId(scope, orgName)
    if (existingId) {
      return {
        success: true,
        created: { id: existingId, name: orgName },
        note: 'already existed, reused',
      }
    }
    const { data, error } = await supabase
      .from('organizations')
      .insert({
        workspace_id: workspaceId,
        assigned_to: scope.memberId,
        name: str(args.name) ?? 'Untitled',
        legal_name: str(args.legal_name) ?? '',
        identification_code: str(args.identification_code) ?? '',
        email: str(args.email) ?? '',
        phone: str(args.phone) ?? '',
        website: str(args.website),
        address: str(args.address),
        industry: str(args.industry),
        notes: str(args.notes),
      })
      .select('id, name')
      .single()
    if (error) return { success: false, error: error.message }
    revalidatePath('/organizations')
    return { success: true, created: data }
  }

  if (name === 'update_organization') {
    const orgId = await resolveOrgId(scope, str(args.organization_name) ?? undefined)
    if (!orgId)
      return {
        success: false,
        error: `Company "${args.organization_name}" not found.`,
      }
    const patch: Record<string, unknown> = {}
    if (str(args.new_name)) patch.name = str(args.new_name)
    if (str(args.legal_name)) patch.legal_name = str(args.legal_name)
    if (str(args.identification_code))
      patch.identification_code = str(args.identification_code)
    if (str(args.email)) patch.email = str(args.email)
    if (str(args.phone)) patch.phone = str(args.phone)
    if (str(args.website)) patch.website = str(args.website)
    if (str(args.address)) patch.address = str(args.address)
    if (str(args.industry)) patch.industry = str(args.industry)
    if (str(args.notes)) patch.notes = str(args.notes)
    if (Object.keys(patch).length === 0)
      return { success: false, error: 'Nothing to update.' }
    let updOrgQuery = supabase.from('organizations').update(patch).eq('id', orgId).eq('workspace_id', workspaceId)
    if (!scope.elevated) updOrgQuery = updOrgQuery.eq('assigned_to', scope.memberId)
    const { data, error } = await updOrgQuery.select('id, name').single()
    if (error) return { success: false, error: error.message }
    revalidatePath('/organizations')
    revalidatePath(`/organizations/${orgId}`)
    return { success: true, updated: data }
  }

  if (name === 'find_company_contacts') {
    const company = str(args.name)
    if (!company)
      return { success: false, error: 'Company name is required.' }
    const found = await findCompanyContacts(company, str(args.hint) ?? undefined)
    const anything =
      found.email || found.phone || found.website || found.address || found.identification_code
    return {
      success: true,
      found,
      verified: false,
      note: anything
        ? 'Public data — use official_name for the company name; fill email/phone/website/address/identification_code. identification_code comes from the official Georgian business registry (companyinfo.ge) and can be trusted as-is; the rest is web-sourced and must be verified.'
        : 'Nothing reliable found for this company.',
    }
  }

  if (name === 'create_contact') {
    const firstName = str(args.first_name) ?? 'Unknown'
    const lastName = str(args.last_name) ?? ''
    const existingId = await findExactContactId(scope, firstName, lastName)
    if (existingId) {
      return {
        success: true,
        created: { id: existingId, first_name: firstName, last_name: lastName },
        note: 'already existed, reused',
      }
    }
    const orgId = await resolveOrgId(scope, str(args.organization_name) ?? undefined)
    const { data, error } = await supabase
      .from('contacts')
      .insert({
        workspace_id: workspaceId,
        assigned_to: scope.memberId,
        first_name: firstName,
        last_name: lastName,
        job_title: str(args.job_title),
        email: str(args.email),
        phone: str(args.phone),
        notes: str(args.notes),
        organization_id: orgId,
      })
      .select('id, first_name, last_name')
      .single()
    if (error) return { success: false, error: error.message }
    revalidatePath('/contacts')
    return {
      success: true,
      created: data,
      linked_company: args.organization_name
        ? orgId
          ? `linked to ${args.organization_name}`
          : `company "${args.organization_name}" not found — created without a company`
        : 'no company',
    }
  }

  if (name === 'create_opportunity') {
    const title = str(args.title) ?? 'Untitled deal'
    const existingId = await findExactOpportunityId(scope, title)
    if (existingId) {
      return {
        success: true,
        created: { id: existingId, title },
        note: 'already existed, reused',
      }
    }
    const [orgId, contactId] = await Promise.all([
      resolveOrgId(scope, str(args.organization_name) ?? undefined),
      resolveContactId(scope, str(args.contact_name) ?? undefined),
    ])
    const stage = STAGES.includes(String(args.stage))
      ? String(args.stage)
      : 'New Lead'
    const { data, error } = await supabase
      .from('opportunities')
      .insert({
        workspace_id: workspaceId,
        assigned_to: scope.memberId,
        title,
        value_gel: num(args.value_gel),
        stage,
        pain_points: str(args.pain_points),
        next_action: str(args.next_action),
        notes: str(args.notes),
        organization_id: orgId,
        contact_id: contactId,
      })
      .select('id, title, value_gel, stage')
      .single()
    if (error) return { success: false, error: error.message }
    revalidatePath('/dashboard')
    return { success: true, created: data }
  }

  if (name === 'create_task') {
    const title = str(args.title) ?? 'Untitled task'
    const existingId = await findExactTaskId(scope, title)
    if (existingId) {
      return {
        success: true,
        created: { id: existingId, title },
        note: 'already existed, reused',
      }
    }
    const [orgId, contactId, oppId] = await Promise.all([
      resolveOrgId(scope, str(args.organization_name) ?? undefined),
      resolveContactId(scope, str(args.contact_name) ?? undefined),
      resolveOpportunityId(scope, str(args.opportunity_title) ?? undefined),
    ])
    const allowed = ['todo', 'in_progress', 'done']
    const status = allowed.includes(String(args.status))
      ? String(args.status)
      : 'todo'
    const priorities = ['Low', 'Medium', 'High', 'Urgent']
    const priority = priorities.includes(String(args.priority))
      ? String(args.priority)
      : 'Medium'
    const sched = schedFrom(args)
    // When a time is given, schedule it (start_at/end_at) and fill start_date/
    // due_date to match so the task is dated everywhere and shows on the calendar.
    const schedCols = sched.start
      ? {
          start_at: sched.start,
          end_at: sched.end,
          start_date: sched.startDate,
          due_date: sched.dueDate,
        }
      : {}
    const { data, error } = await supabase
      .from('tasks')
      .insert({
        workspace_id: workspaceId,
        assigned_to: scope.memberId,
        title,
        description: str(args.description),
        start_date: str(args.start_date),
        due_date: str(args.due_date),
        ...schedCols,
        priority,
        owner: str(args.owner),
        status,
        organization_id: orgId,
        contact_id: contactId,
        opportunity_id: oppId,
      })
      .select('id, title, status, due_date')
      .single()
    if (error) return { success: false, error: error.message }
    revalidatePath('/tasks')
    return { success: true, created: data }
  }

  if (name === 'update_opportunity') {
    const oppId = await resolveOpportunityId(
      scope,
      str(args.opportunity_title) ?? undefined
    )
    if (!oppId)
      return {
        success: false,
        error: `Opportunity "${args.opportunity_title}" not found.`,
      }
    const patch: Record<string, unknown> = {}
    if (STAGES.includes(String(args.stage))) patch.stage = String(args.stage)
    if (args.value_gel !== undefined) patch.value_gel = num(args.value_gel)
    if (str(args.next_action)) patch.next_action = str(args.next_action)
    if (str(args.notes)) patch.notes = str(args.notes)
    if (patch.stage === 'Lost') {
      const reason = str(args.lost_reason)
      if (!reason)
        return { success: false, error: 'lost_reason is required when stage is Lost.' }
      patch.lost_reason = reason
    }

    const warnings: string[] = []
    if (str(args.organization_name)) {
      const linkOrgId = await resolveOrgId(scope, str(args.organization_name)!)
      if (linkOrgId) patch.organization_id = linkOrgId
      else warnings.push(`company "${args.organization_name}" not found`)
    }
    if (str(args.contact_name)) {
      const linkContactId = await resolveContactId(scope, str(args.contact_name)!)
      if (linkContactId) patch.contact_id = linkContactId
      else warnings.push(`contact "${args.contact_name}" not found`)
    }

    if (Object.keys(patch).length === 0)
      return {
        success: false,
        error: 'Nothing to update.',
        ...(warnings.length ? { warnings } : {}),
      }
    let updOppQuery = supabase.from('opportunities').update(patch).eq('id', oppId).eq('workspace_id', workspaceId)
    if (!scope.elevated) updOppQuery = updOppQuery.eq('assigned_to', scope.memberId)
    const { data, error } = await updOppQuery.select('id, title, value_gel, stage').single()
    if (error) return { success: false, error: error.message }
    revalidatePath('/dashboard')
    return { success: true, updated: data, ...(warnings.length ? { warnings } : {}) }
  }

  if (name === 'update_task') {
    const taskId = await resolveTaskId(scope, str(args.task_title) ?? undefined)
    if (!taskId)
      return { success: false, error: `Task "${args.task_title}" not found.` }
    const patch: Record<string, unknown> = {}
    const statuses = ['todo', 'in_progress', 'done']
    const priorities = ['Low', 'Medium', 'High', 'Urgent']
    if (statuses.includes(String(args.status))) patch.status = String(args.status)
    if (priorities.includes(String(args.priority)))
      patch.priority = String(args.priority)
    if (str(args.owner)) patch.owner = str(args.owner)
    if (str(args.description)) patch.description = str(args.description)
    if (str(args.start_date)) patch.start_date = str(args.start_date)
    if (str(args.due_date)) patch.due_date = str(args.due_date)

    // Calendar scheduling (timed events with a duration). Setting start_at also
    // syncs start_date/due_date so the task stays dated and shows on the calendar.
    const sched = schedFrom(args)
    if (str(args.start_at)) {
      patch.start_at = sched.start
      if (sched.end) patch.end_at = sched.end
      if (sched.startDate) patch.start_date = sched.startDate
      if (sched.dueDate) patch.due_date = sched.dueDate
    } else if (str(args.end_at) || num(args.duration_minutes) > 0) {
      if (sched.end) patch.end_at = sched.end
    }

    // Resolve links by name; warn (don't fail) if a named record isn't found.
    const warnings: string[] = []
    if (str(args.organization_name)) {
      const orgId = await resolveOrgId(scope, str(args.organization_name)!)
      if (orgId) patch.organization_id = orgId
      else warnings.push(`company "${args.organization_name}" not found`)
    }
    if (str(args.contact_name)) {
      const contactId = await resolveContactId(scope, str(args.contact_name)!)
      if (contactId) patch.contact_id = contactId
      else warnings.push(`contact "${args.contact_name}" not found`)
    }
    if (str(args.opportunity_title)) {
      const oppId = await resolveOpportunityId(scope, str(args.opportunity_title)!)
      if (oppId) patch.opportunity_id = oppId
      else warnings.push(`opportunity "${args.opportunity_title}" not found`)
    }

    if (Object.keys(patch).length === 0)
      return {
        success: false,
        error: 'Nothing to update.',
        ...(warnings.length ? { warnings } : {}),
      }
    let updTaskQuery = supabase.from('tasks').update(patch).eq('id', taskId).eq('workspace_id', workspaceId)
    if (!scope.elevated) updTaskQuery = updTaskQuery.eq('assigned_to', scope.memberId)
    const { data, error } = await updTaskQuery
      .select(
        'id, title, status, priority, due_date, organization_id, contact_id, opportunity_id'
      )
      .single()
    if (error) return { success: false, error: error.message }
    revalidatePath('/tasks')
    revalidatePath(`/tasks/${taskId}`)
    return { success: true, updated: data, ...(warnings.length ? { warnings } : {}) }
  }

  if (name === 'add_task_comment') {
    const taskId = await resolveTaskId(scope, str(args.task_title) ?? undefined)
    if (!taskId)
      return { success: false, error: `Task "${args.task_title}" not found.` }
    const body = str(args.body)
    if (!body) return { success: false, error: 'Comment body is required.' }
    const { data, error } = await supabase
      .from('task_comments')
      .insert({
        task_id: taskId,
        workspace_id: workspaceId,
        author: str(args.author) ?? 'AI Assistant',
        body,
      })
      .select('id, author, body, created_at')
      .single()
    if (error) return { success: false, error: error.message }
    revalidatePath(`/tasks/${taskId}`)
    return { success: true, created: data }
  }

  if (name === 'add_opportunity_comment') {
    const oppId = await resolveOpportunityId(
      scope,
      str(args.opportunity_title) ?? undefined
    )
    if (!oppId)
      return {
        success: false,
        error: `Opportunity "${args.opportunity_title}" not found.`,
      }
    const body = str(args.body)
    if (!body) return { success: false, error: 'Comment body is required.' }
    const { data, error } = await supabase
      .from('opportunity_comments')
      .insert({
        opportunity_id: oppId,
        workspace_id: workspaceId,
        author: str(args.author) ?? 'AI Assistant',
        body,
      })
      .select('id, author, body, created_at')
      .single()
    if (error) return { success: false, error: error.message }
    revalidatePath(`/opportunities/${oppId}`)
    return { success: true, created: data }
  }

  if (name === 'add_organization_comment') {
    const orgId = await resolveOrgId(scope, str(args.organization_name) ?? undefined)
    if (!orgId)
      return { success: false, error: `Company "${args.organization_name}" not found.` }
    const body = str(args.body)
    if (!body) return { success: false, error: 'Comment body is required.' }
    const { data, error } = await supabase
      .from('organization_comments')
      .insert({
        organization_id: orgId,
        workspace_id: workspaceId,
        author: str(args.author) ?? 'AI Assistant',
        body,
      })
      .select('id, author, body, created_at')
      .single()
    if (error) return { success: false, error: error.message }
    revalidatePath(`/organizations/${orgId}`)
    return { success: true, created: data }
  }

  if (name === 'add_contact_comment') {
    const contactId = await resolveContactId(scope, str(args.contact_name) ?? undefined)
    if (!contactId)
      return { success: false, error: `Contact "${args.contact_name}" not found.` }
    const body = str(args.body)
    if (!body) return { success: false, error: 'Comment body is required.' }
    const { data, error } = await supabase
      .from('contact_comments')
      .insert({
        contact_id: contactId,
        workspace_id: workspaceId,
        author: str(args.author) ?? 'AI Assistant',
        body,
      })
      .select('id, author, body, created_at')
      .single()
    if (error) return { success: false, error: error.message }
    revalidatePath(`/contacts/${contactId}`)
    return { success: true, created: data }
  }

  if (name === 'update_contact') {
    const target = str(args.first_name)
    if (!target) return { success: false, error: 'first_name is required to find the contact.' }
    const fullTarget = `${target} ${str(args.last_name) ?? ''}`.trim()
    const contactId =
      (await resolveContactId(scope, fullTarget)) ?? (await resolveContactId(scope, target))
    if (!contactId)
      return { success: false, error: `Contact "${fullTarget}" not found.` }
    const patch: Record<string, unknown> = {}
    if (str(args.new_first_name)) patch.first_name = str(args.new_first_name)
    if (str(args.new_last_name)) patch.last_name = str(args.new_last_name)
    if (str(args.job_title)) patch.job_title = str(args.job_title)
    if (str(args.email)) patch.email = str(args.email)
    if (str(args.phone)) patch.phone = str(args.phone)
    if (str(args.notes)) patch.notes = str(args.notes)

    const warnings: string[] = []
    if (str(args.organization_name)) {
      const orgId = await resolveOrgId(scope, str(args.organization_name)!)
      if (orgId) patch.organization_id = orgId
      else warnings.push(`company "${args.organization_name}" not found`)
    }

    if (Object.keys(patch).length === 0)
      return {
        success: false,
        error: 'Nothing to update.',
        ...(warnings.length ? { warnings } : {}),
      }
    let updContactQuery = supabase.from('contacts').update(patch).eq('id', contactId).eq('workspace_id', workspaceId)
    if (!scope.elevated) updContactQuery = updContactQuery.eq('assigned_to', scope.memberId)
    const { data, error } = await updContactQuery.select('id, first_name, last_name').single()
    if (error) return { success: false, error: error.message }
    revalidatePath('/contacts')
    revalidatePath(`/contacts/${contactId}`)
    return { success: true, updated: data, ...(warnings.length ? { warnings } : {}) }
  }

  if (name === 'get_record') {
    const entity = str(args.entity)
    const nameOrId = str(args.name_or_id)
    if (!entity || !nameOrId)
      return { success: false, error: 'entity and name_or_id are required.' }

    if (entity === 'organization') {
      const id = (await resolveOrgId(scope, nameOrId)) ?? nameOrId
      let q = supabase.from('organizations').select('*').eq('id', id).eq('workspace_id', workspaceId)
      if (!scope.elevated) q = q.eq('assigned_to', scope.memberId)
      const { data, error } = await q.maybeSingle()
      if (error || !data) return { success: false, error: `Organization "${nameOrId}" not found.` }
      return { success: true, record: data }
    }
    if (entity === 'contact') {
      const id = (await resolveContactId(scope, nameOrId)) ?? nameOrId
      let q = supabase.from('contacts').select('*').eq('id', id).eq('workspace_id', workspaceId)
      if (!scope.elevated) q = q.eq('assigned_to', scope.memberId)
      const { data, error } = await q.maybeSingle()
      if (error || !data) return { success: false, error: `Contact "${nameOrId}" not found.` }
      return { success: true, record: data }
    }
    if (entity === 'opportunity') {
      const id = (await resolveOpportunityId(scope, nameOrId)) ?? nameOrId
      let q = supabase.from('opportunities').select('*').eq('id', id).eq('workspace_id', workspaceId)
      if (!scope.elevated) q = q.eq('assigned_to', scope.memberId)
      const [{ data, error }, { data: comments }] = await Promise.all([
        q.maybeSingle(),
        supabase
          .from('opportunity_comments')
          .select('author, body, created_at')
          .eq('opportunity_id', id)
          .eq('workspace_id', workspaceId)
          .order('created_at', { ascending: false }),
      ])
      if (error || !data) return { success: false, error: `Opportunity "${nameOrId}" not found.` }
      return { success: true, record: data, comments: comments ?? [] }
    }
    if (entity === 'task') {
      const id = (await resolveTaskId(scope, nameOrId)) ?? nameOrId
      let q = supabase.from('tasks').select('*').eq('id', id).eq('workspace_id', workspaceId)
      if (!scope.elevated) q = q.eq('assigned_to', scope.memberId)
      const [{ data, error }, { data: comments }] = await Promise.all([
        q.maybeSingle(),
        supabase
          .from('task_comments')
          .select('author, body, created_at')
          .eq('task_id', id)
          .eq('workspace_id', workspaceId)
          .order('created_at', { ascending: false }),
      ])
      if (error || !data) return { success: false, error: `Task "${nameOrId}" not found.` }
      return { success: true, record: data, comments: comments ?? [] }
    }
    return { success: false, error: `Unknown entity: ${entity}` }
  }

  if (name === 'archive_organization') {
    const orgId = await resolveOrgId(scope, str(args.organization_name) ?? undefined)
    if (!orgId)
      return { success: false, error: `Company "${args.organization_name}" not found.` }
    let q = supabase.from('organizations').update({ archived: true }).eq('id', orgId).eq('workspace_id', workspaceId)
    if (!scope.elevated) q = q.eq('assigned_to', scope.memberId)
    const { error } = await q
    if (error) return { success: false, error: error.message }
    revalidatePath('/organizations')
    return { success: true, archived: { id: orgId } }
  }

  if (name === 'archive_contact') {
    const contactId = await resolveContactId(scope, str(args.contact_name) ?? undefined)
    if (!contactId)
      return { success: false, error: `Contact "${args.contact_name}" not found.` }
    let q = supabase.from('contacts').update({ archived: true }).eq('id', contactId).eq('workspace_id', workspaceId)
    if (!scope.elevated) q = q.eq('assigned_to', scope.memberId)
    const { error } = await q
    if (error) return { success: false, error: error.message }
    revalidatePath('/contacts')
    return { success: true, archived: { id: contactId } }
  }

  if (name === 'archive_opportunity') {
    const oppId = await resolveOpportunityId(scope, str(args.opportunity_title) ?? undefined)
    if (!oppId)
      return { success: false, error: `Opportunity "${args.opportunity_title}" not found.` }
    let q = supabase.from('opportunities').update({ archived: true }).eq('id', oppId).eq('workspace_id', workspaceId)
    if (!scope.elevated) q = q.eq('assigned_to', scope.memberId)
    const { error } = await q
    if (error) return { success: false, error: error.message }
    revalidatePath('/dashboard')
    return { success: true, archived: { id: oppId } }
  }

  if (name === 'archive_task') {
    const taskId = await resolveTaskId(scope, str(args.task_title) ?? undefined)
    if (!taskId)
      return { success: false, error: `Task "${args.task_title}" not found.` }
    let q = supabase.from('tasks').update({ archived: true }).eq('id', taskId).eq('workspace_id', workspaceId)
    if (!scope.elevated) q = q.eq('assigned_to', scope.memberId)
    const { error } = await q
    if (error) return { success: false, error: error.message }
    revalidatePath('/tasks')
    return { success: true, archived: { id: taskId } }
  }

  return { success: false, error: `Unknown tool: ${name}` }
}
