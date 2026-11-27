/*
 * 家計簿 iPhone版：計算（画面にも保存にも頼らない）。Android版 domain/*.kt をそのまま移したもの。
 * 日付は "2026-11-22"、月は "2026-11" の文字列で持つ（文字列の大小＝日付の前後）。
 * 金額は円の整数（Number。2^53 まで正確）。
 */
(function (K) {
  'use strict';

  // ===================================================================
  // 日付（java.time.LocalDate / YearMonth の必要な分だけ）
  // ===================================================================
  const pad = (n, w) => String(n).padStart(w, '0');
  const D = {
    of: (y, m, d) => `${pad(y, 4)}-${pad(m, 2)}-${pad(d, 2)}`,
    y: (s) => +s.slice(0, 4),
    m: (s) => +s.slice(5, 7),
    d: (s) => +s.slice(8, 10),
    toDays: (s) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) / 86400000,
    fromDays(n) { const t = new Date(n * 86400000); return D.of(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate()); },
    plusDays: (s, n) => D.fromDays(D.toDays(s) + n),
    /** 0=日 … 6=土 */
    dow: (s) => new Date(D.toDays(s) * 86400000).getUTCDay(),
    len: (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate(),
    /** plusMonths：その月に日が無ければ月末（Java と同じ）。 */
    plusMonths(s, n) {
      const ym = YM.plus(D.ym(s), n);
      return YM.atDay(ym, Math.min(D.d(s), YM.len(ym)));
    },
    plusYears: (s, n) => D.plusMonths(s, n * 12),
    ym: (s) => s.slice(0, 7),
    between: (a, b) => D.toDays(b) - D.toDays(a),
    min: (a, b) => (a < b ? a : b),
    max: (a, b) => (a > b ? a : b),
    today() { const t = new Date(); return D.of(t.getFullYear(), t.getMonth() + 1, t.getDate()); },
    valid(s) {
      if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
      const m = D.m(s), d = D.d(s);
      return m >= 1 && m <= 12 && d >= 1 && d <= D.len(D.y(s), m);
    },
  };
  const YM = {
    of: (y, m) => `${pad(y, 4)}-${pad(m, 2)}`,
    y: (s) => +s.slice(0, 4),
    m: (s) => +s.slice(5, 7),
    plus(s, n) { const t = YM.y(s) * 12 + (YM.m(s) - 1) + n; return YM.of(Math.floor(t / 12), (((t % 12) + 12) % 12) + 1); },
    len: (s) => D.len(YM.y(s), YM.m(s)),
    atDay: (s, d) => `${s}-${pad(d, 2)}`,
    atEnd: (s) => `${s}-${pad(YM.len(s), 2)}`,
  };

  const INCOME = 'INCOME', EXPENSE = 'EXPENSE';
  /** 繰り返しの間隔（か月）。版9までのデータは毎月（1）。 */
  const repeatEvery = (e) => (e.repeatEvery >= 1 ? e.repeatEvery : 1);
  /** 繰り返しの間隔の選択肢と、その呼び方。 */
  const REPEAT_CHOICES = [1, 2, 3, 6, 12];
  const everyLabel = (n) => (n === 1 ? '毎月' : n === 12 ? '毎年' : n === 6 ? '半年ごと' : `${n}か月ごと`);
  /** 「毎月27日」「毎年3月27日」「2か月ごと・27日」 */
  const repeatLabel = (e) => { const n = repeatEvery(e), d = +e.date.slice(8, 10), m = +e.date.slice(5, 7);
    return n === 1 ? `毎月${d}日` : n === 12 ? `毎年${m}月${d}日` : `${everyLabel(n)}・${d}日`; };
  const sum = (arr, f) => arr.reduce((a, x) => a + (f ? f(x) : x), 0);
  const cmpStr = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  const groupBy = (arr, key) => {
    const m = new Map();
    for (const x of arr) { const k = key(x); if (!m.has(k)) m.set(k, []); m.get(k).push(x); }
    return m;
  };
  /** 口座の種類（Account の派生値）。 */
  const noBankDays = (a) => !!(a.isCash || a.isEmoney || a.isIc);
  const isPrepaid = (a) => !!(a.isEmoney || a.isIc);
  const kindLabel = (a) => (a.isCash ? '現金' : a.isEmoney ? '電子マネー' : a.isIc ? '交通系IC' : '銀行');

  // ===================================================================
  // 日本の祝日（2000年以降。春分・秋分は近似式）
  // ===================================================================
  const JapaneseHolidays = {
    cache: new Map(),
    isHoliday(d) { return JapaneseHolidays.holidaysOf(D.y(d)).has(d); },
    holidaysOf(y) {
      if (!this.cache.has(y)) this.cache.set(y, this.compute(y));
      return this.cache.get(y);
    },
    nthMonday(y, m, n) {
      const first = D.of(y, m, 1);
      const off = (1 - D.dow(first) + 7) % 7;
      return D.plusDays(first, off + (n - 1) * 7);
    },
    springEquinox(y) { const x = y - 1980; return Math.trunc(20.8431 + 0.242194 * x - Math.trunc(x / 4)); },
    autumnEquinox(y) { const x = y - 1980; return Math.trunc(23.2488 + 0.242194 * x - Math.trunc(x / 4)); },
    base(y) {
      const s = new Set();
      if (y < 2000) return s;
      const add = (m, d) => s.add(D.of(y, m, d));
      add(1, 1);
      s.add(this.nthMonday(y, 1, 2));                       // 成人の日
      add(2, 11);                                            // 建国記念の日
      if (y >= 2020) add(2, 23);                             // 天皇誕生日（令和）
      add(3, this.springEquinox(y));                         // 春分の日
      add(4, 29);
      add(5, 3); add(5, 5);
      if (y >= 2007) add(5, 4);
      if (y === 2020) add(7, 23); else if (y === 2021) add(7, 22);   // 海の日
      else if (y >= 2003) s.add(this.nthMonday(y, 7, 3)); else add(7, 20);
      if (y === 2020) add(8, 10); else if (y === 2021) add(8, 8);    // 山の日
      else if (y >= 2016) add(8, 11);
      if (y >= 2003) s.add(this.nthMonday(y, 9, 3)); else add(9, 15); // 敬老の日
      add(9, this.autumnEquinox(y));                         // 秋分の日
      if (y === 2020) add(7, 24); else if (y === 2021) add(7, 23);   // スポーツの日
      else s.add(this.nthMonday(y, 10, 2));
      add(11, 3); add(11, 23);
      if (y >= 2000 && y <= 2018) add(12, 23);               // 天皇誕生日（平成）
      if (y === 2019) { add(4, 30); add(5, 1); add(5, 2); add(10, 22); }
      return s;
    },
    compute(y) {
      const s = this.base(y);
      const fixed = new Set(s);
      // 国民の休日：前日と翌日が祝日で、その日自体は祝日でない（日曜は除く）
      for (const d of fixed) {
        const mid = D.plusDays(d, 1);
        if (!fixed.has(mid) && fixed.has(D.plusDays(mid, 1)) && D.dow(mid) !== 0) s.add(mid);
      }
      // 振替休日
      for (const d of [...fixed].filter((x) => D.dow(x) === 0)) {
        let x = D.plusDays(d, 1);
        while (s.has(x)) x = D.plusDays(x, 1);
        s.add(x);
      }
      return s;
    },
  };

  // ===================================================================
  // 残高を確かめた順番（データ版9）
  // 残高の記録 snapshot.order は、その日のその口座の出入りの並び（上から起きた順）。"@" が残高を確かめた位置。
  // "@" より下の出入りは、残高を確かめた後に起きた（残高に含まれない）。order が無い・載っていない出入りは「前」。
  // ===================================================================
  const CHECK = '@';
  const CheckOrder = {
    key: (o) => `${o.entryId}|${o.originalDate}`,
    snapshotOf(data, accId, date) { return data.snapshots.find((s) => s.accountId === accId && s.date === date) || null; },
    /** その日のその口座の出入り（既定の並び）。 */
    itemsOn(data, accId, date) {
      return BudgetCalculator.occurrences(data, date, date).filter((o) => o.accountId === accId).sort((a, b) => BudgetCalculator.occOrder(a, b));
    },
    /** 残高を確かめた後に起きた出入りの key。 */
    afterKeys(data, accId, date) {
      const s = this.snapshotOf(data, accId, date);
      if (!s || !s.order) return new Set();
      const i = s.order.indexOf(CHECK);
      return new Set(i < 0 ? [] : s.order.slice(i + 1));
    },
    /** 確かめた後に起きた出入りの合計（＋入金・−出金）。残高にこれを足すと「その日の終わりの残高」。 */
    afterSum(data, accId, date) {
      const s = this.snapshotOf(data, accId, date);
      if (!s || !s.order) return 0;
      const after = this.afterKeys(data, accId, date);
      if (!after.size) return 0;
      return sum(this.itemsOn(data, accId, date).filter((o) => after.has(this.key(o))), (o) => (o.kind === INCOME ? o.amount : -o.amount));
    },
    /** 画面に出す並び：[{type:'check'} | {type:'item', occ}]。保存した並びに無い新しい出入りは、確かめた位置の前に入れる。 */
    layout(data, accId, date) {
      const items = this.itemsOn(data, accId, date);
      const byKey = new Map(items.map((o) => [this.key(o), o]));
      const s = this.snapshotOf(data, accId, date);
      const order = s && s.order ? s.order.filter((k) => k === CHECK || byKey.has(k)) : [];
      if (!order.includes(CHECK)) order.push(CHECK);
      const known = new Set(order);
      const fresh = items.map((o) => this.key(o)).filter((k) => !known.has(k));
      order.splice(order.indexOf(CHECK), 0, ...fresh);
      return order.map((k) => (k === CHECK ? { type: 'check' } : { type: 'item', occ: byKey.get(k) }));
    },

    // ---- その日全体の流れ（画面用）。計算は口座ごとのまま ----
    // 各口座の snapshot.order に、その日全体の並びを入れる：自分の確かめた位置は "@"、他の口座の確かめた位置は "@:口座のid"。
    // 計算（afterKeys・afterSum）は自分の "@" より下の、自分の口座の出入りだけを見るので、他の項目が入っていても答えは変わらない。
    checkToken: (accId) => `${CHECK}:${accId}`,
    /** その日に残高を確かめた口座（残高の記録か、口座の時点がその日）と、確かめた残高。 */
    checksOn(data, date) {
      return data.accounts.map((a) => {
        const s = this.snapshotOf(data, a.id, date);
        if (s) return { acc: a, amount: s.amount };
        return a.asOf === date ? { acc: a, amount: a.balance } : null;
      }).filter(Boolean);
    },
    /** その日の流れ：[{type:'check', acc, amount} | {type:'item', occ}]。確かめた口座が無い日は空。 */
    dayLayout(data, date) {
      const checks = this.checksOn(data, date);
      if (!checks.length) return [];
      const items = BudgetCalculator.occurrences(data, date, date).sort((a, b) => BudgetCalculator.occOrder(a, b));
      const byKey = new Map(items.map((o) => [this.key(o), o]));
      const checkBy = new Map(checks.map((c) => [this.checkToken(c.acc.id), c]));
      const saved = checks.map((c) => this.snapshotOf(data, c.acc.id, date)).find((s) => s && s.order);
      const order = (saved ? saved.order.map((k) => (k === CHECK ? this.checkToken(saved.accountId) : k)) : [])
        .filter((k) => byKey.has(k) || checkBy.has(k));
      const known = new Set(order);
      // 新しい出入りは、最初に確かめた位置の前に入れる（ふだんは「使ってから確かめる」ため）
      const fresh = items.map((o) => this.key(o)).filter((k) => !known.has(k));
      const firstCheck = order.findIndex((k) => checkBy.has(k));
      order.splice(firstCheck < 0 ? order.length : firstCheck, 0, ...fresh);
      for (const k of checkBy.keys()) if (!order.includes(k)) order.push(k);
      return order.map((k) => (checkBy.has(k) ? { type: 'check', ...checkBy.get(k) } : { type: 'item', occ: byKey.get(k) }));
    },
    /** その日全体の並び（key と "@:口座"）を、ある口座の snapshot.order の形にする。 */
    orderFor(dayKeys, accId) { const t = this.checkToken(accId); return dayKeys.map((k) => (k === t ? CHECK : k)); },
  };

  // ===================================================================
  // 計算の本体
  // ===================================================================
  const BudgetCalculator = {
    MAX_YEARS: 20,

    /** 銀行が休みの日：土日・祝日（振替休日・国民の休日を含む）・年末年始（12/31〜1/3）。 */
    isBankHoliday(d) {
      const w = D.dow(d);
      if (w === 0 || w === 6) return true;
      if (D.m(d) === 12 && D.d(d) === 31) return true;
      if (D.m(d) === 1 && D.d(d) <= 3) return true;
      return JapaneseHolidays.isHoliday(d);
    },

    /** 引き落としは翌営業日へ、給料は前営業日へ。 */
    adjust(d, kind) {
      let x = d;
      const step = kind === EXPENSE ? 1 : -1;
      while (this.isBankHoliday(x)) x = D.plusDays(x, step);
      return x;
    },

    sameDayInMonth(base, ym) { return YM.atDay(ym, Math.min(D.d(base), YM.len(ym))); },

    rawDates(e, to) {
      if (!e.repeatMonthly) return [e.date];
      const out = [];
      const step = repeatEvery(e);   // 何か月ごとか（1＝毎月、12＝毎年）
      let ym = D.ym(e.date);
      const last = D.ym(D.plusDays(to, 7));
      while (ym <= last) {
        const d = this.sameDayInMonth(e.date, ym);
        if (d >= e.date && (e.endDate == null || d <= e.endDate)) out.push(d);
        ym = YM.plus(ym, step);
      }
      return out;
    },

    lastRawDate(e) {
      if (!(e.repeatMonthly && e.endDate != null)) return null;
      const l = this.rawDates(e, e.endDate);
      return l.length ? l[l.length - 1] : null;
    },

    amountOn(e, raw, last) { return e.lastAmount != null && raw === last ? e.lastAmount : e.amount; },

    /**
     * noShift=true（財布の現金など）は、銀行の休みで日付をずらさない。
     * 枠（slot）の、金額を入れていない回は作らない（withPending=true なら pending の印を付けて作る）。
     */
    expand(e, from, to, noShift = false, withPending = false) {
      const last = this.lastRawDate(e);
      const ch = new Map();
      if (e.repeatMonthly) for (const c of e.changes || []) ch.set(c.originalDate, c);
      let horizon = to;
      for (const k of ch.keys()) horizon = D.max(horizon, k);
      const out = [];
      for (const d of this.rawDates(e, horizon)) {
        const c = ch.get(d);
        if (c && c.skipped) continue;
        const day = (c && c.date) || d;
        const amount = c && c.amount != null ? c.amount : e.slot ? null : this.amountOn(e, d, last);
        if (amount == null && !withPending) continue;
        out.push({
          entryId: e.id, name: e.name,
          amount: amount == null ? 0 : amount,
          date: noShift ? day : this.adjust(day, e.kind),
          originalDate: d, kind: e.kind, accountId: e.accountId, changed: !!c && (!e.slot || !!c.date), pending: amount == null,
        });
      }
      return out.filter((o) => o.date >= from && o.date <= to);
    },

    /** その回の、予定どおりの日付と金額（「この回だけ」の変更を入れる前）。 */
    nominal(e, raw, noShift) {
      return [noShift ? raw : this.adjust(raw, e.kind), this.amountOn(e, raw, this.lastRawDate(e))];
    },

    periodEnd(data, today, months) {
      if (months != null) return D.plusMonths(today, months);
      let lastFixed = null;
      for (const e of data.entries) {
        const x = e.repeatMonthly ? e.endDate : e.date;
        if (x != null && (lastFixed == null || x > lastFixed)) lastFixed = x;
      }
      const min = D.plusMonths(today, 3);
      const max = D.plusYears(today, this.MAX_YEARS);
      const end = lastFixed ? D.plusDays(lastFixed, 7) : min;
      return end < min ? min : end > max ? max : end;
    },

    loans(data, today) {
      return data.entries.filter((e) => e.kind === EXPENSE && e.repeatMonthly && e.endDate != null && !e.cardId && !e.slot)
        .map((e) => {
          let far = e.endDate;
          for (const c of e.changes || []) if (c.date) far = D.max(far, c.date);
          far = D.plusMonths(far, 1);
          const left = this.expand(e, today, far).sort((a, b) => cmpStr(a.date, b.date));
          if (!left.length) return null;
          return { entryId: e.id, name: e.name, monthly: e.amount, remainingCount: left.length,
            remainingTotal: sum(left, (o) => o.amount), lastDate: left[left.length - 1].date };
        }).filter(Boolean).sort((a, b) => cmpStr(a.lastDate, b.lastDate));
    },

    occOrder(a, b) {
      return cmpStr(a.date, b.date) || ((a.kind === INCOME ? 0 : 1) - (b.kind === INCOME ? 0 : 1)) || cmpStr(a.name, b.name);
    },

    /** 資金繰りの計算（口座ごとの時点の残高から、時点より後の確定した出入りを足し引き）。 */
    summarize(data, today, months = 3) {
      const to = this.periodEnd(data, today, months);
      const asOf = new Map(data.accounts.map((a) => [a.id, a.asOf]));
      let oldest = null;
      for (const a of data.accounts) if (oldest == null || a.asOf < oldest) oldest = a.asOf;
      // 時点の当日から取る（確かめた後に起きた当日の出入りを数えるため。確かめる前の分は reflected で外す）
      const from = D.min(oldest || today, today);
      const all = this.occurrences(data, from, to);
      // 時点の当日は、残高を確かめた後に起きた出入りだけを残高の外にする
      const afterOf = new Map(data.accounts.map((a) => [a.id, CheckOrder.afterKeys(data, a.id, a.asOf)]));
      const reflected = (o) => {
        const d = asOf.has(o.accountId) ? asOf.get(o.accountId) : today;
        return o.date < d || (o.date === d && !(afterOf.get(o.accountId) || new Set()).has(CheckOrder.key(o)));
      };
      const order = (a, b) => this.occOrder(a, b);
      const passed = all.filter((o) => !reflected(o) && o.date <= today).sort(order);
      const future = all.filter((o) => !reflected(o) && o.date > today).sort(order);

      const signed = (o) => (o.kind === INCOME ? o.amount : -o.amount);
      const accBal = new Map(data.accounts.map((a) => [a.id, a.balance]));
      for (const o of passed) accBal.set(o.accountId, (accBal.get(o.accountId) || 0) + signed(o));
      const current = Object.fromEntries(accBal);
      const recorded = sum(data.accounts, (a) => a.balance);
      const start = recorded + sum(passed, signed);

      let total = start, lowest = start, lowestDate = null;
      const rows = [];
      const minByAcc = new Map();
      for (const o of future) {
        total += signed(o);
        const after = (accBal.get(o.accountId) || 0) + signed(o);
        accBal.set(o.accountId, after);
        rows.push({ occ: o, totalAfter: total, accountAfter: after });
        if (total < lowest) { lowest = total; lowestDate = o.date; }
        const cur = minByAcc.get(o.accountId);
        if (after < 0 && (cur == null || after < cur)) minByAcc.set(o.accountId, after);
      }

      const monthRows = [];
      let ym = D.ym(today);
      let running = start;
      const lastYm = D.ym(to);
      const byMonth = groupBy(future, (o) => D.ym(o.date));
      const transferIds = new Set(data.entries.filter((e) => e.chargeFrom != null).map((e) => e.id));
      const isTransfer = (o) => o.entryId.startsWith('chg:') || transferIds.has(o.entryId);
      while (ym <= lastYm) {
        const list = byMonth.get(ym) || [];
        const change = sum(list, signed);
        running += change;
        const inc = sum(list.filter((o) => o.kind === INCOME && !isTransfer(o)), (o) => o.amount);
        const exp = sum(list.filter((o) => o.kind === EXPENSE && !isTransfer(o)), (o) => o.amount);
        monthRows.push({ month: ym, income: inc, expense: exp, endTotal: running, change });
        ym = YM.plus(ym, 1);
      }

      const nextIncomeOcc = future.find((o) => o.kind === INCOME);
      const nextIncome = nextIncomeOcc ? nextIncomeOcc.date : null;
      const spend = sum(future.filter((o) => o.kind === EXPENSE && (nextIncome == null || o.date < nextIncome)), (o) => o.amount);

      const transfers = [];
      for (const [accId, minBal] of minByAcc) {
        const acc = data.accounts.find((a) => a.id === accId);
        if (!acc) continue;
        const firstShort = rows.find((r) => r.occ.accountId === accId && r.accountAfter < 0).occ.date;
        let deadline = D.plusDays(firstShort, -1);
        while (this.isBankHoliday(deadline) && deadline > today) deadline = D.plusDays(deadline, -1);
        if (deadline < today) deadline = today;
        transfers.push({ accountId: accId, accountName: acc.name, amount: this.roundUp1000(-minBal), deadline, shortDate: firstShort });
      }
      transfers.sort((a, b) => cmpStr(a.deadline, b.deadline));

      const thisMonth = D.ym(today);
      // 今月の固定費：口座から払う繰り返しの支出の、今月の回（予定の日付で数える。枠は金額を入れた回だけ）。カードで払うものは請求に入るので数えない
      const monthlyFixed = sum(data.entries.filter((e) => e.kind === EXPENSE && e.repeatMonthly && e.chargeFrom == null && !e.cardId),
        (e) => sum(this.expand(e, D.plusDays(YM.atDay(thisMonth, 1), -10), D.plusDays(YM.atEnd(thisMonth), 10), true)
          .filter((o) => D.ym(o.originalDate) === thisMonth), (o) => o.amount));

      return {
        totalBalance: start, currentByAccount: current, recordedBalance: recorded, passedSinceUpdate: passed,
        oldestAsOf: oldest, endDate: to, nextIncomeDate: nextIncome, usableUntilNextIncome: start - spend,
        lowestTotal: lowest, lowestDate, timeline: rows, months: monthRows, transfers,
        loans: this.loans(data, today), monthlyFixed, unconfirmedBills: CardLogic.unconfirmed(data, today),
        pendingSlots: SlotLogic.pending(data, to),
      };
    },

    roundUp1000(v) { return Math.floor((v + 999) / 1000) * 1000; },

    totalAt(data, t) { return this.totalsAt(data, [t]).get(t); },

    /** その日の終わりの合計残高（複数の日をまとめて）。残高の記録から足し引き、記録より前は逆算。 */
    totalsAt(data, ts) {
      const res = new Map();
      if (!ts.length) return res;
      const snaps = new Map();
      for (const a of data.accounts) {
        // 残高は「その日の終わり」の額にそろえる（確かめた後に起きた出入りを足す）
        const eod = (d, v) => v + CheckOrder.afterSum(data, a.id, d);
        const list = [[a.asOf, eod(a.asOf, a.balance)], ...data.snapshots.filter((s) => s.accountId === a.id).map((s) => [s.date, eod(s.date, s.amount)])];
        const seen = new Set();
        const uniq = list.filter(([d]) => (seen.has(d) ? false : (seen.add(d), true)));
        uniq.sort((x, y) => cmpStr(x[0], y[0]));
        snaps.set(a.id, uniq);
      }
      const dates = [...[...snaps.values()].flat().map((x) => x[0]), ...ts];
      let lo = dates[0], hi = dates[0];
      for (const d of dates) { if (d < lo) lo = d; if (d > hi) hi = d; }
      const flows = groupBy(this.occurrences(data, lo, hi), (o) => o.accountId);
      const cum = new Map();
      for (const [acc, l] of flows) {
        l.sort((a, b) => cmpStr(a.date, b.date));
        let s = 0;
        cum.set(acc, l.map((o) => { s += o.kind === INCOME ? o.amount : -o.amount; return [o.date, s]; }));
      }
      const upTo = (acc, d) => {
        const l = cum.get(acc);
        if (!l) return 0;
        let a = 0, b = l.length;
        while (a < b) { const mid = (a + b) >> 1; if (l[mid][0] <= d) a = mid + 1; else b = mid; }
        return a === 0 ? 0 : l[a - 1][1];
      };
      for (const t of new Set(ts)) {
        let total = 0;
        for (const a of data.accounts) {
          const list = snaps.get(a.id);
          let before = null;
          for (const x of list) if (x[0] <= t) before = x;
          if (before) total += before[1] + upTo(a.id, t) - upTo(a.id, before[0]);
          else { const after = list[0]; total += after[1] - (upTo(a.id, after[0]) - upTo(a.id, t)); }
        }
        res.set(t, total);
      }
      return res;
    },

    /** 期間内の確定した出入りすべて（予定・請求）。振替は払い元から出る動きも作る。 */
    occurrences(data, from, to) {
      const accIds = new Set(data.accounts.map((a) => a.id));
      const entries = data.entries.filter((e) => accIds.has(e.accountId) &&
        (!(e.chargeFrom && e.chargeFrom.startsWith('acc:')) || accIds.has(e.chargeFrom.slice(4))));
      const noShift = new Set(data.accounts.filter(noBankDays).map((a) => a.id));
      const main = entries.flatMap((e) => this.expand(e, from, to, noShift.has(e.accountId) || e.chargeFrom != null));
      const chargeOut = entries.filter((e) => e.chargeFrom && e.chargeFrom.startsWith('acc:')).flatMap((e) =>
        this.expand(e, from, to, true).map((o) => ({ ...o, entryId: 'chg:' + e.id, kind: EXPENSE, accountId: e.chargeFrom.slice(4) })));
      return [...main, ...chargeOut, ...CardLogic.billOccurrences(data, from, to).filter((o) => accIds.has(o.accountId))];
    },
  };

  // ===================================================================
  // カード
  // ===================================================================
  const CardLogic = {
    dayIn(ym, day) { return YM.atDay(ym, Math.min(day, YM.len(ym))); },
    closingFor(card, paymentRaw) { return this.dayIn(YM.plus(D.ym(paymentRaw), -1), card.closingDay); },
    payDay(paymentRaw) { return BudgetCalculator.adjust(paymentRaw, EXPENSE); },
    paymentForUse(card, useDate) {
      const ym = D.ym(useDate);
      let closing = this.dayIn(ym, card.closingDay);
      if (useDate > closing) closing = this.dayIn(YM.plus(ym, 1), card.closingDay);
      return this.dayIn(YM.plus(D.ym(closing), 1), card.paymentDay);
    },
    confirmedBill(data, card, paymentRaw) {
      return data.bills.find((b) => b.cardId === card.id && b.paymentDate === paymentRaw) || null;
    },
    billOccurrences(data, from, to) {
      const out = [];
      for (const b of data.bills) {
        if (!b.accountId) continue;
        const card = data.cards.find((c) => c.id === b.cardId);
        const name = card ? card.name : '削除したカード';
        // 引き落とせず別の日に払う請求は、その日（payOn）に払う
        const d = b.payOn || this.payDay(b.paymentDate);
        if (d < from || d > to) continue;
        out.push({ entryId: `bill:${b.cardId}:${b.paymentDate}`, name: name + 'の請求', amount: b.amount, date: d,
          originalDate: b.paymentDate, kind: EXPENSE, accountId: b.accountId, changed: false, late: !!b.payOn });
      }
      return out;
    },
    nextPayments(card, today, n) {
      const out = [];
      let ym = D.ym(today);
      while (out.length < n) {
        const raw = this.dayIn(ym, card.paymentDay);
        if (this.payDay(raw) > today) out.push(raw);
        ym = YM.plus(ym, 1);
      }
      return out;
    },
    unconfirmed(data, today) {
      return data.cards.filter((c) => !c.retired).flatMap((card) =>
        this.nextPayments(card, today, 2).filter((p) => !this.confirmedBill(data, card, p))
          .map((p) => ({ card, paymentRaw: p, date: this.payDay(p), closing: this.closingFor(card, p) })))
        .sort((a, b) => cmpStr(a.date, b.date));
    },
    /** 請求を確定する（同じカード・同じ支払日の確定は置き換える）。payOn＝引き落とせず別の日に払う日（無ければ null）。items=null なら内訳はそのまま。 */
    setBill(data, card, paymentRaw, amount, today, id, payOn = null, items = null) {
      const old = this.confirmedBill(data, card, paymentRaw);
      return { ...data, bills: [...data.bills.filter((b) => !(b.cardId === card.id && b.paymentDate === paymentRaw)),
        { id, cardId: card.id, paymentDate: paymentRaw, amount, inputDate: old ? old.inputDate : today, accountId: old ? old.accountId : card.accountId, payOn: payOn || null,
          items: items || (old && old.items) || [] }] };
    },
    /**
     * その請求に入っていそうな、カードで払う定期のもの（利用日がこの請求の締めの期間にある回）。
     * 締め日から推した候補にすぎないので、画面で本人が確かめたものだけを内訳にする。枠の金額待ちの回も含む（pending）。
     */
    billCandidates(data, card, paymentRaw) {
      // カードで払う予定の日付はカードの支払日に合わせてあるので、請求の支払日と同じ月の回をその請求の中身とする（締め日・利用日は見ない）
      const ym = D.ym(paymentRaw);
      return data.entries.filter((e) => e.cardId === card.id && e.kind === EXPENSE)
        .flatMap((e) => BudgetCalculator.expand(e, YM.atDay(ym, 1), YM.atEnd(ym), true, true)).sort((a, b) => cmpStr(a.date, b.date));
    },
    /** カードで払う予定の日付を、その月のカードの支払日にそろえる。 */
    alignToPayment(card, date) { return this.dayIn(D.ym(date), card.paymentDay); },
    /**
     * その請求に入っている定期のもの（内訳の画面の中身）。登録してあるカード払いの定期の予定から自動で出す。
     * 請求額を入れる画面でチェックを外したもの（内訳を保存した請求で、内訳に無いもの）は外す。
     * 金額：その回に入れた金額 → 請求の内訳に保存した金額 → どちらも無ければ null（未入力）。
     */
    billLines(data, card, b) {
      const cands = this.billCandidates(data, card, b.paymentDate);
      const items = b.items || [];
      const saved = new Map(items.map((x) => [x.entryId, x]));
      const lines = cands.filter((o) => !items.length || saved.has(o.entryId)).map((o) => ({ name: o.name,
        amount: !o.pending ? o.amount : saved.has(o.entryId) ? saved.get(o.entryId).amount : null, entryId: o.entryId, originalDate: o.originalDate }));
      const extra = items.filter((x) => !x.entryId || !cands.some((o) => o.entryId === x.entryId)).map((x) => ({ name: x.name, amount: x.amount, entryId: x.entryId, originalDate: null }));
      return [...lines, ...extra];
    },
    /** 請求の内訳（定期のもの）の合計。請求額を超える分は数えない。 */
    itemsTotal(b) { return Math.min(sum(b.items || [], (x) => x.amount), b.amount); },
    deleteBill(data, card, paymentRaw) {
      return { ...data, bills: data.bills.filter((b) => !(b.cardId === card.id && b.paymentDate === paymentRaw)) };
    },

    /**
     * 請求額が確定するまでの、締め日からの日数（画面には出さない。案内のタイミングにだけ使う）。
     * そのカードで過去に請求額を入れた日（入力日）が、締め日の何日後だったかの中央値。記録が無ければ7日。
     */
    confirmLag(data, card) {
      const lags = data.bills.filter((b) => b.cardId === card.id)
        .map((b) => D.between(this.closingFor(card, b.paymentDate), b.inputDate)).filter((n) => n >= 1 && n <= 40).sort((a, b) => a - b);
      return lags.length ? lags[Math.floor((lags.length - 1) / 2)] : 7;
    },
    /** 請求額が確定しているころか（締め日＋確定までの日数を過ぎた）。 */
    likelyConfirmed(data, u, today) { return D.plusDays(u.closing, this.confirmLag(data, u.card)) <= today; },
  };

  /**
   * よく使われるカードの締め日・支払日（2026-11 に各社の公式ページ・公式の案内で確認。31＝月末）。
   * 同じカードで何通りかあるものは patterns に並べる。会員ごとに違うカード（アメックス）や、
   * 締めた月のうちに払うカード（ライフカード）は入れない（「その他のカード」で登録してもらう）。
   */
  const CardPresets = [
    { name: '楽天カード', patterns: [[31, 27]] },
    { name: '三井住友カード', patterns: [[15, 10], [31, 26]] },
    { name: 'JCBカード', patterns: [[15, 10]] },
    { name: '三菱UFJカード', patterns: [[15, 10]] },
    { name: 'PayPayカード', patterns: [[31, 27]] },
    { name: 'dカード', patterns: [[15, 10]] },
    { name: 'イオンカード', patterns: [[10, 2]] },
    { name: 'エポスカード', patterns: [[27, 27], [4, 4]] },
    { name: 'セゾンカード', patterns: [[10, 4]] },
    { name: 'au PAYカード', patterns: [[15, 10], [10, 4]] },
    { name: 'Amazon Mastercard', patterns: [[31, 26]] },
    { name: 'ビューカード', patterns: [[5, 4]] },
    { name: 'オリコカード', patterns: [[31, 27]] },
    // 後払い（締めて後で払う仕組みはカードと同じ）。2026-11 に公式・解説記事で確認
    { name: 'ペイディ', later: true, patterns: [[31, 27]] },
    { name: 'メルペイのスマート払い', later: true, patterns: [[31, 6], [31, 11], [31, 16], [31, 21], [31, 26], [31, 31]] },
    { name: 'atone（翌月払い）', later: true, patterns: [[31, 10], [31, 20], [31, 27]] },
    { name: 'ポチっとチャージ（バンドルカード）', later: true, patterns: [[31, 31]] },
  ].map((p) => ({ later: false, ...p, patterns: p.patterns.map(([closingDay, paymentDay]) => ({ closingDay, paymentDay })) }));
  const patternLabel = (p) => `${p.closingDay >= 31 ? '月末' : p.closingDay + '日'}締め・翌月${p.paymentDay >= 31 ? '末日' : p.paymentDay + '日'}払い`;

  // ===================================================================
  // 月ごとの収支（前月繰越 ＋ 収入 − 出金 ＝ 月末の残高）
  // ===================================================================
  const MonthlyLogic = {
    plan(data, month, today) { return this.plans(data, [month], today)[0]; },

    plans(data, months, today) {
      if (!months.length) return [];
      const bounds = [...new Set([...months.map((m) => YM.plus(m, -1)), ...months])].map(YM.atEnd);
      const totals = BudgetCalculator.totalsAt(data, bounds);
      let lo = months[0], hi = months[0];
      for (const m of months) { if (m < lo) lo = m; if (m > hi) hi = m; }
      const all = groupBy(BudgetCalculator.occurrences(data, YM.atDay(lo, 1), YM.atEnd(hi)), (o) => D.ym(o.date));
      return months.map((m) => this.build(data, m, today, (all.get(m) || []).slice().sort((a, b) => BudgetCalculator.occOrder(a, b)),
        totals.get(YM.atEnd(YM.plus(m, -1))), totals.get(YM.atEnd(m))));
    },

    build(data, month, today, rows, start, end) {
      const thisMonth = D.ym(today);
      const byId = new Map(data.entries.map((e) => [e.id, e]));
      const cf = (o) => { const e = byId.get(o.entryId); return e ? e.chargeFrom : null; };
      const isAccTransfer = (o) => o.entryId.startsWith('chg:') || (cf(o) || '').startsWith('acc:');
      const isCardCharge = (o) => (cf(o) || '').startsWith('card:');
      const inc = rows.filter((o) => o.kind === INCOME && !isAccTransfer(o) && !isCardCharge(o));
      const exp = rows.filter((o) => o.kind === EXPENSE && !isAccTransfer(o));
      const charge = sum(rows.filter(isCardCharge), (o) => o.amount);
      const cibOf = (o) => (o.entryId.startsWith('bill:') ? BreakdownLogic.chargesInBill(data, o) : 0);
      const incRec = sum(inc, (o) => o.amount);
      const expRec = sum(exp, (o) => o.amount);
      const unrecorded = start + incRec + charge - expRec - end;
      const done = (o) => o.date <= today;
      const kind = month < thisMonth ? 'PAST' : month === thisMonth ? 'CURRENT' : 'FUTURE';
      const cib = sum(exp, cibOf);
      const first = this.firstBalance(data);
      return {
        month, kind, start,
        income: incRec + Math.max(0, -unrecorded),
        incomeDone: sum(inc.filter(done), (o) => o.amount) + Math.max(0, -unrecorded),
        expense: expRec - cib + Math.max(0, unrecorded),
        expenseDone: sum(exp.filter(done), (o) => o.amount - cibOf(o)) + Math.max(0, unrecorded),
        unrecorded, cardCharge: charge - cib, end, rows,
        // 月の全部が、最初に残高を入れた日より前（その月に最初の記録がある月は含めない）
        beforeFirstBalance: first ? YM.atEnd(month) < first : false,
      };
    },

    firstBalance(data) {
      let m = null;
      for (const d of [...data.snapshots.map((s) => s.date), ...data.accounts.map((a) => a.asOf)]) if (m == null || d < m) m = d;
      return m;
    },

    changeLabel(o) { return D.ym(o.date) !== D.ym(o.originalDate) ? `${D.m(o.originalDate)}月分` : 'この回だけ変更'; },

    /** 休日で日付がずれた理由。ずれていなければ null。 */
    shiftReason(o) {
      if (o.late) return '引き落とせず、この日に払う';
      if (o.changed) return this.changeLabel(o);
      if (o.date === o.originalDate) return null;
      const d = o.originalDate;
      if ((D.m(d) === 12 && D.d(d) === 31) || (D.m(d) === 1 && D.d(d) <= 3)) return `${D.m(d)}/${D.d(d)}が年末年始の休みのため`;
      const w = D.dow(d);
      if (w === 6) return `${D.d(d)}日が土曜のため`;
      if (w === 0) return `${D.d(d)}日が日曜のため`;
      return `${D.d(d)}日が祝日のため`;
    },
  };

  // ===================================================================
  // 内訳（振り返り）と記録外の出入り
  // ===================================================================
  const BreakdownLogic = {
    /** 記録外の出入りの表示名（計算は同じ。その月の合計がプラスなら雑費、マイナスなら雑収入）。 */
    MISC: '雑費',
    MISC_IN: '雑収入',

    monthRange(m) { return [YM.atDay(m, 1), YM.atEnd(m)]; },
    yearRange(y) { return [D.of(y, 1, 1), D.of(y, 12, 31)]; },

    gaps(data) {
      const accIds = new Set(data.accounts.map((a) => a.id));
      const snaps = data.snapshots.filter((s) => accIds.has(s.accountId));
      if (snaps.length < 2) return [];
      let lo = snaps[0].date, hi = snaps[0].date;
      for (const s of snaps) { if (s.date < lo) lo = s.date; if (s.date > hi) hi = s.date; }
      const occs = groupBy(BudgetCalculator.occurrences(data, D.plusDays(lo, 1), hi), (o) => o.accountId);
      const out = [];
      for (const [accId, list] of groupBy(snaps, (s) => s.accountId)) {
        const sorted = [...groupBy(list, (s) => s.date).values()].map((v) => v[v.length - 1]).sort((a, b) => cmpStr(a.date, b.date))
          .map((s) => ({ ...s, amount: s.amount + CheckOrder.afterSum(data, accId, s.date) }));   // その日の終わりの額
        for (let i = 0; i + 1 < sorted.length; i++) {
          const a = sorted[i], b = sorted[i + 1];
          const moved = sum((occs.get(accId) || []).filter((o) => o.date > a.date && o.date <= b.date), (o) => (o.kind === INCOME ? o.amount : -o.amount));
          const diff = a.amount + moved - b.amount;
          if (diff !== 0) out.push({ accountId: accId, from: a.date, to: b.date, diff });
        }
      }
      return out;
    },

    unrecordedByMonth(data) {
      const out = new Map();
      for (const g of this.gaps(data)) { const k = D.ym(g.to); out.set(k, (out.get(k) || 0) + g.diff); }
      return out;
    },

    compute(data, from, to, today) {
      const occs = BudgetCalculator.occurrences(data, from, to);
      const entryById = new Map(data.entries.map((e) => [e.id, e]));
      const cardById = new Map(data.cards.map((c) => [c.id, c]));
      const isCharge = (o) => o.entryId.startsWith('chg:') || (entryById.has(o.entryId) && entryById.get(o.entryId).chargeFrom != null);
      const incomes = occs.filter((o) => o.kind === INCOME && !isCharge(o));
      const expenses = occs.filter((o) => o.kind === EXPENSE && !isCharge(o));
      const incomeItems = [...groupBy(incomes, (o) => o.name)].map(([name, l]) => ({ label: name, amount: sum(l, (o) => o.amount), details: l, note: null, fixed: false }));
      const expenseItems = [];
      const isBill = (o) => o.entryId.startsWith('bill:');
      const byDate = (l) => l.slice().sort((a, b) => cmpStr(a.date, b.date));
      // 口座から払う繰り返し（固定費）：予定ごとに1行（例：生活費・奨学金）。中身はその期間の回（枠の金額待ちは「未入力」）
      const recG = groupBy(expenses.filter((o) => !isBill(o) && entryById.has(o.entryId) && entryById.get(o.entryId).repeatMonthly), (o) => o.entryId);
      const pendG = groupBy(SlotLogic.pending(data, to).filter((o) => o.date >= from), (o) => o.entryId);
      for (const id of new Set([...recG.keys(), ...pendG.keys()])) {
        const l = byDate(recG.get(id) || []), p = pendG.get(id) || [];
        const en = entryById.get(id);
        const name = en ? en.name : (l[0] || p[0]).name;
        const subItems = byDate([...l, ...p]).map((o) => ({ name: o.name, amount: o.pending ? null : o.amount, entryId: id, originalDate: o.originalDate }));
        expenseItems.push({ label: name, amount: sum(l, (o) => o.amount), details: l, note: null, fixed: true, subItems });
      }
      const once = expenses.filter((o) => !isBill(o) && !(entryById.has(o.entryId) && entryById.get(o.entryId).repeatMonthly));
      if (once.length) expenseItems.push({ label: '1回限りの支出', amount: sum(once, (o) => o.amount), details: byDate(once), note: null, fixed: false });
      // カードの請求：登録してあるカード払いの定期のもの（固定費、押すと中身）と、残りの中身の分からない分（変動費）に分ける
      const billOf = (o) => data.bills.find((b) => `bill:${b.cardId}:${b.paymentDate}` === o.entryId) || null;
      for (const [cardName, l] of groupBy(expenses.filter(isBill), (o) => { const c = cardById.get(o.entryId.split(':')[1]); return c ? c.name : '（削除したカード）'; })) {
        const label = 'カード：' + cardName;
        // カードの請求に入っているチャージ分は差し引く（二重に数えない）
        const charged = sum(l, (o) => this.chargesInBill(data, o));
        const total = Math.max(0, sum(l, (o) => o.amount) - charged);
        const subs = l.map(billOf).filter(Boolean).flatMap((b) => { const c = cardById.get(b.cardId); return c ? CardLogic.billLines(data, c, b) : []; });
        const fixedPart = Math.min(sum(subs, (x) => x.amount || 0), total);
        if (subs.length) {
          const waiting = subs.filter((x) => x.amount == null).length;
          expenseItems.push({ label: `${label}（定期のもの）`, amount: fixedPart, details: byDate(l),
            note: `${cardName}で払う定期のもの（請求額に含まれます）` + (waiting ? `。未入力 ${waiting}件は、金額を入れると数えます` : ''), fixed: true, subItems: subs });
        }
        const notes = [
          charged > 0 ? `請求のうちチャージ ${charged}円は、電子マネー・交通系ICで使った分として数えるため、ここでは差し引いています` : null,
          fixedPart > 0 ? `定期のもの ${fixedPart}円を除いた、中身の分からない分です` : null,
        ].filter(Boolean);
        if (total - fixedPart > 0 || fixedPart === 0)
          expenseItems.push({ label, amount: total - fixedPart, details: byDate(l), note: notes.length ? notes.join('。') : null, fixed: false });
      }
      for (let i = expenseItems.length - 1; i >= 0; i--) if (expenseItems[i].amount <= 0 && !expenseItems[i].details.length && !(expenseItems[i].subItems || []).length) expenseItems.splice(i, 1);

      // 雑費・雑収入：記録外の出入りを月ごとに合計し、プラスの月は雑費、マイナスの月は雑収入（計算は記録外の出入りのまま）
      const accName = new Map(data.accounts.map((a) => [a.id, a.name]));
      const inRange = this.gaps(data).filter((g) => { const m = D.ym(g.to); return YM.atEnd(m) >= from && YM.atDay(m, 1) <= to; });
      const md = (x) => `${D.m(x)}/${D.d(x)}`;
      const byMonth = new Map();
      for (const g of inRange) { const k = D.ym(g.to); byMonth.set(k, (byMonth.get(k) || 0) + g.diff); }
      const noteFor = (months) => {
        const l = inRange.filter((g) => months.includes(D.ym(g.to)));
        const places = [...groupBy(l, (g) => g.accountId)].map(([id, gs]) => {
          const t = sum(gs, (g) => g.diff);
          return `${accName.get(id) || '削除した口座'}（${gs.map((g) => `${md(g.from)}〜${md(g.to)}`).join('、')}）：` + (t >= 0 ? `記録より${t}円少ない` : `記録より${-t}円多い`);
        }).join('\n');
        const crosses = l.some((g) => D.ym(g.from) !== D.ym(g.to));
        return '残高を確かめた日の間で、記録した入出金では説明できない差です。いつ動いたかまでは分からないため、後で確かめた日の月に入れています' +
          (crosses ? '（月をまたぐ差を含みます）' : '') + '。\n' + places;
      };
      const outMonths = [...byMonth].filter(([, v]) => v > 0).map(([k]) => k);
      const inMonths = [...byMonth].filter(([, v]) => v < 0).map(([k]) => k);
      if (outMonths.length) expenseItems.push({ label: this.MISC, amount: sum(outMonths, (k) => byMonth.get(k)), details: [], note: noteFor(outMonths), fixed: false });
      if (inMonths.length) incomeItems.push({ label: this.MISC_IN, amount: -sum(inMonths, (k) => byMonth.get(k)), details: [], note: noteFor(inMonths), fixed: false });
      const byAmountDesc = (a, b) => b.amount - a.amount;
      const income = sum(incomeItems, (i) => i.amount);
      const expense = sum(expenseItems, (i) => i.amount);
      const fixedExpense = sum(expenseItems.filter((i) => i.fixed), (i) => i.amount);
      return {
        from, to, income, expense, net: income - expense, fixedExpense, variableExpense: expense - fixedExpense,
        incomeItems: incomeItems.sort(byAmountDesc), expenseItems: expenseItems.sort(byAmountDesc),
        scheduledIncome: sum(incomes.filter((o) => o.date > today), (o) => o.amount),
        scheduledExpense: sum(expenses.filter((o) => o.date > today), (o) => o.amount),
      };
    },

    /** そのカードの請求（1回分）に入っている、カードからのチャージの合計。 */
    chargesInBill(data, bill) {
      const cardId = bill.entryId.split(':')[1];
      if (!cardId) return 0;
      const card = data.cards.find((c) => c.id === cardId);
      if (!card) return 0;
      const raw = bill.originalDate;
      return sum(data.entries.filter((e) => e.chargeFrom === 'card:' + cardId)
        .flatMap((e) => BudgetCalculator.expand(e, D.plusDays(raw, -75), raw, true))
        .filter((o) => CardLogic.paymentForUse(card, o.date) === raw), (o) => o.amount);
    },

    /** 前回見たときから値が変わった月（キー "2026-11"）と、その前回値。 */
    changedMonths(data) {
      const now = this.unrecordedByMonth(data);
      const out = {};
      for (const [k, old] of Object.entries(data.unrecordedSeen || {})) if ((now.get(k) || 0) !== old) out[k] = old;
      return out;
    },

    currentSeen(data) { return Object.fromEntries(this.unrecordedByMonth(data)); },

    // ---- 雑費の内訳（計算には使わない。内訳の画面の表示だけ） ----

    /** ある月の雑費と、その内訳（lines：{item, amount}。「残り全部」は計算した額、メモだけの行は null）。unknown がマイナスなら内訳が雑費より多い。 */
    miscMonth(data, month, unrecorded = this.unrecordedByMonth(data)) {
      const misc = Math.max(0, unrecorded.get(month) || 0);
      const items = (data.miscItems || []).filter((x) => x.month === month);
      const fixedSum = sum(items.filter((x) => !x.rest), (x) => x.amount || 0);
      const lines = items.map((x) => ({ item: x, amount: x.rest ? Math.max(0, misc - fixedSum) : x.amount == null ? null : x.amount }));
      const known = sum(lines, (l) => l.amount || 0);
      return { misc, lines, known, unknown: misc - known };
    },

    /** 期間（月・年）の雑費の内訳をまとめたもの（年の画面用）。 */
    miscRange(data, from, to) {
      const unrecorded = this.unrecordedByMonth(data);
      const views = [];
      for (let m = D.ym(from); m <= D.ym(to); m = YM.plus(m, 1)) views.push(this.miscMonth(data, m, unrecorded));
      const misc = sum(views, (v) => v.misc), known = sum(views, (v) => v.known);
      return { misc, lines: views.flatMap((v) => v.lines), known, unknown: misc - known };
    },
  };

  // ===================================================================
  // 枠：金額は毎回ちがい、確定したら入れる繰り返し（水道・電気・通信費など）。Android版 domain/Slots.kt と同じ
  // ===================================================================
  const SlotLogic = {
    /**
     * 枠の、金額待ちの回（始まりの日から to まで、日付順）。ふだんは口座から払う枠だけ（計算に入れていないことの注記用）。
     * withCard=true ならカードで払う枠も含める（カードで払う枠は残高の計算には入らず、入れた金額は請求の内訳の初期値になる）。
     */
    pending(data, to, withCard = false) {
      const accs = new Map(data.accounts.map((a) => [a.id, a]));
      const cards = new Set(data.cards.filter((c) => !c.retired).map((c) => c.id));
      return data.entries.filter((e) => e.slot && (e.cardId ? withCard && cards.has(e.cardId) : accs.has(e.accountId)))
        .flatMap((e) => BudgetCalculator.expand(e, e.date, to, !!e.cardId || noBankDays(accs.get(e.accountId)), true).filter((o) => o.pending))
        .sort((a, b) => cmpStr(a.date, b.date) || cmpStr(a.name, b.name));
    },
    /** 日付を過ぎた（今日までの）金額待ち（カードで払う枠も含む）。ホームで知らせ、そこで金額を入れられる。 */
    overdue(data, today) { return this.pending(data, today, true); },
    /** 参考に出す前回の金額（計算には使わない）。口座払いは before より前の「この回だけ」の金額、カード払いは before より前の請求の内訳から。 */
    previousAmount(data, e, before) {
      if (e.cardId) {
        const bills = data.bills.filter((b) => b.cardId === e.cardId && b.paymentDate < before).sort((a, b) => cmpStr(b.paymentDate, a.paymentDate));
        for (const b of bills) { const x = (b.items || []).find((i) => i.entryId === e.id); if (x) return x.amount; }
      }
      let best = null;
      for (const c of e.changes || []) if (!c.skipped && c.amount != null && c.originalDate < before && (!best || c.originalDate > best.originalDate)) best = c;
      return best ? best.amount : null;
    },
  };

  Object.assign(K, { D, YM, INCOME, EXPENSE, sum, cmpStr, groupBy, noBankDays, isPrepaid, kindLabel,
    CHECK, CheckOrder, CardPresets, patternLabel, repeatEvery, REPEAT_CHOICES, everyLabel, repeatLabel, JapaneseHolidays, BudgetCalculator, CardLogic, MonthlyLogic, BreakdownLogic, SlotLogic });
})(window.K = window.K || {});
