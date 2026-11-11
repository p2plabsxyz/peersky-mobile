export const YOUTUBE_AD_BREAK_PATH = '/youtubei/v1/player/ad_break'

// YouTube sends its video ads inside the data its player plays from: the ad
// breaks (adPlacements), what plays in them (playerAds, adSlots) and when to
// ask for more (adBreakHeartbeatParams). Blocking the ad_break request alone
// left all of those to play.
export const YOUTUBE_AD_KEYS = Object.freeze([
  'adPlacements',
  'adSlots',
  'playerAds',
  'adBreakHeartbeatParams'
])

// List items that are ads: the sponsored cards among videos and results.
export const YOUTUBE_AD_ITEMS = Object.freeze([
  'adSlotRenderer',
  'compactPromotedVideoRenderer',
  'displayAdRenderer',
  'inFeedAdLayoutRenderer',
  'promotedSparklesTextSearchRenderer',
  'promotedSparklesWebRenderer',
  'promotedVideoRenderer',
  'searchPyvRenderer'
])

// The same cards as the page draws them, hidden in case one comes from data
// read before this ran. Nothing of the player's own ad display is hidden, so
// an ad that still plays keeps its Skip button.
const YOUTUBE_AD_ELEMENTS = [
  'ad-slot-renderer',
  'ytm-promoted-sparkles-web-renderer',
  'ytm-promoted-video-renderer',
  'ytm-companion-ad-renderer',
  'ytd-ad-slot-renderer',
  'ytd-in-feed-ad-layout-renderer',
  'ytd-promoted-sparkles-web-renderer',
  'ytd-promoted-video-renderer',
  'ytd-compact-promoted-video-renderer',
  'ytd-display-ad-renderer',
  'ytd-search-pyv-renderer'
]

// Code for YouTube pages that takes the ads out of that data before
// YouTube's own scripts read it: the data a page starts with
// (ytInitialPlayerResponse, ytInitialData), and the JSON it parses as it
// moves to another video or loads more of a list. It does nothing on other
// sites. Placed in the content-blocking script, before the page's scripts.
export function createYoutubeAdBlockingScript () {
  const keys = JSON.stringify(YOUTUBE_AD_KEYS)
  const items = JSON.stringify(YOUTUBE_AD_ITEMS)
  const hint = `"(?:${[...YOUTUBE_AD_KEYS, ...YOUTUBE_AD_ITEMS].join('|')})"`
  const css = `${YOUTUBE_AD_ELEMENTS.join(', ')} { display: none !important; }`
  const wrappedCss = 'ytm-rich-item-renderer:has(> ad-slot-renderer), ytd-rich-item-renderer:has(ytd-ad-slot-renderer) { display: none !important; }'

  return `
      (() => {
        let page;
        try {
          page = new URL(location.href);
        } catch {
          return;
        }
        const host = page.hostname;
        if (
          page.protocol !== 'https:' ||
          !(host === 'youtube.com' || host.endsWith('.youtube.com') ||
            host === 'youtube-nocookie.com' || host.endsWith('.youtube-nocookie.com'))
        ) return;

        const adKeys = ${keys};
        const adItems = new Set(${items});
        const hint = new RegExp(${JSON.stringify(hint)});

        // A list item is an ad when it is one of the ad cards, or a grid
        // cell holding one.
        function isAd(item) {
          if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
          for (const key of Object.keys(item)) {
            if (adItems.has(key)) return true;
            const content = item[key] && item[key].content;
            if (content && typeof content === 'object' && Object.keys(content).some((inner) => adItems.has(inner))) {
              return true;
            }
          }
          return false;
        }

        function clean(value, depth) {
          if (!value || typeof value !== 'object' || depth > 200) return value;
          try {
            if (Array.isArray(value)) {
              for (let i = value.length - 1; i >= 0; i--) {
                if (isAd(value[i])) value.splice(i, 1);
                else clean(value[i], depth + 1);
              }
              return value;
            }
            for (const key of adKeys) {
              if (Object.prototype.hasOwnProperty.call(value, key)) delete value[key];
            }
            for (const key of Object.keys(value)) clean(value[key], depth + 1);
          } catch {}
          return value;
        }

        // The data a page starts with is set by its own inline scripts,
        // which run after this one: catch it as it is set.
        for (const name of ['ytInitialPlayerResponse', 'ytInitialData']) {
          let current = clean(window[name], 0);
          try {
            Object.defineProperty(window, name, {
              configurable: true,
              enumerable: true,
              get: () => current,
              set: (next) => {
                current = clean(next, 0);
              }
            });
          } catch {}
        }

        // What the page fetches later, read with JSON.parse or as a
        // response's json().
        if (typeof JSON === 'object' && typeof JSON.parse === 'function') {
          JSON.parse = new Proxy(JSON.parse, {
            apply(target, self, args) {
              const result = Reflect.apply(target, self, args);
              if (typeof args[0] === 'string' && hint.test(args[0])) clean(result, 0);
              return result;
            }
          });
        }
        const response = typeof Response === 'function' && Response.prototype;
        if (response && typeof response.json === 'function') {
          response.json = new Proxy(response.json, {
            apply(target, self, args) {
              const result = Reflect.apply(target, self, args);
              if (!self || typeof self.url !== 'string' || !self.url.includes('/youtubei/')) return result;
              return result.then((data) => clean(data, 0));
            }
          });
        }

        if (typeof document === 'object' && typeof document.createElement === 'function') {
          const style = document.createElement('style');
          style.textContent = ${JSON.stringify(css)} + '\\n' + ${JSON.stringify(wrappedCss)};
          const add = () => {
            const parent = document.head || document.documentElement;
            if (parent && !style.isConnected) parent.appendChild(style);
          };
          add();
          document.addEventListener('DOMContentLoaded', add);
        }
      })();
  `
}
