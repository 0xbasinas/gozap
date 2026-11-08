import type { JSX } from 'react'
import { SUBPROCESSORS, SUBPROCESSORS_UPDATED } from '../config'

/** Who handles personal data on our behalf, why, and where. The list itself lives in config.ts. */
export function SubprocessorsPage(): JSX.Element {
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold tracking-tight">Sub-processors</h1>
      <p className="text-muted-foreground">
        These companies help us run the service, and so handle some personal data for us. Last
        updated {SUBPROCESSORS_UPDATED}.
      </p>
      <ul className="space-y-3">
        {SUBPROCESSORS.map((p) => (
          <li key={p.name} className="rounded-lg border border-border p-4">
            <h2 className="font-medium">{p.name}</h2>
            <dl className="mt-2 grid gap-1 text-sm sm:grid-cols-[8rem_1fr]">
              <dt className="text-muted-foreground">What for</dt>
              <dd>{p.purpose}</dd>
              <dt className="text-muted-foreground">Data</dt>
              <dd>{p.data}</dd>
              <dt className="text-muted-foreground">Where</dt>
              <dd>{p.region}</dd>
            </dl>
          </li>
        ))}
      </ul>
    </div>
  )
}
