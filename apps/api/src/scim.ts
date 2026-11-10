/**
 * Pure parts of our SCIM 2.0 service (RFC 7643, 7644): tokens, filters, PATCH and the shapes of Users and Groups.
 * Nothing here touches the database; see scimStore.ts and scimRoutes.ts.
 */

export const SCHEMA_USER = 'urn:ietf:params:scim:schemas:core:2.0:User'
export const SCHEMA_ENTERPRISE = 'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User'
export const SCHEMA_GROUP = 'urn:ietf:params:scim:schemas:core:2.0:Group'
export const SCHEMA_PATCH = 'urn:ietf:params:scim:api:messages:2.0:PatchOp'
export const SCHEMA_LIST = 'urn:ietf:params:scim:api:messages:2.0:ListResponse'
export const SCHEMA_ERROR = 'urn:ietf:params:scim:api:messages:2.0:Error'
const LEGACY_ENTRA_GROUP =
  'http://schemas.microsoft.com/2006/11/ResourceManagement/ADSCIM/2.0/Group'

export const SCOPES = [
  'scim.users.read',
  'scim.users.write',
  'scim.groups.read',
  'scim.groups.write'
] as const
export type ScimScope = (typeof SCOPES)[number]

export const MAX_BODY_BYTES = 1_000_000
export const MAX_PAGE = 100
export const MAX_GROUP_MEMBERS = 1000
export const MAX_EMAILS = 20
export const MAX_OPERATIONS = 100
export const MAX_FILTER_TERMS = 10
export const MAX_CONNECTIONS_PER_TEAM = 3
export const MAX_ACTIVE_CREDENTIALS = 5
/** Last-used time is written at most this often, so a busy directory does not write on every request. */
export const LAST_USED_WRITE_MS = 5 * 60_000

export type ScimErrorType =
  | 'invalidFilter'
  | 'tooMany'
  | 'uniqueness'
  | 'mutability'
  | 'invalidSyntax'
  | 'invalidPath'
  | 'noTarget'
  | 'invalidValue'
  | 'invalidVers'
  | 'sensitive'

export class ScimError extends Error {
  constructor(
    readonly status: number,
    readonly scimType: ScimErrorType | undefined,
    detail: string
  ) {
    super(detail)
  }
}

export const errorBody = (error: ScimError): Record<string, unknown> => ({
  schemas: [SCHEMA_ERROR],
  status: String(error.status),
  ...(error.scimType ? { scimType: error.scimType } : {}),
  detail: error.message
})

// ---------------------------------------------------------------- tokens

const toHex = (bytes: ArrayBuffer): string =>
  [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('')

/** A new bearer token: 256 random bits, url-safe. */
export function newToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  let text = ''
  for (const b of bytes) text += String.fromCharCode(b)
  return 'scim_' + btoa(text).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}

/** Keyed hash of a token (HMAC-SHA256, key derived from the Worker secret). Only this is stored. */
export async function hashToken(secret: string, token: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(`${secret}:scim-token`),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  return toHex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(token)))
}

export const parseScopes = (text: string): ScimScope[] =>
  text.split(' ').filter((s): s is ScimScope => (SCOPES as readonly string[]).includes(s))

// ---------------------------------------------------------------- filters

export interface FilterTerm {
  /** Lower-cased attribute, such as `username` or `emails.value`. */
  attr: string
  value: string
  /** For `emails[type eq "work"].value`. */
  type?: string
}

/**
 * Supports what the directories actually send: up to 10 `attribute eq "value"` terms joined by `and`.
 * Everything else (or, not, pr, comparisons, parentheses) is refused with `invalidFilter`.
 */
