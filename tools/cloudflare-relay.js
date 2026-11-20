// NeonWave download relay — paste this whole file into a Cloudflare Worker (free plan).
// It only fetches Jamendo files, only for the NeonWave site, and adds the CORS headers Jamendo omits.
// It is NOT an open proxy: any other host is refused.

const APP_ORIGINS = ['https://salah-don.github.io', 'http://localhost:8080', 'http://localhost:4173'];
const ALLOWED_HOST = /(^|\.)jamendo\.com$/;

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': APP_ORIGINS.includes(origin) ? origin : APP_ORIGINS[0],
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Range',
    'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Content-Type',
    Vary: 'Origin',
  };
}

function allowed(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && ALLOWED_HOST.test(u.hostname);
  } catch {
    return false;
  }
}

export default {
  async fetch(request) {
    const cors = corsHeaders(request.headers.get('Origin'));
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (request.method !== 'GET') return new Response('Method not allowed', { status: 405, headers: cors });

    const target = new URL(request.url).searchParams.get('url');
    if (!target) return new Response('NeonWave relay OK', { status: 200, headers: cors });
    if (!allowed(target)) return new Response('Forbidden host', { status: 403, headers: cors });

    const range = request.headers.get('Range');
    const upstream = await fetch(target, { headers: range ? { Range: range } : {}, redirect: 'follow' });
    if (!allowed(upstream.url)) return new Response('Forbidden redirect', { status: 403, headers: cors });

    const headers = new Headers();
    for (const h of ['Content-Type', 'Content-Length', 'Content-Range', 'Accept-Ranges']) {
      const v = upstream.headers.get(h);
      if (v) headers.set(h, v);
    }
    for (const [k, v] of Object.entries(cors)) headers.set(k, v);
    return new Response(upstream.body, { status: upstream.status, headers });
  },
};
