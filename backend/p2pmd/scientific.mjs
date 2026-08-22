import MarkdownIt from 'markdown-it'
import katexPluginModule from '@vscode/markdown-it-katex'
import b4a from 'b4a'

const MAX_MATH_EXPRESSION_LENGTH = 10000
const MAX_MATH_EXPRESSIONS = 2000
const MAX_TOTAL_MATH_SOURCE_LENGTH = 256 * 1024
export const MAX_RENDERED_MARKDOWN_BYTES = 10 * 1024 * 1024
const HTML_COMMENT_PATTERN = /<!--[\s\S]*?-->/g
const katexPlugin = katexPluginModule.default || katexPluginModule

export const P2PMD_SCIENTIFIC_STYLES = `
.katex-display { margin: .8em 0; overflow-x: auto; overflow-y: hidden; }
.katex-error { color: #ef8f8f; font-family: ui-monospace, monospace; overflow-wrap: anywhere; }
.p2pmd-ieee-preview { background: #eef0f3 !important; color: #111 !important; padding: 6px !important; }
.ieee-page-stack { display: flex; flex-direction: column; align-items: center; gap: 10px; width: 100%; }
.ieee-preview-page { position: relative; flex: 0 0 auto; width: calc(210mm * var(--ieee-fit-scale, 1)); height: calc(297mm * var(--ieee-fit-scale, 1)); overflow: hidden; background: #fff; box-shadow: 0 2px 10px rgba(0, 0, 0, .18); }
.ieee-preview-page-inner { box-sizing: border-box; display: flex; flex-direction: column; width: 210mm; height: 297mm; padding: .75in .625in 1in; overflow: hidden; font: .92rem/1.15 "Times New Roman", Times, serif; transform: scale(var(--ieee-fit-scale, 1)); transform-origin: top left; }
.ieee-preview-columns { flex: 1; min-height: 0; overflow: hidden; column-count: 2; column-gap: 1.35rem; column-fill: auto; border-top: 0; padding-top: 0; }
.ieee-preview-page--first .ieee-preview-columns { border-top: 1px solid #000; padding-top: .55rem; }
.ieee-paper-layout { box-sizing: border-box; width: 210mm; min-height: 297mm; margin: 0 auto; padding: .75in .625in 1in; background: #fff; color: #111; font: .92rem/1.15 "Times New Roman", Times, serif; }
.ieee-frontmatter { margin: 0 0 .4rem; text-align: center; }
.ieee-title { margin: 0 0 .3rem; text-align: center; line-height: 1.15; }
.ieee-authors { max-width: 46rem; margin: 0 auto; }
.ieee-authors-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(0, 1fr)); gap: .8rem 1.2rem; align-items: start; }
.ieee-authors-grid--1 { grid-template-columns: minmax(0, 1fr); max-width: 14rem; margin: 0 auto; }
.ieee-authors-grid--2 { grid-template-columns: repeat(2, minmax(0, 1fr)); max-width: 28rem; margin: 0 auto; }
.ieee-authors-grid--3 { grid-template-columns: repeat(3, minmax(0, 1fr)); }
.ieee-authors-grid--4 { grid-template-columns: repeat(4, minmax(0, 1fr)); }
.ieee-author-col { min-width: 0; }
.ieee-author-col p { margin: 0 0 .2rem; text-align: center; line-height: 1.24; }
.ieee-columns { column-count: 2; column-gap: 1.35rem; border-top: 1px solid #000; padding-top: .55rem; }
.ieee-columns > :is(figure, table, pre, blockquote, .katex-block) { break-inside: avoid; }
.ieee-columns > :is(h1, h2, h3, h4, h5, h6):first-child { column-span: all; margin: 0 0 .4rem; text-align: center; }
.ieee-columns > :is(h2, h3, h4, h5, h6) { margin: .7rem 0 .2rem; text-align: center; }
.ieee-abstract-block { break-inside: avoid; margin-bottom: .3rem; }
.ieee-abstract-heading { margin-bottom: .15rem; text-align: center; }
.ieee-columns p { margin: 0 0 .3rem; text-align: justify; }
.ieee-columns ul, .ieee-columns ol { margin: 0 0 .3rem .9rem; }
.ieee-columns table { width: calc(100% - 2px); border-collapse: collapse; font-size: .82rem; }
.ieee-columns th, .ieee-columns td { border: 1px solid #9ca3af; padding: 3px 5px; text-align: left; }
.ieee-columns th { background: #f5f5f5; }
.ieee-columns img { display: block; max-width: 90%; height: auto; margin: .3rem auto; }
.ieee-figure-caption { margin: .15rem 0 .4rem; font-size: .78rem; text-align: center; }
.ieee-columns pre, .ieee-columns code { background: none; color: inherit; font: .78rem/1.3 Menlo, Monaco, Consolas, monospace; }
.ieee-columns pre { overflow: hidden; white-space: pre-wrap; overflow-wrap: anywhere; }
.ieee-reference-list { margin-left: 0; padding-left: 0; list-style: none; }
.ieee-reference-list li { margin-bottom: .2rem; padding-left: 1.1rem; text-indent: -1.1rem; }
.ieee-columns .katex-display { max-width: 100%; overflow: hidden; font-size: .8em; }
.ieee-preview-columns > :is(figure, table, pre, blockquote, .katex-block) { break-inside: avoid; }
.ieee-preview-columns p { margin: 0 0 .3rem; text-align: justify; }
.ieee-preview-columns table { width: calc(100% - 2px); border-collapse: collapse; font-size: .82rem; }
.ieee-preview-columns th, .ieee-preview-columns td { border: 1px solid #9ca3af; padding: 3px 5px; text-align: left; }
.ieee-preview-columns img { display: block; max-width: 90%; height: auto; margin: .3rem auto; }
.ieee-preview-columns pre { overflow: hidden; white-space: pre-wrap; overflow-wrap: anywhere; }
.ieee-preview-columns .katex-display { max-width: 100%; overflow: hidden; font-size: .8em; }
`

