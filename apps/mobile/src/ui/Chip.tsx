// The module chip and the member avatar (02-components §1), as the list row and the search result
// row carry them. A module chip is the module's accent, its glyph and its name: the accent is the
// glyph's and the rule's, never the name's ink, and never the only thing that tells two modules
// apart. An avatar is a member's initials inside a ring of their colour, and a portrait their
// picture, which the avatar stands in for where there is none to draw.
import { accentToken, remPx, type ModuleId } from '@household/tokens'
import type { ColorName } from '@household/tokens/native'
import { useState } from 'react'
import { Image, View } from 'react-native'
import { useDisplay, useTheme } from '../display/DisplayProvider.tsx'
import { useTranslate } from '../i18n/I18nProvider.tsx'
import { ModuleIcon } from './Icon.tsx'
import { Text } from './Text.tsx'

export function ModuleChip({ module }: { readonly module: ModuleId }) {
  const t = useTranslate()
  const theme = useTheme()
  const accent = accentToken(module)
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        alignSelf: 'flex-start',
        maxWidth: '100%',
        gap: theme.space['space-05'],
        paddingHorizontal: theme.space['space-1'],
        borderWidth: 1,
        borderColor: theme.color[accent],
        borderRadius: theme.radii['radius-pill'],
      }}
    >
      <ModuleIcon module={module} size={16} color={accent} />
      <Text step="caption" style={{ flexShrink: 1 }}>
        {t(`module.${module}.name`)}
      </Text>
    </View>
  )
}

/** A member's colour in this household: one of the eight series colours, assigned once. */
export type MemberTone = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8

/** The series colour a tone's ring is drawn in. */
const rings: Readonly<Record<MemberTone, ColorName>> = {
  1: 'chart-1',
  2: 'chart-2',
  3: 'chart-3',
  4: 'chart-4',
  5: 'chart-5',
  6: 'chart-6',
  7: 'chart-7',
  8: 'chart-8',
}

/** How wide and high an avatar is at a text scale of one, in rem: it grows with its initials. */
const avatarRem = 2.25

export interface AvatarProps {
  /** The member's initials. Decoration beside their name; `name` is said where there is none. */
  readonly initials: string
  readonly tone: MemberTone
  /** The member's name, for an avatar that stands alone. */
  readonly name?: string
}

export function Avatar({ initials, tone, name }: AvatarProps) {
  const theme = useTheme()
  const { textScale } = useDisplay()
  const size = avatarRem * remPx * textScale
  return (
    <View
      {...(name === undefined
        ? ({
            accessibilityElementsHidden: true,
            importantForAccessibility: 'no-hide-descendants',
          } as const)
        : ({ accessible: true, accessibilityRole: 'image', accessibilityLabel: name } as const))}
      // Initials in the screen's ink on a sunken ground, inside a ring of the member's colour: a
      // series colour is tested against that ground, and carries no text.
      style={{
        width: size,
        height: size,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: theme.color['surface-sunken'],
        borderWidth: 2,
        borderColor: theme.color[rings[tone]],
        borderRadius: theme.radii['radius-full'],
      }}
    >
      <Text step="caption" weight={600}>
        {initials}
      </Text>
    </View>
  )
}

/** The first letters of a name's first two words: what stands where a member has no picture. */
export function initialsOf(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => (Array.from(word)[0] ?? '').toLocaleUpperCase())
    .join('')
}

export interface PortraitProps {
  /** The picture's link, or null for a member who has none. */
  readonly address: string | null
  /** The member's name, whose initials stand where the picture does not. */
  readonly name: string
  readonly tone?: MemberTone
}

/**
 * A member's picture, which gives way to their initials where it has no link or its link no
 * longer loads. It is as large as the avatar it gives way to, and round as it is.
 */
export function Portrait({ address, name, tone = 1 }: PortraitProps) {
  const theme = useTheme()
  const { textScale } = useDisplay()
  // A picture's link is good for minutes (D-9), and whose it is may be read from what this
  // device kept: a link that no longer loads gives way to the initials, and is no broken image.
  const [failed, setFailed] = useState<string | null>(null)
  if (address !== null && failed !== address) {
    const size = avatarRem * remPx * textScale
    return (
      <Image
        source={{ uri: address }}
        // Decoration: the member's name is written beside it, or is the screen's own title.
        accessible={false}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        onError={() => {
          setFailed(address)
        }}
        style={{ width: size, height: size, borderRadius: theme.radii['radius-full'] }}
      />
    )
  }
  return <Avatar initials={initialsOf(name)} tone={tone} />
}
