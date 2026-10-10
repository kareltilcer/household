// The privacy centre (A-34, `/account/privacy`; PRD 05 §3, §9 and §11, D-35, D-139, D-142): the
// six rights a person has over their data, each something they do here themself. A right that
// needs an email to support is a right most people never exercise, so none of these does.
//
// Each right is named in plain words, with the regulation's own term as its subtitle (nobody
// arrives wanting to exercise Article 20), says what it is and how long it takes, and has its
// one way:
//
// - A copy of everything: asked for, listed and downloaded here, since this is the address the
//   email that says one is ready opens. It is the same list as a household's (ExportList.tsx),
//   over the account's own exports.
// - Correcting something: the account's own page. Nothing is asked of anybody.
// - Deleting the account: its own screen, which resolves each household first.
// - Stopping all changes: an owner's, of one household at a time, so it is a line for each
//   household the member owns, leading to that household's data, and a sentence that says whose
//   it is for a member who owns none. The prototype's "always all six, each a button" is not so
//   of this one: an account restricts nothing, a household's owner does.
// - Objecting: the two consents the account keeps (Consents.tsx).
// - Complaining: the authority of the member's country (Authority.tsx).
//
// What the prototype's other drawing had is left out: a second switch for crash reports, which
// is no consent the product keeps, and the phone's own permissions, which are the phone's.
//
// A-34's states. The page itself is words, and each of its three bodies is read for itself:
// *loading*, *populated*, *error* and *offline* are the exports', the consents' and the
// authorities', each in its own section, so that one that could not be read takes no other
// with it. *Absent* is what is not its reader's: the consents for a child profile, and the way
// to restrict for a member who owns no household. *Read-only* changes nothing here: every right
// on the page works whatever state a household is in (FR-BI1). *Empty* is the exports' alone;
// *withdrawn* has nothing to be, no grant standing over one's own account; nor have *pending*
// and *conflicted*, nothing here being held to be sent later.
import { Link } from 'react-router'
import { readState, useNoWithdrawal, useOwnZone } from '../account/common.ts'
import { Section, SettingsPage } from '../account/Page.tsx'
import account from '../account/Settings.module.css'
import { inHousehold, paths } from '../app/paths.ts'
import { useHouseholds } from '../household/households.ts'
import { useTranslate } from '../i18n/I18nProvider.tsx'
import { useMe } from '../session/SessionProvider.tsx'
import { Banner } from '../ui/Banner.tsx'
import { Button } from '../ui/Button.tsx'
import { useOnline } from '../ui/online.ts'
import { Skeleton } from '../ui/Skeleton.tsx'
import { StateFrame } from '../ui/StateFrame.tsx'
import { Authority } from './Authority.tsx'
import { Consents } from './Consents.tsx'
import { ExportList } from './ExportList.tsx'
import { useOwnExports } from './exports.ts'
import styles from './Privacy.module.css'

/** The households the member owns, each with the way to where its changes are stopped. */
function Owned() {
  const t = useTranslate()
  const online = useOnline()
  const withdrawn = useNoWithdrawal()
  const households = useHouseholds()
  // A suspended household opens nothing (D-115), its data among it: it is passed over, and the
  // page says once, above, that it is. Its owner is not told that they own none.
  const mine = (households.data ?? []).filter((household) => household.my_role === 'owner')
  const owned = mine.filter((household) => household.entitlement?.state !== 'suspended')
  return (
    <StateFrame
      state={readState(households, online)}
      skeleton={<Skeleton bars={[[50, 1.25]]} />}
      // A member who owns none is told whose it is, which is no empty list to teach.
      empty={null}
      texts={{
        error: {
          title: t('shell.households.error.title'),
          text: t('shell.households.error.body'),
          actions: (
            <Button
              onClick={() => {
                void households.refetch()
              }}
            >
              {t('ui.retry')}
            </Button>
          ),
        },
        withdrawn,
      }}
    >
      {() =>
        owned.length === 0 ? (
          mine.length === 0 ? (
            <p className={account.text}>{t('privacy.restrict.none')}</p>
          ) : null
        ) : (
          <ul className={styles.lines} role="list">
            {owned.map((household) => (
              <li key={household.id} className={styles.line}>
                <Link className={account.link} to={inHousehold.data(household.id)}>
                  {t('privacy.restrict.open', { household: household.name ?? '' })}
                </Link>
              </li>
            ))}
          </ul>
        )
      }
    </StateFrame>
  )
}

export function Privacy() {
  const t = useTranslate()
  const me = useMe()
  const zone = useOwnZone()
  const exports = useOwnExports()
  const atOnce = <p className={account.note}>{t('privacy.at_once')}</p>
  // A household the platform suspended answers nothing (D-115): every part of this page passes
  // it over, the archive among them, and the page says so once rather than say of its member
  // that they are in no household, or own none.
  const suspended = (useHouseholds().data ?? []).some(
    (household) => household.entitlement?.state === 'suspended',
  )

  return (
    <SettingsPage title={t('privacy.title')} lead={t('privacy.lead')}>
      {/* So when the page opened: read in its place. */}
      {suspended ? <Banner tone="neutral">{t('privacy.suspended')}</Banner> : null}
      <Section title={t('privacy.copy.title')} note={t('privacy.copy.term')}>
        <p className={account.text}>{t('privacy.copy.body')}</p>
        <ExportList
          source={exports}
          zone={zone}
          asks
          ask={t('privacy.copy.ask')}
          teaches={{
            sentence: t('privacy.copy.empty.sentence'),
            example: t('privacy.copy.empty.example'),
          }}
        />
        <p className={account.note}>{t('privacy.copy.household')}</p>
      </Section>

      <Section title={t('privacy.correct.title')} note={t('privacy.correct.term')}>
        <p className={account.text}>{t('privacy.correct.body')}</p>
        {atOnce}
        <Link className={account.link} to={paths.account.path}>
          {t('account.profile.title')}
        </Link>
      </Section>

      <Section title={t('privacy.erase.title')} note={t('privacy.erase.term')}>
        <p className={account.text}>{t('privacy.erase.body')}</p>
        <p className={account.note}>{t('privacy.erase.time')}</p>
        {me.is_child === true ? (
          // A child profile deletes nothing: an owner removes it (D-104), which it is told.
          <p className={account.text}>{t('account.delete.child')}</p>
        ) : (
          <Link className={account.link} to={paths.accountDelete.path}>
            {t('account.delete.title')}
          </Link>
        )}
      </Section>

      <Section title={t('privacy.restrict.title')} note={t('privacy.restrict.term')}>
        <p className={account.text}>{t('privacy.restrict.body')}</p>
        {atOnce}
        <Owned />
      </Section>

      <Section title={t('privacy.object.title')} note={t('privacy.object.term')}>
        <p className={account.text}>{t('privacy.object.body')}</p>
        {atOnce}
        <Consents />
      </Section>

      <Section title={t('privacy.complain.title')} note={t('privacy.complain.term')}>
        <p className={account.text}>{t('privacy.complain.body')}</p>
        <Authority />
      </Section>
    </SettingsPage>
  )
}
