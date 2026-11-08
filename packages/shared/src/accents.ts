// The accent colour presets, in their own file so the desktop renderer can import the list without pulling in zod.
// The colours themselves are in @repo/ui's theme.css; keep the two in step.

export const ACCENTS = ['neutral', 'blue', 'violet', 'green', 'orange', 'rose'] as const
export type Accent = (typeof ACCENTS)[number]

export const isAccent = (value: unknown): value is Accent =>
  (ACCENTS as readonly unknown[]).includes(value)
