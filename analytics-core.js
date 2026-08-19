// ============================================================================
// Analytics & Charts Core - Quiz statistics visualization and theme management
// ============================================================================

(function (globalScope) {
  "use strict";

  const root =
    globalScope || (typeof globalThis !== "undefined" ? globalThis : {});
  let chartInstance = null;
  let chartRetryTimer = null;
  let chartRetryCount = 0;
  let renderGeneration = 0;
  const MAX_CHART_RETRIES = 10;
  const CHART_RETRY_DELAY_MS = 500;
  const FALLBACK_SUBJECTS = ["COLREG", "Navigation", "Meteorology"];

  function getState() {
    return root.state && typeof root.state === "object" ? root.state : {};
  }

  function getPrefs() {
    const state = getState();
    if (!state.prefs || typeof state.prefs !== "object") state.prefs = {};
    return state.prefs;
  }

  function getChartConstructor() {
    if (typeof root.Chart === "function") return root.Chart;
    if (typeof Chart === "function") return Chart;
    return null;
  }

  function destroyChart() {
    if (chartInstance && typeof chartInstance.destroy === "function") {
      try {
        chartInstance.destroy();
      } catch (error) {
        console.warn("Unable to destroy the existing analytics chart.", error);
      }
    }
    chartInstance = null;
  }

  function scheduleChartRetry(generation) {
    if (chartRetryTimer !== null || chartRetryCount >= MAX_CHART_RETRIES)
      return;
    chartRetryCount += 1;
    chartRetryTimer = setTimeout(() => {
      chartRetryTimer = null;
      if (generation === renderGeneration) renderCharts();
    }, CHART_RETRY_DELAY_MS);
  }

  function getAccuracyData() {
    const state = getState();
    const accuracyMap =
      state.stats &&
      typeof state.stats === "object" &&
      state.stats.subjectAccuracy &&
      typeof state.stats.subjectAccuracy === "object"
        ? state.stats.subjectAccuracy
        : {};

    const validEntries = Object.entries(accuracyMap).filter(
      ([, entry]) => entry && Number(entry.total) > 0,
    );
    if (validEntries.length === 0) {
      return {
        labels: FALLBACK_SUBJECTS.slice(),
        data: FALLBACK_SUBJECTS.map(() => 0),
      };
    }

    const labels = validEntries.map(([subject]) => String(subject));
    const data = validEntries.map(([, entry]) => {
      const total = Number(entry.total);
      const correct = Number(entry.correct);
      if (!Number.isFinite(total) || total <= 0 || !Number.isFinite(correct))
        return 0;
      return Math.max(0, Math.min(100, Math.round((correct / total) * 100)));
    });

    return { labels, data };
  }

  function renderCharts() {
    const generation = ++renderGeneration;
    const ChartConstructor = getChartConstructor();

    if (!ChartConstructor) {
      scheduleChartRetry(generation);
      if (chartRetryCount >= MAX_CHART_RETRIES) {
        console.error(
          "Chart.js failed to load after the maximum number of retries.",
        );
      }
      return null;
    }

    if (chartRetryTimer !== null) {
      clearTimeout(chartRetryTimer);
      chartRetryTimer = null;
    }
    chartRetryCount = 0;

    const canvas =
      typeof document !== "undefined"
        ? document.getElementById("chart-accuracy")
        : null;
    if (!canvas || typeof canvas.getContext !== "function") return null;

    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    destroyChart();
    const { labels, data } = getAccuracyData();

    chartInstance = new ChartConstructor(ctx, {
      type: "radar",
      data: {
        labels,
        datasets: [
          {
            label: "Accuracy %",
            data,
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
        scales: {
          r: {
            beginAtZero: true,
            min: 0,
            max: 100,
            ticks: { stepSize: 20 },
          },
        },
        plugins: { legend: { display: false } },
        animation: { duration: 1500, easing: "easeOutQuart" },
      },
    });

    return chartInstance;
  }

  function toggleTheme() {
    const prefs = getPrefs();
    prefs.darkMode = !Boolean(prefs.darkMode);

    if (typeof document !== "undefined" && document.documentElement) {
      document.documentElement.classList.toggle("dark", prefs.darkMode);
    }

    const saveState =
      typeof root.saveState === "function" ? root.saveState : null;
    if (saveState) saveState();
    updateThemeButton();
    return prefs.darkMode;
  }

  function updateThemeButton() {
    const button =
      typeof document !== "undefined"
        ? document.getElementById("btn-theme-toggle")
        : null;
    if (!button) return;

    const darkMode = Boolean(getPrefs().darkMode);
    button.innerHTML = darkMode
      ? '<i class="fa-solid fa-sun transition-transform transform hover:rotate-180 duration-500"></i>'
      : '<i class="fa-solid fa-moon transition-transform transform hover:rotate-12 duration-300"></i>';
    button.setAttribute(
      "aria-label",
      darkMode ? "Switch to light mode" : "Switch to dark mode",
    );
    button.setAttribute(
      "title",
      darkMode ? "Switch to light mode" : "Switch to dark mode",
    );
  }

  const AnalyticsCore = {
    renderCharts,
    toggleTheme,
    updateThemeButton,
    getChartInstance: () => chartInstance,
    destroyChart,
  };

  root.AnalyticsCore = AnalyticsCore;
  root.Analytics = AnalyticsCore;
  root.renderCharts = renderCharts;
  root.toggleTheme = toggleTheme;
  root.updateThemeButton = updateThemeButton;

  Object.defineProperty(root, "chartInstance", {
    configurable: true,
    get: () => chartInstance,
  });
  Object.defineProperty(root, "chartRetryCount", {
    configurable: true,
    get: () => chartRetryCount,
  });

  if (typeof module !== "undefined" && module.exports)
    module.exports = AnalyticsCore;
})(
  typeof window !== "undefined"
    ? window
    : typeof globalThis !== "undefined"
      ? globalThis
      : this,
);
