/**
 * A glyph as ink, for the tests that measure what a glyph looks like rather than what it says:
 * path data flattened to line segments, and those stroked onto a pixel grid. Round caps and
 * round joins make a stroke exactly the points within half its width of the path, so the raster
 * needs no geometry beyond a point's distance to a segment, and is the same on every machine,
 * which a canvas is not. It reads the path commands the glyphs are drawn in, and refuses another.
 */

export type Point = readonly [x: number, y: number]
export type Segment = readonly [from: Point, to: Point]

const token = /([MLHVCSAZ])|(-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?)/gi

/** How many numbers each command takes at a time. */
const arity: Readonly<Record<string, number>> = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, A: 7, Z: 0 }

/** The pieces a curve is cut into. An arc of the glyphs' radii is within 0.01 of its chords. */
const pieces = 24

function cubic(p0: Point, p1: Point, p2: Point, p3: Point): Point[] {
  return Array.from({ length: pieces }, (_, i): Point => {
    const t = (i + 1) / pieces
    const u = 1 - t
    const [a, b, c, d] = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t]
    return [
      a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0],
      a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1],
    ]
  })
}

/** An elliptical arc from its endpoints, as SVG states one (the SVG specification, B.2.4). */
function arc(
  from: Point,
  radii: Point,
  rotation: number,
  large: boolean,
  sweep: boolean,
  to: Point,
): Point[] {
  let [rx, ry] = [Math.abs(radii[0]), Math.abs(radii[1])]
  if (rx === 0 || ry === 0 || (from[0] === to[0] && from[1] === to[1])) return [to]
  const phi = (rotation * Math.PI) / 180
  const [cos, sin] = [Math.cos(phi), Math.sin(phi)]
  const [dx, dy] = [(from[0] - to[0]) / 2, (from[1] - to[1]) / 2]
  const [x1, y1] = [cos * dx + sin * dy, -sin * dx + cos * dy]
  // Radii too small to span the endpoints are scaled up until they do.
  const lambda = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry)
  if (lambda > 1) [rx, ry] = [rx * Math.sqrt(lambda), ry * Math.sqrt(lambda)]
  const numerator = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1
  const denominator = rx * rx * y1 * y1 + ry * ry * x1 * x1
  const factor = (large === sweep ? -1 : 1) * Math.sqrt(Math.max(0, numerator / denominator))
  const [cx1, cy1] = [(factor * rx * y1) / ry, (-factor * ry * x1) / rx]
  const cx = cos * cx1 - sin * cy1 + (from[0] + to[0]) / 2
  const cy = sin * cx1 + cos * cy1 + (from[1] + to[1]) / 2
  const start = Math.atan2((y1 - cy1) / ry, (x1 - cx1) / rx)
  let delta = Math.atan2((-y1 - cy1) / ry, (-x1 - cx1) / rx) - start
  if (sweep && delta < 0) delta += 2 * Math.PI
  if (!sweep && delta > 0) delta -= 2 * Math.PI
  return Array.from({ length: pieces }, (_, i): Point => {
    const angle = start + (delta * (i + 1)) / pieces
    const [ex, ey] = [rx * Math.cos(angle), ry * Math.sin(angle)]
    return i === pieces - 1 ? to : [cos * ex - sin * ey + cx, sin * ex + cos * ey + cy]
  })
}

