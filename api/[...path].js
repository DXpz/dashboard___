export default async function handler(req, res) {
  const base = (process.env.API_UPSTREAM ?? '').trim().replace(/\/+$/, '');

  if (!base) {
    res.status(500).json({ error: 'API_UPSTREAM no definida en Vercel.' });
    return;
  }

  // Reconstruir el sufijo de ruta desde el parámetro catch-all
  const pathParam = req.query.path;
  const suffix = Array.isArray(pathParam)
    ? pathParam.join('/')
    : typeof pathParam === 'string'
    ? pathParam
    : '';

  // Reenviar query string (excepto el parámetro interno "path")
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(req.query)) {
    if (key === 'path') continue;
    const v = Array.isArray(value) ? value : [String(value)];
    for (const val of v) qs.append(key, val);
  }
  const queryString = qs.toString();
  const target = `${base}/api/${suffix}${queryString ? `?${queryString}` : ''}`;

  // Cabeceras al upstream
  const upstreamHeaders = {};
  upstreamHeaders['ngrok-skip-browser-warning'] = 'true';
  // La clave se inyecta desde la variable de entorno del servidor (nunca se expone al browser)
  const serverKey = (process.env.API_KEY ?? '').trim();
  if (serverKey) upstreamHeaders['X-API-Key'] = serverKey;
  const contentType = req.headers['content-type'];
  if (contentType) upstreamHeaders['Content-Type'] = Array.isArray(contentType) ? contentType[0] : contentType;
  const accept = req.headers['accept'];
  if (accept) upstreamHeaders['Accept'] = Array.isArray(accept) ? accept[0] : accept;

  const method = req.method ?? 'GET';
  let body;
  if (method !== 'GET' && method !== 'HEAD') {
    if (req.body != null) {
      body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
      if (!contentType) upstreamHeaders['Content-Type'] = 'application/json';
    }
  }

  try {
    const upstream = await fetch(target, { method, headers: upstreamHeaders, body });
    const outType = upstream.headers.get('content-type');
    if (outType) res.setHeader('Content-Type', outType);
    // Evitar que Vercel o el browser cacheen respuestas de la API
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    const buffer = Buffer.from(await upstream.arrayBuffer());
    res.status(upstream.status).send(buffer);
  } catch (err) {
    console.error('[proxy] Error al contactar upstream:', target, err);
    res.status(502).json({
      error: 'No se pudo conectar con el backend.',
      target,
      detail: String(err),
    });
  }
}
