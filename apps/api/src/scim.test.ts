import { describe, expect, it } from 'vitest'
import {
  groupFromBody,
  hashToken,
  newToken,
  parseFilter,
  parsePatch,
  patchGroup,
  patchUser,
  ScimError,
  selectAttributes,
  userFromBody,
  SCHEMA_ENTERPRISE,
  SCHEMA_GROUP,
  SCHEMA_PATCH,
  SCHEMA_USER
} from './scim'

const user = (extra: Record<string, unknown> = {}) =>
  userFromBody({
    schemas: [SCHEMA_USER],
    userName: 'Ada.Lovelace@acme.example',
    externalId: 'ext-1',
    name: { givenName: 'Ada', familyName: 'Lovelace' },
    emails: [
      { value: 'ada@acme.example', type: 'work', primary: true },
      { value: 'ada@home.example', type: 'home' }
    ],
    ...extra
  })
const patch = (ops: unknown[]) => parsePatch({ schemas: [SCHEMA_PATCH], Operations: ops })
const fails = (fn: () => unknown, type?: string): void => {
  try {
    fn()
  } catch (error) {
    expect(error).toBeInstanceOf(ScimError)
    if (type) expect((error as ScimError).scimType).toBe(type)
    return
  }
  throw new Error('expected a ScimError')
}

describe('scim tokens', () => {
  it('makes long unique tokens and hashes them with a key', async () => {
    const a = newToken()
    expect(a).toMatch(/^scim_[\w-]{43}$/)
    expect(newToken()).not.toBe(a)
    const h1 = await hashToken('secret-one', a)
    expect(h1).toMatch(/^[0-9a-f]{64}$/)
    expect(await hashToken('secret-two', a)).not.toBe(h1)
    expect(h1).not.toContain(a)
  })
})

describe('scim filters', () => {
  const allowed = ['id', 'username', 'externalid', 'emails.value']
  it('parses equality terms joined by and', () => {
    expect(parseFilter('userName eq "ada@acme.example" and externalId eq "x"', allowed)).toEqual([
      { attr: 'username', value: 'ada@acme.example' },
      { attr: 'externalid', value: 'x' }
    ])
    expect(parseFilter('EMAILS[type eq "work"].value EQ "a@b.co"', allowed)).toEqual([
      { attr: 'emails.value', value: 'a@b.co', type: 'work' }
    ])
    expect(parseFilter(undefined, allowed)).toEqual([])
  })
  it('refuses everything else', () => {
    fails(() => parseFilter('userName pr', allowed), 'invalidFilter')
    fails(() => parseFilter('userName eq "a" or id eq "b"', allowed), 'invalidFilter')
    fails(() => parseFilter('userName co "a"', allowed), 'invalidFilter')
    fails(() => parseFilter('title eq "a"', allowed), 'invalidFilter')
    fails(() => parseFilter(Array(11).fill('id eq "a"').join(' and '), allowed), 'tooMany')
  })
})

