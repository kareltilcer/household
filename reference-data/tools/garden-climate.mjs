// Computes garden/climate/<country>.json from NASA POWER, so that the numbers can be computed
// again (ADR 0023, D-149, D-150). It is run by hand, when the places or the method change:
//
//   node reference-data/tools/garden-climate.mjs <cache directory>
//   pnpm exec prettier --write "reference-data/garden/climate/*.json"
//
// It asks POWER once for each place the cache directory does not hold yet, for the daily minimum
// temperature at 2 metres (T2M_MIN, from MERRA-2) of 1991 to 2020 at the place's coordinates, one
// request after another, and keeps in the cache what it reads out of each answer: the elevation of
// the grid cell and each day's minimum, as numbers. From those thirty years:
//
//   - a year's last spring frost is its last day from 1 January to 31 July at or below 2 °C, and
//     its first autumn frost its first such day from 1 August to 31 December;
//   - the place's last spring frost is the 27th of the thirty years' in order, and its first
//     autumn frost the 3rd of theirs: the 90th and the 10th percentile by nearest rank, the day a
//     frost comes after, or before, in one year in ten;
//   - its hardiness zone is the USDA's, from the mean of each year's lowest minimum: zones of
//     10 °F from -60 °F, each halved into a and b;
//   - its season is the days from the one frost to the other;
//   - its altitude is that of POWER's grid cell, which the values hold at.
//
// A day is counted in a year of 365: 29 February counts as 28 February. A place in whose cell
// more than three of the thirty years have no such night before August, or none after July, is
// left out: the cell is the sea's, not the town's. Every value is written as drafted (PL-10): a
// grid of 0.5° by 0.625° is no station.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const THRESHOLD_C = 2
const FIRST_YEAR = 1991
const LAST_YEAR = 2020
/** The years in which a frost may fail to come on one side of the summer before a cell is the sea's. */
const FROSTLESS_YEARS = 3

