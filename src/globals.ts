// Must be evaluated before any VS Code module.
// Static resources (webview `pre/`, built-in extensions, node_modules) are resolved relative to this root.
globalThis._VSCODE_FILE_ROOT = new URL('vscode/src/', document.baseURI).href;
