# @tlsft/microql-svc-scraper

A [MicroQL](https://github.com/TorchlightSoftware/microql) service that reads web pages, and acts on them as a person would, in a real browser: pages that render with JavaScript read as they're shown, and a Query can open, click, type and scroll its way to what it needs.

```javascript
import query from 'microql'
import scraper from '@tlsft/microql-svc-scraper'

const quotes = await query({
  services: {scraper},
  phases: {
    // open the page, and read every quote on it
    page: ['https://quotes.toscrape.com/', '[scraper]/open', {select: {quotes: ['css', '.quote', {min: 1}]}}],

    // then read the fields of each quote, within it
    quotes: ['$page.quotes', '[util]/each', {as: 'quote', service: ['@quote.html', '[scraper]/extract', {
      session: 'parse',
      select: {text: '.text', author: '.author'}
    }]}]
  },
  select: '$quotes'
})

quotes[0].author  // [{text: 'Albert Einstein', attributes: {class: 'author', itemprop: 'author'}, html: '<small class="author" ...>'}]
```

## The browser

**The browser is the runtime's.** The scraper has no dependencies: each call is given its session's page by the runtime, the Chrome DevTools Protocol confined to that page ([MicroQL § Handles](https://github.com/TorchlightSoftware/microql/blob/main/docs/runtime-integration.md#handles)), so it runs wherever a runtime offers a browser. MicroQL's node runtime offers the one at the CDP endpoint it's given, `new NodeRuntime({browser: 'ws://…'})`; or else, when [Puppeteer](https://pptr.dev) is installed beside it (`npm install puppeteer`), a headless Chrome Puppeteer launches. A Query naming the scraper on a runtime with no browser doesn't compile (`missing-capability`).

**A session is a page of its own**, in a browser context of its own (its own cookies and storage), named by the Query: `session`, on every call, default `'default'`. It's a MicroQL handle of kind `browser` ([MicroQL § Handles](https://github.com/TorchlightSoftware/microql/blob/main/docs/service-guide.md#handles)): the runtime opens it when a call first needs it. Calls on one session act on one page, one after another, so a click and the read after it see the same page. What to know:

- **One session belongs to one phase.** MicroQL replays a Run a phase at a time, and a later phase can't count on a page an earlier one left; naming one session in two phases fails to compile (`shared-handle`). Give each phase its own.
- **A session's calls run one at a time.** Calls on one session that would run at once, as in a `[util]/each`, wait their turn, with a warning in the log; `sequential: true` on the `each` says it's meant, and the warning goes. Calls on different sessions run in parallel.
- **A session's calls always run.** MicroQL never reuses an earlier result for a call on a session, since the page may have changed since.
- **The runtime decides when a session closes.** The node runtime closes a Run's sessions once the Run is done, so a later Run, or a Run resumed, starts from fresh pages.
- **Name a fresh session for work apart from a site**: parsing HTML given to `/extract` happens in a session's page, without touching it, but waits its turn there.

## Selectors

A selector names elements, and always matches a list. It's written as a [zodly](https://www.npmjs.com/package/@tlsft/zodly) type is: its kind, the selector, then modifiers.

| Written | Matches |
|---|---|
| `'.card .title'` | CSS, the default kind |
| `['css', '.card', {min: 1}]` | CSS, failing the call unless there's at least one |
| `['xpath', "//button[contains(., 'More')]"]` | XPath, which can match an element by its text |

The modifiers are zod's array methods, applied to the list of matches: `{length: 1}` exactly one, `{min: 1}` or `'nonempty'` at least one, `{max: 20}` at most twenty. Take one match out of the list by its index: `@.author[0].text`.

**A match is plain data**: `{text, attributes, html}`. `text` is the element's text as shown, trimmed (where nothing is laid out, as in HTML given to `/extract`, its text content); `attributes` are its attributes by name; `html` is its outer HTML. Selecting `html` or `body` reads the page itself. A match travels by value: read within one by handing its `html` to `/extract`.

**`shadow: true`** on a call reaches CSS selectors into open shadow roots, such as those of web components. Closed shadow roots stay closed, and XPath doesn't enter shadow roots.

## Frames

**`frame` names an iframe a call works in**, by a CSS selector for the `<iframe>` element; a list of them is a path into nested iframes, each matched within the frame before it. A call naming none works in the page itself.

```javascript
['[scraper]/click', {on: '#search', frame: '#results'}]
['[scraper]/extract', {frame: ['#checkout', 'iframe[name="card"]'], select: {total: '.total'}}]
```

- **The first iframe a selector matches is the frame**, as for `on`; one matching nothing, or an element that holds no frame, fails the call. `shadow: true` reaches it in open shadow roots.
- **A frame is found afresh each time**: before the call's action, and again for `select` after it. `/waitFor` looks for it on each try, so it waits for a frame that loads late.
- **Cross-site frames work as any other.** Chrome runs them in a process of their own, which the session's handle reaches (`frame(frameId)`, [MicroQL § Handles](https://github.com/TorchlightSoftware/microql/blob/main/docs/service-guide.md#handles)), and clicks and the wheel land where the frame is shown on the page, scrolled into view.
- **What it means for each call**: the element `on` and `to` act on, `select`, and `/eval`'s JavaScript are in the frame; `/scroll` by an amount scrolls the frame; `/screenshot` is cropped to it. `/open` opens its URL in the page, and `/keysequence` presses keys to what has the focus, which a `/click` in the frame moves there: for them, `frame` says only where `select` reads. `/extract` refuses `html` with a `frame`.

## Calls

Every call takes `session`, `frame`, and `select`: what to read, by key, right after the call's action. A call returns what it read, and `{}` when it reads nothing. The first field listed is the call's target: it may come before the key, as in `[url, '[scraper]/open', {...}]`.

| Call | Does |
|---|---|
| `/open {url}` | opens a URL, absolute or relative to the page the session is on, once the page's network has gone quiet |
| `/click {on}` | clicks the first element `on` matches, as a person would: scrolled into view, pressed at its middle |
| `/type {on, text}` | focuses the first element `on` matches, and types the text as an input method would, firing `input` events |
| `/keysequence {keys, interval}` | presses keys one at a time, `interval` ms apart, to what has the focus: characters (`'a'`), or keys by name (`'Enter'`, `'Tab'`, `'Escape'`, `'Backspace'`, `'Delete'`, the arrows, `'Home'`, `'End'`, `'PageUp'`, `'PageDown'`) |
| `/scroll {to}`, `/scroll {down, up, left, right}` | scrolls to the first element `to` matches, or by pixels, as a mouse wheel; `down` with `right` goes both ways, `down` with `up` is refused |
| `/screenshot {}` | the page as it's shown, a PNG in base64, as `screenshot` |
| `/extract {html, select}` | reads only: the session's page, or the HTML given, parsed apart from the page (its scripts don't run). A session with no page open, and no HTML, fails |
| `/eval {js, select}` | evaluates JavaScript in the page, each key an expression, or `[expression, schema]` to check its value by; `select` reads after, into the same result |
| `/waitFor {select, tries, interval}` | reads `select` every `interval` ms (200) until its matches fit their selectors, at most `tries` times (10); a selector with no modifiers waits for at least one match. It gives up with `gave-up` |

**Content that loads after an action** is what `/waitFor` is for: `select` on an action reads right after it. To wait on something only JavaScript can tell, hold `/eval` in `[util]/waitFor`:

```javascript
['[util]/waitFor', {service: ['[scraper]/eval', {js: {rows: 'document.querySelectorAll(".row").length'}}], expect: {rows: ['number', {min: 50}]}}]
```

**Dialogs** (`alert`, `confirm`, `prompt`) are dismissed, and leaving a page (`beforeunload`) is allowed, so an action is never left waiting on one. An action takes `dialog: 'accept'` or `'dismiss'` to answer them otherwise. A link that opens a new tab (`target=_blank`, `window.open`) leaves the session on its own page.

**Your JavaScript runs only in `/eval`**, so an environment can turn JavaScript off by refusing that one call. Reads run in a world of the scraper's own, with the page's elements but not the globals its scripts may have replaced.

## Tests

`npm test` runs MicroQL's service smoke tests and the selector and key tests, with no browser. `npm run test:e2e` runs Queries in a headless Chrome, which the tests launch with Puppeteer (a dev dependency), against pages served from `test/e2e/fixtures`: on `127.0.0.1`, with frames from `localhost`, another site, which Chrome runs apart. `npm run test:live` reads a live page, toscrape.com's quotes sandbox, which exists to be scraped: it needs the network too.
