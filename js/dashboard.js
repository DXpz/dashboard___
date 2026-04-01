/**
 * Dashboard — métricas, gestión de asesores, orígenes de lead, reuniones e historial de propuestas.
 */
(() => {
  document.body.classList.add('app-ready');

  let currentSection = 'overview';
  let dashboardData = null;
  let reunionesPage = 0;
  const REUNIONES_LIMIT = 200;
  const LS_GESTION = 'dashboard_gestion_asesor_v1';
  let gestionRows = [];
  let gestionDeletePending = null;
  let toastHideTimer = null;
  let origenAgrupacion = 'week';

  const ORIGEN_ORDER = ['instagram', 'facebook', 'web', 'whatsapp', 'otro'];
  const ORIGEN_LABELS = {
    instagram: 'Instagram',
    facebook: 'Facebook',
    web: 'Página web',
    whatsapp: 'WhatsApp',
    otro: 'Otro / sin dato'
  };
  const ORIGEN_COLORS = {
    instagram: '#E4405F',
    facebook: '#1877F2',
    web: '#145478',
    whatsapp: '#25D366',
    otro: '#94a3b8'
  };
  /** Valores por defecto para la consulta del resumen general */
  const DASHBOARD_QUERY = { group_by_asesores: 'asesor', group_by_propuestas: 'rubro' };

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);
  const loading = $('#loadingOverlay');
  const connStatus = $('#connectionStatus');
  let titleLineFallbackTimer = null;

  const fmt = (n, dec = 0) =>
    n == null || isNaN(n) ? '—' : Number(n).toLocaleString('es-ES', { maximumFractionDigits: dec });

  const pct = (n) =>
    n == null || isNaN(n) ? '—' : `${Number(n).toFixed(1)}%`;

  function truncate(str, max) {
    if (!str) return '—';
    return str.length > max ? str.slice(0, max) + '…' : str;
  }

  function setLoading(on) {
    if (!loading) return;
    loading.classList.toggle('hidden', !on);
  }

  /** Deja el subrayado fijo (sin depender de que siga existiendo title-anim). */
  function finishTitleUnderline() {
    const pt = $('#pageTitle');
    if (!pt) return;
    pt.classList.remove('title-anim');
    pt.classList.add('title-line-shown');
  }

  /** Línea bajo el título: oculta al inicio; animación “subrayado”; luego title-line-shown */
  function triggerTitleUnderline() {
    const pt = $('#pageTitle');
    if (!pt) return;
    if (titleLineFallbackTimer) {
      clearTimeout(titleLineFallbackTimer);
      titleLineFallbackTimer = null;
    }
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      pt.classList.remove('title-anim');
      pt.classList.add('title-line-shown');
      return;
    }
    pt.classList.remove('title-line-shown', 'title-anim');
    void pt.offsetWidth;
    pt.classList.add('title-anim');
    /* Los ::before/::after no disparan animationend de forma fiable en todos los navegadores */
    titleLineFallbackTimer = setTimeout(() => {
      titleLineFallbackTimer = null;
      finishTitleUnderline();
    }, 850);
  }

  document.addEventListener(
    'animationend',
    (e) => {
      if (e.target?.id !== 'pageTitle') return;
      const name = e.animationName || '';
      if (!/titleBarFill/i.test(name)) return;
      if (titleLineFallbackTimer) {
        clearTimeout(titleLineFallbackTimer);
        titleLineFallbackTimer = null;
      }
      finishTitleUnderline();
    },
    true
  );

  /** Entrada de tarjetas/tablas al mostrar datos (el subrayado del título va aparte, al cambiar título / init). */
  function triggerSectionAnimations(section) {
    $$('.section').forEach((s) => s.classList.remove('section-enter'));
    const el = document.getElementById(`section-${section}`);
    if (!el || el.classList.contains('hidden')) return;
    void el.offsetWidth;
    el.classList.add('section-enter');
  }

  function setConnection(state, extra) {
    connStatus.className = `connection-status ${state}`;
    const txt = connStatus.querySelector('.status-text');
    if (state === 'connected') txt.textContent = extra ? `Conectado · v${extra}` : 'Conectado';
    else if (state === 'error') txt.textContent = 'Sin conexión';
    else txt.textContent = 'Conectando...';
  }

  /** ISO datetime: el input date solo da YYYY-MM-DD; el API filtra por datetime */
  function getFilters() {
    const d = $('#desde').value;
    const h = $('#hasta').value;
    return {
      desde: d ? (d.includes('T') ? d : `${d}T00:00:00`) : undefined,
      hasta: h ? (h.includes('T') ? h : `${h}T23:59:59.999`) : undefined
    };
  }

  const num = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  };

  function normName(n) {
    return String(n || '')
      .trim()
      .toLowerCase();
  }

  function loadGestionState() {
    try {
      const raw = localStorage.getItem(LS_GESTION);
      if (!raw) return { activo: {}, eliminados: [] };
      const o = JSON.parse(raw);
      return {
        activo: o.activo && typeof o.activo === 'object' ? o.activo : {},
        eliminados: Array.isArray(o.eliminados) ? o.eliminados : []
      };
    } catch {
      return { activo: {}, eliminados: [] };
    }
  }

  function saveGestionState(state) {
    localStorage.setItem(LS_GESTION, JSON.stringify(state));
  }

  /** Clave para persistir disponibilidad cuando no hay servidor o falla la actualización */
  function stateKeyForRow(row) {
    if (row._fromServer && row.id != null && String(row.id).indexOf('local:') !== 0) {
      return `id:${String(row.id)}`;
    }
    return `n:${normName(row.nombre)}`;
  }

  function mapListaAsesorRow(x) {
    if (!x || typeof x !== 'object') return null;
    const nombre = String(x.advisor_name ?? x.nombre ?? x.name ?? '').trim();
    if (!nombre || normName(nombre) === '(sin asesor)') return null;
    return {
      nombre,
      count: num(x.count ?? x.total ?? x.cantidad ?? x.registros ?? x.reuniones ?? 0)
    };
  }

  function normalizeListaAsesores(raw) {
    if (Array.isArray(raw)) return raw.map(mapListaAsesorRow).filter(Boolean);
    if (!raw || typeof raw !== 'object') return [];
    const inner = raw.items ?? raw.asesores ?? raw.data ?? raw.lista ?? raw.rows ?? raw.result;
    if (Array.isArray(inner)) return inner.map(mapListaAsesorRow).filter(Boolean);
    return [];
  }

  function showToast(message, isError) {
    const el = $('#appToast');
    if (!el) return;
    el.textContent = message;
    el.classList.toggle('toast-error', !!isError);
    el.hidden = false;
    el.classList.add('toast-visible');
    if (toastHideTimer) clearTimeout(toastHideTimer);
    toastHideTimer = setTimeout(() => {
      el.classList.remove('toast-visible');
      toastHideTimer = setTimeout(() => {
        el.hidden = true;
        toastHideTimer = null;
      }, 400);
    }, 3200);
  }

  /** 6.5 — lista, wrapper o mapa rubro → métricas */
  function normalizePropuestasPorRubro(raw) {
    if (Array.isArray(raw)) return raw;
    if (!raw || typeof raw !== 'object') return [];

    if (raw.data != null) {
      const d = raw.data;
      if (Array.isArray(d)) return d;
      if (d && typeof d === 'object') {
        const inner =
          d.propuestas_por_rubro ||
          d.propuestasPorRubro ||
          d.rubros ||
          d.items ||
          d.rows;
        if (Array.isArray(inner)) return inner;
      }
    }

    const listKeys = [
      'propuestas_por_rubro',
      'propuestasPorRubro',
      'por_rubro',
      'rubros',
      'items',
      'rows',
      'result',
      'results',
      'rubro_stats',
      'estadisticas_por_rubro'
    ];
    for (const k of listKeys) {
      const v = raw[k];
      if (Array.isArray(v) && v.length) return v;
    }

    const skip = new Set(['ok', 'message', 'detail', 'meta', 'generated_at', 'dashboard_schema_version']);
    const entries = Object.entries(raw).filter(
      ([k, v]) => !skip.has(k) && v && typeof v === 'object' && !Array.isArray(v)
    );
    const rowShape = (o) =>
      o &&
      ('cantidad' in o ||
        'total' in o ||
        'ventas_cerradas' in o ||
        'ventasCerradas' in o ||
        'cerradas' in o ||
        'ventas_perdidas' in o ||
        'perdidas' in o);
    if (entries.length && entries.every(([, v]) => rowShape(v))) {
      return entries.map(([key, v]) => ({
        rubro: key === '' || key === 'null' || key === '_empty_' ? '(sin rubro)' : key,
        ...v
      }));
    }

    return [];
  }

  /** 6.7 — frecuencia de motivo_perdida */
  function normalizeMotivosPerdida(raw) {
    if (Array.isArray(raw)) return raw;
    if (!raw || typeof raw !== 'object') return [];
    return raw.motivos_perdida || raw.motivosPerdida || raw.motivos || raw.items || raw.data || [];
  }

  /** 6.7a — motivos agrupados por categoría (Precio, Competencia, …) */
  function normalizeMotivosAgrupados(raw) {
    if (!raw || typeof raw !== 'object') return [];
    const g = raw.grupos;
    if (!Array.isArray(g)) return [];
    return g
      .map((x) => ({
        categoria: String(x.categoria ?? x.categoria_label ?? '—').trim() || '—',
        veces: num(x.veces ?? x.count ?? x.total ?? 0)
      }))
      .filter((x) => x.categoria && x.categoria !== '—');
  }

  /** Rubros como mapa { "Nombre": { casos, ... } } → filas (mismo patrón que propuestas) */
  function objectEntriesToNegociacionRows(obj) {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return [];
    const skip = new Set(['ok', 'message', 'detail', 'meta', 'global', 'resumen', 'totales', 'data']);
    const entries = Object.entries(obj).filter(([k, v]) => !skip.has(k) && v && typeof v === 'object' && !Array.isArray(v));
    const rowShape = (o) =>
      o &&
      ('casos' in o ||
        'negociaciones' in o ||
        'total' in o ||
        'cantidad' in o ||
        'media_equipos' in o ||
        'con_negociacion' in o);
    if (!entries.length || !entries.every(([, v]) => rowShape(v))) return [];
    return entries.map(([key, v]) => ({
      rubro: key === '' || key === 'null' || key === '_empty_' ? '(sin rubro)' : key,
      ...v
    }));
  }

  /** 6.6 — métricas en global/resumen y también en raíz; hay que fusionar */
  function normalizeNegociacion(raw) {
    if (!raw || typeof raw !== 'object') return { global: {}, porRubro: [] };

    const porRubroSrc =
      raw.por_rubro ||
      raw.porRubro ||
      raw.por_rubros ||
      raw.rubros ||
      raw.por_rubro_detalle ||
      (raw.data && (raw.data.por_rubro || raw.data.rubros)) ||
      raw.items ||
      null;

    let arr = Array.isArray(porRubroSrc) ? porRubroSrc : [];
    if (!arr.length && porRubroSrc && typeof porRubroSrc === 'object' && !Array.isArray(porRubroSrc)) {
      arr = objectEntriesToNegociacionRows(porRubroSrc);
    }
    if (!arr.length) {
      const alt = objectEntriesToNegociacionRows(raw.rubros || raw.por_rubro || {});
      if (alt.length) arr = alt;
    }

    const nested = raw.global || raw.resumen || raw.totales || {};
    const dataBlock = raw.data && typeof raw.data === 'object' ? raw.data : {};

    const metricKeys = [
      'seguimientos_con_resumen',
      'seguimientos',
      'total_seguimientos',
      'con_resumen',
      'cliente_ha_negociado',
      'con_negociacion',
      'total_cliente_ha_negociado',
      'declararon_negociacion',
      'porcentaje_negociacion',
      'porcentaje',
      'pct_negociacion',
      'porcentaje_cliente_negociado',
      'media_equipos',
      'promedio_equipos',
      'con_flag_informado',
      'total_con_flag'
    ];

    const global = {};
    const pick = (k) =>
      nested[k] ??
      dataBlock[k] ??
      raw[k];

    metricKeys.forEach((k) => {
      const v = pick(k);
      if (v !== undefined && v !== null) global[k] = v;
    });

    return { global, porRubro: arr };
  }

  function mapRubroApi(r) {
    const row =
      r && typeof r === 'object' && r.stats && typeof r.stats === 'object'
        ? { ...r, ...r.stats }
        : r;
    const cantidad = num(
      row.cantidad ??
        row.total ??
        row.qty ??
        row.propuestas ??
        row.n_propuestas ??
        row.count ??
        row.propuestas_con_seguimiento ??
        row.propuestasConSeguimiento
    );
    const cerradas = num(
      row.ventas_cerradas ?? row.ventasCerradas ?? row.cerradas ?? row.cerradas_count ?? row.ventas_cerrada
    );
    const perdidas = num(
      row.ventas_perdidas ?? row.ventasPerdidas ?? row.perdidas ?? row.perdidas_count ?? row.ventas_perdida
    );
    let tasa = num(
      row.tasa_cierre_aproximada ??
        row.tasaCierreAproximada ??
        row.tasa_cierre ??
        row.tasaCierre ??
        row.tasa ??
        row.porcentaje_cierre ??
        row.pct_cierre
    );
    if (tasa > 0 && tasa <= 1) tasa *= 100;
    if (!tasa && cantidad > 0) tasa = (cerradas / cantidad) * 100;
    if (!tasa && cerradas + perdidas > 0) tasa = (cerradas / (cerradas + perdidas)) * 100;

    return {
      rubro: String(
        row.rubro ??
          row.nombre ??
          row.categoria ??
          row.name ??
          row.label ??
          row.key ??
          row.tipo_propuesta ??
          row.tipoPropuesta ??
          '(sin rubro)'
      ).trim() || '(sin rubro)',
      cantidad,
      ventas_cerradas: cerradas,
      ventas_perdidas: perdidas,
      tasa
    };
  }

  function mapMotivoApi(m) {
    return {
      texto: String(m.motivo_perdida ?? m.motivo ?? m.texto ?? m.label ?? '').trim(),
      count: num(m.frecuencia ?? m.cantidad ?? m.count ?? m.total ?? m.veces)
    };
  }

  function mapNegRubroApi(r) {
    const row = r && r.stats && typeof r.stats === 'object' ? { ...r, ...r.stats } : r;
    return {
      rubro: row.rubro ?? row.nombre ?? '—',
      casos: num(row.casos ?? row.total ?? row.propuestas_con_seguimiento ?? row.cantidad),
      negociaciones: num(
        row.negociaciones ??
          row.con_negociacion ??
          row.cliente_ha_negociado ??
          row.cliente_ha_negociado_si ??
          row.negociacion_count
      ),
      media_equipos: num(
        row.media_equipos ?? row.promedio_equipos ?? row.equipos_promedio ?? row.mediaEquipos
      )
    };
  }

  // ─── Navigation ───
  $$('.nav-item').forEach((item) => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      switchSection(item.dataset.section);
    });
  });

  function switchSection(section) {
    currentSection = section;
    $$('.nav-item').forEach((n) => n.classList.toggle('active', n.dataset.section === section));
    $$('.section').forEach((s) => s.classList.toggle('hidden', s.id !== `section-${section}`));
    const titles = {
      overview: 'Resumen General',
      asesores: 'Asesores',
      propuestas: 'Propuestas y Rubros',
      negociacion: 'Negociación',
      reuniones: 'Reuniones',
      'origen-leads': 'Origen de leads',
      'gestion-asesores': 'Gestión de asesores'
    };
    $('#pageTitle').textContent = titles[section] || section;
    triggerTitleUnderline();
    loadSectionData(section);
    if (window.innerWidth <= 900) $('#sidebar').classList.remove('open');
  }

  $('#menuToggle').addEventListener('click', () => $('#sidebar').classList.toggle('open'));

  $('#btnFiltrar').addEventListener('click', () => {
    API.invalidateCache();
    dashboardData = null;
    loadSectionData(currentSection);
  });

  $('#btnLimpiar').addEventListener('click', () => {
    $('#desde').value = '';
    $('#hasta').value = '';
    API.invalidateCache();
    dashboardData = null;
    loadSectionData(currentSection);
  });

  // ─── Fetch dashboard bundle ───
  async function ensureDashboardData() {
    if (dashboardData) return dashboardData;
    const f = getFilters();
    dashboardData = await API.dashboard(f.desde, f.hasta, 30, 40, DASHBOARD_QUERY);
    return dashboardData;
  }

  /** Normaliza la respuesta de métricas por asesor → filas para la tabla */
  function normalizeAsesoresRows(raw) {
    if (Array.isArray(raw)) return raw;
    if (!raw || typeof raw !== 'object') return [];
    return raw.asesores || raw.items || raw.data || raw.rows || [];
  }

  function normalizeLeadSource(raw) {
    const s = String(raw ?? '')
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
    if (!s) return 'otro';
    if (/insta|instagram|\big\b|^ig$/.test(s)) return 'instagram';
    if (/facebook|fb\b|meta/.test(s)) return 'facebook';
    if (/whatsapp|wa\b|wsp|^wp$/.test(s)) return 'whatsapp';
    if (/web|sitio|pagina|página|www|organic|google|seo|landing|browser/.test(s)) return 'web';
    return 'otro';
  }

  function rowLeadSource(r) {
    if (!r || typeof r !== 'object') return 'otro';
    const v =
      r.validator_source ??
      r.lead_source ??
      r.origen_lead ??
      r.origen ??
      r.canal ??
      r.source ??
      r.utm_source ??
      r.lead_origin ??
      r.origen_cita ??
      r.channel;
    return normalizeLeadSource(v);
  }

  function rowLeadDate(r) {
    if (!r || typeof r !== 'object') return null;
    const d =
      r.created_at ??
      r.audit_created_at ??
      r.lead_created_at ??
      r.fecha_lead ??
      r.lead_date ??
      r.fecha ??
      r.date;
    if (d == null) return null;
    const t = new Date(d);
    return Number.isNaN(t.getTime()) ? null : t;
  }

  function startOfWeekMonday(d) {
    const x = new Date(d);
    const day = x.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    x.setDate(x.getDate() + diff);
    x.setHours(12, 0, 0, 0);
    return x;
  }

  function periodKey(d, agrup) {
    const x = new Date(d);
    if (agrup === 'day') return x.toISOString().slice(0, 10);
    if (agrup === 'month') return x.toISOString().slice(0, 7);
    return startOfWeekMonday(x).toISOString().slice(0, 10);
  }

  function formatPeriodLabel(key, agrup) {
    if (key === '_all') return 'Todo el rango';
    if (agrup === 'day') {
      const d = new Date(key + 'T12:00:00');
      return d.toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' });
    }
    if (agrup === 'month') {
      const [y, m] = key.split('-');
      const d = new Date(Number(y), Number(m) - 1, 1);
      return d.toLocaleDateString('es-ES', { month: 'long', year: 'numeric' });
    }
    const d = new Date(key + 'T12:00:00');
    return (
      'Sem. ' +
      d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' })
    );
  }

  function sumPorOrigen(obj) {
    return ORIGEN_ORDER.reduce((s, k) => s + num(obj[k]), 0);
  }

  /** Respuesta de métricas de fuentes: lista con fuente y número de auditorías. */
  function parseFuentesMetrics(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const list = raw.fuentes ?? raw.items;
    if (!Array.isArray(list)) return null;
    const porOrigen = { instagram: 0, facebook: 0, web: 0, whatsapp: 0, otro: 0 };
    let total = num(raw.total ?? raw.total_auditorias);
    for (const row of list) {
      const n = num(row.auditorias ?? row.count ?? row.cantidad ?? row.total);
      const key = normalizeLeadSource(row.fuente ?? row.validator_source ?? row.source);
      porOrigen[key] += n;
    }
    if (!total) total = sumPorOrigen(porOrigen);
    return { total, porOrigen, hasSeries: false, rowsAnalyzed: total };
  }

  async function fetchReunionesAll(desde, hasta) {
    const LIMIT = 500;
    let offset = 0;
    const all = [];
    for (;;) {
      const data = await API.reuniones(desde, hasta, LIMIT, offset);
      const list = Array.isArray(data) ? data : (data.reuniones || data.items || []);
      if (!list.length) break;
      all.push(...list);
      if (list.length < LIMIT) break;
      offset += LIMIT;
      if (offset > 200000) break;
    }
    return all;
  }

  function buildOrigenFromRows(rows, agrup, hastaIso) {
    const porOrigen = { instagram: 0, facebook: 0, web: 0, whatsapp: 0, otro: 0 };
    const periodMap = new Map();
    let defaultD = null;
    if (hastaIso) {
      const t = new Date(hastaIso);
      if (!Number.isNaN(t.getTime())) defaultD = t;
    }

    for (const r of rows) {
      const src = rowLeadSource(r);
      porOrigen[src]++;
      let d = rowLeadDate(r);
      if (!d && defaultD) d = defaultD;
      if (!d || Number.isNaN(d.getTime())) continue;
      const pk = periodKey(d, agrup);
      if (!periodMap.has(pk)) {
        periodMap.set(pk, { instagram: 0, facebook: 0, web: 0, whatsapp: 0, otro: 0 });
      }
      periodMap.get(pk)[src]++;
    }

    const total = rows.length;
    let periodKeys = [...periodMap.keys()].sort();
    let periodLabels;
    let stackedBySource = { instagram: [], facebook: [], web: [], whatsapp: [], otro: [] };

    if (!periodKeys.length && total > 0) {
      periodLabels = ['Todo el rango'];
      ORIGEN_ORDER.forEach((k) => {
        stackedBySource[k] = [porOrigen[k]];
      });
    } else {
      periodLabels = periodKeys.map((k) => formatPeriodLabel(k, agrup));
      ORIGEN_ORDER.forEach((k) => {
        stackedBySource[k] = periodKeys.map((pk) => periodMap.get(pk)[k] || 0);
      });
    }

    return {
      total,
      porOrigen,
      periodLabels,
      stackedBySource,
      rowsAnalyzed: total
    };
  }

  function pickTopOrigen(porOrigen) {
    let best = 'otro';
    let max = -1;
    ORIGEN_ORDER.forEach((k) => {
      const v = num(porOrigen[k]);
      if (v > max) {
        max = v;
        best = k;
      }
    });
    return { key: best, count: max < 0 ? 0 : max };
  }

  async function loadOrigenLeads() {
    $$('[data-origen-agrup]').forEach((b) => {
      b.classList.toggle('active', b.getAttribute('data-origen-agrup') === origenAgrupacion);
    });
    const f = getFilters();
    const agrup = origenAgrupacion;
    const hintEl = $('#origenLeadsHint');

    let apiParsed = null;
    try {
      const raw = await API.fuentes(f.desde, f.hasta);
      apiParsed = parseFuentesMetrics(raw);
    } catch (e) {
      console.warn('Métricas de fuentes:', e.message || e);
    }

    const rows = await fetchReunionesAll(f.desde, f.hasta);
    const built = buildOrigenFromRows(rows, agrup, f.hasta);

    let model;
    let hint;

    const apiOk = apiParsed && (apiParsed.total > 0 || sumPorOrigen(apiParsed.porOrigen) > 0);

    if (apiOk) {
      model = {
        total: apiParsed.total,
        porOrigen: apiParsed.porOrigen,
        periodLabels: built.periodLabels,
        stackedBySource: built.stackedBySource,
        rowsAnalyzed: built.rowsAnalyzed
      };
      hint =
        'Los totales por canal vienen del registro de fuentes en el sistema. La gráfica en el tiempo usa el mismo rango de fechas de arriba y la agrupación elegida (día, semana o mes).';
    } else {
      model = built;
      hint =
        'Aquí se muestran las reuniones del rango elegido, agrupadas por canal cuando el origen está guardado. Si no ve datos, amplíe las fechas o compruebe la conexión.';
    }

    if (hintEl) hintEl.textContent = hint;
    renderOrigenLeads(model);
  }

  function renderOrigenLeads(model) {
    const total = num(model.total);
    const porOrigen = model.porOrigen || {};
    const top = pickTopOrigen(porOrigen);
    const topLabel =
      top.count > 0 ? `${ORIGEN_LABELS[top.key]} (${fmt(top.count)})` : '—';

    $('#kpi-origen-total').textContent = fmt(total);
    $('#kpi-origen-top').textContent = topLabel;
    $('#kpi-origen-muestra').textContent = fmt(model.rowsAnalyzed ?? total);

    const donutLabels = ORIGEN_ORDER.map((k) => ORIGEN_LABELS[k]);
    const donutData = ORIGEN_ORDER.map((k) => num(porOrigen[k]));
    Charts.doughnut('chartOrigenDonut', donutLabels, donutData, '');

    let labels = model.periodLabels && model.periodLabels.length ? [...model.periodLabels] : [];
    let stacked = model.stackedBySource;
    if (
      !labels.length ||
      !stacked ||
      !ORIGEN_ORDER.every((k) => Array.isArray(stacked[k]) && stacked[k].length === labels.length)
    ) {
      labels = ['Todo el rango'];
      stacked = { instagram: [], facebook: [], web: [], whatsapp: [], otro: [] };
      ORIGEN_ORDER.forEach((k) => {
        stacked[k] = [num(porOrigen[k])];
      });
    }

    const ds = ORIGEN_ORDER.map((k) => ({
      label: ORIGEN_LABELS[k],
      data: stacked[k],
      backgroundColor: ORIGEN_COLORS[k],
      borderRadius: 2
    }));
    Charts.barVertical('chartOrigenTiempo', labels, ds, true);

    const tbody = $('#tbodyOrigenLeads');
    if (tbody) {
      const t = Math.max(1, total);
      tbody.innerHTML = ORIGEN_ORDER.map((k) => {
        const c = num(porOrigen[k]);
        const pctVal = t > 0 ? ((c / t) * 100).toFixed(1) : '0.0';
        return `<tr>
          <td><strong>${ORIGEN_LABELS[k]}</strong></td>
          <td>${fmt(c)}</td>
          <td>${pctVal}%</td>
        </tr>`;
      }).join('');
    }

    requestAnimationFrame(() => {
      ['chartOrigenDonut', 'chartOrigenTiempo'].forEach((id) => {
        const ch = Charts.instances[id];
        if (ch?.resize) ch.resize();
      });
    });
  }

  // ─── Gestión de perfiles (servidor o catálogo por fechas + localStorage) ───
  async function loadGestionAsesores() {
    const hint = $('#gestionSourceHint');
    const state = loadGestionState();
    const elimSet = new Set(state.eliminados.map((x) => normName(x)));

    let rows = [];

    try {
      const g = await API.advisorsList();
      const items = Array.isArray(g) ? g : (g.advisors ?? g.items ?? g.data ?? []);
      if (Array.isArray(items) && items.length) {
        rows = items
          .map((x) => {
            const nombre = String(
              x.nombre_vendedor ?? x.nombre ?? x.advisor_name ?? x.name ?? ''
            ).trim();
            if (!nombre) return null;
            const id = x.id ?? x.asesor_id ?? x.uuid ?? x.pk;
            let activo = true;
            const rawA = x.activo ?? x.disponible ?? x.puede_recibir_reuniones;
            if (rawA !== undefined && rawA !== null) {
              activo = !(
                rawA === false ||
                rawA === 0 ||
                rawA === 'false' ||
                rawA === 'no'
              );
            }
            const sk =
              id != null && id !== ''
                ? `id:${String(id)}`
                : `n:${normName(nombre)}`;
            if (state.activo[sk] !== undefined) activo = !!state.activo[sk];
            return {
              id,
              nombre,
              activo,
              _count: num(x.count ?? x.total ?? x.registros),
              _fromServer: true
            };
          })
          .filter(Boolean);
      }
    } catch (e) {
      console.warn('Lista de asesores:', e.message || e);
    }

    if (!rows.length) {
      const f = getFilters();
      let raw;
      try {
        raw = await API.listaAsesores(f.desde, f.hasta);
      } catch (e) {
        console.warn('lista-asesores:', e.message || e);
        raw = [];
      }
      const list = normalizeListaAsesores(raw);
      rows = list
        .filter((x) => !elimSet.has(normName(x.nombre)))
        .map((x) => {
          const sk = `n:${normName(x.nombre)}`;
          const activo = state.activo[sk] !== undefined ? !!state.activo[sk] : true;
          return {
            id: `local:${encodeURIComponent(x.nombre)}`,
            nombre: x.nombre,
            activo,
            _count: x.count,
            _fromServer: false
          };
        });
      if (hint) {
        hint.textContent =
          'Lista tomada del catálogo de asesores según el rango de fechas. Si no hay enlace con la base de asesores, los cambios se guardan solo en este navegador.';
      }
    } else if (hint) {
      hint.textContent =
        'Lista de asesores del servidor. Al cambiar disponibilidad se guarda al instante; si falla la conexión, queda una copia local en este equipo.';
    }

    gestionRows = rows;
    renderGestionCards();
  }

  function renderGestionCards() {
    const root = $('#gestionAsesoresList');
    if (!root) return;
    if (!gestionRows.length) {
      root.innerHTML =
        '<div class="gestion-empty">No hay asesores en el catálogo para este rango. Ajuste las fechas o pulse Actualizar.</div>';
      return;
    }
    root.innerHTML = gestionRows
      .map((row, idx) => {
        const badge = row.activo
          ? '<span class="badge badge-green">Disponible</span>'
          : '<span class="badge badge-orange">No disponible</span>';
        const meta =
          row._count != null
            ? `<span class="gestion-asesor-card__meta">Registros en período: <strong>${fmt(row._count)}</strong></span>`
            : '';
        const onAct = row.activo ? ' btn-gestion-selected' : '';
        const onInact = !row.activo ? ' btn-gestion-selected-inactive' : '';
        return `<article class="gestion-asesor-card" data-idx="${idx}">
        <div class="gestion-asesor-card__head">
          <h4 class="gestion-asesor-card__name">${escapeHtml(row.nombre)}</h4>
          ${meta}
        </div>
        <div class="gestion-asesor-card__status">${badge}</div>
        <div class="gestion-asesor-card__actions">
          <button type="button" class="btn btn-sm btn-gestion-activo${onAct}" data-idx="${idx}" aria-pressed="${row.activo}">Activo</button>
          <button type="button" class="btn btn-sm btn-gestion-inactivo${onInact}" data-idx="${idx}" aria-pressed="${!row.activo}">Inactivo</button>
          <button type="button" class="btn btn-sm btn-gestion-delete" data-idx="${idx}">Eliminar</button>
        </div>
      </article>`;
      })
      .join('');
  }

  async function gestionSetActivo(idx, activo) {
    const row = gestionRows[idx];
    if (!row) return;
    row.activo = activo;
    const sk = stateKeyForRow(row);

    if (row._fromServer && row.id != null && String(row.id).indexOf('local:') !== 0) {
      try {
        await API.advisorsPatch(row.id, { activo: !!activo });
        const st = loadGestionState();
        delete st.activo[sk];
        saveGestionState(st);
        showToast(activo ? 'Asesor activado.' : 'Asesor desactivado.');
        renderGestionCards();
        return;
      } catch (e) {
        console.warn('Actualizar asesor:', e.message || e);
      }
    }

    const st = loadGestionState();
    st.activo[sk] = !!activo;
    saveGestionState(st);
    showToast(
      activo ? 'Marcado como activo (guardado local).' : 'Marcado como no disponible (guardado local).'
    );
    renderGestionCards();
  }

  function openDeleteModal(row) {
    gestionDeletePending = row;
    const nameEl = $('#deleteAsesorNombre');
    if (nameEl) nameEl.textContent = row.nombre;
    const inp = $('#deleteAsesorConfirmInput');
    const btn = $('#btnDeleteAsesorConfirm');
    if (inp) inp.value = '';
    if (btn) btn.disabled = true;
    $('#modalDeleteAsesor')?.classList.remove('hidden');
    inp?.focus();
  }

  function closeDeleteModal() {
    gestionDeletePending = null;
    const inp = $('#deleteAsesorConfirmInput');
    if (inp) inp.value = '';
    const btn = $('#btnDeleteAsesorConfirm');
    if (btn) btn.disabled = true;
    $('#modalDeleteAsesor')?.classList.add('hidden');
  }

  async function confirmDeleteAsesor() {
    const row = gestionDeletePending;
    if (!row) return;
    const inp = $('#deleteAsesorConfirmInput');
    if (!inp || inp.value.trim() !== 'ELIMINAR') return;

    if (row._fromServer && row.id != null && String(row.id).indexOf('local:') !== 0) {
      try {
        await API.advisorsDelete(row.id);
        showToast('Perfil eliminado.');
        closeDeleteModal();
        await loadGestionAsesores();
        return;
      } catch (eDel) {
        console.warn('Eliminar asesor:', eDel.message || eDel);
        try {
          await API.advisorsPatch(row.id, { activo: false });
          showToast('Perfil desactivado.');
          closeDeleteModal();
          await loadGestionAsesores();
          return;
        } catch (ePatch) {
          console.warn('Desactivar asesor (alternativa):', ePatch.message || ePatch);
          showToast('No se pudo completar el cambio en el servidor. Se ocultará solo en este navegador.', true);
        }
      }
    }

    const st = loadGestionState();
    st.eliminados.push(normName(row.nombre));
    st.eliminados = [...new Set(st.eliminados)];
    const sk = stateKeyForRow(row);
    delete st.activo[sk];
    saveGestionState(st);
    showToast('Perfil eliminado de la lista (este navegador).');
    closeDeleteModal();
    await loadGestionAsesores();
  }

  // ─── Load section ───
  async function loadSectionData(section) {
    setLoading(true);
    setConnection('');
    try {
      if (section === 'gestion-asesores') {
        await loadGestionAsesores();
        setConnection('connected', dashboardData?.dashboard_schema_version);
      } else if (section === 'origen-leads') {
        await loadOrigenLeads();
        setConnection('connected', dashboardData?.dashboard_schema_version);
      } else if (section === 'reuniones') {
        reunionesPage = 0;
        await loadReuniones();
        setConnection('connected', dashboardData?.dashboard_schema_version);
      } else if (section === 'propuestas') {
        await loadPropuestasFromApi();
        setConnection('connected', dashboardData?.dashboard_schema_version);
      } else if (section === 'negociacion') {
        await loadNegociacionFromApi();
        setConnection('connected', dashboardData?.dashboard_schema_version);
      } else {
        const data = await ensureDashboardData();
        let merged = data;
        if (section === 'asesores') {
          try {
            const f = getFilters();
            const raw = await API.asesores(f.desde, f.hasta, DASHBOARD_QUERY.group_by_asesores);
            const list = normalizeAsesoresRows(raw);
            if (list.length) merged = { ...data, asesores: list };
          } catch (e) {
            console.warn('Métricas por asesor:', e.message || e);
          }
        }
        switch (section) {
          case 'overview': renderOverview(merged); break;
          case 'asesores': renderAsesores(merged); break;
        }
        setConnection('connected', merged.dashboard_schema_version);
      }
    } catch (err) {
      console.error('Error:', err);
      setConnection('error');
    } finally {
      setLoading(false);
      requestAnimationFrame(() => triggerSectionAnimations(currentSection));
    }
  }

  /** Si la consulta dedicada viene vacía, usa el bloque del resumen general */
  async function loadPropuestasFromApi() {
    const f = getFilters();
    let rubrosRaw;
    let motivosRaw;
    let motivosAgrupadosRaw = {};
    try {
      [rubrosRaw, motivosRaw, motivosAgrupadosRaw] = await Promise.all([
        API.propuestasPorRubro(f.desde, f.hasta, 'rubro'),
        API.motivosPerdida(f.desde, f.hasta, 50),
        API.motivosPerdidaAgrupados(f.desde, f.hasta).catch(() => ({}))
      ]);
    } catch (err) {
      console.warn('Propuestas (consulta dedicada):', err.message || err);
      try {
        const dash = await API.dashboard(f.desde, f.hasta, 50, 0, DASHBOARD_QUERY);
        rubrosRaw = dash.propuestas_por_rubro ?? dash;
        motivosRaw = dash.motivos_perdida ?? dash.motivosPerdida ?? [];
      } catch (e2) {
        console.warn('Propuestas (fallback dashboard):', e2.message || e2);
        rubrosRaw = [];
        motivosRaw = [];
      }
    }

    let rows = normalizePropuestasPorRubro(rubrosRaw).map(mapRubroApi);
    const hasData = (list) =>
      list.some((x) => x.cantidad > 0 || x.ventas_cerradas > 0 || x.ventas_perdidas > 0 || x.tasa > 0);

    if (!rows.length || !hasData(rows)) {
      try {
        const dash = await API.dashboard(f.desde, f.hasta, 50, 0, DASHBOARD_QUERY);
        const fromDash = normalizePropuestasPorRubro(dash.propuestas_por_rubro ?? dash).map(mapRubroApi);
        if (fromDash.length) rows = fromDash;
      } catch (_) {}
    }

    const motivosList = normalizeMotivosPerdida(motivosRaw).map(mapMotivoApi).filter((m) => m.texto || m.count);
    const motivosGrupos = normalizeMotivosAgrupados(motivosAgrupadosRaw);
    renderPropuestas(rows, motivosList, motivosGrupos);
  }

  /** 6.6 — fusionar global+raíz; si falta algo, intentar bloque negociacion del dashboard */
  async function loadNegociacionFromApi() {
    const f = getFilters();
    let raw;
    try {
      raw = await API.negociacion(f.desde, f.hasta);
    } catch (err) {
      console.warn('Negociación (consulta dedicada):', err.message || err);
      try {
        const dash = await API.dashboard(f.desde, f.hasta, 30, 0, DASHBOARD_QUERY);
        raw = dash.negociacion ?? dash.data?.negociacion ?? {};
      } catch (e2) {
        console.warn('Negociación (fallback dashboard):', e2.message || e2);
        raw = {};
      }
    }
    let { global: g, porRubro } = normalizeNegociacion(raw);

    const needDash =
      pickNegCliente(g) == null ||
      pickNegPct(g) == null ||
      !porRubro.length;

    if (needDash) {
      try {
        const dash = await API.dashboard(f.desde, f.hasta, 30, 0, DASHBOARD_QUERY);
        const merged = normalizeNegociacion(dash.negociacion ?? {});
        Object.assign(g, merged.global);
        if (!porRubro.length && merged.porRubro.length) porRubro = merged.porRubro;
      } catch (_) {}
    }

    const rows = porRubro.map(mapNegRubroApi);
    renderNegociacion(g, rows);
  }

  function pickNegCliente(g) {
    return (
      g.cliente_ha_negociado ??
      g.con_negociacion ??
      g.total_cliente_ha_negociado ??
      g.declararon_negociacion ??
      g.clienteHaNegociado
    );
  }

  function pickNegPct(g) {
    let p =
      g.porcentaje_negociacion ??
      g.porcentaje ??
      g.pct_negociacion ??
      g.porcentaje_cliente_negociado ??
      g.porcentajeNegociacion;
    if (p != null && p > 0 && p <= 1) p *= 100;
    return p;
  }

  function pickNegMedia(g) {
    return g.media_equipos ?? g.promedio_equipos ?? g.mediaEquipos;
  }

  function firstNum(...vals) {
    for (const v of vals) {
      if (v !== undefined && v !== null && v !== '') {
        const n = num(v);
        if (Number.isFinite(n)) return n;
      }
    }
    return null;
  }

  /**
   * Igual que propuestas/tasa: si el global no trae un KPI, se calcula con lo que sí manda el API
   * (sumatoria por rubro: casos ≈ base, negociaciones ≈ declararon negociación).
   */
  function deriveNegociacionKpis(g, rows) {
    const sumCasos = rows.reduce((s, r) => s + num(r.casos), 0);
    const sumNeg = rows.reduce((s, r) => s + num(r.negociaciones), 0);

    let mediaPonderada = null;
    const ponderables = rows.filter((r) => num(r.casos) > 0 && num(r.media_equipos) > 0);
    if (ponderables.length) {
      const tw = ponderables.reduce((s, r) => s + num(r.casos) * num(r.media_equipos), 0);
      const tc = ponderables.reduce((s, r) => s + num(r.casos), 0);
      if (tc > 0) mediaPonderada = tw / tc;
    }
    let mediaSimple = null;
    const conEq = rows.filter((r) => num(r.media_equipos) > 0);
    if (conEq.length) {
      mediaSimple = conEq.reduce((s, r) => s + num(r.media_equipos), 0) / conEq.length;
    }

    const segApi = firstNum(
      g.seguimientos_con_resumen,
      g.seguimientos,
      g.total_seguimientos,
      g.con_resumen,
      g.seguimientosConResumen
    );
    const seguimientos = segApi != null ? segApi : sumCasos > 0 ? sumCasos : null;

    const cliApi = pickNegCliente(g);
    const clienteNum = cliApi != null ? num(cliApi) : null;
    const cliente =
      clienteNum != null && !Number.isNaN(clienteNum)
        ? clienteNum
        : rows.length
          ? sumNeg
          : null;

    let pctVal = pickNegPct(g);
    if (pctVal == null || Number.isNaN(pctVal)) {
      if (sumCasos > 0) pctVal = (sumNeg / sumCasos) * 100;
      else if (seguimientos != null && seguimientos > 0 && cliente != null) {
        pctVal = (num(cliente) / seguimientos) * 100;
      } else {
        const flag = num(g.con_flag_informado ?? g.total_con_flag ?? g.conFlagInformado);
        if (flag > 0 && cliente != null) pctVal = (num(cliente) / flag) * 100;
      }
    }

    const medApi = pickNegMedia(g);
    let media =
      medApi != null && num(medApi) >= 0
        ? num(medApi)
        : mediaPonderada != null
          ? mediaPonderada
          : mediaSimple;

    return { seguimientos, cliente, pctVal, media };
  }

  /** Une resumen/summary/dashboard.metrics y alias camelCase / snake_case para que los gráficos no queden en 0 */
  function mergeResumenSources(data) {
    if (!data || typeof data !== 'object') return {};
    const out = {};
    const blocks = [data.resumen, data.summary, data.totales, data.metrics].filter(
      (x) => x && typeof x === 'object' && !Array.isArray(x)
    );
    if (data.dashboard && typeof data.dashboard === 'object' && !Array.isArray(data.dashboard)) {
      blocks.push(data.dashboard);
    }
    for (const b of blocks) Object.assign(out, b);
    return out;
  }

  function normalizeResumen(data) {
    const m = mergeResumenSources(data);
    const pick = (...keys) => {
      for (const k of keys) {
        const v = m[k] ?? (data && data[k]);
        if (v !== undefined && v !== null) return v;
      }
      return undefined;
    };
    const n = (v, d = 0) => {
      const x = Number(v);
      return Number.isFinite(x) ? x : d;
    };

    let reuniones_con_retro = n(pick('reuniones_con_retro', 'reunionesConRetro', 'con_retro'));
    let reuniones_sin_retro = n(pick('reuniones_sin_retro', 'reunionesSinRetro', 'sin_retro'));
    let reuniones_total = n(pick('reuniones_total', 'reunionesTotal', 'total_reuniones', 'totalReuniones'));
    if (!reuniones_total && (reuniones_con_retro || reuniones_sin_retro)) {
      reuniones_total = reuniones_con_retro + reuniones_sin_retro;
    }

    return {
      total_auditorias: n(pick('total_auditorias', 'totalAuditorias', 'auditorias')),
      leads_aceptados: n(pick('leads_aceptados', 'leadsAceptados', 'aceptados', 'leads_accepted')),
      leads_pendientes: n(pick('leads_pendientes', 'leadsPendientes', 'pendientes')),
      leads_rechazados: n(pick('leads_rechazados', 'leadsRechazados', 'rechazados')),
      reuniones_total,
      reuniones_con_retro,
      reuniones_sin_retro,
      promedio_minutos_retro: pick('promedio_minutos_retro', 'promedioMinutosRetro', 'promedio_min_retro'),
      propuestas_registradas: n(
        pick('propuestas_registradas', 'propuestasRegistradas', 'propuestas', 'total_propuestas')
      ),
      ventas_cerradas: n(pick('ventas_cerradas', 'ventasCerradas', 'cerradas')),
      ventas_perdidas: n(pick('ventas_perdidas', 'ventasPerdidas', 'perdidas')),
      ventas_en_seguimiento: n(
        pick(
          'ventas_en_seguimiento',
          'ventasEnSeguimiento',
          'seguimientos_registrados',
          'seguimientosRegistrados',
          'en_seguimiento'
        )
      ),
      media_notiREU: pick('media_notiREU', 'mediaNotiREU', 'notiREU_promedio', 'notireu_promedio')
    };
  }

  // ═══════════════════════════════════════════════
  //  OVERVIEW  (data.resumen)
  // ═══════════════════════════════════════════════
  function renderOverview(data) {
    const r = normalizeResumen(data);

    $('#kpi-auditorias').textContent = fmt(r.total_auditorias);
    $('#kpi-aceptados').textContent = fmt(r.leads_aceptados);
    $('#kpi-pendientes').textContent = fmt(r.leads_pendientes);
    $('#kpi-rechazados').textContent = fmt(r.leads_rechazados);
    $('#kpi-reuniones').textContent = fmt(
      r.reuniones_total || (r.reuniones_con_retro || 0) + (r.reuniones_sin_retro || 0)
    );
    $('#kpi-tiempoRetro').textContent = fmt(r.promedio_minutos_retro, 1);
    $('#kpi-propuestas').textContent = fmt(r.propuestas_registradas);
    $('#kpi-ventasCerradas').textContent = fmt(r.ventas_cerradas);

    Charts.doughnut('chartLeads', ['Aceptados', 'Rechazados', 'Pendientes'], [
      r.leads_aceptados,
      r.leads_rechazados,
      r.leads_pendientes
    ]);

    Charts.doughnut('chartVentas', ['Cerradas', 'Perdidas', 'En Seguimiento'], [
      r.ventas_cerradas,
      r.ventas_perdidas,
      r.ventas_en_seguimiento
    ]);

    const notiVal = r.media_notiREU;
    $('#gaugeNotiValue').textContent = notiVal != null ? Number(notiVal).toFixed(1) : '—';

    Charts.barVertical('chartRetro', ['Con Retro', 'Sin Retro'], [
      {
        data: [r.reuniones_con_retro, r.reuniones_sin_retro],
        backgroundColor: ['#145478', '#c8151b'],
        borderRadius: 3
      }
    ]);

    requestAnimationFrame(() => {
      ['chartLeads', 'chartVentas', 'chartRetro'].forEach((id) => {
        const ch = Charts.instances[id];
        if (ch?.resize) ch.resize();
      });
    });
  }

  // ═══════════════════════════════════════════════
  //  ASESORES  (data.asesores)
  // ═══════════════════════════════════════════════
  let asesoresData = [];

  function asesorRowLabel(a) {
    return (a.nombre || a.advisor_name || a.country || a.pais || '—').trim() || '—';
  }

  function renderAsesores(data) {
    asesoresData = Array.isArray(data.asesores) ? data.asesores : [];
    renderAsesoresChart('reuniones');
    renderAsesoresTable(asesoresData);
  }

  function renderAsesoresChart(metric) {
    const sorted = [...asesoresData]
      .filter((a) => (a.nombre || a.advisor_name) !== '(sin asesor)')
      .sort((a, b) => (b[metric] || 0) - (a[metric] || 0))
      .slice(0, 20);
    Charts.barVertical('chartAsesoresBar',
      sorted.map((a) => asesorRowLabel(a)),
      [{ label: metric.replace(/_/g, ' '), data: sorted.map((a) => a[metric] || 0), backgroundColor: '#145478', borderRadius: 3 }]
    );
  }

  $('#asesorMetricSelect')?.addEventListener('change', (e) => renderAsesoresChart(e.target.value));

  function renderAsesoresTable(list) {
    const tbody = $('#tbodyAsesores');
    if (!list.length) { tbody.innerHTML = '<tr><td colspan="10" style="text-align:center;padding:40px;color:var(--text-muted)">Sin datos</td></tr>'; return; }
    tbody.innerHTML = list.map((a) => `<tr>
      <td><strong>${asesorRowLabel(a)}</strong></td>
      <td>${fmt(a.reuniones)}</td><td>${fmt(a.aceptaciones)}</td><td>${fmt(a.rechazos)}</td>
      <td>${fmt(a.con_retro)}</td><td>${fmt(a.promedio_min_retro, 1)}</td>
      <td>${fmt(a.notiREU_promedio ?? a.notireu_promedio, 1)}</td><td>${fmt(a.propuestas)}</td>
      <td><span class="badge badge-green">${fmt(a.ventas_cerradas)}</span></td>
      <td><span class="badge badge-red">${fmt(a.ventas_perdidas)}</span></td>
    </tr>`).join('');
  }

  $('#searchAsesor')?.addEventListener('input', (e) => {
    const q = e.target.value.toLowerCase();
    renderAsesoresTable(asesoresData.filter((a) => asesorRowLabel(a).toLowerCase().includes(q)));
  });

  $('#tablaAsesores')?.querySelectorAll('th[data-sort]').forEach((th) => {
    th.addEventListener('click', () => {
      const key = th.dataset.sort;
      const dir = th.classList.contains('asc') ? -1 : 1;
      $$('#tablaAsesores th').forEach((t) => t.classList.remove('asc', 'desc'));
      th.classList.add(dir === 1 ? 'asc' : 'desc');
      asesoresData.sort((a, b) => {
        let va = a[key];
        let vb = b[key];
        if (key === 'nombre') {
          va = asesorRowLabel(a);
          vb = asesorRowLabel(b);
        }
        if (typeof va === 'string') return dir * (va || '').localeCompare(vb || '');
        return dir * ((va || 0) - (vb || 0));
      });
      renderAsesoresTable(asesoresData);
    });
  });

  // ═══════════════════════════════════════════════
  //  PROPUESTAS  — 6.5, 6.7, 6.7a (motivos agrupados)
  // ═══════════════════════════════════════════════
  function renderPropuestas(rubroList, motivosList, motivosGrupos = []) {
    if (rubroList.length) {
      const labels = rubroList.map((r) => r.rubro);
      Charts.mixedBar('chartPropuestasRubro', labels, [
        { label: 'Cantidad', data: rubroList.map((r) => r.cantidad), backgroundColor: '#145478', borderRadius: 3 },
        { label: 'Cerradas', data: rubroList.map((r) => r.ventas_cerradas), backgroundColor: '#107ab4', borderRadius: 3 },
        { label: 'Perdidas', data: rubroList.map((r) => r.ventas_perdidas), backgroundColor: '#c8151b', borderRadius: 3 }
      ]);
      Charts.barVertical('chartTasaCierre', labels, [{
        label: 'Tasa de cierre %',
        data: rubroList.map((r) => r.tasa),
        backgroundColor: '#c8151b',
        borderRadius: 3
      }]);
    } else {
      Charts.mixedBar('chartPropuestasRubro', ['Sin datos'], [
        { label: 'Cantidad', data: [0], backgroundColor: '#989797', borderRadius: 3 }
      ]);
      Charts.barVertical('chartTasaCierre', ['Sin datos'], [{
        label: 'Tasa %',
        data: [0],
        backgroundColor: '#989797',
        borderRadius: 3
      }]);
    }

    if (motivosList.length) {
      const sorted = [...motivosList].sort((a, b) => b.count - a.count).slice(0, 15);
      Charts.barHorizontal('chartMotivos',
        sorted.map((m) => truncate(m.texto || '—', 40)),
        sorted.map((m) => m.count),
        '#c8151b'
      );
    } else {
      Charts.barHorizontal('chartMotivos', ['Sin motivos en el rango'], [0], '#989797');
    }

    if (motivosGrupos.length) {
      const ord = [...motivosGrupos].sort((a, b) => b.veces - a.veces);
      Charts.doughnut(
        'chartMotivosCat',
        ord.map((g) => g.categoria),
        ord.map((g) => g.veces),
        ''
      );
    } else {
      Charts.doughnut('chartMotivosCat', ['Sin datos por categoría'], [0], '');
    }

    requestAnimationFrame(() => {
      ['chartPropuestasRubro', 'chartTasaCierre', 'chartMotivos', 'chartMotivosCat'].forEach((id) => {
        const ch = Charts.instances[id];
        if (ch?.resize) ch.resize();
      });
    });
  }

  // ═══════════════════════════════════════════════
  //  NEGOCIACIÓN  — 6.6 negociacion (global + por rubro)
  // ═══════════════════════════════════════════════
  function renderNegociacion(g, porRubroRows) {
    const { seguimientos, cliente, pctVal, media } = deriveNegociacionKpis(g, porRubroRows);

    $('#kpi-seguimientos').textContent = fmt(seguimientos);
    $('#kpi-clienteNegocia').textContent = fmt(cliente);
    $('#kpi-pctNegociacion').textContent = pct(pctVal);
    $('#kpi-mediaEquipos').textContent = fmt(media, 1);

    if (porRubroRows.length) {
      Charts.mixedBar(
        'chartNegociacionRubro',
        porRubroRows.map((r) => r.rubro),
        [
          {
            label: 'Casos',
            data: porRubroRows.map((r) => r.casos),
            backgroundColor: '#145478',
            borderRadius: 3,
            yAxisID: 'y'
          },
          {
            label: 'Negociaciones',
            data: porRubroRows.map((r) => r.negociaciones),
            backgroundColor: '#107ab4',
            borderRadius: 3,
            yAxisID: 'y'
          },
          {
            label: 'Media equipos',
            data: porRubroRows.map((r) => r.media_equipos),
            type: 'line',
            borderColor: '#c8151b',
            backgroundColor: 'rgba(200,21,27,.15)',
            fill: false,
            tension: 0.3,
            yAxisID: 'y1'
          }
        ],
        true
      );
    } else {
      Charts.mixedBar(
        'chartNegociacionRubro',
        ['Sin datos por rubro'],
        [{ label: 'Casos', data: [0], backgroundColor: '#989797', borderRadius: 3, yAxisID: 'y' }],
        false
      );
    }
  }

  // ═══════════════════════════════════════════════
  //  REUNIONES — listado paginado
  // ═══════════════════════════════════════════════
  async function loadReuniones() {
    const f = getFilters();
    const data = await API.reuniones(f.desde, f.hasta, REUNIONES_LIMIT, reunionesPage * REUNIONES_LIMIT);
    const list = Array.isArray(data) ? data : (data.reuniones || data.items || []);
    renderReunionesTable(list);
    updatePagination(list.length);
  }

  function auditIdForHistory(r) {
    const id = r.audit_id ?? r.auditId ?? r.id;
    return id != null && id !== '' ? id : null;
  }

  function renderReunionesTable(list) {
    const tbody = $('#tbodyReuniones');
    if (!list.length) {
      tbody.innerHTML =
        '<tr><td colspan="11" style="text-align:center;padding:40px;color:var(--text-muted)">Sin reuniones</td></tr>';
      return;
    }
    tbody.innerHTML = list
      .map((r) => {
        const aid = auditIdForHistory(r);
        const histBtn = aid
          ? `<button type="button" class="btn btn-sm btn-ghost btn-prop-hist" data-audit-history="${aid}" title="Ver versiones anteriores de la propuesta">Historial</button>`
          : '—';
        return `<tr>
      <td><strong>${r.client_name || '—'}</strong></td>
      <td>${r.client_phone || '—'}</td>
      <td>${r.advisor_name || '—'}</td>
      <td>${truncate(r.subject || '', 30)}</td>
      <td>${r.country || '—'}</td>
      <td><span class="badge badge-blue">${r.opportunity_stage_label ?? r.opportunity_stage ?? '—'}</span></td>
      <td>${statusBadge(r.advisor_status)}</td>
      <td>${statusBadge(r.reunion_status)}</td>
      <td>${fmt(r.notiREU)}</td>
      <td>${fmt(r.minutos_hasta_retro, 1)}</td>
      <td>${histBtn}</td>
    </tr>`;
      })
      .join('');
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function humanizeFieldKey(k) {
    return String(k)
      .replace(/_/g, ' ')
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/\b\w/g, (c) => c.toUpperCase());
  }

  /** Maquetación de propuesta_json al estilo del dashboard (sin JSON crudo). */
  function formatPropuestaHistorialHtml(raw) {
    let o = raw;
    if (o == null) o = {};
    if (typeof o === 'string') {
      try {
        o = JSON.parse(o);
      } catch {
        return `<p class="prop-hist-text-only">${escapeHtml(o)}</p>`;
      }
    }
    if (typeof o !== 'object' || Array.isArray(o)) {
      return `<p class="prop-hist-text-only">${escapeHtml(String(raw))}</p>`;
    }

    const ordered = [
      ['rubro', 'Rubro'],
      ['equipos', 'Equipos'],
      ['tipo_propuesta', 'Tipo de propuesta'],
      ['tipoPropuesta', 'Tipo de propuesta'],
      ['cantidad_oferta', 'Cantidad de oferta'],
      ['resumen_general', 'Resumen general']
    ];
    const used = new Set();
    const rows = [];

    for (const [key, label] of ordered) {
      if (!Object.prototype.hasOwnProperty.call(o, key)) continue;
      const val = o[key];
      if (val === undefined || val === null || val === '') continue;
      used.add(key);
      const str = escapeHtml(String(val));
      if (key === 'resumen_general') {
        rows.push(
          `<div class="prop-hist-row prop-hist-row-block"><span class="prop-hist-label">${label}</span><p class="prop-hist-text">${str.replace(/\n/g, '<br>')}</p></div>`
        );
      } else {
        rows.push(
          `<div class="prop-hist-row"><span class="prop-hist-label">${label}</span><span class="prop-hist-val">${str}</span></div>`
        );
      }
    }

    for (const [k, v] of Object.entries(o)) {
      if (used.has(k)) continue;
      if (v === undefined || v === null || v === '') continue;
      const label = humanizeFieldKey(k);
      if (typeof v === 'object' && v !== null) {
        rows.push(
          `<div class="prop-hist-row prop-hist-row-block"><span class="prop-hist-label">${escapeHtml(label)}</span><pre class="prop-hist-json-fallback">${escapeHtml(JSON.stringify(v, null, 2))}</pre></div>`
        );
      } else {
        rows.push(
          `<div class="prop-hist-row"><span class="prop-hist-label">${escapeHtml(label)}</span><span class="prop-hist-val">${escapeHtml(String(v))}</span></div>`
        );
      }
    }

    if (!rows.length) {
      return '<p class="prop-hist-empty">Sin datos de propuesta en esta versión.</p>';
    }
    return `<div class="prop-hist-fields">${rows.join('')}</div>`;
  }

  async function openPropuestaHistoryModal(auditId) {
    const body = $('#modalPropHistBody');
    const modal = $('#modalPropuestaHistory');
    if (!body || !modal) return;
    body.innerHTML = '<p class="modal-loading">Cargando historial…</p>';
    modal.classList.remove('hidden');
    try {
      const res = await API.propuestaHistory(auditId);
      const hist = Array.isArray(res.history) ? res.history : [];
      if (!hist.length) {
        body.innerHTML =
          '<p style="color:var(--text-muted)">No hay versiones archivadas para esta auditoría.</p>';
        return;
      }
      body.innerHTML = `<div class="prop-hist-list">${hist
        .map(
          (h, i) => `
        <div class="prop-hist-item">
          <div class="prop-hist-meta">Versión ${i + 1} · ${h.created_at ? new Date(h.created_at).toLocaleString('es-ES') : '—'}</div>
          ${formatPropuestaHistorialHtml(h.propuesta_json ?? h.propuesta)}
        </div>`
        )
        .join('')}</div>`;
    } catch (e) {
      console.warn('Historial propuestas:', e.message || e);
      body.innerHTML =
        '<p style="color:var(--brand-red)">No se pudo cargar el historial. Compruebe la conexión e inténtelo de nuevo.</p>';
    }
  }

  $('#tbodyReuniones')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-audit-history]');
    if (!btn) return;
    e.preventDefault();
    openPropuestaHistoryModal(btn.getAttribute('data-audit-history'));
  });

  $('#btnClosePropHist')?.addEventListener('click', () => {
    $('#modalPropuestaHistory')?.classList.add('hidden');
  });

  $('#modalPropuestaHistory')?.addEventListener('click', (e) => {
    if (e.target.id === 'modalPropuestaHistory') $('#modalPropuestaHistory').classList.add('hidden');
  });

  function statusBadge(val) {
    if (!val) return '—';
    const l = val.toLowerCase();
    let cls = 'badge-blue';
    if (l.includes('acept') || l.includes('confirm') || l === 'efectiva') cls = 'badge-green';
    else if (l.includes('rechaz') || l.includes('cancel')) cls = 'badge-red';
    else if (l.includes('pend')) cls = 'badge-orange';
    return `<span class="badge ${cls}">${val}</span>`;
  }

  function updatePagination(count) {
    $('#paginationInfo').textContent = `Página ${reunionesPage + 1}`;
    $('#btnPrevPage').disabled = reunionesPage === 0;
    $('#btnNextPage').disabled = count < REUNIONES_LIMIT;
  }

  $('#btnNextPage')?.addEventListener('click', () => {
    reunionesPage++;
    setLoading(true);
    loadReuniones().then(() => setConnection('connected', dashboardData?.dashboard_schema_version)).catch(() => setConnection('error')).finally(() => setLoading(false));
  });

  $('#btnPrevPage')?.addEventListener('click', () => {
    if (reunionesPage > 0) reunionesPage--;
    setLoading(true);
    loadReuniones().then(() => setConnection('connected', dashboardData?.dashboard_schema_version)).catch(() => setConnection('error')).finally(() => setLoading(false));
  });

  $('#searchReunion')?.addEventListener('input', (e) => {
    const q = e.target.value.toLowerCase();
    $$('#tbodyReuniones tr').forEach((row) => { row.style.display = row.textContent.toLowerCase().includes(q) ? '' : 'none'; });
  });

  $('#gestionAsesoresList')?.addEventListener('click', (e) => {
    const act = e.target.closest('.btn-gestion-activo');
    const inact = e.target.closest('.btn-gestion-inactivo');
    const del = e.target.closest('.btn-gestion-delete');
    if (act) {
      const idx = Number(act.dataset.idx);
      if (!Number.isNaN(idx) && gestionRows[idx]) gestionSetActivo(idx, true);
      return;
    }
    if (inact) {
      const idx = Number(inact.dataset.idx);
      if (!Number.isNaN(idx) && gestionRows[idx]) gestionSetActivo(idx, false);
      return;
    }
    if (del) {
      const idx = Number(del.dataset.idx);
      if (Number.isNaN(idx) || !gestionRows[idx]) return;
      openDeleteModal(gestionRows[idx]);
    }
  });

  $('#btnGestionRefresh')?.addEventListener('click', () => {
    loadGestionAsesores().catch((err) => console.warn(err));
  });

  $$('[data-origen-agrup]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const v = btn.getAttribute('data-origen-agrup');
      if (!v) return;
      origenAgrupacion = v;
      $$('[data-origen-agrup]').forEach((b) => b.classList.toggle('active', b === btn));
      loadOrigenLeads().catch((err) => console.warn(err));
    });
  });

  $('#deleteAsesorConfirmInput')?.addEventListener('input', (e) => {
    const btn = $('#btnDeleteAsesorConfirm');
    if (btn) btn.disabled = e.target.value.trim() !== 'ELIMINAR';
  });

  $('#btnDeleteAsesorCancel')?.addEventListener('click', closeDeleteModal);
  $('#btnCloseDeleteAsesor')?.addEventListener('click', closeDeleteModal);
  $('#btnDeleteAsesorConfirm')?.addEventListener('click', () => {
    confirmDeleteAsesor().catch((err) => console.warn(err));
  });

  $('#modalDeleteAsesor')?.addEventListener('click', (e) => {
    if (e.target.id === 'modalDeleteAsesor') closeDeleteModal();
  });

  // ═══════════════════════════════════════════════
  //  INIT
  // ═══════════════════════════════════════════════
  async function init() {
    setLoading(true);
    setConnection('');
    triggerTitleUnderline();
    try {
      const data = await ensureDashboardData();
      renderOverview(data);
      setConnection('connected', data.dashboard_schema_version);
    } catch (err) {
      console.error('Error al cargar el panel:', err.message || err);
      setConnection('error');
    } finally {
      setLoading(false);
      requestAnimationFrame(() => triggerSectionAnimations('overview'));
    }
  }

  init();
})();
