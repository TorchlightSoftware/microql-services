/**
 * A session's page, driven over the Chrome DevTools Protocol: what the
 * scraper's calls do to it. A page is the browser handle a call is given,
 * CDP confined to its session: `send(method, params)`, `on(method,
 * handler)`, and `frame(frameId)`, the CDP that reaches a frame within it.
 * No library stands between, so the scraper runs wherever a runtime offers
 * a browser.
 *
 * Calls read and act in a frame (see frames.js): the page's main frame, or
 * one the call names. Its elements are reached through the frame's CDP, and
 * found where they're shown on the page, through the page, where input and
 * screenshots go, by adding the place of each iframe holding them.
 *
 * Reads run in a world of the scraper's own (Page.createIsolatedWorld): the
 * frame's DOM, without the globals its scripts may have replaced. /eval's
 * JavaScript runs in the frame's main world, where the Query writer expects it.
 */

import {script, readMatches, countMatches, firstMatch, firstBox, contentBox, drawn} from './in-page.js'
import {fitted} from './selectors.js'
import {keyEvents} from './keys.js'

const pause = (ms) => new Promise(resolve => setTimeout(resolve, ms))

// A world of the scraper's own in a frame, by its context id.
async function ownWorld(frame) {
  const {executionContextId} = await frame.pipe.send('Page.createIsolatedWorld', {frameId: frame.id, worldName: 'microql-scraper'})
  return executionContextId
}

// A frame's main world, where its own scripts run, by its context id: Chrome
// names each context there is as Runtime is enabled.
async function mainWorld(frame) {
  const contexts = []
  const stop = frame.pipe.on('Runtime.executionContextCreated', ({context}) => contexts.push(context))
  await frame.pipe.send('Runtime.enable').finally(stop)
  await frame.pipe.send('Runtime.disable')
  return contexts.find(({auxData}) => auxData?.frameId === frame.id && auxData.isDefault).id
}

// What an expression evaluates to, in a context (the main world of the
// pipe's frame, unless one is given): by value, or as the remote object it
// is. Its exception fails.
async function evaluated(pipe, expression, {contextId, byValue = true} = {}) {
  const {result, exceptionDetails} = await pipe.send('Runtime.evaluate', {expression, contextId, returnByValue: byValue, awaitPromise: true})
  if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text)
  return byValue ? result.value : result
}

// What a function of in-page.js returns, called on an element, by value,
// once it resolves.
async function calledOn(pipe, objectId, fn) {
  const {result} = await pipe.send('Runtime.callFunctionOn', {objectId, functionDeclaration: String(fn), returnByValue: true, awaitPromise: true})
  return result.value
}

// Where the page is: about:blank until one has been opened.
export async function locationOf(page) {
  const {targetInfo} = await page.send('Target.getTargetInfo')
  return targetInfo.url
}

/**
 * Where a frame is shown, in the page's view: the content box of the iframe
 * holding it, placed within each frame holding that in turn; the whole view
 * for the page's main frame.
 */
async function boxOf(frame) {
  const {cssVisualViewport: {clientWidth, clientHeight}} = await frame.page.send('Page.getLayoutMetrics')
  let box = {x: 0, y: 0, width: clientWidth, height: clientHeight}
  for (const {pipe, objectId} of frame.owners) {
    const content = await calledOn(pipe, objectId, contentBox)
    box = {...content, x: box.x + content.x, y: box.y + content.y}
  }
  return box
}

/**
 * What each selector matches in a frame, by its key, when its matches fit
 * it: in the frame, or in the HTML given, parsed apart from the page;
 * through open shadow roots when asked.
 */
export async function read(frame, selectors, {html, shadow}) {
  const contextId = await ownWorld(frame)
  const readKey = async ([key, selector]) => {
    const matches = await evaluated(frame.pipe, script(readMatches, {selector, html}, {shadow}), {contextId})
      .catch(error => { throw new Error(`Couldn't read '${key}': ${error.message}`) })
    return [key, fitted(key, selector, matches)]
  }
  return Object.fromEntries(await Promise.all(Object.entries(selectors).map(readKey)))
}

/**
 * The element in a frame an action acts on: the first a selector matches,
 * once its matches fit it, by its object id; a failure when there's none.
 */
export async function elementAt(frame, key, selector, shadow) {
  const contextId = await ownWorld(frame)
  const count = await evaluated(frame.pipe, script(countMatches, {selector}, {shadow}), {contextId})
  fitted(key, selector, Array.from({length: count}))
  if (!count) throw new Error(`'${key}' matched nothing to act on: ${JSON.stringify([selector.kind, selector.selector])}`)
  const {objectId} = await evaluated(frame.pipe, script(firstMatch, {selector}, {shadow}), {contextId, byValue: false})
  return objectId
}

/**
 * Scrolls a frame into view: each iframe holding it, outermost first, within
 * the frame it's in, which is then drawn where it's scrolled to. Chrome
 * carries a scroll from one process to another a moment later, so scrolling
 * an element within the frame alone would leave those holding it to scroll
 * after it's measured; and it sends input to a frame of another process
 * where it was last drawn.
 */
