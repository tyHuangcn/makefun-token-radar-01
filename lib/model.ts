// Launch Radar, model "radar-2": one sealed snapshot in, one ranked board out.
//
// The board ranks every protocol that records no token and is a genuine launch
// candidate. A protocol is a candidate when it records no token (no market cap,
// no CoinGecko id, no symbol) AND it is not an exchange, a bridge, a wrapped or
// staked product, or a versioned pool of another protocol -- the same exclusion
// rule the house used to draw its watchlist, applied to every row alike, so no
// name is ever special-cased. The watchlist is the floor: every one of its slugs
// is ranked, and the board adds every other candidate the snapshot holds.
//
// Implied launch value follows only from the snapshot's own figures:
//
//   implied = tvl_usd x categoryMultiple x growthFactor x ageFactor x chainFactor
//
//   categoryMultiple  what a launch in this category is worth per dollar of TVL.
//                     Dexs / derivatives / yield / prediction markets 0.35,
//                     lending / CDP / RWA / curators / allocators 0.25,
//                     everything else 0.22. The multiples are the model's stated
//                     assumptions, printed on the dashboard, not a fact.
//   growthFactor      from the 7-day TVL change, clamped to [-50, +100] per cent:
//                     1 + 0.6 x growth/100 when growing (a +100% week is worth
//                     1.60x), 1 + 0.8 x growth/100 when shrinking (a -50% week is
//                     worth 0.60x: falls hurt more than rises help). No report: 1.
//   ageFactor         a patience curve over the days since DefiLlama first
//                     tracked the protocol: under 90 days it ramps 0.75 -> 1.00
//                     (too young to have a points program worth farming yet);
//                     90 to 730 days it climbs 1.00 -> 1.15 (a longer record
//                     with no token means more pent-up launch value); past 730
//                     days it fades 1.15 -> 0.95 (two years with no launch says
//                     the launch may never come). Unknown age: 0.95.
//   chainFactor       1 + 0.03 per extra chain, capped at 1.12: distribution
//                     across chains is worth something, but not much.
//
// Protocols whose token already trades are never mixed into the ranking: they
// are carried apart as the live set, shown at the market's own value.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, as the dashboard states them. */
export interface ModelConstants {
  category_high: number;
  category_mid: number;
  category_default: number;
  growth_up_weight: number;
  growth_down_weight: number;
  growth_floor: number;
  growth_cap: number;
  age_young_days: number;
  age_young_floor: number;
  age_peak_days: number;
  age_peak: number;
  age_decay_days: number;
  age_decay_floor: number;
  age_unknown: number;
  chain_step: number;
  chain_max_extra: number;
}

export const MODEL: ModelConstants = {
  category_high: 0.35,
  category_mid: 0.25,
  category_default: 0.22,
  growth_up_weight: 0.6,
  growth_down_weight: 0.8,
  growth_floor: -50,
  growth_cap: 100,
  age_young_days: 90,
  age_young_floor: 0.75,
  age_peak_days: 730,
  age_peak: 1.15,
  age_decay_days: 730,
  age_decay_floor: 0.95,
  age_unknown: 0.95,
  chain_step: 0.03,
  chain_max_extra: 4,
};

/** The model's version label: the dashboard names it. */
export const MODEL_VERSION = 'radar-2';

/** How many live-token protocols the Live view carries, by market cap. */
export const LIVE_ROWS = 24;

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    category_multiple: number;
    growth_pct: number;
    growth_factor: number;
    age_factor: number;
    chain_factor: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  category_multiple: number;
  growth_factor: number;
  age_factor: number;
  chain_factor: number;
  farm_steps: string[];
}

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** How many protocols the exclusions set aside, and why. */
export interface SetAside {
  exchanges: number;
  wrapped_or_bridged: number;
  staked: number;
  versioned: number;
  has_token: number;
}

/** Everything the dashboard needs: the board, the live set, and the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  watchlist_slugs: string[];
  board_size: number;
  live_size: number;
  set_aside: SetAside;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** The category's multiple per dollar of TVL. */
