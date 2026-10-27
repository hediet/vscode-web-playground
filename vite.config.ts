import { defineConfig, type Plugin } from 'vite';
import { rollupEsmUrlPlugin } from '@vscode/rollup-plugin-esm-url';
import { execSync } from 'child_process';
import { existsSync, readdirSync, readFileSync } from 'fs';
import { join, relative } from 'path';

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
		// The workbench loads built-in extensions from `${_VSCODE_FILE_ROOT}/../../extensions` (= `vscode/extensions`).
		generateBundle() {
			for (const name of builtinExtensionNames) {
				const dir = join(vscodeRoot, 'extensions', name);
				const files = readdirSync(dir, { recursive: true, withFileTypes: true })
					.filter(e => e.isFile())
					.map(e => relative(dir, join(e.parentPath, e.name)).replaceAll('\\', '/'))
					.filter(f => !/^(src|test|node_modules|build)\//.test(f) && !/^(tsconfig|esbuild|\.).*/.test(f));
				for (const file of files) {
					this.emitFile({ type: 'asset', fileName: `vscode/extensions/${name}/${file}`, source: readFileSync(join(dir, file)) });
				}
			}
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
	base: process.env.PLAYGROUND_BASE ?? '/vscode/',
	define: {
		__VSCODE_COMMIT__: JSON.stringify(execSync('git rev-parse HEAD', { cwd: vscodeRoot, encoding: 'utf8' }).trim()),
	},
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
	preview: {
		port: 5281,
		strictPort: true,
		host: '127.0.0.1',
	},
	server: {
		port: 5280,
		strictPort: true,
		// Allow access through reverse proxies such as `5280.<devbox>.localhost`.
		allowedHosts: true,
		// IPv4 loopback: reachable via `localhost` and by IPv4-only forwarders (Vite otherwise binds `::1` only on Windows).
		host: '127.0.0.1',
		watch: {
			// Only VS Code sources are relevant for HMR; watching the whole submodule is slow and noisy.
			ignored: path => /[\\/]vscode[\\/](?!src[\\/]|src$)/.test(path.replace(import.meta.dirname, '')) || /node_modules/.test(path),
		},
	},
});