// Country, key, name as the country writes it, latitude, longitude.
const PLACES = [
  ['CZ', 'praha', 'Praha', 50.08, 14.44],
  ['CZ', 'brno', 'Brno', 49.2, 16.61],
  ['CZ', 'ostrava', 'Ostrava', 49.83, 18.28],
  ['CZ', 'plzen', 'Plzeň', 49.75, 13.38],
  ['CZ', 'liberec', 'Liberec', 50.77, 15.06],
  ['CZ', 'olomouc', 'Olomouc', 49.59, 17.25],
  ['CZ', 'ceske_budejovice', 'České Budějovice', 48.97, 14.47],
  ['CZ', 'hradec_kralove', 'Hradec Králové', 50.21, 15.83],
  ['CZ', 'usti_nad_labem', 'Ústí nad Labem', 50.66, 14.03],
  ['CZ', 'pardubice', 'Pardubice', 50.04, 15.78],
  ['CZ', 'zlin', 'Zlín', 49.22, 17.67],
  ['CZ', 'jihlava', 'Jihlava', 49.4, 15.59],
  ['CZ', 'karlovy_vary', 'Karlovy Vary', 50.23, 12.87],
  ['CZ', 'kurim', 'Kuřim', 49.3, 16.53],
  ['CZ', 'opava', 'Opava', 49.94, 17.9],
  ['CZ', 'znojmo', 'Znojmo', 48.86, 16.05],
  ['CZ', 'tabor', 'Tábor', 49.41, 14.66],
  ['CZ', 'cheb', 'Cheb', 50.08, 12.37],
  ['CZ', 'zdar_nad_sazavou', 'Žďár nad Sázavou', 49.56, 15.94],
  ['CZ', 'uherske_hradiste', 'Uherské Hradiště', 49.07, 17.46],
  ['SK', 'bratislava', 'Bratislava', 48.15, 17.11],
  ['SK', 'kosice', 'Košice', 48.72, 21.26],
  ['SK', 'presov', 'Prešov', 49.0, 21.24],
  ['SK', 'zilina', 'Žilina', 49.22, 18.74],
  ['SK', 'banska_bystrica', 'Banská Bystrica', 48.74, 19.15],
  ['SK', 'nitra', 'Nitra', 48.31, 18.09],
  ['SK', 'trnava', 'Trnava', 48.38, 17.59],
  ['SK', 'trencin', 'Trenčín', 48.89, 18.04],
  ['SK', 'poprad', 'Poprad', 49.06, 20.3],
  ['SK', 'martin', 'Martin', 49.07, 18.92],
  ['SK', 'michalovce', 'Michalovce', 48.75, 21.92],
  ['SK', 'lucenec', 'Lučenec', 48.33, 19.67],
  ['SK', 'komarno', 'Komárno', 47.76, 18.13],
  ['SK', 'liptovsky_mikulas', 'Liptovský Mikuláš', 49.08, 19.61],
  ['DE', 'berlin', 'Berlin', 52.52, 13.4],
  ['DE', 'hamburg', 'Hamburg', 53.55, 9.99],
  ['DE', 'muenchen', 'München', 48.14, 11.58],
  ['DE', 'koeln', 'Köln', 50.94, 6.96],
  ['DE', 'frankfurt_am_main', 'Frankfurt am Main', 50.11, 8.68],
  ['DE', 'stuttgart', 'Stuttgart', 48.78, 9.18],
  ['DE', 'duesseldorf', 'Düsseldorf', 51.23, 6.78],
  ['DE', 'leipzig', 'Leipzig', 51.34, 12.37],
  ['DE', 'bremen', 'Bremen', 53.08, 8.8],
  ['DE', 'dresden', 'Dresden', 51.05, 13.74],
  ['DE', 'hannover', 'Hannover', 52.37, 9.74],
  ['DE', 'nuernberg', 'Nürnberg', 49.45, 11.08],
  ['DE', 'kiel', 'Kiel', 54.32, 10.14],
  ['DE', 'rostock', 'Rostock', 54.09, 12.14],
  ['DE', 'magdeburg', 'Magdeburg', 52.13, 11.63],
  ['DE', 'erfurt', 'Erfurt', 50.98, 11.03],
  ['DE', 'kassel', 'Kassel', 51.32, 9.5],
  ['DE', 'saarbruecken', 'Saarbrücken', 49.24, 7.0],
  ['DE', 'freiburg_im_breisgau', 'Freiburg im Breisgau', 48.0, 7.85],
  ['DE', 'karlsruhe', 'Karlsruhe', 49.01, 8.4],
  ['DE', 'muenster', 'Münster', 51.96, 7.63],
  ['DE', 'regensburg', 'Regensburg', 49.02, 12.1],
  ['DE', 'wuerzburg', 'Würzburg', 49.79, 9.93],
  ['DE', 'ulm', 'Ulm', 48.4, 9.99],
  ['DE', 'schwerin', 'Schwerin', 53.63, 11.41],
  ['DE', 'chemnitz', 'Chemnitz', 50.83, 12.92],
  ['DE', 'passau', 'Passau', 48.57, 13.46],
  ['DE', 'flensburg', 'Flensburg', 54.78, 9.44],
  ['DE', 'koblenz', 'Koblenz', 50.36, 7.59],
  ['DE', 'cottbus', 'Cottbus', 51.76, 14.33],
  ['DE', 'garmisch_partenkirchen', 'Garmisch-Partenkirchen', 47.49, 11.1],
  ['PL', 'warszawa', 'Warszawa', 52.23, 21.01],
  ['PL', 'krakow', 'Kraków', 50.06, 19.94],
  ['PL', 'lodz', 'Łódź', 51.76, 19.46],
  ['PL', 'wroclaw', 'Wrocław', 51.11, 17.03],
  ['PL', 'poznan', 'Poznań', 52.41, 16.93],
  ['PL', 'gdansk', 'Gdańsk', 54.35, 18.65],
  ['PL', 'szczecin', 'Szczecin', 53.43, 14.55],
  ['PL', 'bydgoszcz', 'Bydgoszcz', 53.12, 18.01],
  ['PL', 'lublin', 'Lublin', 51.25, 22.57],
  ['PL', 'bialystok', 'Białystok', 53.13, 23.16],
  ['PL', 'katowice', 'Katowice', 50.26, 19.02],
  ['PL', 'rzeszow', 'Rzeszów', 50.04, 22.0],
  ['PL', 'olsztyn', 'Olsztyn', 53.78, 20.48],
  ['PL', 'kielce', 'Kielce', 50.87, 20.63],
  ['PL', 'opole', 'Opole', 50.67, 17.93],
  ['PL', 'zielona_gora', 'Zielona Góra', 51.94, 15.51],
  ['PL', 'gorzow_wielkopolski', 'Gorzów Wielkopolski', 52.73, 15.24],
  ['PL', 'torun', 'Toruń', 53.01, 18.6],
  ['PL', 'koszalin', 'Koszalin', 54.19, 16.17],
  ['PL', 'suwalki', 'Suwałki', 54.1, 22.93],
  ['PL', 'zakopane', 'Zakopane', 49.3, 19.95],
  ['PL', 'jelenia_gora', 'Jelenia Góra', 50.9, 15.73],
  ['PL', 'nowy_sacz', 'Nowy Sącz', 49.62, 20.7],
  ['PL', 'przemysl', 'Przemyśl', 49.78, 22.77],
  ['PL', 'elblag', 'Elbląg', 54.16, 19.4],
  ['PL', 'czestochowa', 'Częstochowa', 50.81, 19.12],
  ['GB', 'london', 'London', 51.51, -0.13],
  ['GB', 'birmingham', 'Birmingham', 52.48, -1.9],
  ['GB', 'manchester', 'Manchester', 53.48, -2.24],
  ['GB', 'leeds', 'Leeds', 53.8, -1.55],
  ['GB', 'glasgow', 'Glasgow', 55.86, -4.25],
  ['GB', 'edinburgh', 'Edinburgh', 55.95, -3.19],
  ['GB', 'liverpool', 'Liverpool', 53.41, -2.98],
  ['GB', 'bristol', 'Bristol', 51.45, -2.59],
  ['GB', 'sheffield', 'Sheffield', 53.38, -1.47],
  ['GB', 'newcastle_upon_tyne', 'Newcastle upon Tyne', 54.98, -1.61],
  ['GB', 'cardiff', 'Cardiff', 51.48, -3.18],
  ['GB', 'belfast', 'Belfast', 54.6, -5.93],
  ['GB', 'nottingham', 'Nottingham', 52.95, -1.15],
  ['GB', 'southampton', 'Southampton', 50.9, -1.4],
  ['GB', 'plymouth', 'Plymouth', 50.38, -4.14],
  ['GB', 'norwich', 'Norwich', 52.63, 1.3],
  ['GB', 'aberdeen', 'Aberdeen', 57.15, -2.09],
  ['GB', 'inverness', 'Inverness', 57.48, -4.22],
  ['GB', 'cambridge', 'Cambridge', 52.21, 0.12],
  ['GB', 'oxford', 'Oxford', 51.75, -1.26],
  ['GB', 'exeter', 'Exeter', 50.72, -3.53],
  ['GB', 'brighton', 'Brighton', 50.82, -0.14],
  ['GB', 'carlisle', 'Carlisle', 54.89, -2.93],
  ['GB', 'york', 'York', 53.96, -1.08],
  ['GB', 'swansea', 'Swansea', 51.62, -3.94],
  ['GB', 'aberystwyth', 'Aberystwyth', 52.42, -4.08],
  ['GB', 'penzance', 'Penzance', 50.12, -5.54],
]

