# Migrations

Supabase-ის მიგრაციები. თითოეული ერთხელ უნდა გაეშვას **Dashboard → SQL Editor**-ში.
ფაილები ინომრება **გაშვების რიგით** — ზემოდან ქვემოთ. ყველა `if not exists`-ით
დაცულია, ამიტომ ხელახლა გაშვება უსაფრთხოა.

`schema.sql` (root-ში) — საბაზისო სქემა (workspaces, members, orgs, contacts,
opportunities, tasks, leads). ეს პირველად.

| # | ფაილი | რას აკეთებს | სტატუსი |
|---|---|---|---|
| 01 | `01-job-postings.sql` | jobs.ge/hr.ge ვაკანსიების ქეში | ✅ გაშვებული |
| 02 | `02-boards.sql` | სტრატეგიის დაფები (boards) | ✅ გაშვებული |
| 03 | `03-channels.sql` | Omnichannel inbox: channel_connections, conversations, messages | ✅ გაშვებული |
| 04 | `04-inbox-ai.sql` | AI auto-reply: inbox_settings + conversations.ai_enabled/needs_human | ✅ გაშვებული |
| 05 | `05-inbox-tone.sql` | inbox_settings.tone (ტონი/პიროვნება) | ✅ გაშვებული |
| 06 | `06-inbox-phase1.sql` | lead scoring: conversations.lead_score/intent/interest_level/consultation_offers/opted_out | ⏳ გასაშვები |
| 07 | `07-notifications.sql` | ზარის notifications + triggers (leads/tasks) | ✅ გაშვებული |

**ახლა გასაშვები:** `06-inbox-phase1.sql`

## ახალი მიგრაციის დამატება
შემდეგი ფაილი `08-<სახელი>.sql`, ცხრილში სტრიქონი დაამატე, გაუშვი Supabase-ში.
