import { Button, cn } from '@repo/ui'

interface Props extends React.ComponentProps<typeof Button> {
  label: string
  active?: boolean
}

/** Small icon button for the title bar, with a tooltip and an accessible name. */
export function TitleBarButton({ label, active, className, ...props }: Props): React.JSX.Element {
  return (
    <Button
      variant="ghost"
      size="icon"
      title={label}
      aria-label={label}
      className={cn(
        'size-7 [&_svg]:size-4',
        active && 'bg-accent text-accent-foreground',
        className
      )}
      {...props}
    />
  )
}
