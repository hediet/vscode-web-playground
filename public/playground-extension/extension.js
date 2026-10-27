// @ts-check
const vscode = require('vscode');

const SCHEME = 'playground';
// The workspace folder; its basename is the folder name shown in the explorer.
const ROOT_URI = vscode.Uri.from({ scheme: SCHEME, path: '/playground' });
const FILE_URI = vscode.Uri.joinPath(ROOT_URI, 'foobar.txt');
const DEFAULT_TEXT = 'Hello from foobar.txt!\n\nEdit me: webview 1 renders this text live\nand the browser URL is updated, so you can share or reload it.\n';

/** An in-memory file system with a fixed folder (`ROOT_URI`) that contains files only. */
class MemFS {
	constructor() {
		/** @type {Map<string, { data: Uint8Array; ctime: number; mtime: number }>} */
		this.files = new Map();
		this._onDidChangeFile = new vscode.EventEmitter();
		this.onDidChangeFile = this._onDidChangeFile.event;
	}

	/** @param {vscode.Uri} uri */
	stat(uri) {
		if (uri.path === '/' || uri.path === ROOT_URI.path) {
			return { type: vscode.FileType.Directory, ctime: 0, mtime: 0, size: 0 };
		}
		const file = this._get(uri);
		return { type: vscode.FileType.File, ctime: file.ctime, mtime: file.mtime, size: file.data.byteLength };
	}

	/** @param {vscode.Uri} uri */
	readDirectory(uri) {
		if (uri.path === '/') {
			return [[ROOT_URI.path.slice(1), vscode.FileType.Directory]];
		}
		return [...this.files.keys()].map(path => [path.slice(ROOT_URI.path.length + 1), vscode.FileType.File]);
	}

	/** @param {vscode.Uri} uri */
	readFile(uri) {
		return this._get(uri).data;
	}

	/** @param {vscode.Uri} uri @param {Uint8Array} content */
	writeFile(uri, content) {
		const now = Date.now();
		const existing = this.files.get(uri.path);
		this.files.set(uri.path, { data: content, ctime: existing?.ctime ?? now, mtime: now });
		this._onDidChangeFile.fire([{ type: existing ? vscode.FileChangeType.Changed : vscode.FileChangeType.Created, uri }]);
	}

	/** @param {vscode.Uri} uri */
	delete(uri) {
		this._get(uri);
		this.files.delete(uri.path);
		this._onDidChangeFile.fire([{ type: vscode.FileChangeType.Deleted, uri }]);
	}

	/** @param {vscode.Uri} oldUri @param {vscode.Uri} newUri */
	rename(oldUri, newUri) {
		const file = this._get(oldUri);
		this.files.delete(oldUri.path);
		this.files.set(newUri.path, file);
		this._onDidChangeFile.fire([{ type: vscode.FileChangeType.Deleted, uri: oldUri }, { type: vscode.FileChangeType.Created, uri: newUri }]);
	}

	createDirectory() {
		throw vscode.FileSystemError.NoPermissions('Folders are not supported');
	}

	watch() {
		return new vscode.Disposable(() => { });
	}

	/** @param {vscode.Uri} uri */
	_get(uri) {
		const file = this.files.get(uri.path);
		if (!file) {
			throw vscode.FileSystemError.FileNotFound(uri);
		}
		return file;
	}
}

/** @param {string} url */
function textFromUrl(url) {
	return new URL(url).searchParams.get('text') ?? DEFAULT_TEXT;
}

/** @returns {Promise<string>} */
async function getHostUrl() {
	return /** @type {string} */ (await vscode.commands.executeCommand('playground.host.getUrl'));
}

/** @param {string} text */
async function writeTextToUrl(text) {
	const url = new URL(await getHostUrl());
	if (text === DEFAULT_TEXT) {
		url.searchParams.delete('text');
	} else {
		url.searchParams.set('text', text);
	}
	await vscode.commands.executeCommand('playground.host.replaceUrl', url.href);
	return url.href;
}

/** @param {string} title @param {string} body */
function webviewHtml(title, body) {
	return `<!DOCTYPE html>
<html>
<head>
	<meta charset="utf-8">
	<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
	<style>
		body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 12px 20px; }
		h1 { font-size: 1.1em; text-transform: uppercase; letter-spacing: .08em; color: var(--vscode-descriptionForeground); }
		pre { white-space: pre-wrap; word-break: break-word; font-size: 1.4em; line-height: 1.4; }
		code { word-break: break-all; }
		.stats { color: var(--vscode-descriptionForeground); }
		button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 6px 12px; cursor: pointer; }
		button:hover { background: var(--vscode-button-hoverBackground); }
	</style>
</head>
<body>
	<h1>${title}</h1>
	${body}
</body>
</html>`;
}

const previewHtml = webviewHtml('Webview 1 · Live preview of foobar.txt', `
	<div class="stats" id="stats"></div>
	<pre id="text"></pre>
	<script>
		window.addEventListener('message', e => {
			const text = e.data.text;
			document.getElementById('text').textContent = text.toUpperCase();
			const words = text.split(/\\s+/).filter(Boolean).length;
			document.getElementById('stats').textContent = text.length + ' characters · ' + words + ' words';
		});
	</script>
`);

