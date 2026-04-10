/**
 * Capa HTTP del panel: base URL en `localStorage`, timeouts en las peticiones.
 * Las rutas siguen la documentación del servidor API LEADS.
 */
const API = (() => {
  const STORAGE_KEY = 'dashboard_api_base';
  /**
   * Base por defecto (doc. API LEADS). El servidor puede usar otro `PORT` en `.env` (p. ej. 3002).
   * Sustituir: `localStorage.setItem('dashboard_api_base', 'http://host:puerto')` o `API.setBase(...)`.
   */
  /**
   * En Vercel (HTTPS) se deja vacío para usar rutas relativas `/api/...` que pasan por el
   * proxy serverless (evita mixed content). En local se puede sobreescribir con localStorage:
   *   localStorage.setItem('dashboard_api_base', 'http://200.35.189.139')
   */
  const DEFAULT_BASE = '';
  /**
   * Clave de API. En Vercel la clave la inyecta el proxy serverless (process.env.API_KEY),
   * por lo que aquí puede quedar vacía. En local con base HTTP directa, ponla en localStorage:
   *   localStorage.setItem('dashboard_api_key', 'tu-clave')
   */
  const API_KEY = localStorage.getItem('dashboard_api_key') ?? '';

  let _cache = null;
  let _cacheKey = '';

  function getBase() {
    return (localStorage.getItem(STORAGE_KEY) || DEFAULT_BASE).replace(/\/+$/, '') || '';
  }

  function getApiKey() {
    return API_KEY;
  }

  function isConfigured() {
    const b = getBase();
    return b === '' || b.startsWith('http');
  }

  function setBase(url) {
    localStorage.setItem(STORAGE_KEY, url.replace(/\/+$/, ''));
    _cache = null;
    _cacheKey = '';
  }

  /** Compatibilidad: la clave es fija en código; llamar no modifica la autenticación. */
  function setApiKey() {}

  function authHeaders(extra = {}) {
    const h = { 'ngrok-skip-browser-warning': 'true', ...extra };
    const key = getApiKey();
    if (key) h['X-API-Key'] = key;
    return h;
  }

  function buildQuery(params = {}) {
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') qs.append(k, v);
    });
    const str = qs.toString();
    return str ? `?${str}` : '';
  }

  const FETCH_TIMEOUT_MS = 25000;

  async function fetchWithTimeout(url, init = {}, ms = FETCH_TIMEOUT_MS) {
    const ctrl = new AbortController();
    const id = setTimeout(() => ctrl.abort(), ms);
    try {
      const headers = authHeaders(init.headers && typeof init.headers === 'object' ? init.headers : {});
      return await fetch(url, {
        ...init,
        signal: ctrl.signal,
        headers
      });
    } catch (e) {
      if (e?.name === 'AbortError') {
        throw new Error(`Tiempo de espera agotado (${Math.round(ms / 1000)} s). Compruebe la conexión.`);
      }
      throw e;
    } finally {
      clearTimeout(id);
    }
  }

  async function get(path, params) {
    const url = `${getBase()}/api/metrics${path}${buildQuery(params)}`;
    const res = await fetchWithTimeout(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    return res.json();
  }

  async function getHealth() {
    const url = `${getBase()}/api/health${buildQuery()}`;
    const res = await fetchWithTimeout(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    return res.json();
  }

  async function apiRoot(method, path, body) {
    const url = `${getBase()}${path.startsWith('/') ? path : `/${path}`}`;
    const opts = {
      method,
      headers: authHeaders()
    };
    if (body !== undefined && body !== null) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    const res = await fetchWithTimeout(url, opts);
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status}: ${t || res.statusText}`);
    }
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('application/json')) return res.json();
    return {};
  }

  /** Petición GET a una ruta absoluta bajo la base de la API. */
  async function getJsonPath(pathWithQuery) {
    const path = pathWithQuery.startsWith('/') ? pathWithQuery : `/${pathWithQuery}`;
    const url = `${getBase()}${path}`;
    const res = await fetchWithTimeout(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    return res.json();
  }

  return {
    getBase,
    setBase,
    get apiKey() {
      return API_KEY;
    },
    setApiKey,
    isConfigured,
    invalidateCache() { _cache = null; _cacheKey = ''; },

    /**
     * Resumen del panel: métricas agregadas; group_by_asesores (asesor|country),
     * group_by_propuestas (rubro|tipo_propuesta).
     */
    async dashboard(desde, hasta, limite_motivos = 30, limite_reuniones_muestra = 40, opts = {}) {
      const group_by_asesores = opts.group_by_asesores ?? 'asesor';
      const group_by_propuestas = opts.group_by_propuestas ?? 'rubro';
      const nombre = opts.nombre && String(opts.nombre).trim() ? String(opts.nombre).trim() : '';
      const key = `${getBase()}|${getApiKey()}|${desde || ''}|${hasta || ''}|${limite_motivos}|${limite_reuniones_muestra}|${group_by_asesores}|${group_by_propuestas}|${nombre}`;
      if (_cache && _cacheKey === key) return _cache;
      const data = await get('/dashboard', {
        desde,
        hasta,
        limite_motivos,
        limite_reuniones_muestra,
        group_by_asesores,
        group_by_propuestas,
        ...(nombre ? { nombre } : {})
      });
      _cache = data;
      _cacheKey = key;
      return data;
    },

    resumen(desde, hasta, nombre) {
      return get('/resumen', { desde, hasta, ...(nombre ? { nombre: String(nombre).trim() } : {}) });
    },
    asesores(desde, hasta, group_by = 'asesor', nombre) {
      return get('/asesores', {
        desde,
        hasta,
        group_by,
        ...(nombre ? { nombre: String(nombre).trim() } : {})
      });
    },
    asesor(nombre, desde, hasta) { return get('/asesor', { nombre, desde, hasta }); },
    propuestasPorRubro(desde, hasta, group_by = 'rubro', nombre) {
      return get('/propuestas-por-rubro', {
        desde,
        hasta,
        group_by,
        ...(nombre ? { nombre: String(nombre).trim() } : {})
      });
    },
    negociacion(desde, hasta, nombre) {
      return get('/negociacion', { desde, hasta, ...(nombre ? { nombre: String(nombre).trim() } : {}) });
    },
    motivosPerdida(desde, hasta, limite = 50, nombre) {
      return get('/motivos-perdida', {
        desde,
        hasta,
        limite,
        ...(nombre ? { nombre: String(nombre).trim() } : {})
      });
    },
    motivosPerdidaAgrupados(desde, hasta, nombre) {
      return get('/motivos-perdida/agrupados', {
        desde,
        hasta,
        ...(nombre ? { nombre: String(nombre).trim() } : {})
      });
    },
    reuniones(desde, hasta, limite = 200, offset = 0, extra = {}) {
      return get('/reuniones', { desde, hasta, limite, offset, ...extra });
    },
    listaAsesores(desde, hasta, nombre) {
      return get('/lista-asesores', {
        desde,
        hasta,
        ...(nombre ? { nombre: String(nombre).trim() } : {})
      });
    },

    /** Origen de leads: validator_source; params extra p. ej. agrupación temporal (día/semana/mes) según API. */
    fuentes(desde, hasta, extra = {}) {
      return get('/fuentes', { desde, hasta, ...extra });
    },

    tiempoRespuesta(desde, hasta, groupBy = 'asesor', extra = {}) {
      return get('/tiempo-respuesta', { desde, hasta, group_by: groupBy, ...extra });
    },

    nivelesEscalacion(desde, hasta, extra = {}) {
      return get('/niveles-escalacion', { desde, hasta, ...extra });
    },

    /**
     * Lista de asesores. opts: { activo?: boolean, pais?: string }.
     * Compat: advisorsList(true|false) sigue funcionando como filtro activo.
     */
    advisorsList(opts) {
      const params = {};
      let o = opts;
      if (typeof opts === 'boolean') {
        o = { activo: opts };
      }
      if (o && typeof o === 'object') {
        if (o.activo === true || o.activo === false) params.activo = o.activo;
        if (o.pais != null && String(o.pais).trim() !== '') params.pais = String(o.pais).trim();
      }
      return getJsonPath(`/api/advisors${buildQuery(params)}`);
    },

    /** Crea un asesor en el servidor. */
    advisorsCreate(body) {
      return apiRoot('POST', '/api/advisors', body);
    },

    /** Actualiza un asesor; cuerpo p. ej. { activo, nombre_vendedor, correo_vendedor, pais } */
    advisorsPatch(id, body) {
      const sid = encodeURIComponent(String(id));
      return apiRoot('PATCH', `/api/advisors/${sid}`, body);
    },

    /** Elimina un asesor en el servidor; si no está disponible, el panel usa otro flujo. */
    advisorsDelete(id) {
      const sid = encodeURIComponent(String(id));
      return apiRoot('DELETE', `/api/advisors/${sid}`);
    },

    /** Comprobación ligera de que el servidor responde. */
    health: () => getHealth(),

    /** Historial de versiones de la propuesta para un audit_id. */
    async propuestaHistory(auditId) {
      const id = auditId != null ? String(auditId).trim() : '';
      if (!id) throw new Error('audit_id requerido');
      const url = `${getBase()}/api/audit/${encodeURIComponent(id)}/propuesta/history`;
      const res = await fetchWithTimeout(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      return res.json();
    },

    async ping() {
      try { await getHealth(); return true; }
      catch { return false; }
    }
  };
})();
