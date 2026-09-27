import { lookup } from 'node:dns/promises';
import { request as httpsRequest } from 'node:https';
import ipaddr from 'ipaddr.js';
import { INTAKE_LIMITS } from './limits.js';

export function isPublicSourceAddress(address: string): boolean {
  try { return ipaddr.process(address).range() === 'unicast'; } catch { return false; }
}

export function validatePublicHttpsSourceUrl(value: string): URL {
  const target = new URL(value);
  if (target.protocol !== 'https:' || target.username || target.password || (target.port && target.port !== '443')) throw new Error('URL sources must use public HTTPS without credentials or a custom port');
  return target;
}

export interface FetchedSource { bytes: Buffer; contentType: string; finalUrl: string }

/**
 * GET a public HTTPS URL with DNS pinning (every resolved address must be
 * public unicast), redirect revalidation, a size cap, an idle timeout and a
 * total deadline that spans redirects.
 */
export async function fetchPublicHttps(url: string, options: { accept?: string; maxBytes?: number; deadline?: number } = {}, redirects = 0): Promise<FetchedSource> {
  const deadline = options.deadline ?? Date.now() + INTAKE_LIMITS.urlTotalDeadlineMs;
  const maxBytes = options.maxBytes ?? INTAKE_LIMITS.maxSourceBytes;
  const target = validatePublicHttpsSourceUrl(url);
  const addresses = await lookup(target.hostname.replace(/^\[|\]$/g, ''), { all: true });
  if (!addresses.length || addresses.some(({ address }) => !isPublicSourceAddress(address))) throw new Error('Private or reserved network addresses are not allowed');
  const remainingMs = deadline - Date.now();
  if (remainingMs <= 0) throw new Error('Source URL exceeded its total download deadline');
  return new Promise((resolve, reject) => {
    const req = httpsRequest(target, {
      timeout: INTAKE_LIMITS.urlIdleTimeoutMs,
      headers: { 'User-Agent': 'ExplainCanvasLab-Hypothesis/1.0', Accept: options.accept ?? 'text/html,text/plain,application/pdf' },
      lookup: ((_hostname: string, lookupOptions: { all?: boolean }, callback: (...args: any[]) => void) => lookupOptions.all
        ? callback(null, addresses)
        : callback(null, addresses[0]!.address, addresses[0]!.family)) as never,
    }, (res) => {
      const status = res.statusCode ?? 0;
      if ([301, 302, 303, 307, 308].includes(status)) {
        res.resume();
        clearTimeout(timer);
        if (redirects >= INTAKE_LIMITS.urlMaxRedirects || !res.headers.location) return reject(new Error('Too many source URL redirects'));
        return fetchPublicHttps(new URL(res.headers.location, target).href, { ...options, deadline }, redirects + 1).then(resolve, reject);
      }
      if (status !== 200) { res.resume(); clearTimeout(timer); return reject(new Error(`Source URL returned HTTP ${status}`)); }
      const chunks: Buffer[] = [];
      let length = 0;
      res.on('data', (chunk: Buffer) => {
        length += chunk.length;
        if (length > maxBytes) req.destroy(new Error(`Source exceeds ${Math.round(maxBytes / 1024 / 1024)} MB`));
        else chunks.push(chunk);
      });
      res.on('error', (error) => { clearTimeout(timer); reject(error); });
      res.on('end', () => { clearTimeout(timer); resolve({ bytes: Buffer.concat(chunks), contentType: String(res.headers['content-type'] ?? ''), finalUrl: target.href }); });
    });
    const timer = setTimeout(() => req.destroy(new Error('Source URL exceeded its total download deadline')), remainingMs);
    req.on('timeout', () => req.destroy(new Error('Source URL request timed out')));
    req.on('error', (error) => { clearTimeout(timer); reject(error); });
    req.end();
  });
}
