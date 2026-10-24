/**
 * In the page: functions the scraper runs inside the browser, in a world of
 * its own (so a site's replaced globals stay out of it), handed over as
 * source. Each is self-contained; script() puts the helpers a call needs
 * beside it, so the shadow-root walker is sent only when a call asks for it.
 *
 * Domain:
 *   Root     where a selector looks: the page's document, or a document parsed
 *            from given HTML, apart from the page (DOMParser runs no scripts)
 *   Match    what a selector finds, as plain data: {text, attributes, html},
 *            its text as shown (innerText; textContent where nothing is laid
 *            out, as in parsed HTML), its attributes by name, its outerHTML
 */

/**
 * Every element under a root, through open shadow roots, that matches a CSS
 * selector, in document order. Adapted from Puppeteer's pierceQuerySelectorAll
 * (Apache-2.0, Copyright 2022 Google Inc.). Closed shadow roots stay closed.
 */
export function pierceAll(root, selector) {
  const found = []
  const collect = (node) => {
    const walker = (node.ownerDocument ?? node).createTreeWalker(node, NodeFilter.SHOW_ELEMENT)
    for (let element = walker.nextNode(); element; element = walker.nextNode()) {
      if (element.matches(selector)) found.push(element)
      if (element.shadowRoot) collect(element.shadowRoot)
    }
  }
  collect(root)
  return found
}

// The root a selector looks in: the page's document, or the HTML given, parsed.
export function rootOf(html) {
  return html === undefined ? document : new DOMParser().parseFromString(html, 'text/html')
}

// The nodes a selector finds under a root, by its kind; through open shadow
// roots when a walker for them is given.
export function matchesIn(root, {kind, selector}, pierce) {
  if (kind === 'xpath') {
    const found = (root.ownerDocument ?? root).evaluate(selector, root, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null)
    return Array.from({length: found.snapshotLength}, (_, index) => found.snapshotItem(index))
  }
  return pierce ? pierce(root, selector) : Array.from(root.querySelectorAll(selector))
}

// A node a selector found, as plain data; a text or attribute node XPath
// found is its text.
export function matchOf(node) {
  if (node.nodeType !== Node.ELEMENT_NODE) return {text: node.textContent.trim(), attributes: {}, html: node.textContent}
  return {
    text: (node.innerText ?? node.textContent).trim(),
    attributes: Object.fromEntries(Array.from(node.attributes, ({name, value}) => [name, value])),
    html: node.outerHTML
  }
}

// What a selector matches in the page, or in the HTML given, as plain data.
export function readMatches({selector, html}, pierce) {
  return matchesIn(rootOf(html), selector, pierce).map(matchOf)
}

// How many elements a selector matches in the page.
export function countMatches({selector}, pierce) {
  return matchesIn(document, selector, pierce).length
}

// The first element a selector matches in the page: what an action acts on.
export function firstMatch({selector}, pierce) {
  return matchesIn(document, selector, pierce)[0]
}

// The first box an element is shown in, within its frame's view; null when
// it isn't laid out. Called on the element.
export function firstBox() {
  const [rect] = this.getClientRects()
  return rect ? {x: rect.x, y: rect.y, width: rect.width, height: rect.height} : null
}

// Where an iframe shows its frame, within the view of the frame it's in:
// inside its border and padding. Called on the iframe.
export function contentBox() {
  const rect = this.getBoundingClientRect()
  const style = getComputedStyle(this)
  const px = (name) => parseFloat(style[name])
  return {
    x: rect.x + px('borderLeftWidth') + px('paddingLeft'),
    y: rect.y + px('borderTopWidth') + px('paddingTop'),
    width: this.clientWidth - px('paddingLeft') - px('paddingRight'),
    height: this.clientHeight - px('paddingTop') - px('paddingBottom')
  }
}

// Resolves once the frame has been drawn twice more: since it was asked, and
// after that. Called on an element in it.
export function drawn() {
  return new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
}

/**
 * An expression running fn in the page with args, beside the helpers it uses,
 * and the shadow-root walker when it's to reach into shadow roots.
 */
export function script(fn, args, {shadow = false} = {}) {
  const helpers = [rootOf, matchesIn, matchOf, ...(shadow ? [pierceAll] : [])]
  const declared = helpers.map(helper => `const ${helper.name} = ${helper}`).join('\n')
  return `(() => {\n${declared}\nreturn (${fn})(${JSON.stringify(args)}, ${shadow ? 'pierceAll' : 'undefined'})\n})()`
}
