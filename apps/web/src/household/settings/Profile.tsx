// The household's profile (C-49, `/households/{id}/settings`; PRD 17 §1, FR-HA1; PRD 02 §6):
// what the household is called and where it is, the language its shared words are in, its
// units, the day its week starts on, what its money is counted in, and for its owners the code a
// child profile signs in with. Every member reads it, whatever they hold on household settings
// (D-167); an owner changes it, in a household that takes writes, and what stands above it says
// which of the two its reader is (Page.tsx).
//
// Two first days of the week exist, and the screen says which this one is: the household's,
// which a member's own setting on their account wins over on their own screens. The language is
// said the same way: it is what the household's shared words and its emails are in, and the
// language of a member's app is their own.
//
// What no operation of the contract does is absent, and not drawn as a control that does
// nothing. The household has no picture to set. What its money is counted in is read and not
// changed: the server refuses a change of it until its recomputation is built (FR-HA2, plan
// item 62). And a change is asked of the server at once or not at all (D-170): the prototype's
// "saved on this phone" is not built.
//
// C-49's states. The household itself is read before this screen is drawn, by the shell, so
// *loading* and *error* are the countries' and the members': the country is named by its code
// until its name is read, the way to move it is absent until there is somewhere to move it to,
// and who needs the code is left out until the members are read. Nothing waits on either.
// *Populated* is the page. *Offline* reads as online does, from what this browser kept, and a
// save says it could not reach the server and changed nothing. *Pending* has nothing to be:
// nothing is held to be sent later. *Syncing* is a save under way, its control busy.
// *Conflicted* is a save refused because somebody else changed the household meanwhile: the
// panel stays open on what was typed and says so, over a page that shows how it stands.
// *Rejected* is a refusal said beside the field it is of, or under the form. *Withdrawn* is an
// owner made a member while the screen was open: the controls leave when the household is read
// again, and a change pressed before then is answered `403`, which is said on the page.
// *Read-only* draws no control that changes anything, and the household's banner above the
// screen says why (shell/EntitlementBanner.tsx). *Empty* and
// *absent* have nothing to be: a household always has a name, a country and a currency, and
// every member may read them.
import { matchLocale } from '@household/i18n/lazy'
import { useState } from 'react'
import { Link } from 'react-router'
import { useData, useFocusKept, useSaid } from '../../account/common.ts'
import styles from '../../account/Settings.module.css'
import { inHousehold, paths } from '../../app/paths.ts'
import { useFormat, useTranslate } from '../../i18n/I18nProvider.tsx'
import { dayName, ownName } from '../../i18n/names.ts'
import { DeletionNotice } from '../../privacy/DeletionNotice.tsx'
import { Banner } from '../../ui/Banner.tsx'
import { Button } from '../../ui/Button.tsx'
import { KeyValue } from '../../ui/KeyValue.tsx'
import { useCountries, useLocalized, useReread } from '../data.ts'
import { useHousehold } from '../HouseholdContext.tsx'
import { HouseholdSettingsPage, Section, useStanding } from './Page.tsx'
import { HouseholdCode, RenewCode } from './ProfileCode.tsx'
import { EditHousehold, MoveCountry } from './ProfileEdit.tsx'

/** What the screen has open over itself: one of its two panels, the confirmation, or nothing. */
type Open = 'edit' | 'country' | 'code' | null

export function Profile() {
  const t = useTranslate()
  const format = useFormat()
  const given = useData()
  const localized = useLocalized()
  const household = useHousehold()
  const { changes } = useStanding()
  const countries = useCountries()
  const reread = useReread(household.id)
  const [open, setOpen] = useState<Open>(null)
  const [said, say] = useSaid()
  const view = useFocusKept(changes, open)

  const country = countries.data?.find((each) => each.code === household.country)
  // By its code until its name is read: nothing waits on the countries.
  const now = country === undefined ? household.country : localized(country.name)
  const others = (countries.data ?? []).filter((each) => each.code !== household.country)
  const code = household.join_code
  const firstDay = household.first_day_of_week

  const show = (next: Open) => {
    // What an earlier change came to is said no longer once another is begun.
    say(null)
    setOpen(next)
  }
  const close = () => {
    setOpen(null)
  }
  // Refused for where the member now stands: said on the page, which is read again and then
  // draws no control for them.
  const ended = (text: string) => {
    setOpen(null)
    say(text)
    void reread()
  }

  return (
    <HouseholdSettingsPage title={t('household.settings.profile.title')}>
      {said === null ? null : (
        <Banner key={said.id} tone="danger" announce>
          {said.text}
        </Banner>
      )}
      {/* A deletion that is scheduled is said on the screen every member opens first (D-138),
          with the control that keeps the household for an owner. */}
      <DeletionNotice after={view} />
      {/* Where the focus goes when the controls that held it have left (account/common.ts). */}
      <div ref={view} tabIndex={-1} className={styles.view}>
        <Section title={t('household.profile.household.title')}>
          <KeyValue
            pairs={[
              { key: t('household.profile.field.name'), value: household.name },
              { key: t('household.profile.field.country'), value: now },
              { key: t('household.profile.field.timezone'), value: given(household.timezone) },
              {
                key: t('household.profile.field.language'),
                // The one its words are in: a language Household does not ship reads English.
                value: given(ownName(matchLocale([household.locale]))),
              },
              {
                key: t('household.profile.field.units'),
                value:
                  household.units === undefined
                    ? undefined
                    : household.units === 'imperial'
                      ? t('household.profile.units.imperial')
                      : t('household.profile.units.metric'),
              },
              {
                key: t('household.profile.field.week'),
                value: firstDay === undefined ? undefined : given(dayName(format.locale, firstDay)),
              },
              { key: t('household.profile.field.money'), value: household.base_currency },
            ]}
          />
          <p className={styles.note}>{t('household.profile.note.language')}</p>
          <p className={styles.note}>{t('household.profile.note.week')}</p>
          <Link className={styles.link} to={paths.account.path}>
            {t('household.profile.account')}
          </Link>
          {changes ? (
            <div className={styles.actions}>
              <Button
                onClick={() => {
                  show('edit')
                }}
              >
                {t('household.profile.edit.title')}
              </Button>
              {others.length === 0 ? null : (
                <Button
                  onClick={() => {
                    show('country')
                  }}
                >
                  {t('household.profile.country.title')}
                </Button>
              )}
            </div>
          ) : null}
        </Section>
      </div>

      {code === undefined ? null : (
        <HouseholdCode
          code={code}
          onRenew={
            changes
              ? () => {
                  show('code')
                }
              : undefined
          }
        />
      )}

      {/* A child profile leaves nothing: an owner removes it (D-104). */}
      {household.my_role === 'child' ? null : (
        <Section title={t('household.profile.you.title')}>
          <p className={styles.note}>{t('household.profile.leave.note')}</p>
          <Link className={styles.link} to={inHousehold.leave(household.id)}>
            {t('household.leave.title', { household: household.name })}
          </Link>
        </Section>
      )}

      {open === 'edit' ? <EditHousehold onClose={close} onEnded={ended} /> : null}
      {open === 'country' ? (
        <MoveCountry others={others} now={now} onClose={close} onEnded={ended} />
      ) : null}
      {open === 'code' && code !== undefined ? (
        <RenewCode code={code} onClose={close} onEnded={ended} />
      ) : null}
    </HouseholdSettingsPage>
  )
}
