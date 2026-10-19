import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, dirname, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
export async function beisenServer(port = 0) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..'), output = resolve(root, '.preview/beisen-lab');
  await mkdir(output, { recursive: true });
  await build({ entryPoints: [resolve(root, 'tests/browser/beisen-lab.jsx')], outfile: resolve(output, 'beisen-lab.js'), bundle: true, format: 'esm',
    define: { 'process.env.NODE_ENV': '"production"' }, loader: { '.svg': 'dataurl' }, logLevel: 'error' });
  await build({ entryPoints: [resolve(root, 'tests/browser/components-phoenix-range.jsx')], outfile: resolve(output, 'beisen-range.js'), bundle: true, format: 'iife',
    define: { 'process.env.NODE_ENV': '"production"' }, alias: { util: resolve(root, 'tests/browser/beisen-util.js') }, loader: { '.svg': 'dataurl' }, logLevel: 'error' });
  const mime = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };
  const server = createServer(async (req, res) => { try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname), base = /^\/beisen-(lab|range)\./.test(pathname) ? output : root;
    if (pathname === '/range.html') { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end('<html lang="zh-CN"><meta charset="utf-8"><link rel="stylesheet" href="/beisen-range.css"><script defer src="/beisen-range.js"></script><body></body></html>'); return; }
    const allowed = pathname === '/' || pathname === '/test-beisen.html' || /^\/beisen-(lab|range)\.(js|css)$/.test(pathname)
      || /^\/(options|shared|content)\/[\w-]+\.(js|html|css)$/.test(pathname) || /^\/icons\/icon\d+\.png$/.test(pathname)
      || /^\/data\/(schools-cn|major-categories-cn|majors-cn)\.json$/.test(pathname)
      || ['/tests/browser/fixture-profile.js', '/tests/browser/options-mock.js'].includes(pathname);
    if (!allowed) throw new Error('Not a test resource');
    const path = resolve(base, '.' + (pathname === '/' ? '/test-beisen.html' : pathname));
    if (!path.startsWith(base + sep)) throw new Error('Invalid path');
    let body = await readFile(path);
    if (pathname === '/options/options.html') body = Buffer.from(body.toString().replace('<script type="module" src="options.js">', '<script type="module" src="/tests/browser/options-mock.js"></script><script type="module" src="options.js">'));
    res.setHeader('Content-Type', (mime[extname(path)] || 'application/octet-stream') + '; charset=utf-8'); res.end(body);
  } catch { res.writeHead(404); res.end('Not found'); } });
  await new Promise(resolveListen => server.listen(port, '127.0.0.1', resolveListen));
  return { server, output, origin: `http://127.0.0.1:${server.address().port}` };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { origin } = await beisenServer(43821); console.log('Fictional Beisen lab:', origin + '/test-beisen.html');
}
