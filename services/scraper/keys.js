/**
 * Keys: what /keysequence presses. A single character types itself; a named
 * key (Enter, Tab, the arrows) presses that key, as a person's keyboard would.
 */

// Named keys, as CDP's Input.dispatchKeyEvent takes them: the key, its code
// and its Windows virtual key code, and the text it types, if any.
const NAMED_KEYS = {
  Enter: {code: 'Enter', windowsVirtualKeyCode: 13, text: '\r'},
  Tab: {code: 'Tab', windowsVirtualKeyCode: 9},
  Escape: {code: 'Escape', windowsVirtualKeyCode: 27},
  Backspace: {code: 'Backspace', windowsVirtualKeyCode: 8},
  Delete: {code: 'Delete', windowsVirtualKeyCode: 46},
  ArrowUp: {code: 'ArrowUp', windowsVirtualKeyCode: 38},
  ArrowDown: {code: 'ArrowDown', windowsVirtualKeyCode: 40},
  ArrowLeft: {code: 'ArrowLeft', windowsVirtualKeyCode: 37},
  ArrowRight: {code: 'ArrowRight', windowsVirtualKeyCode: 39},
  Home: {code: 'Home', windowsVirtualKeyCode: 36},
  End: {code: 'End', windowsVirtualKeyCode: 35},
  PageUp: {code: 'PageUp', windowsVirtualKeyCode: 33},
  PageDown: {code: 'PageDown', windowsVirtualKeyCode: 34}
}

// What pressing a key is: its keyDown, which types its text, then its keyUp.
const pressed = ({text, ...key}) => [{type: 'keyDown', ...key, ...(text && {text})}, {type: 'keyUp', ...key}]

/**
 * The key events pressing a key sends: a character, or a key by its name.
 */
export function keyEvents(key) {
  if ([...key].length === 1) return pressed({key, text: key})
  if (!Object.hasOwn(NAMED_KEYS, key)) throw new Error(`Unknown key '${key}': press a character, or one of ${Object.keys(NAMED_KEYS).join(', ')}.`)
  return pressed({key, ...NAMED_KEYS[key]})
}
