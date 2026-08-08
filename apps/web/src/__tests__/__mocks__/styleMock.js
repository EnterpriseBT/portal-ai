// Mock CSS imports for Jest. `apps/web` is `type: module`, so this file is
// ESM — a CommonJS `module.exports` would throw "module is not defined" the
// moment a component imports a stylesheet (e.g. maplibre-gl.css, #314).
export default {};