const cache = process.argv[2]
if (!cache) {
  console.error('usage: node reference-data/tools/garden-climate.mjs <cache directory>')
  process.exit(2)
}
mkdirSync(cache, { recursive: true })
const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'garden', 'climate')

/** The days of a year of 365 before each month. */
const BEFORE = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334]
const dayOfYear = (month, day) => BEFORE[month - 1] + (month === 2 && day === 29 ? 28 : day)
const monthDay = (n) => {
  let m = 11
  while (BEFORE[m] >= n) m--
  return `${String(m + 1).padStart(2, '0')}-${String(n - BEFORE[m]).padStart(2, '0')}`
}
const zone = (meanLowestC) => {
  const f = (meanLowestC * 9) / 5 + 32
  const n = Math.floor((f + 60) / 10) + 1
  return `${n}${f + 60 - (n - 1) * 10 < 5 ? 'a' : 'b'}`
}

/** Every day of the thirty years in order, each as its year, its month and its day of the month. */
const DAYS = []
for (let t = Date.UTC(FIRST_YEAR, 0, 1); t <= Date.UTC(LAST_YEAR, 11, 31); t += 86_400_000) {
  const d = new Date(t)
  DAYS.push([d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()])
}

/** POWER gives a temperature and an elevation to two decimal places. */
const hundredths = (value) => Math.round(Number(value) * 100) / 100

/**
 * What the tool keeps of POWER's answer for a place, and all it computes from: the elevation of
 * its grid cell, and the minimum of each of DAYS in order, null where POWER has none. Each is read
 * out of the answer by a key this tool makes and held to being a number, so that the cache holds
 * numbers the tool wrote and never the document a server sent.
 */
