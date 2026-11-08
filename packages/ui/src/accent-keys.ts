/** Where the arrow keys, Home and End move the selection in a radio group of `count` items (undefined: not a navigation key). */
export function nextAccentIndex(current: number, key: string, count: number): number | undefined {
  switch (key) {
    case 'ArrowRight':
    case 'ArrowDown':
      return (current + 1) % count
    case 'ArrowLeft':
    case 'ArrowUp':
      return (current - 1 + count) % count
    case 'Home':
      return 0
    case 'End':
      return count - 1
    default:
      return undefined
  }
}
