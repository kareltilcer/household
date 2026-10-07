/** The class names that are set, joined: `cx(styles.row, compact && styles.compact)`. */
export function cx(...names: readonly (string | false | null | undefined)[]): string {
  let joined = ''
  for (const name of names) {
    if (typeof name === 'string' && name !== '') joined += joined === '' ? name : ` ${name}`
  }
  return joined
}
