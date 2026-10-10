// The harness's model, held as design/v1's `components.js` holds its own (`checks()`), and the
// screen drawn from it, with the app's accessibility rules over every cell: this is what "the
// harness passes the accessibility checks" comes to where nothing like axe reads a native tree
// (src/test/a11y.ts says what the rules read and what they cannot). What a device measures, a
// cell wider than its box at 200 %, is the end-to-end flow's and a person's.
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals'
import { statusGlyphs } from '@household/icons'
import { catalogs, isMessageKey, pseudolocalize } from '@household/i18n'
import { nativeThemes } from '@household/tokens/native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { act, screen, userEvent, within } from '@testing-library/react-native'
import { useState } from 'react'
import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native'
import type { TestInstance } from 'test-renderer'
import { storageKey } from '../../display/modes.ts'
import {
  elementsOf,
  expectAccessible,
  neverDisabled,
  statusTestID,
  violations,
} from '../../test/a11y.ts'
import { render } from '../../test/render.tsx'
import * as announcer from '../../ui/announce.ts'
import { Button } from '../../ui/Button.tsx'
import { dataStates, treatments, type DataState, type Treatment } from '../../ui/states.ts'
import { devMarker } from '../marker.ts'
import Harness from './index.tsx'
import {
  bodies,
  bodyIds,
  cellId,
  cellThemes,
  states,
  variantId,
  variantIds,
  variants,
  type BodyId,
  type CellTheme,
} from './model.ts'

const en = catalogs.en