describe('scim users', () => {
  it('derives the display name and keeps the casing of userName', () => {
    const u = user()
    expect(u.userName).toBe('Ada.Lovelace@acme.example')
    expect(u.displayName).toBe('Ada Lovelace')
    expect(u.name.formatted).toBe('Ada Lovelace')
  })
  it('uses userName as the email when none is sent, and refuses when it is not one', () => {
    const u = userFromBody({ schemas: [SCHEMA_USER], userName: 'bob@acme.example' })
    expect(u.emails).toEqual([{ value: 'bob@acme.example', primary: true }])
    fails(() => userFromBody({ schemas: [SCHEMA_USER], userName: 'bob' }), 'invalidValue')
  })
  it('checks schemas, primaries, types, sizes and active', () => {
    fails(() => userFromBody({ userName: 'a@b.co' }), 'invalidValue')
    fails(
      () => userFromBody({ schemas: [SCHEMA_USER, SCHEMA_USER], userName: 'a@b.co' }),
      'invalidValue'
    )
    fails(() => userFromBody({ schemas: [SCHEMA_GROUP], userName: 'a@b.co' }), 'invalidValue')
    fails(() =>
      user({
        emails: [
          { value: 'a@b.co', primary: true },
          { value: 'c@d.co', primary: true }
        ]
      })
    )
    fails(() =>
      user({
        emails: [
          { value: 'a@b.co', type: 'work' },
          { value: 'c@d.co', type: 'WORK' }
        ]
      })
    )
    fails(() => user({ emails: Array.from({ length: 21 }, (_, i) => ({ value: `a${i}@b.co` })) }))
    fails(() => user({ emails: [{ value: 'nope' }] }))
    fails(() => user({ active: null }), 'invalidValue')
    fails(() => user({ active: 1 }), 'invalidValue')
    fails(() => user({ UserName: 'x@y.co', userName: 'z@y.co' }), 'invalidSyntax')
    expect(user({ active: 'False' }).active).toBe(false)
    expect(user({ active: 'True' }).active).toBe(true)
  })
  it('accepts attribute names in any case and the enterprise extension', () => {
    const u = userFromBody({
      schemas: [SCHEMA_USER, SCHEMA_ENTERPRISE],
      USERNAME: 'e@acme.example',
      [SCHEMA_ENTERPRISE]: { department: 'Engines', manager: { value: 'm1' } }
    })
    expect(u.userName).toBe('e@acme.example')
    expect(u.extra[SCHEMA_ENTERPRISE]).toEqual({ department: 'Engines', manager: { value: 'm1' } })
  })
})

describe('scim patch (users)', () => {
  it('replaces simple and nested attributes, in order', () => {
    const next = patchUser(
      user(),
      patch([
        { op: 'Replace', path: 'name.givenName', value: 'Augusta' },
        { op: 'replace', path: 'active', value: 'False' },
        { op: 'replace', path: 'userName', value: 'ada2@acme.example' },
        { op: 'replace', path: 'userName', value: 'ada3@acme.example' }
      ])
    )
    expect(next.name.givenName).toBe('Augusta')
    expect(next.active).toBe(false)
    expect(next.userName).toBe('ada3@acme.example')
  })
  it('works without a path and with the default operation', () => {
    const next = patchUser(user(), patch([{ value: { displayName: 'A. L.', title: 'Countess' } }]))
    expect(next.displayName).toBe('A. L.')
    expect(next.extra.title).toBe('Countess')
  })
  it('edits a selected email and creates it when missing', () => {
    const changed = patchUser(
      user(),
      patch([
        { op: 'replace', path: 'emails[type eq "work"].value', value: 'ada.new@acme.example' }
      ])
    )
    expect(changed.emails.find((e) => e.type === 'work')?.value).toBe('ada.new@acme.example')
    const created = patchUser(
      user(),
      patch([{ op: 'add', path: 'phoneNumbers[type eq "mobile"].value', value: '+100' }])
    )
    expect(created.extra.phoneNumbers).toEqual([{ type: 'mobile', value: '+100' }])
    // A created email is never primary.
    const email = patchUser(
      user({ emails: [{ value: 'a@b.co', primary: true }] }),
      patch([{ op: 'add', path: 'emails[type eq "other"].value', value: 'c@d.co' }])
    )
    expect(email.emails.filter((e) => e.primary)).toHaveLength(1)
  })
  it('adds, removes and clears with null', () => {
    const next = patchUser(
      user(),
      patch([
        { op: 'add', path: 'emails', value: [{ value: 'ada@work2.example', type: 'other' }] },
        { op: 'remove', path: 'emails[type eq "home"]' },
        { op: 'replace', path: 'title', value: 'x' },
        { op: 'replace', path: 'title', value: null }
      ])
    )
    expect(next.emails.map((e) => e.value)).toEqual(['ada@acme.example', 'ada@work2.example'])
    expect(next.extra.title).toBeUndefined()
  })
  it('handles the enterprise paths and the manager aliases', () => {
    const next = patchUser(
      user(),
      patch([
        { op: 'add', path: `${SCHEMA_ENTERPRISE}:department`, value: 'Engines' },
        { op: 'add', path: `${SCHEMA_ENTERPRISE}:manager`, value: { value: 'm9' } },
        { op: 'replace', path: `${SCHEMA_ENTERPRISE}:manager.$ref`, value: 'm10' }
      ])
    )
    expect(next.extra[SCHEMA_ENTERPRISE]).toMatchObject({
      department: 'Engines',
      manager: { value: 'm10' }
    })
  })
  it('refuses bad patches and changes nothing', () => {
    const original = user()
    fails(
      () => patchUser(original, patch([{ op: 'replace', path: 'id', value: 'x' }])),
      'mutability'
    )
    fails(
      () => patchUser(original, patch([{ op: 'replace', path: 'active', value: null }])),
      'invalidValue'
    )
    fails(() => patchUser(original, patch([{ op: 'remove', path: 'userName' }])), 'invalidValue')
    fails(() => patchUser(original, patch([{ op: 'remove' }])), 'noTarget')
    fails(
      () => patchUser(original, patch([{ op: 'replace', path: 'a b c', value: 1 }])),
      'invalidPath'
    )
    fails(
      () => patchUser(original, patch([{ op: 'bogus', path: 'title', value: 1 }])),
      'invalidValue'
    )
    fails(() => parsePatch({ schemas: [SCHEMA_USER], Operations: [] }), 'invalidValue')
    expect(original.name.givenName).toBe('Ada')
    expect(patchUser(original, patch([])).userName).toBe(original.userName)
  })
})

