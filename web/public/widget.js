// Stocker — iOS home-screen widget for Scriptable (https://scriptable.app)
//
// Setup:
//   1. Install Scriptable from the App Store.
//   2. Copy this script from your own Stocker install: Settings -> Copy widget
//      script. That button rewrites BASE below to your deployment's URL. If you
//      copy the file straight from the repo instead, set BASE by hand.
//   3. New script in Scriptable, paste it in, name it "Stocker".
//   4. Run it once inside Scriptable — it asks for your APP_TOKEN and stores it
//      in the iOS Keychain, so the token never lives in this file.
//   5. Home screen -> long-press -> + -> Scriptable -> pick a size -> place it,
//      then long-press the widget -> Edit Widget -> Script: Stocker.
//
// Widget parameter (long-press the widget -> Edit Widget -> Parameter):
//   (empty)   holdings ranked by position size
//   movers    holdings ranked by today's biggest move, up or down
//
// Supports small, medium and large home-screen widgets plus the rectangular
// lock-screen widget.

// Your deployment's origin, no trailing slash. Settings -> Copy widget script
// substitutes this line automatically; only edit it if you copied from the repo.
const BASE = "https://stocker.YOUR-SUBDOMAIN.workers.dev";
const TOKEN_KEY = "stocker_token";

// Quotes refresh every 15 min while the US market is open. Anything older than
// this is last session's number, not a live one, and is shown as such.
const STALE_AFTER_MIN = 30;

const C = {
  bgTop: new Color("#151D2A"),
  bgBottom: new Color("#0B1119"),
  text: new Color("#E8EDF4"),
  muted: new Color("#7F8B9E"),
  up: new Color("#22C55E"),
  down: new Color("#F2555A"),
  // Faded variants: same hue, clearly not live.
  upStale: new Color("#22C55E", 0.5),
  downStale: new Color("#F2555A", 0.5),
};

// ---------- token ----------

async function getToken() {
  if (Keychain.contains(TOKEN_KEY)) return Keychain.get(TOKEN_KEY);
  if (config.runsInWidget) return null; // can't prompt from a widget
  const a = new Alert();
  a.title = "Stocker";
  a.message = "Paste your APP_TOKEN. It is stored in the iOS Keychain on this device only.";
  a.addSecureTextField("APP_TOKEN", "");
  a.addAction("Save");
  a.addCancelAction("Cancel");
  if ((await a.present()) === -1) return null;
  const v = a.textFieldValue(0).trim();
  if (v) Keychain.set(TOKEN_KEY, v);
  return v || null;
}

// ---------- data ----------

async function getJSON(path, token) {
  const req = new Request(BASE + path);
  req.headers = { Authorization: "Bearer " + token };
  req.timeoutInterval = 15;
  const res = await req.loadJSON();
  if (req.response.statusCode !== 200) {
    throw new Error(req.response.statusCode === 401 ? "Bad token" : "HTTP " + req.response.statusCode);
  }
  return res;
}

// ---------- formatting ----------

function money(n, decimals = 0) {
  const v = Math.abs(n).toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  return (n < 0 ? "-$" : "$") + v;
}

function signed(n, decimals = 0) {
  return (n >= 0 ? "+" : "") + money(n, decimals);
}

function pct(n) {
  return (n >= 0 ? "+" : "") + n.toFixed(2) + "%";
}

function minutesSince(iso) {
  if (!iso) return Infinity;
  return (Date.now() - new Date(iso).getTime()) / 60000;
}

/** Colour for a number, faded when the underlying quote is not live. */
function tone(n, stale) {
  if (stale) return n >= 0 ? C.upStale : C.downStale;
  return n >= 0 ? C.up : C.down;
}

function fmt(date, pattern) {
  const df = new DateFormatter();
  df.dateFormat = pattern;
  return df.string(date);
}

/**
 * Footer text. Live quotes show the update time; anything older says so
 * explicitly, because a frozen day-change otherwise reads as a live one.
 */