describe('the harness’s model', () => {
  it('has eight bodies and twelve states: ninety-six cells, each in two themes', () => {
    expect(bodyIds).toHaveLength(8)
    expect(Object.keys(bodies)).toEqual([...bodyIds])
    expect(Object.keys(states)).toEqual([...dataStates])
    expect(bodyIds.length * dataStates.length * cellThemes.length).toBe(192)
    // The data table is the web's alone.
    expect(bodyIds).not.toContain('table')
  })

  it('carries no state by colour alone: every mark is a glyph, a word and a token', () => {
    for (const state of dataStates) {
      const treatment: Treatment = treatments[state]
      if (treatment.mark === undefined) continue
      const glyph = statusGlyphs[treatment.mark]
      expect(glyph.paths.length).toBeGreaterThan(0)
      expect(glyph.token).toMatch(/^status-/)
      expect(isMessageKey(glyph.labelKey)).toBe(true)
      expect(en[glyph.labelKey].trim()).not.toBe('')
    }
  })

  it('gives every named state of every body a sentence of its own, and no two bodies one', () => {
    const sentences = {
      error: bodyIds.map((id) => bodies[id].error),
      rejected: bodyIds.map((id) => bodies[id].rejected),
      withdrawn: bodyIds.map((id) => bodies[id].withdrawn),
      readonly: bodyIds.map((id) => bodies[id].readonly),
      empty: bodyIds.map((id) => bodies[id].empty.sentence),
      example: bodyIds.map((id) => bodies[id].empty.example),
      name: bodyIds.map((id) => bodies[id].name),
      note: bodyIds.map((id) => bodies[id].note),
    }
    for (const [kind, said] of Object.entries(sentences)) {
      expect(said.filter((text) => text.trim() === '')).toEqual([])
      // No shared "Something went wrong": a sentence is written for the body it is about.
      expect([kind, new Set(said).size]).toEqual([kind, bodyIds.length])
    }
    for (const id of bodyIds) {
      expect(bodies[id].empty.action.trim()).not.toBe('')
      expect(bodies[id].skeleton.length).toBeGreaterThan(0)
    }
  })

  it('says of a withdrawn body nothing of what was withdrawn, and of a read-only one no payment', () => {
    // 03-patterns §8: no module's name, no author. And a household that is read-only is not
    // one whose payment is late: that state restricts nothing.
    for (const id of bodyIds) {
      expect(bodies[id].withdrawn).not.toMatch(
        /Utilities|Finance|Vehicles|Documents|author|shared/i,
      )
      expect(`${bodies[id].readonly} ${bodies[id].rejected}`).not.toMatch(/past due|subscription/i)
    }
  })

  it('is written so that the pseudo-locale can accent it: no brace, no straight apostrophe', () => {
    const texts = [
      ...bodyIds.flatMap((id) => {
        const body = bodies[id]
        return [
          body.name,
          body.note,
          body.error,
          body.rejected,
          body.withdrawn,
          body.readonly,
          ...Object.values(body.empty),
        ]
      }),
      ...dataStates.flatMap((state) => Object.values(states[state])),
      ...variantIds.map((variant) => variants[variant].name),
    ]
    expect(texts.filter((text) => /[{}'#]/.test(text))).toEqual([])
  })

  it('names each variant’s body', () => {
    for (const variant of variantIds) expect(bodyIds).toContain(variants[variant].body)
  })
})

function root(): TestInstance {
  if (screen.root === null) throw new Error('nothing is drawn')
  return screen.root
}

function cell(body: BodyId, state: DataState, theme: CellTheme = 'light'): TestInstance {
  return screen.getByTestId(cellId(body, state, theme))
}

/** Every cell of the twelve states, in the order they are drawn, by its `testID`. */
function cells(): TestInstance[] {
  const ids = new Set(
    bodyIds.flatMap((body) =>
      dataStates.flatMap((state) => cellThemes.map((theme) => cellId(body, state, theme))),
    ),
  )
  return elementsOf(root()).filter((element) => ids.has(String(element.props.testID)))
}

/** Whether `element` draws the kit's illustration, by its frame. */
function isIllustration(element: TestInstance): boolean {
  return (
    element.type === 'RNSVGSvgView' &&
    element.props.vbWidth === 200 &&
    element.props.vbHeight === 140
  )
}

/** What a cell draws, as one of the five kinds a treatment has, read off the cell itself. */
function kindOf(drawn: TestInstance, body: BodyId): Treatment['kind'] | 'nothing known' {
  const has = (testID: string | RegExp) => within(drawn).queryAllByTestId(testID).length > 0
  if (drawn.children.length === 0) return 'absent'
  if (has(`body:${body}`)) return 'body'
  if (has('skeleton')) return 'skeleton'
  if (has('empty-state')) return 'teach'
  if (has(/^banner:/)) return 'message'
  return 'nothing known'
}

/** The harness, and a control beside it that closes it. */
function Host() {
  const [open, setOpen] = useState(true)
  return (
    <>
      {open ? <Harness /> : null}
      <Button
        testID="outside"
        onPress={() => {
          setOpen(false)
        }}
      >
        {bodies.kv.name}
      </Button>
    </>
  )
}

let said: jest.SpiedFunction<typeof announcer.announce>
let saidNow: jest.SpiedFunction<typeof announcer.announceNow>

beforeEach(async () => {
  await AsyncStorage.clear()
  said = jest.spyOn(announcer, 'announce').mockImplementation(() => undefined)
  saidNow = jest.spyOn(announcer, 'announceNow').mockImplementation(() => undefined)
})
afterEach(() => {
  jest.restoreAllMocks()
  jest.useRealTimers()
})

describe('the harness', () => {
  // The clock is the test's: two hundred cells take longer to draw than the moment a sync is
  // given before its mark is shown, and a mark that came due under a test would be drawn
  // behind its back.
  beforeEach(() => {
    jest.useFakeTimers()
  })

  it('draws every body in every state in both themes, each by its own treatment', async () => {
    await render(<Harness />)
    const drawn = cells()
    expect(drawn.map((each): unknown => each.props.testID)).toEqual(
      bodyIds.flatMap((body) =>
        dataStates.flatMap((state) => cellThemes.map((theme) => cellId(body, state, theme))),
      ),
    )
    expect(drawn).toHaveLength(192)
    for (const body of bodyIds) {
      for (const state of dataStates) {
        for (const theme of cellThemes) {
          expect([cellId(body, state, theme), kindOf(cell(body, state, theme), body)]).toEqual([
            cellId(body, state, theme),
            treatments[state].kind,
          ])
        }
      }
    }
    for (const variant of variantIds) {
      for (const theme of cellThemes) {
        const drawnVariant = screen.getByTestId(variantId(variant, theme))
        expect(kindOf(drawnVariant, variants[variant].body)).toBe('body')
      }
    }
    expect(screen.getByTestId(`${devMarker}:harness`)).toBeOnTheScreen()
  })

  it('passes the accessibility rules in every cell, at the 200 % it is held at', async () => {
    await render(<Harness />)
    for (const each of [...cells(), ...screen.getAllByTestId(/^variant:/)]) {
      expectAccessible(each, { scale: 2 })
    }
    // And in what stands around the cells: the chooser, the toolbar, the headings.
    expectAccessible(root(), { scale: 2 })
  })

  it('draws each cell in its own theme: its ground and its ink are that theme’s', async () => {
    await render(<Harness />)
    for (const theme of cellThemes) {
      const drawn = cell('list', 'populated', theme)
      const ground = StyleSheet.flatten(drawn.props.style as StyleProp<ViewStyle>)
      expect(ground.backgroundColor).toBe(nativeThemes[theme].color.surface)
      const title = within(drawn).getByText('Electricity, cellar meter')
      expect(StyleSheet.flatten(title.props.style as StyleProp<ViewStyle>)).toMatchObject({
        color: nativeThemes[theme].color['text-primary'],
      })
    }
  })

  it('holds the text at 200 % while it is open, gives the scale back, and keeps nothing', async () => {
    await render(<Host />)
    // A control that is no part of the harness: as large as the text the harness holds.
    const high = () =>
      StyleSheet.flatten(screen.getByTestId('outside').props.style as StyleProp<ViewStyle>)
        .minHeight
    expect(high()).toBe(88)
    await userEvent.press(screen.getByTestId('outside'))
    expect(screen.queryByTestId(`${devMarker}:harness`)).toBeNull()
    expect(high()).toBe(44)
    // A hold is no choice of the member's: nothing of it is kept on the device.
    await expect(AsyncStorage.getItem(storageKey)).resolves.toBeNull()
  })

  it('draws one body where it is asked for one, and every body again', async () => {
    await render(<Harness />)
    await userEvent.press(screen.getByTestId('harness:only:kv'))
    expect(cells()).toHaveLength(24)
    expect(screen.queryByTestId('harness:body:list')).toBeNull()
    expect(screen.getByTestId('harness:body:kv')).toBeOnTheScreen()
    // Which one is chosen is said, and shown by more than a colour.
    expect(screen.getByTestId('harness:only:kv')).toBeSelected()
    expect(screen.getByTestId('harness:only:all')).not.toBeSelected()
    await userEvent.press(screen.getByTestId('harness:only:all'))
    expect(cells()).toHaveLength(192)
  })

  it('draws nothing in an absent cell, and no write affordance in a state that writes nothing', async () => {
    await render(<Harness />)
    for (const body of bodyIds) {
      for (const theme of cellThemes) expect(cell(body, 'absent', theme).children).toEqual([])
    }
    const open = (state: DataState) =>
      within(cell('list', state)).queryAllByRole('button', { name: 'Open' })
    expect(open('populated')).toHaveLength(3)
    for (const state of dataStates) {
      if (treatments[state].writes || state === 'absent') continue
      expect(open(state)).toEqual([])
    }
    // The one action of a tile with no figure is a write too, and is drawn where writes are.
    expect(
      within(screen.getByTestId(variantId('metric-none', 'light'))).getAllByRole('button'),
    ).toHaveLength(1)
    // Nothing is disabled anywhere: a control that cannot act is absent.
    expect(violations(root(), { rules: [neverDisabled] })).toEqual([])
  })

  it('offers a read-only body no way to a purchase: its strip explains, and has no action', async () => {
    await render(<Harness />)
    for (const body of bodyIds) {
      const strip = within(cell(body, 'readonly')).getByTestId('banner:warning')
      expect(within(strip).queryAllByRole('button')).toEqual([])
    }
  })

  it('says each state in its own words: the bar, the marks, the control of a conflict', async () => {
    await render(<Harness />)
    expect(within(cell('kv', 'offline')).getByText(en['ui.offline.bar'])).toBeOnTheScreen()
    expect(within(cell('kv', 'pending')).getByText(en['a11y.status.pending'])).toBeOnTheScreen()
    // A refusal is said twice over: its reason above the body, and the mark on what was refused.
    expect(
      within(within(cell('kv', 'rejected')).getByTestId(statusTestID('rejected'))).getByText(
        en['a11y.status.rejected'],
      ),
    ).toBeOnTheScreen()
    expect(
      within(cell('kv', 'rejected')).getByText(bodies.kv.rejected, { exact: true }),
    ).toBeOnTheScreen()
    expect(
      within(cell('list', 'conflicted')).getByRole('button', {
        name: en['a11y.control.conflict'].replace('{name}', 'Electricity, cellar meter'),
      }),
    ).toBeOnTheScreen()
    // An offline read is the online read: the bar is the only difference.
    expect(within(cell('kv', 'offline')).getByTestId('body:kv')).toBeOnTheScreen()

    // A sync shows nothing at all until it has taken longer than a moment.
    const syncing = () => within(cell('list', 'syncing')).queryAllByTestId(statusTestID('syncing'))
    expect(syncing()).toEqual([])
    await act(() => {
      jest.advanceTimersByTime(799)
    })
    expect(syncing()).toEqual([])
    await act(() => {
      jest.advanceTimersByTime(1)
    })
    expect(syncing()).toHaveLength(1)
  })

  it('announces nothing as it opens: every state was there when the screen was', async () => {
    await render(<Harness />)
    expect(said).not.toHaveBeenCalled()
    expect(saidNow).not.toHaveBeenCalled()
  })

  it('draws the illustration at 100 % text, and gives its room to the sentence at 200 %', async () => {
    await render(<Harness />)
    const pictures = () => elementsOf(cell('list', 'empty')).filter(isIllustration)
    expect(pictures()).toEqual([])
    // The toolbar's own hold is over the screen's: device, then 100.
    await userEvent.press(screen.getByTestId('dev-toolbar:scale'))
    expect(screen.getByTestId('dev-toolbar:scale')).toHaveTextContent('Text: 100')
    expect(pictures()).toHaveLength(1)
    expectAccessible(cell('list', 'empty'), { scale: 1 })
    await userEvent.press(screen.getByTestId('dev-toolbar:scale'))
    expect(pictures()).toEqual([])
  })

  it('accents its own sample text under the pseudo-locale, as a catalog’s message is', async () => {
    await render(<Harness />, { locale: 'en-XA' })
    expect(screen.getAllByRole('header')[0]).toHaveTextContent(pseudolocalize('Twelve states'))
    expect(screen.getByText(pseudolocalize(bodies.money.note))).toBeOnTheScreen()
    expect(
      within(cell('series', 'error')).getByText(pseudolocalize(bodies.series.error)),
    ).toBeOnTheScreen()
    // And what the app says itself is the catalog's, accented with it.
    expect(
      within(cell('kv', 'offline')).getByText(pseudolocalize(en['ui.offline.bar'])),
    ).toBeOnTheScreen()
  })
})
