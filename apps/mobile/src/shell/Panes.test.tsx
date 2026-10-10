// Two panes (04-navigation §7): at a phone's width, a tablet's, and a tablet's at twice the text.
// No module draws its screens in them yet, so this and the dev screen are what hold them.
import { describe, expect, it } from '@jest/globals'
import { catalogs } from '@household/i18n'
import { screen } from '@testing-library/react-native'
import { View } from 'react-native'
import { expectAccessible } from '../test/a11y.ts'
import { render, styleOf } from '../test/render.tsx'
import { Panes, useBesideList } from './Panes.tsx'

/** A phone held upright, and a tablet. */
const phone = 390
const tablet = 834

const list = <View testID="list" />

/** What was opened from the list, which says whether the list is still beside it. */
function Detail() {
  return <View testID={useBesideList() ? 'detail:beside' : 'detail:alone'} />
}

const empty = catalogs.en['device.shell.panes.empty']

describe('two panes', () => {
  it('are one on a phone: the list, with nothing drawn of a second', async () => {
    await render(<Panes list={list} detail={null} width={phone} />)
    expect(screen.getByTestId('panes:one')).toBeOnTheScreen()
    expect(screen.getByTestId('list')).toBeOnTheScreen()
    expect(screen.queryByText(empty)).toBeNull()
  })

  it('are one on a phone: what was opened takes the list’s place, and leads back to it', async () => {
    await render(<Panes list={list} detail={<Detail />} width={phone} />)
    expect(screen.getByTestId('detail:alone')).toBeOnTheScreen()
    expect(screen.queryByTestId('list')).toBeNull()
  })

  it('stand side by side on a tablet, the list and what is selected in it', async () => {
    await render(<Panes list={list} detail={<Detail />} width={tablet} />)
    expect(screen.getByTestId('panes:two')).toBeOnTheScreen()
    expect(screen.getByTestId('list')).toBeOnTheScreen()
    // The list is still beside it: its bar has no way back to draw.
    expect(screen.getByTestId('detail:beside')).toBeOnTheScreen()
    expect(styleOf('panes:two')).toMatchObject({ flexDirection: 'row' })
    expect(styleOf('panes:list')).toMatchObject({ width: '44%' })
    expect(styleOf('panes:detail')).toMatchObject({ flex: 1 })
  })

  it('say so where nothing is selected on a tablet', async () => {
    await render(<Panes list={list} detail={null} width={tablet} />)
    expect(screen.getByTestId('list')).toBeOnTheScreen()
    expect(screen.getByText(empty)).toBeOnTheScreen()
    expectAccessible()
  })

  // The room is counted in the reader's text: a tablet at twice the text has a phone's.
  it('are one on a tablet at twice the text', async () => {
    const view = await render(<Panes list={list} detail={<Detail />} width={tablet} />, {
      scale: 2,
    })
    expect(screen.getByTestId('panes:one')).toBeOnTheScreen()
    expect(screen.getByTestId('detail:alone')).toBeOnTheScreen()
    expect(screen.queryByTestId('list')).toBeNull()
    await view.unmount()
    await render(<Panes list={list} detail={null} width={tablet} />, { scale: 2 })
    expect(screen.getByTestId('list')).toBeOnTheScreen()
    expect(screen.queryByText(empty)).toBeNull()
  })

  it('begin at 744 pt of room', async () => {
    const view = await render(<Panes list={list} detail={null} width={743} />)
    expect(screen.getByTestId('panes:one')).toBeOnTheScreen()
    await view.unmount()
    await render(<Panes list={list} detail={null} width={744} />)
    expect(screen.getByTestId('panes:two')).toBeOnTheScreen()
  })

  // A second pane is a pane only where something on the left can fill it.
  it('draw no second pane beside a list with nothing in it, whatever the room', async () => {
    await render(<Panes list={list} detail={null} fills={false} width={tablet} />)
    expect(screen.getByTestId('panes:one')).toBeOnTheScreen()
    expect(screen.getByTestId('list')).toBeOnTheScreen()
    expect(screen.queryByText(empty)).toBeNull()
  })

  it('take the window’s width where they are told no other', async () => {
    // Jest's window is 750 pt wide: a small tablet's.
    await render(<Panes list={list} detail={null} />)
    expect(screen.getByTestId('panes:two')).toBeOnTheScreen()
  })
})
