import localFont from 'next/font/local'

// Georgian body/UI text — the CRM app itself uses Geist (Latin-only), but
// public-facing marketing surfaces follow the standard rule: Georgian text
// always renders in FiraGO, never a system-font fallback.
export const firaGO = localFont({
  src: [
    { path: './firago/FiraGO-Regular.otf', weight: '400', style: 'normal' },
    { path: './firago/FiraGO-Medium.otf', weight: '500', style: 'normal' },
    { path: './firago/FiraGO-SemiBold.otf', weight: '600', style: 'normal' },
    { path: './firago/FiraGO-Bold.otf', weight: '700', style: 'normal' },
    // Italic (letter slant) — used by the strategy-board sticky notes.
    { path: './firago/FiraGO-Italic.otf', weight: '400', style: 'italic' },
    { path: './firago/FiraGO-MediumItalic.otf', weight: '500', style: 'italic' },
    { path: './firago/FiraGO-SemiBoldItalic.otf', weight: '600', style: 'italic' },
    { path: './firago/FiraGO-BoldItalic.otf', weight: '700', style: 'italic' },
  ],
  variable: '--font-firago',
  display: 'swap',
})

// English display type (headings, brand wordmark).
export const clashDisplay = localFont({
  src: [
    { path: './clash/ClashDisplay-Regular.woff2', weight: '400', style: 'normal' },
    { path: './clash/ClashDisplay-Medium.woff2', weight: '500', style: 'normal' },
    { path: './clash/ClashDisplay-Semibold.woff2', weight: '600', style: 'normal' },
    { path: './clash/ClashDisplay-Bold.woff2', weight: '700', style: 'normal' },
  ],
  variable: '--font-clash',
  display: 'swap',
})
