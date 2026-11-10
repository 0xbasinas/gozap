import { useEffect, useState, type FormEvent, type JSX } from 'react'
import { Button } from '@repo/ui'

interface Todo {
  id: string
  title: string
  done: boolean
  author: string
  mine: boolean
  canRemove: boolean
}

async function failure(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as { error?: string } | null
  return body?.error ?? 'That did not work.'
}

/**
 * A small to-do list that belongs to the active workspace, to try the workspace switcher with. The API decides whose
 * list you see; this component asks again when the workspace changes (`workspaceKey`).
 */
export function TodosSection({
  workspaceKey,
  workspaceName
}: {
  workspaceKey: string
  workspaceName: string
}): JSX.Element {
  const [todos, setTodos] = useState<Todo[] | null>(null)
  const [canWrite, setCanWrite] = useState(true)
  const [title, setTitle] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [reload, setReload] = useState(0)

  useEffect(() => {
    let cancelled = false
    void fetch('/api/todos', { credentials: 'same-origin' })
      .then(async (response) =>
        response.ok
          ? ((await response.json()) as { todos: Todo[]; workspace: { canWrite: boolean } })
          : null
      )
      .catch(() => null)
      .then((found) => {
        if (cancelled) return
        setTodos(found?.todos ?? null)
        setCanWrite(found?.workspace.canWrite ?? true)
      })
    return () => {
      cancelled = true
    }
  }, [workspaceKey, reload])

  async function send(path: string, init: RequestInit): Promise<boolean> {
    const response = await fetch(`/api/todos${path}`, { credentials: 'same-origin', ...init })
    setError(response.ok ? null : await failure(response))
    setReload((n) => n + 1)
    return response.ok
  }

  async function add(event: FormEvent): Promise<void> {
    event.preventDefault()
    if (!title.trim()) return
    const ok = await send('', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title })
    })
    if (ok) setTitle('')
  }

  return (
    <section aria-label="To-do list" className="space-y-3">
      <h2 className="text-lg font-semibold">To-do list: {workspaceName}</h2>
      {!canWrite && (
        <p className="text-sm text-muted-foreground">You can read this list but not change it.</p>
      )}
      <form onSubmit={(e) => void add(e)} className="flex gap-2" hidden={!canWrite}>
        <input
          aria-label="New to-do"
          placeholder={
            workspaceName === 'Personal' ? 'Only you can see this list' : 'Shared with the team'
          }
          value={title}
          maxLength={200}
          onChange={(e) => setTitle(e.target.value)}
          className="h-9 w-full max-w-md rounded-md border border-input bg-background px-3 text-sm"
        />
        <Button type="submit" variant="outline">
          Add
        </Button>
      </form>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {todos?.length === 0 && <p className="text-sm text-muted-foreground">Nothing to do yet.</p>}
      {todos && todos.length > 0 && (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {todos.map((t) => (
            <li key={t.id} className="flex items-center justify-between gap-3 p-3 text-sm">
              <label className="flex min-w-0 items-center gap-2">
                <input
                  type="checkbox"
                  disabled={!canWrite}
                  checked={t.done}
                  onChange={(e) =>
                    void send(`/${encodeURIComponent(t.id)}`, {
                      method: 'PATCH',
                      headers: { 'content-type': 'application/json' },
                      body: JSON.stringify({ done: e.target.checked })
                    })
                  }
                />
                <span
                  className={t.done ? 'truncate text-muted-foreground line-through' : 'truncate'}
                >
                  {t.title}
                </span>
                {!t.mine && <span className="text-xs text-muted-foreground">{t.author}</span>}
              </label>
              {canWrite && t.canRemove && (
                <Button
                  variant="outline"
                  size="sm"
                  aria-label={`Remove ${t.title}`}
                  onClick={() => void send(`/${encodeURIComponent(t.id)}`, { method: 'DELETE' })}
                >
                  Remove
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
