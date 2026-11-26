/*
 * 家計簿 iPhone版：画面。Android版 ui/MainActivity.kt・Dialogs.kt・Charts.kt を移したもの。
 * 下のタブ：ホーム／見通し／＋入力／内訳／口座。入力するのは確定したことだけ。
 */
(function () {
  'use strict';
  const { D, YM, INCOME, EXPENSE, sum, BudgetCalculator: BC, CardLogic, MonthlyLogic, BreakdownLogic, CheckOrder,
    BudgetStore, BudgetRepository, CsvFormat, newId, noBankDays, isPrepaid, kindLabel } = K;
  const APP_VERSION = '0.20.0';
  const PLATFORM = 'iPhone版';

  const repo = new BudgetRepository(BudgetStore);
  const today = () => D.today();
  const pref = {
    get(k, d) { try { const v = localStorage.getItem('kakeibo.ui.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('kakeibo.ui.' + k, JSON.stringify(v)); } catch (e) { /* 保存できなくても動く */ } },
  };
  const periods = [['3か月', 3], ['半年', 6], ['1年', 12], ['3年', 36], ['全部', null]];
  const st = {
    tab: 'home', showPast: false, showHistory: false, bdYearMode: false,
    bdMonth: D.ym(today()), bdYear: D.y(today()), homeMonth: D.ym(today()),
    get period() { return Math.min(Math.max(pref.get('period', 0), 0), periods.length - 1); },
    set period(v) { pref.set('period', v); },
  };

  // ===================================================================
  // 部品
  // ===================================================================
  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    if (props) for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style') el.style.cssText = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k === 'value') el.value = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const c of kids.flat(Infinity)) if (c != null && c !== false) el.append(c instanceof Node ? c : String(c));
    return el;
  }
  const NS = 'http://www.w3.org/2000/svg';
  function S(tag, attrs, ...kids) {
    const el = document.createElementNS(NS, tag);
    if (attrs) for (const [k, v] of Object.entries(attrs)) if (v != null) el.setAttribute(k, v);
    for (const c of kids.flat()) if (c != null) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
    return el;
  }
  const ICONS = {
    home: 'M4,10.5L12,4l8,6.5V19a1,1 0,0 1,-1,1h-4v-6h-6v6H5a1,1 0,0 1,-1,-1z',
    trend: 'M4,17l5,-5l4,3l7,-7M15,8h5v5',
    plus: 'M12,5v14M5,12h14',
    list: 'M5,7h14M5,12h10M5,17h6',
    wallet: 'M4,7.5A1.5,1.5 0,0 1,5.5,6h13A1.5,1.5 0,0 1,20,7.5v10A1.5,1.5 0,0 1,18.5,19h-13A1.5,1.5 0,0 1,4,17.5zM4,10h16M15,14.5h2',
    card: 'M3,7.5A1.5,1.5 0,0 1,4.5,6h15A1.5,1.5 0,0 1,21,7.5v9A1.5,1.5 0,0 1,19.5,18h-15A1.5,1.5 0,0 1,3,16.5zM3,10h18M7,14.5h4',
    in: 'M12,4v12M7,11l5,5l5,-5M5,20h14',
    out: 'M12,20V8M7,13l5,-5l5,5M5,4h14',
    alert: 'M12,4l9,16H3zM12,10v4M12,17h0.01',
    left: 'M15,5l-7,7l7,7',
    right: 'M9,5l7,7l-7,7',
  };
  const icon = (name, size = 22) => S('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
    'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' }, S('path', { d: ICONS[name] }));

  // ---- 数字と日付 ----
  const nf = new Intl.NumberFormat('ja-JP');
  const yen = (v) => (v < 0 ? '−' : '') + nf.format(Math.abs(v)) + '円';
  const num = (v) => (v < 0 ? '−' : '') + nf.format(Math.abs(v));
  const signed = (v) => (v > 0 ? '＋' : v < 0 ? '−' : '±') + nf.format(Math.abs(v)) + '円';
  const DOW = '日月火水木金土';
  const dow = (d) => DOW[D.dow(d)];
  const md = (d) => `${D.m(d)}/${D.d(d)}(${dow(d)})`;
  const ymd = (d) => (D.y(d) === D.y(today()) ? md(d) : `${D.y(d)}/${md(d)}`);
  const toHalf = (s) => s.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0));
  const parseYen = (s) => { const t = toHalf(String(s)).replace(/[,，円\s]/g, '').replace(/[−ー－]/g, '-'); return /^-?\d+$/.test(t) ? parseInt(t, 10) : null; };
  const parseInt2 = (s) => { const t = toHalf(String(s)).trim(); return /^\d+$/.test(t) ? parseInt(t, 10) : null; };
  const monthsBetween = (x, y) => (D.y(y) - D.y(x)) * 12 + (D.m(y) - D.m(x));
  const nthDate = (start, n) => BC.sameDayInMonth(start, YM.plus(D.ym(start), n - 1));
  const accName = (id) => (repo.data.accounts.find((a) => a.id === id) || {}).name || '（口座なし）';

  const div = (cls, ...kids) => h('div', { class: cls }, ...kids);
  const txt = (s, cls = '', style) => h('div', { class: cls, style }, s);
  function money(v, size, color, sign = false) {
    const head = (sign && v > 0 ? '＋' : v < 0 ? '−' : '') + nf.format(Math.abs(v));
    return h('span', { class: 'money', style: `font-size:${size}px;${color ? 'color:' + color : ''}` }, head, h('span', { class: 'unit' }, '円'));
  }
  const card = (cls = '') => div('card ' + cls);
  const divider = () => div('divider');
  function header(title, action, onClick) {
    return div('header', div('title', title), action ? btn(action, 'text', onClick) : null);
  }
  const pageTitle = (title, sub) => div('page-title', div('sub', sub), h('h1', null, title));
  function btn(label, kind, onClick, extra = '') {
    return h('button', { class: `btn ${kind} ${extra}`, type: 'button', onclick: onClick }, label);
  }
  function row(left, right, o = {}) {
    const el = div('row' + (o.onClick ? ' tap' : ''),
      div('main', div('l', left), h('div', { class: 'r', style: o.rightColor ? `color:${o.rightColor}` : null }, right)),
      o.sub != null ? h('div', { class: 's', style: o.subColor ? `color:${o.subColor}` : null }, o.sub) : null);
    if (o.onClick) { el.addEventListener('click', o.onClick); el.setAttribute('role', 'button'); el.tabIndex = 0; }
    return el;
  }
  /** 出入りの行：日付の札・名前と補足・金額（入金は紫の＋、出金は黒の−）。 */
  function moneyRow(date, name, amount, income, sub, subColor, onClick) {
    const el = div('mrow' + (onClick ? ' tap' : ''),
      div('date', div('md', `${D.m(date)}/${D.d(date)}`), div('w', dow(date))),
      div('mid', div('n', name), sub != null ? h('div', { class: 's', style: subColor ? `color:${subColor}` : null }, sub) : null),
      h('div', { class: 'amt', style: `color:${income ? 'var(--income)' : 'var(--text)'}` }, (income ? '＋' : '−') + yen(amount)));
    if (onClick) { el.addEventListener('click', onClick); el.setAttribute('role', 'button'); el.tabIndex = 0; }
    return el;
  }
  const chip = (label, on, onClick) => h('button', { class: 'chip' + (on ? ' on' : ''), type: 'button', 'aria-pressed': on ? 'true' : 'false', onclick: onClick }, label);
  const chipRow = (chips, cls = '') => div('chips ' + cls, chips);
  function segmented(labels, selected, onPick) {
    return div('seg', labels.map((l, i) => h('button', { type: 'button', class: i === selected ? 'on' : '', 'aria-pressed': i === selected ? 'true' : 'false', onclick: () => onPick(i) }, l)));
  }
  const label = (s) => h('label', { class: 'label' }, s);
  const input = (placeholder, value = '', extra = {}) => h('input', { class: 'field', type: 'text', placeholder, value, autocomplete: 'off', ...extra });
  const numberInput = (placeholder, value = '', cls = '') => h('input', { class: 'field ' + cls, type: 'text', inputmode: 'numeric', pattern: '[0-9]*', placeholder, value, autocomplete: 'off' });
  const amountField = (value) => numberInput('0', value == null ? '' : String(value), 'amount');
  const dateInput = (value) => h('input', { class: 'field', type: 'date', value: value || '' });
  /** マイナスも入れられる金額の欄（iPhoneの数字キーには「−」が無いので、横のボタンで切り替える）。 */
  function signedInput(placeholder, value = '', cls = 'big') {
    const f = h('input', { class: 'field ' + cls, type: 'text', inputmode: 'numeric', pattern: '[0-9]*', placeholder, value, autocomplete: 'off' });
    const b = h('button', { type: 'button', 'aria-label': 'プラスとマイナスを切り替える', onclick: () => {
      const v = f.value.trim();
      f.value = v.startsWith('-') || v.startsWith('−') ? v.slice(1) : '-' + v;
      f.dispatchEvent(new Event('input'));
    } }, '±');
    return { el: div('signed', f, b), input: f };
  }
  function toggle(text, checked) {
    const cb = h('input', { type: 'checkbox' });
    cb.checked = !!checked;
    return { el: h('label', { class: 'switch' }, h('span', { class: 'txt' }, text), cb, h('span', { class: 'knob', 'aria-hidden': 'true' })), input: cb };
  }
  function legendRow(items) {
    return div('legend', items.map(([color, l]) => h('span', null, h('i', { style: `background:${color}` }), l)));
  }
  function meter(ratio, desc) {
    const r = Math.min(Math.max(ratio, 0), 1);
    return h('div', { class: 'meter', role: 'img', 'aria-label': desc }, h('div', { class: r > 0 ? '' : 'zero', style: `width:${(r * 100).toFixed(2)}%` }));
  }
  function noticeCard(cls, color, ic, title, body, action, onAction) {
    return h('div', { class: 'card ' + cls },
      div('notice', h('span', { style: `color:${color}` }, icon(ic, 20)), div('', h('div', { class: 'ttl', style: `color:${color}` }, title), div('body', body))),
      action ? div('actions', h('button', { class: 'btn text', style: `color:${color}`, onclick: onAction }, action)) : null);
  }

  // ===================================================================
  // シート（入力画面）・ダイアログ・お知らせ
  // ===================================================================
  const layer = () => document.getElementById('layer');
  const lockScroll = () => document.body.classList.toggle('locked', layer().children.length > 0);

  /** 入力のシート。上の右端に保存ボタン（キーボードで隠れない）。onSave(close) が true を返したら閉じる。 */
  function openSheet({ title, body, saveLabel = '保存', onSave, neutral, keyboard = false }) {
    const ov = div('overlay');
    const close = () => { ov.remove(); lockScroll(); };
    const save = h('button', { class: 'sheet-btn strong', type: 'button', onclick: () => { if (onSave(close)) close(); } }, saveLabel);
    const panel = h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
      div('sheet-head', h('button', { class: 'sheet-btn', type: 'button', onclick: close }, 'キャンセル'), div('sheet-title', title), onSave ? save : h('span', { class: 'sheet-btn-ph' })),
      div('sheet-body', body, neutral ? h('div', { style: 'padding:8px 20px 0' }, btn(neutral[0], 'outline danger', () => { close(); neutral[1](); }, 'block')) : null));
    ov.append(panel);
    ov.addEventListener('click', (e) => { if (e.target === ov) close(); });
    layer().append(ov);
    lockScroll();
    // iPhone では、押した操作の中で focus するとキーボードが出る
    if (keyboard) { const f = body.querySelector('input.field:not([type=date])'); if (f) f.focus({ preventScroll: true }); }
    return { close, panel };
  }

  function dialog(title, msg, buttons) {
    const ov = div('overlay center');
    const close = () => { ov.remove(); lockScroll(); };
    const box = h('div', { class: 'dialog', role: 'alertdialog', 'aria-modal': 'true', 'aria-label': title }, h('h2', null, title), msg ? div('msg', msg) : null);
    box.append(div('actions', buttons.map(([l, f, cls]) => h('button', { class: 'btn text ' + (cls || ''), type: 'button', onclick: () => { close(); if (f) f(); } }, l))));
    ov.append(box);
    layer().append(ov);
    lockScroll();
    return { close, box };
  }
  const confirm = (title, msg, yes, onYes, o = {}) => dialog(title, msg, [[o.no || 'いいえ', o.onNo], [yes || 'はい', onYes, o.danger ? 'danger b' : 'b']]);
  const notice = (title, msg) => dialog(title, msg, [['閉じる', null, 'b']]);
  /** 選択肢（説明つき）から1つ選ぶ。items は [見出し, 説明]。 */
  function choose(title, items, onPick) {
    const d = dialog(title, null, [['キャンセル', null]]);
    const list = div('');
    items.forEach(([t, s], i) => list.append(h('button', { class: 'opt', type: 'button', onclick: () => { d.close(); onPick(i); } }, h('b', null, t), s || '')));
    d.box.insertBefore(list, d.box.lastChild);
  }
  let toastTimer = null;
  function toast(s) {
    document.querySelectorAll('.toast').forEach((x) => x.remove());
    const t = h('div', { class: 'toast', role: 'status' }, s);
    document.body.append(t);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.remove(), 3500);
  }

  // ===================================================================
  // グラフ（SVG）。色は dataviz の検証済み（Android版と同じ）
  // ===================================================================
  /** 文字の幅の見積もり（日本語は1文字＝文字の大きさ、数字や記号は約0.6）。ふきだしや目盛りの位置合わせに使う。 */
  const textW = (s, size, bold) => {
    let w = 0;
    for (const ch of s) w += ch.charCodeAt(0) > 0x2000 ? 1 : ch === ' ' ? 0.3 : 0.6;
    return w * size * (bold ? 1.04 : 1);
  };
  const chartW = () => Math.max(240, Math.min(document.documentElement.clientWidth, 640) - 32 - 40);
  function compactYen(v) {
    const a = Math.abs(v);
    let s;
    if (a >= 100000000) s = (a / 100000000).toFixed(1).replace(/\.0$/, '') + '億';
    else if (a >= 10000 && a < 1000000 && a % 10000 !== 0) s = (a / 10000).toFixed(1).replace(/\.0$/, '') + '万';
    else if (a >= 10000) s = Math.round(a / 10000) + '万';
    else s = nf.format(a);
    return (v < 0 ? '−' : '') + s;
  }
  function niceStep(range, ticks) {
    if (range <= 0) return 1;
    const raw = range / ticks;
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const n = raw / mag;
    return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * mag;
  }
  let clipSeq = 0;

  /** ホームの式を1本の棒で：（前月繰越＋収入）− 出金 ＝ 月末の残高。 */
  function formulaBar(start, income, expense, resultLabel) {
    const W = chartW(), barH = 28, H = barH + 34;
    const s = Math.max(0, start), inc = Math.max(0, income), out = Math.max(0, expense), total = s + inc;
    const svg = S('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: 'img',
      'aria-label': `前月繰越 ${num(start)}円 ＋ 収入 ${num(income)}円 − 出金 ${num(expense)}円 ＝ ${resultLabel} ${num(start + income - expense)}円` });
    if (total <= 0) return div('chart', svg);
    const id = 'cp' + (++clipSeq), id2 = 'cp' + (++clipSeq);
    const ws = W * s / total;
    const we = W * Math.min(out, total) / total;
    const left = W - we, gap = 2;
    svg.append(S('defs', null, S('clipPath', { id }, S('rect', { x: 0, y: 0, width: W, height: barH, rx: 4 })),
      S('clipPath', { id: id2 }, S('rect', { x: left, y: 0, width: Math.max(0, we), height: barH }))));
    const g = S('g', { 'clip-path': `url(#${id})` },
      S('rect', { x: 0, y: 0, width: ws, height: barH, style: 'fill:var(--ch-blue)' }),
      S('rect', { x: ws, y: 0, width: W - ws, height: barH, style: 'fill:var(--ch-income)' }));
    if (we > 0) {
      g.append(S('rect', { x: left - gap, y: 0, width: gap, height: barH, style: 'fill:var(--card)' }));
      const st2 = S('g', { 'clip-path': `url(#${id2})` }, S('rect', { x: left, y: 0, width: we, height: barH, style: 'fill:var(--card);fill-opacity:.43' }));
      for (let x = left - barH; x < W; x += 9) st2.append(S('line', { x1: x, y1: barH, x2: x + barH, y2: 0, style: 'stroke:var(--card);stroke-width:3' }));
      g.append(st2);
    }
    svg.append(g);
    const end = left - (we > 0 ? gap : 0);
    if (end > 8) {
      const y = barH + 8;
      svg.append(S('path', { d: `M0.75,${barH + 3}V${y}H${end}V${barH + 3}`, style: 'fill:none;stroke:var(--text);stroke-width:1.5' }));
      svg.append(S('text', { x: 0, y: y + 20, style: 'fill:var(--text);font-size:13px;font-weight:600' }, `＝ ${resultLabel} ${num(s + inc - out)}円`));
    }
    return div('chart', svg);
  }

  function axes(svg, lo, hi, step, yAt, L, R) {
    for (let t = lo; t <= hi + step / 2; t += step) {
      const y = yAt(t);
      svg.append(S('line', { x1: L, y1: y, x2: R, y2: y, style: `stroke:${Math.abs(t) < 1e-9 ? 'var(--ch-axis)' : 'var(--ch-grid)'};stroke-width:1` }));
      svg.append(S('text', { x: 2, y: y + 4, style: 'fill:var(--sub);font-size:11px' }, compactYen(Math.round(t))));
    }
  }
  function tip(svg, W, x, s) {
    const w = textW(s, 12) + 16;
    const l = Math.min(Math.max(x - w / 2, 0), Math.max(0, W - w));
    svg.append(S('rect', { x: l, y: 0, width: w, height: 22, rx: 6, style: 'fill:var(--tip-bg)' }));
    svg.append(S('text', { x: l + 8, y: 15, style: 'fill:var(--tip-text);font-size:12px' }, s));
  }
  /** 押した位置（または指でなぞった位置）から、何番目の月かを出す。 */
  function onPick(wrap, toIndex, pick) {
    let down = false;
    const at = (e) => { const r = wrap.getBoundingClientRect(); pick(toIndex(e.clientX - r.left)); };
    wrap.addEventListener('pointerdown', (e) => { down = true; at(e); });
    wrap.addEventListener('pointermove', (e) => { if (down) at(e); });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach((k) => wrap.addEventListener(k, () => { down = false; }));
  }
  function monthTicks(n, L, R, xAt, labels, svg, H, sel) {
    const maxLabels = Math.max(2, Math.floor((R - L) / 56));
    const every = Math.max(1, Math.ceil(n / maxLabels));
    labels.forEach((l, i) => {
      const isLast = i === n - 1;
      if (!(i % every === 0 || isLast || i === sel)) return;
      if (!isLast && i !== sel && n - 1 - i < every / 2) return;
      const anchor = i === 0 ? 'start' : isLast ? 'end' : 'middle';
      const x = i === 0 ? Math.max(xAt(i) - textW(l, 11) / 2, 0) : isLast ? Math.min(xAt(i) + textW(l, 11) / 2, R + 8) : xAt(i);
      svg.append(S('text', { x, y: H - 6, 'text-anchor': anchor, style: `fill:${i === sel ? 'var(--text)' : 'var(--sub)'};font-size:11px` }, l));
    });
  }

  /** 月末の残高の推移（線＋薄い面）。一番少ない月と最後の月に金額。押すとその月の値。 */
  function balanceChart(labels, values) {
    const W = chartW(), H = 200, L = 44, R = W - 12, T = 24, B = H - 24;
    const wrap = h('div', { class: 'chart', role: 'img', 'aria-label': '月末の残高の推移。' + labels.map((l, i) => `${l} ${compactYen(values[i])}円`).join('、') });
    let sel = -1;
    const n = values.length;
    const xAt = (i) => (n <= 1 ? (L + R) / 2 : L + (R - L) * i / (n - 1));
    function draw() {
      wrap.textContent = '';
      const svg = S('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}` });
      if (!n) { wrap.append(svg); return; }
      const lo0 = Math.min(0, ...values), hi0 = Math.max(0, ...values);
      const step = niceStep(hi0 - lo0, 3);
      const lo = Math.floor(lo0 / step) * step, hi = Math.max(Math.ceil(hi0 / step) * step, lo + step);
      const yAt = (v) => B - (B - T) * (v - lo) / (hi - lo);
      axes(svg, lo, hi, step, yAt, L, R);
      monthTicks(n, L, R, xAt, labels, svg, H, -1);
      const pts = values.map((v, i) => `${xAt(i)},${yAt(v)}`);
      const base = yAt(Math.max(lo, 0));
      svg.append(S('path', { d: `M${pts.join('L')}L${xAt(n - 1)},${base}L${xAt(0)},${base}Z`, style: 'fill:var(--ch-blue);fill-opacity:.1' }));
      svg.append(S('path', { d: `M${pts.join('L')}`, style: 'fill:none;stroke:var(--ch-blue);stroke-width:2;stroke-linecap:round;stroke-linejoin:round' }));
      const marker = (i) => {
        svg.append(S('circle', { cx: xAt(i), cy: yAt(values[i]), r: 6, style: 'fill:var(--card)' }));
        svg.append(S('circle', { cx: xAt(i), cy: yAt(values[i]), r: 4, style: `fill:${values[i] < 0 ? 'var(--ch-red)' : 'var(--ch-blue)'}` }));
      };
      let minI = 0;
      values.forEach((v, i) => { if (v < values[minI]) minI = i; });
      const last = n - 1;
      const bold = 'fill:var(--text);font-size:12px;font-weight:600';
      if (minI !== last) {
        marker(minI);
        const s = `最少 ${compactYen(values[minI])}円`, w = textW(s, 12, true);
        svg.append(S('text', { x: Math.min(Math.max(xAt(minI) - w / 2, L), R - w), y: Math.min(yAt(values[minI]) + 18, B - 4), style: bold }, s));
      }
      marker(last);
      const ls = `${compactYen(values[last])}円`;
      svg.append(S('text', { x: Math.max(xAt(last) - textW(ls, 12, true), L), y: Math.max(yAt(values[last]) - 10, T - 8), style: bold }, ls));
      if (sel >= 0 && sel < n) {
        svg.append(S('line', { x1: xAt(sel), y1: T, x2: xAt(sel), y2: B, style: 'stroke:var(--ch-axis);stroke-width:1' }));
        marker(sel);
        tip(svg, W, xAt(sel), `${labels[sel]}  ${num(values[sel])}円`);
      }
      wrap.append(svg);
    }
    onPick(wrap, (x) => (n <= 1 ? 0 : Math.min(Math.max(Math.round((x - L) / (R - L) * (n - 1)), 0), n - 1)), (i) => { if (i !== sel) { sel = i; draw(); } });
    draw();
    return wrap;
  }

  /** 月ごとの増減。増えた月は紫で上、減った月は赤で下。押すとその月の内訳。 */
  function netBars(labels, income, expense, netValues) {
    const nets = netValues || income.map((x, i) => x - expense[i]);
    const W = chartW(), H = 170, L = 44, R = W - 8, T = 26, B = H - 22;
    const n = nets.length;
    const wrap = h('div', { class: 'chart', role: 'img', 'aria-label': '月ごとの増減。' + labels.map((l, i) => `${l} ${nets[i] >= 0 ? '増' : '減'}${compactYen(Math.abs(nets[i]))}円`).join('、') });
    let sel = -1;
    const slot = (R - L) / Math.max(n, 1);
    function draw() {
      wrap.textContent = '';
      const svg = S('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}` });
      if (!n) { wrap.append(svg); return; }
      const lo0 = Math.min(0, ...nets), hi0 = Math.max(0, ...nets);
      const step = niceStep(Math.max(hi0 - lo0, 1), 3);
      const lo = Math.floor(lo0 / step) * step, hi = Math.max(Math.ceil(hi0 / step) * step, lo + step);
      const yAt = (v) => B - (B - T) * (v - lo) / (hi - lo);
      axes(svg, lo, hi, step, yAt, L, R);
      const bw = Math.min(24, slot * 0.6), r = Math.min(4, bw / 2), zero = yAt(0);
      nets.forEach((v, i) => {
        if (v === 0) return;
        const cx = L + slot * (i + 0.5), y = yAt(v);
        const top = Math.min(y, zero), hgt = Math.abs(zero - y);
        const color = v > 0 ? 'var(--ch-blue)' : 'var(--ch-red)';
        const op = sel >= 0 && sel !== i ? ';fill-opacity:.43' : '';
        const rr = Math.min(r, hgt / 2);
        // 先端だけ丸め、0円の線側は角にする
        const d = v > 0
          ? `M${cx - bw / 2},${zero}V${top + rr}Q${cx - bw / 2},${top} ${cx - bw / 2 + rr},${top}H${cx + bw / 2 - rr}Q${cx + bw / 2},${top} ${cx + bw / 2},${top + rr}V${zero}Z`
          : `M${cx - bw / 2},${zero}V${zero + hgt - rr}Q${cx - bw / 2},${zero + hgt} ${cx - bw / 2 + rr},${zero + hgt}H${cx + bw / 2 - rr}Q${cx + bw / 2},${zero + hgt} ${cx + bw / 2},${zero + hgt - rr}V${zero}Z`;
        svg.append(S('path', { d, style: `fill:${color}${op}` }));
      });
      monthTicks(n, L, R, (i) => L + slot * (i + 0.5), labels, svg, H, -1);
      if (sel >= 0) tip(svg, W, L + slot * (sel + 0.5), `${labels[sel]}  収入 ${compactYen(income[sel])}／支出 ${compactYen(expense[sel])}／${nets[sel] >= 0 ? '＋' : '−'}${compactYen(Math.abs(nets[sel]))}`);
      wrap.append(svg);
    }
    onPick(wrap, (x) => Math.min(Math.max(Math.floor((x - L) / slot), 0), n - 1), (i) => { if (i !== sel) { sel = i; draw(); } });
    draw();
    return wrap;
  }

  /** 月ごとの収入を、名前ごとに色を分けて積み上げる棒。values[月][名前]。 */
  function incomeBars(labels, colors, values, desc, onSelect) {
    const totals = values.map((p) => sum(p));
    const W = chartW(), H = 170, L = 44, R = W - 8, T = 10, B = H - 22;
    const n = totals.length;
    const wrap = h('div', { class: 'chart', role: 'img', 'aria-label': desc });
    let sel = -1;
    const slot = (R - L) / Math.max(n, 1);
    function draw() {
      wrap.textContent = '';
      const svg = S('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}` });
      const hi0 = Math.max(1, ...totals);
      const step = niceStep(hi0, 3);
      const hi = Math.max(Math.ceil(hi0 / step) * step, step);
      const yAt = (v) => B - (B - T) * v / hi;
      axes(svg, 0, hi, step, yAt, L, R);
      const bw = Math.min(24, slot * 0.6), r = Math.min(4, bw / 2), gap = 2;
      values.forEach((parts, i) => {
        const cx = L + slot * (i + 0.5);
        let acc = 0;
        const vis = parts.map((v, j) => j).filter((j) => parts[j] > 0);
        vis.forEach((j, k) => {
          const y0 = yAt(acc); acc += parts[j]; const y1 = yAt(acc);
          const bot = k === 0 ? y0 : y0 - gap / 2;
          const top = k === vis.length - 1 ? y1 : y1 + gap / 2;
          if (bot - top < 1) return;
          const op = sel >= 0 && sel !== i ? ';fill-opacity:.43' : '';
          const rr = k === vis.length - 1 ? Math.min(r, (bot - top) / 2) : 0;
          const d = `M${cx - bw / 2},${bot}V${top + rr}Q${cx - bw / 2},${top} ${cx - bw / 2 + rr},${top}H${cx + bw / 2 - rr}Q${cx + bw / 2},${top} ${cx + bw / 2},${top + rr}V${bot}Z`;
          svg.append(S('path', { d, style: `fill:${colors[j]}${op}` }));
        });
      });
      monthTicks(n, L, R, (i) => L + slot * (i + 0.5), labels, svg, H, sel);
      wrap.append(svg);
    }
    onPick(wrap, (x) => Math.min(Math.max(Math.floor((x - L) / slot), 0), n - 1), (i) => { if (i !== sel) { sel = i; draw(); onSelect(i); } });
    draw();
    return wrap;
  }

  // ===================================================================
  // 描画の入口
  // ===================================================================
  const content = () => document.getElementById('content');
  const add = (...els) => content().append(...els);

  function render() {
    const c = content();
    c.textContent = '';
    c.style.animation = 'none'; void c.offsetWidth; c.style.animation = '';
    renderTabbar();
    if (repo.brokenReason != null) { renderBroken(repo.brokenReason); return; }
    const t = today();
    const s = BC.summarize(repo.data, t, 3);
    if (st.tab === 'forecast') renderForecast(s, t);
    else if (st.tab === 'breakdown') renderBreakdown(t);
    else if (st.tab === 'accounts') renderAccounts(s, t);
    else renderHome(s, t);
  }
  function switchTab(id) { st.tab = id; render(); window.scrollTo(0, 0); }

  function renderTabbar() {
    const bar = document.querySelector('#tabbar .inner');
    bar.textContent = '';
    const item = (id, ic, l) => h('button', { class: 'tab' + (st.tab === id ? ' on' : ''), type: 'button', 'aria-current': st.tab === id ? 'page' : null, onclick: () => switchTab(id) },
      div('pill', icon(ic, 22)), h('span', null, l));
    bar.append(item('home', 'home', 'ホーム'), item('forecast', 'trend', '見通し'),
      div('plus', h('button', { type: 'button', 'aria-label': '確定した金額を入力', onclick: () => { if (repo.brokenReason == null) chooser(); } }, icon('plus', 26))),
      item('breakdown', 'list', '内訳'), item('accounts', 'wallet', '口座'));
  }

  function renderBroken(reason) {
    add(pageTitle('家計簿', '読み込みの問題'));
    add(h('div', { class: 'card warn' },
      txt('保存データを読み込めませんでした', 't18 b', 'color:var(--warn)'),
      txt(`データは消していません。\n理由：${reason}\n\n新しい版で作られたデータなら、アプリを最新にすると読めます（画面を下に引っぱるか、アプリを開き直してください）。`, 't14 pre'),
      h('div', { style: 'padding-top:12px' }, btn('今のデータを別に保管して、最初から始める', 'outline', () => confirm('最初から始めますか？', '読み込めなかったデータは、この端末の中に別に保管します。', 'はい', () => {
        if (!repo.resetAfterBroken(today())) toast('やり直せませんでした');
        render();
      }), 'block'))));
  }

  const todayLabel = (d) => `${D.m(d)}月${D.d(d)}日（${dow(d)}）`;

  function installBanner() {
    const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const standalone = navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches;
    if (!ios || standalone) return null;
    return h('div', { class: 'banner' }, h('b', null, 'ホーム画面に追加してから使ってください'),
      '下の共有ボタン（□に↑）→「ホーム画面に追加」→「追加」。ホーム画面のアイコンから開くと、アプリとして使えます。Safariのまま入れたデータは、ホーム画面のアプリには引き継がれません。');
  }

  // ===================================================================
  // ホーム
  // ===================================================================
  function eqRow(color, l, amount, amountColor, bold = false) {
    return div('eq' + (bold ? ' bold' : ''), h('i', { class: 'mark', style: color ? `background:${color}` : null }), div('l', l),
      h('div', { class: 'a', style: `color:${amountColor}` }, amount));
  }
  function monthNav(title, showBack, onMove) {
    return div('',
      div('month-nav', h('button', { class: 'icon-btn', type: 'button', 'aria-label': '前の月', onclick: () => onMove(-1) }, icon('left', 22)),
        div('ttl', title), h('button', { class: 'icon-btn', type: 'button', 'aria-label': '次の月', onclick: () => onMove(1) }, icon('right', 22))),
      showBack ? div('center', btn('今月へ戻る', 'text', () => onMove(0))) : null);
  }

  function renderHome(s, t) {
    const thisMonth = D.ym(t);
    const hm = st.homeMonth;
    const p = MonthlyLogic.plan(repo.data, hm, t);
    const m = YM.m(hm);
    const banner = installBanner();
    add(pageTitle('ホーム', todayLabel(t)));
    if (banner) add(banner);
    add(monthNav(`${YM.y(hm)}年${m}月`, hm !== thisMonth, (delta) => { st.homeMonth = delta === 0 ? thisMonth : YM.plus(hm, delta); render(); }));

    const hero = card();
    const isPast = p.kind === 'PAST';
    const title = p.kind === 'CURRENT' ? '今月末の残高見込み' : p.kind === 'FUTURE' ? `${m}月末の残高見込み` : `${m}月末の残高`;
    hero.append(txt(title, 't14 t-sub'));
    hero.append(h('div', { style: 'padding:6px 0 2px' }, money(p.end, 46, p.end < 0 ? 'var(--warn)' : 'var(--text)')));
    if (p.kind === 'CURRENT' && p.end > 0) {
      const daysLeft = D.between(t, YM.atEnd(hm)) + 1;
      hero.append(txt(`1日あたり ${yen(Math.floor(p.end / daysLeft))}・月末まであと${daysLeft}日`, 't15 b', 'color:var(--accent)'));
    }
    let incomeMark = null;
    const showBar = p.end > 0 && p.start >= 0;
    if (showBar) {
      incomeMark = 'var(--ch-income)';
      hero.append(h('div', { style: 'height:16px' }));
      hero.append(formulaBar(p.start, p.income + Math.max(0, p.cardCharge), p.expense + Math.max(0, -p.cardCharge), isPast ? '月末の残高' : '月末の残高見込み'));
    }
    const note = (x) => div('eq-note', x);
    hero.append(h('div', { style: 'height:10px' }));
    hero.append(eqRow(showBar ? 'var(--ch-blue)' : null, '前月繰越', yen(p.start), 'var(--text)'));
    hero.append(eqRow(incomeMark, '＋ 収入', yen(p.income), 'var(--income)'));
    const incNotes = [p.kind === 'CURRENT' ? `うち入金済み ${yen(p.incomeDone)}` : null, p.unrecorded < 0 ? `うち記録外 ${yen(-p.unrecorded)}（残高の差から）` : null].filter(Boolean);
    if (incNotes.length) hero.append(note(incNotes.join('・')));
    hero.append(eqRow(showBar ? 'var(--ch-orange)' : null, '− 出金', yen(p.expense), 'var(--text)'));
    const expNotes = [p.kind === 'CURRENT' ? `うち支払済み ${yen(p.expenseDone)}` : null, p.unrecorded > 0 ? `うち記録外 ${yen(p.unrecorded)}（残高の差から）` : null].filter(Boolean);
    if (expNotes.length) hero.append(note(expNotes.join('・')));
    if (p.cardCharge > 0) hero.append(eqRow(incomeMark, '＋ カードからのチャージ（請求は翌月以降）', yen(p.cardCharge), 'var(--text)'));
    if (p.cardCharge < 0) hero.append(eqRow(null, '− 以前のカードチャージ分の請求', yen(-p.cardCharge), 'var(--text)'));
    hero.append(h('div', { class: 'divider', style: 'margin:6px 0 4px' }));
    hero.append(eqRow(null, `＝ ${title}`, yen(p.end), p.end < 0 ? 'var(--warn)' : 'var(--text)', true));
    const pending = s.unconfirmedBills.filter((u) => D.ym(u.date) === hm);
    if (!isPast) hero.append(txt('登録した予定と、金額が確定したカードの請求で計算しています。カードの請求は、引き落とされる月に入ります。', 'note'));
    if (p.beforeFirstBalance) hero.append(txt('最初に残高を入れた日より前の月です。前月繰越は、記録した入出金から逆算した参考値です。', 'note'));
    if (!isPast && pending.length) {
      const tx = pending.length <= 2 ? pending.map((u) => `${md(u.date)}の${u.card.name}`).join('、') + 'の請求（確定待ち）は含みません' : `確定待ちのカード請求 ${pending.length}件は含みません`;
      hero.append(txt(tx, 'note', 'color:var(--est)'));
    }
    if (p.kind === 'CURRENT' && s.oldestAsOf) {
      const days = D.between(s.oldestAsOf, t);
      const stale = days >= 14;
      hero.append(txt(`残高は${md(s.oldestAsOf)}時点` + (days > 0 ? `（${days}日前）` : '（今日）'), 'note', stale ? 'color:var(--est)' : null));
      if (stale) hero.append(h('div', { style: 'padding-top:8px' }, btn('現在の残高を入力', 'outline', balances, 'block')));
    }
    if (isPast) hero.append(btn('内訳で見る', 'text', () => { st.bdYearMode = false; st.bdMonth = hm; switchTab('breakdown'); }));
    add(hero);

    // 元に戻す
    if (repo.undoLabel) {
      const u = card('ok');
      u.append(txt(repo.undoLabel, 't13'));
      // 残高を確かめた日と同じ日の記録：確かめる前に起きたものとして保存したので、違えば並び順を直せるようにする
      const hint = repo.balanceHint;
      const hintAcc = hint && repo.data.accounts.find((a) => a.id === hint.accountId);
      if (hint && hintAcc) {
        u.append(txt(`${hintAcc.name}の残高（${md(hintAcc.asOf)}・${yen(hintAcc.balance)}）を確かめる前の入出金として計算しています。確かめた後に起きたときは、並び順を変えてください。`, 't12 t-sub', 'padding-top:4px'));
        u.append(div('actions', btn('この日の流れを見る', 'text', () => dayFlowSheet(hintAcc.asOf))));
      }
      u.append(div('actions', btn('閉じる', 'text', () => { repo.clearUndo(); render(); }), btn('元に戻す', 'text b', () => { if (!repo.undo()) toast('戻せませんでした'); render(); })));
      add(u);
    }

    // 直近（1週間以内）に残高を確かめた日の流れを、上の方に出す（並び順を変える入口）
    if (p.kind === 'CURRENT') {
      const recent = flowDates().filter((d) => d <= t && D.between(d, t) <= 6).pop();
      if (recent) add(flowCard(recent, t));
    }

    if (p.kind === 'CURRENT') {
      for (const tr of s.transfers) {
        add(noticeCard('warn', 'var(--warn)', 'alert', `${tr.accountName}の残高が不足します`,
          `${md(tr.shortDate)}の引き落とし時に不足します。${md(tr.deadline)}までに ${yen(tr.amount)} 以上を入金し、入金後に現在の残高を入力してください。`,
          '現在の残高を入力', balances));
      }
      if (s.unconfirmedBills.length) {
        add(header('次のカード請求'));
        const uc = card();
        s.unconfirmedBills.forEach((u, i) => {
          if (i > 0) uc.append(divider());
          const ready = u.closing < t;
          uc.append(row(`${md(u.date)}  ${u.card.name}`, '請求額の確定待ち', { rightColor: 'var(--sub)',
            sub: ready ? `${md(u.closing)}締め・確定した請求額を入力すると、見通しに反映されます` : `${md(u.closing)}の締め日以降に請求額が確定します`,
            onClick: () => bill(u.card, u.paymentRaw) }));
        });
        add(uc);
      }
    }

    add(header(`${m}月の入出金`));
    const list = card();
    if (!p.rows.length) list.append(txt('この月の確定した入出金はありません。', 't14 t-sub'));
    // 残高を確かめた日に入出金があれば、その日の最後に「この日の流れ」の行を出す（押すと並び順を変えられる）
    const flowSet = new Set(flowDates().filter((d) => D.ym(d) === hm));
    const flowLine = (date) => {
      const checks = CheckOrder.checksOn(repo.data, date);
      const r = row(`${md(date)}の流れを見る`, '', { sub: `${checks.map((c) => c.acc.name).join('・')}の残高を確かめた日・押すと、入出金と確かめた順番を並べ替えられます`, onClick: () => dayFlowSheet(date) });
      r.classList.add('check-row');
      r.querySelector('.main').prepend(div('dots', checks.map((c) => h('i', { class: 'dot', style: `background:${accColor(c.acc.id)}` }))));
      return r;
    };
    p.rows.forEach((o, i) => {
      if (i > 0) list.append(divider());
      const done = o.date <= t;
      const sub = [accName(o.accountId), MonthlyLogic.shiftReason(o), done ? '完了' : null].filter(Boolean).join('・');
      list.append(moneyRow(o.date, o.name, o.amount, o.kind === INCOME, sub, null, () => openOccurrence(o.entryId, o.originalDate)));
      if ((!p.rows[i + 1] || p.rows[i + 1].date !== o.date) && flowSet.has(o.date)) { list.append(divider()); list.append(flowLine(o.date)); }
    });
    for (const e of repo.data.entries.filter((x) => x.repeatMonthly)) {
      for (const c of (e.changes || []).filter((x) => x.skipped && D.ym(x.originalDate) === hm)) {
        list.append(divider());
        list.append(row(`${md(c.originalDate)}  ${e.name}`, '飛ばした回', { rightColor: 'var(--sub)', sub: '押すと、予定どおりに戻したり日付を変えたりできます', onClick: () => occurrence(e, c.originalDate) }));
      }
    }
    add(list);
  }

  function openOccurrence(entryId, originalDate) {
    if (entryId.startsWith('bill:')) {
      const [, cardId, raw] = entryId.split(':');
      const c = repo.data.cards.find((x) => x.id === cardId);
      if (c) bill(c, raw);
      return;
    }
    const e = repo.data.entries.find((x) => x.id === entryId);
    if (!e) return;
    if (e.repeatMonthly && originalDate) chooseScope(e, originalDate);
    else if (e.repeatMonthly) editEntry(e, e.kind);
    else if (e.kind === INCOME) income(e);
    else debit(e);
  }

  // ===================================================================
  // 見通し
  // ===================================================================
  function renderIncomeByName(plans, monthLabel) {
    const months = plans.map((p) => p.month);
    if (!months.length) return;
    const data = repo.data;
    const transferIds = new Set(data.entries.filter((e) => e.chargeFrom != null).map((e) => e.id));
    const occ = BC.occurrences(data, YM.atDay(months[0], 1), YM.atEnd(months[months.length - 1]))
      .filter((o) => o.kind === INCOME && !transferIds.has(o.entryId) && !o.entryId.startsWith('chg:'));
    const extra = plans.map((p) => Math.max(0, p.income - sum(occ.filter((o) => D.ym(o.date) === p.month), (o) => o.amount)));
    const hasExtra = extra.some((x) => x > 0);
    if (!occ.length && !hasExtra) return;
    const byName = new Map();
    for (const o of occ) byName.set(o.name, (byName.get(o.name) || 0) + o.amount);
    const ranked = [...byName.entries()].sort((a, b) => b[1] - a[1]).map((x) => x[0]);
    const series = ['var(--s1)', 'var(--s2)', 'var(--s3)', 'var(--s4)', 'var(--s5)'];
    const named = ranked.length <= series.length ? ranked : ranked.slice(0, series.length - 1);
    const hasOther = ranked.length > named.length;
    const names = [...named, ...(hasOther ? ['その他'] : []), ...(hasExtra ? ['記録外の入金'] : [])];
    const colors = [...named.map((_, i) => series[i]), ...(hasOther ? ['var(--s-other)'] : []), ...(hasExtra ? ['var(--sub)'] : [])];
    const idx = (nm) => { const i = named.indexOf(nm); return i >= 0 ? i : named.length; };
    const values = months.map((ym, mi) => {
      const r = names.map(() => 0);
      for (const o of occ.filter((x) => D.ym(x.date) === ym)) r[idx(o.name)] += o.amount;
      if (hasExtra) r[names.length - 1] = extra[mi];
      return r;
    });
    const labels = months.map(monthLabel);
    const gc = card();
    gc.append(txt('月別の収入（名前別）', 't16 b'));
    gc.append(legendRow(names.map((nm, i) => [colors[i], nm])));
    const detail = txt('棒をタップすると、その月の内訳を表示します', 't12 t-sub');
    const desc = '月別の収入。' + labels.map((l, i) => `${l} ${yen(sum(values[i]))}`).join('、');
    gc.append(incomeBars(labels, colors, values, desc, (i) => {
      const parts = names.map((nm, j) => (values[i][j] > 0 ? `${nm} ${yen(values[i][j])}` : null)).filter(Boolean).join('・');
      detail.textContent = `${labels[i]}　計 ${yen(sum(values[i]))}` + (parts ? `（${parts}）` : '');
      detail.className = 't12';
    }));
    gc.append(detail);
    add(gc);
  }

  function renderForecast(s3, t) {
    const sp = BC.summarize(repo.data, t, periods[st.period][1]);
    add(pageTitle('見通し', '確定した入出金だけで計算（請求額が未確定のカード引き落としは含みません）'));
    add(segmented(periods.map((x) => x[0]), st.period, (i) => { st.period = i; render(); }));
    add(txt(`${ymd(t)} 〜 ${ymd(sp.endDate)}`, 't12 t-sub', 'padding:10px 4px 4px'));
    const monthLabel = (ym) => `${YM.y(ym)}/${YM.m(ym)}`;
    const plans = MonthlyLogic.plans(repo.data, sp.months.map((x) => x.month), t);

    const bc = card();
    bc.append(txt('月末の残高見込み', 't16 b'));
    if (sp.lowestDate) bc.append(txt(`最も少ない日：${md(sp.lowestDate)}　${yen(sp.lowestTotal)}`, 't13', `color:${sp.lowestTotal < 0 ? 'var(--warn)' : 'var(--sub)'}`));
    bc.append(h('div', { style: 'height:8px' }));
    bc.append(balanceChart(plans.map((p) => monthLabel(p.month)), plans.map((p) => p.end)));
    bc.append(txt('グラフをタップすると、その月の金額を表示します', 't12 t-sub'));
    add(bc);

    const nc = card();
    nc.append(txt('月別の残高増減', 't16 b'));
    nc.append(legendRow([['var(--ch-blue)', '増加した月'], ['var(--ch-red)', '減少した月']]));
    nc.append(netBars(plans.map((p) => monthLabel(p.month)), plans.map((p) => p.income), plans.map((p) => p.expense), plans.map((p) => p.end - p.start)));
    add(nc);
    renderIncomeByName(plans, monthLabel);

    add(header('表で見る'));
    const mc = card();
    mc.append(div('table-row head', h('div', null, '月'), h('div', null, '収入'), h('div', null, '支出'), h('div', null, '月末残高')));
    for (const p of plans) {
      mc.append(divider());
      mc.append(div('table-row', h('div', null, monthLabel(p.month)),
        h('div', { style: 'color:var(--income)' }, p.income ? num(p.income) : ''), h('div', null, p.expense ? num(p.expense) : ''),
        h('div', { class: 'b', style: p.end < 0 ? 'color:var(--warn)' : null }, num(p.end))));
    }
    add(mc);

    if (s3.loans.length || s3.monthlyFixed > 0) {
      add(header('長期の返済・毎月の支払い'));
      const lc = card();
      lc.append(h('div', { style: 'display:flex' },
        div('', txt('今月の定期支払い', 't13 t-sub'), money(s3.monthlyFixed, 22)),
        s3.loans.length ? h('div', { style: 'flex:1;padding-left:16px' }, txt('返済残高', 't13 t-sub'), money(sum(s3.loans, (l) => l.remainingTotal), 22)) : null));
      for (const l of s3.loans) {
        const entry = repo.data.entries.find((e) => e.id === l.entryId);
        const totalCount = entry && entry.endDate ? monthsBetween(entry.date, entry.endDate) + 1 : l.remainingCount;
        const paid = Math.max(0, totalCount - l.remainingCount);
        const ratio = totalCount > 0 ? paid / totalCount : 0;
        lc.append(h('div', { style: 'height:14px' }));
        lc.append(row(l.name, `月 ${yen(l.monthly)}`, { sub: `返済済み ${paid}/${totalCount}回（${Math.floor(ratio * 100)}%）・最終回 ${ymd(l.lastDate)}`, onClick: () => entry && editEntry(entry, entry.kind) }));
        lc.append(meter(ratio, `${l.name} 返済済み ${Math.floor(ratio * 100)}%`));
      }
      add(lc);
    }

    add(header('直近3か月の入出金'));
    const tc = card();
    if (!s3.timeline.length) tc.append(txt('確定した入出金はありません。', 't14 t-sub'));
    s3.timeline.forEach((r, i) => {
      if (i > 0) tc.append(divider());
      const o = r.occ;
      const moved = MonthlyLogic.shiftReason(o);
      tc.append(moneyRow(o.date, o.name, o.amount, o.kind === INCOME, `${accName(o.accountId)} 残高 ${yen(r.accountAfter)}${moved ? '・' + moved : ''}`,
        r.accountAfter < 0 ? 'var(--warn)' : null, () => openOccurrence(o.entryId, o.originalDate)));
    });
    add(tc);
    add(txt('銀行休業日：土日・祝日（振替休日を含む）・12/31〜1/3に対応。現金・電子マネー・交通系ICは日付を調整しません。', 'note', 'padding-left:4px'));
  }

  // ===================================================================
  // 内訳（振り返り）
  // ===================================================================
  function renderBreakdown(t) {
    add(pageTitle('内訳', '確定した記録と残高の差から集計'));
    add(segmented(['月', '年'], st.bdYearMode ? 1 : 0, (i) => { st.bdYearMode = i === 1; render(); }));
    const title = st.bdYearMode ? `${st.bdYear}年` : `${YM.y(st.bdMonth)}年${YM.m(st.bdMonth)}月`;
    add(h('div', { style: 'padding-top:4px' }, monthNav(title, false, (delta) => {
      if (st.bdYearMode) st.bdYear += delta; else st.bdMonth = YM.plus(st.bdMonth, delta);
      render();
    })));
    const [from, to] = st.bdYearMode ? BreakdownLogic.yearRange(st.bdYear) : BreakdownLogic.monthRange(st.bdMonth);
    const [pf, pt] = st.bdYearMode ? BreakdownLogic.yearRange(st.bdYear - 1) : BreakdownLogic.monthRange(YM.plus(st.bdMonth, -1));
    const b = BreakdownLogic.compute(repo.data, from, to, t);
    const prev = BreakdownLogic.compute(repo.data, pf, pt, t);

    const changed = BreakdownLogic.changedMonths(repo.data);
    if (Object.keys(changed).length) {
      const cur = BreakdownLogic.currentSeen(repo.data);
      const lines = Object.keys(changed).sort().map((k) => `${YM.y(k)}年${YM.m(k)}月：記録外の入出金 ${yen(changed[k])} → ${yen(cur[k] || 0)}`).join('\n');
      add(noticeCard('est', 'var(--est)', 'alert', '内訳を再計算しました', `${lines}\n過去の記録が追加されたため、再計算しました。`, '確認済みにする', () => { repo.acknowledgeUnrecordedChanges(); render(); }));
    }

    const unit = st.bdYearMode ? '年' : '月';
    const sm = card();
    sm.append(txt('収支', 't13 t-sub'));
    sm.append(money(b.net, 36, b.net < 0 ? 'var(--warn)' : 'var(--text)', true));
    sm.append(txt(`前${unit}比 ${signed(b.net - prev.net)}`, 't13 t-sub'));
    sm.append(h('div', { class: 'divider', style: 'margin:14px 0 12px' }));
    const stat = (l, v, pv, color) => h('div', { style: 'flex:1' }, txt(l, 't13 t-sub'), money(v, 22, color), txt(`前${unit}比 ${signed(v - pv)}`, 't12 t-sub'));
    sm.append(h('div', { style: 'display:flex' }, stat('収入', b.income, prev.income, 'var(--income)'), stat('支出', b.expense, prev.expense, 'var(--text)')));
    if (b.scheduledIncome > 0 || b.scheduledExpense > 0) sm.append(txt(`うち明日以降の予定：収入 ${yen(b.scheduledIncome)}・支出 ${yen(b.scheduledExpense)}`, 'note', 'padding-top:10px'));
    add(sm);

    if (st.bdYearMode) {
      const months = Array.from({ length: 12 }, (_, i) => YM.of(st.bdYear, i + 1));
      const per = months.map((m) => { const [f, tt] = BreakdownLogic.monthRange(m); return BreakdownLogic.compute(repo.data, f, tt, t); });
      const gc = card();
      gc.append(txt('月別の残高増減', 't16 b'));
      gc.append(legendRow([['var(--ch-blue)', '増加した月'], ['var(--ch-red)', '減少した月']]));
      gc.append(netBars(months.map((m) => `${YM.m(m)}月`), per.map((x) => x.income), per.map((x) => x.expense)));
      add(gc);
    }
    renderBreakdownItems('支出の内訳', b.expenseItems, b.expense);
    renderBreakdownItems('収入の内訳', b.incomeItems, b.income);
    add(txt('「記録外の出金」「記録外の入金」は、残高を確かめたときに、記録した入出金では説明できない差額です。差が出た置き場所（財布・銀行など）ごとに分けています。いつ動いたかまでは分からないため、後で確かめた日の月に入れます。過去の記録を追加すると計算し直します。', 'note', 'padding-left:4px'));
  }

  function renderBreakdownItems(title, items, total) {
    add(header(title));
    const c = card();
    if (!items.length) c.append(txt('この期間の記録はありません。', 't14 t-sub'));
    const max = Math.max(1, ...items.map((x) => x.amount));
    items.forEach((it, i) => {
      if (i > 0) c.append(h('div', { style: 'height:10px' }));
      const pct = total > 0 ? Math.floor(it.amount * 100 / total) : 0;
      const r = h('div', { class: 'tap', role: 'button', tabindex: 0, style: 'min-height:48px;padding:4px 0', onclick: () => showItemDetails(it) },
        h('div', { style: 'display:flex;align-items:center' }, h('div', { style: 'flex:1' }, it.label),
          h('span', { class: 't13 t-sub', style: 'padding-right:10px' }, pct === 0 && it.amount > 0 ? '1%未満' : `${pct}%`), h('span', { class: 'b' }, yen(it.amount))),
        h('div', { style: 'height:6px' }), meter(it.amount / max, `${it.label} ${yen(it.amount)}（${pct}%）`));
      c.append(r);
    });
    add(c);
  }

  function showItemDetails(item) {
    const body = div('form');
    if (item.note) body.append(txt(item.note, 't13 t-sub', 'padding-top:12px'));
    item.details.forEach((o, i) => {
      if (i > 0) body.append(divider());
      body.append(moneyRow(o.date, o.name, o.amount, o.kind === INCOME, accName(o.accountId)));
    });
    openSheet({ title: `${item.label}　${yen(item.amount)}`, body });
  }

  // ===================================================================
  // 口座（設定とデータ）
  // ===================================================================
  function renderAccounts(s, t) {
    const data = repo.data;
    add(pageTitle('口座', '残高・カード・予定'));
    const tc = card();
    tc.append(txt('推定残高の合計', 't13 t-sub'));
    tc.append(money(s.totalBalance, 32));
    tc.append(h('div', { style: 'padding-top:12px' }, btn('現在の残高をまとめて入力', 'primary', balances, 'block')));
    add(tc);

    add(header('お金の置き場所', '＋追加', () => editAccount(null)));
    const ac = card();
    if (!data.accounts.length) ac.append(txt('置き場所が登録されていません。', 't14 t-sub'));
    data.accounts.forEach((a, i) => {
      if (i > 0) ac.append(divider());
      const tags = [a.isDebit && '引き落とし', a.isSalary && '給与', a.isCash && '現金', a.isEmoney && '電子マネー', a.isIc && '交通系IC'].filter(Boolean);
      const est = s.currentByAccount[a.id] ?? a.balance;
      ac.append(row(a.name, yen(est), { sub: (tags.length ? tags.join('・') + '　' : '') + `${md(a.asOf)}時点 ${yen(a.balance)}` + (est !== a.balance ? ` → 推定 ${yen(est)}` : ''), onClick: () => editAccount(a) }));
    });
    add(ac);

    add(header('クレジットカード', '＋登録', () => editCard(null)));
    const cb = card();
    const active = data.cards.filter((c) => !c.retired), retired = data.cards.filter((c) => c.retired);
    if (!active.length) cb.append(txt('カードを登録すると、確定した請求額を入力するだけで、締め日と支払日から引き落とし日を自動で計算します。', 't14 t-sub'));
    active.forEach((c, i) => {
      if (i > 0) cb.append(divider());
      const closing = c.closingDay >= 31 ? '月末' : `${c.closingDay}日`;
      const last = data.bills.filter((b) => b.cardId === c.id).sort((a, b2) => K.cmpStr(b2.paymentDate, a.paymentDate))[0];
      cb.append(row(c.name, last ? yen(last.amount) : '', { sub: `${closing}締め・翌月${c.paymentDay}日払い・${accName(c.accountId)}` + (last ? `\n直近の確定分：${ymd(CardLogic.payDay(last.paymentDate))}` : ''), onClick: () => editCard(c) }));
    });
    if (retired.length) {
      cb.append(divider());
      cb.append(txt('使わなくなったカード（過去の請求は集計に残っています）', 't12 t-sub', 'padding:8px 0 4px'));
      retired.forEach((c) => cb.append(row(c.name, '', { sub: '使わない・押すと「また使う」を選べます', onClick: () => editCard(c) })));
    }
    add(cb);

    const recurring = data.entries.filter((e) => e.repeatMonthly);
    const upcoming = data.entries.filter((e) => !e.repeatMonthly && e.date >= t).sort((a, b) => K.cmpStr(a.date, b.date));
    const past = data.entries.filter((e) => !e.repeatMonthly && e.date < t).sort((a, b) => K.cmpStr(b.date, a.date));
    add(header('毎月の定期予定', '＋追加', () => editEntry(null, EXPENSE)));
    const rc = card();
    if (!recurring.length) rc.append(txt('奨学金・家賃・給与など、毎月同じ日に発生する入出金を登録すると、見通しに自動で反映されます。', 't14 t-sub'));
    const loans = new Map(s.loans.map((l) => [l.entryId, l]));
    recurring.slice().sort((a, b) => D.d(a.date) - D.d(b.date)).forEach((e, i) => {
      if (i > 0) rc.append(divider());
      const acc = data.accounts.find((a) => a.id === e.accountId);
      const next = BC.expand(e, D.plusDays(t, 1), D.plusMonths(t, 2), !!(acc && noBankDays(acc)))[0];
      const left = loans.has(e.id) ? `・残り${loans.get(e.id).remainingCount}回` : e.endDate == null ? '' : '・終了';
      const inc = e.kind === INCOME;
      rc.append(row(e.name, (inc ? '＋' : '−') + yen(e.amount), { rightColor: inc ? 'var(--income)' : 'var(--text)',
        sub: `毎月${D.d(e.date)}日` + (next ? `・次回 ${md(next.date)}` : '') + left + `・${accName(e.accountId)}`, onClick: () => editEntry(e, e.kind) }));
    });
    add(rc);

    add(header('1回限りの予定'));
    const uc = card();
    if (!upcoming.length) uc.append(txt('確定した給与や、日付の決まった引き落としが表示されます。', 't14 t-sub'));
    upcoming.forEach((e, i) => {
      if (i > 0) uc.append(divider());
      uc.append(moneyRow(e.date, e.name, e.amount, e.kind === INCOME, accName(e.accountId), null, () => openOccurrence(e.id)));
    });
    if (past.length) {
      uc.append(btn(st.showPast ? '過去の記録を隠す' : `過去の記録 ${past.length}件を表示（CSVに含まれます）`, 'text', () => { st.showPast = !st.showPast; render(); }));
      if (st.showPast) past.forEach((e) => { uc.append(divider()); uc.append(moneyRow(e.date, e.name, e.amount, e.kind === INCOME, accName(e.accountId), 'var(--sub)', () => openOccurrence(e.id))); });
    }
    add(uc);

    add(header('データの保存・引き継ぎ（CSV）'));
    const dc = card();
    dc.append(txt('確定した記録と今後1年の見通しを、1つのCSVファイルに書き出します。Claudeなどに送れば計画の相談に、別のスマホ（Android版を含む）で読み込めば引き継ぎに使えます。\n「送る・保存」を押すと共有の画面が開きます。控えを残すときは「\"ファイル\"に保存」を選んでください。', 't13 t-sub pre'));
    const last = pref.get('lastExport', null);
    dc.append(txt(last ? `最後に書き出した日：${ymd(last)}` : 'まだ書き出していません。データはこのiPhoneの中にだけあるので、ときどき控えを作ってください。', 't12', `padding-top:8px;color:${!last || D.between(last, t) >= 30 ? 'var(--est)' : 'var(--sub)'}`));
    dc.append(h('div', { style: 'padding-top:12px' }, btn('CSVを送る・保存', 'primary', shareCsv, 'block')));
    dc.append(div('btn-row', btn('中身をコピー', 'outline', copyCsv), btn('CSVを読み込む', 'outline', openCsv)));
    const kept = BudgetStore.legacyCount(data.legacy);
    if (kept > 0) dc.append(txt(`以前の版の仮入力など${kept}件は、計算対象から除外して端末内に保存しています（CSVには含まれません）。`, 'note'));
    add(dc);

    if (data.history.length) {
      add(btn(st.showHistory ? '変更履歴を閉じる' : `変更履歴を見る（${data.history.length}件）`, 'text', () => { st.showHistory = !st.showHistory; render(); }));
      if (st.showHistory) {
        const hc = card();
        data.history.slice(0, 30).forEach((x, i) => {
          if (i > 0) hc.append(h('div', { style: 'height:6px' }));
          hc.append(txt(x.at, 't12 t-sub'), txt(x.text, 't13'));
        });
        add(hc);
      }
    }
    add(txt(`版 ${APP_VERSION}（${PLATFORM}）`, 'note', 'padding-left:4px'));
  }

  // ===================================================================
  // CSV：共有・コピー・読み込み
  // ===================================================================
  function buildCsv() {
    const dup = CsvFormat.duplicateNames(repo.data);
    if (dup.length) { toast(`同じ名前の口座・カードがあります：${dup.join('、')}。名前を変えてから書き出してください`); return null; }
    return CsvFormat.export(repo.data, `${APP_VERSION}（${PLATFORM}）`, today(), BC.summarize(repo.data, today(), 12).timeline);
  }
  function shareCsv() {
    confirm('CSVを送りますか？', 'CSVには、口座の残高・収入（給与など）・支払いの予定が入っています。送り先を確かめてから送ってください。\n控えを残すときは「\"ファイル\"に保存」を選びます。', '送る・保存', async () => {
      const csv = buildCsv();
      if (csv == null) return;
      const name = `家計簿_${today()}.csv`;
      const file = new File([csv], name, { type: 'text/csv' });
      try {
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
          await navigator.share({ files: [file], title: name });
          pref.set('lastExport', today());
          render();
          return;
        }
      } catch (e) {
        if (e && e.name === 'AbortError') return;   // 共有の画面を閉じただけ
      }
      // 共有できない環境（PCなど）：ファイルとして保存する
      const url = URL.createObjectURL(file);
      const a = h('a', { href: url, download: name });
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      pref.set('lastExport', today());
      toast('CSVを保存しました');
      render();
    });
  }
  async function copyCsv() {
    const csv = buildCsv();
    if (csv == null) return;
    try {
      await navigator.clipboard.writeText(csv.slice(1));
      toast('CSVの中身をコピーしました。Claudeなどに貼り付けられます（口座の残高などが入っています）');
    } catch (e) { toast('コピーできませんでした'); }
  }
  function openCsv() {
    const f = h('input', { type: 'file', accept: '.csv,text/csv,text/plain,text/comma-separated-values', style: 'display:none' });
    f.addEventListener('change', async () => {
      const file = f.files && f.files[0];
      f.remove();
      if (!file) return;
      let text;
      try {
        const buf = await file.arrayBuffer();
        // UTF-8 で読めなければ、Excel の古い保存形式（Shift_JIS）として読む
        try { text = new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch (e) { text = new TextDecoder('shift_jis').decode(buf); }
      } catch (e) { toast('ファイルを開けませんでした'); return; }
      const r = CsvFormat.import(text);
      if (r.error) { notice('読み込めませんでした', `${r.line}行目：${r.message}\n\n現在のデータは変更していません。`); return; }
      const d = r.data;
      const summary = `口座${d.accounts.length}・カード${d.cards.length}・予定${d.entries.length}・請求${d.bills.length}`;
      confirm('CSVを読み込みますか？', `${summary} 件。\n現在のデータ（口座・カード・予定・請求）はすべて置き換わります。変更履歴は残り、直後であれば元に戻せます。`, '読み込む', () => {
        if (repo.replaceWithImport(d, summary)) toast('読み込みました'); else toast('保存できませんでした');
        render();
      });
    });
    document.body.append(f);
    f.click();
  }

  // ===================================================================
  // 入力：何を入力するかを選ぶ
  // ===================================================================
  function chooser() {
    const body = div('form', h('div', { style: 'height:12px' }));
    let sheet;
    const item = (ic, title, sub, f) => body.append(h('button', { class: 'choice', type: 'button', onclick: () => { sheet.close(); f(); } },
      div('ic', icon(ic, 22)), div('', div('ttl', title), div('s', sub))));
    item('in', '収入', '給与・副業・給付金・返金など（確定した金額と入金日）', () => income(null));
    item('out', '支出', '引き落とし・振込・現金での支払いなど（確定した金額と日付）', () => debit(null));
    item('card', 'カードの請求', '確定した請求額（引き落とし日は自動計算）', () => bill(null, null));
    item('plus', 'チャージ', '電子マネー・交通系ICへの入金（支出に二重計上しません）', charge);
    item('wallet', '預け入れ・引き出し', '銀行と現金の間のお金の移動（収入・支出に数えません）', transfer);
    item('wallet', '現在の残高', '銀行・現金・電子マネー・交通系ICの現在の残高', balances);
    body.append(txt('確定した内容だけを記録します。計画の相談には、「口座」タブのCSVをClaudeなどに渡してください。', 't12 t-sub'));
    sheet = openSheet({ title: '記録の種類を選択', body });
  }

  const isCashAccount = (id) => { const a = repo.data.accounts.find((x) => x.id === id); return !!(a && a.isCash); };
  const isNoShiftAccount = (id) => { const a = repo.data.accounts.find((x) => x.id === id); return !!(a && noBankDays(a)); };

  /** 口座を選ぶチップの列。 */
  function accountChips(accounts, selected, onPick) {
    const box = div('');
    const draw = () => { box.textContent = ''; box.append(chipRow(accounts.map((a) => chip(a.name, a.id === selected(), () => { onPick(a.id); draw(); })))); };
    draw();
    return box;
  }

  /** 日付の欄と、下に曜日・休日の調整を出す注意書き。 */
  function dateBlock(initial, kind, noShift) {
    const field = dateInput(initial);
    const note = div('field-note');
    const update = () => {
      const d = field.value;
      if (!D.valid(d)) note.textContent = '日付を選んでください';
      else if (noShift()) note.textContent = `${ymd(d)}（銀行以外のため、日付を調整しません）`;
      else if (BC.adjust(d, kind) !== d) note.textContent = `${ymd(d)} は銀行休業日のため、${ymd(BC.adjust(d, kind))} として計算します`;
      else note.textContent = ymd(d);
    };
    field.addEventListener('input', update);
    field.addEventListener('change', update);
    update();
    return { field, view: div('', field, note), refresh: update };
  }

  function save(e, lbl) {
    const okk = repo.upsertEntry(e, lbl);
    if (okk) { toast(`記録しました：${e.name} ${yen(e.amount)}（${ymd(e.date)}）`); render(); } else toast('保存できませんでした');
    return okk;
  }

  /** 二重に数えないための確認：同じ日・口座・向き・名前の1回きりの記録があれば置き換えるか聞く。 */
  function saveOrReplace(e, isNew, lbl, onDone) {
    const dup = isNew ? repo.data.entries.find((x) => !x.repeatMonthly && x.kind === e.kind && x.date === e.date && x.accountId === e.accountId && x.name === e.name) : null;
    if (!dup) return saveAskingBalance(e, isNew, lbl);
    confirm('同じ日の記録があります', `${ymd(e.date)}に「${dup.name} ${yen(dup.amount)}」が記録されています。\n二重計上を防ぐため、この入力（${yen(e.amount)}）で置き換えますか？`, '置き換える', () => {
      if (save({ ...e, id: dup.id }, lbl.replace(/：$/, '') + '（置き換え）：')) onDone();
    });
    return false;
  }

  /** 残高を確かめた日と同じ日の新しい記録は「確かめる前」として保存し、ホームのカードから並び順を直せるようにする。 */
  function saveAskingBalance(e, isNew, lbl) {
    const acc = repo.data.accounts.find((a) => a.id === e.accountId);
    if (!isNew || e.repeatMonthly || !acc || e.date > D.plusDays(acc.asOf, 7)) return save(e, lbl);
    const okk = repo.upsertEntry(e, lbl);
    if (okk) {
      // 銀行の休みで日付がずれる場合もあるので、実際に時点の日に動くかで判断する
      if (CheckOrder.itemsOn(repo.data, acc.id, acc.asOf).some((o) => o.entryId === e.id)) repo.balanceHint = e;
      toast(`記録しました：${e.name} ${yen(e.amount)}（${ymd(e.date)}）`);
      render();
    } else toast('保存できませんでした');
    return okk;
  }

  // ===================================================================
  // その日の流れ：その日の入出金と、残高を確かめたタイミング（口座ごと）を1本の時間軸に並べる。
  // 計算は口座ごと（その口座を確かめた位置より下の、その口座の入出金だけが「確かめた後」）
  // ===================================================================
  const ACC_COLORS = ['var(--s1)', 'var(--s2)', 'var(--s3)', 'var(--s4)', 'var(--s5)'];
  const accColor = (accId) => ACC_COLORS[Math.max(0, repo.data.accounts.findIndex((a) => a.id === accId)) % ACC_COLORS.length];

  /** その日の流れで、確かめた後に起きた入出金の key（その入出金の口座を、それより上で確かめているもの）。 */
  function flowAfter(layout) {
    const seen = new Set(), after = new Set();
    for (const it of layout) {
      if (it.type === 'check') seen.add(it.acc.id);
      else if (seen.has(it.occ.accountId)) after.add(CheckOrder.key(it.occ));
    }
    return after;
  }
  /** 確かめた口座ごとの「確かめた残高 → この日の終わりの残高」。 */
  function flowResults(layout) {
    const after = flowAfter(layout);
    return layout.filter((it) => it.type === 'check').map((c) => {
      const moved = sum(layout.filter((it) => it.type === 'item' && it.occ.accountId === c.acc.id && after.has(CheckOrder.key(it.occ))),
        (it) => (it.occ.kind === INCOME ? it.occ.amount : -it.occ.amount));
      return { acc: c.acc, amount: c.amount, moved, end: c.amount + moved };
    });
  }
  const markChecks = (layout) => {
    const checked = new Set(layout.filter((x) => x.type === 'check').map((x) => x.acc.id));
    return layout.map((x) => (x.type === 'item' ? { ...x, hasCheck: checked.has(x.occ.accountId) } : x));
  };
  /** 流れの1行（シートとホームのカードで共通）。左に口座の色の印（確かめた行は塗り、入出金は輪）。 */
  function flowRow(it, after, compact) {
    if (it.type === 'check') {
      return div('flow-row check' + (compact ? ' compact' : ''), h('i', { class: 'dot', style: `background:${accColor(it.acc.id)}` }),
        div('main', div('n', it.acc.name), div('s', '残高を確かめた')), div('amt', yen(it.amount)));
    }
    const o = it.occ, inc = o.kind === INCOME;
    return div('flow-row' + (compact ? ' compact' : ''), h('i', { class: 'dot ring', style: `border-color:${accColor(o.accountId)}` }),
      div('main', div('n', o.name), div('s', accName(o.accountId) + (it.hasCheck ? (after.has(CheckOrder.key(o)) ? '・確かめた後' : '・確かめる前') : ''))),
      h('div', { class: 'amt', style: `color:${inc ? 'var(--income)' : 'var(--text)'}` }, (inc ? '＋' : '−') + yen(o.amount)));
  }

  /** 残高を確かめた日のうち、入出金もある日（古い順）。 */
  function flowDates() {
    const ds = new Set([...repo.data.snapshots.map((s) => s.date), ...repo.data.accounts.map((a) => a.asOf)]);
    return [...ds].sort().filter((d) => CheckOrder.checksOn(repo.data, d).length && BC.occurrences(repo.data, d, d).length);
  }

  /** ホームのカード：その日の流れを小さく見せる。押すと並べ替えのシート。 */
  function flowCard(date, t) {
    const layout = markChecks(CheckOrder.dayLayout(repo.data, date));
    const after = flowAfter(layout);
    const c = h('div', { class: 'card flow-card tap', role: 'button', tabindex: 0, onclick: () => dayFlowSheet(date) });
    c.append(div('flow-head', div('', div('t13 t-sub', date === t ? '今日の流れ' : `${D.between(date, t)}日前の流れ`), div('t16 b', `${D.m(date)}月${D.d(date)}日（${dow(date)}）`)),
      h('span', { class: 'btn text' }, '並べ替える')));
    const mini = div('flow-list mini');
    const shown = layout.slice(0, 6);
    shown.forEach((it) => mini.append(flowRow(it, after, true)));
    c.append(div('flow-time top', '0時'), mini);
    if (layout.length > shown.length) c.append(txt(`ほか${layout.length - shown.length}件`, 't12 t-sub', 'padding:4px 0 0 30px'));
    c.append(div('flow-time', '24時'));
    return c;
  }

  function dayFlowSheet(date) {
    const order = markChecks(CheckOrder.dayLayout(repo.data, date));
    if (!order.length) return;
    const body = div('form flow-form');
    const list = h('div', { class: 'flow-list', role: 'list' });
    const result = div('flow-result');
    body.append(div('flow-time top', `${D.m(date)}月${D.d(date)}日（${dow(date)}）　0時`), list, div('flow-time', '24時'), result,
      txt('上から起きた順に並べます。行を長押しすると浮き上がり、指で動かせます。口座ごとに、その口座の残高を確かめた行より下の入出金を「確かめた後」として計算します。', 't12 t-sub', 'padding-top:12px'));
    const updateResult = () => {
      result.textContent = '';
      for (const r of flowResults(order)) {
        result.append(div('res', h('i', { class: 'dot', style: `background:${accColor(r.acc.id)}` }),
          div('main', div('n', r.acc.name), div('s', r.moved ? `確かめた ${yen(r.amount)}・確かめた後 ${signed(r.moved)}` : `確かめた ${yen(r.amount)}・確かめた後の入出金なし`)),
          div('amt', div('s', 'この日の終わり'), div('v', yen(r.end)))));
      }
    };
    const move = (from, to) => { if (to < 0 || to >= order.length || from === to) return; const [x] = order.splice(from, 1); order.splice(to, 0, x); draw(); };
    function draw() {
      list.textContent = '';
      const after = flowAfter(order);
      order.forEach((it, i) => {
        const r = flowRow(it, after, false);
        const lbl = it.type === 'check' ? `${it.acc.name}の残高を確かめた` : it.occ.name;
        r.setAttribute('role', 'listitem');
        r.setAttribute('aria-label', `${i + 1}番目：${lbl}`);
        r.append(div('ud', h('button', { type: 'button', 'aria-label': `${lbl}を上へ`, disabled: i === 0, onclick: () => move(i, i - 1) }, '▲'),
          h('button', { type: 'button', 'aria-label': `${lbl}を下へ`, disabled: i === order.length - 1, onclick: () => move(i, i + 1) }, '▼')),
          h('div', { class: 'grip', 'aria-hidden': 'true' }, '≡'));
        list.append(r);
      });
      updateResult();
    }
    makeSortable(list, move);
    draw();
    openSheet({ title: `${D.m(date)}/${D.d(date)} の流れ`, body, onSave: () => {
      const keys = order.map((x) => (x.type === 'check' ? CheckOrder.checkToken(x.acc.id) : CheckOrder.key(x.occ)));
      const okk = repo.setDayOrder(date, keys);
      if (okk) { toast('並び順を保存しました'); render(); } else toast('保存できませんでした');
      return okk;
    } });
  }

  /**
   * 長押しで浮かせて指で動かす並べ替え（iPhone のリマインダーと同じ感覚）。
   * 浮いた行は指に付いて動き、まわりの行は避けてすき間を開ける。離すとすき間に収まる。端では自動で画面が動く。
   * onDrop(from, to) で並びを変えて描き直してもらう。
   */
  function makeSortable(list, onDrop) {
    let g0 = null;   // 浮かせている間の状態
    const GAP = 8;
    function lift(el, y) {
      const rows = [...list.children];
      const sc = list.closest('.sheet-body') || document.scrollingElement;
      g0 = { el, rows, from: rows.indexOf(el), to: rows.indexOf(el), y0: y, y, s0: sc.scrollTop, sc, raf: 0,
        mids: rows.map((r) => { const b = r.getBoundingClientRect(); return b.top + b.height / 2 + sc.scrollTop; }),
        h: el.getBoundingClientRect().height + GAP };
      list.classList.add('dragging');
      el.classList.add('lifted');
      if (navigator.vibrate) navigator.vibrate(12);
      const tick = () => {
        if (!g0) return;
        const r = g0.sc === document.scrollingElement ? { top: 0, bottom: window.innerHeight } : g0.sc.getBoundingClientRect();
        if (g0.y < r.top + 70) g0.sc.scrollTop -= Math.ceil((r.top + 70 - g0.y) / 6);
        else if (g0.y > r.bottom - 70) g0.sc.scrollTop += Math.ceil((g0.y - (r.bottom - 70)) / 6);
        place();
        g0.raf = requestAnimationFrame(tick);
      };
      place();
      g0.raf = requestAnimationFrame(tick);
    }
    function place() {
      const { el, rows, from, mids, sc, s0, y0, y } = g0;
      const dy = (y + sc.scrollTop) - (y0 + s0);
      el.style.transform = `translateY(${dy}px) scale(1.03)`;
      const center = mids[from] + dy;
      let to = from;
      for (let i = 0; i < rows.length; i++) {
        if (i < from && center < mids[i]) to = Math.min(to, i);
        if (i > from && center > mids[i]) to = Math.max(to, i);
      }
      if (to !== g0.to && navigator.vibrate) navigator.vibrate(5);
      g0.to = to;
      rows.forEach((r, i) => {
        if (r === el) return;
        const shift = from < to && i > from && i <= to ? -g0.h : to < from && i >= to && i < from ? g0.h : 0;
        r.style.transform = shift ? `translateY(${shift}px)` : '';
      });
    }
    function drop() {
      if (!g0) return;
      cancelAnimationFrame(g0.raf);
      const { el, from, to } = g0;
      const before = el.getBoundingClientRect().top;
      g0 = null;
      list.classList.remove('dragging');
      el.classList.remove('lifted');
      [...list.children].forEach((r) => { r.style.transform = ''; });
      onDrop(from, to);
      // 指を離した位置から、収まる位置へすっと動かす
      const now = list.children[to];
      if (now) {
        now.style.transition = 'none';
        now.style.transform = `translateY(${before - now.getBoundingClientRect().top}px)`;
        void now.offsetHeight;
        now.style.transition = '';
        now.classList.add('settle');
        now.style.transform = '';
        setTimeout(() => now.classList.remove('settle'), 260);
      }
    }
    function gesture(el, sy, wait) {
      let timer = setTimeout(() => { timer = null; lift(el, sy); }, wait);
      return {
        move(ny) {
          if (timer) { if (Math.abs(ny - sy) > 8) { clearTimeout(timer); timer = null; } return false; }
          if (!g0) return false;
          g0.y = ny;
          place();   // 指が動いたらすぐ追う（端での自動スクロールは描き直しのたびに行う）
          return true;
        },
        end() { if (timer) clearTimeout(timer); drop(); },
      };
    }
    list.addEventListener('touchstart', (e) => {
      const el = e.target.closest('.flow-row');
      if (!el || e.target.closest('button') || e.touches.length > 1 || g0) return;
      const g = gesture(el, e.touches[0].clientY, 300);
      const tm = (ev) => { if (g.move(ev.touches[0].clientY)) ev.preventDefault(); };
      const te = () => { document.removeEventListener('touchmove', tm); document.removeEventListener('touchend', te); document.removeEventListener('touchcancel', te); g.end(); };
      document.addEventListener('touchmove', tm, { passive: false });
      document.addEventListener('touchend', te);
      document.addEventListener('touchcancel', te);
    }, { passive: true });
    list.addEventListener('mousedown', (e) => {
      const el = e.target.closest('.flow-row');
      if (!el || e.target.closest('button') || g0) return;
      const g = gesture(el, e.clientY, 200);
      const mm = (ev) => g.move(ev.clientY);
      const mu = () => { document.removeEventListener('mousemove', mm); document.removeEventListener('mouseup', mu); g.end(); };
      document.addEventListener('mousemove', mm);
      document.addEventListener('mouseup', mu);
    });
    list.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  function confirmDelete(e) {
    const t = today();
    if (e.repeatMonthly && e.date <= t) {
      choose(`「${e.name}」をどうしますか？`, [
        ['今後の予定を終了する', '今日より後の回だけ無くなります。過去の回は月ごとの集計に残ります（完済・解約のとき）'],
        ['過去の回も含めて削除する', '入力の間違いなど、最初から無かったことにするとき。過去の月の数字も変わります'],
      ], (i) => {
        const okk = i === 0 ? repo.endSeries(e.id, t) : repo.deleteEntry(e.id);
        if (!okk) toast('保存できませんでした');
        render();
      });
      return;
    }
    confirm(`「${e.name}」を削除しますか？`, e.repeatMonthly ? 'まだ始まっていない予定なので、過去の数字には影響しません（直後であれば元に戻せます）。' : '直後であれば元に戻せます。', '削除する', () => {
      if (!repo.deleteEntry(e.id)) toast('保存できませんでした');
      render();
    }, { danger: true });
  }

  // ===================================================================
  // 収入・支出
  // ===================================================================
  function income(e) {
    const data = repo.data, accounts = data.accounts, t = today();
    if (!accounts.length) { toast('先に「口座」タブで口座を追加してください'); return; }
    const lastIncome = data.entries.filter((x) => x.kind === INCOME && !x.repeatMonthly && !x.chargeFrom).sort((a, b) => K.cmpStr(b.date, a.date))[0];
    let defaultDate = t;
    if (e) defaultDate = e.date;
    else if (lastIncome) {
      const cand = CardLogic.dayIn(D.ym(t), D.d(lastIncome.date));
      defaultDate = cand < t ? CardLogic.dayIn(YM.plus(D.ym(t), 1), D.d(lastIncome.date)) : cand;
    }
    let accountId = e ? e.accountId : (accounts.find((a) => a.isSalary) || accounts[0]).id;
    const body = div('form');
    const amount = amountField(e && e.amount);
    const name = input('給与', e ? e.name : lastIncome ? lastIncome.name : '給与');
    const db = dateBlock(defaultDate, INCOME, () => isNoShiftAccount(accountId));
    body.append(label('手取り額（円）'), amount, label('入金日'), db.view, label('入金先'), accountChips(accounts, () => accountId, (id) => { accountId = id; db.refresh(); }), label('名前'), name);
    const rs = repeatSection(db.field, e, false);
    body.append(rs.el);
    openSheet({ title: e ? '収入を編集' : '収入', body, saveLabel: '記録する', keyboard: true, neutral: e ? ['削除', () => confirmDelete(e)] : null,
      onSave: (close) => {
        const v = parseYen(amount.value), dd = db.field.value, n = name.value.trim() || '入金';
        if (v == null || v <= 0) { toast('金額を入力してください'); return false; }
        if (!D.valid(dd)) { toast('日付を選んでください'); return false; }
        const ne = rs.apply({ id: e ? e.id : newId(), name: n, amount: v, date: dd, kind: INCOME, accountId, repeatMonthly: false, endDate: null, lastAmount: null, chargeFrom: null, changes: e ? e.changes || [] : [] });
        return ne ? saveOrReplace(ne, !e, '入金：', close) : false;
      } });
  }

  function debit(e) {
    const accounts = repo.data.accounts, t = today();
    if (!accounts.length) { toast('先に「口座」タブで口座を追加してください'); return; }
    let accountId = e ? e.accountId : (accounts.find((a) => a.isDebit) || accounts[0]).id;
    const body = div('form');
    const amount = amountField(e && e.amount);
    const name = input('例：電気代', e ? e.name : '');
    const db = dateBlock(e ? e.date : t, EXPENSE, () => isNoShiftAccount(accountId));
    body.append(label('金額（円）'), amount, label('引き落とし日'), db.view, label('支払元'), accountChips(accounts, () => accountId, (id) => { accountId = id; db.refresh(); }), label('名前'), name);
    const rs = repeatSection(db.field, e, false);
    body.append(rs.el);
    openSheet({ title: e ? '支出を編集' : '支出', body, saveLabel: '記録する', keyboard: true, neutral: e ? ['削除', () => confirmDelete(e)] : null,
      onSave: (close) => {
        const v = parseYen(amount.value), dd = db.field.value, n = name.value.trim() || '引き落とし';
        if (v == null || v <= 0) { toast('金額を入力してください'); return false; }
        if (!D.valid(dd)) { toast('日付を選んでください'); return false; }
        const ne = rs.apply({ id: e ? e.id : newId(), name: n, amount: v, date: dd, kind: EXPENSE, accountId, repeatMonthly: false, endDate: null, lastAmount: null, chargeFrom: null, changes: e ? e.changes || [] : [] });
        return ne ? saveOrReplace(ne, !e, '引き落とし：', close) : false;
      } });
  }

  // ===================================================================
  // カードの請求
  // ===================================================================
  function firstUnconfirmed(c) {
    const next = CardLogic.nextPayments(c, today(), 3);
    return next.find((p) => !CardLogic.confirmedBill(repo.data, c, p)) || next[0];
  }

  function bill(preCard, preRaw) {
    const data = repo.data, t = today();
    const cards = data.cards.filter((c) => !c.retired);
    if (!cards.length && !preCard) { toast('先に「口座」タブでカードを登録してください'); return; }
    let cd = preCard || cards[0];
    let raw = preRaw || firstUnconfirmed(cd);
    const body = div('form');
    const cardRow = div(''), payRow = div(''), info = txt('', 't13', 'padding-top:8px');
    const amount = amountField((CardLogic.confirmedBill(data, cd, raw) || {}).amount);
    const payLabel = label('');
    const rebuild = () => {
      cardRow.textContent = '';
      if (cards.length > 1) cardRow.append(chipRow(cards.map((x) => chip(x.name, x.id === cd.id, () => { cd = x; raw = firstUnconfirmed(x); amount.value = (CardLogic.confirmedBill(data, cd, raw) || {}).amount ?? ''; rebuild(); }))));
      payLabel.textContent = cards.length > 1 ? '引き落とし日' : `${cd.name}の引き落とし日`;
      payRow.textContent = '';
      const pays = [...new Set([...CardLogic.nextPayments(cd, t, 3), raw])].sort();
      payRow.append(chipRow(pays.map((p) => {
        const done = CardLogic.confirmedBill(data, cd, p);
        return chip(`${ymd(CardLogic.payDay(p))} 引き落とし` + (done ? `（確定済み ${yen(done.amount)}）` : ''), p === raw, () => {
          raw = p; amount.value = (CardLogic.confirmedBill(data, cd, p) || {}).amount ?? ''; rebuild();
        });
      }), 'col'));
      const closing = CardLogic.closingFor(cd, raw);
      const prev = data.bills.filter((b) => b.cardId === cd.id && b.paymentDate < raw).sort((a, b) => K.cmpStr(b.paymentDate, a.paymentDate))[0];
      info.textContent = `${ymd(closing)}締めの請求` + (closing > t ? '（締め日前のため、請求額は未確定です）' : '') +
        (prev ? `\n前回の請求額：${md(CardLogic.payDay(prev.paymentDate))} ${yen(prev.amount)}` : '');
      info.className = 't13 pre';
      info.style.color = closing > t ? 'var(--est)' : 'var(--sub)';
    };
    rebuild();
    body.append(label('確定した請求額（円）'), amount);
    if (cards.length > 1) body.append(label('カード'), cardRow);
    body.append(payLabel, payRow, info);
    openSheet({ title: 'カードの請求', body, saveLabel: '記録する', keyboard: true,
      neutral: CardLogic.confirmedBill(data, cd, raw) ? ['この請求を削除', () => {
        if (!CardLogic.confirmedBill(repo.data, cd, raw)) { toast('この請求はまだ確定していません'); return; }
        confirm(`${cd.name}の${md(CardLogic.payDay(raw))}の請求を削除しますか？`, '直後であれば元に戻せます。', '削除する', () => {
          if (!repo.deleteBill(cd, raw)) toast('保存できませんでした');
          render();
        }, { danger: true });
      }] : null,
      onSave: () => {
        const v = parseYen(amount.value);
        if (v == null || v < 0) { toast('請求額を入力してください'); return false; }
        const okk = repo.setBill(cd, raw, v, t);
        if (okk) { toast(`記録しました：${cd.name} ${md(CardLogic.payDay(raw))}引き落とし ${yen(v)}`); render(); } else toast('保存できませんでした');
        return okk;
      } });
  }

  // ===================================================================
  // チャージ・預け入れ／引き出し（振替）
  // ===================================================================
  function charge() {
    const data = repo.data, t = today();
    const dests = data.accounts.filter(isPrepaid);
    if (!dests.length) { toast('先に「口座」タブで、電子マネーか交通系ICを追加してください（種類を選べます）'); return; }
    let destId = dests[0].id;
    const sources = [...data.cards.filter((c) => !c.retired).map((c) => ['card:' + c.id, `${c.name}（カード）`]), ...data.accounts.filter((a) => !isPrepaid(a)).map((a) => ['acc:' + a.id, a.name])];
    if (!sources.length) { toast('支払元（カード・銀行・現金）が登録されていません'); return; }
    let src = sources[0][0];
    const body = div('form');
    const amount = amountField(null);
    const dateF = dateInput(t);
    const destRow = div(''), srcRow = div(''), note = div('field-note');
    const draw = () => {
      destRow.textContent = ''; destRow.append(chipRow(dests.map((d) => chip(d.name, d.id === destId, () => { destId = d.id; draw(); }))));
      srcRow.textContent = ''; srcRow.append(chipRow(sources.map(([k, l]) => chip(l, k === src, () => { src = k; draw(); }))));
      note.textContent = src.startsWith('card:') ? 'カードの請求額に含まれます。内訳では二重計上を防ぐため、請求額からこのチャージ分を差し引き、チャージ先で使った分を支出として扱います。'
        : '支払元の残高が減り、チャージ先の残高が増えます。内訳では支出に数えません。';
    };
    draw();
    body.append(label('チャージ金額（円）'), amount, label('チャージ日'), dateF, label('チャージ先'), destRow, label('支払元'), srcRow, note);
    openSheet({ title: 'チャージ', body, saveLabel: '記録する', keyboard: true, onSave: () => {
      const v = parseYen(amount.value), dd = dateF.value;
      if (v == null || v <= 0) { toast('金額を入力してください'); return false; }
      if (!D.valid(dd)) { toast('日付を選んでください'); return false; }
      const srcName = sources.find((x) => x[0] === src)[1].replace(/（カード）$/, '');
      return save({ id: newId(), name: `チャージ（${srcName}から）`, amount: v, date: dd, kind: INCOME, accountId: destId, repeatMonthly: false, endDate: null, lastAmount: null, chargeFrom: src, changes: [] }, 'チャージ：');
    } });
  }

  function transfer() {
    const accounts = repo.data.accounts, t = today();
    if (accounts.length < 2) { toast('先に「口座」タブで、銀行と現金の置き場所を追加してください'); return; }
    let fromId = (accounts.find((a) => !noBankDays(a)) || accounts[0]).id;
    let toId = (accounts.find((a) => a.isCash && a.id !== fromId) || accounts.find((a) => a.id !== fromId)).id;
    const body = div('form');
    const amount = amountField(null);
    const dateF = dateInput(t);
    const fromRow = div(''), toRow = div(''), note = div('field-note');
    const kindName = () => {
      const f = accounts.find((a) => a.id === fromId), to = accounts.find((a) => a.id === toId);
      return to.isCash && !noBankDays(f) ? '引き出し' : f.isCash && !noBankDays(to) ? '預け入れ' : 'お金の移動';
    };
    const draw = () => {
      fromRow.textContent = ''; fromRow.append(chipRow(accounts.map((x) => chip(x.name, x.id === fromId, () => { if (x.id === toId) toId = fromId; fromId = x.id; draw(); }))));
      toRow.textContent = ''; toRow.append(chipRow(accounts.map((x) => chip(x.name, x.id === toId, () => { if (x.id === fromId) fromId = toId; toId = x.id; draw(); }))));
      note.textContent = `${kindName()}として記録します。移動元の残高が減り、移動先の残高が増えます。内訳では入金にも出金にも数えません。`;
    };
    draw();
    body.append(label('金額（円）'), amount, label('日付'), dateF, label('移動元'), fromRow, label('移動先'), toRow, note);
    openSheet({ title: '預け入れ・引き出し', body, saveLabel: '記録する', keyboard: true, onSave: () => {
      const v = parseYen(amount.value), dd = dateF.value;
      if (v == null || v <= 0) { toast('金額を入力してください'); return false; }
      if (!D.valid(dd)) { toast('日付を選んでください'); return false; }
      if (fromId === toId) { toast('移動元と移動先に別の置き場所を選んでください'); return false; }
      const k = kindName();
      return save({ id: newId(), name: `${k}（${accName(fromId)}→${accName(toId)}）`, amount: v, date: dd, kind: INCOME, accountId: toId, repeatMonthly: false, endDate: null, lastAmount: null, chargeFrom: 'acc:' + fromId, changes: [] }, `${k}：`);
    } });
  }

  // ===================================================================
  // 現在の残高・枚数で数える・訂正
  // ===================================================================
  function balances() {
    const t = today();
    const currentById = BC.summarize(repo.data, t).currentByAccount;
    const accounts = repo.data.accounts;
    if (!accounts.length) { toast('先に口座を追加してください'); return; }
    const body = div('form');
    body.append(txt('確かめた置き場所だけ入力すれば保存できます（財布だけ、など）。空欄の置き場所は変わりません。', 't13 t-sub', 'padding-top:12px'));
    let sheet;
    const fields = accounts.map((acc) => {
      const est = currentById[acc.id] ?? acc.balance;
      const si = signedInput('現在の残高');
      const ago = D.between(acc.asOf, t);
      const base = `推定残高 ${yen(est)}・最後に確かめた日 ${md(acc.asOf)}` + (ago >= 30 ? `（${ago}日前）` : '');
      const diff = txt(base, 't13 t-sub pre');
      si.input.addEventListener('input', () => {
        const v = parseYen(si.input.value);
        diff.textContent = base + (v != null ? `\n差 ${signed(v - est)}` : '');
        diff.style.color = v != null && v !== est ? 'var(--accent)' : 'var(--sub)';
      });
      body.append(div('place', div('head', div('n', acc.name), h('span', { class: 'badge' }, kindLabel(acc))), diff, si.el,
        div('actions', acc.isCash ? btn('枚数で数える', 'text', () => countCash((v) => { si.input.value = String(v); si.input.dispatchEvent(new Event('input')); })) : null,
          btn(`${md(acc.asOf)}時点を訂正`, 'text', () => correctBalance(acc, () => sheet.close())))));
      return [acc, si.input];
    });
    sheet = openSheet({ title: '現在の残高', body, saveLabel: '記録する', keyboard: true, onSave: () => {
      const changes = {};
      for (const [acc, f] of fields) {
        const tt = f.value.trim();
        if (!tt) continue;
        const v = parseYen(tt);
        if (v == null) { toast(`${acc.name}の金額を数字で入力してください`); return false; }
        changes[acc.id] = v;
      }
      if (!Object.keys(changes).length) { toast('金額が入力されていません'); return false; }
      const okk = repo.updateBalances(changes, t, currentById);
      if (okk) { toast('残高を更新しました（今日時点）'); render(); } else toast('保存できませんでした');
      return okk;
    } });
  }

  function countCash(onTotal) {
    const denoms = [10000, 5000, 2000, 1000, 500, 100, 50, 10, 5, 1];
    const body = div('form');
    const total = txt('合計 0円', 't18 b', 'padding:12px 0 8px');
    body.append(total);
    const fields = denoms.map((d) => {
      const f = numberInput('0');
      body.append(div('cash-row', div('d', `${num(d)}円 ×`), f, h('span', { class: 't14 t-sub' }, '枚')));
      return [d, f];
    });
    const sm = () => sum(fields, ([d, f]) => d * (parseInt2(f.value) || 0));
    fields.forEach(([, f]) => f.addEventListener('input', () => { total.textContent = `合計 ${yen(sm())}`; }));
    openSheet({ title: '枚数で数える', body, saveLabel: 'この金額を使う', keyboard: true, onSave: () => { onTotal(sm()); return true; } });
  }

  function correctBalance(acc, onDone) {
    const body = div('form');
    body.append(txt(`${ymd(acc.asOf)}時点の残高として記録した ${yen(acc.balance)} を、正しい金額に直します。日付は変わりません。記録外の入出金も計算し直されます。`, 't13 t-sub', 'padding-top:12px'));
    const si = signedInput('正しい金額（円）');
    body.append(label('正しい金額（円）'), si.el);
    if (acc.isCash) body.append(btn('枚数で数える', 'text', () => countCash((v) => { si.input.value = String(v); })));
    openSheet({ title: '残高の訂正', body, saveLabel: '訂正する', keyboard: true, onSave: () => {
      const v = parseYen(si.input.value);
      if (v == null) { toast('金額を数字で入力してください'); return false; }
      if (repo.correctLastBalance(acc.id, v)) { toast(`${acc.name}の${md(acc.asOf)}時点の残高を ${yen(v)} に訂正しました`); onDone(); render(); return true; }
      toast('保存できませんでした');
      return false;
    } });
  }

  // ===================================================================
  // 設定：口座・カード・決まっている予定
  // ===================================================================
  function editAccount(acc) {
    const kinds = ['銀行', '現金', '電子マネー', '交通系IC'];
    let kind = acc ? (acc.isCash ? 1 : acc.isEmoney ? 2 : acc.isIc ? 3 : 0) : 0;
    const t = today();
    const body = div('form');
    const kindRow = div('');
    const name = input('例：○○銀行、財布、PayPay、ICOCA', acc ? acc.name : '');
    const bal = signedInput('残高（円）', acc ? String(acc.balance) : '', '');
    const debitT = toggle('引き落としに使う（カード・奨学金など）', acc && acc.isDebit);
    const salaryT = toggle('給与の入金先', acc && acc.isSalary);
    const drawKind = () => {
      kindRow.textContent = '';
      kindRow.append(chipRow(kinds.map((k, i) => chip(k, i === kind, () => { kind = i; drawKind(); }))));
      debitT.el.style.display = kind === 0 ? '' : 'none';
      salaryT.el.style.display = kind === 0 ? '' : 'none';
    };
    drawKind();
    body.append(label('種類'), kindRow, label('名前'), name, label('残高（今日時点）'), bal.el);
    if (acc) body.append(txt(`現在の記録：${ymd(acc.asOf)}時点 ${yen(acc.balance)}。金額を変更すると、今日時点の残高として保存します。`, 'note'));
    body.append(debitT.el, salaryT.el, txt('現金・電子マネー・交通系ICは、銀行休業日による日付の調整をしません。', 'note'));
    openSheet({ title: acc ? 'お金の置き場所を編集' : 'お金の置き場所を追加', body,
      neutral: acc ? ['削除', () => {
        const used = repo.data.entries.filter((e) => e.accountId === acc.id).length + repo.data.cards.filter((c) => c.accountId === acc.id).length;
        confirm(`「${acc.name}」を削除しますか？`, used > 0 ? `この口座を使う予定・カードが${used}件あります。` : '', '削除する', () => {
          if (!repo.deleteAccount(acc.id)) toast('保存できませんでした');
          render();
        }, { danger: true });
      }] : null,
      onSave: () => {
        const n = name.value.trim(), v = parseYen(bal.input.value);
        if (!n) { toast('名前を入力してください'); return false; }
        if (repo.accountNameTaken(n, acc && acc.id)) { toast('同じ名前が登録済みです（CSVでは名前で区別するため、別の名前にしてください）'); return false; }
        if (v == null) { toast('残高を数字で入力してください'); return false; }
        const asOf = acc && acc.balance === v ? acc.asOf : t;
        const bank = kind === 0;
        const okk = repo.upsertAccount({ id: acc ? acc.id : newId(), name: n, balance: v, asOf, isDebit: bank && debitT.input.checked, isSalary: bank && salaryT.input.checked,
          isCash: kind === 1, isEmoney: kind === 2, isIc: kind === 3 });
        if (okk) render(); else toast('保存できませんでした');
        return okk;
      } });
  }

  function editCard(c) {
    const accounts = repo.data.accounts.filter((a) => !noBankDays(a));
    if (!accounts.length) { toast('先に引き落とし口座を登録してください'); return; }
    let accountId = c ? c.accountId : (accounts.find((a) => a.isDebit) || accounts[0]).id;
    const body = div('form');
    const name = input('例：楽天カード', c ? c.name : '');
    const closing = numberInput('1〜31（31は月末）', c ? String(c.closingDay) : '');
    const payment = numberInput('1〜31', c ? String(c.paymentDay) : '');
    const presets = [['楽天カード（月末締め・翌月27日）', 31, 27], ['エポス（27日締め・翌月27日）', 27, 27], ['エポス（4日締め・翌月4日）', 4, 4]];
    body.append(label('よくある設定から選ぶ'), chipRow(presets.map(([l, cl, pa]) => chip(l, false, () => {
      if (!name.value.trim()) name.value = l.split('（')[0];
      closing.value = String(cl); payment.value = String(pa);
    }))));
    body.append(txt('締め日・支払日はカード会社の会員ページで確認してください。', 'note'));
    body.append(label('名前'), name, label('締め日'), closing, label('支払日（締めの翌月）'), payment, label('引き落とし口座'), accountChips(accounts, () => accountId, (id) => { accountId = id; }));
    if (c) body.append(txt('口座を変えると、これから引き落とされる請求だけが新しい口座になります。引き落とし済みの請求は元の口座のままです。', 'note'));
    let neutral = null;
    if (c && c.retired) neutral = ['また使う', () => { if (!repo.reviveCard(c.id)) toast('保存できませんでした'); render(); }];
    else if (c && repo.data.bills.some((b) => b.cardId === c.id)) neutral = ['使わない', () => confirm(`「${c.name}」を使わないにしますか？`, 'カードの一覧と未確定の請求からは消えます。確定した請求は、引き落とした月・口座の集計にそのまま残ります。', '使わない', () => {
      if (!repo.deleteCard(c.id)) toast('保存できませんでした');
      render();
    })];
    else if (c) neutral = ['削除', () => confirm(`「${c.name}」を削除しますか？`, '確定した請求はまだ無いので、集計には影響しません。', '削除する', () => {
      if (!repo.deleteCard(c.id)) toast('保存できませんでした');
      render();
    }, { danger: true })];
    openSheet({ title: c ? 'カードを編集' : 'カードを登録', body, neutral, onSave: () => {
      const n = name.value.trim(), cl = parseInt2(closing.value), pa = parseInt2(payment.value);
      if (!n) { toast('名前を入力してください'); return false; }
      if (repo.cardNameTaken(n, c && c.id)) { toast('同じ名前のカードがあります'); return false; }
      if (cl == null || cl < 1 || cl > 31) { toast('締め日を1〜31で入力してください'); return false; }
      if (pa == null || pa < 1 || pa > 31) { toast('支払日を1〜31で入力してください'); return false; }
      const okk = repo.upsertCard({ id: c ? c.id : newId(), name: n, closingDay: cl, paymentDay: pa, accountId, retired: c ? !!c.retired : false }, today());
      if (okk) render(); else toast('保存できませんでした');
      return okk;
    } });
  }

  /** 「毎月繰り返す」と、オンのときだけ出る詳細（回数・最終回の日付・最終回の金額）。 */
  function repeatSection(dateField, e, defaultOn) {
    const rep = toggle('毎月繰り返す', e ? e.repeatMonthly : defaultOn);
    const box = div('');
    const count = numberInput('空欄の場合は無期限');
    const endField = dateInput(e && e.endDate);
    const lastAmount = numberInput('通常と同じなら空欄', e && e.lastAmount != null ? String(e.lastAmount) : '');
    const preview = div('field-note');
    const clearEnd = btn('最終回の日付を消す', 'text', () => { endField.value = ''; onEnd(); });
    box.append(txt('毎月、開始日と同じ日に繰り返します。', 't12 t-sub'), label('繰り返す回数（開始日を含む）'), count,
      label('または、最終回の日付'), endField, clearEnd, label('最終回の金額（異なる場合のみ）'), lastAmount, preview);
    const updatePreview = () => {
      const start = dateField.value, end = endField.value;
      preview.textContent = !D.valid(start) ? '' : !D.valid(end) ? '最終回：なし（無期限）' : end < start ? '⚠ 最終回が開始日より前です' : `最終回：${ymd(end)}（全${monthsBetween(start, end) + 1}回）`;
    };
    // 回数を入れたら最後の日を、最後の日を入れたら回数を計算する
    count.addEventListener('input', () => {
      const start = dateField.value, n = parseInt2(count.value);
      if (!D.valid(start)) return;
      endField.value = n && n > 0 ? nthDate(start, n) : '';
      updatePreview();
    });
    function onEnd() {
      const start = dateField.value, end = endField.value;
      count.value = D.valid(start) && D.valid(end) && end >= start ? String(monthsBetween(start, end) + 1) : '';
      updatePreview();
    }
    endField.addEventListener('change', onEnd);
    endField.addEventListener('input', onEnd);
    const onStart = () => {
      const start = dateField.value, n = parseInt2(count.value);
      if (D.valid(start) && n && n > 0) endField.value = nthDate(start, n);
      updatePreview();
    };
    dateField.addEventListener('change', onStart);
    dateField.addEventListener('input', onStart);
    if (e && e.endDate) count.value = String(monthsBetween(e.date, e.endDate) + 1);
    const show = () => { box.style.display = rep.input.checked ? '' : 'none'; };
    rep.input.addEventListener('change', show);
    show(); updatePreview();
    return {
      el: div('', rep.el, box),
      apply(base) {
        if (!rep.input.checked) return { ...base, repeatMonthly: false, endDate: null, lastAmount: null };
        const end = endField.value || null;
        const lt = lastAmount.value.trim(), last = parseYen(lt);
        if (end && !D.valid(end)) { toast('最終回の日付を選び直してください'); return null; }
        if (end && end < base.date) { toast('最終回が開始日より前です'); return null; }
        if (lt && (last == null || last <= 0)) { toast('最終回の金額を数字で入力してください'); return null; }
        return { ...base, repeatMonthly: true, endDate: end, lastAmount: end ? last : null };
      },
    };
  }

  /** 毎月の予定の行を押したとき：どの範囲を変えるか（この回だけ／この回以降／すべて）。 */
  function chooseScope(e, originalDate) {
    const first = originalDate === e.date;
    choose(`${e.name}（${md(originalDate)}の回）`, [['この回だけ変更', '日付・金額を変える、または飛ばす'], ['この回以降を変更', ''], ['すべての回を変更', '']], (i) => {
      if (i === 0) occurrence(e, originalDate);
      else if (i === 1) { if (first) editEntry(e, e.kind); else editEntry({ ...e, id: newId(), date: originalDate }, e.kind, e); }
      else editEntry(e, e.kind);
    });
  }

  function occurrence(e, originalDate) {
    const noShift = isNoShiftAccount(e.accountId);
    const [nomDate, nomAmount] = BC.nominal(e, originalDate, noShift);
    const cur = (e.changes || []).find((c) => c.originalDate === originalDate);
    const body = div('form');
    body.append(txt(`予定どおりなら ${ymd(nomDate)}・${yen(nomAmount)}`, 't13 t-sub', 'padding-top:12px'));
    const amount = amountField(cur && cur.amount != null ? cur.amount : nomAmount);
    const dateF = dateInput((cur && cur.date) || nomDate);
    const skip = toggle('この回は無し（飛ばす）', cur && cur.skipped);
    const fields = div('', label('日付'), dateF, label('金額（円）'), amount,
      txt(`払えなかった分を翌月にまとめる場合は、日付を翌月にしてください（翌月に「${D.m(originalDate)}月分」として出ます）。`, 'note'));
    const show = () => { fields.style.display = skip.input.checked ? 'none' : ''; };
    skip.input.addEventListener('change', show);
    show();
    body.append(fields, skip.el);
    openSheet({ title: 'この回だけ変更', body,
      neutral: cur ? ['予定どおりに戻す', () => { if (repo.setOccurrenceChange(e.id, originalDate, null)) { toast('予定どおりに戻しました'); render(); } else toast('保存できませんでした'); }] : null,
      onSave: () => {
        let change;
        if (skip.input.checked) change = { originalDate, date: null, amount: null, skipped: true };
        else {
          const v = parseYen(amount.value), dd = dateF.value;
          if (v == null || v <= 0) { toast('金額を入力してください'); return false; }
          if (!D.valid(dd)) { toast('日付を選んでください'); return false; }
          change = dd === nomDate && v === nomAmount ? null : { originalDate, date: dd === nomDate ? null : dd, amount: v === nomAmount ? null : v, skipped: false };
        }
        const okk = repo.setOccurrenceChange(e.id, originalDate, change);
        if (okk) { toast(change == null ? '予定どおりに戻しました' : 'この回だけ変更しました'); render(); } else toast('保存できませんでした');
        return okk;
      } });
  }

  function editEntry(e, kindIn, splitFrom) {
    const accounts = repo.data.accounts;
    if (!accounts.length) { toast('先に口座を追加してください'); return; }
    let kind = e ? e.kind : kindIn;
    let accountId = e ? e.accountId : (accounts.find((a) => (kind === INCOME ? a.isSalary : a.isDebit)) || accounts[0]).id;
    const body = div('form', h('div', { style: 'height:12px' }));
    const kindRow = div(''), accRow = div('');
    const name = input('例：奨学金、家賃', e ? e.name : '');
    const amount = numberInput('円', e ? String(e.amount) : '');
    const dateF = dateInput(e ? e.date : today());
    const drawAcc = () => { accRow.textContent = ''; accRow.append(accountChips(accounts, () => accountId, (id) => { accountId = id; })); };
    const rebuildKind = () => {
      kindRow.textContent = '';
      kindRow.append(chipRow([
        chip('出金（引き落とし）', kind === EXPENSE, () => { kind = EXPENSE; if (!e) accountId = (accounts.find((a) => a.isDebit) || accounts[0]).id; rebuildKind(); drawAcc(); }),
        chip('入金', kind === INCOME, () => { kind = INCOME; if (!e) accountId = (accounts.find((a) => a.isSalary) || accounts[0]).id; rebuildKind(); drawAcc(); }),
      ]));
    };
    rebuildKind(); drawAcc();
    const rs = repeatSection(dateF, e, !e);
    body.append(kindRow, label('名前'), name, label('金額'), amount, label('日付（繰り返す場合は初回）'), dateF, label('口座'), accRow, rs.el,
      txt('土日・祝日や年末年始に当たる場合、引き落としは次の営業日、入金は前の営業日として計算します。', 'note'));
    openSheet({ title: splitFrom ? `${md(e.date)}の回以降を変更` : e ? '予定を編集' : '予定を追加', body,
      neutral: e && !splitFrom ? ['削除', () => confirmDelete(e)] : null,
      onSave: () => {
        const n = name.value.trim(), v = parseYen(amount.value), date = dateF.value;
        if (!n) { toast('名前を入力してください'); return false; }
        if (v == null || v <= 0) { toast('金額を1円以上の数字で入力してください'); return false; }
        if (!D.valid(date)) { toast('日付を選んでください'); return false; }
        // 振替の払い元と「この回だけ」の変更は引き継ぐ（編集で消さない）
        const ne = rs.apply({ id: e ? e.id : newId(), name: n, amount: v, date, kind, accountId, repeatMonthly: false, endDate: null, lastAmount: null,
          chargeFrom: e ? e.chargeFrom : null, changes: e ? e.changes || [] : [] });
        if (!ne) return false;
        if (splitFrom) {
          const okk = repo.splitSeries(splitFrom, e.date, ne);
          if (okk) { toast(`${md(e.date)}の回以降を変更しました`); render(); } else toast('保存できませんでした');
          return okk;
        }
        return save(ne, '予定：');
      } });
  }

  // ===================================================================
  // 起動
  // ===================================================================
  function trackViewport() {
    const vv = window.visualViewport;
    const set = () => {
      const hgt = vv ? vv.height : window.innerHeight;
      document.documentElement.style.setProperty('--vvh', hgt + 'px');
      document.documentElement.style.setProperty('--vvtop', (vv ? vv.offsetTop : 0) + 'px');
    };
    set();
    if (vv) { vv.addEventListener('resize', set); vv.addEventListener('scroll', set); }
    window.addEventListener('resize', set);
  }

  /** ホームでは左右のスワイプで前後の月へ（縦のスクロールは邪魔しない）。 */
  function trackSwipe() {
    let sx = 0, sy = 0, on = false;
    document.addEventListener('touchstart', (e) => {
      on = st.tab === 'home' && !layer().children.length && e.touches.length === 1 && !e.target.closest('.chips');
      if (on) { sx = e.touches[0].clientX; sy = e.touches[0].clientY; }
    }, { passive: true });
    document.addEventListener('touchend', (e) => {
      if (!on) return;
      on = false;
      const t = e.changedTouches[0];
      const dx = t.clientX - sx, dy = t.clientY - sy;
      if (Math.abs(dx) < 70 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
      st.homeMonth = YM.plus(st.homeMonth, dx < 0 ? 1 : -1);
      render();
    }, { passive: true });
  }

  /** 新しい版が届いたら知らせる（オフラインでも動くよう、前の版を手元に置いている）。 */
  function registerServiceWorker() {
    if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
    navigator.serviceWorker.register('sw.js').then((reg) => {
      const offer = (w) => {
        if (!w || !navigator.serviceWorker.controller) return;
        dialog('新しい版があります', '更新すると、画面が新しくなります。入れたデータはそのまま残ります。', [['あとで', null], ['更新する', () => { w.postMessage('skipWaiting'); }, 'b']]);
      };
      if (reg.waiting) offer(reg.waiting);
      reg.addEventListener('updatefound', () => {
        const w = reg.installing;
        if (w) w.addEventListener('statechange', () => { if (w.state === 'installed') offer(w); });
      });
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reg.update().catch(() => {}); });
    }).catch(() => {});
    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (!reloaded) { reloaded = true; location.reload(); } });
  }

  function start() {
    trackViewport();
    // index.html#forecast のように、開くタブを指定できる
    const hashTab = location.hash.slice(1);
    if (['home', 'forecast', 'breakdown', 'accounts'].includes(hashTab)) st.tab = hashTab;
    repo.load(today());
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
    trackSwipe();
    // 日付が変わったら（夜にアプリを開いたままにしていた場合など）描き直す
    let shown = today();
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && today() !== shown) { shown = today(); st.homeMonth = D.ym(shown); render(); }
    });
    let lastW = document.documentElement.clientWidth;
    window.addEventListener('resize', () => { const w = document.documentElement.clientWidth; if (w !== lastW && !layer().children.length) { lastW = w; render(); } });
    render();
    registerServiceWorker();
  }
  start();
})();
