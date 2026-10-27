// Prepares the `vscode` submodule for running VS Code from sources in the browser.
// Only the root dependencies are needed (no Electron, no native modules, no built-in extension builds).
import { execSync } from 'child_process';
import { join } from 'path';

const root = join(import.meta.dirname, '..');
const run = (cmd, cwd = root) => execSync(cmd, {
	cwd,
	stdio: 'inherit',
	env: { ...process.env, ELECTRON_SKIP_BINARY_DOWNLOAD: '1', PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '1' },
});

run('git submodule update --init vscode');
run('npm ci --ignore-scripts --no-audit --no-fund', join(root, 'vscode'));
