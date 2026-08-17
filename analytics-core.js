// ============================================================================
// Analytics & Charts Core - Quiz statistics visualization and theme management
// Extracted from app-core.js - Phase 7
// ============================================================================

(function (globalScope) {
  // Import global dependencies
  const { state, saveState } = globalScope;

  // ===================== CHART INSTANCE & RETRY =====================
  let chartInstance = null;
  let chartRetryCount = 0;

  // ===================== ANALYTICS RENDERING =====================
  function renderCharts() {
    if (typeof Chart === "undefined") {
      console.warn("Chart.js is still loading...");
      if (chartRetryCount < 10) {
        // Retries every 500ms for up to 5 seconds
        chartRetryCount++;
        setTimeout(renderCharts, 500);
      } else {
        console.error("Chart.js failed to load entirely.");
      }
      return;
    }

    chartRetryCount = 0; // Reset counter on successful load

    const canvas = document.getElementById("chart-accuracy");
    if (!canvas) return; // Guard against running when element is missing

    if (typeof chartInstance !== "undefined" && chartInstance) {
      chartInstance.destroy();
    }

    const ctx = canvas.getContext("2d");
    const accuracyMap = state.stats?.subjectAccuracy || {};
    let labels = Object.keys(accuracyMap);
    let data = [];

    if (labels.length === 0) {
      labels = ["COLREG", "Navigation", "Meteorology"];
      data = [0, 0, 0];
    } else {
      data = labels.map((s) => {
        const d = accuracyMap[s];
        if (!d || !d.total) return 0;
        return Math.round((d.correct / d.total) * 100);
      });
    }

    chartInstance = new Chart(ctx, {
      type: "radar",
      data: {
        labels: labels,
        datasets: [
          {
            label: "Accuracy %",
            data: data,
            backgroundColor: "rgba(59, 130, 246, 0.2)",
            borderColor: "rgba(59, 130, 246, 1)",
            pointBackgroundColor: "rgba(59, 130, 246, 1)",
            borderWidth: 2,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: { r: { beginAtZero: true, max: 100, ticks: { stepSize: 20 } } },
        plugins: { legend: { display: false } },
        animation: {
          duration: 1500,
          easing: "easeOutQuart",
        },
      },
    });
  }

  // ===================== THEME MANAGEMENT =====================
  function toggleTheme() {
    state.prefs.darkMode = !state.prefs.darkMode;
    document.documentElement.classList.toggle("dark", state.prefs.darkMode);
    saveState();
    updateThemeButton();
  }

  function updateThemeButton() {
    const btn = document.getElementById("btn-theme-toggle");
    if (btn) {
      btn.innerHTML = state.prefs.darkMode
        ? '<i class="fa-solid fa-sun transition-transform transform hover:rotate-180 duration-500"></i>'
        : '<i class="fa-solid fa-moon transition-transform transform hover:rotate-12 duration-300"></i>';
    }
  }

  // ===================== MODULE EXPORT =====================
  const AnalyticsCore = {
    renderCharts,
    toggleTheme,
    updateThemeButton,
    // Expose chart instance for advanced control if needed
    getChartInstance: () => chartInstance,
  };

  // Alias for backward compatibility
  const Analytics = AnalyticsCore;

  // Export to global scope
  globalScope.AnalyticsCore = AnalyticsCore;
  globalScope.Analytics = Analytics;

  // Export individual functions for backward compatibility
  globalScope.renderCharts = renderCharts;
  globalScope.toggleTheme = toggleTheme;
  globalScope.updateThemeButton = updateThemeButton;
  globalScope.chartInstance = chartInstance;
  globalScope.chartRetryCount = chartRetryCount;

  // For Node.js testing - export as CommonJS if in test environment
  if (typeof module !== "undefined" && module.exports) {
    module.exports = AnalyticsCore;
  }
})(globalScope);
