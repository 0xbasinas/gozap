import { Fragment } from 'react'

// A tiny Markdown renderer for release notes: headings, bullet lists, bold, `code`, links and rules.
// It builds React elements (never raw HTML), and only https links become clickable.

const INLINE = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)\s]+\))/

function renderInline(text: string): React.ReactNode[] {
  return text
    .split(INLINE)
    .filter(Boolean)
    .map((part, index) => {
      if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
        return <strong key={index}>{part.slice(2, -2)}</strong>
      }
      if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
        return (
          <code key={index} className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]">
            {part.slice(1, -1)}
          </code>
        )
      }
      const link = part.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/)
      if (link) {
        return /^https:\/\//i.test(link[2]) ? (
          <a key={index} href={link[2]} target="_blank" rel="noreferrer" className="underline">
            {link[1]}
          </a>
        ) : (
          <Fragment key={index}>{link[1]}</Fragment>
        )
      }
      return <Fragment key={index}>{part}</Fragment>
    })
}

export function Markdown({ source }: { source: string }): React.JSX.Element {
  const blocks: React.ReactNode[] = []
  let list: string[] = []

  const flushList = (): void => {
    if (!list.length) return
    blocks.push(
      <ul key={`ul-${blocks.length}`} className="list-disc space-y-1 pl-5">
        {list.map((item, i) => (
          <li key={i}>{renderInline(item)}</li>
        ))}
      </ul>
    )
    list = []
  }

  for (const raw of source.split(/\r?\n/)) {
    const line = raw.trim()
    if (/^[-*] /.test(line)) {
      list.push(line.slice(2))
      continue
    }
    flushList()
    if (!line) continue
    const key = `b-${blocks.length}`
    if (/^---+$/.test(line)) {
      blocks.push(<hr key={key} className="my-2" />)
    } else if (line.startsWith('### ')) {
      blocks.push(
        <h3 key={key} className="pt-2 text-sm font-semibold">
          {renderInline(line.slice(4))}
        </h3>
      )
    } else if (/^##? /.test(line)) {
      blocks.push(
        <h2 key={key} className="text-base font-semibold">
          {renderInline(line.replace(/^##? /, ''))}
        </h2>
      )
    } else {
      blocks.push(<p key={key}>{renderInline(line)}</p>)
    }
  }
  flushList()

  return <div className="space-y-2 text-sm leading-relaxed">{blocks}</div>
}
