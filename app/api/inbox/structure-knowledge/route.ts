import { NextResponse } from 'next/server'
import { GoogleGenAI } from '@google/genai'
import { getCurrentMember } from '@/lib/auth'
import { logAiUsage, tooManyRecent } from '@/lib/ai-usage'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

// Reorganize messy/pasted business info into clean, sectioned knowledge the AI
// answers from better (and that RAG-lite can slice). Facts only — never invents.
export async function POST(req: Request) {
  const me = await getCurrentMember()
  if (!me) return NextResponse.json({ error: 'შესვლა საჭიროა' }, { status: 401 })
  if (!process.env.GEMINI_API_KEY)
    return NextResponse.json({ error: 'AI არ არის კონფიგურირებული.' }, { status: 500 })

  let body: { text?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'არასწორი მოთხოვნა.' }, { status: 400 })
  }
  const text = (body.text ?? '').trim()
  if (!text) return NextResponse.json({ error: 'ცარიელი ტექსტი.' }, { status: 400 })

  if (await tooManyRecent(me.workspace_id, 'inbox_structure', 10))
    return NextResponse.json({ error: 'ცოტა ხანში სცადეთ.' }, { status: 429 })

  const prompt = `შენ ხარ ასისტენტი, რომელიც ბიზნესის ინფორმაციას ალაგებ სუფთა, სტრუქტურირებულ სახით ჩატბოტისთვის.

აიღე ქვემოთ მოცემული (ხშირად არეული, საიტიდან კოპირებული) ტექსტი და გადააწყვე შემდეგ სექციებად, ქართულად:

## კომპანია
## სერვისები და ფასები
## ვადები
## ხშირი კითხვები
## რას არ ვამბობთ

წესები:
- შეინახე ყველა რეალური ფაქტი (ფასი, ვადა, სერვისი, კონტაქტი). არაფერი მოიგონო და არაფერი წაშალo.
- თუ რომელიმე სექციისთვის ინფორმაცია არ არის, დატოვე სათაური და ქვეშ დაწერე „(შესავსებია)".
- მოაშორe layout-ის ნაგავი (გამეორებული სახელები, სიმბოლოები).
- დააბრუნe მხოლოდ სტრუქტურირებული ტექსტი, ახსნის გარეშe.

ტექსტი:
${text}`

  try {
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })
    const res = await ai.models.generateContent({ model: 'gemini-2.5-flash', contents: prompt })
    await logAiUsage({
      workspaceId: me.workspace_id,
      route: 'inbox_structure',
      inputTokens: res.usageMetadata?.promptTokenCount ?? 0,
      outputTokens: res.usageMetadata?.candidatesTokenCount ?? 0,
    })
    return NextResponse.json({ structured: (res.text ?? '').trim() })
  } catch (e) {
    return NextResponse.json(
      { error: `ვერ დალაგდა: ${e instanceof Error ? e.message : 'უცნობი'}` },
      { status: 502 }
    )
  }
}
