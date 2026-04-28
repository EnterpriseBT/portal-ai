# Segment intersection matrix

Specifies the shape of each emitted record given the segment kinds that govern its position(s) along the region's header axis or axes. A region is parameterised by `headerAxes ⊆ {row, column}` and, per declared header axis, a sequence of segments — each `<field>`, `<pivot>`, or `<skip>` — that partition the axis's positions.

The shape of the emitted record depends on `headerAxes.length`:

- `0` → headerless. No segment kinds; every position is positional-`<field>`-equivalent.
- `1` → 1D. One axis of segments; each position's behaviour is determined by its enclosing segment kind alone.
- `2` → 2D crosstab. Every interior body cell sits at the intersection of one row-axis position and one column-axis position; both segment kinds participate in the cell's semantics.

## Legend

| Token | Meaning |
|---|---|
| `<field>` | A `kind: "field"` segment. Each position contributes one named static field to every record. Field name = `<override>` if `headers[i]` is set, else `<header>`. `skipped[i] === true` flips that single position to `<skip>` semantics. |
| `<pivot>` | A `kind: "pivot"` segment. The segment as a whole defines two record fields — `<axis-name>` (the segment's `axisName`) and `<cell-value>` (the region's `cellValueField.name`) — and fans out into one record per non-skip position. Requires `cellValueField` on the region. |
| `<skip>` | A `kind: "skip"` segment. Its positions emit nothing. |
| `<override>` | A user-supplied per-position string (`headers[i]` for `<field>`, `axisName` for `<pivot>`) that wins over the cell-derived label and is coerced to a valid `<normalized-key>` at commit. |
| `<header>` | The header-line cell at this position (or its `<override>`). Read at interpret/replay time. |
| `<header-row>` / `<header-col>` | The row-axis / column-axis `<header>` at the position governing this body cell. |
| `<header-row_i>` / `<header-col_j>` | The row-axis header at row-axis position `i` / column-axis header at column-axis position `j`. Used when naming fields across an intersection block of body cells. |
| `<axis-name>` | The pivot segment's `axisName` (or its `<override>`). Becomes the record-field name under which `<header>` values are emitted. |
| `<axis-name-row>` / `<axis-name-col>` | `<axis-name>` of the row-axis / column-axis `<pivot>` segment. |
| `<cell-value>` | The region's `cellValueField.name`. Becomes the record-field name under which body-cell values are emitted on a pivot-bearing region. |
| `<intersection-block>` | The rectangle of body cells defined by `(row-axis pivot segment R, column-axis pivot segment C)` — every body cell whose row-axis position is inside `R` and whose column-axis position is inside `C`. A region with `K` row-axis pivot segments and `L` column-axis pivot segments has `K × L` intersection blocks. |
| `<value_i_j>` | The body cell at `(row-axis position i, column-axis position j)` inside an intersection block, indexed inside the block (`1 ≤ i ≤ R.positionCount`, `1 ≤ j ≤ C.positionCount`). |
| `<value>` | The body cell's contents at the position(s) under discussion, coerced to a primitive record-field value. |
| `<normalized-key>` | The committed FieldMapping key — `^[a-z][a-z0-9_]*$` form derived from `<override>` or `<header>`. |
| `<record>` | One emitted record. Each section below shows its field shape as a JSON object. |
| `"...": "..."` | "Repeat the preceding pattern for every position on the same axis with the same kind." |
| `—` | No record / no field — dropped entirely. |

## 1D regions (`headerAxes.length === 1`)

Records run on the records axis (the axis opposite the header axis); one row of records per non-`<skip>` line on that axis. Each row of records expands into one record per `<pivot>` position when a pivot is present, otherwise one record per line.

### `<field>` only

One record per records-axis line.

```json
{
  "<header_1>": "<value_1>",
  "...": "...",
  "<header_N>": "<value_N>"
}
```

### `<pivot>` only

`M` records per records-axis line, where `M` is the number of non-skip pivot positions. Subscript `_i` ranges over those positions; one record per `i`.

```json
{
  "<axis-name>": "<header_i>",
  "<cell-value>": "<value_i>"
}
```

### `<skip>` only

No records emitted.

```json
—
```

### `<field>` + `<pivot>`

`M` records per records-axis line. Static field columns appear as a sidebar on every fanned record.

```json
{
  "<header_field_1>": "<value>",
  "...": "...",
  "<axis-name>": "<header_pivot_i>",
  "<cell-value>": "<value_i>"
}
```

### `<field>` + `<skip>`

One record per records-axis line. `<skip>` positions are omitted from the shape.

```json
{
  "<header_field_1>": "<value>",
  "...": "...",
  "<header_field_N>": "<value>"
}
```

### `<pivot>` + `<skip>`

`M` records per records-axis line. `<skip>` positions don't fan out.

```json
{
  "<axis-name>": "<header_pivot_i>",
  "<cell-value>": "<value_i>"
}
```

### `<field>` + `<pivot>` + `<skip>`

`M` records per records-axis line. Static field columns from the `<field>` segment appear on every fanned record; `<skip>` positions are omitted.

```json
{
  "<header_field_1>": "<value>",
  "...": "...",
  "<axis-name>": "<header_pivot_i>",
  "<cell-value>": "<value_i>"
}
```

Notes:

- A `<field>` segment with `skipped[k] === true` contributes nothing for position `k`.
- An axis carrying two `<pivot>` segments emits `M_1 × M_2` records per records-axis line, each carrying both `<axis-name>`s. The shapes above show the single-pivot case.

## 2D regions (`headerAxes.length === 2`, crosstab)

A body cell at row-axis position `p_r` (a sheet column) and column-axis position `p_c` (a sheet row) is governed by the row-axis segment kind covering `p_r` and the column-axis segment kind covering `p_c`. One record per non-`<skip>` body cell.

