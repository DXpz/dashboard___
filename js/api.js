/**
 * API service layer for /api/metrics endpoints
 * La URL base se configura desde la interfaz y se persiste en localStorage.
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

  async function get(path, params) {
    const url = `${getBase()}/api/metrics${path}${buildQuery(params)}`;
    const res = await fetch(url, {
      headers: { 'ngrok-skip-browser-warning': 'true' }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    return res.json();
  }

  return {
    getBase,
    setBase,
    isConfigured,
    invalidateCache() { _cache = null; _cacheKey = ''; },

    async dashboard(desde, hasta, limite_motivos = 30, limite_reuniones_muestra = 40) {
      const key = `${getBase()}|${desde || ''}|${hasta || ''}|${limite_motivos}|${limite_reuniones_muestra}`;
      if (_cache && _cacheKey === key) return _cache;
      const data = await get('/dashboard', { desde, hasta, limite_motivos, limite_reuniones_muestra });
      _cache = data;
      _cacheKey = key;
      return data;
    },

    resumen(desde, hasta) { return get('/resumen', { desde, hasta }); },
    asesores(desde, hasta) { return get('/asesores', { desde, hasta }); },
    asesor(nombre, desde, hasta) { return get('/asesor', { nombre, desde, hasta }); },
    propuestasPorRubro(desde, hasta) { return get('/propuestas-por-rubro', { desde, hasta }); },
    negociacion(desde, hasta) { return get('/negociacion', { desde, hasta }); },
    motivosPerdida(desde, hasta, limite = 50) { return get('/motivos-perdida', { desde, hasta, limite }); },
    reuniones(desde, hasta, limite = 200, offset = 0) { return get('/reuniones', { desde, hasta, limite, offset }); },
    listaAsesores(desde, hasta) { return get('/lista-asesores', { desde, hasta }); },

    async ping() {
      try { await get('/resumen', {}); return true; }
      catch { return false; }
    }
  };
})();
