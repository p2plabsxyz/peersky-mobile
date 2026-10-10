export const READER_MESSAGE_TYPE = 'peersky-reader-page'
// A long article, with room for its images' addresses. More than this is not
// an article, and is too much to send across the bridge.
export const MAX_READER_HTML_LENGTH = 1024 * 1024
// Below this much text there is nothing worth reading on its own: a search
// results page, a login form, a list of links.
export const MIN_READER_TEXT_LENGTH = 500
export const READER_TEXT_SCALES = [85, 100, 115, 130, 150]
const MAX_READER_TITLE_LENGTH = 300
const MAX_READER_BYLINE_LENGTH = 200

/**
 * Reader view is for pages: a website or a hyper:// site, not the app's own
 * screens.
 */
export function canUseReaderView (targetUrl) {
  return /^(?:https?|hyper):\/\//i.test(String(targetUrl || ''))
}

/**
 * Finds the article on the page and sends it back as plain, safe markup.
 *
 * The part of the page holding the most paragraph text is the article, with
 * blocks named like comments, sharing or adverts taken out. What comes back is
 * rebuilt from a short list of text elements with no attributes but a link's
 * address and an image's, so nothing the page wrote runs or styles it.
 */
export function createReaderScript (token = '') {
  return `(() => {
    try {
      var doc = document;
      var UNLIKELY = /(^|[\\s_-])(comments?|disqus|share|sharing|social|related|recommend(ed|ations)?|promo|advert(isement)?|ads?|sponsor(ed)?|newsletter|subscribe|signup|cookie|consent|banner|sidebar|footer|masthead|menu|nav(bar)?|breadcrumbs?|pagination|popup|modal|outbrain|taboola)([\\s_-]|$)/i;
      var LIKELY = /article|body|content|entry|main|post|story|text/i;
      // Plus what print styles hide, a table of contents (its links jump to
      // places the reader page does not mark), and Wikipedia's edit links,
      // notes about other uses, notices about the article and boxes of links.
      var REMOVE = 'script,style,noscript,iframe,frame,object,embed,form,input,button,select,textarea,nav,aside,footer,svg,canvas,video,audio,dialog,template,link,meta,.noprint,.toc,#toc,.mw-editsection,.hatnote,.ambox,.navbox';
      var BLOCKS = { P: 1, H1: 1, H2: 1, H3: 1, H4: 1, H5: 1, H6: 1, UL: 1, OL: 1, LI: 1, BLOCKQUOTE: 1, PRE: 1, FIGURE: 1, FIGCAPTION: 1, TABLE: 1, THEAD: 1, TBODY: 1, TR: 1, TD: 1, TH: 1, DL: 1, DT: 1, DD: 1 };
      var INLINE = { CODE: 1, EM: 1, STRONG: 1, B: 1, I: 1, U: 1, SUP: 1, SUB: 1, SMALL: 1, MARK: 1, S: 1, Q: 1, ABBR: 1, TIME: 1 };
      var WRAPPERS = /^(DIV|SECTION|ARTICLE|MAIN|HEADER)$/;

      function text (el) { return (el && el.textContent || '').replace(/\\s+/g, ' ').trim(); }
      function names (el) {
        var className = typeof el.className === 'string' ? el.className : (el.getAttribute && el.getAttribute('class')) || '';
        return className + ' ' + (el.id || '');
      }
      function meta (selector) {
        var el = doc.querySelector(selector);
        return el ? String(el.getAttribute('content') || '').trim() : '';
      }
      function absolute (value) {
        if (!value) return '';
        try { return new URL(String(value).trim(), doc.baseURI).href; } catch (error) { return ''; }
      }
      function escapeText (value) {
        return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      }
      function escapeAttribute (value) { return escapeText(value).replace(/"/g, '&quot;'); }
      function imageSource (img) {
        var candidates = [img.currentSrc, img.getAttribute('src'), img.getAttribute('data-src'), img.getAttribute('data-lazy-src'), img.getAttribute('data-original')];
        var srcset = img.getAttribute('srcset') || img.getAttribute('data-srcset') || '';
        if (srcset) candidates.push(srcset.split(',').pop().trim().split(/\\s+/)[0]);
        for (var index = 0; index < candidates.length; index += 1) {
          var source = absolute(candidates[index]);
          if (/^(https?|hyper):/i.test(source)) return source;
        }
        return '';
      }
      function tiny (img) {
        var width = Number(img.getAttribute('width')) || img.naturalWidth || 0;
        var height = Number(img.getAttribute('height')) || img.naturalHeight || 0;
        return (width > 0 && width < 48) || (height > 0 && height < 48);
      }

      // Text as read: what a style or script element holds is not. Wikipedia
      // puts styles inside its boxes, and their commas scored as prose.
      function readable (el) {
        var walker = doc.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
        var parts = [];
        for (var node = walker.nextNode(); node; node = walker.nextNode()) {
          if (!/^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE)$/.test(node.parentNode && node.parentNode.nodeName)) parts.push(node.nodeValue);
        }
        return parts.join(' ').replace(/\\s+/g, ' ').trim();
      }

      // Each paragraph scores for the three elements around it, less the
      // further out they are. A div with text and no blocks inside counts as a
      // paragraph, since plenty of sites write them that way. List items do
      // not: a long list of references outscored the article it belongs to.
      var paragraphs = Array.prototype.slice.call(doc.querySelectorAll('p, pre'));
      doc.querySelectorAll('div').forEach(function (div) {
        if (!div.querySelector('p, div, section, article, table, ul, ol, dl, pre, blockquote, h1, h2, h3, h4, h5, h6, figure, form, header, footer, nav, aside, main, style, script')) paragraphs.push(div);
      });
      var scores = new Map();
      paragraphs.forEach(function (p) {
        var value = readable(p);
        if (value.length < 25) return;
        var score = 1 + value.split(',').length + Math.min(Math.floor(value.length / 100), 3);
        var ancestor = p.parentElement;
        for (var level = 0; ancestor && level < 3; level += 1, ancestor = ancestor.parentElement) {
          scores.set(ancestor, (scores.get(ancestor) || 0) + score / (level + 1));
        }
      });
      var ranked = [];
      scores.forEach(function (score, el) {
        var label = names(el);
        if (UNLIKELY.test(label) && !LIKELY.test(label)) score *= 0.3;
        var length = readable(el).length || 1;
        var linked = 0;
        el.querySelectorAll('a').forEach(function (a) { linked += text(a).length; });
        ranked.push({ el: el, score: score * (1 - Math.min(linked / length, 0.9)) });
      });
      ranked.sort(function (a, b) { return b.score - a.score; });
      var best = ranked.length ? ranked[0].el : null;
      // An article in sections has one section win on its own. When other
      // good parts sit beside it, the article is the element holding the most
      // of them: the first one holding a few was only a section with its own
      // subsections.
      if (best) {
        var beside = ranked.slice(1, 12).filter(function (item) {
          return item.score >= ranked[0].score * 0.5 && !item.el.contains(best) && !best.contains(item.el);
        });
        var mostHeld = 1;
        var holder = null;
        for (var up = best.parentElement; beside.length >= 2 && up && up !== doc.body && up !== doc.documentElement; up = up.parentElement) {
          var held = beside.filter(function (item) { return up.contains(item.el); }).length;
          if (held > mostHeld) { mostHeld = held; holder = up; }
        }
        if (holder) best = holder;
      }
      // An article element around it brings its title and pictures along.
      var around = best && best.closest && best.closest('article');
      if (around && text(around).length < text(best).length * 3) best = around;

      var siteName = meta('meta[property="og:site_name"]') || location.hostname || '';
      var title = meta('meta[property="og:title"]') || meta('meta[name="twitter:title"]') || doc.title || '';
      // "Peer-to-peer - Wikipedia" is the page's heading with the site after
      // it: the heading alone, or the title without the site's name.
      var pageHeading = text(doc.querySelector('h1'));
      var parts = title.split(/\\s[|\\-\\u2013\\u2014:]\\s/);
      if (pageHeading.length >= 3 && title.indexOf(pageHeading) === 0) title = pageHeading;
      else if (parts.length > 1 && parts[parts.length - 1].trim().toLowerCase() === siteName.toLowerCase()) title = parts.slice(0, -1).join(' - ');
      title = title.trim();
      var byline = meta('meta[name="author"]') || meta('meta[property="article:author"]');
      if (/^https?:/i.test(byline)) byline = '';

      var html = '';
      var length = 0;
      if (best) {
        var clone = best.cloneNode(true);
        clone.querySelectorAll(REMOVE).forEach(function (el) { el.remove(); });
        clone.querySelectorAll('[hidden], [aria-hidden="true"]').forEach(function (el) { el.remove(); });
        clone.querySelectorAll('div, section, ul, ol, header, span, p').forEach(function (el) {
          var label = names(el);
          if (UNLIKELY.test(label) && !LIKELY.test(label) && text(el).length < 400) el.remove();
        });
        // The title is shown above the article already.
        var heading = clone.querySelector('h1');
        if (heading && text(heading).toLowerCase() === title.trim().toLowerCase()) heading.remove();

        var out = [];
        (function build (node) {
          for (var child = node.firstChild; child; child = child.nextSibling) {
            if (child.nodeType === 3) { out.push(escapeText(child.nodeValue)); continue; }
            if (child.nodeType !== 1) continue;
            var tag = child.tagName;
            if (tag === 'IMG') {
              var source = imageSource(child);
              if (source && !tiny(child)) out.push('<img src="' + escapeAttribute(source) + '" alt="' + escapeAttribute(child.getAttribute('alt') || '') + '">');
              continue;
            }
            if (tag === 'BR') { out.push('<br>'); continue; }
            if (tag === 'HR') { out.push('<hr>'); continue; }
            if (tag === 'A') {
              var href = absolute(child.getAttribute('href'));
              out.push(/^(https?|hyper):/i.test(href) ? '<a href="' + escapeAttribute(href) + '">' : '<a>');
              build(child);
              out.push('</a>');
              continue;
            }
            if (BLOCKS[tag] || INLINE[tag]) {
              var name = tag.toLowerCase();
              out.push('<' + name + '>');
              build(child);
              out.push('</' + name + '>');
              continue;
            }
            if (WRAPPERS.test(tag)) { out.push('<div>'); build(child); out.push('</div>'); continue; }
            build(child);
          }
        })(clone);
        html = out.join('').replace(/<div>\\s*<\\/div>/g, '');
        length = text(clone).length;
      }

      var message = {
        type: ${JSON.stringify(READER_MESSAGE_TYPE)},
        token: ${JSON.stringify(String(token || ''))},
        ok: length >= ${MIN_READER_TEXT_LENGTH} && html.length <= ${MAX_READER_HTML_LENGTH},
        title: title.slice(0, ${MAX_READER_TITLE_LENGTH}),
        byline: byline.slice(0, ${MAX_READER_BYLINE_LENGTH}),
        siteName: siteName.slice(0, ${MAX_READER_TITLE_LENGTH}),
        lang: (doc.documentElement.getAttribute('lang') || '').slice(0, 35),
        dir: doc.documentElement.getAttribute('dir') === 'rtl' || doc.dir === 'rtl' ? 'rtl' : 'ltr',
        html: html.length <= ${MAX_READER_HTML_LENGTH} ? html : ''
      };
      // Sent through the bridge's sender, taken before the page could replace
      // JSON.stringify and read the token out of this message.
      if (typeof window.__peerskyPostNative === 'function') window.__peerskyPostNative(message);
      else window.ReactNativeWebView.postMessage(JSON.stringify(message));
    } catch (error) {}
  })(); true;`
}

