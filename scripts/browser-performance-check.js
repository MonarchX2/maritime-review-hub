(() => {
  const reviewList = document.getElementById("deck-review-list");
  const main = document.querySelector("main");
  if (!reviewList || !main) {
    console.warn("MRH performance check: open the deck review view first.");
    return;
  }

  let mutations = 0;
  let longTasks = 0;
  const observer = new MutationObserver(() => {
    mutations += 1;
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

  const startedAt = performance.now();
  const startScroll = main.scrollTop;
  const duration = 3000;
  const tick = () => {
    const elapsed = performance.now() - startedAt;
    main.scrollTop = startScroll + Math.min(1, elapsed / duration) * 1200;
    if (elapsed < duration) {
      requestAnimationFrame(tick);
      return;
    }

    main.scrollTop = startScroll;
    observer.disconnect();
    taskObserver?.disconnect();
    console.table({
      durationMs: Math.round(elapsed),
      reviewMutations: mutations,
      longTasks,
      note: "Run with a large All-items review deck; lower mutations and longTasks are better.",
    });
  };

  requestAnimationFrame(tick);
})();
