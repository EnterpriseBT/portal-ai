/**
 * Validation for an agent-generated D3 render program (#269): it must parse,
 * and (#1022) it may not write its own colours.
 *
 * Constructs `new Function("api", src)` — the *exact* call the sandbox
 * bootstrap makes (`apps/web/src/modules/D3Widget/utils/sandbox-bootstrap.js`)
 * — so server-side acceptance cannot diverge from what the frame parses. It
 * **never calls** the function: this catches syntax errors ("doesn't compile")
 * before a block is minted, and is not a security control (that is the #268
 * sandbox boundary). A body with side effects or a `throw` therefore validates
 * `ok: true` — it is not executed here. The colour check (`findColourLiterals`)
 * is a static read of the source, also never executed.
 */
export type ValidateResult =
  | { ok: true }
  | { ok: false; error: string; colour?: ColourLiteral };

/** A colour a chart program wrote itself instead of reading `api.theme` (#1022). */
export interface ColourLiteral {
  literal: string;
  /** 1-based line in the program. */
  line: number;
}

/**
 * Strip a Markdown code fence the codegen model sometimes wraps the program in
 * (#281). ```` ```javascript … ``` ```` parses as an *empty-string tagged
 * template* — syntactically valid, so `validateProgram` accepts it — then
 * throws `"" is not a function` at runtime in the sandbox. Removing the fence
 * before validation/minting yields the raw program the sandbox can run.
 * A body with no leading fence is returned unchanged.
 */
export function stripProgramFence(src: string): string {
  const trimmed = src.trim();
  if (!trimmed.startsWith("```")) return src;
  // Drop the opening fence line (``` + optional language tag) and the trailing
  // closing fence. Repeat once to tolerate a doubled/empty fence line.
  let out = trimmed.replace(/^```[^\n]*\n?/, "").replace(/\n?```$/, "");
  if (out.trim().startsWith("```")) {
    out = out
      .trim()
      .replace(/^```[^\n]*\n?/, "")
      .replace(/\n?```$/, "");
  }
  return out;
}