export function createP2pmdMarkdownRenderer () {
  const renderer = new MarkdownIt({
    // Security-critical: output is injected into a WebView and published HTML.
    html: false,
    linkify: true,
    breaks: true
  })

  renderer.use(katexPlugin, {
    throwOnError: false,
    trust: false,
    strict: 'ignore',
    maxSize: 20,
    maxExpand: 1000
  })

  for (const ruleName of ['math_inline', 'math_block']) {
    const renderMath = renderer.renderer.rules[ruleName]
    if (!renderMath) continue

    renderer.renderer.rules[ruleName] = function (tokens, index, options, env, self) {
      if (tokens[index].content.length <= MAX_MATH_EXPRESSION_LENGTH) {
        return renderMath(tokens, index, options, env, self)
      }

      return `<span class="katex-error">${renderer.utils.escapeHtml('Math expression is too long.')}</span>`
    }
  }

  return renderer
}

export function renderP2pmdMarkdown (renderer, content) {
  const source = stripHtmlComments(String(content || ''))
  const env = {}
  const tokens = renderer.parse(source, env)
  validateMathBudget(tokens)

  const html = renderer.renderer.render(tokens, renderer.options, env)
  assertRenderedMarkdownSize(html)
  return html
}

export function assertRenderedMarkdownSize (html) {
  if (b4a.byteLength(String(html || '')) > MAX_RENDERED_MARKDOWN_BYTES) {
    throw new RangeError('Rendered Markdown is too large. Maximum size is 10 MB.')
  }
}

function validateMathBudget (tokens) {
  let expressionCount = 0
  let sourceLength = 0

  visitTokens(tokens, (token) => {
    if (token.type !== 'math_inline' && token.type !== 'math_block') return
    expressionCount += 1
    sourceLength += token.content.length
  })

  if (expressionCount > MAX_MATH_EXPRESSIONS || sourceLength > MAX_TOTAL_MATH_SOURCE_LENGTH) {
    throw new RangeError('Document contains too much LaTeX to render safely.')
  }
}

function visitTokens (tokens, visitor) {
  for (const token of tokens) {
    visitor(token)
    if (Array.isArray(token.children)) visitTokens(token.children, visitor)
  }
}

// Match desktop behavior while preserving newlines for source-line mapping.
export function stripHtmlComments (content) {
  return String(content || '').replace(
    HTML_COMMENT_PATTERN,
    (comment) => comment.replace(/[^\n]/g, '')
  )
}