async function intoView(frame) {
  for (const {pipe, objectId} of frame.owners) {
    await pipe.send('DOM.scrollIntoViewIfNeeded', {objectId})
    await calledOn(pipe, objectId, drawn)
  }
}

// The middle of a box.
const middleOf = ({x, y, width, height}) => ({x: x + width / 2, y: y + height / 2})

// Clicks an element, as a person would: scrolled into view, then pressed and
// released at its middle, where it's shown on the page.
export async function click(frame, key, selector, shadow) {
  const objectId = await elementAt(frame, key, selector, shadow)
  await intoView(frame)
  await frame.pipe.send('DOM.scrollIntoViewIfNeeded', {objectId})
  const shown = await calledOn(frame.pipe, objectId, firstBox)
  if (!shown) throw new Error(`'${key}' isn't shown, so it can't be clicked.`)
  const within = await boxOf(frame)
  const {x, y} = middleOf({...shown, x: within.x + shown.x, y: within.y + shown.y})
  await frame.page.send('Input.dispatchMouseEvent', {type: 'mouseMoved', x, y})
  await frame.page.send('Input.dispatchMouseEvent', {type: 'mousePressed', x, y, button: 'left', clickCount: 1})
  await frame.page.send('Input.dispatchMouseEvent', {type: 'mouseReleased', x, y, button: 'left', clickCount: 1})
}

// Types text into an element: focused, then the text inserted, as an input
// method does, firing input events.
export async function type(frame, key, selector, text, shadow) {
  const objectId = await elementAt(frame, key, selector, shadow)
  await frame.pipe.send('DOM.focus', {objectId})
  await frame.page.send('Input.insertText', {text})
}

// Presses keys one at a time, `interval` ms apart, to what has the focus in the page.
export async function pressKeys(page, keys, interval = 0) {
  for (const [index, key] of keys.entries()) {
    if (index) await pause(interval)
    for (const event of keyEvents(key)) await page.send('Input.dispatchKeyEvent', event)
  }
}

// Scrolls an element to the top of its frame's view, and its frame into view.
export async function scrollTo(frame, key, selector, shadow) {
  const objectId = await elementAt(frame, key, selector, shadow)
  await intoView(frame)
  await frame.pipe.send('Runtime.callFunctionOn', {objectId, functionDeclaration: 'function () { this.scrollIntoView() }'})
}

// Scrolls a frame by an amount, in pixels, as a mouse wheel at its middle
// would, once it's in view: down and right are positive.
export async function scrollBy(frame, {deltaX, deltaY}) {
  await intoView(frame)
  const {x, y} = middleOf(await boxOf(frame))
  await frame.page.send('Input.dispatchMouseEvent', {type: 'mouseWheel', x, y, deltaX, deltaY})
}

// A frame as it's shown, scrolled into view and cropped from the page, as a PNG, base64.
export async function screenshot(frame) {
  await intoView(frame)
  const {cssVisualViewport: {pageX, pageY}} = await frame.page.send('Page.getLayoutMetrics')
  const {x, y, width, height} = await boxOf(frame)
  const {data} = await frame.page.send('Page.captureScreenshot', {format: 'png', clip: {x: pageX + x, y: pageY + y, width, height, scale: 1}})
  return data
}

// What a Query writer's JavaScript evaluates to, in a frame's main world.
export const evaluate = async (frame, expression) => evaluated(frame.pipe, expression, {contextId: await mainWorld(frame)})

/**
 * Opens a URL in the page, waiting until its network goes quiet. A relative
 * URL is resolved as a link on the page would be; with no page open, it can't be.
 */
export async function open(page, url) {
  const here = await locationOf(page)
  if (here === 'about:blank' && !URL.canParse(url)) throw new Error(`'${url}' is relative, and no page is open to resolve it against.`)
  const target = new URL(url, here).href
  await page.send('Page.enable')
  await page.send('Page.setLifecycleEventsEnabled', {enabled: true})

  // each loader whose network has gone quiet, which can be before
  // Page.navigate answers with its loader, and who waits on one
  const idle = new Set()
  const waiting = new Map()
  const stop = page.on('Page.lifecycleEvent', ({name, loaderId}) => {
    if (name !== 'networkIdle') return
    idle.add(loaderId)
    waiting.get(loaderId)?.()
  })
  try {
    const {loaderId, errorText} = await page.send('Page.navigate', {url: target})
    if (errorText) throw new Error(`Couldn't open ${target}: ${errorText}`)
    // a navigation within the document has no loader, and nothing to wait for
    if (loaderId && !idle.has(loaderId)) await new Promise(resolve => waiting.set(loaderId, resolve))
  } finally {
    stop()
  }
}

/**
 * Runs an action, answering the dialogs the page opens meanwhile: as the call
 * says (accept or dismiss), or by default dismissing them, but letting the
 * page be left (beforeunload), so a navigation goes through.
 */
export async function answeringDialogs(page, dialog, action) {
  await page.send('Page.enable')
  const stop = page.on('Page.javascriptDialogOpening', ({type}) => {
    const accept = dialog ? dialog === 'accept' : type === 'beforeunload'
    // a dialog the page closed itself is no longer there to answer
    page.send('Page.handleJavaScriptDialog', {accept}).catch(() => {})
  })
  try {
    return await action()
  } finally {
    stop()
  }
}
