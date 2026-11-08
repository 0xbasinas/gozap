/** Everything the Worker receives from Cloudflare: bindings, plain variables and secrets. */
export interface Bindings {
  DB: D1Database
  /** Public address of the site; the API lives on the same origin. */
  BETTER_AUTH_URL: string
  /** Product name shown in sign-in emails and on passkey prompts. Defaults to the template's name. */
  APP_NAME?: string
  /** Sender shown on login emails. The domain must be verified in Resend. */
  EMAIL_FROM: string
  /** Secret: signs sessions and tokens. `openssl rand -base64 32`. */
  BETTER_AUTH_SECRET: string
  /** Secret: Resend API key. Without it (local development) login links are printed to the log instead. */
  RESEND_API_KEY?: string
  /** Secret, optional: signing secret of the Resend webhook (whsec_...). Without it the webhook endpoint is off. */
  RESEND_WEBHOOK_SECRET?: string
  /** Secret, optional: Sentry DSN. With it, unexpected errors in the Worker are reported to Sentry. */
  SENTRY_DSN?: string
  /** Optional, comma separated: extra origins allowed to call the API (for example a custom desktop scheme). */
  TRUSTED_ORIGINS?: string
  /** Optional: the oldest desktop app version still allowed, like "0.1.42". Older apps show an "update required" screen. Empty: no limit. */
  MIN_APP_VERSION?: string
  /** Secret, optional: Cloudflare Turnstile secret key. With it (and the site key) the magic-link request needs a solved challenge. */
  TURNSTILE_SECRET_KEY?: string
  /** Optional, public: Cloudflare Turnstile site key, shown to the sign-in page through /api/app-config. */
  TURNSTILE_SITE_KEY?: string
  /** "true" only in preview deploys: the site address is then taken from each request (see preview.ts). */
  PREVIEW?: string
}
