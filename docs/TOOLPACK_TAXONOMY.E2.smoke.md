# Reduce-tier push (E2) — Smoke Suite

Manual smoke test plan for [#130](https://github.com/EnterpriseBT/portal-ai/issues/130) child **E2** — removing the 10 SQL-pushed reduce-tier tools and steering the agent to express their work directly in `sql_query`. Covers the three affected packs (statistics, regression, financial). The point of this suite is the **§6-style regression check**: with the tools gone, the agent must do the same analyses in PostgreSQL (aggregates + window functions) and the user must get the same answers.

Removed (→ `sql_query`): `describe_column` `correlate` `detect_outliers` `aggregate` `trend` `changepoint` `decompose` `sharpe_ratio` `max_drawdown` `rolling_returns`.

Surviving reduce tier (8): `hypothesis_test` `var_cvar` `regression` (engine-pushdown — E2c, not this slice), `forecast` `technical_indicator` `portfolio_metrics` (streaming), `cluster` `logistic_regression` (bounded).

**Branch under test:** `feat/taxonomy-e-reduce-tier` (PR [#151](https://github.com/EnterpriseBT/portal-ai/pull/151)).

Run **§Preflight** once before any section. The rest can be walked top-to-bottom; each section is independent after preflight.

Filing bugs: open an issue against `EnterpriseBT/portal-ai`, set type `Bug`, link this file's section in the issue body.

---

## Preflight

### Environment

- [ ] `git checkout feat/taxonomy-e-reduce-tier && git pull --ff-only`
- [ ] `npm install && npm run build --workspace=packages/core` — `builtin-toolpacks.ts` dropped the 10 tool specs + capability entries; the API needs the rebuilt core dist.
- [ ] `npm run dev` boots cleanly (API `:3001`, web `:3000`); no missing-tool / missing-capability errors in the API log (the registry's `attachCapabilities` guard throws if a pack tool lacks a capability).
- [ ] Auth0 dev tenant works — login lands on `/dashboard`.
- [ ] A station with the **statistics**, **regression**, and **financial** packs enabled, attached to an entity with a numeric column (e.g. `amount`/`age`), a categorical column (e.g. `segment`), and a date + value series (for the time-series checks). Seed enough rows that results are non-trivial.

### Tool inventory sanity

- [ ] In a portal session on the test station, the agent's tool list **no longer contains**: `describe_column`, `correlate`, `detect_outliers`, `aggregate`, `trend`, `changepoint`, `decompose`, `sharpe_ratio`, `max_drawdown`, `rolling_returns`.
- [ ] It **still contains**: `sql_query`, `cluster`, `hypothesis_test`, `regression`, `logistic_regression`, `forecast`, `technical_indicator`, `var_cvar`, `portfolio_metrics`, and the pure-math financial 8.
- [ ] `GET /api-docs` and the toolpack admin UI reflect the reduced packs (statistics = cluster + hypothesis_test; regression = regression/logistic/forecast; financial drops sharpe/drawdown/rolling).

---

## §1 Statistics pack — descriptive / correlation / outliers / group-by in SQL

Each prompt below previously routed to a removed tool. Verify the agent now writes `sql_query` and the answer matches a hand/SQL-console check.

- [ ] **Descriptive stats.** "What are the count, mean, median, and p25/p75 of `amount`?" → agent issues `sql_query` using `count()`, `avg()`, `percentile_cont(0.5|0.25|0.75) WITHIN GROUP (ORDER BY amount)`. Values match a direct SQL console run.
- [ ] **Correlation.** "How correlated are `amount` and `age`?" → `corr(amount, age)`. (Spearman variant: `corr(rank() OVER (ORDER BY amount), rank() OVER (ORDER BY age))`.)
- [ ] **Outliers.** "Which rows are outliers on `amount`?" → agent computes IQR (`percentile_cont` quartiles in a CTE) or z-score (`avg`/`stddev_samp`) then filters. Returned rows match the old IQR/z-score result.
- [ ] **Group-by aggregation.** "Average `amount` and row count per `segment`." → `SELECT segment, count(*), avg(amount) … GROUP BY segment`. One row per segment, correct counts/means.
- [ ] The agent does **not** apologize for a missing tool or hallucinate `describe_column`/`aggregate`. (If it does, the prompt guidance in `system.prompt.ts` §SQL Guidance needs strengthening — file a bug.)

---

## §2 Regression pack — trend / changepoint / decompose in SQL

- [ ] **Trend.** "Show the monthly trend of `value` and its slope." → `date_trunc('month', …)` + `GROUP BY`, slope via `regr_slope(value, extract(epoch from month))` (or an index). Slope sign/magnitude matches the old `trend` tool.
- [ ] **Moving average / decomposition.** "Give me a centered moving average of `value`." → `avg(value) OVER (ORDER BY d ROWS BETWEEN n PRECEDING AND n FOLLOWING)`. Matches the old `decompose` trend component shape.
- [ ] **Changepoint (CUSUM).** "Where does the mean of `value` shift?" → agent builds a running-sum / CUSUM window expression and identifies the break index. Reasonable agreement with the old `changepoint` output (exact parity not required — method is agent-chosen).
- [ ] Surviving `regression` and `forecast` tools still work unchanged for their prompts ("fit y on x", "forecast the next 3 months").

---

## §3 Financial pack — sharpe / max-drawdown / rolling-returns in SQL

- [ ] **Sharpe ratio.** "What's the Sharpe ratio of the `price` series?" → agent derives period returns (`(price/lag(price) OVER (ORDER BY d)) - 1`) then `avg(ret)/stddev_samp(ret)` (× annualization factor if asked). Matches the old `sharpe_ratio` value.
- [ ] **Max drawdown.** "What's the max drawdown of `price`?" → running peak `max(price) OVER (ORDER BY d ROWS UNBOUNDED PRECEDING)`, then `max((peak - price)/peak)`. Matches the old value, with peak/trough dates.
- [ ] **Rolling returns.** "Rolling 3-period returns of `price`." → `(price / lag(price, 3) OVER (ORDER BY d)) - 1`. Series matches the old `rolling_returns` output.
- [ ] Surviving `var_cvar`, `portfolio_metrics`, `technical_indicator`, and the pure-math tools (`npv`, `irr`, `tvm`, …) still work for their prompts.

---

## §4 Custom toolpack name conflicts

- [ ] A custom webhook pack may now register a tool named `describe_column` / `correlate` / `aggregate` / etc. (no longer reserved built-ins) without a `TOOLPACK_TOOL_NAME_CONFLICT`. Conversely, `sql_query`, `cluster`, `hypothesis_test`, etc. **still** conflict.

---

## Bug template

```
**Section:** E2 smoke §N
**Prompt:** "<what you asked the agent>"
**Expected:** agent writes sql_query (<the aggregate/window>), answer = <value>
**Actual:** <what happened — wrong tool, refusal, wrong number>
**Tool list seen:** <relevant tools present/absent>
```
