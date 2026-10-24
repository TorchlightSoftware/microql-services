/**
 * Selectors: how a Query names elements, written as zodly writes a type. A
 * selector always matches a list.
 *
 *   'h1'                                   CSS, the default kind
 *   ['css', 'h1', {min: 1}]                its kind, the selector, then modifiers
 *   ['xpath', "//button[contains(., 'More')]", {length: 1}]
 *
 * The modifiers are zod's array methods, applied to the list of matches:
 * {length: 1} exactly one, {min: 1} or 'nonempty' at least one, {max: n} at
 * most n. A call fails when its matches don't fit.
 */

import {parseSchema} from 'microql'

// The kinds of selector there are, each by the name it's written with.
export const KINDS = ['css', 'xpath']

// A selector as written: a bare string is CSS.
const asWritten = (value) => typeof value === 'string' ? ['css', value] : value

// The check a selector's modifiers make of its matches.
function listOf(key, modifiers) {
  try {
    return parseSchema(['array', ...modifiers])
  } catch (error) {
    throw new Error(`'${key}' has a modifier the list of matches has no method for: ${error.message}`)
  }
}

/**
 * A selector, read: its kind, the selector itself and its modifiers, checked
 * now so that a Query's mistake fails before the page is touched. `key` names
 * it in errors.
 */
export function selectorOf(key, value) {
  const [kind, selector, ...modifiers] = asWritten(value)
  if (!KINDS.includes(kind)) throw new Error(`'${key}' names an unknown kind of selector, '${kind}': it takes ${KINDS.join(' or ')}.`)
  if (typeof selector !== 'string' || !selector) throw new Error(`'${key}' has no selector.`)
  listOf(key, modifiers)
  return {kind, selector, modifiers}
}

// The matches, when they fit their selector's modifiers; a failure saying how
// they don't, otherwise.
export function fitted(key, {kind, selector, modifiers}, matches) {
  const result = listOf(key, modifiers).safeParse(matches)
  if (result.success) return matches
  const problems = result.error.issues.map(issue => issue.message).join('; ')
  throw new Error(`'${key}' matched ${matches.length}, which doesn't fit ${JSON.stringify([kind, selector, ...modifiers])}: ${problems}`)
}
