/**
 * The scraper against a live site, in a real browser: kept out of the
 * default test run, since it needs the network and a Chrome. The site is
 * toscrape.com's quotes sandbox, which exists to be scraped.
 */
import assert from 'node:assert/strict'
import {describe, it} from 'node:test'
import query from 'microql'
import scraper from '../../index.js'
import {launchedChrome} from '../chrome.js'

const QUOTES = 'https://quotes.toscrape.com/'

describe('scraper, live', () => {
  const launched = launchedChrome()

  it('reads a page\'s elements, with their text and attributes, and groups them by card', async () => {
    const {page, quotes} = await query({
      runtime: launched.runtime,
      services: {scraper},
      phases: {
        page: [QUOTES, '[scraper]/open', {select: {title: 'h1 a', quotes: ['css', '.quote', {length: 10}]}}],
        quotes: ['$page.quotes', '[util]/each', {
          as: 'quote', sequential: true, service: ['@quote.html', '[scraper]/extract', {
            session: 'parse',
            select: {text: ['css', '.text', {length: 1}], author: ['css', '.author', {length: 1}]}
          }]
        }]
      }
    })

    assert.deepEqual(page.title.map(({text, attributes}) => ({text, attributes})), [{text: 'Quotes to Scrape', attributes: {href: '/', style: 'text-decoration: none'}}])
    assert.equal(quotes.length, 10)
    assert.equal(quotes[0].author[0].text, 'Albert Einstein')
  })
})
