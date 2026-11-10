import { describe, expect, it } from 'vitest'
import { emailInDomains } from './domains'

describe('emailInDomains', () => {
  it('matches any domain in a comma-separated list, and their subdomains', () => {
    expect(emailInDomains('jane@a.com', 'a.com,b.com')).toBe(true)
    expect(emailInDomains('Jane@B.com', 'a.com, b.com')).toBe(true)
    expect(emailInDomains('jane@eu.a.com', 'a.com')).toBe(true)
  })
  it('refuses look-alikes and empty lists', () => {
    expect(emailInDomains('jane@nota.com', 'a.com')).toBe(false)
    expect(emailInDomains('jane@a.com.evil.example', 'a.com')).toBe(false)
    expect(emailInDomains('jane@a.com', '')).toBe(false)
    expect(emailInDomains('no-at-sign', 'a.com')).toBe(false)
  })
})
