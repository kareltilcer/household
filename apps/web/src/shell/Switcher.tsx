// The household switcher (A-36, 04-navigation §6), at the head of the sidebar: which household
// the member is in is in the address and nowhere else (D-4), so it is stated here on every
// screen, with the member's role in it, and switching is going to another household's address:
// one event, by which the modules, the grants, the banner, the timezone and the currency all
// change together.
//
// It lists the households the member belongs to and no other. A household whose subscription
// has lapsed stays in the list with its state in a word, and can be entered: that is how its
// payer reaches its billing. One the platform suspended stays in it too, with its word, and
// entering it opens its lockout (D-162, Lockout.tsx). The household that is open is named with
// its word as the others are, beside the member's role in it: the banner above its screens
// says the rest. With one membership there is nothing to switch between, and the name is a
// label and no control. The household the member stands in is drawn from the address at once:
// opening the switcher never blanks it, and where the others could not be read it says so in a
// line and the one that is open is as it was.
import { useNavigate } from 'react-router'
import { inHousehold } from '../app/paths.ts'
import { useHousehold } from '../household/HouseholdContext.tsx'
import {
  useHouseholds,
  useRoleWord,
  type EntitlementState,
  type Household,
  type HouseholdSummary,
} from '../household/households.ts'
import { useTranslate } from '../i18n/I18nProvider.tsx'
import a11y from '../ui/a11y.module.css'
import { Button } from '../ui/Button.tsx'
import { Menu } from '../ui/Menu.tsx'
import styles from './Sidebar.module.css'

/**
 * The word a household is named with beside its name, for a state in which something is held
 * back: a word, and no lock glyph. A household that is trialing or paid for is named with none,
 * and so is one that is past due, which holds nothing back and is its owners' alone to know
 * (PRD 04 §6).
 */
function useStateWord(): (state: EntitlementState | undefined) => string | undefined {
  const t = useTranslate()
  return (state) => {
    switch (state) {
      case 'grace':
        return t('shell.entitlement.grace')
      case 'read_only':
        return t('shell.entitlement.read_only')
      case 'restricted':
        return t('shell.entitlement.restricted')
      case 'canceled':
        return t('shell.entitlement.canceled')
      case 'suspended':
        return t('shell.entitlement.suspended')
      case 'trialing':
      case 'active':
      case 'past_due':
      case undefined:
        return undefined
    }
  }
}

export interface SwitcherViewProps {
  /** The household that is open. */
  readonly household: Pick<Household, 'id' | 'name' | 'my_role' | 'entitlement'>
  /** The member's other households, in the server's order. */
  readonly others: readonly HouseholdSummary[]
  /** Whether the member's households could not be read. */
  readonly failed: boolean
  /** Goes to `household`: one event, by which everything of a household changes together. */
  readonly onSwitch: (household: string) => void
}

export function SwitcherView({ household, others, failed, onSwitch }: SwitcherViewProps) {
  const t = useTranslate()
  const roleWord = useRoleWord()
  const stateWord = useStateWord()
  const own = stateWord(household.entitlement?.state)
  const role =
    own === undefined
      ? roleWord(household.my_role)
      : t('shell.switcher.role_state', { role: roleWord(household.my_role), state: own })

  const named = (other: HouseholdSummary): string => {
    const name = other.name ?? ''
    const state = stateWord(other.entitlement?.state)
    return state === undefined
      ? t('shell.switcher.item', { name, role: roleWord(other.my_role) })
      : t('shell.switcher.item_state', { name, role: roleWord(other.my_role), state })
  }

  if (others.length === 0) {
    return (
      <div className={styles.switcher}>
        <p className={styles.household}>{household.name}</p>
        <p className={styles.role}>{role}</p>
        {failed ? <p className={styles.role}>{t('shell.switcher.error')}</p> : null}
      </div>
    )
  }
  return (
    <div className={styles.switcher}>
      <Menu
        trigger={
          <Button variant="secondary" className={styles.switch}>
            {/* Named by what it does and where the member is; drawn as the household's name. */}
            <span className={a11y.visuallyHidden}>
              {t('a11y.control.switch_household', { household: household.name })}
            </span>
            <span aria-hidden="true">{household.name}</span>
          </Button>
        }
        items={others.map((other) => ({
          id: other.id,
          label: named(other),
          onSelect: () => {
            onSwitch(other.id)
          },
        }))}
      />
      <p className={styles.role}>{role}</p>
    </div>
  )
}

/** What a navigation carries when the member chose the household themselves (Switched.tsx). */
export const switchedByMember = { switched: true } as const

export function Switcher() {
  const navigate = useNavigate()
  const household = useHousehold()
  const households = useHouseholds()
  return (
    <SwitcherView
      household={household}
      others={(households.data ?? []).filter((other) => other.id !== household.id)}
      // Could not be read, with nothing kept of them: a read that failed, or one that waits for
      // a connection. A list this browser kept stands, whatever became of asking for it again.
      failed={
        households.data === undefined && (households.isError || households.fetchStatus === 'paused')
      }
      onSwitch={(to) => {
        void navigate(inHousehold.home(to), { state: switchedByMember })
      }}
    />
  )
}
