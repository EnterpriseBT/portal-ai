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

/** A hex colour: the whole string, or after `:`, `(` or `,` (CSS such as
 *  "fill:#fff" or a gradient). Elsewhere a `#` is text ("Order #1234"). */
const HEX =
  /(?:^\s*|[:(,]\s*)(#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4}))(?![\w-])/gi;
const COLOUR_FUNCTION = /\b(?:rgba?|hsla?)\(/gi;
const D3_SCHEME = /\b(?:api\.)?d3\.scheme[A-Z]\w*/g;
const D3_INTERPOLATOR = /\b(?:api\.)?d3\.(interpolate\w*)/g;

/** The content of one string literal, or one text segment of a template. */
interface StringPart {
  /** Offset of the content's first character in the source. */
  start: number;
  text: string;
}

/**
 * Comments blanked to spaces (newlines kept, so offsets and line numbers
 * hold) and the content of every string literal. A template's `${…}`
 * expressions are code, not string content, so a d3 scheme inside one is
 * still found. Regex literals aren't recognised; a quote inside one can
 * mislead the scan, which at worst rejects a program into another attempt.
 */
function scan(src: string): { code: string; strings: StringPart[] } {
  const out = src.split("");
  const strings: StringPart[] = [];
  const n = src.length;

  // Scans from `i` (just past an opening quote) to its close; returns the
  // index past the closing quote. Templates recurse into `${…}`.
  const readString = (i: number, quote: string): number => {
    let start = i;
    while (i < n && src[i] !== quote) {
      if (src[i] === "\\") {
        i += 2;
      } else if (quote !== "`" && src[i] === "\n") {
        break;
      } else if (quote === "`" && src[i] === "$" && src[i + 1] === "{") {
        strings.push({ start, text: src.slice(start, i) });
        i = readCode(i + 2, "}");
        start = i;
      } else {
        i++;
      }
    }
    strings.push({ start, text: src.slice(start, i) });
    return i + 1;
  };

  // Scans code from `i` until `close` at depth 0 (or the end); returns the
  // index past it.
  const readCode = (i: number, close: string | null): number => {
    let depth = 0;
    while (i < n) {
      const c = src[i];
      const next = src[i + 1];
      if (c === "/" && next === "/") {
        while (i < n && src[i] !== "\n") out[i++] = " ";
      } else if (c === "/" && next === "*") {
        const end = src.indexOf("*/", i + 2);
        const stop = end === -1 ? n : end + 2;
        for (; i < stop; i++) if (src[i] !== "\n") out[i] = " ";
      } else if (c === '"' || c === "'" || c === "`") {
        i = readString(i + 1, c);
      } else {
        if (c === "{") depth++;
        else if (c === "}") {
          if (depth === 0 && close === "}") return i + 1;
          depth--;
        }
        i++;
      }
    }
    return i;
  };

  readCode(0, null);
  return { code: out.join(""), strings };
}

/** Colour literals and d3 colour helpers in a program, comments ignored,
 *  in order of appearance (#1022). */
export function findColourLiterals(src: string): ColourLiteral[] {
  const { code, strings } = scan(src);
  const found: { at: number; literal: string }[] = [];

  for (const { start, text } of strings) {
    for (const m of text.matchAll(HEX)) {
      found.push({
        at: start + (m.index ?? 0) + m[0].indexOf("#"),
        literal: m[1],
      });
    }
    for (const m of text.matchAll(COLOUR_FUNCTION)) {
      found.push({ at: start + (m.index ?? 0), literal: m[0] });
    }
    // A string that is exactly a colour name, wherever it's used: an attr
    // value, a ternary branch, an array of series colours.
    const word = text.trim();
    if (CSS_NAMED_COLOURS.has(word.toLowerCase())) {
      found.push({ at: start + text.indexOf(word), literal: word });
    }
  }

  // d3 helpers are code, so string content is blanked before matching them.
  const chars = code.split("");
  for (const { start, text } of strings) {
    for (let i = start; i < start + text.length; i++)
      if (chars[i] !== "\n") chars[i] = " ";
  }
  const bare = chars.join("");
  for (const m of bare.matchAll(D3_SCHEME)) {
    found.push({ at: m.index ?? 0, literal: m[0] });
  }
  for (const m of bare.matchAll(D3_INTERPOLATOR)) {
    if (!NON_COLOUR_INTERPOLATORS.has(m[1])) {
      found.push({ at: m.index ?? 0, literal: m[0] });
    }
  }

  return found
    .sort((a, b) => a.at - b.at)
    .map(({ at, literal }) => ({
      literal,
      line: src.slice(0, at).split("\n").length,
    }));
}
