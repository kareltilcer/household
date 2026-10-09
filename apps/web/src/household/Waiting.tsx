// The invitations that wait for the member who is signed in (FR-HH3, `getMeInvitations`): the
// ones sent to their address, once it is verified, to households they are not in. Each says who
// invited them to which household and leads to the invitation's own screen (A-24), where what it
// gives is read before it is taken or declined: nothing is accepted from a list.
//
// It is drawn where a member looks for a household to be in: above the form that makes one
// (Create.tsx), and above the households of their account (account/Account.tsx). The list is no
// part of either screen's own read: while it cannot be read, each screen draws nothing of it.
import { paths } from '../app/paths.ts'
import { useTranslate } from '../i18n/I18nProvider.tsx'
import { List, ListRow } from '../ui/ListRow.tsx'
import { useWaitingInvitations, type InvitationForInvitee } from './data.ts'
import { RowLink } from './RowLink.tsx'

/** An invitation that waits, with the token its screen opens by. */
export type Waiting = InvitationForInvitee & { readonly token: string }

/**
 * The invitations that wait for the member, or undefined while they are not read: being read,
 * unread, or not asked for at all, as for a child profile, which has no address to be invited at.
 */
export function useWaiting(asked: boolean): readonly Waiting[] | undefined {
  const { data } = useWaitingInvitations({ enabled: asked })
  if (!asked) return undefined
  return data?.flatMap((each) => (each.token === undefined ? [] : [{ ...each, token: each.token }]))
}

/**
 * Where an invitation opens: its own screen, the token in the fragment, as its email's link
 * carries it, so that it is sent to no server on the way and is in no log (auth/fragment.ts).
 */
export function invitationAddress(token: string): string {
  return `${paths.invitation.path}#${new URLSearchParams({ token }).toString()}`
}

export interface WaitingListProps {
  readonly invitations: readonly Waiting[]
}

export function WaitingList({ invitations }: WaitingListProps) {
  const t = useTranslate()
  return (
    <List label={t('account.households.waiting.title')}>
      {invitations.map((each) => {
        const household = each.household_name ?? ''
        const inviter = (each.invited_by ?? '').trim()
        return (
          <ListRow
            key={each.token}
            title={
              inviter === ''
                ? t('account.households.waiting.row_unnamed', { household })
                : t('account.households.waiting.row', { inviter, household })
            }
            trailing={
              <RowLink
                to={invitationAddress(each.token)}
                name={t('account.households.waiting.open_named', { household })}
                word={t('account.households.waiting.open')}
              />
            }
          />
        )
      })}
    </List>
  )
}
