import { defineConfig, type Plugin } from 'vite';
import { rollupEsmUrlPlugin } from '@vscode/rollup-plugin-esm-url';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

const vscodeRoot = join(import.meta.dirname, 'vscode');

/** Built-in extensions (from vscode/extensions) that are made available to the workbench. */
const builtinExtensionNames = [
	'theme-defaults',
	'theme-seti',
	'markdown-basics',
];

function readJson(path: string): unknown {
	return JSON.parse(readFileSync(path, 'utf8'));
}

/**
 * Mirrors `injectBuiltinExtensionsPlugin` from `vscode/build/vite/vite.config.ts`,
 * but only for a hand-picked set of (declarative) built-in extensions.
 */
function injectBuiltinExtensionsPlugin(): Plugin {
	const scan = () => builtinExtensionNames.map(name => {
		const dir = join(vscodeRoot, 'extensions', name);
		const nlsPath = join(dir, 'package.nls.json');
		return {
			extensionPath: name,
			packageJSON: readJson(join(dir, 'package.json')),
			packageNLS: existsSync(nlsPath) ? readJson(nlsPath) : undefined,
		};
	});
	const escapeHtml = (str: string) => str.replace(/[&<>"'`]/g, c => `&#${c.charCodeAt(0)};`);

	return {
		name: 'inject-builtin-extensions',
		transformIndexHtml: {
			order: 'pre',
			handler: html => html.replace('{{WORKBENCH_BUILTIN_EXTENSIONS}}', escapeHtml(JSON.stringify(scan()))),
		},
	};
}

/**
 * Iframe documents of VS Code (webview `pre/`, extension host iframe) must be served verbatim:
 * vite's HTML transform would inject its client script, which their CSP rejects.
 */
function serveRawIframeHtmlPlugin(): Plugin {
	return {
		name: 'serve-raw-iframe-html',
		configureServer(server) {
			server.middlewares.use((req, res, next) => {
				const pathname = req.url?.split('?')[0] ?? '';
				const prefix = `${server.config.base}vscode/`;
				if (!pathname.startsWith(prefix) || !pathname.endsWith('.html')) {
					return next();
				}
				const file = join(vscodeRoot, decodeURIComponent(pathname.slice(prefix.length)));
				if (!file.startsWith(join(vscodeRoot, 'src')) || !existsSync(file)) {
					return next();
				}
				res.setHeader('Content-Type', 'text/html; charset=utf-8');
				res.end(readFileSync(file));
			});
		},
	};
}

export default defineConfig({
	base: '/vscode/',
	plugins: [
		rollupEsmUrlPlugin({}),
		injectBuiltinExtensionsPlugin(),
		serveRawIframeHtmlPlugin(),
	],
	resolve: {
		alias: [
			// Copied into `src` by VS Code's postinstall (gitignored); resolve it from node_modules instead.
			{ find: /^\.\/codicon\.ttf$/, replacement: join(vscodeRoot, 'node_modules/@vscode/codicons/dist/codicon.ttf') },
		],
	},
	esbuild: {
		tsconfigRaw: {
			compilerOptions: {
				experimentalDecorators: true,
			},
		},
	},
	server: {
		port: 5280,
		strictPort: true,
		watch: {
			// Only VS Code sources are relevant for HMR; watching the whole submodule is slow and noisy.
			ignored: path => /[\\/]vscode[\\/](?!src[\\/]|src$)/.test(path.replace(import.meta.dirname, '')) || /node_modules/.test(path),
		},
	},
});
