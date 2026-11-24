/* Écart au vote national — Présidentielle 2022 (1er tour)
 * Choroplèthe par commune de France métropolitaine.
 * Données : Ministère de l'Intérieur (data.gouv.fr) ; contours : france-geojson (INSEE).
 */
(function () {
  'use strict';

  // ---------------------------------------------------------------- metadata
  // Ordre identique à celui du tableau `s` de chaque commune.
  var CANDIDATES = [
    { nom: 'ARTHAUD',        prenom: 'Nathalie',  label: 'Arthaud',        color: '#6E0E12' },
    { nom: 'ROUSSEL',        prenom: 'Fabien',    label: 'Roussel',        color: '#C1121F' },
    { nom: 'MACRON',         prenom: 'Emmanuel',  label: 'Macron',         color: '#EFC000' },
    { nom: 'LASSALLE',       prenom: 'Jean',      label: 'Lassalle',       color: '#E8801A' },
    { nom: 'LE PEN',         prenom: 'Marine',    label: 'Le Pen',         color: '#1B3A6B' },
    { nom: 'ZEMMOUR',        prenom: 'Éric',      label: 'Zemmour',        color: '#4A4A4A' },
    { nom: 'MÉLENCHON',      prenom: 'Jean-Luc',  label: 'Mélenchon',      color: '#C9462C' },
    { nom: 'HIDALGO',        prenom: 'Anne',      label: 'Hidalgo',        color: '#E5679B' },
    { nom: 'JADOT',          prenom: 'Yannick',   label: 'Jadot',          color: '#2E8B57' },
    { nom: 'PÉCRESSE',       prenom: 'Valérie',   label: 'Pécresse',       color: '#3C8DBC' },
    { nom: 'POUTOU',         prenom: 'Philippe',  label: 'Poutou',         color: '#B0261E' },
    { nom: 'DUPONT-AIGNAN',  prenom: 'Nicolas',   label: 'Dupont-Aignan',  color: '#5C6B7A' }
  ];

  // Résultats nationaux officiels (France entière) — Conseil constitutionnel, 13/04/2022.
  var NAT_OFFICIAL = [0.56, 2.28, 27.85, 3.13, 23.15, 7.07, 21.95, 1.74, 4.63, 4.78, 0.76, 2.06];
  // Agrégat du jeu de données (métropole + outre-mer, hors Français de l'étranger).
  var NAT_DATASET  = [0.57, 2.31, 27.60, 3.16, 23.41, 7.05, 21.95, 1.74, 4.58, 4.79, 0.77, 2.07];

  var ABS_PALETTE    = ['#fff7ec', '#fee8c8', '#fdd49e', '#fdbb84', '#fc8d59', '#ef6548', '#d7301f', '#990000'];
  var SIGNED_PALETTE = ['#0570b0', '#3690c0', '#74a9cf', '#bdc9e1', '#f7f7f7', '#fddbc7', '#f4a582', '#d6604d', '#b2182b'];

  var FRANCE_BOUNDS = [[-5.4, 41.2], [9.9, 51.3]];

  // ---------------------------------------------------------------- state
  var state = { candidate: 2, metric: 'abs', reference: 'official' }; // défaut : Macron
  var payload = null;
  var map = null;
  var stats = null;      // stats par candidat pour la référence courante
  var hoveredId = null;
  var labelByCode = null;
  var featureByCode = null;

  // ---------------------------------------------------------------- helpers
  function $(id) { return document.getElementById(id); }

  function natTenths() {
    var nat = state.reference === 'official' ? NAT_OFFICIAL : NAT_DATASET;
    return nat.map(function (v) { return v * 10; });
  }

  function fmt(v, d) { return v.toFixed(d === undefined ? 1 : d).replace('.', ','); }

  function percentile(sorted, p) {
    if (!sorted.length) return 0;
    var i = (p / 100) * (sorted.length - 1);
    var lo = Math.floor(i), hi = Math.ceil(i);
    if (lo === hi) return sorted[lo];
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
  }

  function hexToRgb(h) {
    h = h.replace('#', '');
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  function paletteColor(palette, t) {
    t = Math.max(0, Math.min(1, t));
    var x = t * (palette.length - 1);
    var i = Math.min(palette.length - 2, Math.floor(x));
    var f = x - i;
    var a = hexToRgb(palette[i]), b = hexToRgb(palette[i + 1]);
    return 'rgb(' + Math.round(a[0] + (b[0] - a[0]) * f) + ',' +
                    Math.round(a[1] + (b[1] - a[1]) * f) + ',' +
                    Math.round(a[2] + (b[2] - a[2]) * f) + ')';
  }

  // ---------------------------------------------------------------- data loading
  function b64ToBytes(b64) {
    var bin = atob(b64), len = bin.length, bytes = new Uint8Array(len);
    for (var i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }
  function gunzipToString(bytes) {
    var ds = new DecompressionStream('gzip');
    var stream = new Blob([bytes]).stream().pipeThrough(ds);
    return new Response(stream).text();
  }

  // ---------------------------------------------------------------- stats
  function computeStats() {
    var feats = payload.communes.features;
    var n = feats.length, nc = CANDIDATES.length;
    var nt = natTenths();
    var signed = [];
    for (var c = 0; c < nc; c++) signed.push(new Float32Array(n));

    for (var i = 0; i < n; i++) {
      var s = feats[i].properties.s;
      for (var c2 = 0; c2 < nc; c2++) signed[c2][i] = s[c2] - nt[c2];
    }

    var out = [];
    for (var c3 = 0; c3 < nc; c3++) {
      var arr = signed[c3];
      var abs = new Float32Array(n), sum = 0, mx = 0, near = 0;
      for (var k = 0; k < n; k++) {
        var v = Math.abs(arr[k]);
        abs[k] = v; sum += v;
        if (v > mx) mx = v;
        if (v <= 20) near++;
      }
      var absSorted = Array.prototype.slice.call(abs).sort(function (a, b) { return a - b; });
      var signedSorted = Array.prototype.slice.call(arr).sort(function (a, b) { return a - b; });
      out.push({
        median: percentile(absSorted, 50),
        mean: sum / n,
        max: mx,
        near: near / n * 100,
        p99abs: percentile(absSorted, 99),
        p1s: percentile(signedSorted, 1),
        p99s: percentile(signedSorted, 99),
        absSorted: absSorted
      });
    }

    // ---- écart global : distance euclidienne du profil des 12 candidats ----
    // sqrt( somme_c (score_commune_c - score_national_c)^2 ), en points de %.
    var g = new Float32Array(n), gsum = 0, gmx = 0, gnear = 0, rank = [];
    for (var j = 0; j < n; j++) {
      var ss = feats[j].properties.s, acc = 0;
      for (var c4 = 0; c4 < nc; c4++) {
        var dd = (ss[c4] - nt[c4]) / 10;
        acc += dd * dd;
      }
      var gv = Math.sqrt(acc);
      g[j] = gv; gsum += gv;
      if (gv > gmx) gmx = gv;
      if (gv <= 5) gnear++;
      if (feats[j].properties.e >= 1000) {
        rank.push({ code: feats[j].properties.c, nom: feats[j].properties.n,
                    dept: feats[j].properties.c.slice(0, 2), v: gv });
      }
    }
    var gSorted = Array.prototype.slice.call(g).sort(function (a, b) { return a - b; });
    rank.sort(function (a, b) { return a.v - b.v; });

    return {
      cand: out,
      global: {
        median: percentile(gSorted, 50),
        mean: gsum / n,
        max: gmx,
        near: gnear / n * 100,
        p99: percentile(gSorted, 99),
        sorted: gSorted,
        ranking: rank
      }
    };
  }

  // Domaine de l'échelle, exprimé dans l'unité de l'expression de couleur
  // (dixièmes de point pour abs/signé, points pour l'écart global).
  function domain() {
    if (state.metric === 'global') return Math.max(5, Math.ceil(stats.global.p99));
    var st = stats.cand[state.candidate];
    if (state.metric === 'abs') return Math.max(10, Math.ceil(st.p99abs / 5) * 5);
    var h = Math.max(Math.abs(st.p1s), Math.abs(st.p99s));
    return Math.max(10, Math.ceil(h / 5) * 5);
  }
  function unitDivisor() { return state.metric === 'global' ? 1 : 10; }

  // ---------------------------------------------------------------- colour expression
  function baseScoreExpr(idx) {
    return ['number', ['at', idx, ['array', 'number', ['get', 's']]]];
  }
  function globalExpr() {
    var nt = natTenths();
    var terms = [];
    for (var i = 0; i < CANDIDATES.length; i++) {
      var d = ['-', baseScoreExpr(i), nt[i]];
      terms.push(['*', d, d]);
    }
    return ['/', ['sqrt', ['+'].concat(terms)], 10];
  }
  function fillColorExpr() {
    var nt = natTenths();
    var dom = domain();
    var pal, lo, hi, expr;
    if (state.metric === 'global') {
      pal = ABS_PALETTE; lo = 0; hi = dom; expr = globalExpr();
    } else if (state.metric === 'abs') {
      pal = ABS_PALETTE; lo = 0; hi = dom;
      expr = ['abs', ['-', baseScoreExpr(state.candidate), nt[state.candidate]]];
    } else {
      pal = SIGNED_PALETTE; lo = -dom; hi = dom;
      expr = ['-', baseScoreExpr(state.candidate), nt[state.candidate]];
    }
    var stops = [];
    for (var i = 0; i < pal.length; i++) {
      stops.push(lo + (hi - lo) * i / (pal.length - 1));
      stops.push(pal[i]);
    }
    return ['interpolate', ['linear'], expr].concat(stops);
  }

  // ---------------------------------------------------------------- legend
  function renderLegend() {
    var div = unitDivisor();
    var dom = domain() / div; // en points
    var pal = state.metric === 'signed' ? SIGNED_PALETTE : ABS_PALETTE;
    $('legendBar').style.background = 'linear-gradient(90deg,' + pal.join(',') + ')';

    if (state.metric === 'global') {
      $('legendTitle').textContent = 'Écart global';
      $('legendMin').textContent = '0';
      $('legendMid').textContent = fmt(dom / 2) + ' pts';
      $('legendMax').textContent = '≥ ' + fmt(dom, 0) + ' pts';
      $('legendCap').innerHTML = 'Distance euclidienne entre le profil des 12 candidats dans la commune et le profil national : ' +
        '<b>√(Σ (score commune − score national)²)</b>. Valeur faible = commune proche de la moyenne nationale ; valeur élevée = commune atypique.';
    } else if (state.metric === 'abs') {
      $('legendTitle').textContent = 'Écart absolu';
      $('legendMin').textContent = '0';
      $('legendMid').textContent = fmt(dom / 2) + ' pts';
      $('legendMax').textContent = '≥ ' + fmt(dom) + ' pts';
      $('legendCap').innerHTML = 'Écart absolu entre le score de <b>' + CANDIDATES[state.candidate].label +
        '</b> dans la commune et son score national (' + fmt(state.reference === 'official' ? NAT_OFFICIAL[state.candidate] : NAT_DATASET[state.candidate], 2) +
        ' %). Couleur foncée = écart élevé.';
    } else {
      $('legendTitle').textContent = 'Écart signé';
      $('legendMin').textContent = '≤ −' + fmt(dom) + ' pts';
      $('legendMid').textContent = '0';
      $('legendMax').textContent = '≥ +' + fmt(dom) + ' pts';
      $('legendCap').innerHTML = 'Écart signé : <b>bleu</b> = score communal inférieur au score national, ' +
        '<b>rouge</b> = supérieur. Candidat : <b>' + CANDIDATES[state.candidate].label + '</b>.';
    }
  }

  // ---------------------------------------------------------------- info panel
  function renderInfo() {
    if (state.metric === 'global') {
      var g = stats.global;
      $('infoDot').style.background = '#334155';
      $('infoWho').textContent = 'Profil global — 12 candidats';
      $('infoNat').innerHTML = 'Distance euclidienne à la moyenne nationale';
      $('kMed').textContent = fmt(g.median, 1);
      $('kMean').textContent = fmt(g.mean, 1);
      $('kMax').textContent = fmt(g.max, 1);
      $('kNearLabel').textContent = '≤ 5 pts';
      $('kNear').textContent = fmt(g.near, 0);
      $('histCap').innerHTML = 'Répartition des communes selon l\'écart global au profil national, tronquée au 99<sup>e</sup> centile (' +
        fmt(g.p99, 1) + ' pts). Barre foncée = communes au-delà.';
      drawHist(g.sorted, domain(), 1);
    } else {
      var idx = state.candidate;
      var c = CANDIDATES[idx];
      var st = stats.cand[idx];
      var nat = state.reference === 'official' ? NAT_OFFICIAL[idx] : NAT_DATASET[idx];

      $('infoDot').style.background = c.color;
      $('infoWho').textContent = c.prenom + ' ' + c.nom;
      $('infoNat').innerHTML = 'Score national : <b>' + fmt(nat, 2) + ' %</b> des exprimés';

      $('kMed').textContent = fmt(st.median / 10);
      $('kMean').textContent = fmt(st.mean / 10);
      $('kMax').textContent = fmt(st.max / 10);
      $('kNearLabel').textContent = '≤ 2 pts';
      $('kNear').textContent = fmt(st.near, 0);
      $('histCap').innerHTML = 'Répartition des communes selon l\'écart au score national, tronquée au 99<sup>e</sup> centile (' +
        fmt(st.p99abs / 10) + ' pts). Barre foncée = communes au-delà.';
      drawHist(st.absSorted, domain(), 10);
    }
    renderRanking();
  }

  function renderRanking() {
    var block = $('rankBlock');
    if (state.metric !== 'global') { block.style.display = 'none'; return; }
    block.style.display = '';
    var r = stats.global.ranking;
    var k = Math.min(6, r.length);
    fillRank($('rankMost'), r.slice(0, k));
    fillRank($('rankLeast'), r.slice(r.length - k).reverse());
  }
  function fillRank(el, list) {
    el.innerHTML = list.map(function (o) {
      return '<div class="item" data-code="' + o.code + '">' +
        '<span class="nm">' + o.nom + '</span>' +
        '<span class="d">' + o.dept + '</span>' +
        '<span class="v">' + fmt(o.v, 1) + '</span></div>';
    }).join('');
    Array.prototype.forEach.call(el.querySelectorAll('.item'), function (it) {
      it.addEventListener('click', function () { flyToCommune(it.getAttribute('data-code')); });
    });
  }

  function drawHist(sorted, dmax, div) {
    var cv = $('hist'), ctx = cv.getContext('2d');
    var W = cv.width, H = cv.height, pad = 6;
    ctx.clearRect(0, 0, W, H);
    var nb = 40, bins = new Array(nb).fill(0), over = 0;
    for (var i = 0; i < sorted.length; i++) {
      var v = sorted[i];
      if (v >= dmax) { over++; continue; }
      var b = Math.floor(v / dmax * nb);
      if (b >= nb) b = nb - 1;
      bins[b]++;
    }
    bins[nb - 1] += over;
    var mx = Math.max.apply(null, bins) || 1;
    var bw = (W - pad * 2) / nb;
    for (var j = 0; j < nb; j++) {
      var h = (bins[j] / mx) * (H - pad * 2 - 14);
      var x = pad + j * bw, y = H - pad - h;
      ctx.fillStyle = paletteColor(ABS_PALETTE, (j + 0.5) / nb);
      ctx.fillRect(x + 0.6, y, bw - 1.2, h);
    }
    // axe
    ctx.fillStyle = 'rgba(90,102,117,.9)';
    ctx.font = '600 17px -apple-system,Segoe UI,Roboto,sans-serif';
    ctx.fillText('0', pad, H - 2);
    var lab = fmt(dmax / div, 1) + ' pts';
    ctx.textAlign = 'right';
    ctx.fillText(lab, W - pad, H - 2);
    ctx.textAlign = 'left';
  }

  // ---------------------------------------------------------------- apply styles
  function applyPaint() {
    if (!map || !map.getLayer('communes-fill')) return;
    map.setPaintProperty('communes-fill', 'fill-color', fillColorExpr());
  }

  function render() {
    renderLegend();
    renderInfo();
    applyPaint();
    $('candCard').classList.toggle('dim', state.metric === 'global');
    // active chip
    var chips = document.querySelectorAll('.chip');
    for (var i = 0; i < chips.length; i++) chips[i].classList.toggle('active', +chips[i].dataset.i === state.candidate);
  }

  // ---------------------------------------------------------------- build UI
  function buildUI() {
    // candidate chips
    var wrap = $('candButtons');
    CANDIDATES.forEach(function (c, i) {
      var b = document.createElement('button');
      b.className = 'chip' + (i === state.candidate ? ' active' : '');
      b.dataset.i = i;
      b.title = c.prenom + ' ' + c.nom;
      b.innerHTML = '<span class="dot" style="background:' + c.color + '"></span>' +
                    '<span class="nm">' + c.label + '</span>' +
                    '<span class="pct" data-pct="' + i + '"></span>';
      b.addEventListener('click', function () { state.candidate = i; render(); });
      wrap.appendChild(b);
    });

    document.querySelectorAll('#metricSeg button').forEach(function (b) {
      b.addEventListener('click', function () {
        state.metric = b.dataset.metric;
        document.querySelectorAll('#metricSeg button').forEach(function (x) { x.classList.toggle('active', x === b); });
        render();
      });
    });
    document.querySelectorAll('#refSeg button').forEach(function (b) {
      b.addEventListener('click', function () {
        state.reference = b.dataset.ref;
        document.querySelectorAll('#refSeg button').forEach(function (x) { x.classList.toggle('active', x === b); });
        stats = computeStats();
        updateChipPct();
        render();
      });
    });

    updateChipPct();

    $('sourceNote').innerHTML =
      'Source : Ministère de l\'Intérieur — résultats définitifs du 1<sup>er</sup> tour (data.gouv.fr). ' +
      'Contours communaux : france-geojson (INSEE). ' +
      'Périmètre : France métropolitaine (' + payload.communes.features.length.toLocaleString('fr-FR') +
      ' communes). Les communes d\'outre-mer et les Français de l\'étranger ne sont pas représentés. ' +
      'Référence nationale par défaut : résultats officiels France entière (Conseil constitutionnel).';
  }

  function updateChipPct() {
    var nat = state.reference === 'official' ? NAT_OFFICIAL : NAT_DATASET;
    CANDIDATES.forEach(function (c, i) {
      var el = document.querySelector('[data-pct="' + i + '"]');
      if (el) el.textContent = fmt(nat[i], 1) + '%';
    });
  }

  // ---------------------------------------------------------------- map
  function initMap() {
    map = new maplibregl.Map({
      container: 'map',
      style: {
        version: 8,
        sources: {
          communes: { type: 'geojson', data: payload.communes, promoteId: 'c' },
          deps: { type: 'geojson', data: payload.departements }
        },
        layers: [
          { id: 'bg', type: 'background', paint: { 'background-color': '#e9edf2' } },
          { id: 'communes-fill', type: 'fill', source: 'communes',
            paint: { 'fill-color': '#dfe4ea', 'fill-opacity': 1 } },
          { id: 'communes-line', type: 'line', source: 'communes',
            paint: {
              'line-color': 'rgba(255,255,255,.55)',
              'line-width': ['interpolate', ['linear'], ['zoom'], 5, 0, 8, 0.5, 12, 1],
              'line-opacity': ['interpolate', ['linear'], ['zoom'], 5, 0, 6.5, 0.6]
            } },
          { id: 'deps-line', type: 'line', source: 'deps',
            paint: {
              'line-color': 'rgba(28,36,48,.6)',
              'line-width': ['interpolate', ['linear'], ['zoom'], 5, 0.6, 10, 1.3]
            } },
          { id: 'hover-line', type: 'line', source: 'communes',
            paint: {
              'line-color': '#101820',
              'line-width': 1.8,
              'line-opacity': ['case', ['boolean', ['feature-state', 'hover'], false], 1, 0]
            } }
        ]
      },
      bounds: FRANCE_BOUNDS,
      fitBoundsOptions: { padding: 20 },
      maxBounds: [[-8, 39.5], [12.5, 53]],
      minZoom: 4,
      maxZoom: 13,
      attributionControl: false
    });

    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
    map.addControl(new maplibregl.AttributionControl({
      compact: true,
      customAttribution: 'Données : Ministère de l\'Intérieur · Contours : france-geojson'
    }));

    // Bouton « recentrer »
    var HomeControl = function () {};
    HomeControl.prototype.onAdd = function (m) {
      var c = document.createElement('div');
      c.className = 'maplibregl-ctrl maplibregl-ctrl-group';
      var b = document.createElement('button');
      b.type = 'button';
      b.title = 'Recentrer sur la France';
      b.setAttribute('aria-label', 'Recentrer sur la France');
      b.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#333" stroke-width="2" stroke-linejoin="round"><path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/></svg>';
      b.addEventListener('click', function () { m.fitBounds(FRANCE_BOUNDS, { padding: 20 }); });
      c.appendChild(b);
      return c;
    };
    HomeControl.prototype.onRemove = function () {};
    map.addControl(new HomeControl(), 'bottom-right');

    map.on('load', function () {
      map.fitBounds(FRANCE_BOUNDS, { padding: 24, animate: false });
      applyPaint();
      var el = $('loading');
      el.classList.add('hidden');
      setTimeout(function () { el.style.display = 'none'; }, 500);
    });

    map.on('mousemove', 'communes-fill', function (e) {
      if (!e.features.length) return;
      var f = e.features[0];
      var id = f.id;
      if (hoveredId !== null && hoveredId !== id) {
        map.setFeatureState({ source: 'communes', id: hoveredId }, { hover: false });
      }
      hoveredId = id;
      map.setFeatureState({ source: 'communes', id: id }, { hover: true });
      map.getCanvas().style.cursor = 'pointer';
      showTooltip(e, f.properties);
    });
    map.on('mouseleave', 'communes-fill', function () {
      if (hoveredId !== null) {
        map.setFeatureState({ source: 'communes', id: hoveredId }, { hover: false });
        hoveredId = null;
      }
      map.getCanvas().style.cursor = '';
      $('tooltip').style.opacity = 0;
    });
  }

  function showTooltip(e, p) {
    // MapLibre renvoie les propriétés de type tableau sérialisées en chaîne JSON.
    var s = p.s;
    if (typeof s === 'string') { try { s = JSON.parse(s); } catch (err) { s = []; } }
    var tip = $('tooltip');
    var dept = (labelByCode && labelByCode[p.c.slice(0, 2)]) || p.c.slice(0, 2);
    var head = '<div class="tt-name">' + p.n + '</div>' +
               '<div class="tt-dept">' + dept + ' · ' + (+p.e).toLocaleString('fr-FR') + ' exprimés</div>';

    if (state.metric === 'global') {
      var nat = state.reference === 'official' ? NAT_OFFICIAL : NAT_DATASET;
      var acc = 0, contrib = [];
      for (var i = 0; i < CANDIDATES.length; i++) {
        var sc = (s[i] != null ? s[i] : 0) / 10;
        var d = sc - nat[i];
        acc += d * d;
        contrib.push({ i: i, a: Math.abs(d), d: d });
      }
      contrib.sort(function (x, y) { return y.a - x.a; });
      var top = contrib.slice(0, 3).map(function (o) {
        return '<div class="row"><span class="lbl">' + CANDIDATES[o.i].label + '</span><span class="val">' +
          (o.d >= 0 ? '+' : '−') + fmt(o.a, 1) + '</span></div>';
      }).join('');
      tip.innerHTML = head +
        '<div class="row diff"><span class="lbl">Écart global</span><span class="val">' + fmt(Math.sqrt(acc), 1) + ' pts</span></div>' +
        '<div class="row" style="margin-top:4px"><span class="lbl" style="font-weight:700;color:#1c2430">Principaux écarts</span><span class="val"></span></div>' + top;
    } else {
      var idx = state.candidate, c = CANDIDATES[idx];
      var nat2 = state.reference === 'official' ? NAT_OFFICIAL[idx] : NAT_DATASET[idx];
      var score = (s && s[idx] != null ? s[idx] : 0) / 10;
      var diff = score - nat2;
      tip.innerHTML = head +
        '<div class="row"><span class="lbl">' + c.label + ' (commune)</span><span class="val">' + fmt(score, 1) + ' %</span></div>' +
        '<div class="row"><span class="lbl">' + c.label + ' (national)</span><span class="val">' + fmt(nat2, 2) + ' %</span></div>' +
        '<div class="row diff"><span class="lbl">Écart</span><span class="val">' +
          (diff >= 0 ? '+' : '−') + fmt(Math.abs(diff), 1) + ' pt' + (Math.abs(diff) >= 2 ? 's' : '') +
          ' <span style="color:#8a94a1;font-weight:600">(|' + fmt(Math.abs(diff), 1) + '|)</span></span></div>';
    }
    tip.style.left = e.point.x + 'px';
    tip.style.top = (e.point.y - 12) + 'px';
    tip.style.opacity = 1;
  }

  // ---------------------------------------------------------------- localisation
  function bbox(geom) {
    var minX = 180, minY = 90, maxX = -180, maxY = -90;
    (function walk(c) {
      if (typeof c[0] === 'number') {
        if (c[0] < minX) minX = c[0];
        if (c[0] > maxX) maxX = c[0];
        if (c[1] < minY) minY = c[1];
        if (c[1] > maxY) maxY = c[1];
      } else { for (var i = 0; i < c.length; i++) walk(c[i]); }
    })(geom.coordinates);
    return [[minX, minY], [maxX, maxY]];
  }
  function flyToCommune(code) {
    var f = featureByCode && featureByCode[code];
    if (!f || !map) return;
    map.fitBounds(bbox(f.geometry), { padding: 80, maxZoom: 11, duration: 900 });
  }

  // ---------------------------------------------------------------- boot
  async function boot() {
    try {
      if (typeof DecompressionStream === 'undefined') {
        $('loadingText').innerHTML = 'Navigateur non compatible (DecompressionStream requis).<br>Utilisez une version récente de Chrome, Firefox, Edge ou Safari.';
        return;
      }
      var bytes = b64ToBytes(window.ECART_GEO_B64);
      var text = await gunzipToString(bytes);
      payload = JSON.parse(text);
      window.ECART_GEO_B64 = null;

      labelByCode = {};
      payload.departements.features.forEach(function (f) { labelByCode[f.properties.code] = f.properties.nom; });

      featureByCode = {};
      payload.communes.features.forEach(function (f) { featureByCode[f.properties.c] = f; });

      stats = computeStats();
      buildUI();
      initMap();
      render();
    } catch (err) {
      console.error(err);
      $('loadingText').innerHTML = 'Erreur au chargement : ' + err.message;
    }
  }

  boot();
})();
