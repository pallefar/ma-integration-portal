/**
 * Assessment Suite — shared chart helpers (CSP-safe: inline SVG + CSS only,
 * no external libraries). Used by assessments.js and the dashboard gauges.
 */
(function () {
  'use strict';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  // Band → color (matches the banding seeded in the templates)
  function bandColor(bandId) {
    if (bandId === 'ready') return '#3f7a37';
    if (bandId === 'support') return '#C77700';
    if (bandId === 'risk') return '#C0392B';
    return '#8a8f92';
  }
  function scoreBandColor(score) {
    if (score >= 80) return '#3f7a37';
    if (score >= 60) return '#C77700';
    return '#C0392B';
  }

  /**
   * Radar chart as an inline SVG string.
   * axes: [{ id, label }] (3+ axes)
   * series: [{ label, color, values: {axisId: 0-100}, fillOpacity? }]
   */
  function radarSVG(axes, series, opts) {
    opts = opts || {};
    var size = opts.size || 340;
    var cx = size / 2, cy = size / 2;
    var labelPad = opts.labelPad || 78;
    var r = (size / 2) - labelPad;
    var n = axes.length;
    if (n < 3) return '';
    var angle = function (i) { return (Math.PI * 2 * i / n) - Math.PI / 2; };
    var pt = function (i, val) {
      var rr = r * Math.max(0, Math.min(100, val)) / 100;
      return [cx + rr * Math.cos(angle(i)), cy + rr * Math.sin(angle(i))];
    };
    var rings = [25, 50, 75, 100].map(function (lvl) {
      var pts = axes.map(function (_, i) { return pt(i, lvl).map(function (v) { return v.toFixed(1); }).join(','); }).join(' ');
      return '<polygon points="' + pts + '" fill="none" stroke="rgba(100,116,139,.18)" stroke-width="1"/>';
    }).join('');
    var spokes = axes.map(function (_, i) {
      var p = pt(i, 100);
      return '<line x1="' + cx + '" y1="' + cy + '" x2="' + p[0].toFixed(1) + '" y2="' + p[1].toFixed(1) + '" stroke="rgba(100,116,139,.18)" stroke-width="1"/>';
    }).join('');
    var labels = axes.map(function (a, i) {
      var p = pt(i, 100);
      var lx = cx + (p[0] - cx) * 1.14, ly = cy + (p[1] - cy) * 1.14;
      var anchor = Math.abs(lx - cx) < 12 ? 'middle' : (lx > cx ? 'start' : 'end');
      // Keep labels inside the viewBox: with anchor "end" text extends left of lx,
      // with "start" it extends right — clamp accordingly.
      if (anchor === 'end') lx = Math.max(lx, labelPad + 22);
      if (anchor === 'start') lx = Math.min(lx, size - labelPad - 22);
      var lines = String(a.label || '').split(' & ');
      if (lines.length > 1) lines = lines.map(function (ln, li) { return li < lines.length - 1 ? ln + ' &' : ln; });
      // Wrap any remaining long line at the space nearest its midpoint so labels
      // stay inside the viewBox on every axis.
      lines = lines.reduce(function (acc, ln) {
        if (ln.length <= 16 || ln.indexOf(' ') === -1) { acc.push(ln); return acc; }
        var mid = Math.floor(ln.length / 2), best = -1;
        for (var ci = 0; ci < ln.length; ci++) {
          if (ln[ci] === ' ' && (best === -1 || Math.abs(ci - mid) < Math.abs(best - mid))) best = ci;
        }
        if (best === -1) { acc.push(ln); return acc; }
        acc.push(ln.slice(0, best)); acc.push(ln.slice(best + 1));
        return acc;
      }, []);
      var tspans = lines.map(function (ln, li) {
        return '<tspan x="' + lx.toFixed(1) + '" dy="' + (li === 0 ? 0 : 11) + '">' + esc(ln) + '</tspan>';
      }).join('');
      return '<text x="' + lx.toFixed(1) + '" y="' + (ly - (lines.length > 1 ? 5 : 0)).toFixed(1) + '" text-anchor="' + anchor + '" font-size="10.5" font-weight="700" fill="var(--text-secondary,#64748b)">' + tspans + '</text>';
    }).join('');
    var polys = series.map(function (s) {
      var pts = axes.map(function (a, i) { return pt(i, (s.values && s.values[a.id]) || 0).map(function (v) { return v.toFixed(1); }).join(','); }).join(' ');
      var dots = axes.map(function (a, i) {
        var p = pt(i, (s.values && s.values[a.id]) || 0);
        return '<circle cx="' + p[0].toFixed(1) + '" cy="' + p[1].toFixed(1) + '" r="3" fill="' + s.color + '"/>';
      }).join('');
      return '<polygon points="' + pts + '" fill="' + s.color + '" fill-opacity="' + (s.fillOpacity != null ? s.fillOpacity : 0.14) + '" stroke="' + s.color + '" stroke-width="2.25" stroke-linejoin="round"/>' + dots;
    }).join('');
    var legend = series.length > 1 ? ('<div class="as-radar-legend">' + series.map(function (s) {
      return '<span class="as-radar-key"><span class="as-radar-swatch" style="background:' + s.color + '"></span>' + esc(s.label) + '</span>';
    }).join('') + '</div>') : '';
    return '<div class="as-radar-wrap"><svg viewBox="0 0 ' + size + ' ' + size + '" role="img" aria-label="Readiness radar">'
      + rings + spokes + labels + polys + '</svg>' + legend + '</div>';
  }

  /** Score ring (insights-style) with band coloring. */
  function scoreRing(score, labelHtml, sizePx) {
    var col = scoreBandColor(score);
    var s = sizePx || 76;
    return '<div class="as-score"><div class="as-score-ring" style="background:' + col + ';width:' + s + 'px;height:' + s + 'px;font-size:' + Math.round(s * 0.32) + 'px;">' + Math.round(score) + '</div>'
      + (labelHtml ? '<div class="as-score-lbl">' + labelHtml + '</div>' : '') + '</div>';
  }

  /** Horizontal dimension gauge bar with score + optional delta + flag chip. */
  function gaugeBar(opts) {
    var score = Math.max(0, Math.min(100, opts.score || 0));
    var col = opts.color || scoreBandColor(score);
    var chips = '';
    if (opts.redFlag) chips += '<span class="as-chip as-chip-red" data-i18n="assess.red_flag">Red flag</span>';
    else if (opts.focus) chips += '<span class="as-chip as-chip-amber" data-i18n="assess.focus_area">Focus area</span>';
    var delta = '';
    if (typeof opts.delta === 'number' && opts.delta !== 0) {
      var up = opts.delta > 0;
      delta = '<span class="as-delta ' + (up ? 'up' : 'down') + '">' + (up ? '▲' : '▼') + Math.abs(opts.delta) + '</span>';
    }
    return '<div class="as-dim-row">'
      + '<div class="as-dim-head"><span class="as-dim-name">' + (opts.icon ? '<span class="as-dim-ico">' + opts.icon + '</span>' : '') + '<span' + (opts.labelKey ? ' data-i18n="' + esc(opts.labelKey) + '"' : '') + '>' + esc(opts.label) + '</span></span>'
      + '<span class="as-dim-val" style="color:' + col + '">' + Math.round(score) + delta + chips + '</span></div>'
      + '<div class="as-dim-track"><div class="as-dim-fill" style="width:' + score + '%;background:' + col + '"></div></div>'
      + '</div>';
  }

  window.AssessCharts = { radarSVG: radarSVG, scoreRing: scoreRing, gaugeBar: gaugeBar, bandColor: bandColor, scoreBandColor: scoreBandColor, esc: esc };
})();
