# MicroQL services

Services for [MicroQL](https://github.com/TorchlightSoftware/microql), published under `@tlsft`. Each is a working service, and an example of how to write one: something a person or an LLM can copy from when adapting an API MicroQL doesn't cover yet.

MicroQL's own `[util]` is the reference implementation of a service, but it runs in-process, with no configuration, credentials or network. The services here are more advanced examples: REST APIs, scrapers, etc.

## Services

| Package | What it does | What it shows |
|---|---|---|
| [`@tlsft/microql-svc-scraper`](services/scraper) | Reads web pages, and acts on them as a person would, in a real browser: opening, clicking, typing, scrolling | A stateful resource the runtime keeps: a browser session, handed to each call as a handle |

```bash
npm install microql @tlsft/microql-svc-scraper
```

Each service's README says how to use it.

## Writing a service

**The spec is MicroQL's [service guide](https://github.com/TorchlightSoftware/microql/blob/main/docs/service-guide.md).** The packages here conform to it.

What each package here does:

- **One service per package**, in `services/<name>`, published as `@tlsft/microql-svc-<name>`, starting at `0.1.0`.
- **`microql` is a peer dependency**, so a Query and its services share one core.
- **Declarations are written on each service call**, in zodly: its `description`, `input` and `output`.
- **An instance gets what it needs from its runtime**: its own configuration at `init`, and capabilities such as a browser through handles. Never from `process.env` or `process.cwd()`.
- **`npm test` runs MicroQL's smoke tests** (`serviceSmokeTests`) against the service, plus its own tests, fast and with no network. Tests that need a browser or the network run in `npm run test:e2e` or `npm run test:live`, kept out of the default run.

## Development

This is an npm workspace. Node 22 or later.

```bash
npm install
npm test           # every service's fast tests
npm run test:e2e   # tests that need a browser
npm run test:live  # tests that need the network
npm run lint
```

The services develop against MicroQL from source: clone [microql](https://github.com/TorchlightSoftware/microql) beside this repo, as `../microql`, before `npm install`.

## License

MIT
