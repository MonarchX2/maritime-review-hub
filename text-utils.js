(function (globalScope) {
  function escapeHTML(value) {
    if (value === null || value === undefined) return "";
    return String(value).replace(
      /[&<>'"]/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          "'": "&#39;",
          '"': "&quot;",
        })[c],
    );
  }

  function renderMathExpression(rawExpression, displayMode) {
    const expr = String(rawExpression || "").trim();
    if (!expr) return "";

    if (window.katex && typeof katex.renderToString === "function") {
      try {
        return katex.renderToString(expr, {
          throwOnError: false,
          displayMode: Boolean(displayMode),
          strict: "ignore",
        });
      } catch (error) {
        return `<code class="math-fallback">${escapeHTML(expr)}</code>`;
      }
    }

    return `<code class="math-fallback">${escapeHTML(expr)}</code>`;
  }

  function formatQuestionText(text, options = {}) {
    if (!text) return "";

    const revealCloze = Boolean(options.revealCloze);
    const clozeEnabled =
      options.clozeEnabled ?? state.prefs.clozeEnabled !== false;

    function formatNonMathSegment(segment) {
      let safeSegment = escapeHTML(segment);

      if (clozeEnabled) {
        const clozeRegex = /\{\{c\d+::([^{}]+)\}\}/g;
        safeSegment = safeSegment.replace(
          clozeRegex,
          function (_match, innerText) {
            const safeInner = escapeHTML(String(innerText || "").trim());
            const safeInnerValue = safeInner || "••••";
            const clozeVisual = revealCloze
              ? `<span class="cloze-answer text-brand-700 dark:text-brand-300">${safeInnerValue}</span>`
              : `<span class="cloze-answer hidden">${safeInnerValue}</span>`;

            return `<span class="cloze-token inline-flex items-center">
        <button type="button" class="cloze-trigger rounded border border-dashed border-brand-500 px-2 py-0.5 text-xs font-bold bg-brand-50 dark:bg-brand-900/30 text-brand-700 dark:text-brand-200 ${revealCloze ? "cloze-visible" : ""}" onclick="event.preventDefault(); event.stopPropagation(); revealClozeAnswer(this)">
          <span class="cloze-mask">${revealCloze ? safeInnerValue : "□ □ □"}</span>
          ${clozeVisual}
        </button>
      </span>`;
          },
        );
      }

      const listRegex = /(?:\s|^)((?:\d+|[A-Za-z]|[IVXLCDMivxlcdm]{1,4})\.)\s/g;
      safeSegment = safeSegment.replace(listRegex, "<br><br>$1 ");
      if (safeSegment.startsWith("<br><br>")) {
        safeSegment = safeSegment.substring(8);
      }
      return safeSegment;
    }

    const parts = String(text).split(/(\$\$[\s\S]*?\$\$|\$[\s\S]*?\$)/g);
    return parts
      .map(function (segment) {
        const mathMatch = segment.match(/^(\$\$?)([\s\S]*?)\1$/);
        if (mathMatch) {
          return renderMathExpression(mathMatch[2], mathMatch[1] === "$$");
        }
        return formatNonMathSegment(segment);
      })
      .join("");
  }

  function encodeHandlerValue(value) {
    return encodeURIComponent(String(value));
  }

  function decodeHandlerValue(value) {
    try {
      return decodeURIComponent(value);
    } catch (error) {
      return value;
    }
  }

  const TextUtils = {
    escapeHTML,
    renderMathExpression,
    formatQuestionText,
    encodeHandlerValue,
    decodeHandlerValue,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = TextUtils;
  }

  globalScope.TextUtils = TextUtils;
})(typeof window !== "undefined" ? window : globalThis);
