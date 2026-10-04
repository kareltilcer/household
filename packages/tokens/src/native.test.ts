import { describe, expect, it } from 'vitest'
import { colorNames, resolve, themes, typeScale } from './index.ts'
import { nativeThemes } from './native.ts'

describe('the React Native theme', () => {
  it('resolves every colour name in each theme', () => {
    for (const theme of themes) {
      expect(Object.keys(nativeThemes[theme].color)).toEqual(colorNames)
      expect(nativeThemes[theme].color['status-conflict']).toBe(resolve('warning', theme))
      expect(nativeThemes[theme].color['accent-shopping']).toBe(
        resolve('accent-family-keeping', theme),
      )
      expect(nativeThemes[theme].density['dens-rule']).toBe(resolve('border', theme))
    }
    expect(nativeThemes.light.color.surface).not.toBe(nativeThemes.dark.color.surface)
  })

  it('converts rem to px at 16, a line height to px and tracking to px', () => {
    const { type } = nativeThemes.light
    expect(type['title-1']).toEqual({
      fontFamily: 'IBMPlexSans-Medium',
      fontSize: 30,
      lineHeight: 36.6,
      letterSpacing: -0.45,
      textTransform: 'none',
      fontVariant: [],
    })
    expect(type.overline).toMatchObject({
      fontFamily: 'IBMPlexSans-SemiBold',
      fontSize: 11,
      lineHeight: 14.3,
      letterSpacing: 1.1,
      textTransform: 'uppercase',
    })
    expect(type.caption.fontSize).toBe(13)
    expect(Object.keys(type)).toEqual(Object.keys(typeScale))
  })

  it('sets the mono steps in tabular, lining figures on their sans step’s line', () => {
    const { type } = nativeThemes.dark
    expect(type.num).toMatchObject({
      fontFamily: 'IBMPlexMono-Regular',
      fontVariant: ['tabular-nums', 'lining-nums'],
      fontSize: type.body.fontSize,
      lineHeight: type.body.lineHeight,
    })
    expect(type['num-lg'].fontFamily).toBe('IBMPlexMono-Medium')
  })

  it('carries lengths and times as numbers, and a full radius as a round', () => {
    const theme = nativeThemes.light
    expect(theme.space['space-2']).toBe(16)
    expect(theme.radii).toEqual({
      'radius-control': 8,
      'radius-card': 12,
      'radius-sheet': 20,
      'radius-pill': 999,
      'radius-full': 9999,
    })
    expect(theme.durations['dur-fast']).toBe(120)
    expect(theme.easings['ease-exit']).toEqual([0.4, 0, 1, 1])
    expect(theme.thresholds['hold-to-complete']).toBe(2000)
    expect(theme.density['dens-row-min']).toBe(44)
  })

  it('draws each theme’s own shadows', () => {
    expect(nativeThemes.light.shadows['shadow-1']).toHaveLength(2)
    expect(nativeThemes.dark.shadows['shadow-2']).toEqual([
      { offsetX: 0, offsetY: 8, blurRadius: 24, color: 'rgba(0, 0, 0, 0.55)' },
    ])
  })
})