function freshnessLabel(iso, stale) {
  if (!iso) return "no prices yet";
  const d = new Date(iso);
  if (!stale) return "updated " + fmt(d, "HH:mm");
  const sameDay = fmt(d, "yyyy-MM-dd") === fmt(new Date(), "yyyy-MM-dd");
  return "closed · " + fmt(d, sameDay ? "HH:mm" : "EEE HH:mm");
}

// ---------- sparkline ----------

/**
 * Portfolio value drawn as a faded area chart across the bottom of the widget,
 * used as the background image so it costs no layout space. Returns null when
 * there aren't yet two snapshots to draw a line between.
 */
function chartBackground(family, history) {
  // Point sizes; respectScreenScale renders them at the device's pixel density.
  const dims = {
    small: [170, 170],
    medium: [360, 169],
    large: [360, 382],
  };
  const [W, H] = dims[family] || dims.medium;

  const ctx = new DrawContext();
  ctx.size = new Size(W, H);
  ctx.opaque = true;
  ctx.respectScreenScale = true;

  // Background gradient, faked with horizontal bands (DrawContext has no
  // gradient primitive).
  const bands = 64;
  for (let i = 0; i < bands; i++) {
    const f = i / (bands - 1);
    ctx.setFillColor(
      new Color(
        rgbHex(
          Math.round(0x15 + (0x0b - 0x15) * f),
          Math.round(0x1d + (0x11 - 0x1d) * f),
          Math.round(0x2a + (0x19 - 0x2a) * f),
        ),
      ),
    );
    ctx.fillRect(new Rect(0, (H / bands) * i, W, H / bands + 1));
  }

  const points = (history || []).map((h) => h.total_value).filter((v) => typeof v === "number");
  if (points.length < 2) return ctx.getImage();

  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const chartH = H * 0.42;
  const top = H - chartH;
  const x = (i) => (i / (points.length - 1)) * W;
  const y = (v) => top + (1 - (v - min) / span) * (chartH * 0.82) + chartH * 0.09;

  const rising = points[points.length - 1] >= points[0];
  const hex = rising ? "#22C55E" : "#F2555A";

  const area = new Path();
  area.move(new Point(0, H));
  for (let i = 0; i < points.length; i++) area.addLine(new Point(x(i), y(points[i])));
  area.addLine(new Point(W, H));
  area.closeSubpath();
  ctx.setFillColor(new Color(hex, 0.16));
  ctx.addPath(area);
  ctx.fillPath();

  const line = new Path();
  line.move(new Point(0, y(points[0])));
  for (let i = 1; i < points.length; i++) line.addLine(new Point(x(i), y(points[i])));
  ctx.setStrokeColor(new Color(hex, 0.55));
  ctx.setLineWidth(family === "large" ? 2.5 : 2);
  ctx.addPath(line);
  ctx.strokePath();

  return ctx.getImage();
}

function rgbHex(r, g, b) {
  const h = (n) => n.toString(16).padStart(2, "0");
  return "#" + h(r) + h(g) + h(b);
}

// ---------- widget pieces ----------

function newWidget(family) {
  const w = new ListWidget();
  if (family.startsWith("accessory")) {
    // Lock-screen widgets are rendered by the system with its own vibrancy;
    // giving them a background just muddies them.
    w.setPadding(2, 2, 2, 2);
  } else {
    w.setPadding(14, 14, 14, 14);
  }
  // Nudge iOS to refresh roughly in step with the 15-minute price cron.
  w.refreshAfterDate = new Date(Date.now() + 15 * 60 * 1000);
  return w;
}

function plainBackground(w) {
  const g = new LinearGradient();
  g.colors = [C.bgTop, C.bgBottom];
  g.locations = [0, 1];
  w.backgroundGradient = g;
}

function addLine(parent, text, font, color) {
  const t = parent.addText(text);
  t.font = font;
  t.textColor = color;
  t.lineLimit = 1;
  return t;
}

