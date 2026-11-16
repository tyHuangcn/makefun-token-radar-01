// Launch Radar dashboard: renders window.RADAR (written by main.ts) with no
// network. Views: the board (#/), a protocol detail (#/protocol/<slug>), and a
// filtered board (#/filter/<category> or #/filter/watchlist).
(function () {
  'use strict';
  var R = window.RADAR;
  if (!R) { document.body.innerHTML = '<p class="empty">No radar data: data.js did not load.</p>'; return; }

  var $ = function (id) { return document.getElementById(id); };
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function money(n) {
    if (n == null) return '—';
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
    return '$' + n;
  }
  function pct(n) {
    if (n == null) return '<span class="flat">—</span>';
    var c = n > 0 ? 'up' : n < 0 ? 'down' : 'flat';
    return '<span class="' + c + '">' + (n > 0 ? '+' : '') + n.toFixed(1) + '%</span>';
  }
  function ageFmt(d) {
    if (d == null) return '—';
    return d >= 365 ? (d / 365).toFixed(1) + 'y' : d + 'd';
  }

  var maxImplied = R.rows.length ? R.rows[0].implied_value_usd : 1;
  var totalImplied = R.rows.reduce(function (s, r) { return s + r.implied_value_usd; }, 0);
  var totalTvl = R.rows.reduce(function (s, r) { return s + r.tvl_usd; }, 0);
  var watchRows = R.rows.filter(function (r) { return R.watchlist_slugs && R.watchlist_slugs.indexOf(r.slug) >= 0; }).length;

  // ---- header + KPIs -------------------------------------------------------
  $('snap-meta').textContent = 'Snapshot ' + R.as_of + ' · floor $' + (R.floor_usd / 1e6) + 'M TVL · model ' + R.model_version;
  var kpis = [
    [R.rows.length, 'ranked launch candidates'],
    [R.watchlist_size, 'on the house watchlist'],
    [money(totalImplied), 'total implied value'],
    [money(totalTvl), 'pre-token TVL ranked'],
  ];
  $('kpis').innerHTML = kpis.map(function (k) { return '<div class="kpi"><b>' + k[0] + '</b><span>' + k[1] + '</span></div>'; }).join('');

  // ---- filter controls -----------------------------------------------------
  var cats = [], chains = [];
  R.rows.forEach(function (r) {
    if (r.category && cats.indexOf(r.category) < 0) cats.push(r.category);
    r.chains.forEach(function (c) { if (chains.indexOf(c) < 0) chains.push(c); });
  });
  cats.sort(); chains.sort();
  $('cat').innerHTML += cats.map(function (c) { return '<option>' + esc(c) + '</option>'; }).join('');
  $('chain').innerHTML += chains.map(function (c) { return '<option>' + esc(c) + '</option>'; }).join('');

  var state = { q: '', cat: '', chain: '', scope: 'all', sort: 'rank', dir: 1, shown: 50 };
  var SORTS = {
    rank: function (a, b) { return a.rank - b.rank; },
    implied: function (a, b) { return b.implied_value_usd - a.implied_value_usd; },
    tvl: function (a, b) { return b.tvl_usd - a.tvl_usd; },
    change: function (a, b) { return (b.change_7d == null ? -1e9 : b.change_7d) - (a.change_7d == null ? -1e9 : a.change_7d); },
    age: function (a, b) { return (b.age_days == null ? -1 : b.age_days) - (a.age_days == null ? -1 : a.age_days); },
    name: function (a, b) { return a.name < b.name ? -1 : 1; },
    category: function (a, b) { return (a.category || '') < (b.category || '') ? -1 : 1; },
    chains: function (a, b) { return (a.chains[0] || '') < (b.chains[0] || '') ? -1 : 1; },
  };

  function filtered() {
    var q = state.q.trim().toLowerCase();
    var list = R.rows.filter(function (r) {
      if (state.scope === 'watchlist' && !(R.watchlist_slugs && R.watchlist_slugs.indexOf(r.slug) >= 0)) return false;
      if (state.scope === 'top100' && r.rank > 100) return false;
      if (state.cat && r.category !== state.cat) return false;
      if (state.chain && r.chains.indexOf(state.chain) < 0) return false;
      if (q && r.name.toLowerCase().indexOf(q) < 0 && r.slug.toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
    var fn = SORTS[state.sort] || SORTS.rank;
    list.sort(function (a, b) { return fn(a, b) * (state.sort === 'rank' ? 1 : state.dir); });
    return list;
  }

  function rowHtml(r) {
    var wl = R.watchlist_slugs && R.watchlist_slugs.indexOf(r.slug) >= 0;
    var w = Math.max(2, Math.round((r.implied_value_usd / maxImplied) * 100));
    return '<tr><td class="num">' + r.rank + '</td>' +
      '<td class="name"><b>' + esc(r.name) + '</b> ' + (wl ? '<span class="pill watch">WATCHLIST</span> ' : '') +
      '<span class="pill pre">PRE-TOKEN</span><br><span class="slug">' + esc(r.slug) + '</span></td>' +
      '<td><span class="cat">' + esc(r.category || '—') + '</span></td>' +
      '<td class="chains">' + esc(r.chains.slice(0, 2).join(', ')) + (r.chains.length > 2 ? ' +' + (r.chains.length - 2) : '') + '</td>' +
      '<td class="num">' + money(r.tvl_usd) + '</td>' +
      '<td class="num">' + pct(r.change_7d) + '</td>' +
      '<td class="num">' + ageFmt(r.age_days) + '</td>' +
      '<td class="num"><span class="val">' + money(r.implied_value_usd) + '</span><div class="bar"><i style="width:' + w + '%"></i></div></td>' +
      '<td><a href="#/protocol/' + encodeURIComponent(r.slug) + '">Detail →</a></td></tr>';
  }

  function renderBoard() {
    var list = filtered();
    var show = list.slice(0, state.shown);
    $('rows').innerHTML = show.length ? show.map(rowHtml).join('') : '<tr><td colspan="9" class="empty">No protocol matches this filter.</td></tr>';
    $('count').textContent = 'Showing ' + show.length + ' of ' + list.length + ' matching rows · ' + R.rows.length + ' ranked in all · ' + R.watchlist_size + ' on the watchlist';
    $('more').style.display = list.length > state.shown ? '' : 'none';
  }

  // ---- live view -----------------------------------------------------------
  $('live-rows').innerHTML = R.live.map(function (p) {
    return '<tr><td class="name"><b>' + esc(p.name) + '</b><br><span class="slug">' + esc(p.slug) + '</span></td>' +
      '<td><span class="cat">' + esc(p.category || '—') + '</span></td>' +
      '<td class="num">' + money(p.tvl_usd) + '</td>' +
      '<td class="num">' + money(p.mcap_usd) + '</td>' +
      '<td class="num">' + pct(p.change_7d) + '</td></tr>';
  }).join('');

  // ---- model panel ---------------------------------------------------------
  var m = R.model;
  $('model-grid').innerHTML = [
    ['<b>Category multiple</b>', 'Dexs, derivatives, yield and prediction markets ×' + m.category_high + ' · lending, CDP, RWA, curators and allocators ×' + m.category_mid + ' · everything else ×' + m.category_default + ' per dollar of TVL.'],
    ['<b>Growth factor</b>', 'From the 7-day TVL change, clamped to ' + m.growth_floor + '%…+' + m.growth_cap + '%. Rises count ×' + m.growth_up_weight + ', falls ×' + m.growth_down_weight + ': a +100% week is worth 1.60×, a −50% week 0.60×.'],
    ['<b>Age factor</b>', 'A patience curve: under ' + m.age_young_days + ' days it ramps ' + m.age_young_floor + ' → 1.00; to ' + m.age_peak_days + ' days it climbs to ' + m.age_peak + '; past that it fades back to ' + m.age_decay_floor + '. Unknown age: ' + m.age_unknown + '.'],
    ['<b>Chain factor</b>', '1 + ' + m.chain_step + ' per extra chain, capped at ' + m.chain_max_extra + ' extra chains: distribution is worth something, but not much.'],
  ].map(function (x) { return '<div>' + x[0] + '<br>' + x[1] + '</div>'; }).join('');

  // ---- detail view ---------------------------------------------------------
  function renderDetail(slug) {
    var r = null;
    for (var i = 0; i < R.rows.length; i++) if (R.rows[i].slug === slug) { r = R.rows[i]; break; }
    if (!r) { $('detail').innerHTML = '<p class="empty">No ranked protocol with that slug.</p>'; return; }
    var wl = R.watchlist_slugs && R.watchlist_slugs.indexOf(r.slug) >= 0;
    var base = r.tvl_usd * r.category_multiple;
    var afterGrowth = base * r.growth_factor;
    var afterAge = afterGrowth * r.age_factor;
    // Unrounded intermediates: the displayed values multiply out to the
    // implied value; money() rounds only for display.
    var steps = r.farm_steps.map(function (s) {
      var cut = s.indexOf(' Cost: ');
      var main = cut >= 0 ? s.slice(0, cut) : s;
      var tail = cut >= 0 ? s.slice(cut + 1) : '';
      return '<li>' + esc(main) + (tail ? '<br><span class="cost">' + esc(tail) + '</span>' : '') + '</li>';
    }).join('');
    var chainLabel = r.chains.slice(0, 3).join(', ') + (r.chains.length > 3 ? ' +' + (r.chains.length - 3) + ' more' : '');
    $('detail').innerHTML =
      '<div class="detail-head"><div><h1>#' + r.rank + ' · ' + esc(r.name) + '</h1>' +
      '<div class="legend">' + esc(r.slug) + ' · <span class="cat">' + esc(r.category || '—') + '</span> · ' + esc(chainLabel) +
      (wl ? ' · <span class="pill watch">WATCHLIST</span>' : '') + ' <span class="pill pre">PRE-TOKEN</span></div></div>' +
      '<div><span class="val" style="font-size:22px">' + money(r.implied_value_usd) + '</span><br><span class="sub">implied launch value</span></div></div>' +
      '<div class="stats">' +
      '<div class="stat"><b>' + money(r.tvl_usd) + '</b><span>TVL</span></div>' +
      '<div class="stat"><b>' + (r.change_7d == null ? '—' : (r.change_7d > 0 ? '+' : '') + r.change_7d.toFixed(1) + '%') + '</b><span>7-day change</span></div>' +
      '<div class="stat"><b>' + ageFmt(r.age_days) + '</b><span>tracked since ' + esc(r.listed_at || 'unknown') + '</span></div>' +
      '<div class="stat"><b>' + r.farm_steps.length + ' steps</b><span>farm plan</span></div></div>' +
      '<h2>Why it ranks here</h2><table class="factors"><tbody>' +
      '<tr><td>TVL × category multiple (' + r.category_multiple + ')</td><td class="num">' + money(base) + '</td></tr>' +
      '<tr><td>Growth factor (' + r.growth_factor.toFixed(2) + '×)</td><td class="num">' + money(afterGrowth) + '</td></tr>' +
      '<tr><td>Age factor (' + r.age_factor.toFixed(2) + '×)</td><td class="num">' + money(afterAge) + '</td></tr>' +
      '<tr><td>Chain factor (' + r.chain_factor.toFixed(2) + '×, ' + r.chains.length + ' chain' + (r.chains.length === 1 ? '' : 's') + ')</td><td class="num">' + money(r.implied_value_usd) + '</td></tr>' +
      '</tbody></table>' +
      '<h2>Farm plan</h2><ol class="farm">' + steps + '</ol>' +
      '<p class="note">Implied value is this entry\'s own claim from the snapshot\'s figures. It does not predict whether or when ' + esc(r.name) + ' issues a token.</p>';
  }

  // ---- events + routing ----------------------------------------------------
  function bind(id, ev, fn) { $(id).addEventListener(ev, fn); }
  bind('q', 'input', function (e) { state.q = e.target.value; state.shown = 50; renderBoard(); });
  bind('cat', 'change', function (e) { state.cat = e.target.value; state.shown = 50; renderBoard(); });
  bind('chain', 'change', function (e) { state.chain = e.target.value; state.shown = 50; renderBoard(); });
  bind('scope', 'change', function (e) { state.scope = e.target.value; state.shown = 50; renderBoard(); });
  bind('sort', 'change', function (e) { state.sort = e.target.value; state.shown = 50; renderBoard(); });
  bind('more', 'click', function () { state.shown += 50; renderBoard(); });
  bind('back', 'click', function () { location.hash = '#/'; });
  document.querySelectorAll('#board th').forEach(function (th) {
    th.addEventListener('click', function () {
      var k = th.getAttribute('data-k');
      if (state.sort === k) state.dir = -state.dir; else { state.sort = k; state.dir = 1; }
      state.shown = 50; renderBoard();
    });
  });

  function route() {
    var h = location.hash || '#/';
    var m1 = h.match(/^#\/protocol\/(.+)$/);
    var m2 = h.match(/^#\/filter\/(.+)$/);
    if (m1) {
      $('view-board').hidden = true; $('view-detail').hidden = false;
      renderDetail(decodeURIComponent(m1[1])); window.scrollTo(0, 0); return;
    }
    $('view-board').hidden = false; $('view-detail').hidden = true;
    if (m2) {
      var v = decodeURIComponent(m2[1]);
      if (v === 'watchlist') { state.scope = 'watchlist'; $('scope').value = 'watchlist'; }
      else { state.cat = v; $('cat').value = v; }
    }
    renderBoard();
  }
  window.addEventListener('hashchange', route);
  route();
})();
