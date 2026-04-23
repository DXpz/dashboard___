/**
 * Chart factory — creates and updates Chart.js instances
 */
const Charts = (() => {
  const instances = {};

  Chart.defaults.color = '#555555';
  Chart.defaults.borderColor = 'rgba(216,216,216,.6)';
  Chart.defaults.font.family = "'Inter', system-ui, sans-serif";

  const PALETTE = [
    '#145478', '#c8151b', '#107ab4', '#f52938', '#409abb',
    '#700306', '#7bb9cb', '#989797', '#afacb2', '#0c6699',
    '#1a8fc9', '#d42a30', '#5caed0', '#8b1a1e', '#2d6f94'
  ];

  function destroy(id) {
    if (instances[id]) {
      instances[id].destroy();
      delete instances[id];
    }
  }

  /** Barras visibles con 1 sola categoría o valores pequeños */
  function barSizingOptions(labelCount) {
    const n = Math.max(1, labelCount || 1);
    return {
      categoryPercentage: n <= 1 ? 0.92 : n <= 3 ? 0.88 : 0.82,
      barPercentage: n <= 1 ? 0.92 : 0.8,
      maxBarThickness: n <= 1 ? 120 : 88
    };
  }

  function doughnutEmptyMessage(canvasId, message) {
    return typeof message === 'string' && message.trim() ? message.trim() : 'Sin datos en el período';
  }

  /** Si la suma es 0: no instancia Chart; muestra texto en el contenedor del canvas. */
  function setDoughnutEmptyState(canvasId, show, message) {
    const ctx = document.getElementById(canvasId);
    if (!ctx) return;
    const host = ctx.closest('.chart-body') || ctx.parentElement;
    if (!host) return;
    const sel = `[data-chart-empty-for="${canvasId}"]`;
    let p = host.querySelector(sel);
    if (show) {
      ctx.style.display = 'none';
      if (!p) {
        p = document.createElement('p');
        p.setAttribute('data-chart-empty-for', canvasId);
        p.className = 'chart-empty-state';
        p.textContent = doughnutEmptyMessage(canvasId, message);
        host.appendChild(p);
      } else {
        p.textContent = doughnutEmptyMessage(canvasId, message);
      }
    } else {
      ctx.style.display = '';
      if (p) p.remove();
    }
  }

/**
 * Dona: solo se dibuja si hay cantidad total > 0.
 * @param {string} [emptyMessage] — texto si suma = 0 (4.º argumento).
 */
function doughnut(canvasId, labels, data, emptyMessage) {
    destroy(canvasId);
    const ctx = document.getElementById(canvasId);
    if (!ctx) return;
    const raw = (data || []).map((v) => Number(v) || 0);
    const sum = raw.reduce((a, b) => a + b, 0);
    if (sum <= 0) {
      setDoughnutEmptyState(canvasId, true, emptyMessage);
      return null;
    }
    setDoughnutEmptyState(canvasId, false);
    
    const totalLabel = Number(sum).toLocaleString('es-ES');
    
    instances[canvasId] = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels,
        datasets: [{
          data: raw,
          backgroundColor: PALETTE.slice(0, labels.length),
          borderWidth: 2,
          borderColor: '#ffffff',
          hoverOffset: 10
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '60%',
        layout: { padding: 12 },
        plugins: {
          legend: { 
            position: 'right', 
            labels: { 
              padding: 16, 
              usePointStyle: true, 
              pointStyleWidth: 12, 
              font: { size: 12 },
              generateLabels: (chart) => {
                const ds = chart.data;
                const total = ds.datasets[0].data.reduce((a, b) => a + b, 0);
                return ds.labels.map((label, i) => {
                  const value = ds.datasets[0].data[i];
                  const pct = total > 0 ? ((value / total) * 100).toFixed(0) : 0;
                  return {
                    text: `${label}: ${Number(value).toLocaleString('es-ES')} (${pct}%)`,
                    fillStyle: ds.datasets[0].backgroundColor[i],
                    strokeStyle: ds.datasets[0].backgroundColor[i],
                    hidden: false,
                    index: i
                  };
                });
              }
            } 
          },
          tooltip: {
            backgroundColor: '#1e293b',
            borderColor: '#334155',
            borderWidth: 1,
            titleFont: { weight: '600', size: 13 },
            padding: 12,
            cornerRadius: 6,
            displayColors: true,
            callbacks: {
              label: (ctx) => {
                const i = ctx.dataIndex;
                const real = raw[i] ?? 0;
                const pct = sum > 0 ? ((real / sum) * 100).toFixed(1) : 0;
                return `${ctx.label}: ${Number(real).toLocaleString('es-ES')} (${pct}%)`;
              }
            }
          }
        }
      }
    });
    return instances[canvasId];
  }

  function barVertical(canvasId, labels, datasets, stacked = false) {
    destroy(canvasId);
    const ctx = document.getElementById(canvasId);
    if (!ctx) return;
    const lc = Array.isArray(labels) ? labels.length : 0;
    instances[canvasId] = new Chart(ctx, {
      type: 'bar',
      data: { labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        datasets: {
          bar: {
            ...barSizingOptions(lc),
            minBarLength: 4
          }
        },
        plugins: {
          legend: {
            display: datasets.length > 1,
            position: 'top',
            labels: { usePointStyle: true, pointStyleWidth: 10, padding: 14 }
          },
          tooltip: {
            backgroundColor: '#145478',
            borderColor: '#107ab4',
            borderWidth: 1,
            padding: 10,
            cornerRadius: 8
          }
        },
        scales: {
          x: {
            stacked,
            grid: { display: false },
            ticks: { maxRotation: 45, font: { size: 11 } }
          },
          y: {
            stacked,
            beginAtZero: true,
            grace: '12%',
            grid: { color: 'rgba(42,45,62,.4)' }
          }
        }
      }
    });
    return instances[canvasId];
  }

  function barHorizontal(canvasId, labels, data, color) {
    destroy(canvasId);
    const ctx = document.getElementById(canvasId);
    if (!ctx) return;
    const lc = Array.isArray(labels) ? labels.length : 0;
    instances[canvasId] = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          data,
          backgroundColor: color || PALETTE[0],
          borderRadius: 4
        }]
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        datasets: {
          bar: {
            ...barSizingOptions(lc),
            minBarLength: 4
          }
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#145478',
            borderColor: '#107ab4',
            borderWidth: 1,
            padding: 10,
            cornerRadius: 8
          }
        },
        scales: {
          x: { beginAtZero: true, grace: '12%', grid: { color: 'rgba(42,45,62,.4)' } },
          y: { grid: { display: false }, ticks: { font: { size: 11 } } }
        }
      }
    });
    return instances[canvasId];
  }

  function mixedBar(canvasId, labels, datasetsConfig, dualAxis = false) {
    destroy(canvasId);
    const ctx = document.getElementById(canvasId);
    if (!ctx) return;
    const lc = Array.isArray(labels) ? labels.length : 0;
    const scales = {
      x: { grid: { display: false }, ticks: { maxRotation: 45, font: { size: 11 } } },
      y: { beginAtZero: true, grace: '12%', grid: { color: 'rgba(42,45,62,.4)' } }
    };
    if (dualAxis) {
      scales.y1 = {
        type: 'linear',
        position: 'right',
        beginAtZero: true,
        grace: '12%',
        grid: { drawOnChartArea: false }
      };
    }
    instances[canvasId] = new Chart(ctx, {
      type: 'bar',
      data: { labels, datasets: datasetsConfig },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        datasets: {
          bar: {
            ...barSizingOptions(lc),
            minBarLength: 4
          }
        },
        plugins: {
          legend: { position: 'top', labels: { usePointStyle: true, pointStyleWidth: 10, padding: 14 } },
          tooltip: {
            backgroundColor: '#145478',
            borderColor: '#107ab4',
            borderWidth: 1,
            padding: 10,
            cornerRadius: 8
          }
        },
        scales
      }
    });
    return instances[canvasId];
  }

  return { doughnut, barVertical, barHorizontal, mixedBar, destroy, instances, PALETTE };
})();
