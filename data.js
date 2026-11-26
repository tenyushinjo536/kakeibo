/*
 * 家計簿 iPhone版：データ（保存・変更・CSV）。Android版 data/*.kt を移したもの。
 * 保存先は端末のブラウザの保存領域（localStorage）だけ。外には送らない。
 * 保存データの形（版8）と CSV（形式2）は Android版と同じ。
 */
(function (K) {
  'use strict';
  const { D, CardLogic, BreakdownLogic, BudgetCalculator, INCOME, EXPENSE } = K;

  const newId = () => (crypto.randomUUID ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (crypto.getRandomValues(new Uint8Array(1))[0] & 15);
      return (c === 'x' ? r : (r & 3) | 8).toString(16);
    }));
  const now = () => { const t = new Date(); const p = (n) => String(n).padStart(2, '0');
    return `${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())} ${p(t.getHours())}:${p(t.getMinutes())}`; };

  const emptyData = () => ({ accounts: [], entries: [], cards: [], bills: [], snapshots: [], unrecordedSeen: {}, history: [], legacy: null });

  // ===================================================================
  // 保存（正本）：localStorage の1つのキーに JSON
  // ===================================================================
  const KEY = 'kakeibo.budget';
  const BudgetStore = {
    /** 1〜3=Android v0.1〜0.4、4=確定だけ、5=残高の記録、6=電子マネー、7=この回だけの変更、8=請求ごとの口座・使わないカード、9=残高を確かめた順番。 */
    VERSION: 9,
    storage: (() => { try { return window.localStorage; } catch (e) { return null; } })(),

    load(today) {
      if (!this.storage) return { type: 'broken', reason: 'この端末では保存領域を使えません（プライベートブラウズでは保存できません）' };
      let text;
      try { text = this.storage.getItem(KEY); } catch (e) { return { type: 'broken', reason: String(e) }; }
      if (text == null) return { type: 'empty' };
      try {
        const version = JSON.parse(text).version;
        return { type: 'ok', data: this.decode(text, today), fromVersion: version < this.VERSION ? version : null };
      } catch (e) {
        return { type: 'broken', reason: (e && e.message) || String(e) };
      }
    },

    /** 保存に成功したら true。失敗したら元のデータは変わらない（setItem は全部書くか、何もしないか）。 */
    save(data) {
      try { this.storage.setItem(KEY, this.encode(data)); return true; } catch (e) { return false; }
    },

    backupBeforeMigration(fromVersion) {
      try {
        const k = `${KEY}.backup_v${fromVersion}`;
        if (this.storage.getItem(k) == null) this.storage.setItem(k, this.storage.getItem(KEY));
        return true;
      } catch (e) { return false; }
    },

    keepBrokenAndReset() {
      try {
        const text = this.storage.getItem(KEY);
        if (text != null) this.storage.setItem(`${KEY}.broken_${Date.now()}`, text);
        this.storage.removeItem(KEY);
        return true;
      } catch (e) { return false; }
    },

    encode(d) {
      return JSON.stringify({
        version: this.VERSION,
        accounts: d.accounts.map((a) => ({ id: a.id, name: a.name, balance: a.balance, asOf: a.asOf,
          isDebit: !!a.isDebit, isSalary: !!a.isSalary, isCash: !!a.isCash, isEmoney: !!a.isEmoney, isIc: !!a.isIc })),
        entries: d.entries.map((e) => ({ id: e.id, name: e.name, amount: e.amount, date: e.date, kind: e.kind,
          accountId: e.accountId, repeatMonthly: !!e.repeatMonthly, endDate: e.endDate ?? null, lastAmount: e.lastAmount ?? null,
          chargeFrom: e.chargeFrom ?? null,
          changes: (e.changes || []).map((c) => ({ originalDate: c.originalDate, date: c.date ?? null, amount: c.amount ?? null, skipped: !!c.skipped })) })),
        cards: d.cards.map((c) => ({ id: c.id, name: c.name, closingDay: c.closingDay, paymentDay: c.paymentDay, accountId: c.accountId, retired: !!c.retired })),
        bills: d.bills.map((b) => ({ id: b.id, cardId: b.cardId, paymentDate: b.paymentDate, amount: b.amount, inputDate: b.inputDate, accountId: b.accountId })),
        snapshots: d.snapshots.map((s) => ({ accountId: s.accountId, date: s.date, amount: s.amount, order: s.order ? s.order.slice() : null })),
        unrecordedSeen: { ...(d.unrecordedSeen || {}) },
        history: d.history.map((h) => ({ at: h.at, text: h.text })),
        legacy: d.legacy ?? null,
      }, null, 2);
    },

    /** 読み込み。版4〜8に対応（版1〜3は Android版にしかないので、ここでは読まない）。 */
    decode(text, today) {
      const root = JSON.parse(text);
      const v = root.version;
      if (typeof v !== 'number') throw new Error('版の情報がありません');
      if (v > this.VERSION) throw new Error(`新しい版のアプリで作られたデータです（版 ${v}）`);
      if (v < 4) throw new Error(`古い形式のデータです（版 ${v}）。Android版でCSVに書き出してから読み込んでください`);
      const str = (o, k) => { if (typeof o[k] !== 'string') throw new Error(`「${k}」が読めません`); return o[k]; };
      const num = (o, k) => { if (typeof o[k] !== 'number' || !Number.isFinite(o[k])) throw new Error(`「${k}」が読めません`); return Math.trunc(o[k]); };
      const date = (o, k) => { const s = str(o, k); if (!D.valid(s)) throw new Error(`日付「${s}」が読めません`); return s; };
      const dateOrNull = (o, k) => (o[k] == null ? null : date(o, k));
      const numOrNull = (o, k) => (o[k] == null ? null : num(o, k));
      const arr = (k) => (Array.isArray(root[k]) ? root[k] : []);
      const accounts = arr('accounts').map((o) => ({ id: str(o, 'id'), name: str(o, 'name'), balance: num(o, 'balance'), asOf: o.asOf ? date(o, 'asOf') : today,
        isDebit: !!o.isDebit, isSalary: !!o.isSalary, isCash: !!o.isCash, isEmoney: !!o.isEmoney, isIc: !!o.isIc }));
      const entries = arr('entries').map((o) => {
        if (o.kind !== INCOME && o.kind !== EXPENSE) throw new Error(`区分「${o.kind}」が読めません`);
        return { id: str(o, 'id'), name: str(o, 'name'), amount: num(o, 'amount'), date: date(o, 'date'), kind: o.kind,
          accountId: str(o, 'accountId'), repeatMonthly: !!o.repeatMonthly, endDate: dateOrNull(o, 'endDate'), lastAmount: numOrNull(o, 'lastAmount'),
          chargeFrom: o.chargeFrom == null ? null : str(o, 'chargeFrom'),
          changes: (Array.isArray(o.changes) ? o.changes : []).map((c) => ({ originalDate: date(c, 'originalDate'), date: dateOrNull(c, 'date'), amount: numOrNull(c, 'amount'), skipped: !!c.skipped })) };
      });
      const cards = arr('cards').map((o) => ({ id: str(o, 'id'), name: str(o, 'name'), closingDay: num(o, 'closingDay'), paymentDay: num(o, 'paymentDay'), accountId: str(o, 'accountId'), retired: !!o.retired }));
      const cardAccount = new Map(cards.map((c) => [c.id, c.accountId]));
      const bills = arr('bills').map((o) => ({ id: str(o, 'id'), cardId: str(o, 'cardId'), paymentDate: date(o, 'paymentDate'), amount: num(o, 'amount'), inputDate: date(o, 'inputDate'),
        accountId: typeof o.accountId === 'string' ? o.accountId : (cardAccount.get(o.cardId) || '') }));
      const snapshots = Array.isArray(root.snapshots)
        ? root.snapshots.map((o) => ({ accountId: str(o, 'accountId'), date: date(o, 'date'), amount: num(o, 'amount'),
          order: Array.isArray(o.order) ? o.order.map(String) : null }))   // 版8までは無い（並びの指定なし＝その日の出入りは全部「前」）
        : accounts.map((a) => ({ accountId: a.id, date: a.asOf, amount: a.balance, order: null }));
      const unrecordedSeen = {};
      if (root.unrecordedSeen && typeof root.unrecordedSeen === 'object') for (const [k, x] of Object.entries(root.unrecordedSeen)) if (typeof x === 'number') unrecordedSeen[k] = x;
      const history = arr('history').map((o) => ({ at: String(o.at), text: String(o.text) }));
      return { accounts, entries, cards, bills, snapshots, unrecordedSeen, history, legacy: typeof root.legacy === 'string' ? root.legacy : null };
    },

    legacyCount(legacy) {
      if (!legacy) return 0;
      try {
        const o = JSON.parse(legacy);
        return ['estimatedEntries', 'purchases', 'transfers', 'cashCounts', 'appliedTxns'].reduce((a, k) => a + (Array.isArray(o[k]) ? o[k].length : 0), 0);
      } catch (e) { return 0; }
    },
  };

  // ===================================================================
  // 画面が使う唯一の窓口（変更・履歴・元に戻す）
  // ===================================================================
  class BudgetRepository {
    constructor(store) {
      this.store = store;
      this.data = emptyData();
      this.brokenReason = null;
      this.undoLabel = null;
      this.undoSnapshot = null;
      /** 直前に記録した過去の出入り（残高の時点以前）。ホームで「残高にも反映する」を選べるようにする。 */
      this.balanceHint = null;
    }

    load(today) {
      const r = this.store.load(today);
      if (r.type === 'ok') {
        this.data = r.data; this.brokenReason = null;
        if (r.fromVersion != null && this.store.backupBeforeMigration(r.fromVersion)) {
          this.commit(this.data, `データを版${r.fromVersion}から版${this.store.VERSION}へ移した（元のデータは控えを保存）`, false);
        }
      } else if (r.type === 'empty') {
        this.data = BudgetRepository.defaultData(today); this.brokenReason = null;
      } else {
        this.data = emptyData(); this.brokenReason = r.reason;
      }
      if (this.brokenReason == null) this.rememberNewUnrecordedMonths();
    }

    /** 変更を保存する。historyText は履歴に書く文（null なら履歴に書かない）。保存に失敗したら何も変えずに false。 */
    commit(next, historyText, undoable = true) {
      if (this.brokenReason != null) return false;
      const seen = historyText == null ? next : { ...next, unrecordedSeen: { ...next.unrecordedSeen, ...BreakdownLogic.currentSeen(next) } };
      const withHistory = historyText == null ? seen : { ...seen, history: [{ at: now(), text: historyText }, ...seen.history].slice(0, BudgetRepository.MAX_HISTORY) };
      if (!this.store.save(withHistory)) return false;
      if (historyText != null) this.balanceHint = null;
      if (undoable && historyText != null) { this.undoSnapshot = this.data; this.undoLabel = historyText; }
      else if (historyText != null) this.clearUndo();
      this.data = withHistory;
      return true;
    }

    rememberNewUnrecordedMonths() {
      const cur = BreakdownLogic.currentSeen(this.data);
      const missing = Object.fromEntries(Object.entries(cur).filter(([k]) => !(k in this.data.unrecordedSeen)));
      if (Object.keys(missing).length) this.commit({ ...this.data, unrecordedSeen: { ...this.data.unrecordedSeen, ...missing } }, null, false);
    }

    acknowledgeUnrecordedChanges() {
      const changed = BreakdownLogic.changedMonths(this.data);
      if (!Object.keys(changed).length) return true;
      const cur = BreakdownLogic.currentSeen(this.data);
      const text = '記録外の入出金の変更を確認：' + Object.entries(changed).map(([m, old]) => `${m} ${old}円→${cur[m] || 0}円`).join('、');
      return this.commit({ ...this.data, unrecordedSeen: { ...this.data.unrecordedSeen, ...cur } }, text, false);
    }

    undo() {
      const snap = this.undoSnapshot;
      if (!snap) return false;
      const restored = { ...snap, history: [{ at: now(), text: '元に戻した：' + (this.undoLabel || '') }, ...this.data.history].slice(0, BudgetRepository.MAX_HISTORY) };
      if (!this.store.save(restored)) return false;
      this.data = restored;
      this.clearUndo();
      return true;
    }

    clearUndo() { this.undoSnapshot = null; this.undoLabel = null; this.balanceHint = null; }

    resetAfterBroken(today) {
      if (!this.store.keepBrokenAndReset()) return false;
      this.brokenReason = null;
      this.data = BudgetRepository.defaultData(today);
      return this.store.save(this.data);
    }

    accountNameTaken(name, exceptId) { return this.data.accounts.some((a) => a.name === name && a.id !== exceptId); }
    cardNameTaken(name, exceptId) { return this.data.cards.some((c) => c.name === name && c.id !== exceptId); }

    /** 同じ口座・同じ日の記録は置き換える（確かめた順番の指定は引き継ぐ）。 */
    static withSnapshot(list, s) {
      const old = list.find((x) => x.accountId === s.accountId && x.date === s.date);
      return [...list.filter((x) => x !== old), { order: old ? old.order || null : null, ...s }];
    }

    /**
     * その日全体の流れを保存する（dayKeys は上から起きた順の key と "@:口座のid"）。
     * その日に残高を確かめた口座それぞれの記録に、自分の位置を "@" にした並びを入れる（計算は口座ごと）。
     */
    setDayOrder(date, dayKeys) {
      const checks = K.CheckOrder.checksOn(this.data, date);
      if (!checks.length) return false;
      let snaps = this.data.snapshots;
      for (const c of checks) {
        const s = snaps.find((x) => x.accountId === c.acc.id && x.date === date);
        const order = K.CheckOrder.orderFor(dayKeys, c.acc.id);
        snaps = s ? snaps.map((x) => (x === s ? { ...x, order } : x)) : [...snaps, { accountId: c.acc.id, date, amount: c.amount, order }];
      }
      const items = new Map(K.BudgetCalculator.occurrences(this.data, date, date).map((o) => [K.CheckOrder.key(o), o]));
      const names = new Map(checks.map((c) => [K.CheckOrder.checkToken(c.acc.id), c.acc.name]));
      const flow = dayKeys.map((k) => (names.has(k) ? `${names.get(k)}を確認` : items.has(k) ? items.get(k).name : null)).filter(Boolean).join('→');
      return this.commit({ ...this.data, snapshots: snaps }, `${D.m(date)}/${D.d(date)}の流れを変更：${flow}`);
    }

    /** 残高を確かめた順番を保存する（order は上から起きた順の key と "@"）。 */
    setCheckOrder(accountId, date, order) {
      const a = this.data.accounts.find((x) => x.id === accountId);
      if (!a) return false;
      let snaps = this.data.snapshots;
      let s = snaps.find((x) => x.accountId === accountId && x.date === date);
      if (!s) {
        if (date !== a.asOf) return false;
        s = { accountId, date, amount: a.balance, order: null };
        snaps = [...snaps, s];
      }
      const items = K.CheckOrder.itemsOn(this.data, accountId, date);
      const byKey = new Map(items.map((o) => [K.CheckOrder.key(o), o]));
      const after = order.slice(order.indexOf(K.CHECK) + 1).filter((k) => byKey.has(k)).map((k) => byKey.get(k).name);
      const md = `${D.m(date)}/${D.d(date)}`;
      const text = `残高を確かめた順番を変更：${a.name}（${md}・${s.amount}円）` + (after.length ? `、確かめた後に ${after.join('・')}` : '、この日の入出金はすべて確かめる前');
      return this.commit({ ...this.data, snapshots: snaps.map((x) => (x === s ? { ...x, order: order.slice() } : x)) }, text);
    }

    updateBalances(changes, today, currentById) {
      const ids = Object.keys(changes);
      if (!ids.length) return true;
      const accounts = this.data.accounts.map((a) => (a.id in changes ? { ...a, balance: changes[a.id], asOf: today } : a));
      const text = '残高を更新：' + ids.map((id) => {
        const a = this.data.accounts.find((x) => x.id === id);
        const diff = changes[id] - (currentById[id] ?? a.balance);
        return `${a.name} ${changes[id]}円（推定との差 ${diff >= 0 ? '+' : ''}${diff}）`;
      }).join('、');
      let snaps = this.data.snapshots;
      // 新しく確かめた残高なので、その日の並びは指定なし（記録済みの出入りは全部「確かめる前」）
      for (const id of ids) snaps = BudgetRepository.withSnapshot(snaps, { accountId: id, date: today, amount: changes[id], order: null });
      return this.commit({ ...this.data, accounts, snapshots: snaps }, text);
    }

    upsertAccount(a) {
      const list = this.data.accounts.slice();
      const i = list.findIndex((x) => x.id === a.id);
      const old = i >= 0 ? list[i] : null;
      const text = old ? `口座「${a.name}」を変更` : `口座「${a.name}」を追加（残高 ${a.balance}円）`;
      if (i >= 0) list[i] = a; else list.push(a);
      const snaps = !old || old.balance !== a.balance ? BudgetRepository.withSnapshot(this.data.snapshots, { accountId: a.id, date: a.asOf, amount: a.balance, order: null }) : this.data.snapshots;
      return this.commit({ ...this.data, accounts: list, snapshots: snaps }, text);
    }

    correctLastBalance(accountId, amount) {
      const a = this.data.accounts.find((x) => x.id === accountId);
      if (!a) return false;
      if (a.balance === amount) return true;
      const accounts = this.data.accounts.map((x) => (x.id === accountId ? { ...x, balance: amount } : x));
      const snaps = BudgetRepository.withSnapshot(this.data.snapshots, { accountId, date: a.asOf, amount });
      return this.commit({ ...this.data, accounts, snapshots: snaps }, `残高を訂正：${a.name} ${a.asOf}時点 ${a.balance}円→${amount}円`);
    }

    deleteAccount(id) {
      const a = this.data.accounts.find((x) => x.id === id);
      if (!a) return false;
      return this.commit({ ...this.data, accounts: this.data.accounts.filter((x) => x.id !== id) }, `口座「${a.name}」を削除`);
    }

    setOccurrenceChange(entryId, originalDate, change) {
      const e = this.data.entries.find((x) => x.id === entryId);
      if (!e) return false;
      const rest = (e.changes || []).filter((c) => c.originalDate !== originalDate);
      const next = { ...e, changes: [...rest, ...(change ? [change] : [])].sort((a, b) => K.cmpStr(a.originalDate, b.originalDate)) };
      const md = (x) => `${D.m(x)}/${D.d(x)}`;
      const text = change == null ? `この回を予定どおりに戻す：${e.name}（${md(originalDate)}の回）`
        : change.skipped ? `この回を飛ばす：${e.name}（${md(originalDate)}の回）`
          : `この回だけ変更：${e.name}（${md(originalDate)}の回）→ ` + [change.date ? `日付 ${md(change.date)}` : null, change.amount != null ? `金額 ${change.amount}円` : null].filter(Boolean).join('・');
      return this.commit({ ...this.data, entries: this.data.entries.map((x) => (x.id === entryId ? next : x)) }, text);
    }

    /** 「この回以降」を変える：元の予定を from の前で打ち切り、新しい予定を from から始める。 */
    splitSeries(old, from, newEntry) {
      const kept = { ...old, endDate: D.plusDays(from, -1), lastAmount: null, changes: (old.changes || []).filter((c) => c.originalDate < from) };
      const newRaw = new Set(BudgetCalculator.expand({ ...newEntry, changes: [] }, newEntry.date, newEntry.endDate || D.plusYears(from, 30)).map((o) => o.originalDate));
      const moved = { ...newEntry, changes: (old.changes || []).filter((c) => c.originalDate >= from && newRaw.has(c.originalDate)) };
      const entries = [...this.data.entries.map((x) => (x.id === old.id ? kept : x)), moved];
      return this.commit({ ...this.data, entries }, `この回以降を変更：${old.name}（${D.y(from)}/${D.m(from)}/${D.d(from)}から ${moved.amount}円・毎月${D.d(moved.date)}日）`);
    }

    upsertEntry(e, label) {
      const list = this.data.entries.slice();
      const i = list.findIndex((x) => x.id === e.id);
      if (i >= 0) list[i] = e; else list.push(e);
      return this.commit({ ...this.data, entries: list }, (i >= 0 ? '変更：' : '') + `${label} ${e.name} ${e.amount}円（${e.date}）`);
    }

    deleteEntry(id) {
      const e = this.data.entries.find((x) => x.id === id);
      if (!e) return false;
      return this.commit({ ...this.data, entries: this.data.entries.filter((x) => x.id !== id) }, `削除：${e.name} ${e.amount}円（${e.date}）`);
    }

    upsertCard(c, today) {
      const list = this.data.cards.slice();
      const i = list.findIndex((x) => x.id === c.id);
      const old = i >= 0 ? list[i] : null;
      if (i >= 0) list[i] = c; else list.push(c);
      const moved = old != null && old.accountId !== c.accountId;
      const bills = moved ? BudgetRepository.billsAfterAccountChange(this.data.bills, c.id, c.accountId, today) : this.data.bills;
      return this.commit({ ...this.data, cards: list, bills }, (i >= 0 ? 'カードを変更：' : 'カードを登録：') + `${c.name}（${c.closingDay}日締め・${c.paymentDay}日払い）` +
        (moved ? '、引き落とし口座を変更（引き落とし済みの請求は元の口座のまま）' : ''));
    }

    deleteCard(id) {
      const c = this.data.cards.find((x) => x.id === id);
      if (!c) return false;
      return this.data.bills.some((b) => b.cardId === id)
        ? this.commit({ ...this.data, cards: this.data.cards.map((x) => (x.id === id ? { ...x, retired: true } : x)) }, `カードを使わないにした：${c.name}（過去の請求は残す）`)
        : this.commit({ ...this.data, cards: this.data.cards.filter((x) => x.id !== id) }, `カードを削除：${c.name}`);
    }

    reviveCard(id) {
      const c = this.data.cards.find((x) => x.id === id);
      if (!c) return false;
      return this.commit({ ...this.data, cards: this.data.cards.map((x) => (x.id === id ? { ...x, retired: false } : x)) }, `カードをまた使う：${c.name}`);
    }

    endSeries(id, today) {
      const e = this.data.entries.find((x) => x.id === id);
      if (!e) return false;
      return this.commit({ ...this.data, entries: this.data.entries.map((x) => (x.id === id ? BudgetRepository.endedSeries(e, today) : x)) },
        `毎月の予定を終了：${e.name}（${today}まで。過去の回は残す）`);
    }

    setBill(card, paymentRaw, amount, today) {
      const old = CardLogic.confirmedBill(this.data, card, paymentRaw);
      const text = `カードの請求を確定：${card.name} ${paymentRaw}払い ${amount}円` + (old ? `（${old.amount}円から変更）` : '');
      return this.commit(CardLogic.setBill(this.data, card, paymentRaw, amount, today, newId()), text);
    }

    deleteBill(card, paymentRaw) {
      return this.commit(CardLogic.deleteBill(this.data, card, paymentRaw), `カードの請求を削除：${card.name} ${paymentRaw}払い`);
    }

    replaceWithImport(imported, summary) {
      const ok = this.commit({ ...imported, history: this.data.history, legacy: this.data.legacy, unrecordedSeen: {} }, `CSVから読み込んだ（${summary}）`);
      if (ok) this.rememberNewUnrecordedMonths();
      return ok;
    }

    static billsAfterAccountChange(bills, cardId, accountId, today) {
      return bills.map((b) => (b.cardId === cardId && CardLogic.payDay(b.paymentDate) > today ? { ...b, accountId } : b));
    }

    static endedSeries(e, today) {
      return { ...e, endDate: today, lastAmount: null, changes: (e.changes || []).filter((c) => c.originalDate <= today) };
    }

    /** 初回だけ、口座の枠を用意する（金額は0。個人の数字はアプリに書かない）。 */
    static defaultData(today) {
      const accounts = [
        { id: newId(), name: '引き落とし口座', balance: 0, asOf: today, isDebit: true, isSalary: false, isCash: false, isEmoney: false, isIc: false },
        { id: newId(), name: '給料の口座', balance: 0, asOf: today, isDebit: false, isSalary: true, isCash: false, isEmoney: false, isIc: false },
        { id: newId(), name: '現金', balance: 0, asOf: today, isDebit: false, isSalary: false, isCash: true, isEmoney: false, isIc: false },
      ];
      return { ...emptyData(), accounts, snapshots: accounts.map((a) => ({ accountId: a.id, date: today, amount: 0 })) };
    }
  }
  BudgetRepository.MAX_HISTORY = 500;

  // ===================================================================
  // CSV（相談用と引き継ぎ用を兼ねる。Android版と同じ形式2）
  // ===================================================================
  const HEADER = ['種類', '名前', '区分', '金額', '日付', '口座', '繰り返し', '最終日', '最終回の金額', '締め日', '支払日', '時点', '合計残高', '元の日付'];
  const HEADER_V1 = HEADER.slice(0, -1);
  const col = Object.fromEntries(HEADER.map((h, i) => [h, i]));
  const BOM = '﻿';

  class Bad extends Error { constructor(line, msg) { super(msg); this.line = line; } }

  const CsvFormat = {
    FORMAT: 2, HEADER, BOM,

    duplicateNames(data) {
      const dups = (names) => [...new Set(names.filter((n, i) => names.indexOf(n) !== i))];
      return [...new Set([...dups(data.accounts.map((a) => a.name)), ...dups(data.cards.map((c) => c.name))])];
    },

    export(data, appVersion, today, forecast) {
      const accName = new Map(data.accounts.map((a) => [a.id, a.name]));
      const cardName = new Map(data.cards.map((c) => [c.id, c.name]));
      const rows = [HEADER];
      const rec = (type, kv) => {
        const r = HEADER.map(() => '');
        r[0] = type;
        for (const [k, v] of Object.entries(kv)) r[col[k]] = v == null ? '' : String(v);
        rows.push(r);
      };
      rec('情報', { 名前: `家計簿CSV 形式${this.FORMAT}`, 区分: `アプリ v${appVersion}`, 日付: today });
      for (const a of data.accounts) {
        const flags = [a.isDebit && '引き落とし', a.isSalary && '給料', a.isCash && '現金', a.isEmoney && '電子マネー', a.isIc && '交通系IC'].filter(Boolean);
        // 残高は「時点の日の終わり」の額で書く（確かめた後に起きた出入りを足す）。CSVの形は変えずに、どの版で読んでも同じ数字になる
        rec('口座', { 名前: a.name, 区分: flags.join('・'), 金額: a.balance + K.CheckOrder.afterSum(data, a.id, a.asOf), 時点: a.asOf });
      }
      for (const c of data.cards) rec('カード', { 名前: c.name, 区分: c.retired ? '使わない' : '', 口座: accName.get(c.accountId), 締め日: c.closingDay, 支払日: c.paymentDay });
      for (const e of data.entries.slice().sort((a, b) => K.cmpStr(a.date, b.date))) {
        let kindText = e.kind === INCOME ? '入金' : '出金';
        if (e.chargeFrom) kindText = 'チャージ：' + (e.chargeFrom.startsWith('card:') ? cardName.get(e.chargeFrom.slice(5)) : accName.get(e.chargeFrom.slice(4)));
        rec('予定', { 名前: e.name, 区分: kindText, 金額: e.amount, 日付: e.date, 口座: accName.get(e.accountId), 繰り返し: e.repeatMonthly ? '毎月' : 'なし',
          最終日: e.endDate, 最終回の金額: e.lastAmount });
        if (e.repeatMonthly) for (const c of e.changes || []) {
          rec('変更', { 名前: e.name, 区分: c.skipped ? '飛ばす' : 'この回だけ', 金額: c.amount, 日付: c.date, 元の日付: c.originalDate });
        }
      }
      const cardById = new Map(data.cards.map((c) => [c.id, c]));
      for (const b of data.bills.slice().sort((a, b2) => K.cmpStr(a.paymentDate, b2.paymentDate))) {
        const c = cardById.get(b.cardId);
        if (!c) continue;
        rec('請求', { 名前: c.name, 区分: '確定', 金額: b.amount, 日付: b.paymentDate, 口座: accName.get(b.accountId) ?? accName.get(c.accountId), 時点: b.inputDate });
      }
      for (const r of forecast) {
        rec('見通し', { 名前: r.occ.name, 区分: r.occ.kind === INCOME ? '入金' : '出金', 金額: r.occ.amount, 日付: r.occ.date, 口座: accName.get(r.occ.accountId), 合計残高: r.totalAfter });
      }
      const textCols = new Set([col['名前'], col['口座']]);
      return BOM + rows.map((r, i) => r.map((v, j) => this.escape(i > 0 && textCols.has(j) ? this.guardFormula(v) : v)).join(',')).join('\r\n') + '\r\n';
    },

    escape(s) { return /[,"\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; },
    guardFormula(s) { return s && '=+-@'.includes(s[0]) ? "'" + s : s; },
    unguard(s) { return s.length >= 2 && s[0] === "'" && '=+-@'.includes(s[1]) ? s.slice(1) : s; },

    parse(text) {
      const out = [];
      let row = [], sb = '', inQ = false;
      const endField = () => { row.push(sb); sb = ''; };
      const endRow = () => { endField(); out.push(row); row = []; };
      for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (inQ) {
          if (ch === '"') { if (text[i + 1] === '"') { sb += '"'; i++; } else inQ = false; } else sb += ch;
        } else if (ch === '"') inQ = true;
        else if (ch === ',') endField();
        else if (ch === '\r') { if (text[i + 1] === '\n') i++; endRow(); }
        else if (ch === '\n') endRow();
        else sb += ch;
      }
      if (sb.length || row.length) endRow();
      return out;
    },

    /** 全部の行を確かめてから結果を返す（1か所でも問題があれば error で、何も変えない）。 */
    import(text) {
      const recs = this.parse(text.startsWith(BOM) ? text.slice(1) : text).map((r, index) => ({ index, r })).filter(({ r }) => r.some((x) => x.trim()));
      if (!recs.length) return { error: true, line: 1, message: 'ファイルが空です' };
      const head = recs[0].r.map((x) => x.trim());
      const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
      if (!same(head, HEADER) && !same(head, HEADER_V1)) {
        return { error: true, line: recs[0].index + 1, message: '1行目の見出しが家計簿のCSVと違います。Excelで保存し直した場合は「CSV UTF-8（コンマ区切り）」で保存してください' };
      }
      try {
        const rows = recs.slice(1).map(({ index, r }) => [index + 1, r]);
        const get = (r, name) => (r[col[name]] ?? '').trim();
        const text_ = (line, r, name, required = true) => { const v = this.unguard(get(r, name)); if (required && !v) throw new Bad(line, `「${name}」が空です`); return v; };
        const long = (line, r, name, required = true) => {
          const raw = get(r, name);
          const v = raw.replace(/,/g, '').replace(/円/g, '').replace(/−/g, '-');
          if (!v) { if (required) throw new Bad(line, `「${name}」が空です`); return null; }
          if (!/^[-+]?\d+$/.test(v)) throw new Bad(line, `「${name}」の「${raw}」は数字として読めません`);
          return parseInt(v, 10);
        };
        const date = (line, r, name, required = true) => {
          const v = get(r, name);
          if (!v) { if (required) throw new Bad(line, `「${name}」が空です`); return null; }
          const p = v.replace(/\//g, '-').split('-');
          const s = p.length === 3 && p.every((x) => /^\d+$/.test(x)) ? D.of(+p[0], +p[1], +p[2]) : '';
          if (!D.valid(s)) throw new Bad(line, `「${name}」の「${v}」は日付として読めません（例：2026-11-22）`);
          return s;
        };
        const day = (line, r, name) => { const v = long(line, r, name); if (v < 1 || v > 31) throw new Bad(line, `「${name}」は1〜31で入れてください`); return v; };
        const known = new Set(['情報', '口座', 'カード', '予定', '変更', '請求', '見通し']);
        for (const [line, r] of rows) if (!known.has(get(r, '種類'))) throw new Bad(line, `種類「${get(r, '種類')}」は読めません`);
        const of = (t) => rows.filter(([, r]) => get(r, '種類') === t);
        const dupCheck = (list, key, label) => {
          const seen = new Set();
          for (const [line, x] of list) { if (seen.has(key(x))) throw new Bad(line, `${label}「${key(x)}」が2つあります`); seen.add(key(x)); }
        };

        const accounts = of('口座').map(([line, r]) => {
          const f = get(r, '区分');
          return [line, { id: newId(), name: text_(line, r, '名前'), balance: long(line, r, '金額'), asOf: date(line, r, '時点'),
            isDebit: f.includes('引き落とし'), isSalary: f.includes('給料'), isCash: f.includes('現金'), isEmoney: f.includes('電子マネー'), isIc: f.includes('交通系IC') }];
        });
        dupCheck(accounts, (a) => a.name, '口座');
        const accByName = new Map(accounts.map(([, a]) => [a.name, a.id]));
        const accRef = (line, r) => { const n = text_(line, r, '口座'); if (!accByName.has(n)) throw new Bad(line, `口座「${n}」がCSVの中にありません`); return accByName.get(n); };

        const cards = of('カード').map(([line, r]) => [line, { id: newId(), name: text_(line, r, '名前'), closingDay: day(line, r, '締め日'), paymentDay: day(line, r, '支払日'),
          accountId: accRef(line, r), retired: get(r, '区分') === '使わない' }]);
        dupCheck(cards, (c) => c.name, 'カード');
        const cardByName = new Map(cards.map(([, c]) => [c.name, c.id]));

        const entryRows = of('予定').map(([line, r]) => {
          const kt = get(r, '区分');
          let chargeFrom = null, kind;
          if (kt === '入金') kind = INCOME;
          else if (kt === '出金') kind = EXPENSE;
          else if (kt.startsWith('チャージ：')) {
            const src = kt.slice(5);
            if (cardByName.has(src)) chargeFrom = 'card:' + cardByName.get(src);
            else if (accByName.has(src)) chargeFrom = 'acc:' + accByName.get(src);
            else throw new Bad(line, `チャージの払い元「${src}」がCSVの中にありません`);
            kind = INCOME;
          } else throw new Bad(line, '予定の「区分」は「入金」「出金」「チャージ：払い元」のどれかにしてください');
          const amount = long(line, r, '金額');
          if (amount <= 0) throw new Bad(line, '「金額」は1円以上にしてください');
          const start = date(line, r, '日付');
          const rp = get(r, '繰り返し');
          if (!['毎月', '', 'なし'].includes(rp)) throw new Bad(line, '「繰り返し」は「毎月」か「なし」にしてください');
          const repeat = rp === '毎月';
          const end = repeat ? date(line, r, '最終日', false) : null;
          if (end != null && end < start) throw new Bad(line, '「最終日」が「日付」より前です');
          const last = repeat && end != null ? long(line, r, '最終回の金額', false) : null;
          if (last != null && last <= 0) throw new Bad(line, '「最終回の金額」は1円以上にしてください');
          return [line, { id: newId(), name: text_(line, r, '名前'), amount, date: start, kind, accountId: accRef(line, r), repeatMonthly: repeat,
            endDate: end, lastAmount: last, chargeFrom, changes: [] }];
        });
        const changesByIdx = new Map();
        for (const [line, r] of of('変更')) {
          let idx = -1;
          entryRows.forEach(([l], i) => { if (l < line) idx = i; });
          if (idx < 0) throw new Bad(line, '「変更」の行は、対象の「予定」の行のすぐ後に置いてください');
          const target = entryRows[idx][1];
          const n = text_(line, r, '名前');
          if (n !== target.name) throw new Bad(line, `「変更」の名前「${n}」が、すぐ上の予定「${target.name}」と違います`);
          if (!target.repeatMonthly) throw new Bad(line, '「変更」は毎月の予定にだけ付けられます');
          const orig = date(line, r, '元の日付');
          let c;
          const k = get(r, '区分');
          if (k === '飛ばす') c = { originalDate: orig, date: null, amount: null, skipped: true };
          else if (k === 'この回だけ') {
            const a = long(line, r, '金額', false);
            if (a != null && a <= 0) throw new Bad(line, '「金額」は1円以上にしてください');
            c = { originalDate: orig, date: date(line, r, '日付', false), amount: a, skipped: false };
          } else throw new Bad(line, '「変更」の「区分」は「この回だけ」か「飛ばす」にしてください');
          if (!changesByIdx.has(idx)) changesByIdx.set(idx, []);
          changesByIdx.get(idx).push(c);
        }
        const entries = entryRows.map(([, e], i) => ({ ...e, changes: (changesByIdx.get(i) || []).sort((a, b) => K.cmpStr(a.originalDate, b.originalDate)) }));

        const bills = of('請求').map(([line, r]) => {
          const n = text_(line, r, '名前');
          if (!cardByName.has(n)) throw new Bad(line, `カード「${n}」がCSVの中にありません`);
          const cardId = cardByName.get(n);
          const amount = long(line, r, '金額');
          if (amount < 0) throw new Bad(line, '「金額」は0円以上にしてください');
          const pay = date(line, r, '日付');
          const acc = get(r, '口座') ? accRef(line, r) : cards.find(([, c]) => c.id === cardId)[1].accountId;
          return [line, { id: newId(), cardId, paymentDate: pay, amount, inputDate: date(line, r, '時点', false) || pay, accountId: acc }];
        });
        const seenBill = new Set();
        for (const [line, b] of bills) {
          const k = b.cardId + '|' + b.paymentDate;
          if (seenBill.has(k)) throw new Bad(line, '同じカード・同じ支払日の請求が2つあります');
          seenBill.add(k);
        }
        const accs = accounts.map(([, a]) => a);
        return { error: false, data: { ...emptyData(), accounts: accs, entries, cards: cards.map(([, c]) => c), bills: bills.map(([, b]) => b),
          snapshots: accs.map((a) => ({ accountId: a.id, date: a.asOf, amount: a.balance })) } };
      } catch (e) {
        if (e instanceof Bad) return { error: true, line: e.line, message: e.message };
        throw e;
      }
    },
  };

  Object.assign(K, { newId, now, emptyData, BudgetStore, BudgetRepository, CsvFormat });
})(window.K = window.K || {});
