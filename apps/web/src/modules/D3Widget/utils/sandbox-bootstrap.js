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
 *   out: ready · rendered { height, rowCount } · resize { height }
 *        error { message, stack }
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

  function renderPass() {
    rafId = null;
    if (!render) return;
    try {
      root.innerHTML = "";
      render({
        d3: window.d3,
        container: root,
        data: rows,
        params: params,
        theme: theme,
        width: width,
        height: height,
      });
      post("rendered", { height: root.scrollHeight, rowCount: rows.length });
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
      if (nonce !== null) {
        post("resize", { height: root.scrollHeight });
      }
    }).observe(root);
  }

  post("ready");
})();