export function validateProgram(src: string): ValidateResult {
  try {
    // Construction parses the body without running it.
    new Function("api", src);
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
  // #1022: series colours come from `api.theme.categorical`, which the theme
  // holds at 3:1 against the figure. A colour the program writes itself has
  // no such check, so it's rejected and the codegen loop retries with this
  // error (falling back to a data table after the last attempt).
  const [colour] = findColourLiterals(src);
  if (colour) {
    return {
      ok: false,
      error: `Colour "${colour.literal}" on line ${colour.line}: take series colours from api.theme.categorical, and use api.theme.text or api.theme.background for anything else.`,
      colour,
    };
  }
  return { ok: true };
}

/** d3 `interpolate*` helpers that blend numbers, strings, dates or
 *  transforms, not colours (#1022). Every other `interpolate*` is a colour
 *  ramp or a colour-space blend. */
export const NON_COLOUR_INTERPOLATORS: ReadonlySet<string> = new Set([
  "interpolate",
  "interpolateNumber",
  "interpolateRound",
  "interpolateString",
  "interpolateDate",
  "interpolateArray",
  "interpolateNumberArray",
  "interpolateObject",
  "interpolateTransformCss",
  "interpolateTransformSvg",
  "interpolateZoom",
  "interpolateDiscrete",
  "interpolateBasis",
  "interpolateBasisClosed",
]);

/** The attributes and style properties whose value is a colour. */
const COLOUR_PROPERTIES = new Set([
  "fill",
  "stroke",
  "color",
  "stop-color",
  "background",
  "background-color",
]);

/** The CSS named colours (CSS Color 4), lower-cased. `transparent`,
 *  `currentcolor` and `inherit` aren't here, so they pass. */
const CSS_NAMED_COLOURS = new Set(
  (
    "aliceblue antiquewhite aqua aquamarine azure beige bisque black " +
    "blanchedalmond blue blueviolet brown burlywood cadetblue chartreuse " +
    "chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan " +
    "darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta " +
    "darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen " +
    "darkslateblue darkslategray darkslategrey darkturquoise darkviolet " +
    "deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite " +
    "forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray green " +
    "greenyellow grey honeydew hotpink indianred indigo ivory khaki lavender " +
    "lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan " +
    "lightgoldenrodyellow lightgray lightgreen lightgrey lightpink " +
    "lightsalmon lightseagreen lightskyblue lightslategray lightslategrey " +
    "lightsteelblue lightyellow lime limegreen linen magenta maroon " +
    "mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen " +
    "mediumslateblue mediumspringgreen mediumturquoise mediumvioletred " +
    "midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive " +
    "olivedrab orange orangered orchid palegoldenrod palegreen " +
    "paleturquoise palevioletred papayawhip peachpuff peru pink plum " +
    "powderblue purple rebeccapurple red rosybrown royalblue saddlebrown " +
    "salmon sandybrown seagreen seashell sienna silver skyblue slateblue " +
    "slategray slategrey snow springgreen steelblue tan teal thistle tomato " +
    "turquoise violet wheat white whitesmoke yellow yellowgreen"
  ).split(" ")
);

const HEX = /#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})(?![\w-])/gi;
const COLOUR_FUNCTION = /\b(?:rgba?|hsla?)\(/gi;
const D3_SCHEME = /\b(?:api\.)?d3\.scheme[A-Z]\w*/g;
const D3_INTERPOLATOR = /\b(?:api\.)?d3\.(interpolate\w*)/g;
const NAMED_COLOUR_VALUE =
  /\.(?:attr|style)\(\s*(["'`])([\w-]+)\1\s*,\s*(["'`])([a-z]+)\3/gi;

/**
 * Comments blanked to spaces (newlines kept, so offsets and line numbers
 * hold) and the `[start, end)` spans of string and template literals.
 * Regex literals aren't recognised; a quote inside one can mislead it,
 * which at worst rejects a program into another attempt.
 */
function scan(src: string): { code: string; strings: [number, number][] } {
  const out = src.split("");
  const strings: [number, number][] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    const next = src[i + 1];
    if (c === "/" && next === "/") {
      while (i < src.length && src[i] !== "\n") out[i++] = " ";
    } else if (c === "/" && next === "*") {
      const end = src.indexOf("*/", i + 2);
      const stop = end === -1 ? src.length : end + 2;
      for (; i < stop; i++) if (src[i] !== "\n") out[i] = " ";
    } else if (c === '"' || c === "'" || c === "`") {
      const start = i++;
      while (i < src.length && src[i] !== c) {
        if (src[i] === "\\") i++;
        else if (c !== "`" && src[i] === "\n") break;
        i++;
      }
      strings.push([start, ++i]);
    } else {
      i++;
    }
  }
  return { code: out.join(""), strings };
}

/** Colour literals and d3 colour helpers in a program, comments ignored,
 *  in order of appearance (#1022). */
export function findColourLiterals(src: string): ColourLiteral[] {
  const { code, strings } = scan(src);
  const inString = (at: number) => strings.some(([s, e]) => at > s && at < e);
  const found: { at: number; literal: string }[] = [];
  const each = (re: RegExp, keep: (m: RegExpExecArray) => string | null) => {
    for (const m of code.matchAll(re)) {
      const literal = keep(m);
      if (literal !== null) found.push({ at: m.index ?? 0, literal });
    }
  };

  each(HEX, (m) => (inString(m.index ?? 0) ? m[0] : null));
  each(COLOUR_FUNCTION, (m) => (inString(m.index ?? 0) ? m[0] : null));
  each(D3_SCHEME, (m) => (inString(m.index ?? 0) ? null : m[0]));
  each(D3_INTERPOLATOR, (m) =>
    inString(m.index ?? 0) || NON_COLOUR_INTERPOLATORS.has(m[1]) ? null : m[0]
  );
  for (const m of code.matchAll(NAMED_COLOUR_VALUE)) {
    const [, , property, , value] = m;
    if (!COLOUR_PROPERTIES.has(property.toLowerCase())) continue;
    if (!CSS_NAMED_COLOURS.has(value.toLowerCase())) continue;
    found.push({
      at: (m.index ?? 0) + m[0].length - value.length - 1,
      literal: value,
    });
  }

  return found
    .sort((a, b) => a.at - b.at)
    .map(({ at, literal }) => ({
      literal,
      line: src.slice(0, at).split("\n").length,
    }));
}
