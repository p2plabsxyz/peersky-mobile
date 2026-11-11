// Search engines Custom can pick by name, each with its search URL.
//
// Most come from Chromium's list of the engines it offers around the world,
// definitions/prepopulated_engines.json in
// https://chromium.googlesource.com/external/search_engines_data (BSD-3-Clause,
// The Chromium Authors; credited in Settings > About > Open-source licenses).
// Its addresses carry Chrome's own fields and partner codes, such as
// {google:baseURL}, {inputEncoding}, fr=crmas or segment=info.0472, which a
// browser that is not Chrome has no business sending, so each here is the
// engine's plain search address with %s for the words. Yahoo and Yandex are
// listed there once a country; here once, with Yahoo! JAPAN and Яндекс,
// which are run apart. The engines Settings offers by name are left out, as
// they are a tap away already.
//
// A few privacy-minded engines Chromium does not list come after, at the end.
// Every engine in this list answered a search on 2026-11-11, or showed the check
// Cloudflare puts in front of a browser; ones that wanted an account did not
// stay.
export const KNOWN_SEARCH_ENGINES = /** @type {const} */ ([
  { name: 'Google', url: 'https://www.google.com/search?q=%s' },
  { name: 'Microsoft Bing', url: 'https://www.bing.com/search?q=%s' },
  { name: 'Brave Search', url: 'https://search.brave.com/search?q=%s' },
  { name: 'Qwant', url: 'https://www.qwant.com/?q=%s' },
  { name: 'Mojeek', url: 'https://www.mojeek.com/search?q=%s' },
  { name: 'Yahoo!', url: 'https://search.yahoo.com/search?p=%s' },
  { name: 'Yahoo! JAPAN', url: 'https://search.yahoo.co.jp/search?p=%s' },
  { name: 'Yandex', url: 'https://yandex.com/search/?text=%s' },
  { name: 'Яндекс', url: 'https://yandex.ru/search/?text=%s' },
  { name: '百度', url: 'https://www.baidu.com/s?ie=utf-8&wd=%s' },
  { name: '네이버', url: 'https://search.naver.com/search.naver?ie=utf8&query=%s' },
  { name: 'Daum', url: 'https://search.daum.net/search?w=tot&q=%s' },
  { name: 'Seznam.cz', url: 'https://search.seznam.cz/?q=%s' },
  { name: '360', url: 'https://www.so.com/s?ie=utf-8&q=%s' },
  { name: '搜狗', url: 'https://www.sogou.com/web?ie=utf8&query=%s' },
  { name: 'Cốc Cốc', url: 'https://coccoc.com/search#query=%s' },
  { name: 'Mail.ru', url: 'https://go.mail.ru/search?q=%s' },
  { name: 'Perplexity', url: 'https://www.perplexity.ai/search?q=%s' },
  { name: 'Freespoke', url: 'https://freespoke.com/search/web?q=%s' },
  { name: 'Info.com', url: 'https://www.info.com/serp?q=%s' },
  { name: 'Karma Search', url: 'https://karmasearch.org/search?q=%s' },
  { name: 'Lilo', url: 'https://search.lilo.org/?q=%s' },
  { name: 'Nona', url: 'https://www.nona.de/?q=%s' },
  { name: 'OceanHero', url: 'https://oceanhero.today/web?q=%s' },
  { name: 'WWF Panda Search', url: 'https://panda-search.org/search/?q=%s' },
  { name: 'PrivacyWall', url: 'https://www.privacywall.org/search/secure/?q=%s' },
  { name: 'Quendu', url: 'https://www.quendu.com/search?q=%s' },
  { name: 'Yep', url: 'https://yep.com/web?q=%s' },
  // Not in Chromium's list.
  { name: 'Swisscows', url: 'https://swisscows.com/en/web?query=%s' },
  { name: 'Marginalia Search', url: 'https://marginalia-search.com/search?query=%s' },
  { name: 'Presearch', url: 'https://presearch.com/search?q=%s' }
])
