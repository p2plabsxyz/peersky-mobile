// The nearest town to a photo's location, looked up on the device in the
// table from ../data/places.js, so a location never goes anywhere. Pure.

const EARTH_KM = 6371.0088
// Within this distance the biggest place wins, so a photo taken in one of
// Paris's arrondissements, or in Breña in Lima, is named after the city.
const CITY_KM = 10
const KM_PER_DEGREE = EARTH_KM * Math.PI / 180
const MAX_PLACES = 200000
const RADIANS = Math.PI / 180

// One bucket per degree of latitude and longitude.
const cellOf = (row, column) => (row + 90) * 360 + (((column % 360) + 540) % 360)

/**
 * An index of the table "name\tCC\tlat\tlon\tthousands\n..." for
 * nearestPlace(); the population column may be left out. Lines that do not
 * parse are skipped.
 */
export function createPlaceIndex (data) {
  const index = { names: [], countries: [], lats: [], lons: [], people: [], cells: new Map() }
  if (typeof data !== 'string') return index
  let start = 0
  while (start < data.length && index.names.length < MAX_PLACES) {
    let end = data.indexOf('\n', start)
    if (end === -1) end = data.length
    const field = data.slice(start, end).replace(/\r$/, '').split('\t')
    start = end + 1
    if (field.length !== 4 && field.length !== 5) continue
    const name = field[0].trim()
    const lat = Number(field[2])
    const lon = Number(field[3])
    if (!name || !/^[A-Z]{2}$/.test(field[1]) || !Number.isFinite(lat) || !Number.isFinite(lon) ||
      field[2].trim() === '' || field[3].trim() === '' || Math.abs(lat) > 90 || Math.abs(lon) > 180) continue
    const id = index.names.length
    index.names.push(name)
    index.countries.push(field[1])
    index.lats.push(lat)
    index.lons.push(lon)
    const people = field.length === 5 ? Number(field[4]) : 0
    index.people.push(Number.isFinite(people) && people > 0 ? people : 0)
    const cell = cellOf(Math.min(89, Math.floor(lat)), Math.floor(lon))
    const bucket = index.cells.get(cell)
    if (bucket) bucket.push(id)
    else index.cells.set(cell, [id])
  }
  return index
}

function distanceKm (lat1, lon1, lat2, lon2) {
  const dLat = (lat2 - lat1) * RADIANS
  const dLon = (lon2 - lon1) * RADIANS
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * RADIANS) * Math.cos(lat2 * RADIANS) * Math.sin(dLon / 2) ** 2
  return 2 * EARTH_KM * Math.asin(Math.min(1, Math.sqrt(h)))
}

/**
 * The place a photo at lat, lon was taken in, as { name, country, km, lat,
 * lon }, or null: the most populous place within 10 km, else the nearest
 * within maxKm. Searches rings of grid cells outward and stops once no cell
 * further out can change the answer.
 */
export function nearestPlace (index, lat, lon, { maxKm = 60 } = {}) {
  if (!index || !index.cells || !Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null
  if (!(maxKm > 0)) return null
  const reach = Math.min(maxKm, Math.PI * EARTH_KM) / EARTH_KM
  const row = Math.min(89, Math.floor(lat))
  const column = Math.floor(lon)
  // Rows and columns a place within maxKm can be in. Near a pole the circle
  // takes in every longitude.
  const firstRow = Math.max(-90, Math.floor(lat - reach / RADIANS))
  const lastRow = Math.min(89, Math.floor(lat + reach / RADIANS))
  const polar = reach >= Math.PI / 2 - Math.abs(lat * RADIANS)
  const columns = polar ? 180 : Math.min(180, Math.ceil(Math.asin(Math.min(1, Math.sin(reach) / Math.cos(lat * RADIANS))) / RADIANS) + 1)
  const rings = Math.max(row - firstRow, lastRow - row, columns)
  const cityKm = Math.min(CITY_KM, maxKm)
  const people = index.people || []
  let best = -1
  let bestKm = Infinity
  let city = -1
  let cityDistance = Infinity
  let cityPeople = -1
  const visit = (r, c) => {
    if (r < firstRow || r > lastRow) return
    const bucket = index.cells.get(cellOf(r, c))
    if (!bucket) return
    for (const id of bucket) {
      const km = distanceKm(lat, lon, index.lats[id], index.lons[id])
      if (km < bestKm) {
        bestKm = km
        best = id
      }
      const size = people[id] || 0
      if (km <= cityKm && (size > cityPeople || (size === cityPeople && km < cityDistance))) {
        city = id
        cityDistance = km
        cityPeople = size
      }
    }
  }
  for (let ring = 0; ring <= rings; ring++) {
    for (let d = -ring; d <= ring; d++) {
      if (Math.abs(d) <= columns) {
        visit(row - ring, column + d)
        if (ring) visit(row + ring, column + d)
      }
      if (ring && Math.abs(d) < ring && ring <= columns) {
        visit(row + d, column - ring)
        visit(row + d, column + ring)
      }
    }
    // Anything outside this ring is at least this far: past its rows by
    // latitude, or past its columns by the distance to that meridian.
    const latEdge = Math.min(lat - (row - ring), row + ring + 1 - lat) * KM_PER_DEGREE
    const lonDegrees = Math.min(90, Math.min(lon - (column - ring), column + ring + 1 - lon))
    const lonEdge = EARTH_KM * Math.asin(Math.min(1, Math.sin(lonDegrees * RADIANS) * Math.cos(lat * RADIANS)))
    const edge = 2 * ring + 1 >= 360 ? latEdge : Math.min(latEdge, lonEdge)
    // Done once every place within 10 km was seen, and the nearest one too.
    if (edge > cityKm && (bestKm <= edge || edge > maxKm)) break
  }
  const found = city >= 0 ? city : best
  const km = city >= 0 ? cityDistance : bestKm
  if (found < 0 || km > maxKm) return null
  return { name: index.names[found], country: index.countries[found], km, lat: index.lats[found], lon: index.lons[found] }
}

/** A key that tells places apart, also two towns of one name in one country. */
export function placeKey (place) {
  if (!place || typeof place.name !== 'string') return null
  const where = Number.isFinite(place.lat) && Number.isFinite(place.lon) ? `/${place.lat.toFixed(3)},${place.lon.toFixed(3)}` : ''
  return `${place.country || ''}/${place.name}${where}`
}