/** The line segments path data draws. A lone point, `M8 13h.01`, is a segment of no length. */
export function flatten(d: string): Segment[] {
  const tokens = [...d.matchAll(token)].map(([text]) => text)
  if (tokens.join('') !== d.replace(/[\s,]+/g, '')) {
    throw new Error(`raster: "${d}" has a command this raster does not read`)
  }
  const segments: Segment[] = []
  let [current, start]: [Point, Point] = [
    [0, 0],
    [0, 0],
  ]
  // The second control point of the last cubic, which a smooth cubic reflects.
  let control: Point | undefined
  let at = 0
  const line = (to: Point) => {
    segments.push([current, to])
    current = to
  }
  while (at < tokens.length) {
    const letter = tokens[at++] ?? ''
    const command = letter.toUpperCase()
    const takes = arity[command]
    if (takes === undefined) throw new Error(`raster: "${d}" has a number where a command goes`)
    const relative = letter !== command
    let first = true
    // A command repeats while numbers follow it; a move's repeats are lines.
    do {
      const n: number[] = tokens.slice(at, at + takes).map(Number)
      if (n.length !== takes || n.some(Number.isNaN)) {
        throw new Error(`raster: "${d}" ends inside a ${letter}`)
      }
      at += takes
      const [ox, oy] = relative ? current : [0, 0]
      const point = (i: number): Point => [(n[i] ?? 0) + ox, (n[i + 1] ?? 0) + oy]
      let reflected: Point | undefined
      switch (command) {
        case 'M':
          if (first) {
            current = point(0)
            start = current
          } else line(point(0))
          break
        case 'L':
          line(point(0))
          break
        case 'H':
          line([(n[0] ?? 0) + ox, current[1]])
          break
        case 'V':
          line([current[0], (n[0] ?? 0) + oy])
          break
        case 'C':
        case 'S': {
          const smooth = command === 'S'
          const c1: Point = smooth
            ? control === undefined
              ? current
              : [2 * current[0] - control[0], 2 * current[1] - control[1]]
            : point(0)
          const c2 = point(smooth ? 0 : 2)
          for (const to of cubic(current, c1, c2, point(smooth ? 2 : 4))) line(to)
          reflected = c2
          break
        }
        case 'A':
          for (const to of arc(current, [n[0] ?? 0, n[1] ?? 0], n[2] ?? 0, n[3] === 1, n[4] === 1, [
            (n[5] ?? 0) + ox,
            (n[6] ?? 0) + oy,
          ])) {
            line(to)
          }
          break
        default:
          line(start)
      }
      control = reflected
      first = false
    } while (takes > 0 && at < tokens.length && !/^[a-z]$/i.test(tokens[at] ?? ''))
  }
  return segments
}

function distance(point: Point, [a, b]: Segment): number {
  const [dx, dy] = [b[0] - a[0], b[1] - a[1]]
  const length = dx * dx + dy * dy
  const t =
    length === 0
      ? 0
      : Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / length))
  return Math.hypot(point[0] - (a[0] + t * dx), point[1] - (a[1] + t * dy))
}

/** The corners of the box a stroked path's ink fills: its segments' ends, out by half the stroke. */
export function bounds(paths: readonly string[], strokeWidth: number): readonly [Point, Point] {
  const points = paths.flatMap((d) => flatten(d).flat())
  const [xs, ys] = [points.map(([x]) => x), points.map(([, y]) => y)]
  const half = strokeWidth / 2
  return [
    [Math.min(...xs) - half, Math.min(...ys) - half],
    [Math.max(...xs) + half, Math.max(...ys) + half],
  ]
}

/**
 * A glyph's ink on a square grid of `pixels` a side, a pixel marked where the stroke covers more
 * than `threshold` of it: what a 2× rasterisation of a 16 px glyph shows once colour is discarded.
 * A pixel's cover is counted on a 16 × 16 lattice inside it: a coarser one puts a pixel whose
 * cover is near the threshold on the wrong side of it, and two glyphs drawn on the same grid
 * lines, the two squares and the hatched block, then measure a tenth closer than they are.
 */
export function rasterise(
  paths: readonly string[],
  strokeWidth: number,
  pixels: number,
  box = 24,
  threshold = 40 / 255,
): boolean[] {
  const segments = paths.flatMap(flatten)
  const unit = box / pixels
  const radius = strokeWidth / 2
  const reach = (unit * Math.SQRT2) / 2
  const samples = 16
  return Array.from({ length: pixels * pixels }, (_, i) => {
    const [px, py] = [i % pixels, Math.floor(i / pixels)]
    const centre: Point = [(px + 0.5) * unit, (py + 0.5) * unit]
    // Only a segment within the stroke's reach of the pixel can cover any of it, and one whose
    // stroke reaches past the pixel's far corner covers all of it.
    const near = segments.filter((segment) => distance(centre, segment) < radius + reach)
    if (near.length === 0) return false
    if (near.some((segment) => distance(centre, segment) <= radius - reach)) return true
    let covered = 0
    for (let s = 0; s < samples * samples; s++) {
      const point: Point = [
        (px + ((s % samples) + 0.5) / samples) * unit,
        (py + (Math.floor(s / samples) + 0.5) / samples) * unit,
      ]
      if (near.some((segment) => distance(point, segment) <= radius)) covered++
    }
    return covered / (samples * samples) > threshold
  })
}

/** How far two glyphs' ink differs: the share of the pixels either marks that only one marks. */
export function inkDifference(a: readonly boolean[], b: readonly boolean[]): number {
  let [either, one] = [0, 0]
  a.forEach((marked, i) => {
    if (marked || b[i] === true) either++
    if (marked !== (b[i] === true)) one++
  })
  return either === 0 ? 0 : one / either
}