### `<field>` × `<field>`

Both axes claim the body cell as a static field value under different names. Degenerate — admitted by the schema but yields a record with two field names pointing at the same `<value>`.

```json
{
  "<header-row>": "<value>",
  "<header-col>": "<value>"
}
```

### `<field>` × `<pivot>`

Row-axis contributes a static field name from its header; column-axis contributes the pivot key + cell-value pair.

```json
{
  "<header-row>": "<value>",
  "<axis-name-col>": "<header-col>",
  "<cell-value>": "<value>"
}
```

### `<field>` × `<skip>`

Column-axis `<skip>` drops the row from records regardless of the orthogonal kind.

```json
—
```

### `<pivot>` × `<field>`

Symmetric to `<field>` × `<pivot>`. Column-axis contributes a static field name; row-axis contributes the pivot key + cell-value pair.

```json
{
  "<axis-name-row>": "<header-row>",
  "<header-col>": "<value>",
  "<cell-value>": "<value>"
}
```

### `<pivot>` × `<pivot>`

Classic crosstab: both axes contribute pivot keys, body cell becomes the cell-value.

```json
{
  "<axis-name-row>": "<header-row>",
  "<axis-name-col>": "<header-col>",
  "<cell-value>": "<value>"
}
```

### `<pivot>` × `<skip>`

Column-axis `<skip>` drops the row from records.

```json
—
```

### `<skip>` × `<field>`

Row-axis `<skip>` drops the column from records.

```json
—
```

### `<skip>` × `<pivot>`

Row-axis `<skip>` drops the column from records.

```json
—
```

### `<skip>` × `<skip>`

Both axes drop the cell.

```json
—
```

Notes:

- `<header-row>` is the row-axis header at column `p_r`; `<header-col>` is the column-axis header at row `p_c`. They live on different lines (row `bounds.startRow` and column `bounds.startCol` respectively) and never refer to the same cell.
- `<value>` denotes the body cell at `(p_r, p_c)`. When a single record carries two `<value>` slots they resolve to the same body cell — they are being read into two different record fields, not two different cells.
- A `<field>` segment with `skipped[k] === true` participates as `<skip>` for that single position only; the rest of the segment continues to follow `<field>` semantics.
- Sidebar / non-header positions: when an axis carries `[<field>(s), <pivot>(p)]`, the `s` field columns become a sidebar appended to every record produced under the pivoted columns. The shapes above show only the body-cell intersection; full record shape under mixed-segment axes is the union of every non-skip position's contribution from both axes.

### Intersection blocks (multiple pivot segments per axis)

When more than one `<pivot>` segment lives on each axis, every pair `(row-axis pivot segment R, column-axis pivot segment C)` carves out an `<intersection-block>` — the rectangle of body cells whose row-axis position is inside `R` and whose column-axis position is inside `C`. A region with `K` row-axis pivot segments and `L` column-axis pivot segments has `K × L` such blocks; the `<pivot>` × `<pivot>` cell of the matrix above describes the semantics within a single block.

The block can be interpreted in two ways. Both are admitted by the schema; which one applies is a per-region (or per-block) configuration choice, not a property of the segments themselves.

#### Interpretation A — fan-out (default `<pivot>` × `<pivot>` semantics)

Each body cell in the block emits its own record. `R.axisName` and `C.axisName` are record-field names; the headers at the cell's row-axis / column-axis positions are the values; `cellValueField.name` carries the body cell's `<value>`. One record per non-skip cell:

```json
{
  "<axis-name-row>": "<header-row_i>",
  "<axis-name-col>": "<header-col_j>",
  "<cell-value>": "<value_i_j>"
}
```

#### Interpretation B — flatten (each cell is a uniquely-named field)

The whole block collapses into a single record. Each non-skip body cell contributes one field whose key is composed from the row-axis and column-axis headers at that position. `cellValueField` does not participate — every value lands under its own composite key:

```json
{
  "<header-row_1>_<header-col_1>": "<value_1_1>",
  "<header-row_1>_<header-col_2>": "<value_1_2>",
  "...": "...",
  "<header-row_M>_<header-col_N>": "<value_M_N>"
}
```

Where `M` = number of non-skip positions in `R`, `N` = number of non-skip positions in `C`. The composite key is `<header-row_i>_<header-col_j>` (joined by `_`); when either header is itself overridden via `<override>` the override wins on its side of the join. The committed `<normalized-key>` is derived from the composite the same way single-cell keys are.

#### When to pick which

- **Fan-out** is the right call when the two pivot axes name *dimensions* of a single observation (e.g. one axis is a date, the other is a category) and the body cells are samples of one underlying metric. Records are dense across the block; downstream filtering / aggregation by either axis is natural.
- **Flatten** is the right call when each `(row-axis position, column-axis position)` pair names a *distinct field* on a single logical row (e.g. each cell is a different KPI for the same entity). Records are sparse-but-wide; downstream code reads the cells by composite key rather than pivoting back across either axis.
- A region may apply different interpretations to different intersection blocks — `K × L` blocks each carry their own choice. Mixing usually only makes sense when the blocks model genuinely different shapes (e.g. one block is per-period metrics fanned out, another is sidebar attributes flattened).
- A `<skip>` position on either axis still drops its row / column from every block that contains it, regardless of interpretation.

## Headerless regions (`headerAxes.length === 0`)

No segment kinds participate; every position along the records-axis-opposite is treated as positional `<field>`. One record per line on the records axis. Each `<header_i>` defaults to a positional placeholder (`columnA`, `columnB`, …) and may be overridden via the region's `columnOverrides` map.

```json
{
  "<header_1>": "<value_1>",
  "...": "...",
  "<header_N>": "<value_N>"
}
```