/**
 * The article a page sent back, or null for anything else. ok is false when
 * the page had no article to show.
 */
export function parseReaderMessage (message, expectedToken = '') {
  let parsed
  try {
    parsed = JSON.parse(String(message || ''))
  } catch {
    return null
  }
  if (parsed?.type !== READER_MESSAGE_TYPE) return null
  if (!expectedToken || parsed.token !== expectedToken) return null
  const html = typeof parsed.html === 'string' ? parsed.html : ''
  const ok = parsed.ok === true && html.length > 0 && html.length <= MAX_READER_HTML_LENGTH
  return {
    ok,
    title: oneLine(parsed.title, MAX_READER_TITLE_LENGTH),
    byline: oneLine(parsed.byline, MAX_READER_BYLINE_LENGTH),
    siteName: oneLine(parsed.siteName, MAX_READER_TITLE_LENGTH),
    lang: /^[a-z]{2,3}(-[a-z0-9]{1,8})*$/i.test(String(parsed.lang || '')) ? parsed.lang : '',
    dir: parsed.dir === 'rtl' ? 'rtl' : 'ltr',
    html: ok ? sanitizeReaderHtml(html) : ''
  }
}

const READER_TAGS = new Set([
  'a', 'abbr', 'b', 'blockquote', 'br', 'code', 'dd', 'div', 'dl', 'dt', 'em', 'figcaption', 'figure',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'i', 'img', 'li', 'mark', 'ol', 'p', 'pre', 'q', 's',
  'small', 'strong', 'sub', 'sup', 'table', 'tbody', 'td', 'th', 'thead', 'time', 'tr', 'u', 'ul'
])

