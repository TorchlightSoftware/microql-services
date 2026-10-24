/**
 * A headless Chrome for a test file, launched with Puppeteer before its
 * tests and closed after them, and a node runtime whose browser it is, at
 * its CDP endpoint.
 */
import {after, before} from 'node:test'
import puppeteer from 'puppeteer'
import {NodeRuntime} from 'microql'

// The test file's Chrome and its runtime, set once Chrome is launched; the
// runtime's sessions are closed, and then Chrome, after the file's tests.
export function launchedChrome() {
  const launched = {}
  before(async () => {
    launched.chrome = await puppeteer.launch({headless: true})
    launched.runtime = new NodeRuntime({browser: launched.chrome.wsEndpoint()})
  })
  after(async () => {
    await launched.runtime.tearDown()
    await launched.chrome.close()
  })
  return launched
}
