// The shell's dev screen: what a household's screens stand in, drawn with no household. The tab
// bar in each drawing a member may have, in both themes, at 100 % and at 200 % text, at a
// phone's width and a tablet's; the app bar; More and arranging over a build that has modules,
// which no build has yet; the two panes; the neutral screen; and the notice of a switch.
// Its words are fixtures (D-154); what a component of the shell says itself is the catalogs'.
import { remPx } from '@household/tokens'
import type { Theme } from '@household/tokens/native'
import { useState, type ReactNode } from 'react'
import { ScrollView, View } from 'react-native'
import { NotAvailableBody } from '../../app/NotAvailable.tsx'
import { paths } from '../../app/paths.ts'
import { ThemeScope, useDisplay, useTheme } from '../../display/DisplayProvider.tsx'
import { useTranslate } from '../../i18n/I18nProvider.tsx'
import { AppBar } from '../../shell/AppBar.tsx'
import { ArrangeLists } from '../../shell/Arrange.tsx'
import { MoreList } from '../../shell/More.tsx'
import { noArrangement } from '../../shell/navigation.ts'
import { Panes } from '../../shell/Panes.tsx'
import { SwitchedBanner } from '../../shell/Switched.tsx'
import { TabBar } from '../../shell/TabBar.tsx'
import type { Place } from '../../shell/tabs.ts'
import { Button } from '../../ui/Button.tsx'
import { Sheet } from '../../ui/Sheet.tsx'
import { Text } from '../../ui/Text.tsx'
import { DevScreen } from '../DevScreen.tsx'
import { useSample } from '../sample.ts'
import { AtScale } from './AtScale.tsx'
import { drawings, household, names, registry, rows, widths, type Width } from './fixtures.ts'

const themes: readonly Theme[] = ['light', 'dark']
const scales = [1, 2] as const
const rooms = Object.keys(widths) as Width[]

function Heading({ children }: { readonly children: string }) {
  return (
    <Text step="title-3" header>
      {children}
    </Text>
  )
}

/** A part of the page in the theme it stands in, on that theme's own ground. */
function Ground({ id, children }: { readonly id?: string; readonly children: ReactNode }) {
  const theme = useTheme()
  return (
    <View
      testID={id}
      style={{
        gap: theme.space['space-15'],
        padding: theme.space['space-1'],
        backgroundColor: theme.color.surface,
      }}
    >
      {children}
    </View>
  )
}

/** Room of a width of its own, which the page scrolls sideways on a device that is narrower. */
function Room({ width, children }: { readonly width: number; readonly children: ReactNode }) {
  return (
    <ScrollView horizontal>
      <View style={{ width }}>{children}</View>
    </ScrollView>
  )
}

/** The bar in each drawing, theme, width and text size. A press on any of them opens that place in all. */
function Bars() {
  const sample = useSample()
  const theme = useTheme()
  const [open, setOpen] = useState<Place | null>('home')
  const [adding, setAdding] = useState(false)
  return (
    <>
      <Heading>{sample('Tab bar')}</Heading>
      {scales.map((scale) => (
        <AtScale key={scale} scale={scale}>
          <View testID={`shell:bars:${String(scale)}`} style={{ gap: theme.space['space-1'] }}>
            {rooms.map((room) => (
              <Room key={room} width={widths[room]}>
                {themes.map((name) => (
                  <ThemeScope key={name} theme={name}>
                    <Ground>
                      {drawings.map((drawing) => (
                        <View key={drawing.id} style={{ gap: theme.space['space-05'] }}>
                          <Text step="caption" color="text-muted">
                            {`${sample(drawing.title)} · ${sample(room)} · ${String(scale * 100)} %`}
                          </Text>
                          <TabBar
                            testID={`shell:bar:${drawing.id}:${name}:${room}:${String(scale)}`}
                            slots={drawing.slots}
                            open={open}
                            onOpen={setOpen}
                            onAdd={() => {
                              setAdding(true)
                            }}
                            width={widths[room]}
                            waiting={drawing.waiting ?? 0}
                          />
                        </View>
                      ))}
                    </Ground>
                  </ThemeScope>
                ))}
              </Room>
            ))}
          </View>
        </AtScale>
      ))}
      {/* Add is a sheet over the place that is open, and no place: the bars above still say
          which one is. The sheet itself is item 38's; this one only says so. */}
      <Sheet
        testID="shell:add"
        open={adding}
        onClose={() => {
          setAdding(false)
        }}
        title={sample('Add')}
        description={sample(
          'Add opens over the place that is open, and the bar still says which one that is.',
        )}
      />
    </>
  )
}

