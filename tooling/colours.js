// @ts-check
// What the two lints of 06-clients §3 (D-152) both read: which custom properties are primitives,
// and which words are colours. ESLint's `household/semantic-tokens` (eslint.config.js) holds the
// clients' TypeScript to them and tooling/src/stylesheets.ts their stylesheets.

/**
 * The colour ramps of @household/tokens/primitives: a custom property named `--<ramp>-<step>` is
 * a primitive. tooling/src/token-lint.test.ts holds this list to the package's.
 */
export const ramps = [
  'neutral',
  'indigo',
  'violet',
  'plum',
  'teal',
  'tan',
  'moss',
  'red',
  'amber',
  'emerald',
  'azure',
]

/** A ramp's custom property, wherever in a text it is named. */
export const primitive = new RegExp(String.raw`--(?:${ramps.join('|')})-\d`)

/**
 * A hexadecimal colour's digits, three, four, six or eight of them, as the source of a pattern:
 * the stylesheets' check reads a value word by word and the ESLint rule finds one inside a text,
 * so each puts its own edges round the same digits.
 */
export const hexDigits = '(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})'

/** A colour in hexadecimal, as a word of a value. */
export const hexColour = new RegExp(`^#${hexDigits}$`, 'i')

/** The functions that state a colour by its coordinates. `color-mix()` over tokens states none. */
export const colourFunctions = new Set([
  'rgb',
  'rgba',
  'hsl',
  'hsla',
  'hwb',
  'lab',
  'lch',
  'oklab',
  'oklch',
  'color',
])

/**
 * CSS's named colours. `transparent`, `currentColor` and the system colours are not among them:
 * none of those is a value a token should have been.
 */
export const namedColours = new Set(
  (
    'aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue ' +
    'blueviolet brown burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk ' +
    'crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki ' +
    'darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen ' +
    'darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue ' +
    'dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite ' +
    'gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki ' +
    'lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan ' +
    'lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen ' +
    'lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen ' +
    'magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen ' +
    'mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream ' +
    'mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid ' +
    'palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum ' +
    'powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown ' +
    'seagreen seashell sienna silver skyblue slateblue slategray slategrey snow springgreen ' +
    'steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen'
  ).split(' '),
)
