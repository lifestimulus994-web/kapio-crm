import Link from 'next/link'
import Image from 'next/image'
import {
  KanbanSquare,
  Sparkles,
  Target,
  Users,
  Mic,
  Check,
  ArrowRight,
} from 'lucide-react'
import { firaGO, clashDisplay } from './fonts'

export const metadata = {
  title: 'Kapio — CRM და AI ასისტენტი თქვენი ბიზნესისთვის',
  description:
    'ორგანიზაციები, კონტაქტები, გარიგებები, ლიდები და გუნდი ერთ სივრცეში — AI ასისტენტით, რომელიც ხმით და ტექსტით მუშაობს თქვენს მაგივრად.',
}

const features = [
  {
    Icon: KanbanSquare,
    title: 'Pipeline ერთ სივრცეში',
    body: 'ორგანიზაციები, კონტაქტები და გარიგებები ურთიერთდაკავშირებული — არაფერი იკარგება ცალკეულ ცხრილებში.',
  },
  {
    Icon: Sparkles,
    title: 'AI ასისტენტი',
    body: 'ჩაწერე ხმით ან დაწერე ჩატში — Kapio თავად ქმნის ჩანაწერს, ავსებს დეტალებს და ურთავს კომენტარს სწორ ადგილას.',
  },
  {
    Icon: Target,
    title: 'ლიდების განაწილება',
    body: 'შემოსული ლიდები Excel-იდანაც კი ერთბაშად ატვირთე და გუნდის წევრებზე სამართლიანად გადაანაწილე.',
  },
  {
    Icon: Users,
    title: 'გუნდი, უსაფრთხოდ',
    body: 'დაამატე თანამშრომელი საკუთარი ანგარიშით — თითოეული ხედავს მხოლოდ მასზე მინიჭებულს.',
  },
]

const plans = [
  {
    name: 'Starter',
    price: '₾49',
    period: '/თვე',
    tagline: 'სოლო მეწარმისთვის',
    features: ['1 ანგარიში', 'სრული CRM', 'AI ჩატი — 50 შეკითხვა/თვე', 'Pipeline & ლიდები'],
    cta: 'დაიწყე უფასოდ',
    highlighted: false,
  },
  {
    name: 'Business',
    price: '₾149',
    period: '/თვე',
    tagline: 'მზარდი გუნდისთვის',
    features: [
      '5 ანგარიშამდე',
      'სრული CRM',
      'AI ჩატი — 300 შეკითხვა/თვე',
      'ხმოვანი შენიშვნები',
      'ლიდების Excel-იმპორტი',
    ],
    cta: 'სცადე 14 დღე უფასოდ',
    highlighted: true,
  },
  {
    name: 'Pro',
    price: 'შეთანხმებით',
    period: '',
    tagline: 'დიდი გუნდისთვის',
    features: ['ულიმიტო ანგარიში', 'ულიმიტო AI', 'პრიორიტეტული მხარდაჭერა', 'პერსონალური ონბორდინგი'],
    cta: 'დაგვიკავშირდი',
    highlighted: false,
  },
]

