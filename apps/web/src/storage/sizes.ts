// How a size is said on the storage screen: in the decimal units storage is sold in, a gigabyte
// being a thousand million bytes (PRD 04 §4), and through `Intl`, which writes the unit as the
// member's language does. No size is a word of a message: a caller formats one here and passes
// the string.
import { useCallback } from 'react'
import { useFormat } from '../i18n/I18nProvider.tsx'

const kilobyte = 1000
const megabyte = 1000 * kilobyte
const gigabyte = 1000 * megabyte

/**
 * A count of bytes as a member reads it, in the largest unit it fills one of and to one decimal
 * place: *19.4 GB*, *412 MB*. Nothing at all is said in the unit a plan is sold in, *0 GB*.
 */
export function useSize(): (bytes: number) => string {
  const format = useFormat()
  return useCallback(
    (bytes) => {
      const [unit, size] =
        bytes >= gigabyte || bytes === 0
          ? (['gigabyte', gigabyte] as const)
          : bytes >= megabyte
            ? (['megabyte', megabyte] as const)
            : (['kilobyte', kilobyte] as const)
      return format.number(bytes / size, { style: 'unit', unit, maximumFractionDigits: 1 })
    },
    [format],
  )
}