function AppBars() {
  const sample = useSample()
  return (
    <>
      <Heading>{sample('App bar')}</Heading>
      {themes.map((name) => (
        <ThemeScope key={name} theme={name}>
          <Ground id={`shell:app-bar:${name}`}>
            <AppBar title={sample('Today')} household={sample(names.household)} />
            <AppBar
              title={sample('Arrange your modules')}
              household={sample(names.household)}
              onBack={() => undefined}
            />
          </Ground>
        </ThemeScope>
      ))}
    </>
  )
}

/** The panes in `width` of room: a list whose rows open, and what the open one holds. */
function PanesIn({ id, width }: { readonly id: string; readonly width: number }) {
  const sample = useSample()
  const theme = useTheme()
  const { textScale } = useDisplay()
  const [selected, setSelected] = useState<string | null>(null)
  const open = rows.find((row) => row.id === selected)
  const pane = { gap: theme.space['space-1'], padding: theme.space['space-2'] }
  return (
    <Room width={width}>
      <View
        style={{
          // Room of a height of its own, which the panes fill: a page that scrolls has none.
          height: 22 * remPx * textScale,
          borderWidth: 1,
          borderColor: theme.color['border-subtle'],
        }}
      >
        <Panes
          testID={`shell:panes:${id}`}
          width={width}
          list={
            <View style={pane}>
              {rows.map((row) => (
                <Button
                  key={row.id}
                  testID={`shell:panes:${id}:${row.id}`}
                  variant="ghost"
                  onPress={() => {
                    setSelected(row.id)
                  }}
                >
                  {sample(row.title)}
                </Button>
              ))}
            </View>
          }
          detail={
            open === undefined ? null : (
              <View style={pane}>
                <Text weight={600}>{sample(open.title)}</Text>
                <Text>{sample(open.detail)}</Text>
                <Button
                  testID={`shell:panes:${id}:close`}
                  onPress={() => {
                    setSelected(null)
                  }}
                >
                  {sample('Close')}
                </Button>
              </View>
            )
          }
        />
      </View>
    </Room>
  )
}

/** The notice of a switch, as it stands above a household's screens: put away, it can be drawn again. */
function Switch() {
  const sample = useSample()
  const [shown, setShown] = useState(true)
  return shown ? (
    <SwitchedBanner
      from={sample(names.other)}
      onBack={() => undefined}
      onDismiss={() => {
        setShown(false)
      }}
      // It was here when the page opened: nothing arrived to be said.
      announce={false}
    />
  ) : (
    <Button
      testID="shell:switched:again"
      onPress={() => {
        setShown(true)
      }}
    >
      {sample('Draw it again')}
    </Button>
  )
}

export default function DevShell() {
  const sample = useSample()
  const t = useTranslate()
  // One arrangement for the page, kept for as long as it is open: what is arranged below is
  // what More lists above it.
  const [arrangement, setArrangement] = useState(noArrangement)
  return (
    <DevScreen page="shell" title={sample('Shell')}>
      <Bars />
      <AppBars />

      <Heading>{sample('More')}</Heading>
      <Ground id="shell:more">
        <MoreList household={household} registry={registry} arrangement={arrangement} waiting={3} />
      </Ground>

      <Heading>{sample('Arrange')}</Heading>
      <Ground id="shell:arrange">
        <ArrangeLists
          household={household}
          registry={registry}
          arrangement={arrangement}
          onArrange={setArrangement}
        />
      </Ground>
      <Room width={widths.tablet}>
        <Ground id="shell:arrange:tablet">
          <ArrangeLists
            household={household}
            registry={registry}
            arrangement={arrangement}
            onArrange={setArrangement}
          />
        </Ground>
      </Room>

      <Heading>{sample('Two panes')}</Heading>
      {rooms.map((room) => (
        <PanesIn key={room} id={room} width={widths[room]} />
      ))}
      <AtScale scale={2}>
        <PanesIn id="tablet-200" width={widths.tablet} />
      </AtScale>

      <Heading>{sample('Not available')}</Heading>
      <Ground id="shell:not-available">
        <Text step="title-2">{t('ui.not_available.title')}</Text>
        <NotAvailableBody home={paths.dev.path} />
      </Ground>

      <Heading>{sample('Switched by a link')}</Heading>
      <Switch />
    </DevScreen>
  )
}