export function categoryMultiple(category: string | null): number {
  const c = (category ?? '').toLowerCase();
  if (
    c.includes('dex') ||
    c.includes('derivative') ||
    c.includes('perpetual') ||
    c.includes('option') ||
    c.includes('yield aggregator') ||
    c.includes('leveraged farm') ||
    c.includes('prediction')
  ) {
    return MODEL.category_high;
  }
  if (
    c.includes('lend') ||
    c.includes('cdp') ||
    c.includes('collateral') ||
    c.includes('rwa') ||
    c.includes('curator') ||
    c.includes('allocator') ||
    c.includes('yield') ||
    c.includes('restak')
  ) {
    return MODEL.category_mid;
  }
  return MODEL.category_default;
}

/** The growth factor from a 7-day TVL change in per cent. */
export function growthFactor(change7d: number | null): { pct: number; factor: number } {
  const raw = finite(change7d, 0);
  const pct = Math.min(MODEL.growth_cap, Math.max(MODEL.growth_floor, raw));
  const factor = pct >= 0 ? 1 + (pct / 100) * MODEL.growth_up_weight : 1 + (pct / 100) * MODEL.growth_down_weight;
  return { pct, factor };
}

/** The patience factor from the protocol's age in days. */
export function ageFactor(age: number | null): number {
  if (age === null) return MODEL.age_unknown;
  if (age < MODEL.age_young_days) {
    return MODEL.age_young_floor + (1 - MODEL.age_young_floor) * (age / MODEL.age_young_days);
  }
  if (age <= MODEL.age_peak_days) {
    return 1 + (MODEL.age_peak - 1) * ((age - MODEL.age_young_days) / (MODEL.age_peak_days - MODEL.age_young_days));
  }
  const past = Math.min(age - MODEL.age_peak_days, MODEL.age_decay_days) / MODEL.age_decay_days;
  return MODEL.age_peak - (MODEL.age_peak - MODEL.age_decay_floor) * past;
}

/** The distribution factor from the number of chains. */
export function chainFactor(chains: string[]): number {
  return 1 + MODEL.chain_step * Math.min(Math.max(chains.length - 1, 0), MODEL.chain_max_extra);
}

/** The four factors and the implied value one protocol gets under `model`. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
): { implied: number; catMult: number; growthPct: number; growth: number; age: number | null; ageF: number; chainF: number } {
  const age = ageDays(asOf, protocol.listed_at);
  const catMult = categoryMultiple(protocol.category);
  const { pct: growthPct, factor: growth } = growthFactor(protocol.change_7d);
  const ageF = ageFactor(age);
  const chainF = chainFactor(protocol.chains);
  const implied = Math.max(1, Math.round(protocol.tvl_usd * catMult * growth * ageF * chainF));
  return { implied, catMult, growthPct, growth, age, ageF, chainF };
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
/** A whole word wrapped, staked or staking, any case. */
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;
/** An exchange's name at the start of a protocol name. */
const EXCHANGE_START = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;
/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Why a pre-token protocol is set aside from the launch ranking, or null when it is a candidate. */
export function setAsideReason(p: SnapshotProtocol): 'exchange' | 'wrapped_or_bridged' | 'staked' | 'versioned' | null {
  if (p.category === 'CEX' || EXCHANGE_START.test(p.name)) return 'exchange';
  if (p.category === 'Bridge' || p.category === 'Canonical Bridge') return 'wrapped_or_bridged';
  if (p.category === 'Liquid Staking' || p.category === 'Liquid Restaking' || p.category === 'Restaked BTC') return 'staked';
  if (WRAPPED_WORD.test(p.name)) return 'wrapped_or_bridged';
  if (VERSIONED.test(p.name)) return 'versioned';
  return null;
}

