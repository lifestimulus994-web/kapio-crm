export type Organization = {
  id: string
  name: string
  legal_name: string
  identification_code: string
  email: string
  phone: string
  website: string | null
  address: string | null
  industry: string | null
  notes: string | null
  created_at: string
}

export type Contact = {
  id: string
  organization_id: string | null
  first_name: string
  last_name: string
  email: string | null
  phone: string | null
  job_title: string | null
  notes: string | null
  created_at: string
  organization?: Pick<Organization, 'id' | 'name'>
}

export const STAGES = [
  'New Lead',
  'Contacted',
  'Needs Identified',
  'Proposal Sent',
  'Negotiation',
  'Won',
  'Lost',
] as const

export type Stage = (typeof STAGES)[number]

export type Opportunity = {
  id: string
  organization_id: string | null
  contact_id: string | null
  title: string
  value_gel: number
  stage: Stage
  pain_points: string | null
  notes: string | null
  next_action: string | null
  created_at: string
  // Detail fields — optional until the opportunities migration in schema.sql is run.
  owner?: string | null
  source?: string | null
  start_date?: string | null
  close_date?: string | null
  organization?: Pick<Organization, 'id' | 'name' | 'email' | 'phone'>
  contact?: Pick<Contact, 'id' | 'first_name' | 'last_name' | 'phone' | 'email'>
}

export type TaskStatus = 'todo' | 'in_progress' | 'done'

export const TASK_PRIORITIES = ['Low', 'Medium', 'High', 'Urgent'] as const
export type TaskPriority = (typeof TASK_PRIORITIES)[number]

export type Task = {
  id: string
  opportunity_id: string | null
  contact_id: string | null
  organization_id: string | null
  title: string
  description: string | null
  start_date: string | null
  due_date: string | null // end date
  // Calendar scheduling — optional until the tasks calendar migration is run.
  start_at?: string | null
  end_at?: string | null
  all_day?: boolean
  priority: TaskPriority
  owner: string | null
  status: TaskStatus
  created_at: string
  organization?: Pick<Organization, 'id' | 'name'>
  contact?: Pick<Contact, 'id' | 'first_name' | 'last_name'>
  opportunity?: Pick<Opportunity, 'id' | 'title'>
}

export type TaskComment = {
  id: string
  task_id: string
  author: string
  body: string
  created_at: string
}

export type OpportunityComment = {
  id: string
  opportunity_id: string
  author: string
  body: string
  created_at: string
}

export type OrganizationComment = {
  id: string
  organization_id: string
  author: string
  body: string
  created_at: string
}

export type ContactComment = {
  id: string
  contact_id: string
  author: string
  body: string
  created_at: string
}

export const LEAD_STATUSES = ['new', 'contacted', 'converted', 'lost'] as const
export type LeadStatus = (typeof LEAD_STATUSES)[number]

export type Lead = {
  id: string
  full_name: string
  phone: string | null
  email: string | null
  company: string | null
  source: string | null
  notes: string | null
  status: LeadStatus
  assigned_to: string | null
  created_at: string
  assignee?: { id: string; full_name: string | null; email: string } | null
}