export default function LandingPage() {
  return (
    <div
      className={`${firaGO.variable} ${clashDisplay.variable} min-h-screen bg-slate-950 text-slate-100`}
      style={{ fontFamily: 'var(--font-firago), sans-serif', letterSpacing: 'normal' }}
    >
      {/* Nav */}
      <header className="sticky top-0 z-40 border-b border-slate-800/80 bg-slate-950/90 backdrop-blur-sm">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4">
          <div className="flex items-center gap-2.5">
            <Image src="/logo.png" alt="Kapio" width={30} height={30} className="rounded-lg" />
            <span
              className="text-lg font-semibold text-slate-100"
              style={{ fontFamily: 'var(--font-clash), sans-serif' }}
            >
              Kapio
            </span>
          </div>
          <div className="flex items-center gap-2 sm:gap-3">
            <Link
              href="/login"
              className="rounded-lg px-3 py-2 text-sm font-medium text-slate-300 transition-colors hover:text-white"
            >
              შესვლა
            </Link>
            <Link
              href="/signup"
              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-emerald-500"
            >
              სცადე უფასოდ
            </Link>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="mx-auto max-w-4xl px-5 pt-16 pb-14 text-center sm:pt-24 sm:pb-20">
        <div className="mb-5 inline-flex items-center gap-1.5 rounded-full border border-emerald-800/60 bg-emerald-950/40 px-3 py-1 text-xs font-medium text-emerald-400">
          <Sparkles size={13} />
          AI-ით გამძლავრებული CRM
        </div>
        <h1
          className="text-3xl font-bold text-slate-50 sm:text-5xl"
          style={{ fontFamily: 'var(--font-firago), sans-serif', lineHeight: 1.3 }}
        >
          CRM, რომელიც
          <br />
          თქვენს მაგივრად მუშაობს
        </h1>
        <p className="mx-auto mt-5 max-w-xl text-base text-slate-400 sm:text-lg" style={{ lineHeight: 1.6 }}>
          ორგანიზაციები, კონტაქტები, გარიგებები, ლიდები და გუნდი — ერთ სივრცეში.
          უთხარი ხმით ან დაწერე ჩატში, დანარჩენს AI ასისტენტი მოაგვარებს.
        </p>
        <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link
            href="/signup"
            className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-emerald-500 sm:w-auto"
          >
            დაიწყე უფასოდ
            <ArrowRight size={16} />
          </Link>
          <Link
            href="/login"
            className="inline-flex w-full items-center justify-center rounded-lg border border-slate-700 bg-slate-900 px-6 py-3 text-sm font-semibold text-slate-200 transition-colors hover:bg-slate-800 sm:w-auto"
          >
            შესვლა
          </Link>
        </div>
      </section>

      {/* Product preview strip */}
      <section className="mx-auto max-w-5xl px-5 pb-16 sm:pb-24">
        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6 sm:p-10">
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-3">
            {[
              { n: '0 საათი', label: 'ხელით ჩანაწერზე' },
              { n: '1 ადგილი', label: 'მთელი გუნდისთვის' },
              { n: '24/7', label: 'AI ასისტენტი' },
            ].map((s) => (
              <div key={s.label} className="text-center">
                <p className="text-2xl font-bold text-emerald-400 sm:text-3xl">{s.n}</p>
                <p className="mt-1 text-sm text-slate-500">{s.label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="mx-auto max-w-6xl px-5 pb-16 sm:pb-24">
        <div className="mb-10 text-center">
          <h2
            className="text-2xl font-bold text-slate-50 sm:text-3xl"
            style={{ fontFamily: 'var(--font-firago), sans-serif', lineHeight: 1.3 }}
          >
            ყველაფერი, რაც გჭირდება გაყიდვისთვის
          </h2>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {features.map(({ Icon, title, body }) => (
            <div
              key={title}
              className="rounded-xl border border-slate-800 bg-slate-900/40 p-5 transition-colors hover:border-slate-700"
            >
              <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-900/40 text-emerald-400">
                <Icon size={19} />
              </div>
              <h3 className="mb-1.5 text-sm font-semibold text-slate-100">{title}</h3>
              <p className="text-xs text-slate-500" style={{ lineHeight: 1.6 }}>
                {body}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* AI callout */}
      <section className="mx-auto max-w-5xl px-5 pb-16 sm:pb-24">
        <div className="flex flex-col items-center gap-8 rounded-2xl border border-emerald-900/40 bg-gradient-to-br from-emerald-950/30 to-slate-900/60 p-6 sm:flex-row sm:p-10">
          <div className="flex h-16 w-16 flex-none items-center justify-center rounded-2xl bg-emerald-600/20 text-emerald-400">
            <Mic size={28} />
          </div>
          <div className="text-center sm:text-left">
            <h3
              className="text-xl font-bold text-slate-50 sm:text-2xl"
              style={{ fontFamily: 'var(--font-firago), sans-serif', lineHeight: 1.3 }}
            >
              ილაპარაკე — Kapio ჩაწერს
            </h3>
            <p className="mt-2 max-w-xl text-sm text-slate-400" style={{ lineHeight: 1.6 }}>
              &quot;A ორგანიზაციასთან მაქვს მოლაპარაკება, D რიცხვში შეხვედრა&quot; — Kapio ქმნის მოკლე
              დავალებას, აკავშირებს გარიგებასთან და ინახავს დეტალებს კომენტარში, ზუსტი დროით.
            </p>
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="mx-auto max-w-6xl px-5 pb-16 sm:pb-24">
        <div className="mb-10 text-center">
          <h2
            className="text-2xl font-bold text-slate-50 sm:text-3xl"
            style={{ fontFamily: 'var(--font-firago), sans-serif', lineHeight: 1.3 }}
          >
            ფასები, ორგანიზაციის ზომაზე მორგებული
          </h2>
        </div>
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
          {plans.map((p) => (
            <div
              key={p.name}
              className={`flex flex-col rounded-2xl border p-6 ${
                p.highlighted
                  ? 'border-emerald-600 bg-emerald-950/20 ring-1 ring-emerald-600/50'
                  : 'border-slate-800 bg-slate-900/40'
              }`}
            >
              {p.highlighted && (
                <span className="mb-3 inline-block w-fit rounded-full bg-emerald-600 px-2.5 py-0.5 text-[11px] font-semibold text-white">
                  ყველაზე პოპულარული
                </span>
              )}
              <h3 className="text-sm font-semibold text-slate-300">{p.name}</h3>
              <p className="mt-1 text-xs text-slate-500">{p.tagline}</p>
              <p className="mt-4 flex items-baseline gap-1">
                <span className="text-3xl font-bold text-slate-50" style={{ whiteSpace: 'nowrap' }}>
                  {p.price}
                </span>
                <span className="text-sm text-slate-500">{p.period}</span>
              </p>
              <ul className="mt-5 flex-1 space-y-2.5">
                {p.features.map((f) => (
                  <li key={f} className="flex items-start gap-2 text-sm text-slate-300">
                    <Check size={15} className="mt-0.5 flex-none text-emerald-500" />
                    {f}
                  </li>
                ))}
              </ul>
              <Link
                href="/signup"
                className={`mt-6 rounded-lg px-4 py-2.5 text-center text-sm font-semibold transition-colors ${
                  p.highlighted
                    ? 'bg-emerald-600 text-white hover:bg-emerald-500'
                    : 'bg-slate-800 text-slate-200 hover:bg-slate-700'
                }`}
              >
                {p.cta}
              </Link>
            </div>
          ))}
        </div>
      </section>

      {/* Final CTA */}
      <section className="mx-auto max-w-4xl px-5 pb-20 text-center sm:pb-28">
        <h2
          className="text-2xl font-bold text-slate-50 sm:text-3xl"
          style={{ fontFamily: 'var(--font-firago), sans-serif', lineHeight: 1.3 }}
        >
          მზად ხარ დაიწყო?
        </h2>
        <p className="mt-3 text-sm text-slate-400 sm:text-base">
          ანგარიშის შექმნას 2 წუთი სჭირდება — საკრედიტო ბარათი არ არის საჭირო.
        </p>
        <Link
          href="/signup"
          className="mt-6 inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-emerald-500"
        >
          დაიწყე უფასოდ
          <ArrowRight size={16} />
        </Link>
      </section>

      {/* Footer */}
      <footer className="border-t border-slate-800/80 px-5 py-8">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 text-xs text-slate-600 sm:flex-row">
          <div className="flex items-center gap-2">
            <Image src="/logo.png" alt="Kapio" width={18} height={18} className="rounded" />
            Kapio · Tbilisi
          </div>
          <p>© {new Date().getFullYear()} Kapio. ყველა უფლება დაცულია.</p>
        </div>
      </footer>
    </div>
  )
}