/** Whether a protocol is one the board may rank: pre-token and a genuine launch candidate. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && setAsideReason(p) === null;
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot): BoardRow[] {
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug is ranked. A watchlist slug the
  // snapshot no longer carries cannot happen, but the coverage is never gambled.
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // Every other genuine candidate the snapshot holds, below the floor or not.
  for (const p of snapshot.protocols) {
    if (!chosen.has(p.slug) && isRankable(p)) chosen.set(p.slug, p);
  }

  const scored = [...chosen.values()].map((p) => {
    const v = impliedValue(p, snapshot.as_of);
    return { p, ...v };
  });
  // Strongest first; ties break by TVL, then by slug, so the order is stable.
  scored.sort((a, b) => b.implied - a.implied || b.p.tvl_usd - a.p.tvl_usd || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      category_multiple: s.catMult,
      growth_pct: s.growthPct,
      // Full precision on purpose: the detail view multiplies these factors
      // out again, and rounded factors would not reproduce the implied value.
      growth_factor: s.growth,
      age_factor: s.ageF,
      chain_factor: s.chainF,
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age).map(stepText),
  }));
}

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 1_000_000_000) return 250;
  if (p.tvl_usd >= 100_000_000) return 150;
  if (p.tvl_usd >= 50_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 45;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The category's one action, in the words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) {
    return `Lend $${capital} of USDC into ${name}'s market on ${chain} and leave the supply open so the position counts in every weekly snapshot.`;
  }
  if (c.includes('dex') || c.includes('amm') || c.includes('swap')) {
    return `Add $${capital} of liquidity to ${name}'s busiest pool on ${chain}, a stable pair when one exists, and keep the LP position open.`;
  }
  if (c.includes('yield aggregator') || c.includes('leveraged farm') || c.includes('yield')) {
    return `Deposit $${capital} into ${name}'s highest-TVL vault on ${chain} and keep the vault shares until the next rebalance.`;
  }
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('option')) {
    return `Deposit $${capital} of USDC as collateral on ${name} and open one small hedged position, then close it inside the week.`;
  }
  if (c.includes('prediction')) {
    return `Fund $${capital} and take one position in ${name}'s longest-running market on ${chain}.`;
  }
  if (c.includes('curator') || c.includes('allocator') || c.includes('vault')) {
    return `Allocate $${capital} to a ${name} vault on ${chain} and keep the shares through the next rebalance.`;
  }
  if (c.includes('rwa')) {
    return `Mint $${capital} of ${name}'s yield-bearing asset on ${chain} and hold it in the same wallet.`;
  }
  if (c.includes('stable')) {
    return `Mint or hold $${capital} of the stable asset ${name} issues on ${chain} and keep it in the farming wallet.`;
  }
  if (c.includes('insurance')) {
    return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy active for the full term.`;
  }
  if (c.includes('staking') || c.includes('restak')) {
    return `Stake $${capital} through ${name} on ${chain} and hold the receipt token in the farming wallet.`;
  }
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open so it shows up in the protocol's activity records.`;
}

/**
 * A protocol's farm plan: six steps, each an action with a cost and a time. The plan is derived from
 * the protocol's own record (category, chains, TVL, age), never from a hand-written list of names.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const action = actionFor(p, capital, chain);
  return [
    {
      text: `Open a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline where nobody else can read it.`,
      cost: 'under $3 of gas for the first transaction',
      time: '5 minutes',
    },
    {
      text: action,
      cost: `$${capital} of capital and about $${capital >= 150 ? 8 : 4} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: `Do one qualifying action every week, a deposit, a borrow, a swap or a vote, so the wallet stays active in the protocol's records.`,
      cost: 'about $2 of gas a week',
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot instead of one.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Before you claim anything, open the protocol's own points or rewards page from its official channel and claim only from the link it publishes.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: `Write the wallet, the dates and every transaction hash in a farm log, so you can repeat the position or unwind it without guessing.`,
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  ];
}

/** The live-token protocols, by market cap, for the dashboard's Live view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** How many protocols the exclusions set aside, and why. */
export function setAsideCounts(snapshot: Snapshot): SetAside {
  const out: SetAside = { exchanges: 0, wrapped_or_bridged: 0, staked: 0, versioned: 0, has_token: 0 };
  for (const p of snapshot.protocols) {
    if (!isPreToken(p)) {
      out.has_token++;
      continue;
    }
    const r = setAsideReason(p);
    if (r === 'exchange') out.exchanges++;
    else if (r !== null) out[r]++;
  }
  return out;
}

/** A board row's compact form for data.js. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    category_multiple: row.model.category_multiple,
    growth_factor: row.model.growth_factor,
    age_factor: row.model.age_factor,
    chain_factor: row.model.chain_factor,
    farm_steps: row.farm_steps,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot);
  const live = liveRows(snapshot);
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model: MODEL,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    watchlist_slugs: [...snapshot.watchlist],
    board_size: board.length,
    live_size: live.length,
    set_aside: setAsideCounts(snapshot),
    rows: board.map(radarRow),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) return `${r.slug} has a farm step of ${t.length} characters`;
    }
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
