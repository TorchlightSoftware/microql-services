/**
 * Frames: where in a session's page a call reads and acts. A call's `frame`
 * names an iframe by a CSS selector, matched in the page, or a path of them
 * into nested iframes, each matched within the frame before it; a call
 * naming none works in the page's main frame. A frame is located afresh
 * each time a call needs it, so it's never one the page has since left.
 *
 * Chrome runs a cross-site frame in a process of its own: the session's
 * handle gives the CDP that reaches a frame, `frame(frameId)`, so a frame's
 * elements are read and acted on alike, wherever it runs.
 *
 * Domain:
 *   Frame  where a call works: {page, pipe, id, owners}. `page` is the
 *          session's page, which input and screenshots go through; `pipe`
 *          the CDP that reaches the frame's document; `id` its frame id;
 *          `owners` the iframes holding it, outermost first, each the
 *          element's object id in the pipe of the frame it's in. The
 *          page's main frame has none
 */

import {selectorOf} from './selectors.js'
import {elementAt} from './page.js'

// The page's main frame: where a call naming no frame works.
async function mainFrameOf(page) {
  const {frameTree} = await page.send('Page.getFrameTree')
  return {page, pipe: page, id: frameTree.frame.id, owners: []}
}

// The frame within a frame that an iframe holds: the first the selector
// matches, by the frame id Chrome gives its element.
async function frameWithin(frame, selector, shadow) {
  const objectId = await elementAt(frame, 'frame', selectorOf('frame', selector), shadow)
  const {node: {frameId}} = await frame.pipe.send('DOM.describeNode', {objectId})
  if (frameId === undefined) throw new Error(`'frame' matched an element that holds no frame: ${JSON.stringify(selector)}`)
  return {page: frame.page, pipe: frame.pipe.frame(frameId), id: frameId, owners: [...frame.owners, {pipe: frame.pipe, objectId}]}
}

// The frame a call's `frame` names in the session's page, through open
// shadow roots when asked; the page's main frame when it names none.
export async function frameOf(page, frame, shadow) {
  let found = await mainFrameOf(page)
  for (const selector of frame === undefined ? [] : [frame].flat()) found = await frameWithin(found, selector, shadow)
  return found
}
