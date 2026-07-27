/**
 * In-frame bootstrap for the sandboxed D3 runtime (#268).
 *
 * Runs ONLY inside the sandboxed iframe (opaque origin, no-egress CSP —
 * see sandbox-srcdoc.util.ts). Loaded via `?raw` into the srcdoc; it is
 * never imported as a module, so it must stay standalone: no import/export,
 * ES5-compatible syntax, browser globals only.
 *
 * Protocol (bridge.util.ts is the parent-side counterpart, v1):
 *   in:  init { nonce, program, params, theme, size }
 *        data { rows, seq, done } · theme { theme } · resize { size }
 *   out: ready · rendered { height, width, rowCount } · resize { height, width }
 *        error { message, stack }
 *
 * Sizing (#278): the host supplies the available width; this frame reports
 * the PAINTED extent (see measureContent) and the host sizes itself to it —
 * height always, width when the content is wider than the container.
 *
 * Progressive rendering is owned here: data batches accumulate and the
 * (pure, idempotent) program is re-invoked with the FULL accumulated
 * array, coalesced via requestAnimationFrame — the agent's program never
 * sees a streaming API (spec Key decision 4).
 */
(function () {
  "use strict";

  var VERSION = 1;
  var root = document.getElementById("root");

  var nonce = null;
  var render = null;
  var params = {};
  var theme = null;
  var width = 0;
  var height = 0;
  var rows = [];
  var rafId = null;
  /** Last size reported to the parent — guards the applyExtent→observer loop. */
  var lastPostedWidth = 0;
  var lastPostedHeight = 0;

  function post(type, payload) {
    var msg = { v: VERSION, nonce: nonce, type: type };
    if (payload) {
      for (var key in payload) {
        if (Object.prototype.hasOwnProperty.call(payload, key)) {
          msg[key] = payload[key];
        }
      }
    }
    window.parent.postMessage(msg, "*");
  }

  function reportError(err) {
    post("error", {
      message:
        err && err.message !== undefined ? String(err.message) : String(err),
      stack: err && err.stack ? String(err.stack) : undefined,
    });
  }

  /**
   * Painted extent of #root's content, in CSS px, relative to #root's
   * origin (#278).
   *
   * `scrollHeight` measures the DOM box, so it misses marks a program draws
   * outside its declared SVG viewport (a force simulation settling past its
   * band, a bottom axis, a legend) — those were painted, clipped, and
   * silently unaccounted for. `getBBox()` returns the union of an SVG's
   * descendants in user units regardless of the viewport, and
   * `getScreenCTM()` converts to CSS px.
   *
   * Cost is O(top-level children of #root), never a walk over every mark,
   * so a 10k-mark chart doesn't pay a measurement tax on each batch.
   *
   * Extents are measured from #root's origin: content painted at NEGATIVE
   * coordinates is not recoverable by growing the frame (that would need a
   * translate) and is a known limitation, not an oversight.
   */
  /**
   * Grow #root to the painted extent (#278).
   *
   * Measuring is not sufficient on its own: marks that escape the SVG
   * viewport also escape the BODY box, whose height is only the SVG's
   * declared layout height — and the srcdoc's `overflow:hidden` clips them
   * there. The frame would grow and the content would still be invisible.
   * Sizing #root to the measurement makes the document box contain what was
   * painted, so nothing clips and no scrollbar can appear in either axis.
   */
  function applyExtent(size) {
    var w = size.width + "px";
    var h = size.height + "px";
    if (root.style.minWidth !== w) root.style.minWidth = w;
    if (root.style.minHeight !== h) root.style.minHeight = h;
  }

  /** Drop the applied extent so a re-render can measure — and shrink — freely. */
  function releaseExtent() {
    root.style.minWidth = "";
    root.style.minHeight = "";
  }

  function measureContent() {
    var fallback = { width: root.scrollWidth, height: root.scrollHeight };
    try {
      var maxX = 0;
      var maxY = 0;
      var rootRect = root.getBoundingClientRect();
      var children = root.children;

      for (var i = 0; i < children.length; i++) {
        var el = children[i];
        var rect = el.getBoundingClientRect();
        // The element's own layout box — an SVG sized larger than its
        // content still counts for that much.
        maxX = Math.max(maxX, rect.right - rootRect.left);
        maxY = Math.max(maxY, rect.bottom - rootRect.top);

        if (typeof el.getBBox !== "function") continue;

        var box = el.getBBox();
        var ctm = typeof el.getScreenCTM === "function" && el.getScreenCTM();
        var scaleX = ctm && ctm.a ? ctm.a : 1;
        var scaleY = ctm && ctm.d ? ctm.d : 1;
        maxX = Math.max(maxX, (box.x + box.width) * scaleX);
        maxY = Math.max(maxY, (box.y + box.height) * scaleY);
      }

      var width = Math.ceil(Math.max(maxX, fallback.width));
      var height = Math.ceil(Math.max(maxY, fallback.height));
      if (!isFinite(width) || !isFinite(height) || width <= 0 || height <= 0) {
        return fallback;
      }
      return { width: width, height: height };
    } catch (err) {
      // Never let a measurement failure blank a chart that would render:
      // fall back to the DOM box (today's behavior) and stay silent — an
      // `error` message would replace the chart with an error card, which
      // is a far worse outcome than a possibly-cropped one.
      void err;
      return fallback;
    }
  }

  function renderPass() {
    rafId = null;
    if (!render) return;
    try {
      root.innerHTML = "";
      // Release before measuring: otherwise scrollWidth/scrollHeight read
      // back the previously applied extent and a widget could only ever grow.
      releaseExtent();
      render({
        d3: window.d3,
        container: root,
        data: rows,
        params: params,
        theme: theme,
        width: width,
        height: height,
      });
      var size = measureContent();
      applyExtent(size);
      lastPostedWidth = size.width;
      lastPostedHeight = size.height;
      post("rendered", {
        height: size.height,
        width: size.width,
        rowCount: rows.length,
      });
    } catch (err) {
      reportError(err);
    }
  }

  /** Coalesce: several fast-arriving batches cost one repaint. */
  function scheduleRender() {
    if (rafId !== null) return;
    rafId = window.requestAnimationFrame(renderPass);
  }

  window.addEventListener("message", function (event) {
    var msg = event.data;
    if (!msg || typeof msg !== "object" || msg.v !== VERSION) return;

    if (msg.type === "init" && nonce === null) {
      if (typeof msg.nonce !== "string" || typeof msg.program !== "string") {
        return;
      }
      nonce = msg.nonce;
      params = msg.params || {};
      theme = msg.theme || null;
      width = (msg.size && msg.size.width) || 0;
      height = (msg.size && msg.size.height) || 0;
      try {
        render = new Function("api", msg.program);
      } catch (err) {
        reportError(err);
      }
      return;
    }

    // Post-init messages must carry the learned nonce.
    if (nonce === null || msg.nonce !== nonce) return;

    if (msg.type === "data" && Array.isArray(msg.rows)) {
      rows = rows.concat(msg.rows);
      scheduleRender();
    } else if (msg.type === "theme" && msg.theme) {
      theme = msg.theme;
      scheduleRender();
    } else if (msg.type === "resize" && msg.size) {
      width = msg.size.width || width;
      height = msg.size.height || height;
      scheduleRender();
    }
  });

  if (typeof window.ResizeObserver === "function") {
    new window.ResizeObserver(function () {
      if (nonce === null) return;
      var size = measureContent();
      applyExtent(size);
      // applyExtent resizes #root, which re-fires this observer — post only on
      // a real change so the frame settles instead of ping-ponging.
      if (
        size.width === lastPostedWidth &&
        size.height === lastPostedHeight
      ) {
        return;
      }
      lastPostedWidth = size.width;
      lastPostedHeight = size.height;
      post("resize", { height: size.height, width: size.width });
    }).observe(root);
  }

  post("ready");
})();
