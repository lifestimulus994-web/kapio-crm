import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

// .env.local isn't loaded outside the Next.js runtime — parse it by hand.
const envPath = new URL('../.env.local', import.meta.url)
for (const line of readFileSync(envPath, 'utf8').split('\n')) {
  const match = line.match(/^([A-Z_0-9]+)=(.*)$/)
  if (match) process.env[match[1]] ??= match[2].trim()
}

const [, , email, password, fullName] = process.argv
if (!email || !password) {
  console.error('Usage: node scripts/seed-owner.mjs <email> <password> ["Full Name"]')
  process.exit(1)
}

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
)

const { data, error } = await admin.auth.admin.createUser({
  email,
  password,
  email_confirm: true,
})

if (error || !data.user) {
  console.error('Failed to create auth user:', error?.message)
  process.exit(1)
}

const { error: memberError } = await admin.from('members').insert({
  id: data.user.id,
  email,
  full_name: fullName || null,
  role: 'owner',
})

if (memberError) {
  console.error('Failed to create member row:', memberError.message)
  await admin.auth.admin.deleteUser(data.user.id)
  process.exit(1)
}

console.log(`Owner created: ${email}`)
