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

    const katexApi = globalScope.katex;
    if (katexApi && typeof katexApi.renderToString === "function") {
      try {
        return katexApi.renderToString(expr, {
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

  function isSafeImageURL(value) {
    const raw = String(value ?? "").trim();
    if (!raw) return false;

    try {
      const base = globalScope.location?.href || "https://localhost/";
      const url = new URL(raw, base);
      return (
        (url.protocol === "https:" ||
          (url.protocol === "http:" &&
            url.origin === globalScope.location?.origin)) &&
        !url.username &&
        !url.password
      );
    } catch (error) {
      return false;
    }
  }

  function stripQuestionNumberPrefix(value) {
    const raw = String(value ?? "");
    if (!raw.trim()) return raw;

    return raw
      .replace(/^\s*\d+[\).\-:]\s*/, "")
      .replace(/^\s*\d+\.\s*/, "")
      .trim();
  }

  function naturalSortStrings(left, right) {
    const normalize = (value) =>
      String(value ?? "")
        .trim()
        .toLowerCase()
        .replace(/\s+/g, " ");
    const a = normalize(left);
    const b = normalize(right);
    if (!a && !b) return 0;
    if (!a) return -1;
    if (!b) return 1;

    const aParts = a.match(/\d+|\D+/g) || [a];
    const bParts = b.match(/\d+|\D+/g) || [b];
    const length = Math.max(aParts.length, bParts.length);

    for (let index = 0; index < length; index++) {
      const aPart = aParts[index] || "";
      const bPart = bParts[index] || "";
      const aIsNum = /^\d+$/.test(aPart);
      const bIsNum = /^\d+$/.test(bPart);

      if (aIsNum && bIsNum) {
        const diff = Number(aPart) - Number(bPart);
        if (diff !== 0) return diff;
        continue;
      }
      if (aIsNum !== bIsNum) return aIsNum ? -1 : 1;

      const textDiff = aPart.localeCompare(bPart, undefined, {
        numeric: true,
        sensitivity: "base",
      });
      if (textDiff !== 0) return textDiff;
    }

    return a.localeCompare(b, undefined, {
      numeric: true,
      sensitivity: "base",
    });
  }

  function formatQuestionText(text, options = {}) {
    if (!text) return "";

    const revealCloze = Boolean(options.revealCloze);
    const clozeEnabled =
      options.clozeEnabled ?? globalScope.state?.prefs?.clozeEnabled !== false;
    const normalizedText = stripQuestionNumberPrefix(text);

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

    const parts = String(normalizedText).split(
      /(\$\$[\s\S]*?\$\$|\$[\s\S]*?\$)/g,
    );
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
    return encodeURIComponent(String(value ?? ""));
  }

  function decodeHandlerValue(value) {
    try {
      return decodeURIComponent(String(value ?? ""));
    } catch (error) {
      return String(value ?? "");
    }
  }

  const TextUtils = {
    escapeHTML,
    renderMathExpression,
    isSafeImageURL,
    stripQuestionNumberPrefix,
    naturalSortStrings,
    formatQuestionText,
    encodeHandlerValue,
    decodeHandlerValue,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = TextUtils;
  }

  globalScope.TextUtils = TextUtils;
})(typeof window !== "undefined" ? window : globalThis);