function totalsBlock(stack, s, stale, opts = {}) {
  addLine(stack, "STOCKER", Font.semiboldSystemFont(9), C.muted);
  stack.addSpacer(opts.gap ?? 4);
  addLine(stack, money(s.total_value), Font.boldRoundedSystemFont(opts.big ?? 22), C.text);
  stack.addSpacer(2);
  addLine(
    stack,
    `${signed(s.day_change)} (${pct(s.day_change_pct)}) ${stale ? "at close" : "today"}`,
    Font.mediumSystemFont(opts.small ?? 11),
    tone(s.day_change, stale),
  );
  stack.addSpacer(1);
  addLine(
    stack,
    `${signed(s.unrealized_pl)} (${pct(s.unrealized_pl_pct)}) total`,
    Font.mediumSystemFont(opts.small ?? 11),
    tone(s.unrealized_pl, false),
  );
}

// A label on the left, a value pushed to the right. Needs a stack with a
// defined width to spread against.
function statRow(stack, label, value, color, size = 10) {
  const row = stack.addStack();
  row.layoutHorizontally();
  addLine(row, label, Font.regularSystemFont(size), C.muted);
  row.addSpacer();
  addLine(row, value, Font.mediumSystemFont(size), color);
  stack.addSpacer(3);
}

function statsBlock(stack, s, size = 10) {
  statRow(stack, "Cost", money(s.total_cost), C.muted, size);
  statRow(
    stack,
    "Dividends",
    signed(s.dividend_income, 2),
    s.dividend_income > 0 ? C.up : C.muted,
    size,
  );
  statRow(stack, "Realized", signed(s.realized_pl), s.realized_pl ? tone(s.realized_pl, false) : C.muted, size);
}

/** Size-ranked by default; `movers` ranks by today's biggest swing either way. */
function rank(positions, mode) {
  const held = positions.filter((p) => p.shares_held > 0);
  if (mode === "movers") {
    return held
      .filter((p) => p.current_price != null)
      .sort((a, b) => Math.abs(b.day_change_pct) - Math.abs(a.day_change_pct));
  }
  return held.sort((a, b) => b.market_value - a.market_value);
}

function positionRows(stack, positions, count, stale, opts = {}) {
  const size = opts.size ?? 11;
  const gap = opts.gap ?? 5;

  for (const p of positions.slice(0, count)) {
    const row = stack.addStack();
    row.layoutHorizontally();
    row.centerAlignContent();

    addLine(row, p.ticker, Font.semiboldSystemFont(size), C.text);
    row.addSpacer();

    if (p.current_price == null) {
      addLine(row, "—", Font.mediumSystemFont(size), C.muted);
    } else {
      addLine(row, money(p.market_value), Font.regularSystemFont(size), C.muted);
      row.addSpacer(6);
      const d = row.addText(pct(p.day_change_pct));
      d.font = Font.mediumSystemFont(size);
      d.textColor = tone(p.day_change, stale);
      d.lineLimit = 1;
      d.minimumScaleFactor = 0.8;
    }
    // Tapping a ticker opens that stock's detail page. Per-element links only
    // work on medium and large widgets; small ones fall back to widget.url.
    row.url = `${BASE}/stock/${encodeURIComponent(p.ticker)}`;
    stack.addSpacer(gap);
  }
}

function buildSmall(w, s, ranked, stale) {
  totalsBlock(w, s, stale);
  w.addSpacer(7);
  positionRows(w, ranked, 3, stale, { size: 10, gap: 3 });
  w.addSpacer();
  addLine(w, freshnessLabel(s.updated_at, stale), Font.systemFont(8), C.muted);
}

