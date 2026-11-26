/*
 * 家計簿 iPhone版：印刷・PDF用のレポート（A4縦）。Android版 ui/Report.kt と同じ中身。
 * 月：1 要約／2 月の収支（内訳・入出金）／3 見通し（グラフ・表）／4 返済・定期と注記
 * 年：1 年の要約（12か月の表・増減グラフ）／2 年の内訳／3 見通し／4 返済・定期と注記
 * プロの月次報告の決まりに合わせる：1ページ目に要点、基準日の明記、前期比、数字は右揃え・桁区切り、
 * グラフには同じ数字の表を添える（白黒で印刷しても読める）、全ページにページ番号、計算の決まりは注記に。
 */
(function (K) {
  'use strict';
  const { D, YM, INCOME, sum, BudgetCalculator: BC, MonthlyLogic, BreakdownLogic } = K;
  const nf = new Intl.NumberFormat('ja-JP');
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const yen = (v) => (v < 0 ? '−' : '') + nf.format(Math.abs(v)) + '円';
  const num = (v) => (v < 0 ? '−' : '') + nf.format(Math.abs(v));
  const signed = (v) => (v > 0 ? '＋' : v < 0 ? '−' : '±') + nf.format(Math.abs(v)) + '円';
  const DOW = '日月火水木金土';
  const md = (d) => `${D.m(d)}/${D.d(d)}(${DOW[D.dow(d)]})`;
  const ymdj = (d) => `${D.y(d)}年${D.m(d)}月${D.d(d)}日`;
  const neg = (v) => (v < 0 ? ' class="neg"' : '');
  const compact = (v) => { const a = Math.abs(v); const s = a >= 10000 ? (a / 10000).toFixed(a % 10000 ? 1 : 0).replace(/\.0$/, '') + '万' : nf.format(a); return (v < 0 ? '−' : '') + s; };

  const CSS = `
@page { size: A4 portrait; margin: 14mm 13mm 16mm; }
* { box-sizing: border-box; }
body { margin: 0; color: #202124; font-family: -apple-system, "Hiragino Sans", "Hiragino Kaku Gothic ProN", "Noto Sans JP", "Yu Gothic", sans-serif; font-size: 10pt; line-height: 1.5; font-variant-numeric: tabular-nums; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.page { page-break-after: always; break-after: page; }
.page:last-child { page-break-after: auto; break-after: auto; }
.foot { display: flex; justify-content: space-between; font-size: 8pt; color: #5F6368; border-top: 0.3mm solid #C9C5CF; padding-top: 1.5mm; margin-top: 5mm; }
tr { break-inside: avoid; page-break-inside: avoid; }
h2, h3 { break-after: avoid; page-break-after: avoid; }
h1 { font-size: 17pt; margin: 0 0 1mm; }
h2 { font-size: 12.5pt; margin: 6mm 0 2mm; padding-bottom: 1mm; border-bottom: 0.5mm solid #6B5A7E; color: #3E3350; }
h3 { font-size: 10.5pt; margin: 4mm 0 1.5mm; }
.meta { color: #5F6368; font-size: 8.5pt; }
.kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 3mm; margin: 4mm 0; }
.kpi { border: 0.3mm solid #C9C5CF; border-radius: 2mm; padding: 2.5mm 3mm; }
.kpi .l { font-size: 8.5pt; color: #5F6368; }
.kpi .v { font-size: 14pt; font-weight: 700; }
.kpi .s { font-size: 8pt; color: #5F6368; }
.kpi.main { background: #F1EEF5; border-color: #6B5A7E; }
table { width: 100%; border-collapse: collapse; margin: 1mm 0 2mm; }
th, td { padding: 1.1mm 2mm; border-bottom: 0.2mm solid #DADCE0; vertical-align: top; }
th { font-size: 8.5pt; color: #5F6368; font-weight: 600; text-align: left; border-bottom: 0.4mm solid #9AA0A6; }
td.r, th.r { text-align: right; white-space: nowrap; }
tr.total td { font-weight: 700; border-top: 0.4mm solid #5F6368; border-bottom: none; }
.neg { color: #B3261E; }
.note { font-size: 8.5pt; color: #5F6368; padding: 0; margin: 0; }
p.note { margin: 1mm 0; }
.warn { border: 0.4mm solid #B3261E; border-radius: 2mm; padding: 2mm 3mm; margin: 2mm 0; color: #202124; }
.warn b { color: #B3261E; }
.bar { height: 2.2mm; background: #6B5A7E; border-radius: 1mm; }
.notes li { margin-bottom: 1mm; }
svg text { font-family: inherit; }
`;

  /** 各ページの終わりの小さな一行（ページ番号は付けない：表が長いと2枚にまたがるため、章の番号で示す）。 */
  function foot(title, page, total, made) { return `<div class="foot"><span>${esc(title)}</span><span>${page}／${total}章　作成 ${made}</span></div>`; }

  /** 線グラフ（月末の残高）。白黒でも読めるよう、点と金額を添える。 */
  function lineChart(labels, values) {
    const W = 640, H = 170, L = 52, R = W - 14, T = 16, B = H - 26, n = values.length;
    if (!n) return '';
    const lo0 = Math.min(0, ...values), hi0 = Math.max(0, ...values);
    const raw = (hi0 - lo0) / 4 || 1, mag = Math.pow(10, Math.floor(Math.log10(raw))), st = [1, 2, 2.5, 5, 10].find((x) => x * mag >= raw) * mag;
    const lo = Math.floor(lo0 / st) * st, hi = Math.max(Math.ceil(hi0 / st) * st, lo + st);
    const x = (i) => (n <= 1 ? (L + R) / 2 : L + (R - L) * i / (n - 1)), y = (v) => B - (B - T) * (v - lo) / (hi - lo);
    let s = `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img">`;
    for (let t = lo; t <= hi + st / 2; t += st) s += `<line x1="${L}" y1="${y(t)}" x2="${R}" y2="${y(t)}" stroke="${Math.abs(t) < 1e-9 ? '#5F6368' : '#DADCE0'}" stroke-width="${Math.abs(t) < 1e-9 ? 1.2 : 0.6}"/><text x="${L - 4}" y="${y(t) + 3.5}" font-size="10" text-anchor="end" fill="#5F6368">${compact(Math.round(t))}</text>`;
    const every = Math.max(1, Math.ceil(n / 12));
    labels.forEach((l, i) => { if (i % every === 0 || i === n - 1) s += `<text x="${x(i)}" y="${H - 8}" font-size="10" text-anchor="middle" fill="#5F6368">${esc(l)}</text>`; });
    s += `<polyline fill="none" stroke="#6B5A7E" stroke-width="2" points="${values.map((v, i) => `${x(i)},${y(v)}`).join(' ')}"/>`;
    values.forEach((v, i) => { s += `<circle cx="${x(i)}" cy="${y(v)}" r="2.8" fill="${v < 0 ? '#B3261E' : '#6B5A7E'}"/>`; });
    let minI = 0; values.forEach((v, i) => { if (v < values[minI]) minI = i; });
    s += `<text x="${x(minI)}" y="${Math.min(y(values[minI]) + 14, B - 2)}" font-size="10" font-weight="700" text-anchor="middle">最少 ${compact(values[minI])}円</text>`;
    s += `<text x="${x(n - 1)}" y="${y(values[n - 1]) - 7}" font-size="10" font-weight="700" text-anchor="end">${compact(values[n - 1])}円</text>`;
    return s + '</svg>';
  }

  /** 増減の棒（増えた月は紫で上、減った月は灰色の斜線で下）。 */
  function netChart(labels, values) {
    const W = 640, H = 140, L = 52, R = W - 10, T = 12, B = H - 24, n = values.length;
    if (!n) return '';
    const lo0 = Math.min(0, ...values), hi0 = Math.max(0, ...values);
    const raw = (hi0 - lo0) / 4 || 1, mag = Math.pow(10, Math.floor(Math.log10(raw))), st = [1, 2, 2.5, 5, 10].find((x) => x * mag >= raw) * mag;
    const lo = Math.floor(lo0 / st) * st, hi = Math.max(Math.ceil(hi0 / st) * st, lo + st);
    const y = (v) => B - (B - T) * (v - lo) / (hi - lo), slot = (R - L) / n, bw = Math.min(26, slot * 0.6);
    let s = `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img"><defs><pattern id="hatch" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="5" height="5" fill="#FFFFFF"/><line x1="0" y1="0" x2="0" y2="5" stroke="#B3261E" stroke-width="2.4"/></pattern></defs>`;
    for (let t = lo; t <= hi + st / 2; t += st) s += `<line x1="${L}" y1="${y(t)}" x2="${R}" y2="${y(t)}" stroke="${Math.abs(t) < 1e-9 ? '#5F6368' : '#DADCE0'}" stroke-width="${Math.abs(t) < 1e-9 ? 1.2 : 0.6}"/><text x="${L - 4}" y="${y(t) + 3.5}" font-size="10" text-anchor="end" fill="#5F6368">${compact(Math.round(t))}</text>`;
    values.forEach((v, i) => {
      const cx = L + slot * (i + 0.5), top = Math.min(y(v), y(0)), h = Math.abs(y(v) - y(0));
      if (v !== 0) s += `<rect x="${cx - bw / 2}" y="${top}" width="${bw}" height="${h}" fill="${v > 0 ? '#6B5A7E' : 'url(#hatch)'}" stroke="${v > 0 ? 'none' : '#B3261E'}" stroke-width="0.8"/>`;
      if (n <= 12 || i % Math.ceil(n / 12) === 0) s += `<text x="${cx}" y="${H - 8}" font-size="10" text-anchor="middle" fill="#5F6368">${esc(labels[i])}</text>`;
    });
    return s + '</svg>';
  }

  function itemsTable(title, items, total) {
    if (!items.length) return `<h3>${title}</h3><p class="note">この期間の記録はありません。</p>`;
    const max = Math.max(1, ...items.map((i) => i.amount));
    return `<h3>${title}</h3><table><tr><th>項目</th><th style="width:28%"></th><th class="r">割合</th><th class="r">金額</th></tr>` +
      items.map((it) => { const pct = total > 0 ? Math.floor(it.amount * 100 / total) : 0;
        return `<tr><td>${esc(it.label)}</td><td><div class="bar" style="width:${(it.amount / max * 100).toFixed(1)}%"></div></td><td class="r">${pct === 0 && it.amount > 0 ? '1%未満' : pct + '%'}</td><td class="r">${num(it.amount)}</td></tr>`; }).join('') +
      `<tr class="total"><td>合計</td><td></td><td class="r">100%</td><td class="r">${num(total)}</td></tr></table>`;
  }

  function flowTable(rows, accName, today) {
    if (!rows.length) return '<p class="note">この月の確定した入出金はありません。</p>';
    return `<table><tr><th>日付</th><th>内容</th><th>置き場所</th><th class="r">入金</th><th class="r">出金</th></tr>` +
      rows.map((o) => { const inc = o.kind === INCOME; const why = MonthlyLogic.shiftReason(o);
        return `<tr><td style="white-space:nowrap">${md(o.date)}</td><td>${esc(o.name)}${why ? `<div class="note">${esc(why)}</div>` : ''}${o.date > today ? '<div class="note">予定</div>' : ''}</td><td>${esc(accName(o.accountId))}</td><td class="r">${inc ? num(o.amount) : ''}</td><td class="r">${inc ? '' : num(o.amount)}</td></tr>`; }).join('') + '</table>';
  }

  function forecastPage(data, fromMonth, today, months) {
    const ms = Array.from({ length: months }, (_, i) => YM.plus(fromMonth, i));
    const plans = MonthlyLogic.plans(data, ms, today);
    const lab = (m) => `${YM.y(m) % 100}/${YM.m(m)}`;
    return `<h2>見通し（${YM.y(ms[0])}年${YM.m(ms[0])}月〜${YM.y(ms[ms.length - 1])}年${YM.m(ms[ms.length - 1])}月）</h2>
<h3>月末の残高</h3>${lineChart(plans.map((p) => lab(p.month)), plans.map((p) => p.end))}
<h3>月ごとの増減</h3>${netChart(plans.map((p) => lab(p.month)), plans.map((p) => p.end - p.start))}
<table><tr><th>月</th><th class="r">前月繰越</th><th class="r">収入</th><th class="r">出金</th><th class="r">増減</th><th class="r">月末の残高</th></tr>` +
      plans.map((p) => `<tr><td>${YM.y(p.month)}/${YM.m(p.month)}${p.kind === 'PAST' ? '' : '<span class="note">（見込み）</span>'}</td><td class="r">${num(p.start)}</td><td class="r">${num(p.income)}</td><td class="r">${num(p.expense)}</td><td class="r"${neg(p.end - p.start)}>${signed(p.end - p.start).replace('円', '')}</td><td class="r"${neg(p.end)}><b>${num(p.end)}</b></td></tr>`).join('') +
      '</table><p class="note">今日より後の月は、登録した予定と金額が確定したカードの請求だけで計算した見込みです（請求額が未確定のカードの引き落としは含みません）。</p>';
  }

  function loansAndNotes(data, today, accName) {
    const s = BC.summarize(data, today, 3);
    const rec = data.entries.filter((e) => e.repeatMonthly && (e.endDate == null || e.endDate >= today));
    let h = '<h2>返済・定期の支払い</h2>';
    if (s.loans.length) {
      h += `<h3>終わりのある支払い（返済など）</h3><table><tr><th>名前</th><th class="r">1回</th><th class="r">残り回数</th><th class="r">残りの総額</th><th class="r">最終回</th></tr>` +
        s.loans.map((l) => `<tr><td>${esc(l.name)}</td><td class="r">${num(l.monthly)}</td><td class="r">${l.remainingCount}回</td><td class="r">${num(l.remainingTotal)}</td><td class="r">${D.y(l.lastDate)}/${D.m(l.lastDate)}/${D.d(l.lastDate)}</td></tr>`).join('') +
        `<tr class="total"><td>合計</td><td></td><td></td><td class="r">${num(sum(s.loans, (l) => l.remainingTotal))}</td><td></td></tr></table>`;
    }
    h += rec.length ? `<h3>定期の予定</h3><table><tr><th>名前</th><th>繰り返し</th><th>置き場所</th><th class="r">入金</th><th class="r">出金</th></tr>` +
      rec.map((e) => `<tr><td>${esc(e.name)}</td><td>${esc(K.repeatLabel(e))}${e.endDate ? `<div class="note">${D.y(e.endDate)}/${D.m(e.endDate)}/${D.d(e.endDate)}まで</div>` : ''}</td><td>${esc(accName(e.accountId))}</td><td class="r">${e.kind === INCOME ? num(e.amount) : ''}</td><td class="r">${e.kind === INCOME ? '' : num(e.amount)}</td></tr>`).join('') + '</table>' : '<p class="note">定期の予定はありません。</p>';
    const cards = data.cards.filter((c) => !c.retired);
    if (cards.length) h += `<h3>カード・後払い</h3><table><tr><th>名前</th><th>締め日・支払日</th><th>払う口座</th></tr>` +
      cards.map((c) => `<tr><td>${esc(c.name)}</td><td>${K.patternLabel(c)}</td><td>${esc(accName(c.accountId))}</td></tr>`).join('') + '</table>';
    h += `<h2>注記（計算の決まり）</h2><ul class="notes note">
<li>確定した入出金（入力した記録・定期の予定・金額が確定したカードの請求）だけで計算しています。請求額が未確定のカードの引き落としは含みません。</li>
<li>前月繰越は、残高を確かめた記録から逆算しています。月末の残高は、前月繰越 ＋ 収入 − 出金 です。</li>
<li>「記録外の出金・入金」は、残高を確かめたときに、記録した入出金では説明できない差額です。いつ動いたかまでは分からないため、後で確かめた日の月に入れています。</li>
<li>預け入れ・引き出し・チャージ（お金の置き場所の移動）は、収入・出金に数えていません。カードからのチャージは、チャージ先で使った分を出金として数えます。</li>
<li>銀行が休みの日（土日・祝日・12/31〜1/3）は、引き落としは次の営業日、入金は前の営業日として計算しています。現金・電子マネー・交通系ICは日付を調整しません。</li>
<li>利息は計算していません。実際に請求された額を入れた分だけが数字に入ります。</li></ul>`;
    return h;
  }

  /** 月のレポート（HTML の body の中身）。 */
  function monthReport(data, month, today) {
    const made = ymdj(today), title = `家計簿 月次レポート ${YM.y(month)}年${YM.m(month)}月`, total = 4;
    const accName = (id) => (data.accounts.find((a) => a.id === id) || {}).name || '（口座なし）';
    const p = MonthlyLogic.plan(data, month, today), prev = MonthlyLogic.plan(data, YM.plus(month, -1), today);
    const s = BC.summarize(data, today, 3);
    const [f, t] = BreakdownLogic.monthRange(month);
    const b = BreakdownLogic.compute(data, f, t, today);
    const label = p.kind === 'PAST' ? '月末の残高' : '月末の残高見込み';
    let oldest = null; for (const a of data.accounts) if (!oldest || a.asOf < oldest) oldest = a.asOf;
    const accRows = data.accounts.map((a) => `<tr><td>${esc(a.name)}<span class="note">　${K.kindLabel(a)}</span></td><td class="r">${D.m(a.asOf)}/${D.d(a.asOf)}時点 ${num(a.balance)}</td><td class="r"${neg(s.currentByAccount[a.id] ?? a.balance)}><b>${num(s.currentByAccount[a.id] ?? a.balance)}</b></td></tr>`).join('');
    const warns = p.kind === 'CURRENT' ? s.transfers.map((tr) => `<div class="warn"><b>${esc(tr.accountName)}の残高が不足します</b>：${md(tr.shortDate)}の引き落とし時に不足します。${md(tr.deadline)}までに ${yen(tr.amount)} 以上の入金が必要です。</div>`).join('') : '';
    const pending = s.unconfirmedBills.filter((u) => D.ym(u.date) === month);
    const p1 = `<section class="page"><h1>${esc(title)}</h1><div class="meta">作成日 ${made}${oldest ? `・残高は${ymdj(oldest)}時点の記録をもとに計算` : ''}${p.kind !== 'PAST' ? '・今月以降は見込みを含みます' : ''}</div>
<div class="kpis"><div class="kpi"><div class="l">前月繰越</div><div class="v">${yen(p.start)}</div></div>
<div class="kpi"><div class="l">収入</div><div class="v">${yen(p.income)}</div><div class="s">前月比 ${signed(p.income - prev.income)}</div></div>
<div class="kpi"><div class="l">出金</div><div class="v">${yen(p.expense)}</div><div class="s">前月比 ${signed(p.expense - prev.expense)}</div></div>
<div class="kpi main"><div class="l">${label}</div><div class="v"${neg(p.end)}>${yen(p.end)}</div><div class="s">前月末から ${signed(p.end - p.start)}</div></div></div>
<h2>計算の式</h2><table><tr><td>前月繰越</td><td class="r">${num(p.start)}</td></tr><tr><td>＋ 収入${p.unrecorded < 0 ? `（うち記録外 ${num(-p.unrecorded)}）` : ''}</td><td class="r">${num(p.income)}</td></tr>
<tr><td>− 出金${p.unrecorded > 0 ? `（うち記録外 ${num(p.unrecorded)}）` : ''}</td><td class="r">${num(p.expense)}</td></tr>
${p.cardCharge > 0 ? `<tr><td>＋ カードからのチャージ（請求は翌月以降）</td><td class="r">${num(p.cardCharge)}</td></tr>` : ''}${p.cardCharge < 0 ? `<tr><td>− 以前のカードチャージ分の請求</td><td class="r">${num(-p.cardCharge)}</td></tr>` : ''}
<tr class="total"><td>＝ ${label}</td><td class="r"${neg(p.end)}>${num(p.end)}</td></tr></table>
${p.beforeFirstBalance ? '<p class="note">最初に残高を入れた日より前の月です。前月繰越は、記録した入出金から逆算した参考値です。</p>' : ''}
${pending.length ? `<p class="note">金額が未確定のカード請求 ${pending.length}件（${pending.map((u) => `${md(u.date)} ${esc(u.card.name)}`).join('、')}）は含みません。</p>` : ''}
${warns ? `<h2>注意</h2>${warns}` : ''}
<h2>お金の置き場所（作成日の推定残高）</h2><table><tr><th>置き場所</th><th class="r">最後に確かめた残高</th><th class="r">推定残高</th></tr>${accRows}
<tr class="total"><td>合計</td><td></td><td class="r"${neg(s.totalBalance)}>${num(s.totalBalance)}</td></tr></table>
${foot(title, 1, total, made)}</section>`;
    const p2 = `<section class="page"><h2>${YM.m(month)}月の収支の内訳</h2>
<div class="kpis"><div class="kpi"><div class="l">収入</div><div class="v">${yen(b.income)}</div></div><div class="kpi"><div class="l">支出</div><div class="v">${yen(b.expense)}</div></div>
<div class="kpi main"><div class="l">収支</div><div class="v"${neg(b.net)}>${signed(b.net)}</div></div><div class="kpi"><div class="l">うち明日以降の予定</div><div class="s">収入 ${yen(b.scheduledIncome)}<br>支出 ${yen(b.scheduledExpense)}</div></div></div>
${itemsTable('支出の内訳', b.expenseItems, b.expense)}${itemsTable('収入の内訳', b.incomeItems, b.income)}
<h3>${YM.m(month)}月の入出金</h3>${flowTable(p.rows, accName, today)}
${foot(title, 2, total, made)}</section>`;
    const p3 = `<section class="page">${forecastPage(data, month, today, 12)}${foot(title, 3, total, made)}</section>`;
    const p4 = `<section class="page">${loansAndNotes(data, today, accName)}${foot(title, 4, total, made)}</section>`;
    return { title, html: p1 + p2 + p3 + p4 };
  }

  /** 年のレポート。 */
  function yearReport(data, year, today) {
    const made = ymdj(today), title = `家計簿 年次レポート ${year}年`, total = 4;
    const accName = (id) => (data.accounts.find((a) => a.id === id) || {}).name || '（口座なし）';
    const ms = Array.from({ length: 12 }, (_, i) => YM.of(year, i + 1));
    const plans = MonthlyLogic.plans(data, ms, today);
    const [f, t] = BreakdownLogic.yearRange(year), [pf, pt] = BreakdownLogic.yearRange(year - 1);
    const b = BreakdownLogic.compute(data, f, t, today), prev = BreakdownLogic.compute(data, pf, pt, today);
    const inc = sum(plans, (p) => p.income), exp = sum(plans, (p) => p.expense);
    const hasFuture = plans.some((p) => p.kind !== 'PAST');
    const p1 = `<section class="page"><h1>${esc(title)}</h1><div class="meta">作成日 ${made}${hasFuture ? '・今月以降は見込みを含みます' : ''}</div>
<div class="kpis"><div class="kpi"><div class="l">年初の残高</div><div class="v">${yen(plans[0].start)}</div></div>
<div class="kpi"><div class="l">収入の合計</div><div class="v">${yen(inc)}</div><div class="s">前年比 ${signed(b.income - prev.income)}</div></div>
<div class="kpi"><div class="l">出金の合計</div><div class="v">${yen(exp)}</div><div class="s">前年比 ${signed(b.expense - prev.expense)}</div></div>
<div class="kpi main"><div class="l">年末の残高${hasFuture ? '見込み' : ''}</div><div class="v"${neg(plans[11].end)}>${yen(plans[11].end)}</div><div class="s">年初から ${signed(plans[11].end - plans[0].start)}</div></div></div>
${plans.some((p) => p.beforeFirstBalance) ? '<p class="note">最初に残高を入れた日より前の月の残高は、記録した入出金から逆算した参考値です。</p>' : ''}
<h2>月ごとの増減</h2>${netChart(ms.map((m) => `${YM.m(m)}月`), plans.map((p) => p.end - p.start))}
<table><tr><th>月</th><th class="r">収入</th><th class="r">出金</th><th class="r">増減</th><th class="r">月末の残高</th></tr>` +
      plans.map((p) => `<tr><td>${YM.m(p.month)}月${p.kind === 'PAST' ? '' : '<span class="note">（見込み）</span>'}</td><td class="r">${num(p.income)}</td><td class="r">${num(p.expense)}</td><td class="r"${neg(p.end - p.start)}>${signed(p.end - p.start).replace('円', '')}</td><td class="r"${neg(p.end)}><b>${num(p.end)}</b></td></tr>`).join('') +
      `<tr class="total"><td>合計</td><td class="r">${num(inc)}</td><td class="r">${num(exp)}</td><td class="r"${neg(inc - exp)}>${signed(plans[11].end - plans[0].start).replace('円', '')}</td><td></td></tr></table>
${foot(title, 1, total, made)}</section>`;
    const p2 = `<section class="page"><h2>${year}年の収支の内訳</h2>${itemsTable('支出の内訳', b.expenseItems, b.expense)}${itemsTable('収入の内訳', b.incomeItems, b.income)}
<p class="note">内訳は記録した入出金と記録外の差から集計しています。1ページ目の収入・出金とは、カードからのチャージの扱いなどで少し違うことがあります。</p>${foot(title, 2, total, made)}</section>`;
    const curYm = D.ym(today);
    const p3 = `<section class="page">${forecastPage(data, curYm > YM.of(year, 12) ? YM.of(year, 1) : curYm < YM.of(year, 1) ? YM.of(year, 1) : curYm, today, 12)}${foot(title, 3, total, made)}</section>`;
    const p4 = `<section class="page">${loansAndNotes(data, today, accName)}${foot(title, 4, total, made)}</section>`;
    return { title, html: p1 + p2 + p3 + p4 };
  }

  /** 印刷用の完全な HTML（Android版も同じ形を作る）。 */
  const page = (r) => `<!doctype html><html lang="ja"><head><meta charset="utf-8"><title>${esc(r.title)}</title><style>${CSS}</style></head><body>${r.html}</body></html>`;

  K.Report = { CSS, monthReport, yearReport, page };
})(window.K = window.K || {});
