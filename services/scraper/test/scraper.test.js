import assert from 'node:assert/strict'
import {describe, it} from 'node:test'
import {compile, parseSchema, serviceSmokeTests, Runtime} from 'microql'
import scraper from '../index.js'
import {selectorOf, fitted} from '../selectors.js'
import {keyEvents} from '../keys.js'

// What a runtime gives the scraper's init: its sessions come to each call
// as a handle, not through env.
const env = {log() {}}

for (const {describe: name, it: check, test} of serviceSmokeTests(scraper, {env})) {
  describe(name, () => it(check, test))
}

describe('a runtime without a browser', () => {
  it('offers no sessions: a Query naming the scraper doesn\'t compile', () => {
    const runtime = Object.assign(new Runtime(), {env})
    assert.throws(() => compile({runtime, services: {scraper}, phases: {a: ['[scraper]/extract', {html: '<p></p>', select: {p: 'p'}}]}}),
      {code: 'missing-capability', service: 'scraper', capability: 'browser', handle: true})
  })
})

describe('a selector', () => {
  // [as written, as read]
  const forms = [
    ['h1', {kind: 'css', selector: 'h1', modifiers: []}],
    [['css', 'h1'], {kind: 'css', selector: 'h1', modifiers: []}],
    [['css', 'h1', {min: 1}], {kind: 'css', selector: 'h1', modifiers: [{min: 1}]}],
    [['xpath', '//button[contains(., \'More\')]', {length: 1}], {kind: 'xpath', selector: '//button[contains(., \'More\')]', modifiers: [{length: 1}]}],
    [['css', '.card', 'nonempty', {max: 20}], {kind: 'css', selector: '.card', modifiers: ['nonempty', {max: 20}]}]
  ]

  for (const [written, read] of forms) {
    it(`reads ${JSON.stringify(written)}`, () => {
      assert.deepEqual(selectorOf('key', written), read)
    })
  }

  // [as written, what's wrong, as the error says]
  const refused = [
    [['jquery', 'h1'], /'key' names an unknown kind of selector, 'jquery': it takes css or xpath/],
    [['css', ''], /'key' has no selector/],
    [['css', 'h1', {lenght: 1}], /'key' has a modifier the list of matches has no method for/]
  ]

  for (const [written, wrong] of refused) {
    it(`refuses ${JSON.stringify(written)}`, () => {
      assert.throws(() => selectorOf('key', written), wrong)
    })
  }
})

describe('a frame', () => {
  // [as written, whether every call takes it]
  const forms = [
    ['#results', true],
    [['#results'], true],
    [['#outer', '#inner'], true],
    ['', false],
    [[], false],
    [['#outer', ''], false],
    [[['css', '#results']], false]
  ]

  for (const [written, taken] of forms) {
    it(`${taken ? 'is' : 'isn\'t'} ${JSON.stringify(written)}, on every call`, () => {
      const calls = scraper.supportedCalls().filter(({input}) => parseSchema(input.frame).safeParse(written).success === taken)
      assert.deepEqual(calls.map(({resource}) => resource), scraper.supportedCalls().map(({resource}) => resource))
    })
  }
})

describe('the matches a selector fits', () => {
  const match = {text: 'x', attributes: {}, html: '<b>x</b>'}

  // [modifiers, matches, whether they fit]
  const cases = [
    [[], [], true],
    [[{length: 1}], [match], true],
    [[{length: 1}], [match, match], false],
    [[{min: 1}], [], false],
    [['nonempty'], [match], true],
    [[{max: 1}], [match, match], false]
  ]

  for (const [modifiers, matches, fits] of cases) {
    it(`${fits ? 'fit' : 'don\'t fit'}: ${matches.length} for ${JSON.stringify(modifiers)}`, () => {
      const selector = selectorOf('cards', ['css', '.card', ...modifiers])
      if (fits) assert.deepEqual(fitted('cards', selector, matches), matches)
      else assert.throws(() => fitted('cards', selector, matches), /'cards' matched 2|'cards' matched 0/)
    })
  }
})

describe('a key sequence', () => {
  // [key, the events it sends: keyDown then keyUp]
  const cases = [
    ['a', {key: 'a', text: 'a'}],
    [' ', {key: ' ', text: ' '}],
    ['Enter', {key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r'}],
    ['Tab', {key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9}],
    ['ArrowDown', {key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40}]
  ]

  for (const [key, down] of cases) {
    it(`presses ${JSON.stringify(key)}`, () => {
      const {text, ...up} = down
      assert.deepEqual(keyEvents(key), [{type: 'keyDown', ...down}, {type: 'keyUp', ...up}])
      assert.equal(text, down.text)
    })
  }

  it('refuses a key it doesn\'t know', () => {
    assert.throws(() => keyEvents('Hyper'), /Unknown key 'Hyper'/)
  })
})
