import './globals';
import '../vscode/build/vite/setup-dev';
import { commands, create, URI } from '../vscode/src/vs/workbench/workbench.web.main.internal';

const baseUrl = new URL('.', document.baseURI);

/**
 * Webviews validate that they run on a `{{uuid}}` subdomain (derived from the parent origin).
 * On plain `localhost`, `{{uuid}}.localhost` resolves to loopback, so the webview content is self-hosted.
 * Everywhere else (reverse proxies, GitHub Pages) wildcard subdomains are not available, so the
 * official CDN endpoint for the (insider build) commit of the `vscode` submodule is used.
 */
function getWebviewEndpoint(): string {
	if (location.hostname === 'localhost') {
		const preUrl = new URL('vscode/src/vs/workbench/contrib/webview/browser/pre', baseUrl);
		return `${preUrl.protocol}//{{uuid}}.${preUrl.host}${preUrl.pathname}`;
	}
	return `https://{{uuid}}.vscode-cdn.net/insider/${__VSCODE_COMMIT__}/out/vs/workbench/contrib/webview/browser/pre/`;
}

/**
 * Commands contributed by the host page. Extensions can call them via `vscode.commands.executeCommand`.
 * This is how the (worker-hosted) playground extension reads and updates the browser URL.
 */
const hostCommands = [
	{
		id: 'playground.host.getUrl',
		handler: () => location.href,
	},
	{
		id: 'playground.host.replaceUrl',
		handler: (url: string) => {
			const target = new URL(url, location.href);
			if (target.origin !== location.origin || !target.pathname.startsWith(baseUrl.pathname)) {
				throw new Error(`Refusing to navigate to ${url}`);
			}
			history.replaceState(null, '', target);
		},
	},
];

// Forward back/forward navigation to the extension.
window.addEventListener('popstate', () => {
	commands.executeCommand('playground.onDidChangeUrl', location.href);
});

create(document.body, {
	workspaceProvider: {
		workspace: { folderUri: URI.from({ scheme: 'playground', path: '/' }) },
		trusted: true,
		open: async () => false,
	},
	additionalBuiltinExtensions: [URI.parse(new URL('playground-extension', baseUrl).href)],
	webviewEndpoint: getWebviewEndpoint(),
	commands: hostCommands,
	productConfiguration: {
		nameShort: 'VS Code Playground',
		nameLong: 'VS Code Playground',
		enableTelemetry: false,
	},
	windowIndicator: { label: '$(beaker) Playground', tooltip: 'VS Code Web Playground' },
	configurationDefaults: {
		'workbench.colorTheme': 'Default Dark Modern',
		'workbench.startupEditor': 'none',
		'workbench.activityBar.location': 'hidden',
		'workbench.layoutControl.enabled': false,
		'workbench.secondarySideBar.defaultVisibility': 'hidden',
		'workbench.tips.enabled': false,
		'window.commandCenter': false,
		'window.menuBarVisibility': 'hidden',
		'chat.disableAIFeatures': true,
		'security.workspace.trust.enabled': false,
		'editor.minimap.enabled': false,
		// The URL is the source of truth: never restore stale unsaved content.
		'files.autoSave': 'afterDelay',
		'files.hotExit': 'off',
	},
});