/**
 * The markup the page sent, kept to the tags the reader script writes, with
 * no attributes but a link's address and an image's address and description.
 * The script already writes nothing else; this holds even if the page got in
 * its way.
 */
export function sanitizeReaderHtml (html) {
  return String(html || '').replace(/<(\/?)([a-z][a-z0-9]*)\b([^>]*)>/gi, (whole, closing, tagName, rest) => {
    const tag = tagName.toLowerCase()
    if (!READER_TAGS.has(tag)) return ''
    if (closing) return tag === 'br' || tag === 'hr' || tag === 'img' ? '' : `</${tag}>`
    if (tag === 'a') {
      const href = readerAttribute(rest, 'href')
      return /^(?:https?|hyper):/i.test(href) ? `<a href="${href}">` : '<a>'
    }
    if (tag === 'img') {
      const src = readerAttribute(rest, 'src')
      if (!/^(?:https?|hyper):/i.test(src)) return ''
      return `<img src="${src}" alt="${readerAttribute(rest, 'alt')}">`
    }
    return `<${tag}>`
  })
}

// Written by the reader script as name="value", already escaped.
function readerAttribute (attributes, name) {
  const match = new RegExp(`\\s${name}="([^"<>]*)"`, 'i').exec(attributes)
  return match ? match[1] : ''
}