function readings(answer, key) {
  const sent = answer?.properties?.parameter?.T2M_MIN
  const elevation = hundredths(answer?.geometry?.coordinates?.[2])
  const fill = hundredths(answer?.header?.fill_value)
  if (
    typeof sent !== 'object' ||
    sent === null ||
    !Number.isFinite(elevation) ||
    !Number.isFinite(fill)
  ) {
    throw new Error(`${key}: POWER's answer is not the one asked for`)
  }
  const pad = (n) => String(n).padStart(2, '0')
  const minima = DAYS.map(([year, month, day]) => {
    const t = hundredths(sent[`${year}${pad(month)}${pad(day)}`])
    if (!Number.isFinite(t))
      throw new Error(`${key}: POWER's answer has no ${year}-${pad(month)}-${pad(day)}`)
    return t === fill ? null : t
  })
  return { elevation, minima }
}

/** A place's readings: from the cache, or asked of POWER and kept there. */
async function daily(country, key, latitude, longitude) {
  const file = join(cache, `${country}_${key}.json`)
  try {
    const kept = JSON.parse(readFileSync(file, 'utf8'))
    if (!Array.isArray(kept.minima) || kept.minima.length !== DAYS.length) {
      throw new Error(`${file} is not this tool's: delete it, and the place is asked for again`)
    }
    return kept
  } catch (err) {
    if (err.code !== 'ENOENT') throw err
  }
  const url =
    'https://power.larc.nasa.gov/api/temporal/daily/point?parameters=T2M_MIN&community=AG' +
    `&longitude=${longitude}&latitude=${latitude}&start=${FIRST_YEAR}0101&end=${LAST_YEAR}1231&format=JSON`
  const res = await fetch(url, { signal: AbortSignal.timeout(180_000) })
  if (!res.ok) throw new Error(`${key}: POWER answered ${res.status}`)
  const kept = readings(await res.json(), key)
  writeFileSync(file, JSON.stringify(kept) + '\n')
  await new Promise((resolve) => setTimeout(resolve, 1000))
  return kept
}

const field = (value, source) => ({ value, source, drafted: true })
const byCountry = new Map()
const leftOut = []
for (const [country, key, name, latitude, longitude] of PLACES) {
  const { elevation, minima } = await daily(country, key, latitude, longitude)
  // Each year's last frost, first frost and lowest minimum. 0 and 366 stand for a year with no
  // such night before August, and none after July.
  const years = new Map()
  DAYS.forEach(([year, month, day], i) => {
    const t = minima[i]
    if (t === null) return
    const y = years.get(year) ?? { last: 0, first: 366, lowest: Infinity }
    years.set(year, y)
    y.lowest = Math.min(y.lowest, t)
    if (t > THRESHOLD_C) return
    const n = dayOfYear(month, day)
    if (month <= 7) y.last = Math.max(y.last, n)
    else y.first = Math.min(y.first, n)
  })
  const lasts = [...years.values()].map((y) => y.last)
  const firsts = [...years.values()].map((y) => y.first)
  const lowests = [...years.values()].map((y) => y.lowest)
  if (
    lasts.filter((n) => n === 0).length > FROSTLESS_YEARS ||
    firsts.filter((n) => n === 366).length > FROSTLESS_YEARS
  ) {
    leftOut.push(name)
    continue
  }
  const ascending = (days) => days.toSorted((a, b) => a - b)
  const last = ascending(lasts)[Math.ceil(0.9 * lasts.length) - 1]
  const first = ascending(firsts)[Math.ceil(0.1 * firsts.length) - 1]
  const places = byCountry.get(country) ?? []
  byCountry.set(country, places)
  places.push({
    key: `${country.toLowerCase()}_${key}`,
    name: field(name, 'geonames'),
    location: field({ latitude, longitude }, 'geonames'),
    altitude_m: field(Math.round(elevation), 'nasa-power'),
    last_spring_frost: field(monthDay(last), 'nasa-power'),
    first_autumn_frost: field(monthDay(first), 'nasa-power'),
    hardiness_zone: field(zone(lowests.reduce((a, b) => a + b, 0) / lowests.length), 'nasa-power'),
    season_length_days: field(first - last, 'nasa-power'),
  })
}

for (const [country, places] of byCountry) {
  places.sort((a, b) => (a.key < b.key ? -1 : 1))
  const record = { $schema: '../../schemas/garden-climate.schema.json', country, places }
  writeFileSync(join(out, `${country}.json`), JSON.stringify(record) + '\n')
}
console.log(`${[...byCountry.values()].flat().length} places; left out: ${leftOut.join(', ')}`)