function buildMedium(w, s, ranked, stale, mode) {
  const main = w.addStack();
  main.layoutHorizontally();
  main.topAlignContent();

  const left = main.addStack();
  left.layoutVertically();
  left.size = new Size(150, 0);
  totalsBlock(left, s, stale);
  left.addSpacer(6);
  statsBlock(left, s);
  left.addSpacer();
  addLine(left, freshnessLabel(s.updated_at, stale), Font.systemFont(8), C.muted);

  main.addSpacer();

  const right = main.addStack();
  right.layoutVertically();
  right.size = new Size(152, 0);
  addLine(right, mode === "movers" ? "MOVERS" : "HOLDINGS", Font.semiboldSystemFont(8), C.muted);
  right.addSpacer(4);
  positionRows(right, ranked, 6, stale, { size: 11, gap: 3.5 });
  right.addSpacer();
}

function buildLarge(w, s, ranked, stale, mode) {
  const head = w.addStack();
  head.layoutHorizontally();
  head.topAlignContent();

  const left = head.addStack();
  left.layoutVertically();
  left.size = new Size(180, 0);
  totalsBlock(left, s, stale, { big: 30, small: 13, gap: 6 });

  head.addSpacer();

  const right = head.addStack();
  right.layoutVertically();
  right.size = new Size(150, 0);
  statsBlock(right, s, 12);
  statRow(right, "Positions", String(ranked.length), C.muted, 12);

  w.addSpacer(12);
  addLine(w, mode === "movers" ? "MOVERS" : "HOLDINGS", Font.semiboldSystemFont(9), C.muted);
  w.addSpacer(5);
  positionRows(w, ranked, 12, stale, { size: 13, gap: 6 });
  w.addSpacer();
  addLine(w, freshnessLabel(s.updated_at, stale), Font.systemFont(9), C.muted);
}

function buildLockScreen(w, s, stale) {
  addLine(w, money(s.total_value), Font.boldSystemFont(15), Color.white());
  addLine(
    w,
    `${signed(s.day_change)} (${pct(s.day_change_pct)})${stale ? " close" : ""}`,
    Font.mediumSystemFont(12),
    Color.white(),
  );
}

function buildError(w, message) {
  addLine(w, "STOCKER", Font.semiboldSystemFont(9), C.muted);
  w.addSpacer(6);
  const t = w.addText(message);
  t.font = Font.mediumSystemFont(12);
  t.textColor = C.down;
  t.lineLimit = 3;
}

// ---------- main ----------

const family = config.widgetFamily || "medium";
const mode = (args.widgetParameter || "").trim().toLowerCase();
const widget = newWidget(family);
const isAccessory = family.startsWith("accessory");

try {
  const token = await getToken();
  if (!token) throw new Error("Open this script in Scriptable to add your token");

  const [summary, positions, history] = await Promise.all([
    getJSON("/api/summary", token),
    isAccessory ? Promise.resolve([]) : getJSON("/api/positions", token),
    isAccessory ? Promise.resolve([]) : getJSON("/api/history?days=30", token).catch(() => []),
  ]);

  const stale = minutesSince(summary.updated_at) > STALE_AFTER_MIN;
  const ranked = rank(positions, mode);

  if (!isAccessory) {
    const bg = chartBackground(family, history);
    if (bg) widget.backgroundImage = bg;
    else plainBackground(widget);
  }

  if (family === "small") buildSmall(widget, summary, ranked, stale);
  else if (family === "large") buildLarge(widget, summary, ranked, stale, mode);
  else if (isAccessory) buildLockScreen(widget, summary, stale);
  else buildMedium(widget, summary, ranked, stale, mode);

  widget.url = BASE; // tapping the widget opens the app
} catch (e) {
  const msg = String(e.message || e);
  if (!isAccessory) plainBackground(widget);
  buildError(widget, msg);
  if (msg === "Bad token" && Keychain.contains(TOKEN_KEY)) Keychain.remove(TOKEN_KEY);
}

if (config.runsInWidget) Script.setWidget(widget);
else if (family === "small") await widget.presentSmall();
else if (family === "large") await widget.presentLarge();
else await widget.presentMedium();

Script.complete();