/**
 * The page Reader view shows: the article in one readable column, in the
 * app's light or dark colours, at the chosen text size. Nothing in it runs:
 * the policy allows no scripts, and the WebView has them off as well.
 */
export function createReaderHtml (article, { isDark = false, textScale = 100 } = {}) {
  const scale = READER_TEXT_SCALES.includes(textScale) ? textScale : 100
  const colors = isDark
    ? { background: '#16181d', text: '#e6e8ee', muted: '#9aa3b5', link: '#8fc0ff', rule: '#2c313c', code: '#232730' }
    : { background: '#fbfbf9', text: '#1d2230', muted: '#667085', link: '#1f6fd1', rule: '#e4e7ec', code: '#f0f2f5' }
  const lang = article.lang ? ` lang="${escapeAttribute(article.lang)}"` : ''

  return `<!doctype html>
<html${lang} dir="${article.dir === 'rtl' ? 'rtl' : 'ltr'}">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https: http: hyper: data:; style-src 'unsafe-inline'; form-action 'none'; base-uri 'none'">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeText(article.title)}</title>
<style>
  :root { color-scheme: ${isDark ? 'dark' : 'light'}; }
  html { -webkit-text-size-adjust: 100%; }
  body {
    background: ${colors.background};
    color: ${colors.text};
    font: ${(18 * scale / 100).toFixed(1)}px/1.65 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Georgia, serif;
    margin: 0 auto;
    max-width: 680px;
    overflow-wrap: anywhere;
    padding: 20px 22px 64px;
  }
  .site { color: ${colors.muted}; font-size: 0.8em; font-weight: 600; letter-spacing: 0.02em; margin: 0 0 6px; }
  h1.title { font-size: 1.55em; line-height: 1.25; margin: 0 0 8px; }
  .byline { color: ${colors.muted}; font-size: 0.85em; margin: 0 0 18px; }
  hr.top { border: 0; border-top: 1px solid ${colors.rule}; margin: 0 0 18px; }
  article h1, article h2, article h3, article h4 { line-height: 1.3; margin: 1.4em 0 0.5em; }
  article p, article ul, article ol, article blockquote, article pre, article figure, article table { margin: 0 0 1em; }
  article img { border-radius: 6px; display: block; height: auto; margin: 1em auto; max-width: 100%; }
  article figcaption { color: ${colors.muted}; font-size: 0.8em; text-align: center; }
  article a { color: ${colors.link}; }
  article blockquote { border-left: 3px solid ${colors.rule}; color: ${colors.muted}; margin-left: 0; padding-left: 14px; }
  article pre, article code { background: ${colors.code}; border-radius: 4px; font-family: ui-monospace, Menlo, monospace; font-size: 0.85em; }
  article pre { overflow-x: auto; padding: 10px 12px; white-space: pre-wrap; }
  article table { border-collapse: collapse; display: block; overflow-x: auto; }
  article td, article th { border: 1px solid ${colors.rule}; padding: 4px 8px; }
</style>
</head>
<body>
${article.siteName ? `<p class="site">${escapeText(article.siteName)}</p>` : ''}
<h1 class="title">${escapeText(article.title)}</h1>
${article.byline ? `<p class="byline">${escapeText(article.byline)}</p>` : ''}
<hr class="top">
<article>${article.html}</article>
</body>
</html>`
}

function oneLine (value, maxLength) {
  return Array.from(String(value || ''))
    .map((character) => isShownCharacter(character) ? character : ' ')
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength)
}

function isShownCharacter (character) {
  const codePoint = character.codePointAt(0)
  return !(
    codePoint < 32 ||
    (codePoint >= 127 && codePoint <= 159) ||
    (codePoint >= 0x202a && codePoint <= 0x202e) ||
    (codePoint >= 0x2066 && codePoint <= 0x2069)
  )
}

function escapeText (value) {
  return String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function escapeAttribute (value) {
  return escapeText(value).replace(/"/g, '&quot;')
}
