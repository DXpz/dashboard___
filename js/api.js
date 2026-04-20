/**
 * Capa HTTP del panel: base URL en `localStorage`, timeouts en las peticiones.
 * Rutas al backend API LEADS (métricas bajo `/api/metrics/*`).
 */
const API = (() => {
  const STORAGE_KEY = 'dashboard_api_base';
  /**
   * Base por defecto (sin puerto en la URL: el servidor suele exponerse en 80/443 detrás del balanceador).
   * Si necesita puerto explícito: `localStorage.setItem('dashboard_api_base', 'http://host:3001')` o `API.setBase(...)`.
   */
  const DEFAULT_BASE = 'http://200.35.189.139';
  /** Única clave usada en todas las peticiones (`X-API-Key`). No se lee desde localStorage. */
  const API_KEY = 'RedApi_2026_SuperSegura_9XK2';

  let _cache = null;
  let _cacheKey = '';

  /**
   * En HTTPS (p. ej. Vercel) las peticiones van al mismo origen para usar el proxy `/api/*`.
   * Llamar directo a `http://IP` desde HTTPS provoca mixed content o timeouts.
   */
  function resolveDefaultBase() {
    if (typeof window !== 'undefined' && window.location?.protocol === 'https:') {
      return window.location.origin || DEFAULT_BASE;
    }
    return DEFAULT_BASE;
  }

  function getBase() {
    const stored = localStorage.getItem(STORAGE_KEY);
    const raw = stored && String(stored).trim() !== '' ? String(stored).trim() : resolveDefaultBase();
    return raw.replace(/\/+$/, '') || '';
  }

  function getApiKey() {
    return API_KEY;
  }

  function isConfigured() {
    return !!getBase();
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

  /** Código de país para query `pais`. Vacío → no se envía. */
  function normPaisQuery(p) {
    if (p == null || String(p).trim() === '') return '';
    return String(p).trim().toUpperCase();
  }

  function paisParam(p) {
    const code = normPaisQuery(p);
    return code ? { pais: code } : {};
  }

  function nombreParam(nombre) {
    return nombre && String(nombre).trim() ? { nombre: String(nombre).trim() } : {};
  }

  const FETCH_TIMEOUT_MS = 25000;

  function timeoutError(ms) {
    return new Error(`Tiempo de espera agotado (${Math.round(ms / 1000)} s). Compruebe la conexión.`);
  }

  /** Fetch + lectura JSON bajo un único temporizador (incluye cuerpo lento o incompleto). */
  async function fetchJson(url, init = {}, ms = FETCH_TIMEOUT_MS) {
    const ctrl = new AbortController();
    const id = setTimeout(() => ctrl.abort(), ms);
    try {
      const headers = authHeaders(init.headers && typeof init.headers === 'object' ? init.headers : {});
      const res = await fetch(url, {
        ...init,
        signal: ctrl.signal,
        headers
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      return await res.json();
    } catch (e) {
      if (e?.name === 'AbortError') throw timeoutError(ms);
      throw e;
    } finally {
      clearTimeout(id);
    }
  }

  async function get(path, params) {
    const url = `${getBase()}/api/metrics${path}${buildQuery(params)}`;
    return fetchJson(url);
  }

  async function getHealth() {
    const url = `${getBase()}/api/health${buildQuery()}`;
    return fetchJson(url);
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
    const ctrl = new AbortController();
    const id = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(url, { ...opts, signal: ctrl.signal });
      if (!res.ok) {
        const t = await res.text().catch(() => '');
        throw new Error(`HTTP ${res.status}: ${t || res.statusText}`);
      }
      const ct = res.headers.get('content-type') || '';
      if (ct.includes('application/json')) return await res.json();
      return {};
    } catch (e) {
      if (e?.name === 'AbortError') throw timeoutError(FETCH_TIMEOUT_MS);
      throw e;
    } finally {
      clearTimeout(id);
    }
  }

  /** Petición GET a una ruta absoluta bajo la base de la API. */
  async function getJsonPath(pathWithQuery) {
    const path = pathWithQuery.startsWith('/') ? pathWithQuery : `/${pathWithQuery}`;
    const url = `${getBase()}${path}`;
    return fetchJson(url);
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
      const paisCode = normPaisQuery(opts.pais);
      const key = `${getBase()}|${getApiKey()}|${desde || ''}|${hasta || ''}|${limite_motivos}|${limite_reuniones_muestra}|${group_by_asesores}|${group_by_propuestas}|${nombre}|${paisCode}`;
      if (_cache && _cacheKey === key) return _cache;
      const data = await get('/dashboard', {
        desde,
        hasta,
        limite_motivos,
        limite_reuniones_muestra,
        group_by_asesores,
        group_by_propuestas,
        ...nombreParam(nombre),
        ...paisParam(paisCode)
      });
      _cache = data;
      _cacheKey = key;
      return data;
    },

    resumen(desde, hasta, nombre, pais) {
      return get('/resumen', { desde, hasta, ...nombreParam(nombre), ...paisParam(pais) });
    },
    asesores(desde, hasta, group_by = 'asesor', nombre, pais) {
      return get('/asesores', {
        desde,
        hasta,
        group_by,
        ...nombreParam(nombre),
        ...paisParam(pais)
      });
    },
    asesor(nombre, desde, hasta, pais) {
      return get('/asesor', { nombre, desde, hasta, ...paisParam(pais) });
    },
    propuestasPorRubro(desde, hasta, group_by = 'rubro', nombre, pais) {
      return get('/propuestas-por-rubro', {
        desde,
        hasta,
        group_by,
        ...nombreParam(nombre),
        ...paisParam(pais)
      });
    },
    negociacion(desde, hasta, nombre, pais) {
      return get('/negociacion', { desde, hasta, ...nombreParam(nombre), ...paisParam(pais) });
    },
    motivosPerdida(desde, hasta, limite = 50, nombre, pais) {
      return get('/motivos-perdida', {
        desde,
        hasta,
        limite,
        ...nombreParam(nombre),
        ...paisParam(pais)
      });
    },
    motivosPerdidaAgrupados(desde, hasta, nombre, pais) {
      return get('/motivos-perdida/agrupados', {
        desde,
        hasta,
        ...nombreParam(nombre),
        ...paisParam(pais)
      });
    },
    reuniones(desde, hasta, limite = 200, offset = 0, extra = {}) {
      return get('/reuniones', { desde, hasta, limite, offset, ...extra });
    },
    listaAsesores(desde, hasta, nombre, pais) {
      return get('/lista-asesores', {
        desde,
        hasta,
        ...nombreParam(nombre),
        ...paisParam(pais)
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
     * Decisiones aceptación/rechazo: global + por asesor (también viene en GET /metrics/dashboard → decisiones).
     */
    decisiones(desde, hasta, extra = {}) {
      return get('/decisiones', { desde, hasta, ...extra });
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
               if (o.pais != null && String(o.pais).trim() !== '') params.pais = normPaisQuery(o.pais);
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

    /** Catálogo de etapas del embudo comercial. */
    opportunityStages() {
      return getJsonPath('/api/opportunity-stages');
    },

    /** Historial del lead por opportunityNumber; mergeAudit mezcla auditoría + estado del front. */
    async leadHistory(opportunityNumber, mergeAudit = true) {
      const id = opportunityNumber != null ? String(opportunityNumber).trim() : '';
      if (!id) throw new Error('opportunityNumber requerido');
      const url = `${getBase()}/api/history${buildQuery({
        opportunityNumber: id,
        mergeAudit: mergeAudit ? 1 : 0
      })}`;
      return fetchJson(url);
    },

    /** Historial de versiones de la propuesta para un audit_id. */
    async propuestaHistory(auditId) {
      const id = auditId != null ? String(auditId).trim() : '';
      if (!id) throw new Error('audit_id requerido');
      const url = `${getBase()}/api/audit/${encodeURIComponent(id)}/propuesta/history`;
      return fetchJson(url);
    },

    async ping() {
      try { await getHealth(); return true; }
      catch { return false; }
    }
  };
})();
