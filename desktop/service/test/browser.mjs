// The desktop windows use WebView2 (Edge) on Windows and WKWebView (WebKit) on
// macOS; test in the matching engine. MRMAK_TEST_BROWSER overrides
// (msedge, chrome, chromium or webkit).
import { chromium, webkit } from '@playwright/test';
import { readFile } from 'node:fs/promises';

// Standalone browser tests receive the same native initialization script as Tauri.
export async function desktopAuth(context, url) {
  const address = new URL(url);
  const script = await readFile(new URL('../../../src-tauri/src/desktop-auth.js', import.meta.url), 'utf8');
  await context.addInitScript({ content: script.replace('__MRMAK_SERVICE_ORIGIN__', JSON.stringify(address.origin)).replace('__MRMAK_SERVICE_TOKEN__', JSON.stringify(address.searchParams.get('token'))) });
}

export const testBrowser = process.env.MRMAK_TEST_BROWSER || (process.platform === 'darwin' ? 'webkit' : 'msedge');

export function launchBrowser(options = {}) {
  if (testBrowser === 'webkit') {
    const { args: _chromiumOnly, ...rest } = options;
    return webkit.launch({ headless: true, ...rest });
  }
  return chromium.launch({ headless: true, ...options, channel: testBrowser === 'chromium' ? undefined : testBrowser });
}

// WebKit knows only 'clipboard-read'; its clipboard writes need no grant.
export const clipboardPermissions = testBrowser === 'webkit' ? ['clipboard-read'] : ['clipboard-read', 'clipboard-write'];
