(function (globalScope) {
  "use strict";

  const lifecycle = globalScope.LifecycleUtils || globalScope;

  function createScheduler() {
    const animationFrames = new Set();

    function schedule(callback) {
      if (typeof requestAnimationFrame !== "function") {
        return lifecycle.setTimeout(callback, 0);
      }

      const frameId = requestAnimationFrame(() => {
        animationFrames.delete(frameId);
        callback();
      });
      animationFrames.add(frameId);
      return frameId;
    }

    function cancelAll() {
      animationFrames.forEach((frameId) => {
        if (typeof cancelAnimationFrame === "function") {
          cancelAnimationFrame(frameId);
        } else {
          lifecycle.clearTimeout(frameId);
        }
      });
      animationFrames.clear();
    }

    return Object.freeze({ schedule, cancelAll });
  }

  const RenderingCore = { createScheduler };
  globalScope.RenderingCore = RenderingCore;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = RenderingCore;
  }
})(
  typeof globalScope !== "undefined"
    ? globalScope
    : typeof globalThis !== "undefined"
      ? globalThis
      : this,
);
