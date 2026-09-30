import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { describe, test } from 'node:test'
import {
  addBrowserFavourite,
  canFavouriteBrowserPage,
  isBrowserUrlFavourited,
  MAX_BROWSER_FAVOURITES,
  parseBrowserFavourites,
  removeBrowserFavourite,
  serializeBrowserFavourites
} from '../../app/favourites/browser-favourites.mjs'

const fill = (count) => {
  let favourites = []
  for (let index = 0; index < count; index++) {
    favourites = addBrowserFavourite(favourites, {
      url: `https://example.com/${index}`,
      title: `Site ${index}`
    })
  }
  return favourites
}

describe('home favourites', () => {
  test('the grid holds eight and no more', () => {
    const favourites = fill(MAX_BROWSER_FAVOURITES + 4)

    assert.equal(favourites.length, MAX_BROWSER_FAVOURITES)
    // The oldest is kept, not dropped: the grid is a place, and a tile you
    // put there last week should not vanish because you added one today.
    assert.equal(favourites[0].url, 'https://example.com/0')
  })

  test('adding one you already have moves nothing', () => {
    const favourites = fill(3)
    const again = addBrowserFavourite(favourites, {
      url: 'https://example.com/1',
      title: 'Renamed'
    })

    assert.equal(again.length, 3)
    assert.equal(again[2].title, 'Renamed')
    assert.equal(isBrowserUrlFavourited(again, 'https://example.com/1'), true)
    assert.equal(isBrowserUrlFavourited(removeBrowserFavourite(again, 'https://example.com/1'), 'https://example.com/1'), false)
  })

  test('a title falls back to the host, not the whole address', () => {
    const [favourite] = addBrowserFavourite([], { url: 'https://news.example.com/a/b?c=1' })

    // "news.example.com" fits under a tile. The full URL does not.
    assert.equal(favourite.title, 'news.example.com')
  })

  test('only pages worth putting on a home screen', () => {
    assert.equal(canFavouriteBrowserPage('web', 'https://example.com'), true)
    assert.equal(canFavouriteBrowserPage('hyper', 'hyper://abc/'), true)
    assert.equal(canFavouriteBrowserPage('home', 'peersky://home'), false)
    assert.equal(canFavouriteBrowserPage('web', 'https://user:pass@example.com'), false)
  })

  test('a corrupt or oversized file loads as an empty grid', () => {
    assert.deepEqual(parseBrowserFavourites('{not json'), [])
    assert.deepEqual(parseBrowserFavourites(null), [])
    // Written by hand, or by a build that allowed more.
    const tooMany = JSON.stringify({
      items: Array.from({ length: 30 }, (_, index) => ({
        url: `https://example.com/${index}`,
        title: 'x',
        createdAt: 1
      }))
    })
    assert.equal(parseBrowserFavourites(tooMany).length, MAX_BROWSER_FAVOURITES)
  })

  test('what is saved is what loads back', () => {
    const favourites = fill(3)

    assert.deepEqual(parseBrowserFavourites(serializeBrowserFavourites(favourites)), favourites)
  })

  test('a favourite is not a bookmark, and the menu says so', async () => {
    const menu = await readFile(
      new URL('../../app/settings/BrowserOverflowMenu.tsx', import.meta.url),
      'utf8'
    )

    // Two rows, two icons. The star used to do duty for bookmarks, which is
    // what made the two look like the same thing.
    assert.match(menu, /label=\{isBookmarked \? 'Remove Bookmark' : 'Add Bookmark'\}/)
    assert.match(menu, /label=\{isFavourited \? 'Remove Favourite' : 'Add Favourite'\}/)
    assert.match(menu, /isBookmarked \? <BookmarkFillIcon/)
    assert.match(menu, /isFavourited \? <StarFillIcon/)
  })

  test('the grid is on the home screen, and a long press takes one off it', async () => {
    const grid = await readFile(
      new URL('../../app/favourites/BrowserFavourites.tsx', import.meta.url),
      'utf8'
    )
    const index = await readFile(new URL('../../app/index.tsx', import.meta.url), 'utf8')

    assert.match(grid, /onLongPress=\{\(\) => onRemove\(favourite\)\}/)
    // Same tile as the built-in apps above it.
    assert.match(grid, /styles\.browserShortcut\b/)
    assert.match(index, /<BrowserFavourites/)
  })
})