export function parseFilter(text: string | undefined, allowed: readonly string[]): FilterTerm[] {
  if (!text) return []
  const terms: FilterTerm[] = []
  const rest = { text: text.trim() }
  const term =
    /^([A-Za-z][\w.:-]*(?:\[type eq "[^"\\]*"\](?:\.value)?)?)\s+eq\s+"((?:[^"\\]|\\.)*)"\s*/i
  for (;;) {
    const match = term.exec(rest.text)
    if (!match)
      throw new ScimError(
        400,
        'invalidFilter',
        'Only "attribute eq value" terms joined by "and" are supported.'
      )
    const raw = match[1]!
    const typed = /^([A-Za-z]+)\[type eq "([^"\\]*)"\](?:\.value)?$/i.exec(raw)
    const attr = (typed ? `${typed[1]}.value` : raw).toLowerCase()
    if (!allowed.includes(attr))
      throw new ScimError(400, 'invalidFilter', `Cannot filter on "${raw}".`)
    terms.push({
      attr,
      value: match[2]!.replace(/\\(.)/g, '$1'),
      ...(typed ? { type: typed[2]!.toLowerCase() } : {})
    })
    rest.text = rest.text.slice(match[0].length)
    if (!rest.text) break
    const and = /^and\s+/i.exec(rest.text)
    if (!and) throw new ScimError(400, 'invalidFilter', 'Only "and" can join filter terms.')
    rest.text = rest.text.slice(and[0].length)
    if (terms.length >= MAX_FILTER_TERMS)
      throw new ScimError(400, 'tooMany', `At most ${MAX_FILTER_TERMS} filter terms.`)
  }
  return terms
}

// ---------------------------------------------------------------- shared helpers

type Json = Record<string, unknown>
const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v)
const text = (v: unknown, what: string, max = 1000): string => {
  if (typeof v !== 'string') throw new ScimError(400, 'invalidValue', `${what} must be a string.`)
  if (v.length > max) throw new ScimError(400, 'invalidValue', `${what} is too long.`)
  return v
}

/** The directories send `"True"`/`"False"` strings (Entra); null and anything else is refused. */
export function toActive(v: unknown): boolean {
  if (typeof v === 'boolean') return v
  if (v === 'true' || v === 'True') return true
  if (v === 'false' || v === 'False') return false
  throw new ScimError(400, 'invalidValue', '"active" must be true or false.')
}

function checkSchemas(body: Json, core: string, extra: string[] = []): void {
  const schemas = body.schemas
  if (!Array.isArray(schemas) || schemas.some((s) => typeof s !== 'string'))
    throw new ScimError(400, 'invalidValue', '"schemas" is required.')
  const list = schemas as string[]
  if (new Set(list).size !== list.length)
    throw new ScimError(400, 'invalidValue', 'Duplicate schema URN.')
  if (!list.includes(core))
    throw new ScimError(400, 'invalidValue', `"schemas" must include ${core}.`)
  for (const s of list)
    if (s !== core && !extra.includes(s))
      throw new ScimError(400, 'invalidValue', `Unsupported schema ${s}.`)
}

/** Keys of an object compared without regard to case; duplicates that differ only by case are refused. */
function canonicalKeys(obj: Json, known: readonly string[]): Json {
  const out: Json = {}
  const seen = new Set<string>()
  for (const [key, value] of Object.entries(obj)) {
    const lower = key.toLowerCase()
    if (seen.has(lower)) throw new ScimError(400, 'invalidSyntax', `Duplicate attribute "${key}".`)
    seen.add(lower)
    out[known.find((k) => k.toLowerCase() === lower) ?? key] = value
  }
  return out
}

// ---------------------------------------------------------------- users

const USER_KEYS = [
  'schemas',
  'id',
  'externalId',
  'userName',
  'name',
  'displayName',
  'nickName',
  'profileUrl',
  'title',
  'userType',
  'preferredLanguage',
  'locale',
  'timezone',
  'active',
  'emails',
  'phoneNumbers',
  'addresses',
  'roles',
  'entitlements',
  'meta',
  'groups',
  'password',
  'ims',
  'photos',
  'x509Certificates'
] as const
const NAME_KEYS = [
  'formatted',
  'familyName',
  'givenName',
  'middleName',
  'honorificPrefix',
  'honorificSuffix'
]
const MULTI = ['emails', 'phoneNumbers', 'addresses', 'roles', 'entitlements'] as const
const STRINGS = [
  'nickName',
  'profileUrl',
  'title',
  'userType',
  'preferredLanguage',
  'locale',
  'timezone'
] as const
const ENTERPRISE_KEYS = [
  'employeeNumber',
  'costCenter',
  'organization',
  'division',
  'department',
  'manager'
]
const UNSUPPORTED = ['password', 'ims', 'photos', 'x509Certificates', 'groups']

export interface Email {
  value: string
  type?: string
  primary?: boolean
  display?: string
}

/** A person as stored: the SCIM attributes we keep, already checked. */
export interface UserRecord {
  userName: string
  externalId: string | null
  active: boolean
  displayName: string | null
  name: Record<string, string>
  emails: Email[]
  /** nickName, title, phoneNumbers, addresses, roles, entitlements, enterprise extension ... */
  extra: Json
}

export const emptyUser = (): UserRecord => ({
  userName: '',
  externalId: null,
  active: true,
  displayName: null,
  name: {},
  emails: [],
  extra: {}
})

const looksLikeEmail = (s: string): boolean =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) && s.length <= 254

function checkMulti(name: string, value: unknown): Json[] {
  if (!Array.isArray(value)) throw new ScimError(400, 'invalidValue', `"${name}" must be a list.`)
  if (value.length > MAX_EMAILS) throw new ScimError(400, 'invalidValue', `Too many "${name}".`)
  const items = value.map((item) => {
    if (!isObject(item))
      throw new ScimError(400, 'invalidValue', `"${name}" items must be objects.`)
    return item
  })
  if (items.filter((i) => i.primary === true).length > 1)
    throw new ScimError(400, 'invalidValue', `Only one "${name}" item can be primary.`)
  const types = items
    .map((i) => (typeof i.type === 'string' ? i.type.toLowerCase() : null))
    .filter(Boolean)
  if (new Set(types).size !== types.length)
    throw new ScimError(400, 'invalidValue', `"${name}" types must be different.`)
  return items
}

/** Check and tidy a whole record (after create, replace or patch). */
export function finalizeUser(record: UserRecord): UserRecord {
  const userName = text(record.userName, 'userName', 254).trim()
  if (!userName) throw new ScimError(400, 'invalidValue', '"userName" is required.')
  const emails = checkMulti('emails', record.emails) as unknown as Email[]
  for (const e of emails) {
    text(e.value, 'emails.value', 254)
    if (!looksLikeEmail(e.value))
      throw new ScimError(400, 'invalidValue', 'An email address is not valid.')
  }
  let list = emails
  if (list.length === 0) {
    if (!looksLikeEmail(userName))
      throw new ScimError(
        400,
        'invalidValue',
        'Send an email address, or use an email address as "userName".'
      )
    list = [{ value: userName, primary: true }]
  }
  const extra: Json = {}
  for (const [key, value] of Object.entries(record.extra)) {
    if ((MULTI as readonly string[]).includes(key)) extra[key] = checkMulti(key, value)
    else if ((STRINGS as readonly string[]).includes(key)) extra[key] = text(value, key)
    else if (key === SCHEMA_ENTERPRISE) {
      if (!isObject(value))
        throw new ScimError(400, 'invalidValue', 'The enterprise extension must be an object.')
      const ext = canonicalKeys(value, ENTERPRISE_KEYS)
      for (const k of Object.keys(ext))
        if (!ENTERPRISE_KEYS.includes(k))
          throw new ScimError(400, 'invalidValue', `Unsupported attribute "${k}".`)
      extra[key] = ext
    } else throw new ScimError(400, 'invalidValue', `Unsupported attribute "${key}".`)
  }
  const name: Record<string, string> = {}
  for (const [k, v] of Object.entries(record.name))
    if (NAME_KEYS.includes(k)) name[k] = text(v, `name.${k}`)
    else throw new ScimError(400, 'invalidValue', `Unsupported attribute "name.${k}".`)
  const primary = list.find((e) => e.primary) ?? list[0]!
  const joined = [name.givenName, name.familyName].filter(Boolean).join(' ')
  const formatted = name.formatted ?? (joined || undefined)
  const displayName = record.displayName ?? formatted ?? primary.value
  return {
    userName,
    externalId: record.externalId === null ? null : text(record.externalId, 'externalId', 255),
    active: record.active,
    displayName: text(displayName, 'displayName'),
    name: formatted ? { ...name, formatted } : name,
    emails: list,
    extra
  }
}

/** The address used for the sign-in account: the primary email, else the first, else the user name. */
export const accountEmail = (record: UserRecord): string =>
  (
    record.emails.find((e) => e.primary) ??
    record.emails[0] ?? { value: record.userName }
  ).value.toLowerCase()

export const emailValuesOf = (record: UserRecord): string =>
  JSON.stringify(record.emails.map((e) => e.value.toLowerCase()))

/** A POST or PUT body to a record. */
export function userFromBody(body: unknown): UserRecord {
  if (!isObject(body)) throw new ScimError(400, 'invalidSyntax', 'The body must be a JSON object.')
  const input = canonicalKeys(body, USER_KEYS)
  checkSchemas(input, SCHEMA_USER, [SCHEMA_ENTERPRISE])
  const record = emptyUser()
  for (const key of UNSUPPORTED)
    if (input[key] !== undefined && input[key] !== null && key !== 'groups' && key !== 'password')
      throw new ScimError(400, 'invalidValue', `"${key}" is not supported.`)
  if (input.userName === undefined)
    throw new ScimError(400, 'invalidValue', '"userName" is required.')
  record.userName = text(input.userName, 'userName', 254)
  if (input.externalId != null) record.externalId = text(input.externalId, 'externalId', 255)
  if (input.active !== undefined) record.active = toActive(input.active)
  if (input.displayName != null) record.displayName = text(input.displayName, 'displayName')
  if (input.name != null) {
    if (!isObject(input.name)) throw new ScimError(400, 'invalidValue', '"name" must be an object.')
    record.name = canonicalKeys(input.name, NAME_KEYS) as Record<string, string>
  }
  if (input.emails != null) record.emails = input.emails as Email[]
  for (const key of [...MULTI.filter((k) => k !== 'emails'), ...STRINGS])
    if (input[key] != null) record.extra[key] = input[key]
  const ext = Object.entries(input).find(
    ([k]) => k.toLowerCase() === SCHEMA_ENTERPRISE.toLowerCase()
  )
  if (ext && ext[1] != null) record.extra[SCHEMA_ENTERPRISE] = ext[1]
  return finalizeUser(record)
}

export interface UserRow {
  id: string
  externalId: string | null
  createdAt: number
  updatedAt: number
}

export function userResource(row: UserRow, record: UserRecord, base: string): Json {
  const ext = record.extra[SCHEMA_ENTERPRISE]
  const resource: Json = {
    schemas: ext ? [SCHEMA_USER, SCHEMA_ENTERPRISE] : [SCHEMA_USER],
    id: row.id,
    ...(record.externalId ? { externalId: record.externalId } : {}),
    userName: record.userName,
    ...(Object.keys(record.name).length ? { name: record.name } : {}),
    displayName: record.displayName,
    active: record.active,
    emails: record.emails
  }
  for (const [k, v] of Object.entries(record.extra)) if (k !== SCHEMA_ENTERPRISE) resource[k] = v
  if (ext) resource[SCHEMA_ENTERPRISE] = ext
  resource.meta = {
    resourceType: 'User',
    created: new Date(row.createdAt).toISOString(),
    lastModified: new Date(row.updatedAt).toISOString(),
    location: `${base}/Users/${row.id}`
  }
  return resource
}

// ---------------------------------------------------------------- PATCH

export interface PatchOp {
  op: 'add' | 'replace' | 'remove'
  path?: string
  value?: unknown
}

export function parsePatch(body: unknown): PatchOp[] {
  if (!isObject(body)) throw new ScimError(400, 'invalidSyntax', 'The body must be a JSON object.')
  const input = canonicalKeys(body, ['schemas', 'Operations'])
  if (!Array.isArray(input.schemas) || !input.schemas.includes(SCHEMA_PATCH))
    throw new ScimError(400, 'invalidValue', `"schemas" must include ${SCHEMA_PATCH}.`)
  const ops = input.Operations
  if (ops === undefined) return []
  if (!Array.isArray(ops)) throw new ScimError(400, 'invalidSyntax', '"Operations" must be a list.')
  if (ops.length > MAX_OPERATIONS) throw new ScimError(400, 'tooMany', 'Too many operations.')
  return ops.map((raw) => {
    if (!isObject(raw))
      throw new ScimError(400, 'invalidSyntax', 'Each operation must be an object.')
    const o = canonicalKeys(raw, ['op', 'path', 'value'])
    const op = (typeof o.op === 'string' ? o.op : 'replace').toLowerCase()
    if (op !== 'add' && op !== 'replace' && op !== 'remove')
      throw new ScimError(400, 'invalidValue', `Unknown operation "${String(o.op)}".`)
    if (o.path !== undefined && typeof o.path !== 'string')
      throw new ScimError(400, 'invalidPath', '"path" must be a string.')
    return { op, path: o.path as string | undefined, value: o.value }
  })
}

interface ParsedPath {
  /** Extension URN, when the path starts with one. */
  urn: string | null
  attr: string
  filter: { attr: string; value: string } | null
  sub: string | null
}

function parsePath(path: string): ParsedPath {
  let rest = path.trim()
  let urn: string | null = null
  if (/^urn:/i.test(rest)) {
    if (rest.toLowerCase().startsWith(SCHEMA_ENTERPRISE.toLowerCase() + ':')) {
      urn = SCHEMA_ENTERPRISE
      rest = rest.slice(SCHEMA_ENTERPRISE.length + 1)
    } else if (rest.toLowerCase().startsWith(SCHEMA_USER.toLowerCase() + ':')) {
      rest = rest.slice(SCHEMA_USER.length + 1)
    } else throw new ScimError(400, 'invalidPath', `Unsupported path "${path}".`)
  }
  const match = /^([A-Za-z]+)(?:\[([A-Za-z]+) eq "([^"\\]*)"\])?(?:\.([A-Za-z$]+))?$/.exec(rest)
  if (!match) throw new ScimError(400, 'invalidPath', `Unsupported path "${path}".`)
  return {
    urn,
    attr: match[1]!,
    filter: match[2] ? { attr: match[2].toLowerCase(), value: match[3]!.toLowerCase() } : null,
    sub: match[4] ?? null
  }
}

const matches = (item: Json, f: { attr: string; value: string }): boolean =>
  String(
    item[Object.keys(item).find((k) => k.toLowerCase() === f.attr) ?? ''] ?? ''
  ).toLowerCase() === f.value

/** A flat view of a record (the shape of the resource) that patch operations work on, and back again. */
function toDoc(record: UserRecord): Json {
  return {
    userName: record.userName,
    externalId: record.externalId,
    active: record.active,
    displayName: record.displayName,
    name: { ...record.name },
    emails: record.emails.map((e) => ({ ...e })),
    ...structuredClone(record.extra)
  }
}

function fromDoc(doc: Json): UserRecord {
  const { userName, externalId, active, displayName, name, emails, ...extra } = doc
  const record = emptyUser()
  record.userName = userName as string
  record.externalId = externalId == null ? null : (externalId as string)
  record.active = toActive(active)
  record.displayName = displayName == null ? null : (displayName as string)
  record.name = isObject(name) ? (name as Record<string, string>) : {}
  record.emails = (emails ?? []) as Email[]
  for (const [k, v] of Object.entries(extra)) if (v !== null && v !== undefined) record.extra[k] = v
  return record
}

const READ_ONLY = ['id', 'schemas', 'meta', 'groups']

function applyOne(doc: Json, op: PatchOp): void {
  const known = [...USER_KEYS]
  if (op.path === undefined) {
    if (op.op === 'remove') throw new ScimError(400, 'noTarget', 'A remove needs a path.')
    if (!isObject(op.value))
      throw new ScimError(400, 'invalidValue', 'A value without a path must be an object.')
    for (const [key, value] of Object.entries(canonicalKeys(op.value, known))) {
      if (READ_ONLY.includes(key)) continue
      if (/^urn:/i.test(key)) {
        if (key.toLowerCase() !== SCHEMA_ENTERPRISE.toLowerCase())
          throw new ScimError(400, 'invalidPath', `Unsupported extension ${key}.`)
        applyOne(doc, { op: op.op, path: SCHEMA_ENTERPRISE, value })
      } else applyOne(doc, { op: op.op, path: key, value })
    }
    return
  }
  const p = parsePath(op.path)
  const attr = known.find((k) => k.toLowerCase() === p.attr.toLowerCase()) ?? p.attr
  if (p.urn === null && READ_ONLY.includes(attr))
    throw new ScimError(400, 'mutability', `"${attr}" cannot be changed.`)
  let target: Json = doc
  if (p.urn) {
    const ext = isObject(doc[p.urn]) ? (doc[p.urn] as Json) : {}
    doc[p.urn] = ext
    target = ext
  }
  const key =
    p.urn !== null
      ? (ENTERPRISE_KEYS.find((k) => k.toLowerCase() === p.attr.toLowerCase()) ?? p.attr)
      : attr
  if (p.urn !== null && !ENTERPRISE_KEYS.includes(key))
    throw new ScimError(400, 'invalidPath', `Unsupported path "${op.path}".`)
  // The manager has aliases: manager, manager.value, manager.$ref.
  const sub = p.sub === '$ref' && key === 'manager' ? 'value' : p.sub
  const removing = op.op === 'remove' || op.value === null
  const current = target[key]

  if (Array.isArray(current) || p.filter) {
    const list = (Array.isArray(current) ? current : []) as Json[]
    if (p.filter) {
      const hits = list.filter((item) => matches(item, p.filter!))
      if (removing) {
        const kept = list.filter((item) => !matches(item, p.filter!))
        if (sub) for (const item of hits) delete item[sub]
        else target[key] = kept
        return
      }
      if (hits.length === 0) {
        // A filtered add or replace that matches nothing creates the item, stamped with the filter's type.
        const created: Json = { [p.filter.attr]: p.filter.value }
        if (sub) created[sub] = op.value
        else if (isObject(op.value)) Object.assign(created, op.value)
        target[key] = [...list, created]
        return
      }
      for (const item of hits) {
        if (sub) item[sub] = op.value
        else if (isObject(op.value)) Object.assign(item, op.value)
      }
      return
    }
    if (removing) {
      if (sub) for (const item of list) delete item[sub]
      else delete target[key]
      return
    }
    if (sub) {
      // emails.value: change the value of the primary (or only) item.
      const item = list.find((i) => i.primary === true) ?? list[0]
      if (item) item[sub] = op.value
      else target[key] = [{ [sub]: op.value, primary: true }]
      return
    }
    const incoming = Array.isArray(op.value) ? op.value : [op.value]
    if (op.op === 'add') {
      const seen = new Set(list.map((i) => JSON.stringify(i)))
      target[key] = [...list, ...incoming.filter((i) => !seen.has(JSON.stringify(i)))]
    } else target[key] = incoming
    return
  }
  if (sub) {
    const holder = isObject(current) ? { ...current } : {}
    if (removing) delete holder[sub]
    else holder[sub] = op.value
    target[key] = holder
    return
  }
  if (removing) {
    if (key === 'userName')
      throw new ScimError(400, 'invalidValue', '"userName" cannot be removed.')
    if (key === 'active') throw new ScimError(400, 'invalidValue', '"active" cannot be null.')
    delete target[key]
    return
  }
  if (isObject(current) && isObject(op.value) && op.op === 'add')
    target[key] = { ...current, ...op.value }
  else target[key] = op.value
}

/** Apply PATCH operations in order. All or nothing: any failure throws before anything is stored. */
export function patchUser(record: UserRecord, ops: PatchOp[]): UserRecord {
  const doc = toDoc(record)
  for (const op of ops) {
    if (op.path?.toLowerCase() === 'active' && op.value === null)
      throw new ScimError(400, 'invalidValue', '"active" cannot be null.')
    applyOne(doc, op)
  }
  if (doc.active === undefined) doc.active = true
  doc.active = toActive(doc.active)
  if (doc.displayName === undefined) doc.displayName = null
  return finalizeUser(fromDoc(doc))
}

// ---------------------------------------------------------------- groups

export interface GroupInput {
  displayName: string
  externalId: string | null
  /** Ids of SCIM users. */
  members: string[]
}

function memberIds(value: unknown): string[] {
  if (!Array.isArray(value)) throw new ScimError(400, 'invalidValue', '"members" must be a list.')
  const ids = value.map((m) => {
    if (!isObject(m) || typeof m.value !== 'string' || !m.value)
      throw new ScimError(400, 'invalidValue', 'Each member needs a "value".')
    if (m.type !== undefined && String(m.type).toLowerCase() !== 'user')
      throw new ScimError(400, 'invalidValue', 'Only users can be members.')
    return m.value
  })
  return [...new Set(ids)]
}

export function groupFromBody(body: unknown, legacyEntra: boolean): GroupInput {
  if (!isObject(body)) throw new ScimError(400, 'invalidSyntax', 'The body must be a JSON object.')
  const input = canonicalKeys(body, [
    'schemas',
    'id',
    'externalId',
    'displayName',
    'members',
    'meta'
  ])
  if (
    legacyEntra &&
    Array.isArray(input.schemas) &&
    input.schemas.length === 1 &&
    input.schemas[0] === LEGACY_ENTRA_GROUP
  )
    input.schemas = [SCHEMA_GROUP]
  checkSchemas(input, SCHEMA_GROUP)
  const displayName = text(input.displayName, 'displayName', 255).trim()
  if (!displayName) throw new ScimError(400, 'invalidValue', '"displayName" is required.')
  const members = input.members == null ? [] : memberIds(input.members)
  if (members.length > MAX_GROUP_MEMBERS)
    throw new ScimError(400, 'invalidValue', 'Too many members.')
  return {
    displayName,
    externalId: input.externalId == null ? null : text(input.externalId, 'externalId', 255),
    members
  }
}

/** PATCH on a group: displayName, externalId, members (add, replace, remove, and `members[value eq "id"]`). */
export function patchGroup(group: GroupInput, ops: PatchOp[]): GroupInput {
  const next: GroupInput = { ...group, members: [...group.members] }
  for (const op of ops) {
    if (op.path === undefined) {
      if (!isObject(op.value))
        throw new ScimError(400, 'invalidValue', 'A value without a path must be an object.')
      for (const [k, v] of Object.entries(op.value)) apply(op.op, k, v)
      continue
    }
    apply(op.op, op.path, op.value)
  }
  function apply(kind: PatchOp['op'], path: string, value: unknown): void {
    const filtered = /^members\[value eq "([^"\\]*)"\]$/i.exec(path)
    const lower = path.toLowerCase()
    if (filtered) {
      if (kind !== 'remove')
        throw new ScimError(400, 'invalidPath', 'Only remove works with a members filter.')
      next.members = next.members.filter((id) => id !== filtered[1])
    } else if (lower === 'members') {
      if (kind === 'remove') {
        // With a value, remove just those; without, all.
        next.members =
          value === undefined ? [] : next.members.filter((id) => !memberIds(value).includes(id))
      } else if (kind === 'add') next.members = [...new Set([...next.members, ...memberIds(value)])]
      else next.members = memberIds(value)
    } else if (lower === 'displayname') {
      if (kind === 'remove')
        throw new ScimError(400, 'invalidValue', '"displayName" cannot be removed.')
      next.displayName = text(value, 'displayName', 255).trim()
      if (!next.displayName) throw new ScimError(400, 'invalidValue', '"displayName" is required.')
    } else if (lower === 'externalid') {
      next.externalId = kind === 'remove' || value === null ? null : text(value, 'externalId', 255)
    } else if (['id', 'meta', 'schemas'].includes(lower)) {
      throw new ScimError(400, 'mutability', `"${path}" cannot be changed.`)
    } else throw new ScimError(400, 'invalidPath', `Unsupported path "${path}".`)
  }
  if (next.members.length > MAX_GROUP_MEMBERS)
    throw new ScimError(400, 'invalidValue', 'Too many members.')
  return next
}

export function groupResource(
  row: {
    id: string
    displayName: string
    externalId: string | null
    createdAt: number
    updatedAt: number
  },
  members: { id: string; userName: string }[],
  base: string
): Json {
  return {
    schemas: [SCHEMA_GROUP],
    id: row.id,
    ...(row.externalId ? { externalId: row.externalId } : {}),
    displayName: row.displayName,
    members: members.map((m) => ({
      value: m.id,
      display: m.userName,
      type: 'User',
      $ref: `${base}/Users/${m.id}`
    })),
    meta: {
      resourceType: 'Group',
      created: new Date(row.createdAt).toISOString(),
      lastModified: new Date(row.updatedAt).toISOString(),
      location: `${base}/Groups/${row.id}`
    }
  }
}

// ---------------------------------------------------------------- list responses and selection

export function listResponse(resources: Json[], total: number, startIndex: number): Json {
  return {
    schemas: [SCHEMA_LIST],
    totalResults: total,
    startIndex,
    itemsPerPage: resources.length,
    Resources: resources
  }
}

/** `attributes` / `excludedAttributes` (top level only). `schemas` and `id` always stay. */
export function selectAttributes(
  resource: Json,
  attributes: string | undefined,
  excluded: string | undefined
): Json {
  if (attributes && excluded)
    throw new ScimError(
      400,
      'invalidValue',
      'Use either "attributes" or "excludedAttributes", not both.'
    )
  const names = (attributes ?? excluded ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase().split('.')[0]!)
    .filter(Boolean)
  if (names.length === 0) return resource
  const out: Json = {}
  for (const [key, value] of Object.entries(resource)) {
    const keep = key === 'schemas' || key === 'id'
    const listed = names.includes(key.toLowerCase())
    if (keep || (attributes ? listed : !listed)) out[key] = value
  }
  return out
}

export function parsePaging(
  startIndex: string | undefined,
  count: string | undefined
): { start: number; count: number } {
  const start = startIndex === undefined ? 1 : Number(startIndex)
  const n = count === undefined ? MAX_PAGE : Number(count)
  if (!Number.isInteger(start) || !Number.isInteger(n))
    throw new ScimError(400, 'invalidValue', '"startIndex" and "count" must be whole numbers.')
  return { start: Math.max(1, start), count: Math.min(MAX_PAGE, Math.max(0, n)) }
}

// ---------------------------------------------------------------- discovery

const attr = (name: string, extra: Json = {}): Json => ({
  name,
  type: 'string',
  multiValued: false,
  required: false,
  mutability: 'readWrite',
  returned: 'default',
  ...extra
})

export const discovery = (
  base: string
): { config: Json; schemas: Json[]; resourceTypes: Json[] } => ({
  config: {
    schemas: ['urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig'],
    patch: { supported: true },
    bulk: { supported: false, maxOperations: 0, maxPayloadSize: 0 },
    filter: { supported: true, maxResults: MAX_PAGE },
    changePassword: { supported: false },
    sort: { supported: false },
    etag: { supported: false },
    authenticationSchemes: [
      {
        type: 'oauthbearertoken',
        name: 'Bearer token',
        description: 'A token made on the team page.'
      }
    ],
    meta: { resourceType: 'ServiceProviderConfig', location: `${base}/ServiceProviderConfig` }
  },
  schemas: [
    {
      id: SCHEMA_USER,
      name: 'User',
      description: 'A person',
      attributes: [
        attr('userName', { required: true, uniqueness: 'server' }),
        attr('externalId'),
        attr('displayName'),
        attr('active', { type: 'boolean' }),
        attr('name', { type: 'complex', subAttributes: NAME_KEYS.map((n) => attr(n)) }),
        attr('emails', {
          type: 'complex',
          multiValued: true,
          subAttributes: [attr('value'), attr('type'), attr('primary', { type: 'boolean' })]
        })
      ],
      meta: { resourceType: 'Schema', location: `${base}/Schemas/${SCHEMA_USER}` }
    },
    {
      id: SCHEMA_ENTERPRISE,
      name: 'EnterpriseUser',
      description: 'Enterprise user',
      attributes: ENTERPRISE_KEYS.map((n) => attr(n)),
      meta: { resourceType: 'Schema', location: `${base}/Schemas/${SCHEMA_ENTERPRISE}` }
    },
    {
      id: SCHEMA_GROUP,
      name: 'Group',
      description: 'A group of people',
      attributes: [
        attr('displayName', { required: true }),
        attr('externalId'),
        attr('members', {
          multiValued: true,
          type: 'complex',
          subAttributes: [attr('value', { mutability: 'immutable' }), attr('type')]
        })
      ],
      meta: { resourceType: 'Schema', location: `${base}/Schemas/${SCHEMA_GROUP}` }
    }
  ],
  resourceTypes: [
    {
      schemas: ['urn:ietf:params:scim:schemas:core:2.0:ResourceType'],
      id: 'User',
      name: 'User',
      endpoint: '/Users',
      schema: SCHEMA_USER,
      schemaExtensions: [{ schema: SCHEMA_ENTERPRISE, required: false }],
      meta: { resourceType: 'ResourceType', location: `${base}/ResourceTypes/User` }
    },
    {
      schemas: ['urn:ietf:params:scim:schemas:core:2.0:ResourceType'],
      id: 'Group',
      name: 'Group',
      endpoint: '/Groups',
      schema: SCHEMA_GROUP,
      meta: { resourceType: 'ResourceType', location: `${base}/ResourceTypes/Group` }
    }
  ]
})