const infoHtml = webviewHtml('Webview 2 · URL state', `
	<p>The extension mirrors <code>foobar.txt</code> into the browser URL. Current URL:</p>
	<p><code id="url"></code></p>
	<p><button id="reset">Reset foobar.txt</button> <button id="layout">Reset layout</button></p>
	<script>
		const vscode = acquireVsCodeApi();
		window.addEventListener('message', e => { document.getElementById('url').textContent = e.data.url; });
		document.getElementById('reset').addEventListener('click', () => vscode.postMessage({ type: 'reset' }));
		document.getElementById('layout').addEventListener('click', () => vscode.postMessage({ type: 'layout' }));
	</script>
`);

/** @param {vscode.ExtensionContext} context */
async function activate(context) {
	// Register synchronously, the workbench waits for this provider to resolve the workspace folder.
	const memfs = new MemFS();
	context.subscriptions.push(vscode.workspace.registerFileSystemProvider(SCHEME, memfs, { isCaseSensitive: true }));

	const initialUrl = await getHostUrl();
	memfs.writeFile(FILE_URI, new TextEncoder().encode(textFromUrl(initialUrl)));

	/** @type {vscode.WebviewPanel | undefined} */
	let preview;
	/** @type {vscode.WebviewPanel | undefined} */
	let info;
	let currentUrl = initialUrl;

	const getText = () => vscode.workspace.textDocuments.find(d => d.uri.toString() === FILE_URI.toString())?.getText()
		?? new TextDecoder().decode(memfs.readFile(FILE_URI));

	const updateWebviews = () => {
		preview?.webview.postMessage({ text: getText() });
		info?.webview.postMessage({ url: currentUrl });
	};

	/** @param {string} text */
	const setText = async text => {
		const doc = await vscode.workspace.openTextDocument(FILE_URI);
		if (doc.getText() === text) {
			return;
		}
		const edit = new vscode.WorkspaceEdit();
		edit.replace(FILE_URI, new vscode.Range(doc.positionAt(0), doc.positionAt(doc.getText().length)), text);
		await vscode.workspace.applyEdit(edit);
		await doc.save();
	};

	const applyLayout = async () => {
		await vscode.commands.executeCommand('workbench.action.closeAllEditors');
		// Sidebar with the file explorer showing the `playground:/` workspace folder.
		await vscode.commands.executeCommand('workbench.view.explorer');
		await vscode.commands.executeCommand('workbench.action.closePanel');
		await vscode.commands.executeCommand('workbench.action.closeAuxiliaryBar');

		// Left: one group. Right: a nested, vertically split group.
		await vscode.commands.executeCommand('vscode.setEditorLayout', {
			orientation: 0,
			groups: [{ size: 0.5 }, { size: 0.5, groups: [{ size: 0.5 }, { size: 0.5 }] }],
		});

		await vscode.window.showTextDocument(FILE_URI, { viewColumn: vscode.ViewColumn.One, preview: false });
		await vscode.commands.executeCommand('revealInExplorer', FILE_URI);

		preview = vscode.window.createWebviewPanel('playground.preview', 'Webview 1', { viewColumn: vscode.ViewColumn.Two, preserveFocus: true }, { enableScripts: true });
		preview.webview.html = previewHtml;
		preview.onDidDispose(() => preview = undefined);

		info = vscode.window.createWebviewPanel('playground.info', 'Webview 2', { viewColumn: vscode.ViewColumn.Three, preserveFocus: true }, { enableScripts: true });
		info.webview.html = infoHtml;
		info.onDidDispose(() => info = undefined);
		info.webview.onDidReceiveMessage(async msg => {
			if (msg.type === 'reset') {
				await setText(DEFAULT_TEXT);
			} else if (msg.type === 'layout') {
				await applyLayout();
			}
		});

		// Webviews load asynchronously, give them a moment before sending the initial state.
		setTimeout(updateWebviews, 300);
	};

	/** @type {ReturnType<typeof setTimeout> | undefined} */
	let urlUpdateTimeout;
	context.subscriptions.push(
		vscode.workspace.onDidChangeTextDocument(e => {
			if (e.document.uri.toString() !== FILE_URI.toString()) {
				return;
			}
			updateWebviews();
			clearTimeout(urlUpdateTimeout);
			urlUpdateTimeout = setTimeout(async () => {
				currentUrl = await writeTextToUrl(e.document.getText());
				updateWebviews();
			}, 300);
		}),
		vscode.commands.registerCommand('playground.resetLayout', applyLayout),
		vscode.commands.registerCommand('playground.onDidChangeUrl', async (/** @type {string} */ url) => {
			currentUrl = url;
			await setText(textFromUrl(url));
			updateWebviews();
		}),
	);

	// Do not await: when VS Code restores a `playground:` editor on reload, it waits for this activation
	// (`onFileSystem:playground`) to finish, and the layout commands wait for that restore -> deadlock.
	void applyLayout();
}

module.exports = { activate };
