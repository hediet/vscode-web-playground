# VS Code Web Playground

A browser playground built on VS Code running from sources (`vscode/` is a git submodule, **unmodified**).
An injected extension owns the whole experience: it mounts an in-memory file system, arranges the layout
and syncs its state with the browser URL.

```
┌──────────────┬──────────────┐
│              │  Webview 1   │
│  foobar.txt  ├──────────────┤
│              │  Webview 2   │
└──────────────┴──────────────┘
```

## Run

```sh
npm install
npm run setup   # init submodule + install its dependencies (web only, no native builds)
npm run dev     # http://localhost:5280/vscode/
```

The first page load takes a while: Vite serves thousands of VS Code source modules on demand.
The dev server accepts any `Host` (e.g. reverse proxies like `http://5280.<machine>.localhost/vscode/`).

Live: https://hediet.github.io/vscode-web-playground/

## Deploy

`npm run build` creates a static site in `dist/` (base path from `PLAYGROUND_BASE`, default `/vscode/`).
[deploy-pages.yml](.github/workflows/deploy-pages.yml) builds and publishes it to GitHub Pages on every push to `main`.

## How it works

Everything goes through VS Code's public embedder API (`create()` from `workbench.web.main.internal`).

| File | Role |
|---|---|
| [index.html](index.html) | Host page, contains the built-in extension list (filled in by Vite). |
| [src/main.ts](src/main.ts) | Calls `create(document.body, options)`: workspace `playground:/`, injected extension, configuration defaults, host commands. |
| [vite.config.ts](vite.config.ts) | Vite setup modeled after `vscode/build/vite/vite.config.ts`. |
| [public/playground-extension](public/playground-extension) | The injected web extension (plain CommonJS, no build step). |

* **Extension injection:** `additionalBuiltinExtensions` points at `/vscode/playground-extension/`. VS Code fetches its `package.json` and runs `extension.js` in the web worker extension host.
* **File system:** the extension registers a `FileSystemProvider` for the `playground` scheme. The workbench opens `playground:/` as its workspace folder and activates the extension via `onFileSystem:playground`.
* **Layout:** the extension calls `vscode.setEditorLayout` (left group + vertically split right group), opens `foobar.txt` in column 1 and two webview panels in columns 2 and 3.
* **URL access:** the extension host runs in a worker and cannot see the page URL. The host page contributes the commands `playground.host.getUrl` and `playground.host.replaceUrl`; `popstate` is forwarded to the extension command `playground.onDidChangeUrl`.

## Gotchas found so far

* **Webviews need a `{{uuid}}` subdomain.** `pre/index.html` verifies that it runs on a hostname derived from the parent origin. On plain `localhost`, `{{uuid}}.localhost` works (browsers resolve `*.localhost` to loopback), so the webview content is self-hosted. Everywhere else (reverse proxies, GitHub Pages) the official `vscode-cdn.net` endpoint is used, which only exists for commits that shipped as a build. The submodule must therefore stay on an insider build commit.
* **Do not block activation on layout commands.** On reload, VS Code restores the `playground:` editor, which waits for the extension activation; layout commands in turn wait for the restore.
* **`codicon.ttf`** is gitignored in VS Code (copied by its postinstall), so Vite aliases it to `node_modules/@vscode/codicons`.
* Iframe documents of VS Code are served raw, otherwise Vite injects its client script, which their CSP blocks.
* Vite binds `127.0.0.1` explicitly: on Windows it otherwise binds `::1` only, which IPv4-only forwarders cannot reach.
* The production build does not include the keyboard layout modules (dynamic import Vite cannot analyze), so keyboard layout detection is unavailable there.
