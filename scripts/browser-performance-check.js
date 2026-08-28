function runReviewPerformanceCheck(options = {}) {
  const reviewList = document.getElementById("deck-review-list");
  const main = document.querySelector("main");
  if (!reviewList || !main) {
    return Promise.reject(
      new Error(
        "Open the deck review view before running the performance check.",
      ),
    );
  }

  const duration = Number(options.durationMs) || 3000;
  const distance = Number(options.distancePx) || 1200;
  const maxMutations = Number.isFinite(Number(options.maxMutations))
    ? Number(options.maxMutations)
    : 20;
  const maxLongTasks = Number.isFinite(Number(options.maxLongTasks))
    ? Number(options.maxLongTasks)
    : 3;

  let mutationRecords = 0;
  let longTasks = 0;
  const observer = new MutationObserver((records) => {
    mutationRecords += records.length;
  });
  observer.observe(reviewList, { childList: true });

  let taskObserver;
  if ("PerformanceObserver" in window) {
    try {
      taskObserver = new PerformanceObserver((list) => {
        longTasks += list.getEntries().length;
      });
      taskObserver.observe({ type: "longtask", buffered: true });
    } catch (_) {
      taskObserver = null;
    }
  }

  return new Promise((resolve) => {
    const startedAt = performance.now();
    const startScroll = main.scrollTop;
    const finish = () => {
      const elapsed = performance.now() - startedAt;
      main.scrollTop = startScroll;
      observer.disconnect();
      taskObserver?.disconnect();

      const result = {
        durationMs: Math.round(elapsed),
        reviewMutations: mutationRecords,
        longTasks,
        maxMutations,
        maxLongTasks,
        passed: mutationRecords <= maxMutations && longTasks <= maxLongTasks,
      };
      console.table(result);
      resolve(result);
    };
    const tick = () => {
      const elapsed = performance.now() - startedAt;
      main.scrollTop = startScroll + Math.min(1, elapsed / duration) * distance;
      if (elapsed < duration) {
        requestAnimationFrame(tick);
        return;
      }
      finish();
    };

    requestAnimationFrame(tick);
  });
}

window.runReviewPerformanceCheck = runReviewPerformanceCheck;
