/** An object's entries, with its keys as it declares them: what the emitters walk a scale by. */
export function entries<Key extends string, Value>(
  of: Readonly<Record<Key, Value>>,
): [Key, Value][] {
  return Object.entries(of) as [Key, Value][]
}
