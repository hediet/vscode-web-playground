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

* **Webviews need a `{{uuid}}` subdomain.** `pre/index.html` verifies that it runs on a hostname derived from the parent origin. Locally, `{{uuid}}.localhost` works (browsers resolve `*.localhost` to loopback). Static hosts without wildcard subdomains (GitHub Pages) must use the official `vscode-cdn.net` webview endpoint, which only exists for released commits.
* **Do not block activation on layout commands.** On reload, VS Code restores the `playground:` editor, which waits for the extension activation; layout commands in turn wait for the restore.
* **`codicon.ttf`** is gitignored in VS Code (copied by its postinstall), so Vite aliases it to `node_modules/@vscode/codicons`.
* Iframe documents of VS Code are served raw, otherwise Vite injects its client script, which their CSP blocks.

## Next steps

* `vite build` + GitHub Pages deployment (static copy of `vscode/src/**/pre`, built-in extensions, codicons; webview endpoint from the CDN).
