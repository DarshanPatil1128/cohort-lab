(() => {
  const { $, $$, fmt, esc } = Kit;
  const SEG_COLORS = ['var(--c1)', 'var(--c4)', 'var(--c2)', 'var(--c3)', 'var(--c6)'];
  const AGES = 13; // cohort columns: month 0..12

  // ───────── Month helpers ─────────
  const toIdx = (ym) => { const [y, m] = ym.split('-').map(Number); return y * 12 + (m - 1); };
  const toYm = (i) => `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`;

  // ───────── Sample data: fictional B2B SaaS, Nov 2023 – Oct 2026 ─────────
  function sampleRevenue() {
    const r = Kit.rng(511);
    const start = toIdx('2023-11'), end = toIdx('2026-10');
    const segs = [
      { name: 'SMB', share: 0.62, mrr: () => 300 + r() * 1100, churn: 0.03, exp: 0.055 },
      { name: 'Mid-Market', share: 0.29, mrr: () => 2000 + r() * 6000, churn: 0.012, exp: 0.075 },
      { name: 'Enterprise', share: 0.09, mrr: () => 9000 + r() * 26000, churn: 0.006, exp: 0.075 },
    ];
    const rows = [];
    let id = 1000;
    for (let m = start; m <= end; m++) {
      const signups = Math.max(4, Math.round(14 + (m - start) * 0.35 + r.normal() * 3));
      for (let k = 0; k < signups; k++) {
        const s = r.weighted(segs.map((x) => [x, x.share]));
        let mrr = Math.round(s.mrr() / 10) * 10;
        const cid = 'C' + id++;
        for (let t = m; t <= end; t++) {
          if (t > m) {
            if (r() < s.churn * (t - m <= 3 ? 1.6 : 1)) break; // early-life churn is higher
            const u = r();
            if (u < s.exp) mrr = Math.round(mrr * (1.1 + r() * 0.35) / 10) * 10;
            else if (u < s.exp + 0.018) mrr = Math.round(mrr * (0.7 + r() * 0.2) / 10) * 10;
          }
          rows.push({ customer_id: cid, segment: s.name, month: toYm(t), mrr });
        }
      }
    }
    return rows;
  }

  let raw = sampleRevenue();
  let segment = 'All', mode = 'rev';

  function normalize(rows) {
    return rows.map((d) => ({ id: String(d.customer_id || d.customer || d.id), seg: d.segment || 'All customers', m: toIdx(String(d.month).slice(0, 7)), mrr: Number(String(d.mrr).replace(/[$,]/g, '')) || 0 }))
      .filter((d) => d.id && isFinite(d.m) && d.mrr > 0);
  }

  function setupSegments(data) {
    const segs = [...new Set(data.map((d) => d.seg))];
    const order = ['SMB', 'Mid-Market', 'Enterprise'];
    segs.sort((a, b) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99) || a.localeCompare(b));
    const list = segs.length > 1 ? ['All', ...segs] : ['All'];
    if (!list.includes(segment)) segment = 'All';
    $('#segment').innerHTML = list.map((s) => `<button data-v="${esc(s)}" aria-pressed="${s === segment}">${esc(s === 'All' ? 'All customers' : s)}</button>`).join('');
    $$('#segment button').forEach((b) => b.addEventListener('click', () => { segment = b.dataset.v; setupSegments(data); render(); }));
    return segs;
  }

  // ───────── Metrics ─────────
  function metrics(data) {
    const m0 = Math.min(...data.map((d) => d.m)), m1 = Math.max(...data.map((d) => d.m));
    const months = Array.from({ length: m1 - m0 + 1 }, (_, i) => m0 + i);
    const byCust = new Map();
    data.forEach((d) => {
      if (!byCust.has(d.id)) byCust.set(d.id, { seg: d.seg, rev: new Map() });
      const c = byCust.get(d.id);
      c.rev.set(d.m, (c.rev.get(d.m) || 0) + d.mrr);
    });
    const custs = [...byCust.values()];
    custs.forEach((c) => (c.first = Math.min(...c.rev.keys())));

    const rows = months.map((m) => {
      let mrr = 0, nw = 0, exp = 0, con = 0, churn = 0, active = 0, lost = 0, prevActive = 0;
      custs.forEach((c) => {
        const cur = c.rev.get(m) || 0, prev = c.rev.get(m - 1) || 0;
        mrr += cur;
        if (cur) active++;
        if (prev) prevActive++;
        if (cur && !prev) nw += cur;
        else if (cur && prev) { if (cur > prev) exp += cur - prev; else con += cur - prev; }
        else if (!cur && prev) { churn -= prev; lost++; }
      });
      // trailing-12 retention
      let base = 0, now = 0, nowCapped = 0;
      custs.forEach((c) => {
        const then = c.rev.get(m - 12) || 0;
        if (!then) return;
        const cur = c.rev.get(m) || 0;
        base += then; now += cur; nowCapped += Math.min(cur, then);
      });
      return { m, mrr, nw, exp, con, churn, active, logoChurn: prevActive ? lost / prevActive : 0, nrr: base ? now / base : null, grr: base ? nowCapped / base : null };
    });
    rows[0].nw = rows[0].mrr; // first month: everything is "new"

    // Cohorts by first paying month
    const cohorts = months.map((cm) => {
      const members = custs.filter((c) => c.first === cm);
      const start = members.reduce((s, c) => s + c.rev.get(cm), 0);
      const cells = Array.from({ length: AGES }, (_, age) => {
        const t = cm + age;
        if (t > m1) return null;
        const rev = members.reduce((s, c) => s + (c.rev.get(t) || 0), 0);
        const logos = members.filter((c) => c.rev.get(t)).length;
        return { rev: start ? rev / start : 0, logo: members.length ? logos / members.length : 0, n: logos };
      });
      return { m: cm, size: members.length, start, cells };
    }).filter((c) => c.size > 0);

    return { months, rows, cohorts, custs };
  }

  // ───────── Render ─────────
  function render() {
    const all = normalize(raw);
    const segs = setupSegments(all);
    const data = segment === 'All' ? all : all.filter((d) => d.seg === segment);
    if (!data.length) return;
    const M = metrics(data);
    const R = M.rows, last = R[R.length - 1], prev = R[R.length - 2] || last;
    const tail = R.slice(-3);
    const avg = (f) => tail.reduce((s, r) => s + f(r), 0) / tail.length;
    const quick = avg((r) => r.nw + r.exp) / Math.max(1, avg((r) => -(r.con + r.churn)));

    $('#kArr').textContent = fmt.compact(last.mrr * 12);
    $('#kArrHint').textContent = `${fmt.signedPct(prev.mrr ? last.mrr / prev.mrr - 1 : 0, 1)} MoM · ${fmt.month(toYm(last.m))}`;
    $('#kNrr').textContent = last.nrr == null ? '—' : fmt.pct(last.nrr);
    $('#kGrr').textContent = last.grr == null ? '—' : fmt.pct(last.grr);
    $('#kChurn').textContent = fmt.pct(avg((r) => r.logoChurn), 1);
    $('#kQuick').textContent = quick.toFixed(1);
    $('#kCust').textContent = fmt.num(last.active);
    $('#kCustHint').textContent = `ARPA ${fmt.money(last.mrr / Math.max(1, last.active))} / mo`;

    // Narrative
    const segChurn = segs.length > 1 ? segs.map((s) => {
      const rr = metrics(all.filter((d) => d.seg === s)).rows.slice(-6);
      return { s, churn: rr.reduce((a, r) => a + r.logoChurn, 0) / rr.length };
    }).sort((a, b) => b.churn - a.churn) : [];
    const yoy = R.length > 12 ? last.mrr / R[R.length - 13].mrr - 1 : null;
    $('#story').innerHTML = `<strong>${segment === 'All' ? 'The business' : esc(segment)} is at ${fmt.compact(last.mrr * 12)} ARR${yoy != null ? `, up ${fmt.pct(yoy)} year over year` : ''}.</strong>
      ${last.nrr != null ? `Net revenue retention is <strong>${fmt.pct(last.nrr)}</strong> — every $1 of revenue from customers a year ago is worth $${last.nrr.toFixed(2)} today${last.nrr >= 1.02 ? ', so the installed base grows even with zero new sales' : last.nrr >= 0.98 ? ', so expansion is roughly offsetting churn' : ', so new sales have to cover the leak first'}.` : ''}
      ${segChurn.length > 1 && segment === 'All' ? `Churn is concentrated in <strong>${esc(segChurn[0].s)}</strong> (${fmt.pct(segChurn[0].churn, 1)} of customers a month vs ${fmt.pct(segChurn[segChurn.length - 1].churn, 1)} in ${esc(segChurn[segChurn.length - 1].s)}).` : ''}
      Quick ratio is <strong>${quick.toFixed(1)}</strong>${quick >= 4 ? ' — efficient growth.' : quick >= 2 ? ' — healthy, with room to cut losses.' : ' — losses are eating growth.'}`;

    const cats = R.slice(1).map((r) => toYm(r.m));
    Kit.mount('#bridge', (w) => Kit.svg.stacked({
      w, h: 300, cats, fmt: fmt.compact, catFmt: fmt.month,
      series: [
        { name: 'New', color: 'var(--c2)', values: R.slice(1).map((r) => r.nw) },
        { name: 'Expansion', color: 'var(--c1)', values: R.slice(1).map((r) => r.exp) },
        { name: 'Contraction', color: 'var(--c3)', values: R.slice(1).map((r) => r.con) },
        { name: 'Churn', color: 'var(--c5)', values: R.slice(1).map((r) => r.churn) },
      ],
      line: { name: 'Net new MRR', color: 'var(--text)', values: R.slice(1).map((r) => r.nw + r.exp + r.con + r.churn) },
    }));

    // MRR by segment
    const segList = segment === 'All' && segs.length > 1 ? segs : [segment === 'All' ? segs[0] : segment];
    const series = segList.map((s, i) => {
      const rr = segment === 'All' && segs.length > 1 ? metrics(all.filter((d) => d.seg === s)).rows : R;
      const map = new Map(rr.map((r) => [r.m, r.mrr]));
      return { name: s, color: SEG_COLORS[i % SEG_COLORS.length], points: M.months.map((m) => ({ x: m, y: map.get(m) || 0 })), width: 2.25 };
    });
    if (segList.length > 1) series.push({ name: 'Total', color: 'var(--text)', points: R.map((r) => ({ x: r.m, y: r.mrr })), width: 2.5 });
    Kit.mount('#mrr', (w) => Kit.svg.lines({ w, h: 260, series, xfmt: (m) => fmt.month(toYm(m)), yfmt: fmt.compact, xTicks: M.months.filter((_, i) => i % 6 === 0) }));
    $('#mrrLegend').innerHTML = Kit.legend(series).replace('<div class="legend">', '').replace(/<\/div>$/, '');

    const nr = R.filter((r) => r.nrr != null);
    Kit.mount('#nrr', (w) => nr.length ? Kit.svg.lines({
      w, h: 260, xfmt: (m) => fmt.month(toYm(m)), yfmt: (v) => fmt.pct(v), yMin: Math.min(0.6, ...nr.map((r) => r.grr)), xTicks: nr.filter((_, i) => i % 3 === 0).map((r) => r.m),
      series: [{ name: 'NRR', color: 'var(--c6)', points: nr.map((r) => ({ x: r.m, y: r.nrr })), width: 2.5 }, { name: 'GRR', color: 'var(--c4)', points: nr.map((r) => ({ x: r.m, y: r.grr })), width: 2 }],
      markers: [{ y: 1, label: '100%', color: 'var(--faint)' }],
    }) : '<p class="note">Needs 13+ months of data.</p>');

    // Cohorts
    const css = getComputedStyle(document.documentElement);
    const dark = Kit.dark();
    const lo = dark ? '#3a1d22' : '#fde7e5', mid = dark ? '#1f2a3a' : '#eef4ff', hi = dark ? '#0a84ff' : '#0071e3';
    $('#cohortSub').textContent = mode === 'rev'
      ? 'Cohort MRR as a % of its first month. Above 100% means expansion outgrew churn.'
      : 'Share of each cohort’s customers still paying.';
    const cohorts = M.cohorts.slice(-18);
    Kit.mount('#cohorts', (w) => Kit.svg.heatmap({
      w: Math.max(w, 640), rows: cohorts.map((c) => `${fmt.month(toYm(c.m))} · ${c.size}`), cols: Array.from({ length: AGES }, (_, i) => (i ? 'M' + i : 'Start')),
      labelW: 110, cellH: 28,
      cell: (i, j) => {
        const c = cohorts[i].cells[j];
        if (!c) return null;
        const v = mode === 'rev' ? c.rev : c.logo;
        const color = v >= 1 ? Kit.mix(mid, hi, Math.min(1, (v - 1) / 0.35 + 0.35)) : Kit.mix(lo, mid, Math.max(0, (v - 0.5) / 0.5));
        return {
          color, text: Math.round(v * 100) + '', textColor: v >= 1.12 ? '#fff' : 'var(--text)',
          tip: `${fmt.month(toYm(cohorts[i].m))} cohort, month ${j}\n${c.n} of ${cohorts[i].size} customers active\nRevenue retention ${fmt.pct(c.rev)}`,
        };
      },
    }));
  }

  // ───────── Events ─────────
  $$('#cohortMode button').forEach((b) => b.addEventListener('click', () => {
    $$('#cohortMode button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    mode = b.dataset.v;
    render();
  }));
  $('#dlSample').addEventListener('click', () => Kit.csv.download('cohort-lab-sample.csv', Kit.csv.stringify(sampleRevenue())));
  $('#reset').addEventListener('click', () => { raw = sampleRevenue(); segment = 'All'; $('#dataNote').textContent = '36 months of synthetic data for a fictional SaaS company'; render(); });
  $('#file').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      const rows = Kit.csv.parse(await Kit.csv.readFile(f));
      if (!rows.length || !('month' in rows[0]) || !('mrr' in rows[0])) throw new Error('columns');
      if (!normalize(rows).length) throw new Error('empty');
      raw = rows;
      segment = 'All';
      $('#dataNote').textContent = `Loaded ${f.name} · ${fmt.num(rows.length)} rows`;
      render();
      Kit.toast('Revenue data loaded');
    } catch {
      Kit.toast('Need customer_id, month (YYYY-MM), and mrr columns.');
    }
    e.target.value = '';
  });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', render);

  render();
})();
