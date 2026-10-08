// The household switcher (A-36, 04-navigation §6), at the head of the sidebar: which household
// the member is in is in the address and nowhere else (D-4), so it is stated here on every
// screen, with the member's role in it, and switching is going to another household's address:
// one event, by which the modules, the grants, the banner, the timezone and the currency all
// change together.
//
// It lists the households the member belongs to and no other. A household whose subscription
// has lapsed stays in the list with its state in a word, and can be entered: that is how its
// payer reaches its billing. With one membership there is nothing to switch between, and the
// name is a label and no control.
import { useNavigate } from 'react-router'
import { inHousehold } from '../app/paths.ts'
import { useHousehold } from '../household/HouseholdContext.tsx'
import {
  useHouseholds,
  type EntitlementState,
  type HouseholdRole,
  type HouseholdSummary,
} from '../household/households.ts'
import { useTranslate } from '../i18n/I18nProvider.tsx'
import a11y from '../ui/a11y.module.css'
import { Button } from '../ui/Button.tsx'
import { Menu } from '../ui/Menu.tsx'
import styles from './Sidebar.module.css'

/** The states a household is named with beside its name: those in which something is held back. */
const stated: ReadonlySet<EntitlementState> = new Set<EntitlementState>([
  'grace',
  'read_only',
  'restricted',
  'canceled',
  'suspended',
])

export function useRoleWord(): (role: HouseholdRole | undefined) => string {
  const t = useTranslate()
  return (role) => {
    switch (role) {
      case 'owner':
        return t('shell.role.owner')
      case 'child':
        return t('shell.role.child')
      case 'member':
      case undefined:
        return t('shell.role.member')
    }
  }
}

function useStateWord(): (state: EntitlementState | undefined) => string | undefined {
  const t = useTranslate()
  return (state) => {
    if (state === undefined || !stated.has(state)) return undefined
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
      default:
        return undefined
    }
  }
}

export function Switcher() {
  const t = useTranslate()
  const navigate = useNavigate()
  const household = useHousehold()
  const households = useHouseholds()
  const roleWord = useRoleWord()
  const stateWord = useStateWord()
  const role = roleWord(household.my_role)
  const others = (households.data ?? []).filter((other) => other.id !== household.id)

  const named = (other: HouseholdSummary): string => {
    const name = other.name ?? ''
    const state = stateWord(other.entitlement?.state)
    return state === undefined
      ? t('shell.switcher.item', { name, role: roleWord(other.my_role) })
      : t('shell.switcher.item_state', { name, role: roleWord(other.my_role), state })
  }

  // The household the member is standing in is drawn at once, from the address: opening the
  // switcher never blanks it. With no other to go to, it is a label.
  if (others.length === 0) {
    return (
      <div className={styles.switcher}>
        <p className={styles.household}>{household.name}</p>
        <p className={styles.role}>{role}</p>
        {households.isError ? (
          <p className={styles.role} role="status">
            {t('shell.switcher.error')}
          </p>
        ) : null}
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
            void navigate(inHousehold.home(other.id), { state: { switched: true } })
          },
        }))}
      />
      <p className={styles.role}>{role}</p>
    </div>
  )
}
