import { execFile } from 'node:child_process';
import { access } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const execute = promisify(execFile);

// Use a dedicated HTTPS port. Never reset or replace someone else's Serve setup.
export class TailscaleTransport {
  async command(args) {
    let executable = 'tailscale';
    if (process.platform === 'win32') {
      const installed = path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Tailscale', 'tailscale.exe');
      try { await access(installed); executable = installed; } catch { /* Try PATH. */ }
    }
    if (process.platform === 'darwin') {
      // The Mac App Store / standalone Tailscale app does not put its CLI on PATH by default.
      const installed = '/Applications/Tailscale.app/Contents/MacOS/Tailscale';
      try { await access(installed); executable = installed; } catch { /* Try PATH. */ }
    }
    return execute(executable, args, { windowsHide: true, timeout: 12000, maxBuffer: 1024 * 1024 });
  }
  async probe() {
    try {
      const { stdout } = await this.command(['status', '--json']);
      const status = JSON.parse(stdout);
      const hostname = String(status.Self?.DNSName || '').replace(/\.$/, '');
      return { installed: true, ready: status.BackendState === 'Running' && /^[a-z0-9.-]+\.ts\.net$/i.test(hostname), hostname, message: status.BackendState === 'Running' ? '' : 'Open Tailscale and sign in on this computer.' };
    } catch (error) {
      return { installed: error.code !== 'ENOENT', ready: false, message: error.code === 'ENOENT' ? 'Install Tailscale on this computer and your phone, then sign in to the same account.' : 'Open Tailscale, sign in, then check the connection again.' };
    }
  }
  async config() { return JSON.parse((await this.command(['serve', 'status', '--json'])).stdout || '{}'); }
  owns(config, saved) {
    if (!saved?.hostname || !saved?.port || !saved?.target) return false;
    const handlers = config.Web?.[`${saved.hostname}:${saved.port}`]?.Handlers;
    return Object.keys(handlers || {}).length === 1 && handlers['/']?.Proxy === saved.target;
  }
  async enable(target, previous) {
    const status = await this.probe();
    if (!status.ready) throw new Error(status.message || 'Tailscale needs an HTTPS device name. Enable MagicDNS in your Tailscale account.');
    const config = await this.config();
    let port = previous?.hostname === status.hostname && this.owns(config, previous) ? previous.port : null;
    if (!port) port = [8443, 8444, 8445, 8446].find(value => !config.TCP?.[value] && !Object.keys(config.Web || {}).some(key => key.endsWith(`:${value}`)));
    if (!port) throw new Error('Tailscale HTTPS ports 8443–8446 are already in use. Free one of these ports and try again.');
    if (config.AllowFunnel?.[`${status.hostname}:${port}`]) throw new Error('This Tailscale port is publicly shared. Turn off Funnel for this port before connecting Mr. Mak.');
    try { await this.command(['serve', '--bg', '--yes', `--https=${port}`, target]); }
    catch {
      const hint = process.platform === 'win32' ? ' Windows may require an administrator terminal for the initial Serve setup.' : process.platform === 'darwin' ? ' Make sure the Tailscale app is running and signed in.' : '';
      throw new Error(`Tailscale Serve could not start. Enable HTTPS for this device in Tailscale and check its Serve permissions.${hint} See the setup instructions below.`);
    }
    const saved = { port, hostname: status.hostname, target };
    const verified = await this.config();
    if (!this.owns(verified, saved) || verified.AllowFunnel?.[`${saved.hostname}:${port}`]) throw new Error('The private Tailscale route could not be verified. Mobile access remains off.');
    return { ...saved, origin: `https://${status.hostname}:${port}` };
  }
  async disable(saved) {
    if (saved && this.owns(await this.config(), saved)) await this.command(['serve', '--yes', `--https=${saved.port}`, 'off']);
  }
}
