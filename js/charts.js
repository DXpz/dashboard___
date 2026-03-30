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

  function doughnut(canvasId, labels, data, title) {
    destroy(canvasId);
    const ctx = document.getElementById(canvasId);
    if (!ctx) return;
    instances[canvasId] = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels,
        datasets: [{
          data,
          backgroundColor: PALETTE.slice(0, labels.length),
          borderWidth: 0,
          hoverOffset: 8
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '65%',
        plugins: {
          legend: { position: 'bottom', labels: { padding: 16, usePointStyle: true, pointStyleWidth: 10 } },
          tooltip: {
            backgroundColor: '#145478',
            borderColor: '#107ab4',
            borderWidth: 1,
            titleFont: { weight: '600' },
            padding: 10,
            cornerRadius: 8
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
    instances[canvasId] = new Chart(ctx, {
      type: 'bar',
      data: { labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
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
    instances[canvasId] = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          data,
          backgroundColor: color || PALETTE[0],
          borderRadius: 4,
          barThickness: 18
        }]
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
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
          x: { beginAtZero: true, grid: { color: 'rgba(42,45,62,.4)' } },
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
    const scales = {
      x: { grid: { display: false }, ticks: { maxRotation: 45, font: { size: 11 } } },
      y: { beginAtZero: true, grid: { color: 'rgba(42,45,62,.4)' } }
    };
    if (dualAxis) {
      scales.y1 = {
        type: 'linear',
        position: 'right',
        beginAtZero: true,
        grid: { drawOnChartArea: false }
      };
    }
    instances[canvasId] = new Chart(ctx, {
      type: 'bar',
      data: { labels, datasets: datasetsConfig },
      options: {
        responsive: true,
        maintainAspectRatio: false,
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
