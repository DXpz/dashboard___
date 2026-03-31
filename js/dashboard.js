/**
 * Dashboard controller
 *
 * Overview y Asesores: GET /api/metrics/dashboard
 * Propuestas: GET /api/metrics/propuestas-por-rubro + GET /api/metrics/motivos-perdida (6.5, 6.7)
 * Negociación: GET /api/metrics/negociacion (6.6)
 * Reuniones: GET /api/metrics/reuniones (paginado)
 */
(() => {
  document.body.classList.add('app-ready');

  let currentSection = 'overview';
  let dashboardData = null;
  let reunionesPage = 0;
  const REUNIONES_LIMIT = 200;

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);
  const loading = $('#loadingOverlay');
  const connStatus = $('#connectionStatus');
  

  const fmt = (n, dec = 0) =>
    n == null || isNaN(n) ? '—' : Number(n).toLocaleString('es-ES', { maximumFractionDigits: dec });

  const pct = (n) =>
    n == null || isNaN(n) ? '—' : `${Number(n).toFixed(1)}%`;

  function truncate(str, max) {
    if (!str) return '—';
    return str.length > max ? str.slice(0, max) + '…' : str;
  }

  function setLoading(on) { loading.classList.toggle('hidden', !on); }

  /** Re-dispara animaciones CSS al mostrar datos de una sección */
  function triggerSectionAnimations(section) {
    $$('.section').forEach((s) => s.classList.remove('section-enter'));
    const el = document.getElementById(`section-${section}`);
    if (!el || el.classList.contains('hidden')) return;
    void el.offsetWidth;
    el.classList.add('section-enter');
    const pt = $('#pageTitle');
    if (pt) {
      pt.classList.remove('title-anim');
      void pt.offsetWidth;
      pt.classList.add('title-anim');
    }
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

  /** 6.6 — métricas en global/resumen y también en raíz; hay que fusionar */
  function normalizeNegociacion(raw) {
    if (!raw || typeof raw !== 'object') return { global: {}, porRubro: [] };

    const porRubro =
      raw.por_rubro ||
      raw.porRubro ||
      raw.por_rubros ||
      raw.rubros ||
      raw.por_rubro_detalle ||
      (raw.data && (raw.data.por_rubro || raw.data.rubros)) ||
      raw.items ||
      [];
    const arr = Array.isArray(porRubro) ? porRubro : [];

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
      row.cantidad ?? row.total ?? row.qty ?? row.propuestas ?? row.n_propuestas ?? row.count
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
        row.rubro ?? row.nombre ?? row.categoria ?? row.name ?? row.label ?? row.key ?? '(sin rubro)'
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
    const titles = { overview:'Resumen General', asesores:'Asesores', propuestas:'Propuestas y Rubros', negociacion:'Negociación', reuniones:'Reuniones' };
    $('#pageTitle').textContent = titles[section] || section;
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
    dashboardData = await API.dashboard(f.desde, f.hasta, 30, 40);
    return dashboardData;
  }

  // ─── Load section ───
  async function loadSectionData(section) {
    setLoading(true);
    setConnection('');
    try {
      if (section === 'reuniones') {
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
        switch (section) {
          case 'overview': renderOverview(data); break;
          case 'asesores': renderAsesores(data); break;
        }
        setConnection('connected', data.dashboard_schema_version);
      }
    } catch (err) {
      console.error('Error:', err);
      setConnection('error');
    } finally {
      setLoading(false);
      requestAnimationFrame(() => triggerSectionAnimations(currentSection));
    }
  }

  /** 6.5 + 6.7 — si el endpoint suelto viene vacío o en otro formato, usa el bloque del dashboard */
  async function loadPropuestasFromApi() {
    const f = getFilters();
    const [rubrosRaw, motivosRaw] = await Promise.all([
      API.propuestasPorRubro(f.desde, f.hasta),
      API.motivosPerdida(f.desde, f.hasta, 50)
    ]);

    let rows = normalizePropuestasPorRubro(rubrosRaw).map(mapRubroApi);
    const hasData = (list) =>
      list.some((x) => x.cantidad > 0 || x.ventas_cerradas > 0 || x.ventas_perdidas > 0 || x.tasa > 0);

    if (!rows.length || !hasData(rows)) {
      try {
        const dash = await API.dashboard(f.desde, f.hasta, 50, 0);
        const fromDash = normalizePropuestasPorRubro(dash.propuestas_por_rubro ?? dash).map(mapRubroApi);
        if (fromDash.length) rows = fromDash;
      } catch (_) {}
    }

    const motivosList = normalizeMotivosPerdida(motivosRaw).map(mapMotivoApi).filter((m) => m.texto || m.count);
    renderPropuestas(rows, motivosList);
  }

  /** 6.6 — fusionar global+raíz; si falta algo, intentar bloque negociacion del dashboard */
  async function loadNegociacionFromApi() {
    const f = getFilters();
    const raw = await API.negociacion(f.desde, f.hasta);
    let { global: g, porRubro } = normalizeNegociacion(raw);

    const needDash =
      pickNegCliente(g) == null ||
      pickNegPct(g) == null ||
      !porRubro.length;

    if (needDash) {
      try {
        const dash = await API.dashboard(f.desde, f.hasta, 30, 0);
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
      sorted.map((a) => a.nombre || a.advisor_name || '(sin asesor)'),
      [{ label: metric.replace(/_/g, ' '), data: sorted.map((a) => a[metric] || 0), backgroundColor: '#145478', borderRadius: 3 }]
    );
  }

  $('#asesorMetricSelect')?.addEventListener('change', (e) => renderAsesoresChart(e.target.value));

  function renderAsesoresTable(list) {
    const tbody = $('#tbodyAsesores');
    if (!list.length) { tbody.innerHTML = '<tr><td colspan="10" style="text-align:center;padding:40px;color:var(--text-muted)">Sin datos</td></tr>'; return; }
    tbody.innerHTML = list.map((a) => `<tr>
      <td><strong>${a.nombre || a.advisor_name || '(sin asesor)'}</strong></td>
      <td>${fmt(a.reuniones)}</td><td>${fmt(a.aceptaciones)}</td><td>${fmt(a.rechazos)}</td>
      <td>${fmt(a.con_retro)}</td><td>${fmt(a.promedio_min_retro, 1)}</td>
      <td>${fmt(a.notiREU_promedio ?? a.notireu_promedio, 1)}</td><td>${fmt(a.propuestas)}</td>
      <td><span class="badge badge-green">${fmt(a.ventas_cerradas)}</span></td>
      <td><span class="badge badge-red">${fmt(a.ventas_perdidas)}</span></td>
    </tr>`).join('');
  }

  $('#searchAsesor')?.addEventListener('input', (e) => {
    const q = e.target.value.toLowerCase();
    renderAsesoresTable(asesoresData.filter((a) => (a.nombre || a.advisor_name || '').toLowerCase().includes(q)));
  });

  $('#tablaAsesores')?.querySelectorAll('th[data-sort]').forEach((th) => {
    th.addEventListener('click', () => {
      const key = th.dataset.sort;
      const dir = th.classList.contains('asc') ? -1 : 1;
      $$('#tablaAsesores th').forEach((t) => t.classList.remove('asc', 'desc'));
      th.classList.add(dir === 1 ? 'asc' : 'desc');
      asesoresData.sort((a, b) => {
        const va = a[key], vb = b[key];
        if (typeof va === 'string') return dir * (va || '').localeCompare(vb || '');
        return dir * ((va || 0) - (vb || 0));
      });
      renderAsesoresTable(asesoresData);
    });
  });

  // ═══════════════════════════════════════════════
  //  PROPUESTAS  — 6.5 propuestas-por-rubro, 6.7 motivos-perdida
  // ═══════════════════════════════════════════════
  function renderPropuestas(rubroList, motivosList) {
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

    requestAnimationFrame(() => {
      ['chartPropuestasRubro', 'chartTasaCierre', 'chartMotivos'].forEach((id) => {
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
  //  REUNIONES  (GET /api/metrics/reuniones — paginado)
  // ═══════════════════════════════════════════════
  async function loadReuniones() {
    const f = getFilters();
    const data = await API.reuniones(f.desde, f.hasta, REUNIONES_LIMIT, reunionesPage * REUNIONES_LIMIT);
    const list = Array.isArray(data) ? data : (data.reuniones || data.items || []);
    renderReunionesTable(list);
    updatePagination(list.length);
  }

  function renderReunionesTable(list) {
    const tbody = $('#tbodyReuniones');
    if (!list.length) { tbody.innerHTML = '<tr><td colspan="10" style="text-align:center;padding:40px;color:var(--text-muted)">Sin reuniones</td></tr>'; return; }
    tbody.innerHTML = list.map((r) => `<tr>
      <td><strong>${r.client_name || '—'}</strong></td>
      <td>${r.client_phone || '—'}</td>
      <td>${r.advisor_name || '—'}</td>
      <td>${truncate(r.subject || '', 30)}</td>
      <td>${r.country || '—'}</td>
      <td><span class="badge badge-blue">${r.opportunity_stage || '—'}</span></td>
      <td>${statusBadge(r.advisor_status)}</td>
      <td>${statusBadge(r.reunion_status)}</td>
      <td>${fmt(r.notiREU)}</td>
      <td>${fmt(r.minutos_hasta_retro, 1)}</td>
    </tr>`).join('');
  }

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

  // ═══════════════════════════════════════════════
  //  INIT
  // ═══════════════════════════════════════════════
  async function init() {
    setLoading(true);
    setConnection('');
    try {
      const data = await ensureDashboardData();
      renderOverview(data);
      setConnection('connected', data.dashboard_schema_version);
    } catch (err) {
      console.error('Error conectando a ' + API.getBase() + ':', err.message);
      setConnection('error');
    } finally {
      setLoading(false);
      requestAnimationFrame(() => triggerSectionAnimations('overview'));
    }
  }

  init();
})();
