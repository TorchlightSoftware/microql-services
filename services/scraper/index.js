/**
 * Scraper: what web pages show, read with selectors in a real browser, and
 * the actions a person takes there (opening, clicking, typing, scrolling).
 *
 * The browser is the runtime's: each call works in a browser session, a page
 * of its own in a browser context of its own, a handle the Query names
 * (`session`, default 'default'). The call is given the session's page, the
 * Chrome DevTools Protocol confined to it: `send` and `on`. The scraper keeps
 * no state of its own: the session is the state, which the runtime keeps, and
 * MicroQL runs a session's calls one at a time, and never reuses one.
 *
 * A call reads and acts in the session's page, or in a frame within it the
 * Query names (`frame`, see frames.js): an iframe by a CSS selector, or a
 * path of them into nested iframes. /open opens its URL in the page, and
 * /keysequence presses keys to what has the focus, wherever it is: for
 * them, `frame` names where select reads.
 *
 * Domain:
 *   Session   a page the Query names, kept by the runtime, for one phase
 *   Frame     where in the session's page a call works: its main frame, or
 *             an iframe the call names (see frames.js)
 *   Selector  how a Query names elements: CSS by default, or XPath, with
 *             modifiers its matches must fit (see selectors.js)
 *   Match     what a selector finds, as plain data: {text, attributes, html}
 *   select    what a call reads, by key, right after its action: every call
 *             returns what it read, and {} when it reads nothing
 */

import {defineService, util, parseSchema} from 'microql'
import {selectorOf} from './selectors.js'
import {read, locationOf, open, click, type, pressKeys, scrollTo, scrollBy, screenshot, evaluate, answeringDialogs} from './page.js'
import {frameOf} from './frames.js'

// A select, read: each key's selector, checked before the page is touched;
// with `read` saying how each is read.
const selectorsOf = (select = {}, readSelector = selectorOf) =>
  Object.fromEntries(Object.entries(select).map(([key, value]) => [key, readSelector(key, value)]))

// A selector /waitFor reads: one with no modifiers waits for at least one match.
const awaited = (key, value) => {
  const selector = selectorOf(key, value)
  return selector.modifiers.length ? selector : {...selector, modifiers: [{min: 1}]}
}

// How far a scroll goes, as wheel deltas; directions that undo each other are refused.
function deltasOf({down, up, left, right}) {
  if (down !== undefined && up !== undefined) throw new Error('A scroll goes down or up, not both.')
  if (left !== undefined && right !== undefined) throw new Error('A scroll goes left or right, not both.')
  return {deltaX: (right ?? 0) - (left ?? 0), deltaY: (down ?? 0) - (up ?? 0)}
}

// What select reads, by key, after a call's action: in the frame the call
// names, located afresh, since the action may have changed the page.
async function selected(page, frame, selectors, {html, shadow}) {
  if (!Object.keys(selectors).length) return {}
  return read(await frameOf(page, frame, shadow), selectors, {html, shadow})
}

// Refuses a select whose keys are among a call's own, which share one result with it.
function refuseShared(keys, select = {}) {
  const shared = keys.filter(key => Object.hasOwn(select, key))
  if (shared.length) throw new Error(`${shared.map(key => `'${key}'`).join(', ')} is in select, and is the call's own key: they share one result.`)
}

// A JavaScript expression's value, checked by its schema when it's given one.
async function evaluatedAs(inFrame, key, written) {
  const [expression, schema] = Array.isArray(written) ? written : [written]
  const value = await evaluate(inFrame, expression).catch(error => { throw new Error(`Couldn't evaluate '${key}': ${error.message}`) })
  if (schema === undefined) return value
  const checked = parseSchema(schema).safeParse(value)
  if (!checked.success) throw new Error(`'${key}' evaluated to ${JSON.stringify(value)}, which doesn't fit its schema: ${checked.error.issues.map(issue => issue.message).join('; ')}`)
  return checked.data
}

