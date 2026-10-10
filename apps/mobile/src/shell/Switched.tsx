// A link that opened another household than the one that was on screen (F-16, 04-navigation §8,
// the wrong-household case). The household is in the address (D-4), so opening the link is the
// switch: it needs no step of its own. What it needs is to be said, since everything else on
// screen changed with it, the modules, the grants, the bars, the timezone and the currency, and
// one control that goes back.
//
// Whether a link made the switch is the links' to know (links/switched.ts): the first household
// the app opens is no switch, and neither is one its member chose themselves, by this banner's
// own way back among them. This file draws what they found, above the household's screens, and
// says it aloud as it arrives.
import { router, useIsFocused } from 'expo-router'
import { inHousehold } from '../app/paths.ts'
import { useHouseholds } from '../household/data.ts'
import { useTranslate } from '../i18n/I18nProvider.tsx'
import { dismissSwitched, useSwitchedByLink } from '../links/switched.ts'
import { sameId } from '../session/context.ts'
import { Banner } from '../ui/Banner.tsx'
import { Button } from '../ui/Button.tsx'

export interface SwitchedBannerProps {
  /** The name of the household that was on screen before the link: where *back* leads. */
  readonly from: string
  readonly onBack: () => void
  readonly onDismiss: () => void
  /** Whether it is said as it arrives. Left out, it is: a dev screen draws one that arrived with it. */
  readonly announce?: boolean
}

/** The notice itself: that the household changed, the way back, and the control that puts it away. */
export function SwitchedBanner({ from, onBack, onDismiss, announce = true }: SwitchedBannerProps) {
  const t = useTranslate()
  return (
    <Banner
      testID="switched"
      tone="info"
      announce={announce}
      onDismiss={onDismiss}
      actions={
        <Button
          testID="switched:back"
          onPress={() => {
            onBack()
          }}
        >
          {t('shell.switched.back', { household: from })}
        </Button>
      }
    >
      {t('shell.switched.body')}
    </Banner>
  )
}

export interface SwitchedProps {
  /** The household whose frame this is drawn in. */
  readonly household: string
}

export function Switched({ household }: SwitchedProps) {
  // A stack keeps the household a link was opened over underneath this one, and its frame is
  // drawn again, with no link, when its member goes back to it: only the frame in front says
  // that its household is the one on screen.
  const switched = useSwitchedByLink(household, useIsFocused())
  const households = useHouseholds()
  // The household that was on screen is named only where it is this member's still, and opens:
  // one they have left since is named to nobody, and the way back to one suspended since would
  // open no household (D-115).
  const previous =
    switched === null
      ? undefined
      : households.data?.find(
          ({ id, entitlement }) => sameId(id, switched.from) && entitlement?.state !== 'suspended',
        )
  if (previous === undefined) return null
  return (
    <SwitchedBanner
      from={previous.name ?? ''}
      onBack={() => {
        // The member's own choice, and no link: nothing is said of this switch.
        router.navigate(inHousehold.home(previous.id))
      }}
      onDismiss={dismissSwitched}
    />
  )
}
