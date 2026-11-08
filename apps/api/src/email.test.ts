import { describe, expect, it } from 'vitest'
import { magicLinkEmail } from './email'

describe('magicLinkEmail', () => {
  it('puts the link in both versions', () => {
    const m = magicLinkEmail('https://x.test/verify?token=abc&callbackURL=%2Fapp', 'My App')
    expect(m.subject).toBe('Sign in to My App')
    expect(m.text).toContain('https://x.test/verify?token=abc&callbackURL=%2Fapp')
    expect(m.html).toContain('href="https://x.test/verify?token=abc&amp;callbackURL=%2Fapp"')
  })

  it('escapes anything that could break out of the HTML', () => {
    const m = magicLinkEmail('https://x.test/"><script>alert(1)</script>', '<b>App</b>')
    expect(m.html).not.toContain('<script>')
    expect(m.html).not.toContain('<b>App</b>')
  })

  it('is a real, readable message: a button, a fallback address, the name and the expiry', () => {
    const m = magicLinkEmail('https://x.test/verify?token=abc', 'GoZap')
    expect(m.html).toContain('<!doctype html>')
    expect(m.html).toContain('Sign in to GoZap &rarr;</a>')
    expect(m.html).toContain('Sign in to GoZap')
    expect(m.html).not.toContain('<img')
    expect(m.html).toContain('expires in 5 minutes')
    expect(m.text).toContain('Your sign-in link for GoZap is ready')
    expect(m.text).toContain('https://x.test/verify?token=abc')
    expect(m.text).not.toContain('<')
  })
})

describe('magicLinkEmail branding', () => {
  it('shows the logo and uses the brand colour for the header and the button', () => {
    const m = magicLinkEmail('https://x.test/v', 'GoZap', {
      logoUrl: 'https://x.test/email-logo.png',
      color: '#687848',
      onColor: '#ffffff'
    })
    expect(m.html).toContain('src="https://x.test/email-logo.png"')
    expect(m.html).toContain('alt="GoZap"')
    expect(m.html.match(/#687848/g)!.length).toBeGreaterThanOrEqual(3)
  })

  it('escapes the logo address and colour', () => {
    const m = magicLinkEmail('https://x.test/v', 'A', {
      logoUrl: 'https://x.test/"><script>',
      color: '"><script>'
    })
    expect(m.html).not.toContain('<script>')
  })
})
