import { Resend } from 'resend'

export interface EmailMessage {
  to: string
  subject: string
  html: string
  text: string
}

/** Anything that can send an email. Production uses Resend; tests and local development use the others. */
export interface EmailSender {
  send(message: EmailMessage): Promise<void>
}

const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif"
const MONO = "ui-monospace,SFMono-Regular,Menlo,Consolas,'Liberation Mono',monospace"

export interface MagicLinkEmailOptions {
  /** Address of the logo image (the website serves /email-logo.png). Without it the header shows the name only. */
  logoUrl?: string
  /** Colour of the header and the button. `pnpm icons` takes it from the app icon (see brand.ts). */
  color?: string
  /** Text colour that is readable on `color`. */
  onColor?: string
}

/**
 * The email that carries the sign-in link: a header in the brand colour with the app logo, a headline, one big
 * button, and the safety notes. Email clients ignore most CSS, so the layout is a table with inline styles (plus a
 * small <style> block for dark mode, which Apple Mail and most phones honour). If a client blocks the logo, the
 * coloured header and the alt text still look right. The plain-text version says the same. Pure, so it is easy to test.
 */
export function magicLinkEmail(
  url: string,
  appName: string,
  { logoUrl, color = '#18181b', onColor = '#ffffff' }: MagicLinkEmailOptions = {}
): Omit<EmailMessage, 'to'> {
  const link = escapeHtml(url)
  const name = escapeHtml(appName)
  const brand = escapeHtml(color)
  const on = escapeHtml(onColor)
  const logo = logoUrl
    ? `<img src="${escapeHtml(logoUrl)}" width="96" height="96" alt="${name}" style="display:block;margin:0 auto;width:96px;height:96px;border:0;">`
    : `<div style="font-family:${FONT};font-size:26px;font-weight:700;color:${on};">${name}</div>`
  return {
    subject: `Sign in to ${appName}`,
    text: [
      `Your sign-in link for ${appName} is ready`,
      '',
      'Open this link to sign in. No password needed. It works once and expires in 5 minutes:',
      '',
      url,
      '',
      "Didn't request this? You can safely ignore this email. Your account stays secure and nobody gets in without this link."
    ].join('\n'),
    html: `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark"><title>Sign in to ${name}</title>
<style>
@media (prefers-color-scheme: dark) {
  .bg { background:#0b0b0f !important; }
  .card { background:#17171c !important; border-color:#2a2a33 !important; }
  .h { color:#f4f4f5 !important; }
  .p { color:#c4c4cc !important; }
  .muted { color:#8b8b96 !important; }
  .band { background:#101015 !important; border-color:#2a2a33 !important; }
  .link { color:#e4e4e7 !important; }
}
</style></head>
<body class="bg" style="margin:0;padding:0;background:#f4f4f5;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">Your sign-in link for ${name}. No password needed. It expires in 5 minutes.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="bg" style="background:#f4f4f5;padding:32px 12px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="card" style="max-width:520px;background:#ffffff;border:1px solid #e4e4e7;border-radius:16px;overflow:hidden;">
<tr><td align="center" bgcolor="${brand}" style="background:${brand};padding:40px 24px;">${logo}</td></tr>
<tr><td align="center" class="h" style="padding:40px 40px 12px;font-family:${FONT};font-size:28px;font-weight:700;line-height:1.25;color:#18181b;">Your sign-in link is ready</td></tr>
<tr><td align="center" class="p" style="padding:0 40px 28px;font-family:${FONT};font-size:16px;line-height:1.6;color:#52525b;">Tap the button below to sign in to ${name}. No password needed, we'll take care of the rest.</td></tr>
<tr><td style="padding:0 40px 14px;"><a href="${link}" style="display:block;background:${brand};color:${on};font-family:${FONT};font-size:16px;font-weight:600;line-height:1;text-align:center;text-decoration:none;padding:18px 24px;border-radius:10px;">Sign in to ${name} &rarr;</a></td></tr>
<tr><td align="center" class="muted" style="padding:0 40px 36px;font-family:${FONT};font-size:13px;line-height:1.5;color:#8b8b96;">This link works once and expires in 5 minutes</td></tr>
<tr><td align="center" class="band" bgcolor="#f7f7f8" style="background:#f7f7f8;border-top:1px solid #ececf0;border-bottom:1px solid #ececf0;padding:24px 32px;">
<div class="muted" style="font-family:${FONT};font-size:13px;line-height:1.5;color:#71717a;padding-bottom:8px;">Button not working? Paste this link into your browser:</div>
<div class="link" style="font-family:${MONO};font-size:12px;line-height:1.5;color:#27272a;word-break:break-all;">${link}</div>
</td></tr>
<tr><td class="muted" style="padding:24px 40px 32px;font-family:${FONT};font-size:13px;line-height:1.6;color:#71717a;">Didn't request this? You can safely ignore this email. Your account stays secure and nobody gets in without this link.</td></tr>
</table>
</td></tr></table>
</body></html>`
  }
}

export function createResendSender(apiKey: string, from: string): EmailSender {
  const resend = new Resend(apiKey)
  return {
    async send({ to, subject, html, text }) {
      // The SDK returns { data, error } instead of throwing for API errors.
      const { error } = await resend.emails.send({ from, to: [to], subject, html, text })
      if (error) throw new Error(`Resend: ${error.name}: ${error.message}`)
    }
  }
}

/** For local development without a Resend key: prints the email so you can click the link. */
export function createConsoleSender(): EmailSender {
  return {
    async send({ to, subject, text }) {
      console.log(`\n--- email to ${to}: ${subject} ---\n${text}\n---`)
    }
  }
}