const serviceDefinition = {
  requires: ['log'],

  // Keeps an instance of util to wait with.
  async init(env) {
    this.util = await util.init(env)
  },

  '/open': {
    description: 'Open a URL in a session\'s page, absolute or relative to the page it\'s on, once its network is quiet; then read select',
    input: {
      url: ['string', {min: 1}, {tags: ['target']}],
      session: ['handle', 'browser', {default: 'default'}],
      frame: ['union', ['string', {min: 1}], ['array', ['string', {min: 1}], {min: 1}], 'optional'],
      select: ['record', ['union', ['string', {min: 1}], ['array', ['any'], {min: 2}]], 'optional'],
      shadow: ['boolean', {default: false}],
      dialog: ['enum', ['accept', 'dismiss'], 'optional']
    },
    output: ['record', ['array', [{text: ['string'], attributes: ['record', ['string']], html: ['string']}]]],
    async call({url, session: page, frame, select, shadow, dialog}) {
      const selectors = selectorsOf(select)
      await answeringDialogs(page, dialog, () => open(page, url))
      return selected(page, frame, selectors, {shadow})
    }
  },

  '/click': {
    description: 'Click the first element a selector matches, as a person would; then read select',
    input: {
      on: ['union', ['string', {min: 1}], ['array', ['any'], {min: 2}], {tags: ['target']}],
      session: ['handle', 'browser', {default: 'default'}],
      frame: ['union', ['string', {min: 1}], ['array', ['string', {min: 1}], {min: 1}], 'optional'],
      select: ['record', ['union', ['string', {min: 1}], ['array', ['any'], {min: 2}]], 'optional'],
      shadow: ['boolean', {default: false}],
      dialog: ['enum', ['accept', 'dismiss'], 'optional']
    },
    output: ['record', ['array', [{text: ['string'], attributes: ['record', ['string']], html: ['string']}]]],
    async call({on, session: page, frame, select, shadow, dialog}) {
      const target = selectorOf('on', on)
      const selectors = selectorsOf(select)
      const inFrame = await frameOf(page, frame, shadow)
      await answeringDialogs(page, dialog, () => click(inFrame, 'on', target, shadow))
      return selected(page, frame, selectors, {shadow})
    }
  },

  '/type': {
    description: 'Type text into the first element a selector matches; then read select',
    input: {
      on: ['union', ['string', {min: 1}], ['array', ['any'], {min: 2}], {tags: ['target']}],
      text: ['string'],
      session: ['handle', 'browser', {default: 'default'}],
      frame: ['union', ['string', {min: 1}], ['array', ['string', {min: 1}], {min: 1}], 'optional'],
      select: ['record', ['union', ['string', {min: 1}], ['array', ['any'], {min: 2}]], 'optional'],
      shadow: ['boolean', {default: false}],
      dialog: ['enum', ['accept', 'dismiss'], 'optional']
    },
    output: ['record', ['array', [{text: ['string'], attributes: ['record', ['string']], html: ['string']}]]],
    async call({on, text, session: page, frame, select, shadow, dialog}) {
      const target = selectorOf('on', on)
      const selectors = selectorsOf(select)
      const inFrame = await frameOf(page, frame, shadow)
      await answeringDialogs(page, dialog, () => type(inFrame, 'on', target, text, shadow))
      return selected(page, frame, selectors, {shadow})
    }
  },

  '/keysequence': {
    description: 'Press keys one at a time, interval ms apart, to what has the focus: characters, or keys by name (Enter, Tab, ArrowDown); then read select',
    input: {
      keys: ['array', ['string', {min: 1}], {min: 1}],
      interval: ['number', {min: 0}, 'optional'],
      session: ['handle', 'browser', {default: 'default'}],
      frame: ['union', ['string', {min: 1}], ['array', ['string', {min: 1}], {min: 1}], 'optional'],
      select: ['record', ['union', ['string', {min: 1}], ['array', ['any'], {min: 2}]], 'optional'],
      shadow: ['boolean', {default: false}],
      dialog: ['enum', ['accept', 'dismiss'], 'optional']
    },
    output: ['record', ['array', [{text: ['string'], attributes: ['record', ['string']], html: ['string']}]]],
    async call({keys, interval, session: page, frame, select, shadow, dialog}) {
      const selectors = selectorsOf(select)
      await answeringDialogs(page, dialog, () => pressKeys(page, keys, interval))
      return selected(page, frame, selectors, {shadow})
    }
  },

  '/scroll': {
    description: 'Scroll to the first element a selector matches, or by an amount in pixels, down or up, left or right; then read select',
    input: {
      to: ['union', ['string', {min: 1}], ['array', ['any'], {min: 2}], 'optional'],
      down: ['number', {min: 0}, 'optional'],
      up: ['number', {min: 0}, 'optional'],
      left: ['number', {min: 0}, 'optional'],
      right: ['number', {min: 0}, 'optional'],
      session: ['handle', 'browser', {default: 'default'}],
      frame: ['union', ['string', {min: 1}], ['array', ['string', {min: 1}], {min: 1}], 'optional'],
      select: ['record', ['union', ['string', {min: 1}], ['array', ['any'], {min: 2}]], 'optional'],
      shadow: ['boolean', {default: false}],
      dialog: ['enum', ['accept', 'dismiss'], 'optional']
    },
    output: ['record', ['array', [{text: ['string'], attributes: ['record', ['string']], html: ['string']}]]],
    async call({to, down, up, left, right, session: page, frame, select, shadow, dialog}) {
      const amounts = [down, up, left, right].some(amount => amount !== undefined)
      if (to === undefined && !amounts) throw new Error('A scroll goes to an element, or by an amount: give to, or down, up, left or right.')
      if (to !== undefined && amounts) throw new Error('A scroll goes to an element, or by an amount, not both.')
      const scroll = to === undefined ? deltasOf({down, up, left, right}) : selectorOf('to', to)
      const selectors = selectorsOf(select)
      const inFrame = await frameOf(page, frame, shadow)
      await answeringDialogs(page, dialog, () => to === undefined ? scrollBy(inFrame, scroll) : scrollTo(inFrame, 'to', scroll, shadow))
      return selected(page, frame, selectors, {shadow})
    }
  },

  '/screenshot': {
    description: 'The page as it\'s shown, or the frame named, cropped from it: a PNG in base64, as screenshot; with what select reads',
    input: {
      session: ['handle', 'browser', {default: 'default'}],
      frame: ['union', ['string', {min: 1}], ['array', ['string', {min: 1}], {min: 1}], 'optional'],
      select: ['record', ['union', ['string', {min: 1}], ['array', ['any'], {min: 2}]], 'optional'],
      shadow: ['boolean', {default: false}]
    },
    output: ['record', ['union', ['string'], ['array', [{text: ['string'], attributes: ['record', ['string']], html: ['string']}]]]],
    async call({session: page, frame, select, shadow}) {
      refuseShared(['screenshot'], select)
      const selectors = selectorsOf(select)
      return {screenshot: await screenshot(await frameOf(page, frame, shadow)), ...await selected(page, frame, selectors, {shadow})}
    }
  },

  '/extract': {
    description: 'What each selector matches, by key: in a session\'s page, or in HTML given, parsed apart from the page',
    input: {
      html: ['string', 'optional', {tags: ['target']}],
      select: ['record', ['union', ['string', {min: 1}], ['array', ['any'], {min: 2}]]],
      session: ['handle', 'browser', {default: 'default'}],
      frame: ['union', ['string', {min: 1}], ['array', ['string', {min: 1}], {min: 1}], 'optional'],
      shadow: ['boolean', {default: false}]
    },
    output: ['record', ['array', [{text: ['string'], attributes: ['record', ['string']], html: ['string']}]]],
    async call({html, select, session: page, frame, shadow}) {
      const selectors = selectorsOf(select)
      if (html !== undefined && frame !== undefined) throw new Error('HTML given is read apart from the page, in no frame: give html, or frame, not both.')
      if (html === undefined && await locationOf(page) === 'about:blank') {
        throw new Error(`Session '${page.name}' has no page open: /open one, or give html to read.`)
      }
      return selected(page, frame, selectors, {html, shadow})
    }
  },

  '/eval': {
    description: 'Evaluate JavaScript in a session\'s page, each key an expression, or [expression, schema] to check its value by; then read select, into the same result',
    input: {
      js: ['record', ['union', ['string', {min: 1}], ['array', ['any'], {min: 2, max: 2}]]],
      session: ['handle', 'browser', {default: 'default'}],
      frame: ['union', ['string', {min: 1}], ['array', ['string', {min: 1}], {min: 1}], 'optional'],
      select: ['record', ['union', ['string', {min: 1}], ['array', ['any'], {min: 2}]], 'optional'],
      shadow: ['boolean', {default: false}],
      dialog: ['enum', ['accept', 'dismiss'], 'optional']
    },
    output: ['record', ['any']],
    async call({js, session: page, frame, select, shadow, dialog}) {
      refuseShared(Object.keys(js), select)
      const selectors = selectorsOf(select)
      const inFrame = await frameOf(page, frame, shadow)
      const evaluations = await answeringDialogs(page, dialog, async () => {
        const values = {}
        for (const [key, written] of Object.entries(js)) values[key] = await evaluatedAs(inFrame, key, written)
        return values
      })
      return {...evaluations, ...await selected(page, frame, selectors, {shadow})}
    }
  },

  '/waitFor': {
    description: 'Read select every interval until its matches fit their selectors (one with no modifiers: at least one match), at most tries times; what it read',
    input: {
      select: ['record', ['union', ['string', {min: 1}], ['array', ['any'], {min: 2}]]],
      tries: ['number', 'int', {min: 1}, {default: 10}],
      interval: ['number', {min: 0}, {default: 200}],
      session: ['handle', 'browser', {default: 'default'}],
      frame: ['union', ['string', {min: 1}], ['array', ['string', {min: 1}], {min: 1}], 'optional'],
      shadow: ['boolean', {default: false}]
    },
    output: ['record', ['array', [{text: ['string'], attributes: ['record', ['string']], html: ['string']}]]],
    async call({select, tries, interval, session: page, frame, shadow}) {
      const selectors = selectorsOf(select, awaited)
      return this.util.call({
        service: 'util', resource: '/waitFor', method: null, confined: false,
        fields: {service: () => selected(page, frame, selectors, {shadow}), tries, interval}
      })
    }
  }
}

export default defineService(serviceDefinition)