describe('scim groups', () => {
  const group = (extra: Record<string, unknown> = {}) =>
    groupFromBody({ schemas: [SCHEMA_GROUP], displayName: 'Engineers', ...extra }, false)
  it('reads a group and removes duplicate members', () => {
    expect(
      group({ members: [{ value: 'u1' }, { value: 'u1', type: 'User' }, { value: 'u2' }] }).members
    ).toEqual(['u1', 'u2'])
    fails(() => group({ members: [{ value: 'g1', type: 'Group' }] }), 'invalidValue')
    fails(() => groupFromBody({ schemas: [SCHEMA_GROUP] }, false), 'invalidValue')
    fails(() => group({ members: Array.from({ length: 1001 }, (_, i) => ({ value: `u${i}` })) }))
  })
  it('accepts the old Entra schema only when asked', () => {
    const legacy = 'http://schemas.microsoft.com/2006/11/ResourceManagement/ADSCIM/2.0/Group'
    fails(() => groupFromBody({ schemas: [legacy], displayName: 'x' }, false), 'invalidValue')
    expect(groupFromBody({ schemas: [legacy], displayName: 'x' }, true).displayName).toBe('x')
  })
  it('patches members', () => {
    const base = group({ members: [{ value: 'u1' }, { value: 'u2' }] })
    const p = (ops: unknown[]) => patchGroup(base, patch(ops))
    expect(p([{ op: 'add', path: 'members', value: [{ value: 'u3' }] }]).members).toEqual([
      'u1',
      'u2',
      'u3'
    ])
    expect(p([{ op: 'replace', path: 'members', value: [{ value: 'u9' }] }]).members).toEqual([
      'u9'
    ])
    expect(p([{ op: 'remove', path: 'members[value eq "u1"]' }]).members).toEqual(['u2'])
    expect(p([{ op: 'remove', path: 'members', value: [{ value: 'u2' }] }]).members).toEqual(['u1'])
    expect(p([{ op: 'remove', path: 'members' }]).members).toEqual([])
    expect(p([{ op: 'replace', path: 'displayName', value: 'Ops' }]).displayName).toBe('Ops')
    fails(() => p([{ op: 'replace', path: 'id', value: 'x' }]), 'mutability')
    fails(() => p([{ op: 'add', path: 'members[value eq "u1"]', value: [] }]), 'invalidPath')
  })
})

describe('scim attribute selection', () => {
  it('keeps schemas and id, and refuses both options at once', () => {
    const r = { schemas: ['s'], id: '1', userName: 'a', title: 't', emails: [] }
    expect(selectAttributes(r, 'userName', undefined)).toEqual({
      schemas: ['s'],
      id: '1',
      userName: 'a'
    })
    expect(selectAttributes(r, undefined, 'emails,title')).toEqual({
      schemas: ['s'],
      id: '1',
      userName: 'a'
    })
    fails(() => selectAttributes(r, 'a', 'b'), 'invalidValue')
  })
})
