// A household's exports (A-35, `/households/{id}/settings/exports`; PRD 17 §7 FR-HA15, PRD 05
// §3 FR-PR2, D-139): the whole household as one archive, asked for by an owner, made by the
// server, and downloaded by whoever asked for it. The email that says one is ready opens this
// address.
//
// An export is its requester's (D-139): the list is the reader's own, and no owner sees
// another's. So every member may open the screen and nobody reads anything that is not theirs.
// An owner asks, in every state the household can be opened in, a read-only one among them:
// asking is one of the writes the gate lets through (FR-BI1), which the screen says where the
// household takes no other. A member who is no owner is told whose it is and led to their own
// data, which is their account's; one who asked for an export while they were an owner still
// reads it listed, and that it is theirs to download no longer.
//
// What the prototype drew and the server has none of is left out: no progress bar and no time
// left, a job having a state and nothing more (ExportList.tsx); no count of what an archive
// holds beyond its size and its entries; and no one export shared by the household, which D-139
// settled against.
//
// Its states are the list's (ExportList.tsx). *Absent* is the asking, for a member who is no
// owner; *read-only* is the household that takes no other write, where this one is still taken.
import { Link } from 'react-router'
import { useFocusKept } from '../account/common.ts'
import account from '../account/Settings.module.css'
import { paths } from '../app/paths.ts'
import { useHousehold } from '../household/HouseholdContext.tsx'
import { HouseholdSettingsPage, useStanding } from '../household/settings/Page.tsx'
import { useStandingRefusal } from '../household/settings/profile.ts'
import { useTimeZone } from '../household/timezone.ts'
import { useTranslate } from '../i18n/I18nProvider.tsx'
import { Banner } from '../ui/Banner.tsx'
import { ExportList } from './ExportList.tsx'
import { useHouseholdExports } from './exports.ts'

export function Exports() {
  const t = useTranslate()
  const household = useHousehold()
  const standing = useStanding()
  const zone = useTimeZone()
  const source = useHouseholdExports(household.id)
  const refusal = useStandingRefusal()
  const view = useFocusKept(standing.owner, null)

  return (
    <HouseholdSettingsPage
      title={t('data.exports.title')}
      lead={t('data.exports.lead')}
      // Where its reader stands is said in the screen's own words, with their own way on beside
      // it: that an export is an owner's, and that one is still made in a household that takes
      // no other write. The settings' note beside that would say the first of them twice.
      note={false}
    >
      {standing.owner && !standing.writes ? (
        // So when the screen opened: read in its place.
        <Banner tone="neutral">{t('data.exports.read_only')}</Banner>
      ) : null}
      {/* Where the focus goes when the control that asks has left with its reader's being an
          owner (account/common.ts). */}
      <div ref={view} tabIndex={-1} className={account.view}>
        <ExportList
          source={source}
          zone={zone}
          asks={standing.owner}
          ask={t('data.exports.ask')}
          teaches={{
            sentence: t('data.exports.empty.sentence'),
            example: t('data.exports.empty.example'),
          }}
          instead={
            <div className={account.group}>
              <p className={account.text}>{t('data.exports.owners_only')}</p>
              <Link className={account.link} to={paths.accountPrivacy.path}>
                {t('privacy.title')}
              </Link>
            </div>
          }
          unlinked={t('data.exports.unowned')}
          standing={(error) => {
            // An owner made a member since the household was read, or a household that is
            // gone: said where it was pressed, and the household read again, which takes the
            // control away.
            const sentence = refusal(error)
            if (sentence !== undefined) void source.reread()
            return sentence
          }}
        />
      </div>
    </HouseholdSettingsPage>
  )
}
