/**
 * The scraper end to end: Queries through MicroQL's node runtime, in a real
 * headless Chrome the tests launch, against pages served from
 * test/e2e/fixtures on this machine. It runs apart from the unit tests (npm run test:e2e): each /open
 * waits for the page's network to go quiet, about a second.
 */
import assert from 'node:assert/strict'
import {Buffer} from 'node:buffer'
import {createServer} from 'node:http'
import {readFile} from 'node:fs/promises'
import {after, before, describe, it} from 'node:test'
import query from 'microql'
import scraper from '../../index.js'
import {launchedChrome} from '../chrome.js'

const fixtures = new URL('./fixtures/', import.meta.url)

// Serves the fixture pages, by name.
const server = createServer(async (request, response) => {
  const body = await readFile(new URL(`.${new URL(request.url, 'http://x').pathname}`, fixtures)).catch(() => undefined)
  response.writeHead(body ? 200 : 404, {'content-type': 'text/html'})
  response.end(body ?? 'not found')
})

const launched = launchedChrome()
let base

before(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${server.address().port}`
})

after(() => server.close())

// A phase that opens the quotes page, then runs the steps after it.
const onQuotes = (...steps) => [['[scraper]/open', {url: `${base}/quotes.html`}], ...steps]

// The result of a Query of one phase.
const run = (phase, more = {}) => query({runtime: launched.runtime, services: {scraper}, phases: {result: phase}, select: '$result', ...more})

// Just the text of each match, by key.
const textsOf = (result) => Object.fromEntries(Object.entries(result).map(([key, matches]) => [key, matches.map(({text}) => text)]))

describe('reading', () => {
  // [description, select, the texts each key matches]
  const reads = [
    ['a selector matches a list', {title: 'h1'}, {title: ['Quotes']}],
    ['CSS is the default kind', {titles: ['css', '.card .title']}, {titles: ['On learning', 'On patience']}],
    ['XPath matches text', {more: ['xpath', '//button[contains(., \'More\')]']}, {more: ['Load More']}],
    ['modifiers check the matches', {cards: ['css', '.card', {length: 2}]}, {cards: ['On learning Ada', 'On patience Grace']}],
    ['a match nobody finds is an empty list', {none: '.nothing'}, {none: []}]
  ]

  for (const [description, select, texts] of reads) {
    it(description, async () => {
      assert.deepEqual(textsOf(await run(onQuotes(['[scraper]/extract', {select}]))), texts)
    })
  }

  it('reads an element\'s text, attributes and html', async () => {
    const {next} = await run(onQuotes(['[scraper]/extract', {select: {next: '#next'}}]))
    assert.deepEqual(next, [{text: 'Next', attributes: {id: 'next', href: 'next.html'}, html: '<a id="next" href="next.html">Next</a>'}])
  })

  it('fails when matches don\'t fit their modifiers', async () => {
    await assert.rejects(run(onQuotes(['[scraper]/extract', {select: {cards: ['css', '.card', {length: 5}]}}])), /'cards' matched 2/)
  })

  it('reads what an action leaves, with select on the action', async () => {
    assert.deepEqual(textsOf(await run(['[scraper]/open', {url: `${base}/quotes.html`, select: {title: 'h1'}}])), {title: ['Quotes']})
  })

  it('returns {} from a call with no select', async () => {
    assert.deepEqual(await run(['[scraper]/open', {url: `${base}/quotes.html`}]), {})
  })

  it('reads within each subtree an earlier read returned, by value', async () => {
    const authors = await run(onQuotes(
      ['[scraper]/extract', {select: {cards: '.card'}}],
      ['@.cards', '[util]/each', {as: 'card', sequential: true, service: ['@card.html', '[scraper]/extract', {select: {author: '.author'}}]}]
    ))
    assert.deepEqual(authors.map(textsOf), [{author: ['Ada']}, {author: ['Grace']}])
  })

  it('reads HTML given in a session with no page open', async () => {
    const result = await run(['[scraper]/extract', {html: '<ul><li>a</li><li>b</li></ul>', select: {items: 'li'}}])
    assert.deepEqual(textsOf(result), {items: ['a', 'b']})
  })

  it('refuses to read a session with no page open, and no HTML given', async () => {
    await assert.rejects(run(['[scraper]/extract', {select: {title: 'h1'}}]), /Session 'default' has no page open/)
  })

  it('reaches into open shadow roots only when asked', async () => {
    const select = {inside: '.inside'}
    assert.deepEqual(textsOf(await run(onQuotes(['[scraper]/extract', {select}]))), {inside: []})
    assert.deepEqual(textsOf(await run(onQuotes(['[scraper]/extract', {select, shadow: true}]))), {inside: ['In the shadow']})
  })
})

describe('acting', () => {
  it('opens a URL relative to the page it\'s on', async () => {
    assert.deepEqual(textsOf(await run(onQuotes(['[scraper]/open', {url: 'next.html', select: {title: 'h1'}}]))), {title: ['Next']})
    assert.deepEqual(textsOf(await run(onQuotes(['[scraper]/open', {url: '/next.html', select: {title: 'h1'}}]))), {title: ['Next']})
  })

  it('refuses a relative URL with no page open to resolve it against', async () => {
    await assert.rejects(run(['[scraper]/open', {url: 'next.html'}]), /'next.html' is relative, and no page is open/)
  })

  it('clicks, then waits for what the click loads', async () => {
    const result = await run(onQuotes(
      ['[scraper]/click', {on: '#more', select: {cards: '.card'}}],
      ['[scraper]/waitFor', {select: {cards: ['css', '.card', {min: 3}]}, interval: 20}]
    ))
    assert.equal(result.cards.length, 3)
  })

  it('gives up waiting after its tries', async () => {
    await assert.rejects(run(onQuotes(['[scraper]/waitFor', {select: {never: '.never'}, tries: 3, interval: 10}])), {code: 'gave-up', tries: 3})
  })

  it('types into an element, as an input method would', async () => {
    assert.deepEqual(textsOf(await run(onQuotes(['[scraper]/type', {on: '#name', text: 'Ada', select: {echo: '#echo'}}]))), {echo: ['Ada']})
  })

  it('presses keys one at a time, characters and keys by name', async () => {
    const result = await run(onQuotes(
      ['[scraper]/click', {on: '#name'}],
      ['[scraper]/keysequence', {keys: ['a', 'b', 'Enter'], interval: 5, select: {keys: '#keys', echo: '#echo'}}]
    ))
    assert.deepEqual(textsOf(result), {keys: ['a b Enter'], echo: ['ab']})
  })

  it('scrolls by an amount, and to an element', async () => {
    // a wheel scrolls a moment after it turns: waiting on JavaScript is [util]/waitFor around /eval
    const scrolledBy = await run(onQuotes(
      ['[scraper]/scroll', {down: 500}],
      ['[util]/waitFor', {service: ['[scraper]/eval', {js: {y: 'window.scrollY'}}], expect: {y: ['number', {min: 1}]}, interval: 20}]
    ))
    assert.ok(scrolledBy.y > 0)
    const scrolledTo = await run(onQuotes(['[scraper]/scroll', {to: '#bottom'}], ['[scraper]/eval', {js: {y: 'window.scrollY'}}]))
    assert.ok(scrolledTo.y > 3000)
  })

  it('refuses a scroll in directions that undo each other', async () => {
    await assert.rejects(run(onQuotes(['[scraper]/scroll', {down: 5, up: 5}])), /down or up, not both/)
  })

  it('takes a screenshot, a PNG in base64', async () => {
    const {screenshot} = await run(onQuotes(['[scraper]/screenshot', {}]))
    assert.ok(Buffer.from(screenshot, 'base64').subarray(1, 4).equals(Buffer.from('PNG')))
  })

  // [description, fields of the click, what the page made of its answer]
  const dialogs = [
    ['dismisses a dialog by default', {}, 'no'],
    ['accepts a dialog when told to', {dialog: 'accept'}, 'yes']
  ]

  for (const [description, fields, answer] of dialogs) {
    it(description, async () => {
      assert.deepEqual(textsOf(await run(onQuotes(['[scraper]/click', {on: '#ask', ...fields, select: {answer: '#answer'}}]))), {answer: [answer]})
    })
  }
})

describe('evaluating', () => {
  it('evaluates each key\'s JavaScript in the page, then reads select into the same result', async () => {
    const result = await run(onQuotes(['[scraper]/eval', {js: {title: 'document.title', count: ['document.querySelectorAll(".card").length', ['number', 'int']]}, select: {heading: 'h1'}}]))
    assert.deepEqual({...result, heading: result.heading.map(({text}) => text)}, {title: 'Quotes', count: 2, heading: ['Quotes']})
  })

  it('fails when a value doesn\'t fit its schema', async () => {
    await assert.rejects(run(onQuotes(['[scraper]/eval', {js: {title: ['document.title', ['number']]}}])), /'title' evaluated to "Quotes", which doesn't fit its schema/)
  })

  it('refuses a key in both js and select', async () => {
    await assert.rejects(run(onQuotes(['[scraper]/eval', {js: {title: 'document.title'}, select: {title: 'h1'}}])), /'title' is in select/)
  })
})

describe('frames', () => {
  // A phase that opens the frames page, then runs the steps after it.
  const onFrames = (...steps) => [['[scraper]/open', {url: `${base}/frames.html`}], ...steps]

  // Where a frame is, by its origin's host: the page's (127.0.0.1) or the other site's (localhost).
  const hostIn = (frame) => run(onFrames(['[scraper]/eval', {frame, js: {host: 'location.hostname'}, select: {title: 'h1'}}]))

  // [description, frame, the host its document is on]
  const frames = [
    ['reads in a frame of the page\'s own site', '#same', '127.0.0.1'],
    ['reads in a frame of another site, which Chrome runs apart', '#cross', 'localhost'],
    ['reads in a frame named as a path of one', ['#cross'], 'localhost'],
    ['reads in a frame within another site\'s frame, of that site', ['#nested', '#local'], 'localhost'],
    ['reads in a frame within another site\'s frame, of the page\'s site', ['#nested', '#inner'], '127.0.0.1']
  ]

  for (const [description, frame, host] of frames) {
    it(description, async () => {
      const result = await hostIn(frame)
      assert.deepEqual({...result, title: result.title.map(({text}) => text)}, {host, title: ['Framed']})
    })
  }

  it('reads in the page itself with no frame named', async () => {
    assert.deepEqual(textsOf(await run(onFrames(['[scraper]/extract', {select: {title: 'h1'}}]))), {title: ['Frames']})
  })

  it('reads what /open selects in the frame named', async () => {
    assert.deepEqual(textsOf(await run(['[scraper]/open', {url: `${base}/frames.html`, frame: '#cross', select: {title: 'h1'}}])), {title: ['Framed']})
  })

  // [description, frame]: frames placed apart from the page's corner, each by a margin, border or padding
  const clicks = [
    ['clicks in a frame where it\'s shown', '#same'],
    ['clicks in another site\'s frame where it\'s shown', '#cross'],
    ['clicks in a frame nested in another site\'s, scrolled into view', ['#nested', '#inner']]
  ]

  for (const [description, frame] of clicks) {
    it(description, async () => {
      assert.deepEqual(textsOf(await run(onFrames(['[scraper]/click', {on: '#press', frame, select: {pressed: '#pressed'}}]))), {pressed: ['pressed']})
    })
  }

  it('types into an element in a frame', async () => {
    assert.deepEqual(textsOf(await run(onFrames(['[scraper]/type', {on: '#name', text: 'Ada', frame: '#cross', select: {echo: '#echo'}}]))), {echo: ['Ada']})
  })

  it('presses keys to what a click in a frame focused', async () => {
    const result = await run(onFrames(
      ['[scraper]/click', {on: '#name', frame: '#cross'}],
      ['[scraper]/keysequence', {keys: ['a', 'b'], frame: '#cross', select: {echo: '#echo'}}]
    ))
    assert.deepEqual(textsOf(result), {echo: ['ab']})
  })

  it('scrolls a frame by an amount, and to an element in it', async () => {
    const scrolledBy = await run(onFrames(
      ['[scraper]/scroll', {down: 300, frame: '#cross'}],
      ['[util]/waitFor', {service: ['[scraper]/eval', {frame: '#cross', js: {y: 'window.scrollY'}}], expect: {y: ['number', {min: 1}]}, interval: 20}]
    ))
    assert.ok(scrolledBy.y > 0)
    const scrolledTo = await run(onFrames(['[scraper]/scroll', {to: '#bottom', frame: '#cross'}], ['[scraper]/eval', {frame: '#cross', js: {y: 'window.scrollY'}}]))
    assert.ok(scrolledTo.y > 1000)
  })

  // [frame, the width and height of its content box]
  const crops = [
    ['#cross', [300, 200]],
    [['#nested', '#inner'], [300, 150]]
  ]

  for (const [frame, size] of crops) {
    it(`takes a screenshot cropped to ${JSON.stringify(frame)}, scrolled into view`, async () => {
      const {screenshot, title} = await run(onFrames(['[scraper]/screenshot', {frame, select: {title: 'h1'}}]))
      // a PNG's width and height follow its signature and its header's length and type
      const png = Buffer.from(screenshot, 'base64')
      assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], size)
      assert.deepEqual(title.map(({text}) => text), ['Framed'])
    })
  }

  it('waits for a frame that comes late', async () => {
    const result = await run(onFrames(['[scraper]/waitFor', {frame: '#late', select: {title: 'h1'}, tries: 30, interval: 100}]))
    assert.deepEqual(textsOf(result), {title: ['Framed']})
  })

  it('reaches a frame in an open shadow root only when asked', async () => {
    await assert.rejects(run(onFrames(['[scraper]/extract', {frame: '.shadowed', select: {title: 'h1'}}])), /'frame' matched nothing/)
    assert.deepEqual(textsOf(await run(onFrames(['[scraper]/extract', {frame: '.shadowed', shadow: true, select: {title: 'h1'}}]))), {title: ['Framed']})
  })

  it('refuses an element that holds no frame', async () => {
    await assert.rejects(run(onFrames(['[scraper]/extract', {frame: 'h1', select: {title: 'h1'}}])), /'frame' matched an element that holds no frame/)
  })

  it('refuses HTML given with a frame', async () => {
    await assert.rejects(run(onFrames(['[scraper]/extract', {html: '<p></p>', frame: '#cross', select: {p: 'p'}}])), /give html, or frame, not both/)
  })
})

// The browser contexts open in the test's Chrome, besides its default one.
async function openContexts() {
  const cdp = await launched.chrome.target().createCDPSession()
  const {browserContextIds} = await cdp.send('Target.getBrowserContexts')
  await cdp.detach()
  return browserContextIds
}

describe('sessions', () => {
  it('keep a page each, named by the Query', async () => {
    const result = await run([
      ['[scraper]/open', {url: `${base}/quotes.html`}],
      ['[scraper]/open', {session: 'second', url: `${base}/next.html`}],
      ['[scraper]/extract', {select: {title: 'h1'}}]
    ])
    assert.deepEqual(textsOf(result), {title: ['Quotes']})
  })

  it('keep cookies and storage of their own', async () => {
    const result = await run([
      ['[scraper]/open', {url: `${base}/quotes.html`}],
      ['[scraper]/eval', {js: {set: 'document.cookie = "mark=kept"'}}],
      ['[scraper]/open', {session: 'other', url: `${base}/quotes.html`}],
      ['[scraper]/eval', {session: 'other', js: {cookie: 'document.cookie'}}]
    ])
    assert.deepEqual(result, {cookie: ''})
  })

  it('are closed once the Run is done, in a Run the caller named too', async () => {
    await query({runtime: launched.runtime, services: {scraper}, phases: {a: ['[scraper]/open', {url: `${base}/quotes.html`}]}}, {runId: 'named'})
    assert.deepEqual(await openContexts(), [])
  })
})
