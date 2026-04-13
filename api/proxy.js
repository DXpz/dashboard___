export default async function handler(req, res) {
  const base = (process.env.API_UPSTREAM ?? '').trim().replace(/\/+$/, '');
  if (!base) {
    return res.status(500).json({ error: 'API_UPSTREAM no definida en Vercel.' });
  }

  // _path viene del rewrite: /api/metrics/lista-asesores → ?_path=metrics/lista-asesores
  const pathParam = req.query._path ?? '';
  const suffix = Array.isArray(pathParam) ? pathParam.join('/') : pathParam;

  // Reenviar query params originales (excepto _path)
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(req.query)) {
    if (k === '_path') continue;
    if (Array.isArray(v)) v.forEach((val) => qs.append(k, val));
    else qs.set(k, v);
  }
  const queryString = qs.toString();
  const target = `${base}/api/${suffix}${queryString ? `?${queryString}` : ''}`;

  const upstreamHeaders = {};
  const serverKey = (process.env.API_KEY ?? '').trim();
  if (serverKey) upstreamHeaders['X-API-Key'] = serverKey;

  const forwarded = ['content-type', 'accept', 'authorization'];
  for (const h of forwarded) {
    const val = req.headers[h];
    if (val) upstreamHeaders[h] = Array.isArray(val) ? val[0] : val;
  }

  const method = req.method ?? 'GET';
  let body;
  if (method !== 'GET' && method !== 'HEAD') {
    body = await new Promise((resolve) => {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => resolve(Buffer.concat(chunks)));
    });
    if (body.length === 0) body = undefined;
  }

  try {
    const upstream = await fetch(target, { method, headers: upstreamHeaders, body });
    const outType = upstream.headers.get('content-type');
    if (outType) res.setHeader('Content-Type', outType);
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    const buffer = Buffer.from(await upstream.arrayBuffer());
    res.status(upstream.status).send(buffer);
  } catch (err) {
    console.error('[proxy] Error conectando a', target, err);
    res.status(502).json({ error: 'Error conectando al upstream.', detail: String(err) });
  }
}
