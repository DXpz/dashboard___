/**
 * Capa HTTP del panel: base URL en `localStorage`, timeouts en las peticiones.
 * Las rutas siguen la documentación del servidor API LEADS.
 */
const API = (() => {
  const STORAGE_KEY = 'dashboard_api_base';
  const DEFAULT_BASE = 'https://focal-unpointed-hortencia.ngrok-free.dev';

  let _cache = null;
  let _cacheKey = '';

  function getBase() {
    return (localStorage.getItem(STORAGE_KEY) || DEFAULT_BASE).replace(/\/+$/, '') || '';
  }

  function isConfigured() {
    return !!getBase();
  }

  function setBase(url) {
    localStorage.setItem(STORAGE_KEY, url.replace(/\/+$/, ''));
    _cache = null;
    _cacheKey = '';
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
      return await fetch(url, {
        ...init,
        signal: ctrl.signal,
        headers: { 'ngrok-skip-browser-warning': 'true', ...init.headers }
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
      headers: { ...(body != null ? { 'Content-Type': 'application/json' } : {}) }
    };
    if (body != null) opts.body = JSON.stringify(body);
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
    isConfigured,
    invalidateCache() { _cache = null; _cacheKey = ''; },

    /**
     * Resumen del panel: métricas agregadas; group_by_asesores (asesor|country),
     * group_by_propuestas (rubro|tipo_propuesta).
     */
    async dashboard(desde, hasta, limite_motivos = 30, limite_reuniones_muestra = 40, opts = {}) {
      const group_by_asesores = opts.group_by_asesores ?? 'asesor';
      const group_by_propuestas = opts.group_by_propuestas ?? 'rubro';
      const key = `${getBase()}|${desde || ''}|${hasta || ''}|${limite_motivos}|${limite_reuniones_muestra}|${group_by_asesores}|${group_by_propuestas}`;
      if (_cache && _cacheKey === key) return _cache;
      const data = await get('/dashboard', {
        desde,
        hasta,
        limite_motivos,
        limite_reuniones_muestra,
        group_by_asesores,
        group_by_propuestas
      });
      _cache = data;
      _cacheKey = key;
      return data;
    },

    resumen(desde, hasta) { return get('/resumen', { desde, hasta }); },
    asesores(desde, hasta, group_by = 'asesor') { return get('/asesores', { desde, hasta, group_by }); },
    asesor(nombre, desde, hasta) { return get('/asesor', { nombre, desde, hasta }); },
    propuestasPorRubro(desde, hasta, group_by = 'rubro') {
      return get('/propuestas-por-rubro', { desde, hasta, group_by });
    },
    negociacion(desde, hasta) { return get('/negociacion', { desde, hasta }); },
    motivosPerdida(desde, hasta, limite = 50) { return get('/motivos-perdida', { desde, hasta, limite }); },
    motivosPerdidaAgrupados(desde, hasta) {
      return get('/motivos-perdida/agrupados', { desde, hasta });
    },
    reuniones(desde, hasta, limite = 200, offset = 0, extra = {}) {
      return get('/reuniones', { desde, hasta, limite, offset, ...extra });
    },
    listaAsesores(desde, hasta) { return get('/lista-asesores', { desde, hasta }); },

    /** Origen de leads: agrupa por fuente (validator_source). */
    fuentes(desde, hasta) {
      return get('/fuentes', { desde, hasta });
    },

    /** Lista de asesores del servidor; activo opcional: true | false */
    advisorsList(activo) {
      const params = {};
      if (activo === true || activo === false) params.activo = activo;
      return getJsonPath(`/api/advisors${buildQuery(params)}`);
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
