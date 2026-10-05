import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Store,
  ClipboardList,
  Hammer,
  Boxes,
  Wrench,
  Wallet,
  Truck,
  Plus,
  X,
  ChevronLeft,
  ChevronRight,
  Check,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  Search,
  Pencil,
  RotateCcw,
  Settings,
  PackagePlus,
  Banknote,
  Smartphone,
  Landmark,
  Phone,
  User,
  CalendarDays,
  Package,
  TrendingDown,
  Footprints,
  Users,
  ArrowRight,
  Factory,
  Scale,
  Warehouse,
  ListPlus,
  StickyNote,
} from 'lucide-react';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  where,
  limit,
  serverTimestamp,
  writeBatch,
  increment,
  arrayUnion,
  runTransaction,
  updateDoc,
} from 'firebase/firestore';
import { db } from '../Libs/firebase_config.mjs';

/* ======================================================================
   OPERATIONS — v2

   One workspace for the whole production-to-sale chain. Every store is
   given a ROLE in the setup screen (gear icon):

     Factory    → Materials · Suppliers · Make shoes · Orders · Machines · Pay
                  (numbered in the order you should set things up)
     Warehouse  → Stock · Orders
     Retail     → Stock · Orders

   Rules that run through every screen:
     1. Type once, pick forever — every free-text field (materials,
        suppliers, products, clients, steps, loss reasons, machine roles,
        attribute names/values, production-cost names) offers what was
        typed before as tap-to-fill chips.
     2. Every area works the same way: a list, one obvious button on
        top, tap a row to open a sheet with its actions.
     3. Every action ends with a success check and a plain next-step
        question.

   What's new in v2
     - Place roles (opsSettings.roles = { [storeId]: 'factory' | 'warehouse' | 'retail' }).
     - Stock view for warehouse / retail places. Reads the shared
       items / storeItems / stock collections that finished production
       runs already write to. Free-text attributes (colour…), a low-stock
       alert level, move-to-another-place, and stock counts.
     - Orders can take pairs from stock (deducted in a transaction when
       the order is saved) or send them to production. One order can mix
       both. "Cancel order" puts stock back.
     - Production costs are free-text "name + amount" rows, remembered in
       opsLists.costDefaults so next time it is one tap.
     - Suppliers can be added directly, before any restock.

   Data (all scoped by storeId, admin-only — see firestore.rules):
     opsMaterials / opsMovements / opsRestocks / opsSuppliers /
     opsSupplierPayments / opsPayroll / opsMaintenance / opsMachines /
     opsProducts / opsRuns / opsOrders / opsLists / opsSettings / counters
   Shared with the stock side: items, storeItems, stock, transfers,
   activityLog.

   No composite indexes are needed: every query is equality-only and
   sorted in the browser.
   ====================================================================== */

/* ------------------------------------------------------------------ */
/*  Tokens & helpers                                                   */
/* ------------------------------------------------------------------ */

const INK = '#0F2242';
const CANVAS = '#F5F8FD';
const GREEN = '#1FA97A';

const DEFAULT_STEPS = ['Cutting', 'Stitching', 'Lasting', 'Finishing', 'Packing'];
const DEFAULT_COSTS = ['Wages', 'Power', 'Transport'];
const UNIT_QUICK = ['pcs', 'm', 'kg', 'litres', 'pairs', 'sheets'];
const PAY_METHODS = [
  { id: 'cash', label: 'Cash', icon: Banknote },
  { id: 'mpesa', label: 'M-Pesa', icon: Smartphone },
  { id: 'bank', label: 'Bank', icon: Landmark },
];
const ROLES = [
  { id: 'factory', label: 'Factory', icon: Factory },
  { id: 'warehouse', label: 'Warehouse', icon: Warehouse },
  { id: 'retail', label: 'Retail', icon: Store },
];
const ROLE_LABEL = Object.fromEntries(ROLES.map((r) => [r.id, r.label]));

const num = (v) => Number(v) || 0;
const money = (n) => `KSh ${Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
const qtyFmt = (n) => Number(Number(n || 0).toFixed(3)).toString();
const todayStr = () => new Date().toISOString().slice(0, 10);
const slugify = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'x';
const keyOf = (storeId, name) => `${storeId}__${slugify(name)}`;
const stockKey = (storeId, itemId, variant) => `${storeId}__${itemId}__${slugify(variant)}`;
const storeItemKey = (storeId, itemId) => `${storeId}__${itemId}`;
const lower = (s) => String(s || '').trim().toLowerCase();

const formatDate = (value) => {
  if (!value) return '—';
  const d = typeof value === 'string' ? new Date(value) : value?.toDate?.() || value;
  if (!(d instanceof Date) || isNaN(d)) return '—';
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
};

const blendAvg = (oldQty, oldAvg, addQty, addCost) => {
  const total = num(oldQty) + num(addQty);
  if (total <= 0) return 0;
  return (num(oldQty) * num(oldAvg) + num(addQty) * num(addCost)) / total;
};
const reverseBlend = (curQty, curAvg, removeQty, removeCost) => {
  const remaining = num(curQty) - num(removeQty);
  if (remaining <= 0) return 0;
  return Math.max(0, (num(curQty) * num(curAvg) - num(removeQty) * num(removeCost)) / remaining);
};

const dedupeSorted = (list) => {
  const seen = new Map();
  (list || []).forEach((raw) => {
    const v = String(raw || '').trim();
    if (v && !seen.has(v.toLowerCase())) seen.set(v.toLowerCase(), v);
  });
  return Array.from(seen.values()).sort((a, b) => a.localeCompare(b));
};
const dedupeKeepOrder = (list) => {
  const seen = new Set();
  const out = [];
  (list || []).forEach((raw) => {
    const v = String(raw || '').trim();
    if (v && !seen.has(v.toLowerCase())) {
      seen.add(v.toLowerCase());
      out.push(v);
    }
  });
  return out;
};

const sizeList = (from, to) => {
  const a = parseInt(from, 10);
  const b = parseInt(to, 10);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a || b - a > 40) return [];
  return Array.from({ length: b - a + 1 }, (_, i) => String(a + i));
};
const sizeSort = (a, b) => {
  const x = parseFloat(a);
  const y = parseFloat(b);
  if (Number.isFinite(x) && Number.isFinite(y)) return x - y;
  return String(a).localeCompare(String(b));
};

const tms = (d) => (d?.createdAt?.toMillis ? d.createdAt.toMillis() : Number.MAX_SAFE_INTEGER);
const byNewest = (a, b) => tms(b) - tms(a);

const fetchWhere = async (coll, ...conds) => (await getDocs(query(collection(db, coll), ...conds))).docs.map((d) => ({ id: d.id, ...d.data() }));

const nextNumber = async (counterId, prefix) => {
  const ref = doc(db, 'counters', counterId);
  const n = await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    const next = (snap.exists() ? Number(snap.data().lastNumber) || 0 : 0) + 1;
    tx.set(ref, { lastNumber: next, prefix, updatedAt: serverTimestamp() }, { merge: true });
    return next;
  });
  return `${prefix}${String(n).padStart(4, '0')}`;
};

// Finds the shared catalog item for a product name (null if none yet).
const findItemByName = async (name) => {
  const snap = await getDocs(query(collection(db, 'items'), where('name', '==', name), limit(5)));
  const m = snap.docs.find((d) => d.data().status !== 'archived');
  return m ? { id: m.id, ...m.data() } : null;
};

// Builds the opsLists patch that remembers attribute names and values.
const attrPatch = (attrs) => {
  const clean = (attrs || []).filter((a) => a.key?.trim() && a.value?.trim());
  if (!clean.length) return {};
  const byKey = {};
  clean.forEach((a) => {
    const k = slugify(a.key);
    byKey[k] = byKey[k] || [];
    byKey[k].push(a.value.trim());
  });
  return {
    attrKeys: arrayUnion(...dedupeKeepOrder(clean.map((a) => a.key.trim()))),
    attrValues: Object.fromEntries(Object.entries(byKey).map(([k, vs]) => [k, arrayUnion(...dedupeKeepOrder(vs))])),
  };
};

const payStatus = (paid, total) => (total > 0 && paid >= total ? 'paid' : paid > 0 ? 'part' : 'unpaid');
const MONEY_BADGE = { paid: ['green', 'Paid'], part: ['amber', 'Part-paid'], unpaid: ['red', 'Unpaid'] };
const WORK_BADGE = {
  waiting: ['gray', 'Waiting'],
  making: ['blue', 'Being made'],
  ready: ['green', 'Ready'],
  delivered: ['gray', 'Delivered'],
  cancelled: ['red', 'Cancelled'],
};
const WORK_FLOW = ['waiting', 'making', 'ready', 'delivered'];
const lineNeedsMaking = (l) => l.source !== 'stock' && !l.made;

const ACTIVITY_TITLES = {
  created: 'Added',
  restocked: 'Stock added',
  transferred_in: 'Received from another place',
  transferred_out: 'Sent to another place',
  edited: 'Details edited',
  counted: 'Stock count',
  sold: 'Taken for an order',
  returned: 'Put back (order cancelled)',
};

/* ------------------------------------------------------------------ */
/*  Live data hooks                                                    */
/* ------------------------------------------------------------------ */

const useStoreDocs = (name, storeId, extra) => {
  const [state, setState] = useState({ rows: [], loading: true });
  useEffect(() => {
    if (!storeId) {
      setState({ rows: [], loading: false });
      return undefined;
    }
    setState((s) => ({ ...s, loading: true }));
    const q = extra ? query(collection(db, name), extra(storeId)) : query(collection(db, name), where('storeId', '==', storeId));
    const unsub = onSnapshot(
      q,
      (snap) => setState({ rows: snap.docs.map((d) => ({ id: d.id, ...d.data() })), loading: false }),
      (err) => {
        console.error(`${name} listener error:`, err);
        setState({ rows: [], loading: false });
      }
    );
    return unsub;
  }, [name, storeId]); // eslint-disable-line react-hooks/exhaustive-deps
  return state;
};

// Orders from every place — the factory needs to see them all.
const useAllDocs = (name) => {
  const [state, setState] = useState({ rows: [], loading: true });
  useEffect(
    () =>
      onSnapshot(
        collection(db, name),
        (snap) => setState({ rows: snap.docs.map((d) => ({ id: d.id, ...d.data() })), loading: false }),
        (err) => {
          console.error(`${name} listener error:`, err);
          setState({ rows: [], loading: false });
        }
      ),
    [name]
  );
  return state;
};

// Live stock for ONE place (warehouse / retail): storeItems + stock are
// scoped listeners; the shared `items` catalog is fetched when something
// new shows up that isn't in the local copy yet.
const usePlaceStock = (storeId, enabled) => {
  const [storeItems, setStoreItems] = useState([]);
  const [stock, setStock] = useState([]);
  const [items, setItems] = useState({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!storeId || !enabled) {
      setStoreItems([]);
      setStock([]);
      setLoading(false);
      return undefined;
    }
    setLoading(true);
    const u1 = onSnapshot(
      query(collection(db, 'storeItems'), where('storeId', '==', storeId)),
      (s) => {
        setStoreItems(s.docs.map((d) => ({ id: d.id, ...d.data() })));
        setLoading(false);
      },
      (err) => {
        console.error('storeItems listener error:', err);
        setStoreItems([]);
        setLoading(false);
      }
    );
    const u2 = onSnapshot(
      query(collection(db, 'stock'), where('storeId', '==', storeId)),
      (s) => setStock(s.docs.map((d) => ({ id: d.id, ...d.data() }))),
      (err) => {
        console.error('stock listener error:', err);
        setStock([]);
      }
    );
    return () => {
      u1();
      u2();
    };
  }, [storeId, enabled]);

  const missing = storeItems.some((si) => !items[si.itemId]);
  useEffect(() => {
    if (!missing) return undefined;
    let cancelled = false;
    getDocs(collection(db, 'items'))
      .then((s) => !cancelled && setItems(Object.fromEntries(s.docs.map((d) => [d.id, { id: d.id, ...d.data() }]))))
      .catch((err) => console.error('items fetch error:', err));
    return () => {
      cancelled = true;
    };
  }, [missing, storeItems.length]);

  const patchItem = useCallback((id, patch) => setItems((m) => ({ ...m, [id]: { ...m[id], ...patch } })), []);

  const list = useMemo(
    () =>
      storeItems
        .filter((si) => si.status !== 'removed' && items[si.itemId])
        .map((si) => ({
          item: items[si.itemId],
          storeItem: si,
          stockRows: stock.filter((s) => s.itemId === si.itemId).sort((a, b) => sizeSort(a.variant, b.variant)),
        }))
        .sort((a, b) => a.item.name.localeCompare(b.item.name)),
    [storeItems, stock, items]
  );

  return { list, loading, patchItem };
};

const totalOf = (rows) => rows.reduce((s, r) => s + num(r.quantity), 0);
const stockState = (row) => {
  const qty = totalOf(row.stockRows);
  const threshold = num(row.storeItem.lowStockThreshold);
  const out = qty <= 0;
  return { qty, out, low: !out && threshold > 0 && qty <= threshold, threshold };
};

/* ------------------------------------------------------------------ */
/*  Atoms                                                              */
/* ------------------------------------------------------------------ */

const TONES = {
  blue: 'bg-[#EAF2FE] text-[#2B6CDA]',
  green: 'bg-[#E3F6EE] text-[#168A63]',
  amber: 'bg-[#FBF0DA] text-[#B9812E]',
  red: 'bg-[#FBEAE8] text-[#C0433A]',
  gray: 'bg-[#EEF2F7] text-[#64748B]',
};
const Badge = ({ tone = 'gray', children }) => (
  <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${TONES[tone]}`}>{children}</span>
);

const SIZE_CLASS = { md: 'sm:max-w-md', wide: 'sm:max-w-2xl' };

const ModalShell = ({ onClose, children, size = 'md' }) => (
  <motion.div
    initial={{ opacity: 0 }}
    animate={{ opacity: 1 }}
    exit={{ opacity: 0 }}
    transition={{ duration: 0.2 }}
    className="fixed inset-0 z-50 flex items-end justify-center bg-[#0F2242]/45 backdrop-blur-sm sm:items-center sm:p-4"
    onClick={onClose}
  >
    <motion.div
      onClick={(e) => e.stopPropagation()}
      initial={{ opacity: 0, y: 60 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 40 }}
      transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
      className={`relative max-h-[92dvh] w-full overflow-y-auto rounded-t-[28px] bg-white shadow-2xl shadow-black/20 sm:max-h-[90dvh] sm:rounded-[28px] ${SIZE_CLASS[size]}`}
    >
      <div className="mx-auto mt-3 h-1.5 w-12 shrink-0 rounded-full bg-[#E1E8F4] sm:hidden" />
      <div className="p-5 sm:p-7" style={{ paddingBottom: 'calc(1.25rem + env(safe-area-inset-bottom))' }}>
        {children}
      </div>
    </motion.div>
  </motion.div>
);

const ModalHeader = ({ icon: Icon, title, subtitle, onClose }) => (
  <div className="mb-5 flex items-start justify-between gap-3">
    <div className="flex min-w-0 items-center gap-3">
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[#EAF2FE] text-[#2B6CDA]">
        <Icon size={19} strokeWidth={1.8} />
      </span>
      <div className="min-w-0">
        <h2 className="truncate text-lg font-semibold leading-tight" style={{ color: INK }}>
          {title}
        </h2>
        {subtitle && <p className="truncate text-sm text-[#8CA0BC]">{subtitle}</p>}
      </div>
    </div>
    <button type="button" onClick={onClose} className="shrink-0 rounded-full p-2 text-[#8CA0BC] transition-colors hover:bg-[#EAF2FE] hover:text-[#2B6CDA]" aria-label="Close">
      <X size={16} />
    </button>
  </div>
);

const Field = ({ id, label, icon: Icon, value, onChange, type = 'text', placeholder, required, suffix, min, step, inputMode, disabled, compact }) => (
  <div>
    {label && (
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-[#4C5E7A]">
        {label}
      </label>
    )}
    <div
      className={`flex items-center gap-2.5 rounded-2xl border-2 transition-colors ${compact ? 'px-3 py-2' : 'px-4 py-2.5'} ${
        disabled ? 'border-[#EAF0F9] bg-[#F7FAFD]' : 'border-[#E1E8F4] bg-white focus-within:border-[#2B6CDA] focus-within:shadow-[0_0_0_4px_rgba(43,108,218,0.10)]'
      }`}
    >
      {Icon && <Icon size={15} className="shrink-0 text-[#8CA0BC]" />}
      <input
        id={id}
        type={type}
        min={min}
        step={step}
        inputMode={inputMode}
        value={value}
        onChange={onChange}
        required={required}
        placeholder={placeholder}
        disabled={disabled}
        className="w-full min-w-0 bg-transparent text-[15px] outline-none placeholder:text-[#B3C1D6] disabled:text-[#8CA0BC]"
        style={{ color: INK }}
      />
      {suffix && <span className="shrink-0 text-xs font-semibold text-[#8CA0BC]">{suffix}</span>}
    </div>
  </div>
);

// Type once, pick forever: a text input with tap-to-fill chips built from
// whatever was typed before.
const SuggestInput = ({ id, label, icon, value, onChange, options, placeholder, compact }) => {
  const q = lower(value);
  const matches = useMemo(
    () => dedupeSorted(options).filter((o) => (!q || lower(o).includes(q)) && lower(o) !== q).slice(0, 6),
    [options, q]
  );
  return (
    <div>
      <Field id={id} label={label} icon={icon} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} compact={compact} />
      {matches.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {matches.map((o) => (
            <button
              key={o}
              type="button"
              onClick={() => onChange(o)}
              className="rounded-full border border-[#E1E8F4] px-2.5 py-1 text-xs font-medium text-[#5C7196] transition-colors hover:border-[#2B6CDA] hover:text-[#2B6CDA]"
            >
              {o}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

const ChoiceRow = ({ options, value, onChange, cols = 'grid-cols-3' }) => (
  <div className={`grid gap-2 ${cols}`}>
    {options.map((o) => {
      const active = value === o.id;
      return (
        <button
          key={o.id}
          type="button"
          onClick={() => onChange(o.id)}
          className={`flex flex-col items-center justify-center gap-1 rounded-2xl border-2 px-2 py-3 text-center text-sm font-semibold leading-tight transition-colors ${
            active ? 'border-[#2B6CDA] bg-[#EAF2FE] text-[#2B6CDA]' : 'border-[#E1E8F4] bg-white text-[#64748B]'
          }`}
        >
          {o.icon && <o.icon size={18} />}
          {o.label}
        </button>
      );
    })}
  </div>
);

const Chip = ({ active, onClick, children, icon: Icon }) => (
  <button
    type="button"
    onClick={onClick}
    className={`flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors ${
      active ? 'border-[#2B6CDA] bg-[#EAF2FE] text-[#2B6CDA]' : 'border-[#E1E8F4] bg-white text-[#8CA0BC]'
    }`}
  >
    {Icon && <Icon size={13} />}
    {children}
  </button>
);

const SectionLabel = ({ children, hint }) => (
  <div className="mb-2 flex items-baseline justify-between gap-2">
    <p className="text-sm font-semibold" style={{ color: INK }}>
      {children}
    </p>
    {hint && <p className="text-right text-xs text-[#8CA0BC]">{hint}</p>}
  </div>
);

const SubmitButton = ({ saving, children, disabled, onClick, type = 'submit', tone = 'blue' }) => (
  <motion.button
    type={type}
    onClick={onClick}
    disabled={saving || disabled}
    whileTap={{ scale: 0.98 }}
    className={`flex w-full items-center justify-center gap-2 rounded-full py-3.5 text-[15px] font-semibold text-white shadow-lg transition-opacity disabled:opacity-40 ${
      tone === 'danger' ? 'bg-[#C0433A] shadow-[#C0433A]/25' : 'bg-[#2B6CDA] shadow-[#2B6CDA]/25'
    }`}
  >
    {saving && (
      <motion.span animate={{ rotate: 360 }} transition={{ duration: 0.7, repeat: Infinity, ease: 'linear' }}>
        <Loader2 size={16} />
      </motion.span>
    )}
    {children}
  </motion.button>
);

const SoftButton = ({ icon: Icon, children, onClick, disabled, tone = 'blue' }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    className={`flex flex-1 items-center justify-center gap-1.5 rounded-2xl border-2 px-3 py-3 text-sm font-semibold transition-colors disabled:opacity-40 ${
      tone === 'danger' ? 'border-[#F5D3CE] bg-white text-[#C0433A] hover:bg-[#FBEAE8]' : 'border-[#E1E8F4] bg-white text-[#2B6CDA] hover:bg-[#EAF2FE]'
    }`}
  >
    {Icon && <Icon size={16} strokeWidth={1.8} />}
    {children}
  </button>
);

const StatBox = ({ label, value, tone }) => (
  <div className="rounded-2xl border border-[#EAF0F9] bg-[#F7FAFD] p-3 text-center">
    <p className="text-[11px] font-medium text-[#8CA0BC]">{label}</p>
    <p className="mt-0.5 truncate text-base font-semibold" style={{ color: tone === 'red' ? '#C0433A' : tone === 'amber' ? '#B9812E' : tone === 'green' ? '#168A63' : INK }}>
      {value}
    </p>
  </div>
);

const Spinner = () => (
  <div className="flex justify-center py-12 text-[#8CA0BC]">
    <Loader2 className="animate-spin" size={20} />
  </div>
);

const EmptyState = ({ icon: Icon, title, body, actionLabel, onAction }) => (
  <div className="mt-5 rounded-[24px] border border-dashed border-[#CBDBF3] bg-[#F7FAFD] p-7 sm:p-9">
    <div className="flex flex-col items-start gap-3">
      <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white text-[#2B6CDA] ring-1 ring-inset ring-[#E1E8F4]">
        <Icon size={19} strokeWidth={1.8} />
      </span>
      <div>
        <h3 className="text-base font-semibold" style={{ color: INK }}>
          {title}
        </h3>
        <p className="mt-1 max-w-sm text-sm leading-relaxed text-[#5C7196]">{body}</p>
      </div>
      {actionLabel && (
        <button type="button" onClick={onAction} className="mt-1 rounded-full bg-[#2B6CDA] px-4 py-2 text-sm font-semibold text-white shadow-md shadow-[#2B6CDA]/25">
          {actionLabel}
        </button>
      )}
    </div>
  </div>
);

const RowCard = ({ icon: Icon, title, subtitle, right, onClick, tone }) => (
  <motion.button
    type="button"
    layout
    initial={{ opacity: 0, y: 8 }}
    animate={{ opacity: 1, y: 0 }}
    onClick={onClick}
    className={`flex w-full items-center gap-3 rounded-[20px] border-2 bg-white p-4 text-left shadow-sm shadow-[#0F2242]/[0.03] transition-shadow hover:shadow-lg hover:shadow-[#2B6CDA]/[0.10] ${
      tone === 'red' ? 'border-[#F5D3CE]' : tone === 'amber' ? 'border-[#F0DCAF]' : 'border-[#EAF0F9]'
    }`}
  >
    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[#EAF2FE] text-[#2B6CDA]">
      <Icon size={19} strokeWidth={1.8} />
    </span>
    <div className="min-w-0 flex-1">
      <p className="truncate text-[15px] font-semibold" style={{ color: INK }}>
        {title}
      </p>
      {subtitle && <p className="truncate text-xs text-[#8CA0BC]">{subtitle}</p>}
    </div>
    {right && <div className="shrink-0 text-right">{right}</div>}
    <ChevronRight size={16} className="shrink-0 text-[#B3C1D6]" />
  </motion.button>
);

const PageTop = ({ title, subtitle, onAdd, addLabel, extra }) => (
  <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
    <div className="min-w-0">
      <h3 className="text-lg font-semibold" style={{ color: INK }}>
        {title}
      </h3>
      {subtitle && <p className="text-sm text-[#8CA0BC]">{subtitle}</p>}
    </div>
    <div className="flex items-center gap-2">
      {extra}
      {onAdd && (
        <motion.button
          type="button"
          whileTap={{ scale: 0.96 }}
          onClick={onAdd}
          className="flex items-center gap-1.5 rounded-full bg-[#2B6CDA] px-4 py-2.5 text-sm font-semibold text-white shadow-md shadow-[#2B6CDA]/25"
        >
          <Plus size={15} /> {addLabel}
        </motion.button>
      )}
    </div>
  </div>
);

const SearchBar = ({ value, onChange, placeholder }) => (
  <div className="flex min-w-[160px] flex-1 items-center gap-2.5 rounded-full border border-[#E1E8F4] bg-white px-4 py-2.5 shadow-sm shadow-[#0F2242]/[0.02] focus-within:border-[#2B6CDA]">
    <Search size={15} className="text-[#8CA0BC]" />
    <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="w-full bg-transparent text-[15px] outline-none placeholder:text-[#B3C1D6]" style={{ color: INK }} />
  </div>
);

const TabBar = ({ tabs, value, onChange }) => (
  <div className="mt-4 flex gap-1.5 rounded-full border border-[#E1E8F4] bg-white p-1.5">
    {tabs.map((t) => (
      <button key={t.id} type="button" onClick={() => onChange(t.id)} className={`flex-1 rounded-full px-4 py-2 text-sm font-semibold transition-colors ${value === t.id ? 'bg-[#2B6CDA] text-white shadow-sm' : 'text-[#8CA0BC]'}`}>
        {t.label}
      </button>
    ))}
  </div>
);

const ConfirmDialog = ({ icon: Icon = AlertTriangle, tone = 'danger', title, body, confirmLabel = 'Confirm', saving, onCancel, onConfirm, children }) => (
  <ModalShell onClose={onCancel}>
    <div className="text-center">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl" style={{ background: tone === 'danger' ? '#FBEAE8' : '#EAF2FE', color: tone === 'danger' ? '#C0433A' : '#2B6CDA' }}>
        <Icon size={19} />
      </div>
      <h3 className="mt-3.5 text-base font-semibold" style={{ color: INK }}>
        {title}
      </h3>
      <p className="mt-1.5 text-sm leading-relaxed text-[#5C7196]">{body}</p>
    </div>
    {children && <div className="mt-4">{children}</div>}
    <div className="mt-6 flex gap-2.5">
      <button type="button" onClick={onCancel} className="flex-1 rounded-full border border-[#E1E8F4] py-2.5 text-[15px] font-medium text-[#4C5E7A]">
        Cancel
      </button>
      <button type="button" onClick={onConfirm} disabled={saving} className="flex-1 rounded-full py-2.5 text-[15px] font-semibold text-white disabled:opacity-60" style={{ background: tone === 'danger' ? '#C0433A' : '#2B6CDA' }}>
        {saving ? 'Working…' : confirmLabel}
      </button>
    </div>
  </ModalShell>
);

// Free-text key/value attributes (Color, Material…) with tap-to-fill
// suggestions from everything typed before (opsLists.attrKeys / attrValues).
const AttributeEditor = ({ attributes, onChange, lists }) => {
  const [key, setKey] = useState('');
  const [value, setValue] = useState('');
  const knownKeys = dedupeSorted(lists.attrKeys || []);
  const knownValues = (lists.attrValues || {})[slugify(key)] || [];
  const valueChips = dedupeSorted(knownValues).filter((v) => lower(v) !== lower(value)).slice(0, 8);

  const add = () => {
    if (!key.trim() || !value.trim()) return;
    const k = key.trim();
    onChange([...attributes.filter((a) => lower(a.key) !== lower(k)), { key: k, value: value.trim() }]);
    setKey('');
    setValue('');
  };

  return (
    <div>
      <SectionLabel hint="Optional — colour, material, anything">Attributes</SectionLabel>
      {attributes.length > 0 && (
        <div className="mb-2.5 flex flex-wrap gap-1.5">
          {attributes.map((a, i) => (
            <span key={`${a.key}-${i}`} className="flex items-center gap-1.5 rounded-full bg-[#EAF2FE] px-3 py-1.5 text-sm font-medium text-[#2B6CDA]">
              <span className="text-[#5C87C7]">{a.key}:</span> {a.value}
              <button type="button" onClick={() => onChange(attributes.filter((_, idx) => idx !== i))} className="text-[#2B6CDA]/60 hover:text-[#2B6CDA]" aria-label={`Remove ${a.key}`}>
                <X size={11} />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-start gap-2">
        <div className="min-w-[110px] flex-1">
          <SuggestInput id="attr-key" value={key} onChange={setKey} options={knownKeys} placeholder="e.g. Colour" compact />
        </div>
        <div className="min-w-[110px] flex-1">
          <SuggestInput id="attr-value" value={value} onChange={setValue} options={valueChips} placeholder="e.g. Black" compact />
        </div>
        <button type="button" onClick={add} disabled={!key.trim() || !value.trim()} className="flex h-[42px] shrink-0 items-center gap-1 rounded-full bg-[#2B6CDA] px-4 text-sm font-semibold text-white disabled:opacity-40">
          <ListPlus size={14} /> Add
        </button>
      </div>
    </div>
  );
};

/* ------------------------------------------------------------------ */
/*  Feedback loop — animated check + one plain next-step question       */
/* ------------------------------------------------------------------ */

const FollowUpDialog = ({ data, onClose }) => (
  <ModalShell onClose={onClose}>
    <div className="flex flex-col items-center text-center">
      <svg width="84" height="84" viewBox="0 0 120 120" fill="none">
        <motion.circle cx="60" cy="60" r="52" stroke="#DDF3E7" strokeWidth="7" initial={{ opacity: 0 }} animate={{ opacity: 1 }} />
        <motion.circle cx="60" cy="60" r="52" stroke={GREEN} strokeWidth="7" strokeLinecap="round" transform="rotate(-90 60 60)" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.5, ease: 'easeInOut' }} />
        <motion.path d="M36 62 L52 78 L86 42" stroke={GREEN} strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" initial={{ pathLength: 0, opacity: 0 }} animate={{ pathLength: 1, opacity: 1 }} transition={{ duration: 0.35, delay: 0.45 }} />
      </svg>
      <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.6 }}>
        <h3 className="mt-3 text-lg font-semibold" style={{ color: INK }}>
          {data.title}
        </h3>
        {data.message && <p className="mt-1 text-sm leading-relaxed text-[#5C7196]">{data.message}</p>}
        {data.question && (
          <p className="mt-4 text-[15px] font-semibold" style={{ color: INK }}>
            {data.question}
          </p>
        )}
      </motion.div>
    </div>
    <div className="mt-5 space-y-2">
      {(data.actions || []).map((a) => (
        <button
          key={a.label}
          type="button"
          onClick={() => {
            onClose();
            a.onClick?.();
          }}
          className={`w-full rounded-full py-3 text-[15px] font-semibold transition-colors ${a.primary ? 'bg-[#2B6CDA] text-white shadow-md shadow-[#2B6CDA]/25' : 'border-2 border-[#E1E8F4] bg-white text-[#2B6CDA]'}`}
        >
          {a.label}
        </button>
      ))}
      <button type="button" onClick={onClose} className="w-full py-2 text-sm font-semibold text-[#8CA0BC]">
        {data.actions?.length ? 'Not now' : 'Done'}
      </button>
    </div>
  </ModalShell>
);

/* ==================================================================== */
/*  MATERIALS                                                            */
/* ==================================================================== */

const MOVE_TITLES = { restock: 'Restocked', production_use: 'Used in production', count: 'Stock count', machine_use: 'Used on a machine', rolled_back: 'Rolled back' };

const AddMaterialModal = ({ ctx, defaultName = '', onClose, onAdded }) => {
  const { storeId, materials, notify } = ctx;
  const [name, setName] = useState(defaultName);
  const [unit, setUnit] = useState('pcs');
  const [category, setCategory] = useState('Material');
  const [threshold, setThreshold] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    const clean = name.trim();
    if (!clean || !unit.trim()) return;
    const id = keyOf(storeId, clean);
    if (materials.some((m) => m.id === id)) {
      notify({ type: 'error', message: `"${clean}" already exists — find it in the list.` });
      return;
    }
    setSaving(true);
    try {
      const b = writeBatch(db);
      b.set(doc(db, 'opsMaterials', id), {
        storeId,
        name: clean,
        unit: unit.trim(),
        category,
        quantity: 0,
        avgCost: 0,
        supplier: '',
        lowStockThreshold: num(threshold),
        status: 'active',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      await b.commit();
      onClose();
      onAdded(id, clean);
    } catch (err) {
      notify({ type: 'error', message: err?.message || 'Could not add material.' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell onClose={onClose}>
      <ModalHeader icon={Boxes} title="Add a material" subtitle="Glue, leather, soles, needles — anything you buy" onClose={onClose} />
      <form onSubmit={submit} className="space-y-4">
        <Field id="mat-name" label="Name" icon={Package} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Rubber sole" required />
        <div>
          <Field id="mat-unit" label="Counted in" value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="pcs, m, kg…" required />
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {UNIT_QUICK.map((u) => (
              <Chip key={u} active={unit === u} onClick={() => setUnit(u)}>
                {u}
              </Chip>
            ))}
          </div>
        </div>
        <div>
          <SectionLabel>What is it?</SectionLabel>
          <ChoiceRow cols="grid-cols-2" value={category} onChange={setCategory} options={[{ id: 'Material', label: 'Production material' }, { id: 'Machine spare', label: 'Machine spare (needles…)' }]} />
        </div>
        <Field id="mat-low" label="Warn me when stock drops to (optional)" type="number" min="0" inputMode="decimal" value={threshold} onChange={(e) => setThreshold(e.target.value)} placeholder="0 = only when finished" />
        <SubmitButton saving={saving} disabled={!name.trim() || !unit.trim()}>
          <Plus size={15} /> Add material
        </SubmitButton>
      </form>
    </ModalShell>
  );
};

const EditMaterialModal = ({ material, ctx, onClose }) => {
  const { notify, suppliers } = ctx;
  const [unit, setUnit] = useState(material.unit);
  const [category, setCategory] = useState(material.category || 'Material');
  const [threshold, setThreshold] = useState(material.lowStockThreshold || '');
  const [supplier, setSupplier] = useState(material.supplier || '');
  const [saving, setSaving] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await updateDoc(doc(db, 'opsMaterials', material.id), { unit: unit.trim() || material.unit, category, lowStockThreshold: num(threshold), supplier: supplier.trim(), updatedAt: serverTimestamp() });
      notify({ type: 'success', message: `${material.name} updated.` });
      onClose();
    } catch (err) {
      notify({ type: 'error', message: err?.message || 'Could not save.' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell onClose={onClose}>
      <ModalHeader icon={Pencil} title={`Edit ${material.name}`} onClose={onClose} />
      <form onSubmit={submit} className="space-y-4">
        <Field id="em-unit" label="Counted in" value={unit} onChange={(e) => setUnit(e.target.value)} />
        <ChoiceRow cols="grid-cols-2" value={category} onChange={setCategory} options={[{ id: 'Material', label: 'Production material' }, { id: 'Machine spare', label: 'Machine spare' }]} />
        <Field id="em-low" label="Warn me when stock drops to" type="number" min="0" inputMode="decimal" value={threshold} onChange={(e) => setThreshold(e.target.value)} placeholder="0 = only when finished" />
        <SuggestInput id="em-sup" label="Usual supplier" icon={Truck} value={supplier} onChange={setSupplier} options={suppliers.map((s) => s.name)} placeholder="Type or pick" />
        <SubmitButton saving={saving}>
          <CheckCircle2 size={15} /> Save changes
        </SubmitButton>
      </form>
    </ModalShell>
  );
};

const RestockModal = ({ material, ctx, onClose, onAgain }) => {
  const { storeId, suppliers, notify, setFollowUp } = ctx;
  const [qty, setQty] = useState('');
  const [cost, setCost] = useState('');
  const [date, setDate] = useState(todayStr());
  const [supplier, setSupplier] = useState(material.supplier || '');
  const [payMode, setPayMode] = useState('full');
  const [paidAmt, setPaidAmt] = useState('');
  const [delMode, setDelMode] = useState('full');
  const [recvQty, setRecvQty] = useState('');
  const [saving, setSaving] = useState(false);

  const q = num(qty);
  const total = q * num(cost);
  const paid = payMode === 'full' ? total : payMode === 'part' ? Math.min(num(paidAmt), total) : 0;
  const owed = Math.max(0, total - paid);
  const received = delMode === 'full' ? q : Math.min(num(recvQty), q);
  const canSave =
    q > 0 &&
    cost !== '' &&
    supplier.trim() &&
    (payMode !== 'part' || (num(paidAmt) > 0 && num(paidAmt) < total)) &&
    (delMode !== 'part' || (recvQty !== '' && num(recvQty) >= 0 && num(recvQty) < q));

  const submit = async (e) => {
    e.preventDefault();
    if (!canSave) return;
    setSaving(true);
    try {
      const sup = supplier.trim();
      const supId = keyOf(storeId, sup);
      const known = suppliers.some((s) => s.id === supId);
      const unitCost = num(cost);
      const b = writeBatch(db);
      const rRef = doc(collection(db, 'opsRestocks'));
      b.set(rRef, {
        storeId,
        materialId: material.id,
        materialName: material.name,
        unit: material.unit,
        supplier: sup,
        supplierId: supId,
        date,
        quantity: q,
        received,
        unitCost,
        total,
        paid,
        paymentStatus: owed <= 0 ? 'paid' : paid > 0 ? 'part' : 'credit',
        deliveryStatus: received >= q ? 'full' : 'part',
        status: 'active',
        createdAt: serverTimestamp(),
      });
      b.update(doc(db, 'opsMaterials', material.id), {
        quantity: increment(received),
        avgCost: received > 0 ? blendAvg(material.quantity, material.avgCost, received, unitCost) : num(material.avgCost),
        supplier: sup,
        updatedAt: serverTimestamp(),
      });
      b.set(
        doc(db, 'opsSuppliers', supId),
        { storeId, name: sup, owed: increment(owed), updatedAt: serverTimestamp(), ...(known ? {} : { createdAt: serverTimestamp() }) },
        { merge: true }
      );
      if (received > 0) {
        b.set(doc(collection(db, 'opsMovements')), {
          storeId,
          materialId: material.id,
          materialName: material.name,
          unit: material.unit,
          type: 'restock',
          quantity: received,
          date,
          detail: `${sup} · ${money(unitCost)}/${material.unit}${owed > 0 ? ` · owing ${money(owed)}` : ''}`,
          supplier: sup,
          unitCost,
          restockId: rRef.id,
          original: true,
          createdAt: serverTimestamp(),
        });
      }
      await b.commit();
      onClose();
      const notes = [];
      if (owed > 0) notes.push(`You now owe ${sup} ${money(owed)}.`);
      if (received < q) notes.push(`${qtyFmt(q - received)} ${material.unit} still to arrive — mark it received on the material when it comes.`);
      setFollowUp({
        title: 'Restock recorded',
        message: `${qtyFmt(received)} ${material.unit} of ${material.name} added to stock.${notes.length ? ' ' + notes.join(' ') : ''}`,
        question: 'Anything else to restock?',
        actions: [{ label: 'Restock another material', primary: true, onClick: onAgain }],
      });
    } catch (err) {
      notify({ type: 'error', message: err?.message || 'Could not record restock.' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell onClose={onClose} size="wide">
      <ModalHeader icon={PackagePlus} title={`Restock ${material.name}`} subtitle={`Currently ${qtyFmt(material.quantity)} ${material.unit}`} onClose={onClose} />
      <form onSubmit={submit} className="space-y-5">
        <div className="grid grid-cols-2 gap-3">
          <Field id="rs-q" label={`Quantity bought (${material.unit})`} type="number" min="0" step="any" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} required />
          <Field id="rs-c" label={`Cost per ${material.unit}`} type="number" min="0" step="any" inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} suffix="KSh" required />
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <SuggestInput id="rs-sup" label="Supplier" icon={Truck} value={supplier} onChange={setSupplier} options={suppliers.map((s) => s.name)} placeholder="Type or pick a supplier" />
          <Field id="rs-date" label="Date" type="date" icon={CalendarDays} value={date} onChange={(e) => setDate(e.target.value)} required />
        </div>

        <div>
          <SectionLabel hint={total > 0 ? `Total ${money(total)}` : undefined}>Did you pay?</SectionLabel>
          <ChoiceRow value={payMode} onChange={setPayMode} options={[{ id: 'full', label: 'Paid in full' }, { id: 'part', label: 'Paid part' }, { id: 'credit', label: 'Not paid yet' }]} />
          {payMode === 'part' && (
            <div className="mt-2.5">
              <Field id="rs-paid" label="Amount paid so far" type="number" min="0" step="any" inputMode="decimal" value={paidAmt} onChange={(e) => setPaidAmt(e.target.value)} suffix="KSh" />
            </div>
          )}
          {payMode !== 'full' && total > 0 && <p className="mt-2 text-sm font-medium text-[#B9812E]">You will owe {supplier.trim() || 'the supplier'} {money(owed)}.</p>}
        </div>

        <div>
          <SectionLabel>Did it all arrive?</SectionLabel>
          <ChoiceRow cols="grid-cols-2" value={delMode} onChange={setDelMode} options={[{ id: 'full', label: 'Received everything' }, { id: 'part', label: 'Received part' }]} />
          {delMode === 'part' && (
            <div className="mt-2.5">
              <Field id="rs-recv" label={`Received so far (${material.unit})`} type="number" min="0" step="any" inputMode="decimal" value={recvQty} onChange={(e) => setRecvQty(e.target.value)} />
              <p className="mt-1 text-xs text-[#8CA0BC]">Stock only counts what has actually arrived.</p>
            </div>
          )}
        </div>

        <SubmitButton saving={saving} disabled={!canSave}>
          <PackagePlus size={15} /> Record restock
        </SubmitButton>
      </form>
    </ModalShell>
  );
};

const CountModal = ({ material, ctx, onClose }) => {
  const { storeId, lists, notify, setFollowUp } = ctx;
  const [counted, setCounted] = useState('');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const diff = counted === '' ? 0 : num(counted) - num(material.quantity);
  const canSave = counted !== '' && num(counted) >= 0 && (diff === 0 || reason.trim());

  const submit = async (e) => {
    e.preventDefault();
    if (!canSave) return;
    setSaving(true);
    try {
      const b = writeBatch(db);
      if (diff !== 0) {
        b.update(doc(db, 'opsMaterials', material.id), { quantity: increment(diff), updatedAt: serverTimestamp() });
        b.set(doc(collection(db, 'opsMovements')), {
          storeId,
          materialId: material.id,
          materialName: material.name,
          unit: material.unit,
          type: 'count',
          quantity: diff,
          expected: num(material.quantity),
          counted: num(counted),
          wasteValue: diff < 0 ? Math.abs(diff) * num(material.avgCost) : 0,
          reason: reason.trim(),
          date: todayStr(),
          detail: `Counted ${qtyFmt(counted)}, expected ${qtyFmt(material.quantity)}`,
          createdAt: serverTimestamp(),
        });
        b.set(doc(db, 'opsLists', storeId), { reasons: arrayUnion(reason.trim()), updatedAt: serverTimestamp() }, { merge: true });
      }
      await b.commit();
      onClose();
      setFollowUp({
        title: diff === 0 ? 'Stock matches' : 'Count recorded',
        message:
          diff === 0
            ? `${material.name} is exactly what the system expected.`
            : diff < 0
            ? `${qtyFmt(-diff)} ${material.unit} is missing — recorded as lost (${money(-diff * num(material.avgCost))}). Reason: ${reason.trim()}.`
            : `${qtyFmt(diff)} ${material.unit} more than expected — stock corrected.`,
        actions: [],
      });
    } catch (err) {
      notify({ type: 'error', message: err?.message || 'Could not save the count.' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell onClose={onClose}>
      <ModalHeader icon={Scale} title={`Count ${material.name}`} subtitle="Count what is physically on the shelf" onClose={onClose} />
      <form onSubmit={submit} className="space-y-4">
        <div className="rounded-2xl bg-[#F7FAFD] px-4 py-3 text-sm text-[#5C7196]">
          System expects <span className="font-semibold" style={{ color: INK }}>{qtyFmt(material.quantity)} {material.unit}</span>
        </div>
        <Field id="ct-q" label={`What you counted (${material.unit})`} type="number" min="0" step="any" inputMode="decimal" value={counted} onChange={(e) => setCounted(e.target.value)} />
        {counted !== '' && diff !== 0 && (
          <>
            <p className={`text-sm font-semibold ${diff < 0 ? 'text-[#C0433A]' : 'text-[#168A63]'}`}>
              {diff < 0 ? `${qtyFmt(-diff)} ${material.unit} missing · ${money(-diff * num(material.avgCost))}` : `${qtyFmt(diff)} ${material.unit} extra`}
            </p>
            <SuggestInput id="ct-r" label="Why? (offcuts, damaged, miscounted…)" value={reason} onChange={setReason} options={lists.reasons || []} placeholder="Type or pick a reason" />
          </>
        )}
        <SubmitButton saving={saving} disabled={!canSave}>
          <CheckCircle2 size={15} /> Save count
        </SubmitButton>
      </form>
    </ModalShell>
  );
};

const LossReportModal = ({ ctx, onClose }) => {
  const { storeId, notify } = ctx;
  const [period, setPeriod] = useState('month');
  const [moves, setMoves] = useState(null);

  useEffect(() => {
    let cancelled = false;
    fetchWhere('opsMovements', where('storeId', '==', storeId))
      .then((r) => !cancelled && setMoves(r))
      .catch(() => {
        if (!cancelled) {
          setMoves([]);
          notify({ type: 'error', message: 'Could not load the loss report.' });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [storeId, notify]);

  const rows = useMemo(() => {
    if (!moves) return [];
    const now = new Date();
    const from = period === 'month' ? `${todayStr().slice(0, 7)}-01` : period === '30' ? new Date(now.getTime() - 29 * 864e5).toISOString().slice(0, 10) : '';
    const lost = moves.filter((m) => (m.date || '') >= from && ((m.type === 'production_use' && num(m.waste) > 0) || (m.type === 'count' && num(m.quantity) < 0)));
    const map = {};
    lost.forEach((m) => {
      const qty = m.type === 'count' ? -num(m.quantity) : num(m.waste);
      const g = (map[m.materialId] = map[m.materialId] || { name: m.materialName, unit: m.unit, qty: 0, value: 0, reasons: new Set() });
      g.qty += qty;
      g.value += num(m.wasteValue);
      if (m.reason) g.reasons.add(m.reason);
    });
    return Object.values(map).sort((a, b) => b.value - a.value);
  }, [moves, period]);

  const totalValue = rows.reduce((s, r) => s + r.value, 0);

  return (
    <ModalShell onClose={onClose} size="wide">
      <ModalHeader icon={TrendingDown} title="Lost & wasted material" subtitle="Used more than the recipe, or missing at a count" onClose={onClose} />
      <div className="flex flex-wrap gap-1.5">
        <Chip active={period === 'month'} onClick={() => setPeriod('month')}>This month</Chip>
        <Chip active={period === '30'} onClick={() => setPeriod('30')}>Last 30 days</Chip>
        <Chip active={period === 'all'} onClick={() => setPeriod('all')}>All time</Chip>
      </div>
      {moves === null ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <p className="py-8 text-center text-sm text-[#8CA0BC]">No losses recorded for this period.</p>
      ) : (
        <>
          <div className="mt-4 rounded-2xl bg-[#FBEAE8] px-4 py-3 text-center">
            <p className="text-xs font-medium text-[#C0433A]">Total lost</p>
            <p className="text-2xl font-semibold text-[#C0433A]">{money(totalValue)}</p>
          </div>
          <div className="mt-3 space-y-2">
            {rows.map((r) => (
              <div key={r.name} className="rounded-2xl border border-[#EAF0F9] bg-[#F7FAFD] px-4 py-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-semibold" style={{ color: INK }}>{r.name}</p>
                  <p className="text-sm font-semibold text-[#C0433A]">{money(r.value)}</p>
                </div>
                <p className="text-xs text-[#5C7196]">
                  {qtyFmt(r.qty)} {r.unit} lost{r.reasons.size ? ` · ${Array.from(r.reasons).slice(0, 3).join(', ')}` : ''}
                </p>
              </div>
            ))}
          </div>
        </>
      )}
    </ModalShell>
  );
};

const MaterialSheet = ({ material, ctx, onClose, onRestock, onCount, onEdit }) => {
  const { storeId, notify, setFollowUp, suppliers } = ctx;
  const [hist, setHist] = useState({ moves: [], restocks: [], loading: true });
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(null); // { type: 'rollback' | 'receive', restock }
  const [recvQty, setRecvQty] = useState('');

  const load = useCallback(async () => {
    try {
      const [moves, restocks] = await Promise.all([
        fetchWhere('opsMovements', where('storeId', '==', storeId), where('materialId', '==', material.id)),
        fetchWhere('opsRestocks', where('storeId', '==', storeId), where('materialId', '==', material.id)),
      ]);
      moves.sort(byNewest);
      restocks.sort(byNewest);
      setHist({ moves, restocks, loading: false });
    } catch (err) {
      setHist((h) => ({ ...h, loading: false }));
      notify({ type: 'error', message: 'Could not load history.' });
    }
  }, [storeId, material.id, notify]);

  useEffect(() => {
    load();
  }, [load, material.quantity]);

  const restockById = useMemo(() => Object.fromEntries(hist.restocks.map((r) => [r.id, r])), [hist.restocks]);
  const pending = hist.restocks.filter((r) => r.status === 'active' && num(r.received) < num(r.quantity));
  const moves = hist.moves.filter((m) => (!from || (m.date || '') >= from) && (!to || (m.date || '') <= to));

  const threshold = num(material.lowStockThreshold);
  const isOut = num(material.quantity) <= 0;
  const isLow = !isOut && threshold > 0 && num(material.quantity) <= threshold;

  const doReceive = async () => {
    const r = confirm.restock;
    const q = Math.min(num(recvQty), num(r.quantity) - num(r.received));
    if (q <= 0) return;
    setBusy(true);
    try {
      const b = writeBatch(db);
      b.update(doc(db, 'opsRestocks', r.id), { received: increment(q), deliveryStatus: num(r.received) + q >= num(r.quantity) ? 'full' : 'part' });
      b.update(doc(db, 'opsMaterials', material.id), { quantity: increment(q), avgCost: blendAvg(material.quantity, material.avgCost, q, r.unitCost), updatedAt: serverTimestamp() });
      b.set(doc(collection(db, 'opsMovements')), {
        storeId,
        materialId: material.id,
        materialName: material.name,
        unit: material.unit,
        type: 'restock',
        quantity: q,
        date: todayStr(),
        detail: `Delivery received · ${r.supplier}`,
        supplier: r.supplier,
        restockId: r.id,
        original: false,
        createdAt: serverTimestamp(),
      });
      await b.commit();
      setConfirm(null);
      setFollowUp({ title: 'Delivery received', message: `${qtyFmt(q)} ${material.unit} added to ${material.name}.`, actions: [] });
    } catch (err) {
      notify({ type: 'error', message: err?.message || 'Could not record delivery.' });
    } finally {
      setBusy(false);
    }
  };

  const doRollback = async () => {
    const restock = confirm.restock;
    setBusy(true);
    try {
      const matRef = doc(db, 'opsMaterials', material.id);
      const [mSnap, rSnap] = await Promise.all([getDoc(matRef), getDoc(doc(db, 'opsRestocks', restock.id))]);
      const cur = mSnap.data();
      const r = rSnap.data();
      if (r.status === 'rolled_back') throw new Error('This restock was already rolled back.');
      if (num(cur.quantity) < num(r.received)) {
        throw new Error(`Can't roll back — only ${qtyFmt(cur.quantity)} ${material.unit} is left but this restock added ${qtyFmt(r.received)}. Some has been used.`);
      }
      const outstanding = Math.max(0, num(r.total) - num(r.paid));
      const sup = suppliers.find((s) => s.id === r.supplierId);
      if (outstanding > 0 && num(sup?.owed) < outstanding - 0.01) {
        throw new Error(`Can't roll back — you have already paid ${r.supplier} down below what this restock added. Ask for a refund and record that instead.`);
      }
      const b = writeBatch(db);
      b.update(matRef, { quantity: increment(-num(r.received)), avgCost: reverseBlend(cur.quantity, cur.avgCost, r.received, r.unitCost), updatedAt: serverTimestamp() });
      b.update(doc(db, 'opsRestocks', restock.id), { status: 'rolled_back', rolledBackAt: serverTimestamp() });
      if (outstanding > 0) b.update(doc(db, 'opsSuppliers', r.supplierId), { owed: increment(-outstanding), updatedAt: serverTimestamp() });
      b.set(doc(collection(db, 'opsMovements')), {
        storeId,
        materialId: material.id,
        materialName: material.name,
        unit: material.unit,
        type: 'rolled_back',
        quantity: -num(r.received),
        date: todayStr(),
        detail: `Restock from ${r.supplier} rolled back`,
        restockId: restock.id,
        createdAt: serverTimestamp(),
      });
      await b.commit();
      setConfirm(null);
      setFollowUp({ title: 'Restock rolled back', message: 'The units were taken back out of stock. You can now record it again correctly.', question: 'Record the restock again?', actions: [{ label: 'Restock now', primary: true, onClick: onRestock }] });
    } catch (err) {
      notify({ type: 'error', message: err?.message || 'Could not roll back.' });
      setConfirm(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModalShell onClose={onClose} size="wide">
      <ModalHeader icon={Boxes} title={material.name} subtitle={`${material.category || 'Material'} · counted in ${material.unit}`} onClose={onClose} />

      <div className="grid grid-cols-3 gap-3">
        <StatBox label="In stock" value={`${qtyFmt(material.quantity)} ${material.unit}`} tone={isOut ? 'red' : isLow ? 'amber' : undefined} />
        <StatBox label="Avg cost" value={`${money(material.avgCost)}`} />
        <StatBox label="Supplier" value={material.supplier || '—'} />
      </div>
      {(isOut || isLow) && (
        <div className="mt-3 flex items-center gap-2 rounded-2xl border border-[#F0DCAF] bg-[#FBF0DA] px-4 py-3 text-sm text-[#8A611E]">
          <AlertTriangle size={14} className="shrink-0" />
          {isOut ? 'Out of stock.' : `Running low — at or below ${qtyFmt(threshold)} ${material.unit}.`}
        </div>
      )}

      <div className="mt-4 flex gap-2.5">
        <SoftButton icon={PackagePlus} onClick={onRestock}>Restock</SoftButton>
        <SoftButton icon={Scale} onClick={onCount}>Count</SoftButton>
        <SoftButton icon={Pencil} onClick={onEdit}>Edit</SoftButton>
      </div>

      {pending.length > 0 && (
        <div className="mt-4 space-y-2">
          <SectionLabel>Still to arrive</SectionLabel>
          {pending.map((r) => (
            <div key={r.id} className="flex items-center justify-between gap-3 rounded-2xl border border-[#F0DCAF] bg-[#FBF0DA]/60 px-4 py-3">
              <div className="min-w-0 text-sm">
                <p className="truncate font-semibold" style={{ color: INK }}>{qtyFmt(num(r.quantity) - num(r.received))} {material.unit} from {r.supplier}</p>
                <p className="text-xs text-[#8A611E]">Ordered {formatDate(r.date)}</p>
              </div>
              <button type="button" onClick={() => { setRecvQty(String(num(r.quantity) - num(r.received))); setConfirm({ type: 'receive', restock: r }); }} className="shrink-0 rounded-full bg-[#2B6CDA] px-3.5 py-2 text-xs font-semibold text-white">
                Mark received
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="mt-5">
        <SectionLabel hint="Pick dates to see what came in or went out">History</SectionLabel>
        <div className="grid grid-cols-2 gap-3">
          <Field id="mh-from" label="From" type="date" value={from} onChange={(e) => setFrom(e.target.value)} compact />
          <Field id="mh-to" label="To" type="date" value={to} onChange={(e) => setTo(e.target.value)} compact />
        </div>
        {hist.loading ? (
          <Spinner />
        ) : moves.length === 0 ? (
          <p className="py-6 text-center text-sm text-[#8CA0BC]">Nothing recorded for these dates.</p>
        ) : (
          <div className="mt-3 space-y-2">
            {moves.map((m) => {
              const r = m.restockId ? restockById[m.restockId] : null;
              const rolled = r?.status === 'rolled_back';
              const canRoll = m.type === 'restock' && m.original && r?.status === 'active';
              const delta = num(m.quantity);
              return (
                <div key={m.id} className={`rounded-xl border border-[#EAF0F9] bg-[#F7FAFD] px-3.5 py-2.5 ${rolled ? 'opacity-60' : ''}`}>
                  <div className="flex flex-wrap items-center justify-between gap-1.5">
                    <span className="flex items-center gap-2 text-sm font-semibold" style={{ color: INK }}>
                      {MOVE_TITLES[m.type] || m.type}
                      {rolled && <Badge tone="amber">Rolled back</Badge>}
                    </span>
                    <span className="text-[11px] text-[#8CA0BC]">{formatDate(m.date)}</span>
                  </div>
                  <p className="mt-0.5 text-sm text-[#5C7196]">{m.detail}</p>
                  <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
                    <span className={`text-sm font-semibold ${delta < 0 ? 'text-[#C0433A]' : 'text-[#2B6CDA]'}`}>
                      {delta > 0 ? '+' : ''}{qtyFmt(delta)} {material.unit}
                    </span>
                    {num(m.waste) > 0 && <span className="text-xs font-semibold text-[#C0433A]">Lost {qtyFmt(m.waste)}{m.reason ? ` · ${m.reason}` : ''}</span>}
                    {m.type === 'count' && m.reason && <span className="text-xs text-[#5C7196]">{m.reason}</span>}
                    {canRoll && (
                      <button type="button" onClick={() => setConfirm({ type: 'rollback', restock: r })} className="flex items-center gap-1 rounded-full border border-[#E1E8F4] bg-white px-2.5 py-1 text-xs font-semibold text-[#2B6CDA] hover:border-[#2B6CDA]">
                        <RotateCcw size={11} /> Roll back
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <AnimatePresence>
        {confirm?.type === 'rollback' && (
          <ConfirmDialog
            icon={RotateCcw}
            tone="default"
            title="Roll back this restock?"
            body={`This takes ${qtyFmt(confirm.restock.received)} ${material.unit} back out of stock and removes what you owed ${confirm.restock.supplier} for it. It is blocked if some has already been used.`}
            confirmLabel="Roll back"
            saving={busy}
            onCancel={() => setConfirm(null)}
            onConfirm={doRollback}
          />
        )}
        {confirm?.type === 'receive' && (
          <ConfirmDialog
            icon={Truck}
            tone="default"
            title="Mark delivery received"
            body={`How much of ${material.name} arrived?`}
            confirmLabel="Add to stock"
            saving={busy}
            onCancel={() => setConfirm(null)}
            onConfirm={doReceive}
          >
            <Field id="recv" type="number" min="0" step="any" inputMode="decimal" value={recvQty} onChange={(e) => setRecvQty(e.target.value)} suffix={material.unit} />
          </ConfirmDialog>
        )}
      </AnimatePresence>
    </ModalShell>
  );
};

const MaterialsView = ({ ctx }) => {
  const { materials, loading } = ctx;
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('all');
  const [addOpen, setAddOpen] = useState(false);
  const [openId, setOpenId] = useState(null);
  const [restockId, setRestockId] = useState(null);
  const [countId, setCountId] = useState(null);
  const [editId, setEditId] = useState(null);
  const [lossOpen, setLossOpen] = useState(false);
  const [picker, setPicker] = useState(false); // choose a material to restock

  const rows = useMemo(
    () =>
      materials
        .filter((m) => (cat === 'all' ? true : (m.category || 'Material') === cat))
        .filter((m) => !q || lower(m.name).includes(lower(q)))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [materials, q, cat]
  );
  const find = (id) => materials.find((m) => m.id === id);

  return (
    <div>
      <PageTop
        title="Materials"
        subtitle="Everything you buy to make shoes"
        onAdd={() => setAddOpen(true)}
        addLabel="Add material"
        extra={
          <button type="button" onClick={() => setLossOpen(true)} className="flex items-center gap-1.5 rounded-full border border-[#E1E8F4] bg-white px-3.5 py-2.5 text-sm font-semibold text-[#C0433A]">
            <TrendingDown size={14} /> Losses
          </button>
        }
      />
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <SearchBar value={q} onChange={setQ} placeholder="Search materials…" />
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        <Chip active={cat === 'all'} onClick={() => setCat('all')}>All</Chip>
        <Chip active={cat === 'Material'} onClick={() => setCat('Material')}>Materials</Chip>
        <Chip active={cat === 'Machine spare'} onClick={() => setCat('Machine spare')}>Machine spares</Chip>
      </div>

      {loading ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <EmptyState icon={Boxes} title="No materials yet" body="Add glue, leather, soles, boards — then restock them whenever you buy. They'll be there when you build a recipe." actionLabel="Add material" onAction={() => setAddOpen(true)} />
      ) : (
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {rows.map((m) => {
            const out = num(m.quantity) <= 0;
            const low = !out && num(m.lowStockThreshold) > 0 && num(m.quantity) <= num(m.lowStockThreshold);
            return (
              <RowCard
                key={m.id}
                icon={m.category === 'Machine spare' ? Wrench : Package}
                title={m.name}
                subtitle={`${m.supplier || 'No supplier yet'} · ${money(m.avgCost)}/${m.unit}`}
                tone={out ? 'red' : low ? 'amber' : undefined}
                onClick={() => setOpenId(m.id)}
                right={
                  <div>
                    <p className="text-sm font-semibold" style={{ color: out ? '#C0433A' : low ? '#B9812E' : INK }}>{qtyFmt(m.quantity)} {m.unit}</p>
                    {(out || low) && <p className="text-[11px] font-semibold" style={{ color: out ? '#C0433A' : '#B9812E' }}>{out ? 'Out' : 'Low'}</p>}
                  </div>
                }
              />
            );
          })}
        </div>
      )}

      <AnimatePresence>
        {addOpen && (
          <AddMaterialModal
            ctx={ctx}
            onClose={() => setAddOpen(false)}
            onAdded={(id, name) =>
              ctx.setFollowUp({
                title: `${name} added`,
                message: 'It is now saved and will show up when you build recipes.',
                question: 'Do you already have some in stock?',
                actions: [
                  { label: 'Record stock / restock', primary: true, onClick: () => setRestockId(id) },
                  { label: 'Add another material', onClick: () => setAddOpen(true) },
                ],
              })
            }
          />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {openId && find(openId) && (
          <MaterialSheet
            material={find(openId)}
            ctx={ctx}
            onClose={() => setOpenId(null)}
            onRestock={() => setRestockId(openId)}
            onCount={() => setCountId(openId)}
            onEdit={() => setEditId(openId)}
          />
        )}
      </AnimatePresence>
      <AnimatePresence>{restockId && find(restockId) && <RestockModal material={find(restockId)} ctx={ctx} onClose={() => setRestockId(null)} onAgain={() => setPicker(true)} />}</AnimatePresence>
      <AnimatePresence>{countId && find(countId) && <CountModal material={find(countId)} ctx={ctx} onClose={() => setCountId(null)} />}</AnimatePresence>
      <AnimatePresence>{editId && find(editId) && <EditMaterialModal material={find(editId)} ctx={ctx} onClose={() => setEditId(null)} />}</AnimatePresence>
      <AnimatePresence>{lossOpen && <LossReportModal ctx={ctx} onClose={() => setLossOpen(false)} />}</AnimatePresence>
      <AnimatePresence>
        {picker && (
          <ModalShell onClose={() => setPicker(false)}>
            <ModalHeader icon={PackagePlus} title="Which material?" onClose={() => setPicker(false)} />
            <div className="space-y-2">
              {[...materials].sort((a, b) => a.name.localeCompare(b.name)).map((m) => (
                <button key={m.id} type="button" onClick={() => { setPicker(false); setRestockId(m.id); }} className="flex w-full items-center justify-between rounded-2xl border border-[#E1E8F4] px-4 py-3 text-left text-sm font-semibold hover:border-[#2B6CDA]" style={{ color: INK }}>
                  {m.name}
                  <span className="text-xs font-medium text-[#8CA0BC]">{qtyFmt(m.quantity)} {m.unit}</span>
                </button>
              ))}
            </div>
          </ModalShell>
        )}
      </AnimatePresence>
    </div>
  );
};

/* ==================================================================== */
/*  PRODUCTS (recipes) + PRODUCTION RUNS — "Make shoes"                  */
/* ==================================================================== */

// Writes finished pairs into the shared items / storeItems / stock docs
// at `destId`, with cost per pair as avgCost. The product's free-text
// attributes and alert level carry over to the stock item. Resolves (or
// creates) the shared catalog item by name. Returns itemId.
const placeFinished = async (b, { destId, product, sizesMade, costPerPair, label }) => {
  const sizes = Object.keys(sizesMade).filter((s) => num(sizesMade[s]) > 0).sort(sizeSort);
  const attrs = product.attributes || [];
  let itemId = product.itemId || null;
  let itemDoc = null;
  if (itemId) {
    const s = await getDoc(doc(db, 'items', itemId));
    if (s.exists()) itemDoc = { id: s.id, ...s.data() };
    else itemId = null;
  }
  if (!itemId) {
    const found = await findItemByName(product.name);
    if (found) {
      itemId = found.id;
      itemDoc = found;
    }
  }
  if (itemDoc) {
    const patch = {};
    const merged = dedupeKeepOrder([...(itemDoc.variantOptions || []), ...sizes]);
    if (merged.length !== (itemDoc.variantOptions || []).length) patch.variantOptions = merged;
    const have = new Set((itemDoc.attributes || []).map((a) => lower(a.key)));
    const extra = attrs.filter((a) => !have.has(lower(a.key)));
    if (extra.length) patch.attributes = [...(itemDoc.attributes || []), ...extra];
    if (Object.keys(patch).length) b.update(doc(db, 'items', itemId), { ...patch, updatedAt: serverTimestamp() });
  } else {
    const ref = doc(collection(db, 'items'));
    itemId = ref.id;
    b.set(ref, { name: product.name, category: 'Shoes', unit: 'pairs', variantOptions: sizes, attributes: attrs, notes: '', status: 'active', createdAt: serverTimestamp() });
  }

  const siRef = doc(db, 'storeItems', storeItemKey(destId, itemId));
  const siSnap = await getDoc(siRef);
  if (siSnap.exists()) {
    b.update(siRef, { variantsCarried: dedupeKeepOrder([...(siSnap.data().variantsCarried || []), ...sizes]), status: 'active', updatedAt: serverTimestamp() });
  } else {
    b.set(siRef, { storeId: destId, itemId, sellingPrice: num(product.sellingPrice), supplier: '', variantsCarried: sizes, lowStockThreshold: num(product.lowStockThreshold), status: 'active', createdAt: serverTimestamp() });
  }

  const stockSnap = itemDoc ? await getDocs(query(collection(db, 'stock'), where('storeId', '==', destId), where('itemId', '==', itemId))) : null;
  const existing = Object.fromEntries((stockSnap?.docs || []).map((d) => [d.data().variant, d.data()]));
  sizes.forEach((s) => {
    const n = num(sizesMade[s]);
    const ex = existing[s];
    const payload = { storeId: destId, itemId, variant: s, quantity: increment(n), avgCost: blendAvg(ex?.quantity, ex?.avgCost, n, costPerPair), updatedAt: serverTimestamp() };
    if (!ex) payload.createdAt = serverTimestamp();
    b.set(doc(db, 'stock', stockKey(destId, itemId, s)), payload, { merge: true });
  });

  b.set(doc(collection(db, 'activityLog')), {
    storeId: destId,
    itemId,
    type: 'restocked',
    date: todayStr(),
    detail: `Produced in-house · ${label} · ${money(costPerPair)}/pair`,
    lineSummary: sizes.map((s) => `${s}: +${num(sizesMade[s])}`).join(', '),
    createdAt: serverTimestamp(),
  });
  return itemId;
};

const ProductModal = ({ product, defaultName = '', ctx, onClose }) => {
  const { storeId, materials, products, lists, notify, setFollowUp } = ctx;
  const matMap = useMemo(() => Object.fromEntries(materials.map((m) => [m.id, m])), [materials]);
  const [name, setName] = useState(product?.name || defaultName);
  const [sizeFrom, setSizeFrom] = useState(product?.sizeFrom ?? '');
  const [sizeTo, setSizeTo] = useState(product?.sizeTo ?? '');
  const [price, setPrice] = useState(product?.sellingPrice || '');
  const [alertAt, setAlertAt] = useState(product?.lowStockThreshold || '');
  const [attributes, setAttributes] = useState(product?.attributes || []);
  const [rows, setRows] = useState(
    product?.materials?.length
      ? product.materials.map((m, i) => ({ id: `r${i}`, name: m.name, unit: m.unit, perPair: String(m.perPair) }))
      : [{ id: 'r0', name: '', unit: 'pcs', perPair: '' }]
  );
  const [steps, setSteps] = useState(product?.steps || []);
  const [stepInput, setStepInput] = useState('');
  const [saving, setSaving] = useState(false);

  const stepOptions = useMemo(() => dedupeSorted([...DEFAULT_STEPS, ...(lists.steps || [])]), [lists.steps]);
  const setRow = (id, patch) => setRows((r) => r.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  const addStep = (s) => {
    const clean = s.trim();
    if (!clean || steps.some((x) => lower(x) === lower(clean))) return;
    setSteps((st) => [...st, clean]);
    setStepInput('');
  };

  const validRows = rows.filter((r) => r.name.trim() && num(r.perPair) > 0);
  const sizesOk = sizeList(sizeFrom, sizeTo).length > 0;
  const canSave = name.trim() && sizesOk && validRows.length > 0;
  const estCost = validRows.reduce((s, r) => s + num(r.perPair) * num(matMap[keyOf(storeId, r.name.trim())]?.avgCost), 0);

  const submit = async (e) => {
    e.preventDefault();
    if (!canSave) return;
    const clean = name.trim();
    if (products.some((p) => p.id !== product?.id && lower(p.name) === lower(clean))) {
      notify({ type: 'error', message: `"${clean}" already exists — open it from the list to edit.` });
      return;
    }
    setSaving(true);
    try {
      const b = writeBatch(db);
      const recipe = validRows.map((r) => {
        const id = keyOf(storeId, r.name.trim());
        const ex = matMap[id];
        const unit = ex ? ex.unit : r.unit.trim() || 'pcs';
        if (!ex) {
          b.set(doc(db, 'opsMaterials', id), { storeId, name: r.name.trim(), unit, category: 'Material', quantity: 0, avgCost: 0, supplier: '', lowStockThreshold: 0, status: 'active', createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
        }
        return { materialId: id, name: ex ? ex.name : r.name.trim(), unit, perPair: num(r.perPair) };
      });
      const data = {
        storeId,
        name: clean,
        sizeFrom: parseInt(sizeFrom, 10),
        sizeTo: parseInt(sizeTo, 10),
        sellingPrice: num(price),
        lowStockThreshold: num(alertAt),
        attributes,
        materials: recipe,
        steps,
        status: 'active',
        updatedAt: serverTimestamp(),
      };
      if (product) b.update(doc(db, 'opsProducts', product.id), data);
      else b.set(doc(collection(db, 'opsProducts')), { ...data, createdAt: serverTimestamp() });
      const listPatch = { ...attrPatch(attributes) };
      if (steps.length) listPatch.steps = arrayUnion(...steps);
      if (Object.keys(listPatch).length) b.set(doc(db, 'opsLists', storeId), { ...listPatch, updatedAt: serverTimestamp() }, { merge: true });
      await b.commit();
      onClose();
      if (product) notify({ type: 'success', message: `${clean} updated.` });
      else
        setFollowUp({
          title: `${clean} saved`,
          message: 'The recipe is stored — you can pick it for any order or production run.',
          question: 'Start making some now?',
          actions: [{ label: 'Start production', primary: true, onClick: () => ctx.goMake({ productName: clean }) }],
        });
    } catch (err) {
      notify({ type: 'error', message: err?.message || 'Could not save product.' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell onClose={onClose} size="wide">
      <ModalHeader icon={Footprints} title={product ? `Edit ${product.name}` : 'Add a product'} subtitle="The recipe for one pair" onClose={onClose} />
      <form onSubmit={submit} className="space-y-5">
        <SuggestInput id="pr-name" label="Product name" icon={Footprints} value={name} onChange={setName} options={products.filter((p) => p.id !== product?.id).map((p) => p.name)} placeholder="e.g. Girls buckle school shoe" />
        <div className="grid grid-cols-3 gap-3">
          <Field id="pr-from" label="Size from" type="number" min="1" inputMode="numeric" value={sizeFrom} onChange={(e) => setSizeFrom(e.target.value)} />
          <Field id="pr-to" label="Size to" type="number" min="1" inputMode="numeric" value={sizeTo} onChange={(e) => setSizeTo(e.target.value)} />
          <Field id="pr-price" label="Selling price" type="number" min="0" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} suffix="KSh" />
        </div>
        {(sizeFrom !== '' || sizeTo !== '') && !sizesOk && <p className="-mt-3 text-xs font-medium text-[#C0433A]">Enter a size range like 28 to 38.</p>}

        <AttributeEditor attributes={attributes} onChange={setAttributes} lists={lists} />
        <Field id="pr-alert" label="Warn me when warehouse stock drops to (pairs)" icon={AlertTriangle} type="number" min="0" inputMode="numeric" value={alertAt} onChange={(e) => setAlertAt(e.target.value)} placeholder="0 = only when finished" />

        <div>
          <SectionLabel hint="Per ONE pair">Materials used</SectionLabel>
          <div className="space-y-3">
            {rows.map((r) => {
              const ex = matMap[keyOf(storeId, r.name.trim())];
              return (
                <div key={r.id} className="rounded-2xl border border-[#E1E8F4] bg-[#FBFCFE] p-3.5">
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <SuggestInput id={`rr-${r.id}`} value={r.name} onChange={(v) => setRow(r.id, { name: v })} options={materials.map((m) => m.name)} placeholder="Pick or type a material" compact />
                    </div>
                    {rows.length > 1 && (
                      <button type="button" onClick={() => setRows((x) => x.filter((y) => y.id !== r.id))} className="mt-2 rounded-full p-1.5 text-[#8CA0BC] hover:bg-[#FBEAE8] hover:text-[#C0433A]" aria-label="Remove material">
                        <X size={14} />
                      </button>
                    )}
                  </div>
                  <div className="mt-2.5 grid grid-cols-2 gap-3">
                    <Field id={`rp-${r.id}`} label="Per pair" type="number" min="0" step="any" inputMode="decimal" value={r.perPair} onChange={(e) => setRow(r.id, { perPair: e.target.value })} compact />
                    <Field id={`ru-${r.id}`} label="Unit" value={ex ? ex.unit : r.unit} onChange={(e) => setRow(r.id, { unit: e.target.value })} disabled={!!ex} compact />
                  </div>
                  {r.name.trim() && !ex && <p className="mt-1.5 text-xs text-[#8CA0BC]">New material — it'll be saved to Materials with no stock yet.</p>}
                </div>
              );
            })}
          </div>
          <button type="button" onClick={() => setRows((r) => [...r, { id: `r${Date.now()}`, name: '', unit: 'pcs', perPair: '' }])} className="mt-2.5 flex items-center gap-1.5 text-sm font-semibold text-[#2B6CDA]">
            <Plus size={14} /> Add another material
          </button>
          {estCost > 0 && <p className="mt-2 text-sm font-medium text-[#5C7196]">Material cost ≈ <span className="font-semibold" style={{ color: INK }}>{money(estCost)}</span> per pair at current prices.</p>}
        </div>

        <div>
          <SectionLabel hint="The order work flows through">Steps</SectionLabel>
          {steps.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {steps.map((s, i) => (
                <span key={s} className="flex items-center gap-1.5 rounded-full bg-[#EAF2FE] px-3 py-1.5 text-sm font-medium text-[#2B6CDA]">
                  <span className="text-[#5C87C7]">{i + 1}.</span> {s}
                  <button type="button" onClick={() => setSteps((st) => st.filter((x) => x !== s))} className="text-[#2B6CDA]/60 hover:text-[#2B6CDA]"><X size={11} /></button>
                </span>
              ))}
            </div>
          )}
          <div className="mb-2 flex flex-wrap gap-1.5">
            {stepOptions.filter((s) => !steps.some((x) => lower(x) === lower(s))).map((s) => (
              <button key={s} type="button" onClick={() => addStep(s)} className="rounded-full border border-[#E1E8F4] px-2.5 py-1 text-xs font-medium text-[#5C7196] hover:border-[#2B6CDA] hover:text-[#2B6CDA]">
                + {s}
              </button>
            ))}
          </div>
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <Field id="pr-step" value={stepInput} onChange={(e) => setStepInput(e.target.value)} placeholder="Type a new step" compact />
            </div>
            <button type="button" onClick={() => addStep(stepInput)} className="h-[42px] shrink-0 rounded-full bg-[#2B6CDA] px-4 text-sm font-semibold text-white">Add</button>
          </div>
        </div>

        <SubmitButton saving={saving} disabled={!canSave}>
          <CheckCircle2 size={15} /> Save product
        </SubmitButton>
      </form>
    </ModalShell>
  );
};

const StartRunModal = ({ preset, ctx, onClose, onNeedProduct, onStarted }) => {
  const { storeId, products, orders, materials, notify, setFollowUp } = ctx;
  // Only lines that still need making — lines taken from stock or already made are skipped.
  const openLines = useMemo(
    () => orders.filter((o) => ['waiting', 'making'].includes(o.workStatus)).flatMap((o) => (o.lines || []).map((l, idx) => ({ order: o, line: l, idx })).filter((x) => lineNeedsMaking(x.line))),
    [orders]
  );
  const presetProduct = preset?.productName ? products.find((p) => lower(p.name) === lower(preset.productName)) : null;
  const presetPick = preset?.orderId ? openLines.find((x) => x.order.id === preset.orderId && x.idx === (preset.lineIndex ?? 0)) : null;

  const [purpose, setPurpose] = useState(presetPick ? 'order' : 'warehouse');
  const [pick, setPick] = useState(presetPick || null);
  const [productId, setProductId] = useState(presetProduct?.id || (presetPick ? products.find((p) => lower(p.name) === lower(presetPick.line.productName))?.id : '') || '');
  const [sizes, setSizes] = useState({});
  const [saving, setSaving] = useState(false);

  const product = products.find((p) => p.id === productId);
  const sizeKeys = product ? sizeList(product.sizeFrom, product.sizeTo) : [];
  const totalPairs = sizeKeys.reduce((s, k) => s + num(sizes[k]), 0);
  const matMap = useMemo(() => Object.fromEntries(materials.map((m) => [m.id, m])), [materials]);
  const needs = product ? (product.materials || []).map((m) => ({ ...m, need: m.perPair * totalPairs, have: num(matMap[m.materialId]?.quantity) })) : [];
  const short = needs.filter((n) => totalPairs > 0 && n.have < n.need);

  const choosePick = (x) => {
    setPick(x);
    const p = products.find((pp) => lower(pp.name) === lower(x.line.productName));
    if (p) {
      setProductId(p.id);
      setSizes({});
    }
  };

  const canSave = product && totalPairs > 0 && (purpose === 'warehouse' || pick);

  const submit = async (e) => {
    e.preventDefault();
    if (!canSave) return;
    setSaving(true);
    try {
      const runNo = await nextNumber(`ops_runs_${new Date().getFullYear()}`, `RUN-${new Date().getFullYear()}-`);
      const b = writeBatch(db);
      const ref = doc(collection(db, 'opsRuns'));
      const sizeMap = Object.fromEntries(sizeKeys.filter((k) => num(sizes[k]) > 0).map((k) => [k, num(sizes[k])]));
      b.set(ref, {
        storeId,
        runNo,
        productId: product.id,
        productName: product.name,
        purpose,
        orderId: purpose === 'order' ? pick.order.id : null,
        orderNo: purpose === 'order' ? pick.order.orderNo : null,
        clientName: purpose === 'order' ? pick.order.clientName : null,
        lineIndex: purpose === 'order' ? pick.idx : null,
        sizes: sizeMap,
        totalPairs,
        expected: needs.map((n) => ({ materialId: n.materialId, name: n.name, unit: n.unit, qty: Number(n.need.toFixed(3)) })),
        steps: (product.steps || []).map((s) => ({ name: s, done: false, doneBy: '', doneById: '' })),
        status: 'in_progress',
        startDate: todayStr(),
        createdAt: serverTimestamp(),
      });
      if (purpose === 'order' && pick.order.workStatus === 'waiting') b.update(doc(db, 'opsOrders', pick.order.id), { workStatus: 'making', updatedAt: serverTimestamp() });
      await b.commit();
      onClose();
      setFollowUp({
        title: `${runNo} started`,
        message: `${totalPairs} pairs of ${product.name}${purpose === 'order' ? ` for ${pick.order.clientName}` : ' for the warehouse'}.${short.length ? ` Heads up: you're short on ${short.map((s) => s.name).join(', ')}.` : ''}`,
        question: 'Open the run to tick off steps?',
        actions: [{ label: 'Open run', primary: true, onClick: () => onStarted(ref.id) }],
      });
    } catch (err) {
      notify({ type: 'error', message: err?.message || 'Could not start the run.' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell onClose={onClose} size="wide">
      <ModalHeader icon={Hammer} title="Start production" subtitle="What are you making?" onClose={onClose} />
      {products.length === 0 ? (
        <EmptyState icon={Footprints} title="Add a product first" body="A product holds the recipe — materials per pair, sizes and steps. It takes a minute and is saved forever." actionLabel="Add product" onAction={() => { onClose(); onNeedProduct(); }} />
      ) : (
        <form onSubmit={submit} className="space-y-5">
          <div>
            <SectionLabel>Why are you making them?</SectionLabel>
            <ChoiceRow cols="grid-cols-2" value={purpose} onChange={(v) => { setPurpose(v); if (v === 'warehouse') setPick(null); }} options={[{ id: 'order', label: 'For an order', icon: ClipboardList }, { id: 'warehouse', label: 'For the warehouse', icon: Warehouse }]} />
          </div>

          {purpose === 'order' && (
            <div>
              <SectionLabel hint="Order lines still to make">Pick the order</SectionLabel>
              {openLines.length === 0 ? (
                <p className="rounded-2xl border border-dashed border-[#CBDBF3] px-4 py-4 text-sm text-[#5C7196]">Nothing left to make for orders — add one in Orders, or switch to "For the warehouse".</p>
              ) : (
                <div className="space-y-2">
                  {openLines.map((x) => {
                    const active = pick && pick.order.id === x.order.id && pick.idx === x.idx;
                    return (
                      <button key={`${x.order.id}-${x.idx}`} type="button" onClick={() => choosePick(x)} className={`flex w-full items-center justify-between gap-3 rounded-2xl border-2 px-4 py-3 text-left transition-colors ${active ? 'border-[#2B6CDA] bg-[#EAF2FE]' : 'border-[#E1E8F4] bg-white'}`}>
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-semibold" style={{ color: INK }}>{x.order.clientName} · {x.line.productName}</span>
                          <span className="block text-xs text-[#8CA0BC]">{x.order.orderNo} · {x.line.pairs} pairs{x.line.sizeFrom ? ` · sizes ${x.line.sizeFrom}–${x.line.sizeTo}` : ''}{x.order.dueDate ? ` · due ${formatDate(x.order.dueDate)}` : ''}</span>
                        </span>
                        {active && <Check size={16} className="shrink-0 text-[#2B6CDA]" />}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          <div>
            <SectionLabel>Product</SectionLabel>
            <div className="flex flex-wrap gap-1.5">
              {[...products].sort((a, b) => a.name.localeCompare(b.name)).map((p) => (
                <Chip key={p.id} active={productId === p.id} onClick={() => { setProductId(p.id); setSizes({}); }}>{p.name}</Chip>
              ))}
            </div>
            {purpose === 'order' && pick && !product && (
              <p className="mt-2 text-sm text-[#B9812E]">
                "{pick.line.productName}" has no recipe yet.{' '}
                <button type="button" className="font-semibold underline" onClick={() => { onClose(); onNeedProduct(pick.line.productName); }}>Create it</button>
              </p>
            )}
          </div>

          {product && (
            <div>
              <SectionLabel hint={purpose === 'order' && pick ? `Order needs ${pick.line.pairs} pairs` : undefined}>Pairs per size</SectionLabel>
              <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
                {sizeKeys.map((k) => (
                  <div key={k} className="rounded-xl border border-[#E1E8F4] bg-white px-2 py-1.5 text-center">
                    <p className="text-[11px] font-semibold text-[#8CA0BC]">Size {k}</p>
                    <input type="number" min="0" inputMode="numeric" value={sizes[k] ?? ''} onChange={(e) => setSizes((s) => ({ ...s, [k]: e.target.value }))} placeholder="0" className="w-full bg-transparent text-center text-[15px] font-semibold outline-none" style={{ color: INK }} />
                  </div>
                ))}
              </div>
              <p className="mt-2 text-sm font-semibold text-[#2B6CDA]">{totalPairs} pairs total</p>
            </div>
          )}

          {product && totalPairs > 0 && (
            <div className="rounded-2xl bg-[#123A73] p-4 text-sm text-white">
              <p className="font-semibold">Materials this will need</p>
              <div className="mt-2 space-y-1">
                {needs.map((n) => (
                  <div key={n.materialId} className="flex items-center justify-between text-[#D9E7FB]">
                    <span>{n.name}</span>
                    <span className={`font-semibold ${n.have < n.need ? 'text-[#FFB4AC]' : 'text-white'}`}>
                      {qtyFmt(n.need)} {n.unit} <span className="font-normal text-[#9FB8DF]">(have {qtyFmt(n.have)})</span>
                    </span>
                  </div>
                ))}
              </div>
              {short.length > 0 && <p className="mt-2 flex items-center gap-1.5 text-xs font-semibold text-[#FFB4AC]"><AlertTriangle size={12} /> Short on {short.map((s) => s.name).join(', ')} — restock before you finish the run.</p>}
            </div>
          )}

          <SubmitButton saving={saving} disabled={!canSave}>
            <Hammer size={15} /> Start production
          </SubmitButton>
        </form>
      )}
    </ModalShell>
  );
};

const PlaceChips = ({ stores, roleOf, value, onChange, allowNone }) => (
  <div className="flex flex-wrap gap-1.5">
    {stores.map((s) => (
      <Chip key={s.id} active={value === s.id} onClick={() => onChange(s.id)} icon={roleOf(s.id) === 'factory' ? Factory : roleOf(s.id) === 'warehouse' ? Warehouse : Store}>
        {s.name} · {ROLE_LABEL[roleOf(s.id)]}
      </Chip>
    ))}
    {allowNone && (
      <Chip active={value === ''} onClick={() => onChange('')}>
        Not placed yet
      </Chip>
    )}
  </div>
);

const FinishRunModal = ({ run, ctx, onClose }) => {
  const { storeId, materials, products, stores, lists, notify, setFollowUp, roleOf } = ctx;
  const matMap = useMemo(() => Object.fromEntries(materials.map((m) => [m.id, m])), [materials]);
  const product = products.find((p) => p.id === run.productId);
  const sizeKeys = Object.keys(run.sizes || {}).sort(sizeSort);
  const order = run.orderId ? ctx.orders.find((o) => o.id === run.orderId) : null;

  const [actuals, setActuals] = useState({});
  const [reasons, setReasons] = useState({});
  const [modes, setModes] = useState({});
  const [made, setMade] = useState(Object.fromEntries(sizeKeys.map((k) => [k, String(run.sizes[k])])));
  const [costs, setCosts] = useState([]); // [{ id, name, amount }] — free-text production costs
  const [placeId, setPlaceId] = useState(ctx.defaultPlace(order));
  const [saving, setSaving] = useState(false);

  const costDefaults = lists.costDefaults || {};
  const costChips = dedupeSorted([...DEFAULT_COSTS, ...Object.values(costDefaults).map((c) => c.name)]).filter((n) => !costs.some((c) => lower(c.name) === lower(n)));
  const addCost = (name = '') =>
    setCosts((c) => [...c, { id: `c${Date.now()}${c.length}`, name, amount: costDefaults[slugify(name)] ? String(costDefaults[slugify(name)].amount) : '' }]);
  const setCost = (id, patch) => setCosts((c) => c.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  const validCosts = costs.filter((c) => c.name.trim() && num(c.amount) > 0).map((c) => ({ name: c.name.trim(), amount: num(c.amount) }));
  const incompleteCost = costs.some((c) => (c.name.trim() || c.amount !== '') && !(c.name.trim() && num(c.amount) > 0));
  const otherTotal = validCosts.reduce((s, c) => s + c.amount, 0);

  const rows = (run.expected || []).map((e) => {
    const raw = actuals[e.materialId];
    const actual = raw === undefined || raw === '' ? e.qty : num(raw);
    const mat = matMap[e.materialId];
    return { ...e, actual, diff: actual - e.qty, mat, short: !mat || num(mat.quantity) < actual };
  });
  const madeMap = Object.fromEntries(sizeKeys.map((k) => [k, Math.min(num(made[k]), run.sizes[k])]));
  const madeTotal = sizeKeys.reduce((s, k) => s + num(made[k]), 0);
  const rejects = Math.max(0, run.totalPairs - madeTotal);
  const materialCost = rows.reduce((s, r) => s + r.actual * num(r.mat?.avgCost), 0);
  const totalCost = materialCost + otherTotal;
  const costPerPair = madeTotal > 0 ? totalCost / madeTotal : 0;
  const missingReason = rows.some((r) => Math.abs(r.diff) > 1e-9 && !(reasons[r.materialId] || '').trim());
  const shortRows = rows.filter((r) => r.short);
  const canSave = madeTotal > 0 && madeTotal <= run.totalPairs && !missingReason && shortRows.length === 0 && !incompleteCost;

  const submit = async (e) => {
    e.preventDefault();
    if (!canSave) return;
    setSaving(true);
    try {
      const b = writeBatch(db);
      const label = run.runNo;

      rows.forEach((r) => {
        const waste = r.actual - r.qty;
        b.update(doc(db, 'opsMaterials', r.materialId), { quantity: increment(-r.actual), updatedAt: serverTimestamp() });
        b.set(doc(collection(db, 'opsMovements')), {
          storeId,
          materialId: r.materialId,
          materialName: r.name,
          unit: r.unit,
          type: 'production_use',
          quantity: -r.actual,
          expected: r.qty,
          waste,
          wasteValue: waste > 0 ? waste * num(r.mat?.avgCost) : 0,
          reason: Math.abs(waste) > 1e-9 ? (reasons[r.materialId] || '').trim() : '',
          runId: run.id,
          runNo: label,
          date: todayStr(),
          detail: `${label} · ${run.productName}`,
          createdAt: serverTimestamp(),
        });
      });

      const normRows = rows.filter((r) => modes[r.materialId] === 'norm' && Math.abs(r.diff) > 1e-9);
      if (product && normRows.length) {
        const updated = (product.materials || []).map((m) => {
          const hit = normRows.find((r) => r.materialId === m.materialId);
          return hit ? { ...m, perPair: Number((hit.actual / run.totalPairs).toFixed(3)) } : m;
        });
        b.update(doc(db, 'opsProducts', product.id), { materials: updated, updatedAt: serverTimestamp() });
      }

      // Remember loss reasons and cost names + last amounts so next time it is one tap.
      const listPatch = {};
      const usedReasons = dedupeKeepOrder(rows.map((r) => (Math.abs(r.diff) > 1e-9 ? (reasons[r.materialId] || '').trim() : '')));
      if (usedReasons.length) listPatch.reasons = arrayUnion(...usedReasons);
      if (validCosts.length) listPatch.costDefaults = Object.fromEntries(validCosts.map((c) => [slugify(c.name), { name: c.name, amount: c.amount }]));
      if (Object.keys(listPatch).length) b.set(doc(db, 'opsLists', storeId), { ...listPatch, updatedAt: serverTimestamp() }, { merge: true });

      let itemId = run.itemId || null;
      if (placeId && product) {
        itemId = await placeFinished(b, { destId: placeId, product, sizesMade: madeMap, costPerPair, label });
        if (product.itemId !== itemId) b.update(doc(db, 'opsProducts', product.id), { itemId });
      }

      b.update(doc(db, 'opsRuns', run.id), {
        status: 'completed',
        actual: rows.map((r) => ({ materialId: r.materialId, name: r.name, unit: r.unit, expected: r.qty, actual: r.actual, reason: Math.abs(r.diff) > 1e-9 ? (reasons[r.materialId] || '').trim() : '', newStandard: modes[r.materialId] === 'norm' && Math.abs(r.diff) > 1e-9 })),
        made: madeMap,
        madeTotal,
        rejectPairs: rejects,
        materialCost,
        costs: validCosts,
        wages: 0,
        otherCost: otherTotal,
        totalCost,
        costPerPair,
        placedStoreId: placeId || null,
        itemId,
        completedDate: todayStr(),
        completedAt: serverTimestamp(),
      });

      // Mark this order line as made; the order is Ready once every line is stock-backed or made.
      let allDone = false;
      if (order) {
        const lines = (order.lines || []).map((l, i) => (i === run.lineIndex ? { ...l, made: true, runId: run.id } : l));
        allDone = lines.every((l) => l.source === 'stock' || l.made);
        const patch = { lines, updatedAt: serverTimestamp() };
        if (allDone && order.workStatus !== 'delivered') patch.workStatus = 'ready';
        b.update(doc(db, 'opsOrders', order.id), patch);
      }

      await b.commit();
      onClose();

      const placeName = stores.find((s) => s.id === placeId)?.name;
      const owes = order ? num(order.totalPrice) - num(order.paid) : 0;
      const actions = [];
      if (order && owes > 0) actions.push({ label: `Record payment from ${order.clientName}`, primary: true, onClick: () => ctx.goOrder(order.id, 'pay') });
      if (!placeId) actions.push({ label: 'Place these in a store', primary: !actions.length, onClick: () => ctx.goPlace(run.id) });
      if (placeId && roleOf(placeId) !== 'factory') actions.push({ label: `See them in ${placeName}`, primary: !actions.length, onClick: () => ctx.goStock(placeId) });
      setFollowUp({
        title: `${madeTotal} pairs made`,
        message: `Cost is ${money(costPerPair)} per pair (${money(totalCost)} in total)${rejects ? `, ${rejects} rejected` : ''}.${placeName ? ` They're now in ${placeName}${order && allDone ? ` and ${order.orderNo} is marked Ready` : ''}.` : ' They are not in a store yet.'}`,
        question: actions.length ? 'What next?' : undefined,
        actions,
      });
    } catch (err) {
      notify({ type: 'error', message: err?.message || 'Could not finish the run.' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell onClose={onClose} size="wide">
      <ModalHeader icon={Factory} title={`Finish ${run.runNo}`} subtitle={`${run.totalPairs} pairs of ${run.productName}`} onClose={onClose} />
      <form onSubmit={submit} className="space-y-5">
        <div>
          <SectionLabel hint="Change a number if you used more or less">Materials actually used</SectionLabel>
          <div className="space-y-2.5">
            {rows.map((r) => (
              <div key={r.materialId} className={`rounded-2xl border p-3.5 ${r.short ? 'border-[#F5D3CE] bg-[#FBEAE8]/50' : 'border-[#EAF0F9] bg-[#F7FAFD]'}`}>
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-sm font-semibold" style={{ color: INK }}>{r.name}</p>
                  <p className="shrink-0 text-xs text-[#8CA0BC]">Expected {qtyFmt(r.qty)} {r.unit}</p>
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <input type="number" min="0" step="any" inputMode="decimal" value={actuals[r.materialId] ?? String(r.qty)} onChange={(e) => setActuals((a) => ({ ...a, [r.materialId]: e.target.value }))} className="w-28 rounded-full border-2 border-[#E1E8F4] bg-white px-3 py-1.5 text-[15px] font-semibold outline-none focus:border-[#2B6CDA]" style={{ color: INK }} />
                  <span className="text-sm text-[#8CA0BC]">{r.unit}</span>
                  {Math.abs(r.diff) > 1e-9 && <span className={`text-xs font-semibold ${r.diff > 0 ? 'text-[#C0433A]' : 'text-[#168A63]'}`}>{r.diff > 0 ? '+' : ''}{qtyFmt(r.diff)}</span>}
                </div>
                {r.short && <p className="mt-1.5 text-xs font-semibold text-[#C0433A]">Only {qtyFmt(r.mat?.quantity)} {r.unit} in stock — restock first.</p>}
                {Math.abs(r.diff) > 1e-9 && (
                  <div className="mt-3 space-y-2.5 border-t border-dashed border-[#DCE6F4] pt-3">
                    <SuggestInput id={`why-${r.materialId}`} label={r.diff > 0 ? 'Why did it take more?' : 'Why less than expected?'} value={reasons[r.materialId] || ''} onChange={(v) => setReasons((x) => ({ ...x, [r.materialId]: v }))} options={lists.reasons || []} placeholder="Offcuts, defects, mistakes…" compact />
                    <ChoiceRow cols="grid-cols-2" value={modes[r.materialId] || 'run'} onChange={(v) => setModes((m) => ({ ...m, [r.materialId]: v }))} options={[{ id: 'run', label: 'Just this run' }, { id: 'norm', label: 'Use as new standard' }]} />
                    {modes[r.materialId] === 'norm' && <p className="text-xs text-[#5C7196]">New standard: {qtyFmt(r.actual / run.totalPairs)} {r.unit} per pair.</p>}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        <div>
          <SectionLabel hint="Lower it if some pairs were rejected">Good pairs made per size</SectionLabel>
          <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
            {sizeKeys.map((k) => (
              <div key={k} className="rounded-xl border border-[#E1E8F4] bg-white px-2 py-1.5 text-center">
                <p className="text-[11px] font-semibold text-[#8CA0BC]">Size {k} <span className="font-normal">/{run.sizes[k]}</span></p>
                <input type="number" min="0" max={run.sizes[k]} inputMode="numeric" value={made[k]} onChange={(e) => setMade((m) => ({ ...m, [k]: e.target.value }))} className="w-full bg-transparent text-center text-[15px] font-semibold outline-none" style={{ color: INK }} />
              </div>
            ))}
          </div>
          <p className="mt-2 text-sm font-semibold text-[#2B6CDA]">{madeTotal} good{rejects > 0 ? ` · ${rejects} rejected` : ''}</p>
        </div>

        <div>
          <SectionLabel hint="Wages, power, glue labour — anything else this run cost">Other production costs</SectionLabel>
          {costs.length > 0 && (
            <div className="mb-2.5 space-y-2">
              {costs.map((c) => (
                <div key={c.id} className="flex items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <Field id={`cn-${c.id}`} compact value={c.name} onChange={(e) => setCost(c.id, { name: e.target.value })} placeholder="What was it for?" />
                  </div>
                  <div className="w-32 shrink-0">
                    <Field id={`ca-${c.id}`} compact type="number" min="0" step="any" inputMode="decimal" suffix="KSh" value={c.amount} onChange={(e) => setCost(c.id, { amount: e.target.value })} placeholder="0" />
                  </div>
                  <button type="button" onClick={() => setCosts((x) => x.filter((y) => y.id !== c.id))} className="shrink-0 rounded-full p-1.5 text-[#8CA0BC] hover:bg-[#FBEAE8] hover:text-[#C0433A]" aria-label="Remove cost">
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-1.5">
            {costChips.map((n) => (
              <button key={n} type="button" onClick={() => addCost(n)} className="rounded-full border border-[#E1E8F4] px-2.5 py-1 text-xs font-medium text-[#5C7196] hover:border-[#2B6CDA] hover:text-[#2B6CDA]">
                + {n}
                {costDefaults[slugify(n)] ? ` · ${money(costDefaults[slugify(n)].amount)}` : ''}
              </button>
            ))}
            <button type="button" onClick={() => addCost()} className="flex items-center gap-1 text-sm font-semibold text-[#2B6CDA]">
              <Plus size={13} /> Add another cost
            </button>
          </div>
          {incompleteCost && <p className="mt-2 text-xs font-medium text-[#C0433A]">Each cost needs a name and an amount.</p>}
        </div>

        <div>
          <SectionLabel>Where do the shoes go?</SectionLabel>
          <PlaceChips stores={stores} roleOf={roleOf} value={placeId} onChange={setPlaceId} allowNone />
        </div>

        <div className="rounded-2xl bg-[#123A73] p-4 text-sm text-white">
          <div className="flex justify-between text-[#D9E7FB]"><span>Materials</span><span>{money(materialCost)}</span></div>
          {validCosts.map((c) => (
            <div key={c.name} className="mt-1 flex justify-between text-[#D9E7FB]"><span>{c.name}</span><span>{money(c.amount)}</span></div>
          ))}
          <div className="mt-2 flex justify-between border-t border-dashed border-white/20 pt-2 text-base font-semibold"><span>Cost per pair</span><span>{money(costPerPair)}</span></div>
        </div>

        {missingReason && <p className="-mt-2 text-xs font-medium text-[#C0433A]">Add a reason for each material you changed.</p>}
        <SubmitButton saving={saving} disabled={!canSave}>
          <CheckCircle2 size={15} /> Finish & record
        </SubmitButton>
      </form>
    </ModalShell>
  );
};

const PlaceRunModal = ({ run, ctx, onClose }) => {
  const { stores, products, notify, setFollowUp, roleOf } = ctx;
  const [placeId, setPlaceId] = useState(ctx.defaultPlace(run.orderId ? ctx.orders.find((o) => o.id === run.orderId) : null));
  const [saving, setSaving] = useState(false);
  const product = products.find((p) => p.id === run.productId);

  const submit = async () => {
    if (!placeId || !product) return;
    setSaving(true);
    try {
      const b = writeBatch(db);
      const itemId = await placeFinished(b, { destId: placeId, product, sizesMade: run.made || {}, costPerPair: num(run.costPerPair), label: run.runNo });
      b.update(doc(db, 'opsRuns', run.id), { placedStoreId: placeId, itemId });
      if (product.itemId !== itemId) b.update(doc(db, 'opsProducts', product.id), { itemId });
      await b.commit();
      onClose();
      setFollowUp({
        title: 'Shoes placed',
        message: `${run.madeTotal} pairs are now in ${stores.find((s) => s.id === placeId)?.name}.`,
        actions: roleOf(placeId) !== 'factory' ? [{ label: 'See them in stock', primary: true, onClick: () => ctx.goStock(placeId) }] : [],
      });
    } catch (err) {
      notify({ type: 'error', message: err?.message || 'Could not place the shoes.' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell onClose={onClose}>
      <ModalHeader icon={Warehouse} title="Place in a store" subtitle={`${run.madeTotal} pairs · ${money(run.costPerPair)} per pair`} onClose={onClose} />
      <PlaceChips stores={stores} roleOf={roleOf} value={placeId} onChange={setPlaceId} />
      <div className="mt-5">
        <SubmitButton type="button" saving={saving} disabled={!placeId} onClick={submit}>
          <Check size={15} /> Place shoes here
        </SubmitButton>
      </div>
    </ModalShell>
  );
};

const RunSheet = ({ run, ctx, onClose, onFinish, onPlace }) => {
  const { staff, materials, notify, stores } = ctx;
  const [busy, setBusy] = useState(false);
  const [cancelAsk, setCancelAsk] = useState(false);
  const matMap = useMemo(() => Object.fromEntries(materials.map((m) => [m.id, m])), [materials]);
  const inProgress = run.status === 'in_progress';
  const doneCount = (run.steps || []).filter((s) => s.done).length;

  const saveSteps = async (steps) => {
    try {
      await updateDoc(doc(db, 'opsRuns', run.id), { steps, updatedAt: serverTimestamp() });
    } catch (err) {
      notify({ type: 'error', message: err?.message || 'Could not save step.' });
    }
  };
  const toggle = (i) => saveSteps(run.steps.map((s, idx) => (idx === i ? { ...s, done: !s.done } : s)));
  const assign = (i, staffId) => {
    const person = staff.find((s) => s.id === staffId);
    saveSteps(run.steps.map((s, idx) => (idx === i ? { ...s, doneById: staffId, doneBy: person?.fullName || '' } : s)));
  };

  const cancelRun = async () => {
    setBusy(true);
    try {
      await updateDoc(doc(db, 'opsRuns', run.id), { status: 'cancelled', updatedAt: serverTimestamp() });
      setCancelAsk(false);
      onClose();
      notify({ type: 'success', message: `${run.runNo} cancelled. No stock was touched.` });
    } catch (err) {
      notify({ type: 'error', message: err?.message || 'Could not cancel.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModalShell onClose={onClose} size="wide">
      <ModalHeader icon={Hammer} title={run.productName} subtitle={`${run.runNo} · ${run.totalPairs} pairs`} onClose={onClose} />
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={run.status === 'completed' ? 'green' : run.status === 'cancelled' ? 'gray' : 'blue'}>{run.status === 'completed' ? 'Completed' : run.status === 'cancelled' ? 'Cancelled' : 'In progress'}</Badge>
        <Badge tone="gray">{run.purpose === 'order' ? `For ${run.clientName} · ${run.orderNo}` : 'For the warehouse'}</Badge>
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {Object.entries(run.sizes || {}).sort((a, b) => sizeSort(a[0], b[0])).map(([k, v]) => (
          <span key={k} className="rounded-lg border border-[#E1E8F4] bg-[#F7FAFD] px-2 py-1 text-xs font-semibold text-[#2B6CDA]">{k} × {v}</span>
        ))}
      </div>

      {(run.steps || []).length > 0 && (
        <div className="mt-5">
          <SectionLabel hint={`${doneCount}/${run.steps.length} done`}>Steps</SectionLabel>
          <div className="space-y-2">
            {run.steps.map((s, i) => (
              <div key={s.name} className="flex items-center gap-3 rounded-2xl border border-[#EAF0F9] bg-[#F7FAFD] px-3.5 py-2.5">
                <button type="button" disabled={!inProgress} onClick={() => toggle(i)} className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 transition-colors ${s.done ? 'border-[#1FA97A] bg-[#1FA97A] text-white' : 'border-[#CBDBF3] bg-white text-transparent'}`} aria-label={`Mark ${s.name} done`}>
                  <Check size={14} />
                </button>
                <span className={`min-w-0 flex-1 truncate text-sm font-semibold ${s.done ? 'text-[#8CA0BC] line-through' : ''}`} style={s.done ? undefined : { color: INK }}>{s.name}</span>
                {inProgress ? (
                  <select value={s.doneById || ''} onChange={(e) => assign(i, e.target.value)} className="max-w-[9rem] rounded-full border border-[#E1E8F4] bg-white px-2.5 py-1.5 text-xs outline-none" style={{ color: INK }}>
                    <option value="">Who?</option>
                    {staff.map((p) => <option key={p.id} value={p.id}>{p.fullName}</option>)}
                  </select>
                ) : (
                  s.doneBy && <span className="text-xs text-[#8CA0BC]">{s.doneBy}</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {inProgress ? (
        <>
          <div className="mt-5">
            <SectionLabel>Materials expected</SectionLabel>
            <div className="space-y-1.5">
              {(run.expected || []).map((e) => {
                const have = num(matMap[e.materialId]?.quantity);
                return (
                  <div key={e.materialId} className="flex items-center justify-between rounded-xl border border-[#EAF0F9] bg-[#F7FAFD] px-3.5 py-2 text-sm">
                    <span className="font-medium" style={{ color: INK }}>{e.name}</span>
                    <span className={`font-semibold ${have < e.qty ? 'text-[#C0433A]' : 'text-[#2B6CDA]'}`}>{qtyFmt(e.qty)} {e.unit}{have < e.qty ? ' · short' : ''}</span>
                  </div>
                );
              })}
            </div>
          </div>
          <div className="mt-5 space-y-2.5">
            <SubmitButton type="button" onClick={onFinish}>
              <Factory size={15} /> Finish run
            </SubmitButton>
            <button type="button" onClick={() => setCancelAsk(true)} className="w-full py-2 text-sm font-semibold text-[#C0433A]">Cancel this run</button>
          </div>
        </>
      ) : run.status === 'completed' ? (
        <>
          <div className="mt-5 grid grid-cols-3 gap-3">
            <StatBox label="Pairs made" value={run.madeTotal} />
            <StatBox label="Rejected" value={num(run.rejectPairs)} tone={num(run.rejectPairs) > 0 ? 'red' : undefined} />
            <StatBox label="Cost / pair" value={money(run.costPerPair)} tone="green" />
          </div>
          <div className="mt-3 space-y-1 rounded-2xl border border-[#EAF0F9] bg-[#F7FAFD] px-4 py-3 text-sm text-[#5C7196]">
            <div className="flex justify-between"><span>Materials</span><span>{money(run.materialCost)}</span></div>
            {run.costs ? (
              run.costs.map((c) => <div key={c.name} className="flex justify-between"><span>{c.name}</span><span>{money(c.amount)}</span></div>)
            ) : (
              <>
                <div className="flex justify-between"><span>Wages</span><span>{money(run.wages)}</span></div>
                <div className="flex justify-between"><span>Other costs</span><span>{money(run.otherCost)}</span></div>
              </>
            )}
            <div className="flex justify-between border-t border-dashed border-[#DCE6F4] pt-1 font-semibold" style={{ color: INK }}><span>Total</span><span>{money(run.totalCost)}</span></div>
          </div>
          {(run.actual || []).some((a) => Math.abs(a.actual - a.expected) > 1e-9) && (
            <div className="mt-3 space-y-1.5">
              <SectionLabel>Differences from the recipe</SectionLabel>
              {run.actual.filter((a) => Math.abs(a.actual - a.expected) > 1e-9).map((a) => (
                <div key={a.materialId} className="rounded-xl border border-[#EAF0F9] bg-[#F7FAFD] px-3.5 py-2 text-sm">
                  <div className="flex justify-between"><span className="font-medium" style={{ color: INK }}>{a.name}</span><span className={`font-semibold ${a.actual > a.expected ? 'text-[#C0433A]' : 'text-[#168A63]'}`}>{qtyFmt(a.expected)} → {qtyFmt(a.actual)} {a.unit}</span></div>
                  <p className="text-xs text-[#8CA0BC]">{a.reason}{a.newStandard ? ' · set as new standard' : ''}</p>
                </div>
              ))}
            </div>
          )}
          <p className="mt-3 text-sm text-[#5C7196]">{run.placedStoreId ? `Stored in ${stores.find((s) => s.id === run.placedStoreId)?.name || 'a store'}.` : 'Not placed in a store yet.'}</p>
          {!run.placedStoreId && <div className="mt-3"><SubmitButton type="button" onClick={onPlace}><Warehouse size={15} /> Place in a store</SubmitButton></div>}
        </>
      ) : null}

      <AnimatePresence>
        {cancelAsk && <ConfirmDialog title="Cancel this run?" body="No materials are deducted and nothing is stored. The order (if any) stays as it was." confirmLabel="Cancel run" saving={busy} onCancel={() => setCancelAsk(false)} onConfirm={cancelRun} />}
      </AnimatePresence>
    </ModalShell>
  );
};

const MakeView = ({ ctx }) => {
  const { products, runs, materials, intent, clearIntent, loading } = ctx;
  const [tab, setTab] = useState('runs');
  const [productModal, setProductModal] = useState(undefined); // undefined closed | null add | object edit
  const [productName, setProductName] = useState('');
  const [startOpen, setStartOpen] = useState(false);
  const [preset, setPreset] = useState(null);
  const [runId, setRunId] = useState(null);
  const [finishId, setFinishId] = useState(null);
  const [placeId, setPlaceId] = useState(null);

  useEffect(() => {
    if (intent?.type === 'startRun') {
      setPreset(intent);
      setStartOpen(true);
      clearIntent();
    }
    if (intent?.type === 'place') {
      setPlaceId(intent.runId);
      clearIntent();
    }
  }, [intent]); // eslint-disable-line react-hooks/exhaustive-deps

  const matMap = useMemo(() => Object.fromEntries(materials.map((m) => [m.id, m])), [materials]);
  const sortedRuns = useMemo(() => [...runs].sort(byNewest), [runs]);
  const findRun = (id) => runs.find((r) => r.id === id);

  return (
    <div>
      <PageTop title="Make shoes" subtitle="Products, recipes and production runs" onAdd={tab === 'runs' ? () => { setPreset(null); setStartOpen(true); } : () => { setProductName(''); setProductModal(null); }} addLabel={tab === 'runs' ? 'Start production' : 'Add product'} />
      <TabBar tabs={[{ id: 'runs', label: 'Production runs' }, { id: 'products', label: 'Products' }]} value={tab} onChange={setTab} />

      {loading ? (
        <Spinner />
      ) : tab === 'runs' ? (
        sortedRuns.filter((r) => r.status !== 'cancelled').length === 0 ? (
          <EmptyState icon={Hammer} title="No production yet" body="Start a run for a client's order or to stock the warehouse. Pick a product, enter pairs per size, and the materials are worked out for you." actionLabel="Start production" onAction={() => setStartOpen(true)} />
        ) : (
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {sortedRuns.filter((r) => r.status !== 'cancelled').map((r) => {
              const done = (r.steps || []).filter((s) => s.done).length;
              return (
                <RowCard
                  key={r.id}
                  icon={Hammer}
                  title={r.productName}
                  subtitle={`${r.runNo} · ${r.purpose === 'order' ? r.clientName : 'Warehouse'}${r.status === 'completed' ? ` · ${money(r.costPerPair)}/pair` : r.steps?.length ? ` · ${done}/${r.steps.length} steps` : ''}`}
                  onClick={() => setRunId(r.id)}
                  right={
                    <div className="space-y-1">
                      <p className="text-sm font-semibold" style={{ color: INK }}>{r.status === 'completed' ? r.madeTotal : r.totalPairs} pairs</p>
                      <Badge tone={r.status === 'completed' ? 'green' : 'blue'}>{r.status === 'completed' ? 'Done' : 'Making'}</Badge>
                    </div>
                  }
                />
              );
            })}
          </div>
        )
      ) : products.length === 0 ? (
        <EmptyState icon={Footprints} title="No products yet" body="A product is a recipe: name, size range, materials per pair and steps. Add one and it's reusable for every order and run." actionLabel="Add product" onAction={() => setProductModal(null)} />
      ) : (
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {[...products].sort((a, b) => a.name.localeCompare(b.name)).map((p) => {
            const est = (p.materials || []).reduce((s, m) => s + num(m.perPair) * num(matMap[m.materialId]?.avgCost), 0);
            return (
              <RowCard
                key={p.id}
                icon={Footprints}
                title={p.name}
                subtitle={`Sizes ${p.sizeFrom}–${p.sizeTo} · ${(p.materials || []).length} materials · ${(p.steps || []).length} steps`}
                onClick={() => setProductModal(p)}
                right={est > 0 ? <p className="text-xs font-semibold text-[#5C7196]">≈ {money(est)}<span className="block font-normal text-[#8CA0BC]">materials/pair</span></p> : null}
              />
            );
          })}
        </div>
      )}

      <AnimatePresence>{productModal !== undefined && <ProductModal product={productModal} defaultName={productName} ctx={ctx} onClose={() => setProductModal(undefined)} />}</AnimatePresence>
      <AnimatePresence>
        {startOpen && (
          <StartRunModal
            preset={preset}
            ctx={ctx}
            onClose={() => setStartOpen(false)}
            onNeedProduct={(n) => { setProductName(typeof n === 'string' ? n : ''); setProductModal(null); }}
            onStarted={(id) => setRunId(id)}
          />
        )}
      </AnimatePresence>
      <AnimatePresence>{runId && findRun(runId) && <RunSheet run={findRun(runId)} ctx={ctx} onClose={() => setRunId(null)} onFinish={() => setFinishId(runId)} onPlace={() => setPlaceId(runId)} />}</AnimatePresence>
      <AnimatePresence>{finishId && findRun(finishId) && <FinishRunModal run={findRun(finishId)} ctx={ctx} onClose={() => setFinishId(null)} />}</AnimatePresence>
      <AnimatePresence>{placeId && findRun(placeId) && <PlaceRunModal run={findRun(placeId)} ctx={ctx} onClose={() => setPlaceId(null)} />}</AnimatePresence>
    </div>
  );
};

/* ==================================================================== */
/*  ORDERS (clients are simply the names on orders)                      */
/*                                                                       */
/*  Each line is either TAKEN FROM STOCK (pairs are deducted from the    */
/*  chosen place in a transaction when the order is saved) or MADE (a    */
/*  production run is started for it). One order can mix both.           */
/* ==================================================================== */

const RecordPaymentModal = ({ order, ctx, onClose }) => {
  const { notify, setFollowUp } = ctx;
  const balance = num(order.totalPrice) - num(order.paid);
  const [amount, setAmount] = useState(String(balance));
  const [method, setMethod] = useState('cash');
  const [date, setDate] = useState(todayStr());
  const [saving, setSaving] = useState(false);
  const amt = num(amount);
  const canSave = amt > 0 && amt <= balance + 0.001;

  const submit = async (e) => {
    e.preventDefault();
    if (!canSave) return;
    setSaving(true);
    try {
      const ref = doc(db, 'opsOrders', order.id);
      await runTransaction(db, async (tx) => {
        const snap = await tx.get(ref);
        const o = snap.data();
        const left = num(o.totalPrice) - num(o.paid);
        if (amt > left + 0.001) throw new Error(`Only ${money(left)} is still owed on this order.`);
        tx.update(ref, { payments: [...(o.payments || []), { amount: amt, method, date }], paid: num(o.paid) + amt, updatedAt: serverTimestamp() });
      });
      onClose();
      const left = balance - amt;
      setFollowUp({
        title: left <= 0.001 ? 'Paid in full' : 'Payment recorded',
        message: left <= 0.001 ? `${order.clientName} has now cleared ${order.orderNo}.` : `${money(amt)} received from ${order.clientName}. ${money(left)} still owed.`,
        actions: [],
      });
    } catch (err) {
      notify({ type: 'error', message: err?.message || 'Could not record payment.' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell onClose={onClose}>
      <ModalHeader icon={Banknote} title="Record payment" subtitle={`${order.clientName} · ${order.orderNo}`} onClose={onClose} />
      <form onSubmit={submit} className="space-y-4">
        <div className="rounded-2xl bg-[#F7FAFD] px-4 py-3 text-sm text-[#5C7196]">Still owed: <span className="font-semibold" style={{ color: INK }}>{money(balance)}</span></div>
        <Field id="pay-amt" label="Amount received" type="number" min="0" step="any" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} suffix="KSh" />
        <ChoiceRow value={method} onChange={setMethod} options={PAY_METHODS.map((m) => ({ id: m.id, label: m.label, icon: m.icon }))} />
        <Field id="pay-date" label="Date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        <SubmitButton saving={saving} disabled={!canSave}>
          <Check size={15} /> Save payment
        </SubmitButton>
      </form>
    </ModalShell>
  );
};

// Shows what is in stock for the typed product at the chosen place and
// lets you pick pairs per size. Looks the shared catalog item up by name.
const StockLinePicker = ({ line, ctx, onChange }) => {
  const { stores, roleOf } = ctx;
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const name = line.product.trim();
    if (!name || !line.placeId) {
      onChange({ avail: null, sizes: {} });
      return undefined;
    }
    let cancelled = false;
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const item = await findItemByName(name);
        if (!item) {
          if (!cancelled) onChange({ avail: { itemId: null, rows: {} }, sizes: {} });
          return;
        }
        const snap = await getDocs(query(collection(db, 'stock'), where('storeId', '==', line.placeId), where('itemId', '==', item.id)));
        const rows = Object.fromEntries(snap.docs.map((d) => [d.data().variant, { quantity: num(d.data().quantity), avgCost: num(d.data().avgCost) }]));
        if (!cancelled) onChange({ avail: { itemId: item.id, rows }, sizes: {} });
      } catch (err) {
        console.error('stock lookup error:', err);
        if (!cancelled) onChange({ avail: { itemId: null, rows: {} }, sizes: {} });
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [line.product, line.placeId]); // eslint-disable-line react-hooks/exhaustive-deps

  const placeName = stores.find((s) => s.id === line.placeId)?.name || 'this place';
  const sizes = line.avail ? Object.entries(line.avail.rows).filter(([, r]) => r.quantity > 0).sort((a, b) => sizeSort(a[0], b[0])) : [];

  return (
    <div className="mt-2.5 space-y-2.5">
      <div>
        <p className="mb-1.5 text-xs font-medium text-[#8CA0BC]">Take from</p>
        <div className="flex flex-wrap gap-1.5">
          {stores.map((s) => (
            <Chip key={s.id} active={line.placeId === s.id} onClick={() => onChange({ placeId: s.id })}>
              {s.name} · {ROLE_LABEL[roleOf(s.id)]}
            </Chip>
          ))}
        </div>
      </div>
      {!line.product.trim() ? (
        <p className="text-xs text-[#8CA0BC]">Type or pick a product to see what is in stock.</p>
      ) : loading || !line.avail ? (
        <p className="flex items-center gap-1.5 text-xs text-[#8CA0BC]"><Loader2 size={12} className="animate-spin" /> Checking {placeName}…</p>
      ) : sizes.length === 0 ? (
        <p className="rounded-xl bg-[#FBF0DA] px-3 py-2 text-xs font-medium text-[#8A611E]">No "{line.product.trim()}" in stock at {placeName}. Pick another place, or switch this line to Make.</p>
      ) : (
        <div>
          <p className="mb-1.5 text-xs font-medium text-[#8CA0BC]">Pairs per size — in stock at {placeName}</p>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
            {sizes.map(([size, r]) => {
              const v = line.sizes[size] ?? '';
              const over = num(v) > r.quantity;
              return (
                <div key={size} className={`rounded-xl border bg-white px-2 py-1.5 text-center ${over ? 'border-[#F5D3CE]' : 'border-[#E1E8F4]'}`}>
                  <p className="text-[11px] font-semibold text-[#8CA0BC]">Size {size} <span className="font-normal">/{r.quantity}</span></p>
                  <input
                    type="number"
                    min="0"
                    max={r.quantity}
                    inputMode="numeric"
                    value={v}
                    onChange={(e) => onChange({ sizes: { ...line.sizes, [size]: e.target.value } })}
                    placeholder="0"
                    className="w-full bg-transparent text-center text-[15px] font-semibold outline-none"
                    style={{ color: over ? '#C0433A' : INK }}
                  />
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

const linePairs = (l) => (l.mode === 'stock' ? Object.values(l.sizes || {}).reduce((s, v) => s + num(v), 0) : num(l.pairs));
const lineOk = (l) =>
  l.product.trim() &&
  l.price !== '' &&
  linePairs(l) > 0 &&
  (l.mode !== 'stock' || (l.avail?.itemId && Object.entries(l.sizes).every(([s, q]) => num(q) <= num(l.avail.rows[s]?.quantity))));

const OrderModal = ({ ctx, onClose }) => {
  const { storeId, orders, products, notify, setFollowUp, roleOf, stores } = ctx;
  const startMode = roleOf(storeId) === 'factory' ? 'make' : 'stock';
  const defaultStockPlace = roleOf(storeId) !== 'factory' ? storeId : stores.find((s) => roleOf(s.id) === 'warehouse')?.id || storeId;
  const blankLine = () => ({ id: `l${Date.now()}${Math.random().toString(36).slice(2, 5)}`, product: '', mode: startMode, from: '', to: '', pairs: '', price: '', placeId: defaultStockPlace, avail: null, sizes: {} });

  const [client, setClient] = useState('');
  const [phone, setPhone] = useState('');
  const [lines, setLines] = useState([blankLine()]);
  const [dueDate, setDueDate] = useState('');
  const [deposit, setDeposit] = useState('');
  const [method, setMethod] = useState('cash');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const clientNames = useMemo(() => dedupeSorted(orders.map((o) => o.clientName)), [orders]);
  const setLine = useCallback((id, patch) => setLines((ls) => ls.map((l) => (l.id === id ? { ...l, ...patch } : l))), []);
  const pickProduct = (id, name) => {
    const p = products.find((x) => lower(x.name) === lower(name));
    setLine(id, { product: name, ...(p ? { from: String(p.sizeFrom), to: String(p.sizeTo), price: p.sellingPrice ? String(p.sellingPrice) : '' } : {}) });
  };
  const onClient = (v) => {
    setClient(v);
    const prev = orders.find((o) => lower(o.clientName) === lower(v) && o.clientPhone);
    if (prev && !phone) setPhone(prev.clientPhone);
  };

  const valid = lines.filter(lineOk);
  const total = valid.reduce((s, l) => s + linePairs(l) * num(l.price), 0);
  const canSave = client.trim() && valid.length > 0 && valid.length === lines.filter((l) => l.product.trim()).length && num(deposit) <= total;

  const submit = async (e) => {
    e.preventDefault();
    if (!canSave) return;
    setSaving(true);
    try {
      const orderNo = await nextNumber(`ops_orders_${new Date().getFullYear()}`, `ORD-${new Date().getFullYear()}-`);
      const ref = doc(collection(db, 'opsOrders'));
      const dep = num(deposit);
      const date = todayStr();

      // Everything that touches stock happens in ONE transaction, so two
      // devices can never take the same pairs.
      const finalLines = await runTransaction(db, async (tx) => {
        const reads = [];
        valid.forEach((l, li) => {
          if (l.mode !== 'stock') return;
          Object.entries(l.sizes)
            .filter(([, q]) => num(q) > 0)
            .forEach(([size, q]) => reads.push({ li, size, qty: num(q), ref: doc(db, 'stock', stockKey(l.placeId, l.avail.itemId, size)) }));
        });
        const snaps = await Promise.all(reads.map((r) => tx.get(r.ref)));
        const cost = {};
        snaps.forEach((s, i) => {
          const r = reads[i];
          const have = s.exists() ? num(s.data().quantity) : 0;
          if (have < r.qty) throw new Error(`Only ${have} pair(s) of size ${r.size} left for ${valid[r.li].product.trim()} — someone may have just taken them.`);
          cost[r.li] = (cost[r.li] || 0) + r.qty * num(s.data().avgCost);
        });
        reads.forEach((r) => tx.update(r.ref, { quantity: increment(-r.qty), updatedAt: serverTimestamp() }));

        const out = valid.map((l, li) => {
          const base = { productName: l.product.trim(), productId: products.find((p) => lower(p.name) === lower(l.product))?.id || null, unitPrice: num(l.price) };
          if (l.mode === 'stock') {
            const sizes = Object.fromEntries(Object.entries(l.sizes).filter(([, q]) => num(q) > 0).map(([s, q]) => [s, num(q)]));
            const pairs = linePairs(l);
            tx.set(doc(collection(db, 'activityLog')), {
              storeId: l.placeId,
              itemId: l.avail.itemId,
              type: 'sold',
              date,
              detail: `${orderNo} · ${client.trim()}`,
              lineSummary: Object.entries(sizes).sort((a, b) => sizeSort(a[0], b[0])).map(([s, q]) => `${s}: -${q}`).join(', '),
              createdAt: serverTimestamp(),
            });
            return { ...base, source: 'stock', stockPlaceId: l.placeId, itemId: l.avail.itemId, sizes, pairs, costPerPair: pairs ? (cost[li] || 0) / pairs : 0 };
          }
          return { ...base, source: 'make', made: false, sizeFrom: l.from ? parseInt(l.from, 10) : null, sizeTo: l.to ? parseInt(l.to, 10) : null, pairs: num(l.pairs) };
        });

        tx.set(ref, {
          storeId,
          orderNo,
          clientName: client.trim(),
          clientPhone: phone.trim(),
          lines: out,
          totalPairs: out.reduce((s, l) => s + l.pairs, 0),
          totalPrice: total,
          paid: dep,
          payments: dep > 0 ? [{ amount: dep, method, date }] : [],
          workStatus: out.every((l) => l.source === 'stock') ? 'ready' : 'waiting',
          dueDate,
          notes: notes.trim(),
          createdAt: serverTimestamp(),
        });
        return out;
      });

      onClose();
      const makeIdx = finalLines.findIndex((l) => l.source === 'make');
      const fromStock = finalLines.filter((l) => l.source === 'stock').reduce((s, l) => s + l.pairs, 0);
      setFollowUp({
        title: `${orderNo} saved`,
        message: `${client.trim()} · ${finalLines.reduce((s, l) => s + l.pairs, 0)} pairs · ${money(total)}${dep > 0 ? ` (${money(dep)} paid)` : ''}.${fromStock ? ` ${fromStock} pair(s) were taken from stock.` : ''}${makeIdx === -1 ? ' Everything is ready to hand over.' : ''}`,
        question: makeIdx !== -1 ? 'Start making the rest now?' : undefined,
        actions: makeIdx !== -1 ? [{ label: 'Make them', primary: true, onClick: () => ctx.goMake({ orderId: ref.id, lineIndex: makeIdx }) }] : [],
      });
    } catch (err) {
      notify({ type: 'error', message: err?.message || 'Could not save order.' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell onClose={onClose} size="wide">
      <ModalHeader icon={ClipboardList} title="New order" subtitle="Who ordered what, and where the shoes come from" onClose={onClose} />
      <form onSubmit={submit} className="space-y-5">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <SuggestInput id="od-client" label="Client" icon={User} value={client} onChange={onClient} options={clientNames} placeholder="Pick or type a name" />
          <Field id="od-phone" label="Phone (optional)" icon={Phone} type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="07xx xxx xxx" />
        </div>

        <div>
          <SectionLabel hint="Take from stock, or make them">What they want</SectionLabel>
          <div className="space-y-3">
            {lines.map((l, i) => (
              <div key={l.id} className="rounded-2xl border border-[#E1E8F4] bg-[#FBFCFE] p-3.5">
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <SuggestInput id={`ol-${l.id}`} value={l.product} onChange={(v) => pickProduct(l.id, v)} options={products.map((p) => p.name)} placeholder="e.g. Girls buckle school shoe" compact />
                  </div>
                  {lines.length > 1 && <button type="button" onClick={() => setLines((ls) => ls.filter((x) => x.id !== l.id))} className="mt-2 rounded-full p-1.5 text-[#8CA0BC] hover:bg-[#FBEAE8] hover:text-[#C0433A]" aria-label={`Remove item ${i + 1}`}><X size={14} /></button>}
                </div>
                <div className="mt-2.5">
                  <ChoiceRow cols="grid-cols-2" value={l.mode} onChange={(v) => setLine(l.id, { mode: v })} options={[{ id: 'stock', label: 'From stock', icon: Warehouse }, { id: 'make', label: 'Make them', icon: Hammer }]} />
                </div>
                {l.mode === 'stock' ? (
                  <>
                    <StockLinePicker line={l} ctx={ctx} onChange={(patch) => setLine(l.id, patch)} />
                    <div className="mt-2.5 grid grid-cols-2 gap-3">
                      <div className="rounded-2xl bg-[#F7FAFD] px-3 py-2 text-sm text-[#5C7196]">Pairs: <span className="font-semibold" style={{ color: INK }}>{linePairs(l)}</span></div>
                      <Field id={`opr-${l.id}`} label="Price / pair" type="number" min="0" inputMode="decimal" value={l.price} onChange={(e) => setLine(l.id, { price: e.target.value })} compact />
                    </div>
                  </>
                ) : (
                  <div className="mt-2.5 grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <Field id={`of-${l.id}`} label="Size from" type="number" min="1" inputMode="numeric" value={l.from} onChange={(e) => setLine(l.id, { from: e.target.value })} compact />
                    <Field id={`ot-${l.id}`} label="Size to" type="number" min="1" inputMode="numeric" value={l.to} onChange={(e) => setLine(l.id, { to: e.target.value })} compact />
                    <Field id={`op-${l.id}`} label="Pairs" type="number" min="1" inputMode="numeric" value={l.pairs} onChange={(e) => setLine(l.id, { pairs: e.target.value })} compact />
                    <Field id={`opr-${l.id}`} label="Price / pair" type="number" min="0" inputMode="decimal" value={l.price} onChange={(e) => setLine(l.id, { price: e.target.value })} compact />
                  </div>
                )}
              </div>
            ))}
          </div>
          <button type="button" onClick={() => setLines((ls) => [...ls, blankLine()])} className="mt-2.5 flex items-center gap-1.5 text-sm font-semibold text-[#2B6CDA]">
            <Plus size={14} /> Add another item
          </button>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field id="od-due" label="Due date" type="date" icon={CalendarDays} value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          <Field id="od-notes" label="Notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Anything to remember" />
        </div>

        <div>
          <SectionLabel hint={total > 0 ? `Total ${money(total)}` : undefined}>Paid upfront?</SectionLabel>
          <Field id="od-dep" type="number" min="0" step="any" inputMode="decimal" value={deposit} onChange={(e) => setDeposit(e.target.value)} suffix="KSh" placeholder="0 if nothing yet" />
          {num(deposit) > 0 && <div className="mt-2.5"><ChoiceRow value={method} onChange={setMethod} options={PAY_METHODS.map((m) => ({ id: m.id, label: m.label, icon: m.icon }))} /></div>}
          {num(deposit) > total && total > 0 && <p className="mt-1.5 text-xs font-medium text-[#C0433A]">That is more than the order total.</p>}
          {total > 0 && num(deposit) <= total && <p className="mt-2 text-sm font-medium text-[#5C7196]">Balance: <span className="font-semibold" style={{ color: INK }}>{money(total - num(deposit))}</span></p>}
        </div>

        <SubmitButton saving={saving} disabled={!canSave}>
          <Check size={15} /> Save order
        </SubmitButton>
      </form>
    </ModalShell>
  );
};

const OrderSheet = ({ order, ctx, onClose, onPay, initialPay }) => {
  const { notify, setFollowUp, stores } = ctx;
  const [busy, setBusy] = useState(false);
  const [cancelAsk, setCancelAsk] = useState(false);
  useEffect(() => {
    if (initialPay) onPay();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const cancelled = order.workStatus === 'cancelled';
  const balance = num(order.totalPrice) - num(order.paid);
  const [mTone, mLabel] = MONEY_BADGE[payStatus(num(order.paid), num(order.totalPrice))];
  const overdue = order.dueDate && order.dueDate < todayStr() && !['delivered', 'cancelled'].includes(order.workStatus);
  const firstMake = (order.lines || []).findIndex(lineNeedsMaking);
  const placeName = (id) => stores.find((s) => s.id === id)?.name || 'a store';

  const setStatus = async (status) => {
    if (status === order.workStatus) return;
    setBusy(true);
    try {
      await updateDoc(doc(db, 'opsOrders', order.id), { workStatus: status, updatedAt: serverTimestamp() });
      if (status === 'delivered' && balance > 0.001) {
        onClose();
        setFollowUp({ title: 'Marked delivered', message: `${order.clientName} still owes ${money(balance)} on ${order.orderNo}.`, question: 'Did they pay now?', actions: [{ label: 'Record payment', primary: true, onClick: () => ctx.goOrder(order.id, 'pay') }] });
      } else {
        notify({ type: 'success', message: `${order.orderNo} is now ${WORK_BADGE[status][1].toLowerCase()}.` });
      }
    } catch (err) {
      notify({ type: 'error', message: err?.message || 'Could not update.' });
    } finally {
      setBusy(false);
    }
  };

  // Puts pairs taken from stock back, then marks the order cancelled.
  const cancelOrder = async () => {
    setBusy(true);
    try {
      if (num(order.paid) > 0) throw new Error('This order has payments recorded. Refund the client first, then cancel — or keep the order and change its status.');
      const runs = await fetchWhere('opsRuns', where('orderId', '==', order.id));
      if (runs.some((r) => r.status === 'in_progress')) throw new Error('A production run for this order is still in progress. Cancel or finish that run first.');
      const ref = doc(db, 'opsOrders', order.id);
      await runTransaction(db, async (tx) => {
        const snap = await tx.get(ref);
        const o = snap.data();
        if (['delivered', 'cancelled'].includes(o.workStatus)) throw new Error(`This order is already ${o.workStatus}.`);
        (o.lines || []).filter((l) => l.source === 'stock').forEach((l) => {
          Object.entries(l.sizes || {}).forEach(([size, q]) => {
            tx.set(doc(db, 'stock', stockKey(l.stockPlaceId, l.itemId, size)), { storeId: l.stockPlaceId, itemId: l.itemId, variant: size, quantity: increment(num(q)), updatedAt: serverTimestamp() }, { merge: true });
          });
          tx.set(doc(collection(db, 'activityLog')), {
            storeId: l.stockPlaceId,
            itemId: l.itemId,
            type: 'returned',
            date: todayStr(),
            detail: `${o.orderNo} cancelled`,
            lineSummary: Object.entries(l.sizes || {}).map(([s, q]) => `${s}: +${q}`).join(', '),
            createdAt: serverTimestamp(),
          });
        });
        tx.update(ref, { workStatus: 'cancelled', updatedAt: serverTimestamp() });
      });
      setCancelAsk(false);
      onClose();
      setFollowUp({ title: `${order.orderNo} cancelled`, message: 'Any pairs taken from stock were put back. Pairs already made for this order stay in stock.', actions: [] });
    } catch (err) {
      notify({ type: 'error', message: err?.message || 'Could not cancel.' });
      setCancelAsk(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModalShell onClose={onClose} size="wide">
      <ModalHeader icon={ClipboardList} title={order.clientName} subtitle={`${order.orderNo}${order.clientPhone ? ` · ${order.clientPhone}` : ''}`} onClose={onClose} />
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={WORK_BADGE[order.workStatus][0]}>{WORK_BADGE[order.workStatus][1]}</Badge>
        {!cancelled && <Badge tone={mTone}>{mLabel}</Badge>}
        {order.dueDate && <Badge tone={overdue ? 'red' : 'gray'}><CalendarDays size={11} /> {overdue ? 'Overdue · ' : 'Due '}{formatDate(order.dueDate)}</Badge>}
      </div>

      <div className="mt-4 space-y-2">
        {(order.lines || []).map((l, i) => (
          <div key={i} className="rounded-xl border border-[#EAF0F9] bg-[#F7FAFD] px-3.5 py-2.5 text-sm">
            <div className="flex justify-between gap-2"><span className="font-semibold" style={{ color: INK }}>{l.productName}</span><span className="font-semibold" style={{ color: INK }}>{money(l.pairs * l.unitPrice)}</span></div>
            <p className="text-xs text-[#8CA0BC]">
              {l.pairs} pairs · {money(l.unitPrice)} each
              {l.source === 'stock' && ` · sizes ${Object.entries(l.sizes || {}).sort((a, b) => sizeSort(a[0], b[0])).map(([s, q]) => `${s}×${q}`).join(', ')}`}
              {l.source !== 'stock' && l.sizeFrom ? ` · sizes ${l.sizeFrom}–${l.sizeTo}` : ''}
            </p>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              {l.source === 'stock' ? <Badge tone="green"><Warehouse size={11} /> From stock · {placeName(l.stockPlaceId)}</Badge> : l.made ? <Badge tone="green"><Hammer size={11} /> Made</Badge> : <Badge tone="blue"><Hammer size={11} /> To make</Badge>}
              {l.source === 'stock' && num(l.costPerPair) > 0 && <span className="text-[11px] text-[#8CA0BC]">Profit {money(l.pairs * (l.unitPrice - l.costPerPair))}</span>}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-3 grid grid-cols-3 gap-3">
        <StatBox label="Total" value={money(order.totalPrice)} />
        <StatBox label="Paid" value={money(order.paid)} tone="green" />
        <StatBox label="Balance" value={money(balance)} tone={balance > 0.001 && !cancelled ? 'red' : undefined} />
      </div>

      {(order.payments || []).length > 0 && (
        <div className="mt-4">
          <SectionLabel>Payments</SectionLabel>
          <div className="space-y-1.5">
            {order.payments.map((p, i) => (
              <div key={i} className="flex items-center justify-between rounded-xl border border-[#EAF0F9] bg-[#F7FAFD] px-3.5 py-2 text-sm">
                <span className="text-[#5C7196]">{formatDate(p.date)} · {PAY_METHODS.find((m) => m.id === p.method)?.label || p.method}</span>
                <span className="font-semibold" style={{ color: INK }}>{money(p.amount)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {order.notes && <p className="mt-3 rounded-xl bg-[#F7FAFD] px-3.5 py-2.5 text-sm italic text-[#5C7196]">{order.notes}</p>}

      {!cancelled && (
        <>
          <div className="mt-5">
            <SectionLabel>Where is the work?</SectionLabel>
            <div className="grid grid-cols-4 gap-1.5">
              {WORK_FLOW.map((s) => (
                <button key={s} type="button" disabled={busy} onClick={() => setStatus(s)} className={`rounded-xl border-2 px-1 py-2.5 text-xs font-semibold leading-tight transition-colors ${order.workStatus === s ? 'border-[#2B6CDA] bg-[#EAF2FE] text-[#2B6CDA]' : 'border-[#E1E8F4] bg-white text-[#8CA0BC]'}`}>
                  {WORK_BADGE[s][1]}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-5 flex gap-2.5">
            {balance > 0.001 && <SoftButton icon={Banknote} onClick={onPay}>Record payment</SoftButton>}
            {['waiting', 'making'].includes(order.workStatus) && firstMake !== -1 && <SoftButton icon={Hammer} onClick={() => { onClose(); ctx.goMake({ orderId: order.id, lineIndex: firstMake }); }}>Make these</SoftButton>}
          </div>
          {order.workStatus !== 'delivered' && <button type="button" onClick={() => setCancelAsk(true)} className="mt-3 w-full py-2 text-sm font-semibold text-[#C0433A]">Cancel this order</button>}
        </>
      )}

      <AnimatePresence>
        {cancelAsk && <ConfirmDialog title="Cancel this order?" body="Pairs taken from stock go back on the shelf. Pairs already made for this order stay in stock. It is blocked if the client has paid anything or a run is still in progress." confirmLabel="Cancel order" saving={busy} onCancel={() => setCancelAsk(false)} onConfirm={cancelOrder} />}
      </AnimatePresence>
    </ModalShell>
  );
};

const OrdersView = ({ ctx }) => {
  const { orders, loading, intent, clearIntent, stores, storeId } = ctx;
  const [tab, setTab] = useState('orders');
  const [filter, setFilter] = useState('all');
  const [q, setQ] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [openId, setOpenId] = useState(null);
  const [initialPay, setInitialPay] = useState(false);
  const [payId, setPayId] = useState(null);
  const [clientKey, setClientKey] = useState(null);

  useEffect(() => {
    if (intent?.type === 'order') {
      setOpenId(intent.orderId);
      setInitialPay(intent.mode === 'pay');
      clearIntent();
    }
  }, [intent]); // eslint-disable-line react-hooks/exhaustive-deps

  const live = useMemo(() => orders.filter((o) => o.workStatus !== 'cancelled'), [orders]);
  const sorted = useMemo(() => [...orders].sort(byNewest), [orders]);
  const rows = sorted
    .filter((o) =>
      filter === 'all'
        ? true
        : filter === 'make'
        ? ['waiting', 'making'].includes(o.workStatus) && (o.lines || []).some(lineNeedsMaking)
        : filter === 'ready'
        ? o.workStatus === 'ready'
        : o.workStatus !== 'cancelled' && num(o.totalPrice) - num(o.paid) > 0.001
    )
    .filter((o) => !q || lower(o.clientName).includes(lower(q)) || lower(o.orderNo).includes(lower(q)));

  const clients = useMemo(() => {
    const map = {};
    live.forEach((o) => {
      const k = lower(o.clientName);
      const c = (map[k] = map[k] || { key: k, name: o.clientName, phone: '', orders: [], owed: 0, total: 0 });
      c.orders.push(o);
      c.owed += num(o.totalPrice) - num(o.paid);
      c.total += num(o.totalPrice);
      if (o.clientPhone && !c.phone) c.phone = o.clientPhone;
    });
    return Object.values(map).sort((a, b) => b.owed - a.owed || a.name.localeCompare(b.name));
  }, [live]);

  const openOrder = orders.find((o) => o.id === openId);
  const payOrder = orders.find((o) => o.id === payId);
  const client = clients.find((c) => c.key === clientKey);
  const owedTotal = clients.reduce((s, c) => s + Math.max(0, c.owed), 0);
  const placeName = (id) => stores.find((s) => s.id === id)?.name;

  return (
    <div>
      <PageTop title="Orders" subtitle={owedTotal > 0 ? `${money(owedTotal)} owed to you` : 'Everything clients have asked for'} onAdd={() => setAddOpen(true)} addLabel="New order" />
      <TabBar tabs={[{ id: 'orders', label: 'Orders' }, { id: 'clients', label: 'Clients & balances' }]} value={tab} onChange={setTab} />

      {loading ? (
        <Spinner />
      ) : tab === 'orders' ? (
        <>
          <div className="mt-4"><SearchBar value={q} onChange={setQ} placeholder="Search client or order number…" /></div>
          <div className="-mx-1 mt-3 flex gap-1.5 overflow-x-auto px-1 pb-1">
            <Chip active={filter === 'all'} onClick={() => setFilter('all')}>All</Chip>
            <Chip active={filter === 'make'} onClick={() => setFilter('make')}>To make</Chip>
            <Chip active={filter === 'ready'} onClick={() => setFilter('ready')}>Ready</Chip>
            <Chip active={filter === 'unpaid'} onClick={() => setFilter('unpaid')}>Owing</Chip>
          </div>
          {rows.length === 0 ? (
            <EmptyState icon={ClipboardList} title={orders.length === 0 ? 'No orders yet' : 'Nothing here'} body={orders.length === 0 ? 'Add a client order — who, what they want, whether it comes from stock or gets made, price and any deposit.' : 'No orders match this filter.'} actionLabel={orders.length === 0 ? 'New order' : undefined} onAction={() => setAddOpen(true)} />
          ) : (
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              {rows.map((o) => {
                const bal = num(o.totalPrice) - num(o.paid);
                const cancelled = o.workStatus === 'cancelled';
                const [mt, ml] = MONEY_BADGE[payStatus(num(o.paid), num(o.totalPrice))];
                const [wt, wl] = WORK_BADGE[o.workStatus];
                const overdue = o.dueDate && o.dueDate < todayStr() && !['delivered', 'cancelled'].includes(o.workStatus);
                return (
                  <RowCard
                    key={o.id}
                    icon={ClipboardList}
                    title={o.clientName}
                    subtitle={`${o.orderNo} · ${o.totalPairs} pairs${o.dueDate ? ` · due ${formatDate(o.dueDate)}` : ''}${o.storeId !== storeId && placeName(o.storeId) ? ` · ${placeName(o.storeId)}` : ''}`}
                    tone={overdue ? 'red' : undefined}
                    onClick={() => setOpenId(o.id)}
                    right={
                      <div className="space-y-1">
                        <p className="text-sm font-semibold" style={{ color: cancelled ? '#8CA0BC' : INK }}>{money(o.totalPrice)}</p>
                        <div className="flex justify-end gap-1"><Badge tone={wt}>{wl}</Badge>{!cancelled && <Badge tone={mt}>{ml}</Badge>}</div>
                        {bal > 0.001 && !cancelled && <p className="text-[11px] font-semibold text-[#C0433A]">Owes {money(bal)}</p>}
                      </div>
                    }
                  />
                );
              })}
            </div>
          )}
        </>
      ) : clients.length === 0 ? (
        <EmptyState icon={Users} title="No clients yet" body="Clients appear automatically from the orders you add." />
      ) : (
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {clients.map((c) => (
            <RowCard key={c.key} icon={User} title={c.name} subtitle={`${c.orders.length} order${c.orders.length !== 1 ? 's' : ''}${c.phone ? ` · ${c.phone}` : ''}`} tone={c.owed > 0.001 ? 'amber' : undefined} onClick={() => setClientKey(c.key)}
              right={c.owed > 0.001 ? <p className="text-sm font-semibold text-[#C0433A]">Owes {money(c.owed)}</p> : <Badge tone="green">Settled</Badge>} />
          ))}
        </div>
      )}

      <AnimatePresence>{addOpen && <OrderModal ctx={ctx} onClose={() => setAddOpen(false)} />}</AnimatePresence>
      <AnimatePresence>
        {openOrder && <OrderSheet order={openOrder} ctx={ctx} initialPay={initialPay} onClose={() => { setOpenId(null); setInitialPay(false); }} onPay={() => { setInitialPay(false); setPayId(openOrder.id); }} />}
      </AnimatePresence>
      <AnimatePresence>{payOrder && <RecordPaymentModal order={payOrder} ctx={ctx} onClose={() => setPayId(null)} />}</AnimatePresence>
      <AnimatePresence>
        {client && (
          <ModalShell onClose={() => setClientKey(null)}>
            <ModalHeader icon={User} title={client.name} subtitle={client.phone || `${client.orders.length} orders`} onClose={() => setClientKey(null)} />
            <div className="grid grid-cols-2 gap-3">
              <StatBox label="Ordered in total" value={money(client.total)} />
              <StatBox label="Still owes" value={money(Math.max(0, client.owed))} tone={client.owed > 0.001 ? 'red' : 'green'} />
            </div>
            <div className="mt-4 space-y-2">
              {[...client.orders].sort(byNewest).map((o) => {
                const bal = num(o.totalPrice) - num(o.paid);
                return (
                  <button key={o.id} type="button" onClick={() => { setClientKey(null); setOpenId(o.id); }} className="flex w-full items-center justify-between gap-3 rounded-2xl border border-[#EAF0F9] bg-[#F7FAFD] px-4 py-3 text-left">
                    <span className="min-w-0"><span className="block truncate text-sm font-semibold" style={{ color: INK }}>{o.orderNo} · {o.totalPairs} pairs</span><span className="block text-xs text-[#8CA0BC]">{WORK_BADGE[o.workStatus][1]} · {money(o.totalPrice)}</span></span>
                    <span className={`text-xs font-semibold ${bal > 0.001 ? 'text-[#C0433A]' : 'text-[#168A63]'}`}>{bal > 0.001 ? `Owes ${money(bal)}` : 'Paid'}</span>
                  </button>
                );
              })}
            </div>
          </ModalShell>
        )}
      </AnimatePresence>
    </div>
  );
};

/* ==================================================================== */
/*  STOCK — warehouse / retail places                                    */
/*  Reads the shared items / storeItems / stock collections that         */
/*  finished production runs write to.                                   */
/* ==================================================================== */

const attrText = (item) => (item.attributes || []).map((a) => `${a.key}: ${a.value}`).join(' · ');

const EditStockModal = ({ row, ctx, onClose }) => {
  const { storeId, lists, notify, patchItem } = ctx;
  const { item, storeItem } = row;
  const [price, setPrice] = useState(storeItem.sellingPrice ?? '');
  const [threshold, setThreshold] = useState(storeItem.lowStockThreshold || '');
  const [attributes, setAttributes] = useState(item.attributes || []);
  const [notes, setNotes] = useState(item.notes || '');
  const [saving, setSaving] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const b = writeBatch(db);
      b.update(doc(db, 'items', item.id), { attributes, notes: notes.trim(), updatedAt: serverTimestamp() });
      b.update(doc(db, 'storeItems', storeItemKey(storeId, item.id)), { sellingPrice: num(price), lowStockThreshold: num(threshold), updatedAt: serverTimestamp() });
      b.set(doc(collection(db, 'activityLog')), { storeId, itemId: item.id, type: 'edited', date: todayStr(), detail: 'Price, alert level or details updated', createdAt: serverTimestamp() });
      const patch = attrPatch(attributes);
      if (Object.keys(patch).length) b.set(doc(db, 'opsLists', ctx.listsStoreId), { ...patch, updatedAt: serverTimestamp() }, { merge: true });
      await b.commit();
      patchItem(item.id, { attributes, notes: notes.trim() });
      notify({ type: 'success', message: `${item.name} updated.` });
      onClose();
    } catch (err) {
      notify({ type: 'error', message: err?.message || 'Could not save.' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell onClose={onClose} size="wide">
      <ModalHeader icon={Pencil} title={`Edit ${item.name}`} subtitle="Attributes are shared by every place that carries this item" onClose={onClose} />
      <form onSubmit={submit} className="space-y-5">
        <div className="grid grid-cols-2 gap-3">
          <Field id="es-price" label="Selling price" type="number" min="0" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} suffix="KSh" />
          <Field id="es-low" label="Warn me at (pairs)" icon={AlertTriangle} type="number" min="0" inputMode="numeric" value={threshold} onChange={(e) => setThreshold(e.target.value)} placeholder="0 = only when out" />
        </div>
        <AttributeEditor attributes={attributes} onChange={setAttributes} lists={lists} />
        <Field id="es-notes" label="Notes (optional)" icon={StickyNote} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. runs small, reflective strip" />
        <SubmitButton saving={saving}>
          <CheckCircle2 size={15} /> Save changes
        </SubmitButton>
      </form>
    </ModalShell>
  );
};

const CountStockModal = ({ row, ctx, onClose }) => {
  const { storeId, lists, notify, setFollowUp } = ctx;
  const { item, stockRows } = row;
  const [counted, setCounted] = useState({});
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  const diffs = stockRows
    .filter((r) => counted[r.variant] !== undefined && counted[r.variant] !== '')
    .map((r) => ({ ...r, diff: num(counted[r.variant]) - num(r.quantity) }))
    .filter((r) => r.diff !== 0);
  const canSave = diffs.length > 0 && reason.trim() && stockRows.every((r) => num(counted[r.variant] ?? 0) >= 0);

  const submit = async (e) => {
    e.preventDefault();
    if (!canSave) return;
    setSaving(true);
    try {
      const b = writeBatch(db);
      diffs.forEach((r) => b.update(doc(db, 'stock', stockKey(storeId, item.id, r.variant)), { quantity: increment(r.diff), updatedAt: serverTimestamp() }));
      b.set(doc(collection(db, 'activityLog')), {
        storeId,
        itemId: item.id,
        type: 'counted',
        date: todayStr(),
        detail: `Stock count · ${reason.trim()}`,
        lineSummary: diffs.map((r) => `${r.variant}: ${r.quantity} → ${num(counted[r.variant])}`).join(', '),
        createdAt: serverTimestamp(),
      });
      b.set(doc(db, 'opsLists', ctx.listsStoreId), { reasons: arrayUnion(reason.trim()), updatedAt: serverTimestamp() }, { merge: true });
      await b.commit();
      onClose();
      setFollowUp({ title: 'Count recorded', message: `${diffs.length} size${diffs.length !== 1 ? 's' : ''} of ${item.name} corrected. Reason: ${reason.trim()}.`, actions: [] });
    } catch (err) {
      notify({ type: 'error', message: err?.message || 'Could not save the count.' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell onClose={onClose}>
      <ModalHeader icon={Scale} title={`Count ${item.name}`} subtitle="Fill in only the sizes that don't match" onClose={onClose} />
      <form onSubmit={submit} className="space-y-4">
        <div className="grid grid-cols-3 gap-2">
          {stockRows.map((r) => (
            <div key={r.variant} className="rounded-xl border border-[#E1E8F4] bg-white px-2 py-1.5 text-center">
              <p className="text-[11px] font-semibold text-[#8CA0BC]">Size {r.variant} <span className="font-normal">/{r.quantity}</span></p>
              <input type="number" min="0" inputMode="numeric" value={counted[r.variant] ?? ''} onChange={(e) => setCounted((c) => ({ ...c, [r.variant]: e.target.value }))} placeholder={String(r.quantity)} className="w-full bg-transparent text-center text-[15px] font-semibold outline-none" style={{ color: INK }} />
            </div>
          ))}
        </div>
        {diffs.length > 0 && (
          <>
            <p className="text-sm font-semibold text-[#2B6CDA]">
              {diffs.map((r) => `${r.variant}: ${r.diff > 0 ? '+' : ''}${r.diff}`).join(' · ')}
            </p>
            <SuggestInput id="cs-reason" label="Why? (damaged, miscounted, found more…)" value={reason} onChange={setReason} options={lists.reasons || []} placeholder="Type or pick a reason" />
          </>
        )}
        <SubmitButton saving={saving} disabled={!canSave}>
          <CheckCircle2 size={15} /> Save count
        </SubmitButton>
      </form>
    </ModalShell>
  );
};

const MoveStockModal = ({ row, ctx, onClose }) => {
  const { storeId, stores, roleOf, notify, setFollowUp } = ctx;
  const { item, storeItem, stockRows } = row;
  const available = stockRows.filter((r) => num(r.quantity) > 0);
  const others = stores.filter((s) => s.id !== storeId);
  const [destId, setDestId] = useState('');
  const [qty, setQty] = useState({});
  const [saving, setSaving] = useState(false);

  const moves = available.filter((r) => num(qty[r.variant]) > 0).map((r) => ({ ...r, q: num(qty[r.variant]) }));
  const total = moves.reduce((s, m) => s + m.q, 0);
  const canSave = destId && total > 0 && moves.every((m) => m.q <= num(m.quantity));
  const destName = stores.find((s) => s.id === destId)?.name;

  const submit = async (e) => {
    e.preventDefault();
    if (!canSave) return;
    setSaving(true);
    try {
      const date = todayStr();
      await runTransaction(db, async (tx) => {
        const siRef = doc(db, 'storeItems', storeItemKey(destId, item.id));
        const srcRefs = moves.map((m) => doc(db, 'stock', stockKey(storeId, item.id, m.variant)));
        const dstRefs = moves.map((m) => doc(db, 'stock', stockKey(destId, item.id, m.variant)));
        const [srcSnaps, dstSnaps, siSnap] = await Promise.all([Promise.all(srcRefs.map((r) => tx.get(r))), Promise.all(dstRefs.map((r) => tx.get(r))), tx.get(siRef)]);

        srcSnaps.forEach((s, i) => {
          const have = s.exists() ? num(s.data().quantity) : 0;
          if (have < moves[i].q) throw new Error(`Only ${have} pair(s) of size ${moves[i].variant} left here — nothing was moved.`);
        });

        moves.forEach((m, i) => {
          tx.update(srcRefs[i], { quantity: increment(-m.q), updatedAt: serverTimestamp() });
          const d = dstSnaps[i].exists() ? dstSnaps[i].data() : null;
          const payload = { storeId: destId, itemId: item.id, variant: m.variant, quantity: increment(m.q), avgCost: blendAvg(d?.quantity, d?.avgCost, m.q, srcSnaps[i].data().avgCost), updatedAt: serverTimestamp() };
          if (!d) payload.createdAt = serverTimestamp();
          tx.set(dstRefs[i], payload, { merge: true });
        });

        const sizes = moves.map((m) => m.variant);
        if (siSnap.exists()) {
          tx.update(siRef, { variantsCarried: dedupeKeepOrder([...(siSnap.data().variantsCarried || []), ...sizes]), status: 'active', updatedAt: serverTimestamp() });
        } else {
          tx.set(siRef, { storeId: destId, itemId: item.id, sellingPrice: num(storeItem.sellingPrice), supplier: '', variantsCarried: sizes, lowStockThreshold: 0, status: 'active', createdAt: serverTimestamp() });
        }

        const tRef = doc(collection(db, 'transfers'));
        tx.set(tRef, {
          fromStoreId: storeId,
          toStoreId: destId,
          date,
          items: moves.map((m) => ({ itemId: item.id, itemName: item.name, variant: m.variant, quantity: m.q, costPerUnit: num(m.avgCost), totalCost: m.q * num(m.avgCost) })),
          status: 'active',
          createdAt: serverTimestamp(),
        });
        const summary = (sign) => moves.map((m) => `${m.variant}: ${sign}${m.q}`).join(', ');
        tx.set(doc(collection(db, 'activityLog')), { storeId, itemId: item.id, type: 'transferred_out', date, detail: `To ${destName}`, lineSummary: summary('-'), transferId: tRef.id, createdAt: serverTimestamp() });
        tx.set(doc(collection(db, 'activityLog')), { storeId: destId, itemId: item.id, type: 'transferred_in', date, detail: `From ${ctx.store?.name || 'another place'}`, lineSummary: summary('+'), transferId: tRef.id, createdAt: serverTimestamp() });
      });
      onClose();
      setFollowUp({ title: 'Stock moved', message: `${total} pair${total !== 1 ? 's' : ''} of ${item.name} sent to ${destName}.`, actions: [] });
    } catch (err) {
      notify({ type: 'error', message: err?.message || 'Could not move stock.' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell onClose={onClose}>
      <ModalHeader icon={Truck} title={`Move ${item.name}`} subtitle="Send pairs to another place" onClose={onClose} />
      {others.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-[#CBDBF3] px-4 py-6 text-center text-sm text-[#5C7196]">Add another store first to move stock.</p>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <div>
            <SectionLabel>Send to</SectionLabel>
            <PlaceChips stores={others} roleOf={roleOf} value={destId} onChange={setDestId} />
          </div>
          <div>
            <SectionLabel>Pairs per size</SectionLabel>
            <div className="grid grid-cols-3 gap-2">
              {available.map((r) => (
                <div key={r.variant} className="rounded-xl border border-[#E1E8F4] bg-white px-2 py-1.5 text-center">
                  <p className="text-[11px] font-semibold text-[#8CA0BC]">Size {r.variant} <span className="font-normal">/{r.quantity}</span></p>
                  <input type="number" min="0" max={r.quantity} inputMode="numeric" value={qty[r.variant] ?? ''} onChange={(e) => setQty((q) => ({ ...q, [r.variant]: e.target.value }))} placeholder="0" className="w-full bg-transparent text-center text-[15px] font-semibold outline-none" style={{ color: INK }} />
                </div>
              ))}
            </div>
            {total > 0 && <p className="mt-2 text-sm font-semibold text-[#2B6CDA]">{total} pair{total !== 1 ? 's' : ''}{destName ? ` → ${destName}` : ''}</p>}
          </div>
          <SubmitButton saving={saving} disabled={!canSave}>
            <Truck size={15} /> Move stock
          </SubmitButton>
        </form>
      )}
    </ModalShell>
  );
};

const StockItemSheet = ({ row, ctx, onClose, onMove, onCount, onEdit }) => {
  const { storeId, notify } = ctx;
  const { item, storeItem, stockRows } = row;
  const [acts, setActs] = useState({ rows: [], loading: true });
  const st = stockState(row);
  const avgCost = st.qty > 0 ? stockRows.reduce((s, r) => s + num(r.quantity) * num(r.avgCost), 0) / st.qty : 0;
  const attrs = attrText(item);

  useEffect(() => {
    let cancelled = false;
    fetchWhere('activityLog', where('storeId', '==', storeId), where('itemId', '==', item.id))
      .then((r) => !cancelled && setActs({ rows: r.sort(byNewest).slice(0, 15), loading: false }))
      .catch(() => {
        if (!cancelled) setActs({ rows: [], loading: false });
        notify({ type: 'error', message: 'Could not load history.' });
      });
    return () => {
      cancelled = true;
    };
  }, [storeId, item.id, st.qty, notify]);

  return (
    <ModalShell onClose={onClose} size="wide">
      <ModalHeader icon={Package} title={item.name} subtitle={`${item.category || 'Shoes'} · ${ctx.store?.name || ''}`} onClose={onClose} />
      <div className="grid grid-cols-3 gap-3">
        <StatBox label="In stock" value={`${st.qty} ${item.unit || 'pairs'}`} tone={st.out ? 'red' : st.low ? 'amber' : undefined} />
        <StatBox label="Selling price" value={money(storeItem.sellingPrice)} />
        <StatBox label="Cost / pair" value={money(avgCost)} />
      </div>
      {(st.out || st.low) && (
        <div className="mt-3 flex items-center gap-2 rounded-2xl border border-[#F0DCAF] bg-[#FBF0DA] px-4 py-3 text-sm text-[#8A611E]">
          <AlertTriangle size={14} className="shrink-0" />
          {st.out ? 'Out of stock.' : `Running low — at or below ${st.threshold} pairs.`}
        </div>
      )}
      {(item.attributes || []).length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {item.attributes.map((a, i) => (
            <span key={i} className="rounded-full bg-[#EAF2FE] px-2.5 py-1 text-xs font-semibold text-[#2B6CDA]">{a.key}: {a.value}</span>
          ))}
        </div>
      )}
      {item.notes && (
        <div className="mt-3 flex items-start gap-2 rounded-2xl border border-dashed border-[#CBDBF3] bg-[#F7FAFD] px-4 py-3 text-sm text-[#5C7196]">
          <StickyNote size={14} className="mt-0.5 shrink-0 text-[#8CA0BC]" />
          {item.notes}
        </div>
      )}

      <div className="mt-4">
        <SectionLabel hint={`${stockRows.length} size${stockRows.length !== 1 ? 's' : ''}`}>Sizes</SectionLabel>
        <div className="flex flex-wrap gap-1.5">
          {stockRows.map((r) => {
            const out = num(r.quantity) <= 0;
            const low = !out && st.threshold > 0 && num(r.quantity) <= st.threshold;
            return (
              <span key={r.variant} className={`rounded-lg border px-2.5 py-1 text-xs font-semibold ${out ? 'border-[#F5D3CE] bg-[#FBEAE8] text-[#C0433A]' : low ? 'border-[#F0DCAF] bg-[#FBF0DA] text-[#B9812E]' : 'border-[#E1E8F4] bg-[#F7FAFD] text-[#2B6CDA]'}`}>
                {r.variant} × {r.quantity}{out ? ' · Out' : low ? ' · Low' : ''}
              </span>
            );
          })}
        </div>
      </div>

      <div className="mt-5 flex gap-2.5">
        <SoftButton icon={Truck} onClick={onMove} disabled={st.out}>Move</SoftButton>
        <SoftButton icon={Scale} onClick={onCount}>Count</SoftButton>
        <SoftButton icon={Pencil} onClick={onEdit}>Edit</SoftButton>
      </div>

      <div className="mt-5">
        <SectionLabel>Recent activity</SectionLabel>
        {acts.loading ? (
          <Spinner />
        ) : acts.rows.length === 0 ? (
          <p className="py-4 text-center text-sm text-[#8CA0BC]">Nothing recorded yet.</p>
        ) : (
          <div className="space-y-2">
            {acts.rows.map((a) => (
              <div key={a.id} className="rounded-xl border border-[#EAF0F9] bg-[#F7FAFD] px-3.5 py-2.5">
                <div className="flex flex-wrap items-center justify-between gap-1.5">
                  <span className="text-sm font-semibold" style={{ color: INK }}>{ACTIVITY_TITLES[a.type] || a.type}</span>
                  <span className="text-[11px] text-[#8CA0BC]">{formatDate(a.date)}</span>
                </div>
                {a.detail && <p className="mt-0.5 text-sm text-[#5C7196]">{a.detail}</p>}
                {a.lineSummary && <p className="mt-0.5 text-sm font-semibold text-[#2B6CDA]">{a.lineSummary}</p>}
              </div>
            ))}
          </div>
        )}
      </div>
      {attrs && <span className="sr-only">{attrs}</span>}
    </ModalShell>
  );
};

const StockView = ({ ctx }) => {
  const { stockList, stockLoading, store } = ctx;
  const [q, setQ] = useState('');
  const [lowOnly, setLowOnly] = useState(false);
  const [openId, setOpenId] = useState(null);
  const [modal, setModal] = useState(null); // { type: 'move' | 'count' | 'edit', id }

  const rows = useMemo(
    () =>
      stockList
        .filter((r) => !q || lower(r.item.name).includes(lower(q)) || lower(attrText(r.item)).includes(lower(q)))
        .filter((r) => {
          if (!lowOnly) return true;
          const s = stockState(r);
          return s.out || s.low;
        }),
    [stockList, q, lowOnly]
  );
  const find = (id) => stockList.find((r) => r.item.id === id);
  const totalPairs = stockList.reduce((s, r) => s + totalOf(r.stockRows), 0);
  const attention = stockList.filter((r) => {
    const s = stockState(r);
    return s.out || s.low;
  }).length;

  return (
    <div>
      <PageTop title="Stock" subtitle={stockList.length ? `${totalPairs} pairs across ${stockList.length} item${stockList.length !== 1 ? 's' : ''}` : `What is on the shelf at ${store?.name || 'this place'}`} />
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <SearchBar value={q} onChange={setQ} placeholder="Search shoes or attributes…" />
        <button type="button" onClick={() => setLowOnly((v) => !v)} className={`flex shrink-0 items-center gap-1.5 rounded-full border px-3.5 py-2.5 text-sm font-medium transition-colors ${lowOnly ? 'border-[#B9812E] bg-[#FBF0DA] text-[#B9812E]' : 'border-[#E1E8F4] bg-white text-[#8CA0BC]'}`}>
          <AlertTriangle size={13} /> Low{attention > 0 ? ` · ${attention}` : ''}
        </button>
      </div>

      {stockLoading ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={Warehouse}
          title={stockList.length === 0 ? 'No stock here yet' : 'Nothing matches'}
          body={stockList.length === 0 ? 'Finish a production run and choose this place as the destination — the shoes, sizes and cost per pair will show up here.' : 'No items match this search or filter.'}
        />
      ) : (
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {rows.map((r) => {
            const s = stockState(r);
            return (
              <RowCard
                key={r.item.id}
                icon={Package}
                title={r.item.name}
                subtitle={attrText(r.item) || `${r.stockRows.length} size${r.stockRows.length !== 1 ? 's' : ''} · ${money(r.storeItem.sellingPrice)}`}
                tone={s.out ? 'red' : s.low ? 'amber' : undefined}
                onClick={() => setOpenId(r.item.id)}
                right={
                  <div>
                    <p className="text-sm font-semibold" style={{ color: s.out ? '#C0433A' : s.low ? '#B9812E' : INK }}>{s.qty} pairs</p>
                    {(s.out || s.low) && <p className="text-[11px] font-semibold" style={{ color: s.out ? '#C0433A' : '#B9812E' }}>{s.out ? 'Out' : 'Low'}</p>}
                  </div>
                }
              />
            );
          })}
        </div>
      )}

      <AnimatePresence>
        {openId && find(openId) && (
          <StockItemSheet
            row={find(openId)}
            ctx={ctx}
            onClose={() => setOpenId(null)}
            onMove={() => setModal({ type: 'move', id: openId })}
            onCount={() => setModal({ type: 'count', id: openId })}
            onEdit={() => setModal({ type: 'edit', id: openId })}
          />
        )}
      </AnimatePresence>
      <AnimatePresence>{modal?.type === 'move' && find(modal.id) && <MoveStockModal row={find(modal.id)} ctx={ctx} onClose={() => setModal(null)} />}</AnimatePresence>
      <AnimatePresence>{modal?.type === 'count' && find(modal.id) && <CountStockModal row={find(modal.id)} ctx={ctx} onClose={() => setModal(null)} />}</AnimatePresence>
      <AnimatePresence>{modal?.type === 'edit' && find(modal.id) && <EditStockModal row={find(modal.id)} ctx={ctx} onClose={() => setModal(null)} />}</AnimatePresence>
    </div>
  );
};

/* ==================================================================== */
/*  MACHINES                                                             */
/* ==================================================================== */

const AddMachineModal = ({ ctx, onClose }) => {
  const { storeId, lists, machines, notify, setFollowUp } = ctx;
  const [name, setName] = useState('');
  const [role, setRole] = useState('');
  const [cost, setCost] = useState('');
  const [bought, setBought] = useState('');
  const [saving, setSaving] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    if (machines.some((m) => lower(m.name) === lower(name))) return notify({ type: 'error', message: `"${name.trim()}" is already in the list.` });
    setSaving(true);
    try {
      const b = writeBatch(db);
      b.set(doc(collection(db, 'opsMachines')), { storeId, name: name.trim(), role: role.trim(), cost: num(cost), boughtDate: bought, totalMaintenance: 0, status: 'active', createdAt: serverTimestamp() });
      if (role.trim()) b.set(doc(db, 'opsLists', storeId), { machineRoles: arrayUnion(role.trim()), updatedAt: serverTimestamp() }, { merge: true });
      await b.commit();
      onClose();
      setFollowUp({ title: `${name.trim()} added`, message: 'Log every service and repair on it to see what it really costs you.', actions: [] });
    } catch (err) {
      notify({ type: 'error', message: err?.message || 'Could not add machine.' });
    } finally {
      setSaving(false);
    }
  };
  return (
    <ModalShell onClose={onClose}>
      <ModalHeader icon={Wrench} title="Add a machine" onClose={onClose} />
      <form onSubmit={submit} className="space-y-4">
        <Field id="mc-name" label="Machine name" icon={Wrench} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Heavy-duty stitcher 1" required />
        <SuggestInput id="mc-role" label="What does it do?" value={role} onChange={setRole} options={lists.machineRoles || []} placeholder="Stitching, cutting, sole pressing…" />
        <div className="grid grid-cols-2 gap-3">
          <Field id="mc-cost" label="Bought for" type="number" min="0" inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} suffix="KSh" placeholder="Optional" />
          <Field id="mc-date" label="Bought on" type="date" value={bought} onChange={(e) => setBought(e.target.value)} />
        </div>
        <SubmitButton saving={saving} disabled={!name.trim()}><Plus size={15} /> Add machine</SubmitButton>
      </form>
    </ModalShell>
  );
};

const MaintenanceModal = ({ machine, ctx, onClose, onSaved }) => {
  const { storeId, suppliers, materials, notify, setFollowUp } = ctx;
  const [date, setDate] = useState(todayStr());
  const [cost, setCost] = useState('');
  const [by, setBy] = useState('');
  const [note, setNote] = useState('');
  const [spareId, setSpareId] = useState('');
  const [spareQty, setSpareQty] = useState('');
  const [saving, setSaving] = useState(false);
  const spares = materials.filter((m) => m.category === 'Machine spare');
  const spare = materials.find((m) => m.id === spareId);
  const sq = num(spareQty);
  const canSave = cost !== '' && (!spare || (sq > 0 && sq <= num(spare.quantity)));

  const submit = async (e) => {
    e.preventDefault();
    if (!canSave) return;
    setSaving(true);
    try {
      const b = writeBatch(db);
      b.set(doc(collection(db, 'opsMaintenance')), { storeId, machineId: machine.id, machineName: machine.name, date, cost: num(cost), by: by.trim(), note: note.trim(), spareUsed: spare ? { materialId: spare.id, name: spare.name, qty: sq, unit: spare.unit } : null, createdAt: serverTimestamp() });
      b.update(doc(db, 'opsMachines', machine.id), { totalMaintenance: increment(num(cost)), lastServiced: date, updatedAt: serverTimestamp() });
      if (by.trim()) {
        const supId = keyOf(storeId, by.trim());
        const known = suppliers.some((s) => s.id === supId);
        b.set(doc(db, 'opsSuppliers', supId), { storeId, name: by.trim(), updatedAt: serverTimestamp(), ...(known ? {} : { createdAt: serverTimestamp(), owed: 0 }) }, { merge: true });
      }
      if (spare) {
        b.update(doc(db, 'opsMaterials', spare.id), { quantity: increment(-sq), updatedAt: serverTimestamp() });
        b.set(doc(collection(db, 'opsMovements')), { storeId, materialId: spare.id, materialName: spare.name, unit: spare.unit, type: 'machine_use', quantity: -sq, date, detail: `Used on ${machine.name}`, createdAt: serverTimestamp() });
      }
      await b.commit();
      onClose();
      onSaved?.();
      setFollowUp({ title: 'Maintenance logged', message: `${money(cost)} recorded against ${machine.name}.`, actions: [] });
    } catch (err) {
      notify({ type: 'error', message: err?.message || 'Could not save.' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell onClose={onClose}>
      <ModalHeader icon={Wrench} title="Log maintenance" subtitle={machine.name} onClose={onClose} />
      <form onSubmit={submit} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field id="mt-date" label="Date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          <Field id="mt-cost" label="Cost" type="number" min="0" inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} suffix="KSh" />
        </div>
        <SuggestInput id="mt-by" label="Who did it? (optional)" icon={User} value={by} onChange={setBy} options={suppliers.map((s) => s.name)} placeholder="Technician or shop" />
        <Field id="mt-note" label="What was done?" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Belt replaced, oiled, serviced…" />
        {spares.length > 0 && (
          <div>
            <SectionLabel hint="Optional — takes it out of stock">Spare used from stock</SectionLabel>
            <div className="flex flex-wrap gap-1.5">
              {spares.map((s) => <Chip key={s.id} active={spareId === s.id} onClick={() => setSpareId(spareId === s.id ? '' : s.id)}>{s.name} · {qtyFmt(s.quantity)}</Chip>)}
            </div>
            {spare && <div className="mt-2.5"><Field id="mt-sq" label={`How many ${spare.unit}?`} type="number" min="0" step="any" inputMode="decimal" value={spareQty} onChange={(e) => setSpareQty(e.target.value)} />{sq > num(spare.quantity) && <p className="mt-1 text-xs font-medium text-[#C0433A]">Only {qtyFmt(spare.quantity)} in stock.</p>}</div>}
          </div>
        )}
        <SubmitButton saving={saving} disabled={!canSave}><Check size={15} /> Save</SubmitButton>
      </form>
    </ModalShell>
  );
};

const MachinesView = ({ ctx }) => {
  const { machines, loading, storeId, notify } = ctx;
  const [addOpen, setAddOpen] = useState(false);
  const [openId, setOpenId] = useState(null);
  const [logFor, setLogFor] = useState(null);
  const [logs, setLogs] = useState({ rows: [], loading: false });
  const machine = machines.find((m) => m.id === openId);

  const loadLogs = useCallback(async () => {
    if (!openId) return;
    setLogs((l) => ({ ...l, loading: true }));
    try {
      const rows = await fetchWhere('opsMaintenance', where('storeId', '==', storeId), where('machineId', '==', openId));
      setLogs({ rows: rows.sort(byNewest), loading: false });
    } catch {
      setLogs({ rows: [], loading: false });
      notify({ type: 'error', message: 'Could not load maintenance history.' });
    }
  }, [openId, storeId, notify]);
  useEffect(() => {
    loadLogs();
  }, [loadLogs]);

  return (
    <div>
      <PageTop title="Machines" subtitle="What you run and what it costs to keep running" onAdd={() => setAddOpen(true)} addLabel="Add machine" />
      {loading ? <Spinner /> : machines.length === 0 ? (
        <EmptyState icon={Wrench} title="No machines yet" body="Add each machine with what it does, then log services and repairs to see its running cost." actionLabel="Add machine" onAction={() => setAddOpen(true)} />
      ) : (
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {[...machines].sort((a, b) => a.name.localeCompare(b.name)).map((m) => (
            <RowCard key={m.id} icon={Wrench} title={m.name} subtitle={m.role || 'No role set'} onClick={() => setOpenId(m.id)}
              right={<p className="text-xs font-semibold text-[#5C7196]">{money(m.totalMaintenance)}<span className="block font-normal text-[#8CA0BC]">upkeep</span></p>} />
          ))}
        </div>
      )}
      <AnimatePresence>{addOpen && <AddMachineModal ctx={ctx} onClose={() => setAddOpen(false)} />}</AnimatePresence>
      <AnimatePresence>
        {machine && (
          <ModalShell onClose={() => setOpenId(null)} size="wide">
            <ModalHeader icon={Wrench} title={machine.name} subtitle={machine.role} onClose={() => setOpenId(null)} />
            <div className="grid grid-cols-3 gap-3">
              <StatBox label="Bought for" value={machine.cost ? money(machine.cost) : '—'} />
              <StatBox label="Upkeep so far" value={money(machine.totalMaintenance)} tone="amber" />
              <StatBox label="Last serviced" value={machine.lastServiced ? formatDate(machine.lastServiced) : '—'} />
            </div>
            <div className="mt-4"><SubmitButton type="button" onClick={() => setLogFor(machine.id)}><Plus size={15} /> Log maintenance</SubmitButton></div>
            <div className="mt-5">
              <SectionLabel>History</SectionLabel>
              {logs.loading ? <Spinner /> : logs.rows.length === 0 ? <p className="py-4 text-center text-sm text-[#8CA0BC]">No maintenance logged yet.</p> : (
                <div className="space-y-2">
                  {logs.rows.map((l) => (
                    <div key={l.id} className="rounded-xl border border-[#EAF0F9] bg-[#F7FAFD] px-3.5 py-2.5 text-sm">
                      <div className="flex justify-between gap-2"><span className="font-semibold" style={{ color: INK }}>{l.note || 'Maintenance'}</span><span className="font-semibold" style={{ color: INK }}>{money(l.cost)}</span></div>
                      <p className="text-xs text-[#8CA0BC]">{formatDate(l.date)}{l.by ? ` · ${l.by}` : ''}{l.spareUsed ? ` · used ${qtyFmt(l.spareUsed.qty)} ${l.spareUsed.unit} ${l.spareUsed.name}` : ''}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </ModalShell>
        )}
      </AnimatePresence>
      <AnimatePresence>{logFor && machine && <MaintenanceModal machine={machine} ctx={ctx} onClose={() => setLogFor(null)} onSaved={loadLogs} />}</AnimatePresence>
    </div>
  );
};

/* ==================================================================== */
/*  PAY                                                                  */
/* ==================================================================== */

const PAY_STYLES = [
  { id: 'monthly', label: 'Monthly' },
  { id: 'weekly', label: 'Weekly' },
  { id: 'piece', label: 'Per pair' },
];

const weekStart = (d) => {
  const x = new Date(d);
  const day = (x.getDay() + 6) % 7;
  x.setDate(x.getDate() - day);
  return x.toISOString().slice(0, 10);
};

const PayModal = ({ person, ctx, onClose, onSaved }) => {
  const { storeId, runs, notify, setFollowUp } = ctx;
  const style = person.payStyle || 'monthly';
  const [date, setDate] = useState(todayStr());
  const [label, setLabel] = useState(style === 'weekly' ? `Week of ${formatDate(weekStart(todayStr()))}` : new Date().toLocaleDateString(undefined, { month: 'long', year: 'numeric' }));
  const suggestion = useMemo(() => {
    if (style !== 'piece') return num(person.payRate);
    const from = `${todayStr().slice(0, 7)}-01`;
    const pairs = runs.filter((r) => r.status === 'completed' && (r.completedDate || '') >= from && (r.steps || []).some((s) => s.doneById === person.id)).reduce((s, r) => s + num(r.madeTotal), 0);
    return pairs * num(person.payRate);
  }, [style, runs, person]);
  const [amount, setAmount] = useState(suggestion ? String(suggestion) : '');
  const [method, setMethod] = useState('cash');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (num(amount) <= 0) return;
    setSaving(true);
    try {
      await writeBatch(db)
        .set(doc(collection(db, 'opsPayroll')), { storeId, staffId: person.id, staffName: person.fullName, payStyle: style, period: label.trim(), amount: num(amount), method, date, note: note.trim(), createdAt: serverTimestamp() })
        .commit();
      onClose();
      onSaved();
      setFollowUp({ title: 'Payment recorded', message: `${money(amount)} paid to ${person.fullName} for ${label.trim()}.`, actions: [] });
    } catch (err) {
      notify({ type: 'error', message: err?.message || 'Could not record payment.' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell onClose={onClose}>
      <ModalHeader icon={Wallet} title={`Pay ${person.fullName}`} subtitle={person.role} onClose={onClose} />
      <form onSubmit={submit} className="space-y-4">
        <Field id="py-label" label="Paying for" value={label} onChange={(e) => setLabel(e.target.value)} />
        <div>
          <Field id="py-amt" label="Amount" type="number" min="0" step="any" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} suffix="KSh" />
          {style === 'piece' && suggestion > 0 && <p className="mt-1.5 text-xs text-[#5C7196]">Suggested from this month's production runs: {money(suggestion)}.</p>}
          {style === 'piece' && suggestion === 0 && <p className="mt-1.5 text-xs text-[#8CA0BC]">Tag this person on steps in production runs to get a suggested amount.</p>}
        </div>
        <ChoiceRow value={method} onChange={setMethod} options={PAY_METHODS.map((m) => ({ id: m.id, label: m.label, icon: m.icon }))} />
        <Field id="py-date" label="Paid on" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        <Field id="py-note" label="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
        <SubmitButton saving={saving} disabled={num(amount) <= 0}><Check size={15} /> Record payment</SubmitButton>
      </form>
    </ModalShell>
  );
};

const PayView = ({ ctx }) => {
  const { staff, storeId, notify } = ctx;
  const [payments, setPayments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState(null);
  const [payFor, setPayFor] = useState(null);
  const [style, setStyle] = useState('monthly');
  const [rate, setRate] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      setPayments((await fetchWhere('opsPayroll', where('storeId', '==', storeId))).sort(byNewest));
    } catch {
      notify({ type: 'error', message: 'Could not load payments.' });
    } finally {
      setLoading(false);
    }
  }, [storeId, notify]);
  useEffect(() => {
    load();
  }, [load]);

  const month = todayStr().slice(0, 7);
  const monthTotal = payments.filter((p) => (p.date || '').startsWith(month)).reduce((s, p) => s + num(p.amount), 0);
  const person = staff.find((s) => s.id === openId);
  useEffect(() => {
    if (person) {
      setStyle(person.payStyle || 'monthly');
      setRate(person.payRate ? String(person.payRate) : '');
    }
  }, [openId]); // eslint-disable-line react-hooks/exhaustive-deps

  const saveStyle = async () => {
    setSaving(true);
    try {
      await updateDoc(doc(db, 'staff', person.id), { payStyle: style, payRate: num(rate), updatedAt: serverTimestamp() });
      notify({ type: 'success', message: `${person.fullName}'s pay style saved.` });
    } catch (err) {
      notify({ type: 'error', message: err?.message || 'Could not save.' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <PageTop title="Pay" subtitle={monthTotal > 0 ? `${money(monthTotal)} paid this month` : 'Record what you pay your team'} />
      {loading ? <Spinner /> : staff.length === 0 ? (
        <EmptyState icon={Users} title="No team members here" body="Add staff in the Staff section and attach them to this place — they'll show up here." />
      ) : (
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {[...staff].sort((a, b) => a.fullName.localeCompare(b.fullName)).map((s) => {
            const paid = payments.filter((p) => p.staffId === s.id && (p.date || '').startsWith(month)).reduce((t, p) => t + num(p.amount), 0);
            return (
              <RowCard key={s.id} icon={User} title={s.fullName} subtitle={`${s.role} · ${s.payStyle ? `${PAY_STYLES.find((p) => p.id === s.payStyle)?.label}${s.payRate ? ` ${money(s.payRate)}` : ''}` : 'Pay style not set'}`} onClick={() => setOpenId(s.id)}
                right={<p className="text-xs font-semibold text-[#5C7196]">{money(paid)}<span className="block font-normal text-[#8CA0BC]">this month</span></p>} />
            );
          })}
        </div>
      )}
      <AnimatePresence>
        {person && (
          <ModalShell onClose={() => setOpenId(null)} size="wide">
            <ModalHeader icon={User} title={person.fullName} subtitle={person.role} onClose={() => setOpenId(null)} />
            <SectionLabel>How are they paid?</SectionLabel>
            <ChoiceRow value={style} onChange={setStyle} options={PAY_STYLES} />
            <div className="mt-3">
              <Field id="pay-rate" label={style === 'piece' ? 'Rate per pair' : style === 'weekly' ? 'Weekly pay' : 'Monthly pay'} type="number" min="0" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} suffix="KSh" />
            </div>
            <div className="mt-3 flex gap-2.5">
              <SoftButton icon={Check} onClick={saveStyle} disabled={saving}>Save pay style</SoftButton>
              <SoftButton icon={Banknote} onClick={() => setPayFor(person.id)}>Record payment</SoftButton>
            </div>
            <div className="mt-5">
              <SectionLabel>Payments</SectionLabel>
              {payments.filter((p) => p.staffId === person.id).length === 0 ? <p className="py-4 text-center text-sm text-[#8CA0BC]">Nothing recorded yet.</p> : (
                <div className="space-y-2">
                  {payments.filter((p) => p.staffId === person.id).map((p) => (
                    <div key={p.id} className="flex items-center justify-between rounded-xl border border-[#EAF0F9] bg-[#F7FAFD] px-3.5 py-2.5 text-sm">
                      <span className="min-w-0"><span className="block truncate font-semibold" style={{ color: INK }}>{p.period}</span><span className="text-xs text-[#8CA0BC]">{formatDate(p.date)} · {PAY_METHODS.find((m) => m.id === p.method)?.label}</span></span>
                      <span className="font-semibold" style={{ color: INK }}>{money(p.amount)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </ModalShell>
        )}
      </AnimatePresence>
      <AnimatePresence>{payFor && person && <PayModal person={person} ctx={ctx} onClose={() => setPayFor(null)} onSaved={load} />}</AnimatePresence>
    </div>
  );
};

/* ==================================================================== */
/*  SUPPLIERS — add them up front, or they appear on first restock       */
/* ==================================================================== */

const AddSupplierModal = ({ ctx, onClose }) => {
  const { storeId, suppliers, notify, setFollowUp } = ctx;
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    const clean = name.trim();
    if (!clean) return;
    const id = keyOf(storeId, clean);
    if (suppliers.some((s) => s.id === id)) return notify({ type: 'error', message: `"${clean}" is already in the list.` });
    setSaving(true);
    try {
      await writeBatch(db).set(doc(db, 'opsSuppliers', id), { storeId, name: clean, phone: phone.trim(), owed: 0, createdAt: serverTimestamp(), updatedAt: serverTimestamp() }).commit();
      onClose();
      setFollowUp({ title: `${clean} added`, message: 'You can now pick them whenever you restock a material.', actions: [] });
    } catch (err) {
      notify({ type: 'error', message: err?.message || 'Could not add supplier.' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell onClose={onClose}>
      <ModalHeader icon={Truck} title="Add a supplier" subtitle="Who you buy materials or services from" onClose={onClose} />
      <form onSubmit={submit} className="space-y-4">
        <Field id="sup-name" label="Name" icon={Truck} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Gikomba Leather Traders" required />
        <Field id="sup-phone" label="Phone (optional)" icon={Phone} type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="07xx xxx xxx" />
        <SubmitButton saving={saving} disabled={!name.trim()}><Plus size={15} /> Add supplier</SubmitButton>
      </form>
    </ModalShell>
  );
};

const PaySupplierModal = ({ supplier, ctx, onClose, onSaved }) => {
  const { storeId, notify, setFollowUp } = ctx;
  const [amount, setAmount] = useState(String(num(supplier.owed)));
  const [method, setMethod] = useState('cash');
  const [date, setDate] = useState(todayStr());
  const [saving, setSaving] = useState(false);
  const amt = num(amount);
  const canSave = amt > 0 && amt <= num(supplier.owed) + 0.001;
  const submit = async (e) => {
    e.preventDefault();
    if (!canSave) return;
    setSaving(true);
    try {
      const b = writeBatch(db);
      b.update(doc(db, 'opsSuppliers', supplier.id), { owed: increment(-amt), updatedAt: serverTimestamp() });
      b.set(doc(collection(db, 'opsSupplierPayments')), { storeId, supplierId: supplier.id, supplierName: supplier.name, amount: amt, method, date, createdAt: serverTimestamp() });
      await b.commit();
      onClose();
      onSaved();
      const left = num(supplier.owed) - amt;
      setFollowUp({ title: left <= 0.001 ? 'Fully paid off' : 'Payment recorded', message: left <= 0.001 ? `You no longer owe ${supplier.name} anything.` : `${money(amt)} paid. You still owe ${supplier.name} ${money(left)}.`, actions: [] });
    } catch (err) {
      notify({ type: 'error', message: err?.message || 'Could not record payment.' });
    } finally {
      setSaving(false);
    }
  };
  return (
    <ModalShell onClose={onClose}>
      <ModalHeader icon={Banknote} title={`Pay ${supplier.name}`} subtitle={`You owe ${money(supplier.owed)}`} onClose={onClose} />
      <form onSubmit={submit} className="space-y-4">
        <Field id="sp-amt" label="Amount paying" type="number" min="0" step="any" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} suffix="KSh" />
        <ChoiceRow value={method} onChange={setMethod} options={PAY_METHODS.map((m) => ({ id: m.id, label: m.label, icon: m.icon }))} />
        <Field id="sp-date" label="Date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        <SubmitButton saving={saving} disabled={!canSave}><Check size={15} /> Record payment</SubmitButton>
      </form>
    </ModalShell>
  );
};

const SuppliersView = ({ ctx }) => {
  const { suppliers, loading, storeId, notify } = ctx;
  const [addOpen, setAddOpen] = useState(false);
  const [openId, setOpenId] = useState(null);
  const [payId, setPayId] = useState(null);
  const [hist, setHist] = useState({ buys: [], pays: [], loading: false });
  const supplier = suppliers.find((s) => s.id === openId);

  const load = useCallback(async () => {
    if (!openId) return;
    setHist((h) => ({ ...h, loading: true }));
    try {
      const [buys, pays] = await Promise.all([
        fetchWhere('opsRestocks', where('storeId', '==', storeId), where('supplierId', '==', openId)),
        fetchWhere('opsSupplierPayments', where('storeId', '==', storeId), where('supplierId', '==', openId)),
      ]);
      setHist({ buys: buys.filter((b) => b.status === 'active').sort(byNewest), pays: pays.sort(byNewest), loading: false });
    } catch {
      setHist({ buys: [], pays: [], loading: false });
      notify({ type: 'error', message: 'Could not load supplier history.' });
    }
  }, [openId, storeId, notify]);
  useEffect(() => {
    load();
  }, [load]);

  const owedTotal = suppliers.reduce((s, x) => s + Math.max(0, num(x.owed)), 0);

  return (
    <div>
      <PageTop title="Suppliers" subtitle={owedTotal > 0 ? `${money(owedTotal)} owed to suppliers` : 'Who you buy from'} onAdd={() => setAddOpen(true)} addLabel="Add supplier" />
      {loading ? <Spinner /> : suppliers.length === 0 ? (
        <EmptyState icon={Truck} title="No suppliers yet" body="Add the people you buy from now, so they are one tap away when you restock a material. They are also added automatically the first time you type a new name." actionLabel="Add supplier" onAction={() => setAddOpen(true)} />
      ) : (
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {[...suppliers].sort((a, b) => num(b.owed) - num(a.owed) || a.name.localeCompare(b.name)).map((s) => (
            <RowCard key={s.id} icon={Truck} title={s.name} subtitle={`${num(s.owed) > 0.001 ? 'Balance to pay' : 'All paid up'}${s.phone ? ` · ${s.phone}` : ''}`} tone={num(s.owed) > 0.001 ? 'amber' : undefined} onClick={() => setOpenId(s.id)}
              right={num(s.owed) > 0.001 ? <p className="text-sm font-semibold text-[#C0433A]">{money(s.owed)}</p> : <Badge tone="green">Settled</Badge>} />
          ))}
        </div>
      )}
      <AnimatePresence>{addOpen && <AddSupplierModal ctx={ctx} onClose={() => setAddOpen(false)} />}</AnimatePresence>
      <AnimatePresence>
        {supplier && (
          <ModalShell onClose={() => setOpenId(null)} size="wide">
            <ModalHeader icon={Truck} title={supplier.name} subtitle={supplier.phone || 'Purchase and payment history'} onClose={() => setOpenId(null)} />
            <div className="grid grid-cols-2 gap-3">
              <StatBox label="You owe" value={money(Math.max(0, num(supplier.owed)))} tone={num(supplier.owed) > 0.001 ? 'red' : 'green'} />
              <StatBox label="Total bought" value={money(hist.buys.reduce((s, b) => s + num(b.total), 0))} />
            </div>
            {num(supplier.owed) > 0.001 && <div className="mt-4"><SubmitButton type="button" onClick={() => setPayId(supplier.id)}><Banknote size={15} /> Pay this supplier</SubmitButton></div>}
            <div className="mt-5">
              <SectionLabel>Purchases</SectionLabel>
              {hist.loading ? <Spinner /> : hist.buys.length === 0 ? <p className="py-3 text-center text-sm text-[#8CA0BC]">No purchases recorded.</p> : (
                <div className="space-y-2">
                  {hist.buys.map((b) => (
                    <div key={b.id} className="rounded-xl border border-[#EAF0F9] bg-[#F7FAFD] px-3.5 py-2.5 text-sm">
                      <div className="flex justify-between gap-2"><span className="font-semibold" style={{ color: INK }}>{b.materialName} · {qtyFmt(b.quantity)} {b.unit}</span><span className="font-semibold" style={{ color: INK }}>{money(b.total)}</span></div>
                      <p className="text-xs text-[#8CA0BC]">{formatDate(b.date)} · {b.paymentStatus === 'paid' ? 'Paid in full' : b.paymentStatus === 'part' ? 'Part-paid' : 'On credit'}{b.deliveryStatus === 'part' ? ' · part delivered' : ''}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
            {hist.pays.length > 0 && (
              <div className="mt-5">
                <SectionLabel>Payments you made</SectionLabel>
                <div className="space-y-2">
                  {hist.pays.map((p) => (
                    <div key={p.id} className="flex items-center justify-between rounded-xl border border-[#EAF0F9] bg-[#F7FAFD] px-3.5 py-2 text-sm">
                      <span className="text-[#5C7196]">{formatDate(p.date)} · {PAY_METHODS.find((m) => m.id === p.method)?.label}</span>
                      <span className="font-semibold" style={{ color: INK }}>{money(p.amount)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </ModalShell>
        )}
      </AnimatePresence>
      <AnimatePresence>{payId && supplier && <PaySupplierModal supplier={supplier} ctx={ctx} onClose={() => setPayId(null)} onSaved={load} />}</AnimatePresence>
    </div>
  );
};

/* ==================================================================== */
/*  SETTINGS — give every place a role                                   */
/* ==================================================================== */

const PlacesModal = ({ stores, roleOf, onClose, onSaved, notify }) => {
  const [roles, setRoles] = useState(Object.fromEntries(stores.map((s) => [s.id, roleOf(s.id)])));
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    try {
      const firstWarehouse = stores.find((s) => roles[s.id] === 'warehouse')?.id || null;
      await writeBatch(db).set(doc(db, 'opsSettings', 'main'), { roles, warehouseStoreId: firstWarehouse, warehouseSet: true, updatedAt: serverTimestamp() }, { merge: true }).commit();
      notify({ type: 'success', message: 'Places saved.' });
      onSaved();
      onClose();
    } catch (err) {
      notify({ type: 'error', message: err?.message || 'Could not save.' });
    } finally {
      setSaving(false);
    }
  };
  const hasFactory = stores.some((s) => roles[s.id] === 'factory');
  return (
    <ModalShell onClose={onClose}>
      <ModalHeader icon={Settings} title="Set up your places" subtitle="You can change this any time" onClose={onClose} />
      <p className="mb-4 text-sm leading-relaxed text-[#5C7196]">
        A <b>factory</b> makes the shoes. A <b>warehouse</b> or <b>retail</b> place holds them: you see the stock, and take orders from it. Finished runs go to a warehouse by default.
      </p>
      <div className="space-y-3">
        {stores.map((s) => (
          <div key={s.id} className="rounded-2xl border border-[#E1E8F4] p-3">
            <p className="mb-2 flex items-center gap-2 text-sm font-semibold" style={{ color: INK }}><Store size={14} /> {s.name}</p>
            <ChoiceRow value={roles[s.id]} onChange={(v) => setRoles((r) => ({ ...r, [s.id]: v }))} options={ROLES.map((r) => ({ id: r.id, label: r.label, icon: r.icon }))} />
          </div>
        ))}
      </div>
      {!hasFactory && <p className="mt-3 text-xs font-medium text-[#B9812E]">No factory chosen — Materials and Make shoes won't be available until one place is a factory.</p>}
      <div className="mt-5"><SubmitButton type="button" saving={saving} onClick={save}><Check size={15} /> Save places</SubmitButton></div>
    </ModalShell>
  );
};

/* ==================================================================== */
/*  MAIN                                                                 */
/* ==================================================================== */

// Factory menu runs in the order you should set things up: materials and
// suppliers first, then recipes/production, then orders, machines, pay.
const FACTORY_TILES = [
  { id: 'materials', label: 'Materials', icon: Boxes },
  { id: 'suppliers', label: 'Suppliers', icon: Truck },
  { id: 'make', label: 'Make shoes', icon: Hammer },
  { id: 'orders', label: 'Orders', icon: ClipboardList },
  { id: 'machines', label: 'Machines', icon: Wrench },
  { id: 'pay', label: 'Pay', icon: Wallet },
];
const PLACE_TILES = [
  { id: 'stock', label: 'Stock', icon: Warehouse },
  { id: 'orders', label: 'Orders', icon: ClipboardList },
];
const VIEWS = { orders: OrdersView, make: MakeView, materials: MaterialsView, machines: MachinesView, pay: PayView, suppliers: SuppliersView, stock: StockView };

export default function Operations({ onNotify, currentUser }) {
  const notify = useCallback((p) => onNotify && onNotify(p), [onNotify]);

  const [stores, setStores] = useState([]);
  const [storeId, setStoreId] = useState(null);
  const [section, setSection] = useState(null);
  const [followUp, setFollowUp] = useState(null);
  const [intent, setIntent] = useState(null);
  const [settings, setSettings] = useState({ loaded: false, warehouseStoreId: null, warehouseSet: false, roles: {} });
  const [placesOpen, setPlacesOpen] = useState(false);
  const [askedPlaces, setAskedPlaces] = useState(false);
  const [lists, setLists] = useState({});
  const pendingSection = useRef(null);

  const roleOf = useCallback((id) => settings.roles?.[id] || (settings.warehouseStoreId === id ? 'warehouse' : 'factory'), [settings]);
  const role = storeId ? roleOf(storeId) : 'factory';
  const isFactory = role === 'factory';
  const firstFactory = stores.find((s) => roleOf(s.id) === 'factory');
  // All places share one remembered-suggestions doc (the first factory's).
  const listsStoreId = isFactory ? storeId : firstFactory?.id || storeId;

  // Factory-only data is only listened to while a factory is open.
  const factoryId = isFactory ? storeId : null;
  const materials = useStoreDocs('opsMaterials', factoryId);
  const products = useStoreDocs('opsProducts', factoryId);
  const runs = useStoreDocs('opsRuns', factoryId);
  const machines = useStoreDocs('opsMachines', factoryId);
  const suppliers = useStoreDocs('opsSuppliers', factoryId);
  const staff = useStoreDocs('staff', factoryId, (id) => where('storeIds', 'array-contains', id));
  const allOrders = useAllDocs('opsOrders');
  const place = usePlaceStock(storeId, !isFactory);

  // The factory sees orders from every place; other places only their own.
  const orders = useMemo(() => (isFactory ? allOrders.rows : allOrders.rows.filter((o) => o.storeId === storeId)), [allOrders.rows, isFactory, storeId]);

  useEffect(() => onSnapshot(collection(db, 'stores'), (s) => setStores(s.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => a.name.localeCompare(b.name))), () => setStores([])), []);
  useEffect(() => onSnapshot(doc(db, 'opsSettings', 'main'), (s) => setSettings({ loaded: true, warehouseStoreId: null, warehouseSet: false, roles: {}, ...(s.exists() ? s.data() : {}) }), () => setSettings((x) => ({ ...x, loaded: true }))), []);
  useEffect(() => {
    if (!listsStoreId) return undefined;
    return onSnapshot(doc(db, 'opsLists', listsStoreId), (s) => setLists(s.exists() ? s.data() : {}), () => setLists({}));
  }, [listsStoreId]);
  useEffect(() => {
    if (!storeId && stores.length > 0) setStoreId(stores[0].id);
  }, [stores, storeId]);
  // Switching place resets the section, unless a jump (goMake / goStock) asked for one.
  useEffect(() => {
    setSection(pendingSection.current);
    pendingSection.current = null;
  }, [storeId]);
  useEffect(() => {
    if (settings.loaded && !settings.warehouseSet && stores.length > 0 && !askedPlaces) {
      setPlacesOpen(true);
      setAskedPlaces(true);
    }
  }, [settings, stores, askedPlaces]);

  const store = stores.find((s) => s.id === storeId);
  const jump = useCallback(
    (targetStoreId, sec) => {
      if (targetStoreId === storeId) setSection(sec);
      else {
        pendingSection.current = sec;
        setStoreId(targetStoreId);
      }
    },
    [storeId]
  );
  const goMake = useCallback(
    (i) => {
      const target = isFactory ? store : firstFactory;
      if (!target) {
        notify({ type: 'error', message: 'Set one place as a Factory first (gear icon).' });
        return;
      }
      setIntent({ type: 'startRun', ...i });
      jump(target.id, 'make');
    },
    [isFactory, store, firstFactory, jump, notify]
  );
  const goOrder = useCallback((orderId, mode) => {
    setIntent({ type: 'order', orderId, mode });
    setSection('orders');
  }, []);
  const goPlace = useCallback((runId) => {
    setIntent({ type: 'place', runId });
    setSection('make');
  }, []);
  const goStock = useCallback((placeId) => jump(placeId, 'stock'), [jump]);

  // Where finished shoes land by default: the place that took the order, else the first warehouse.
  const defaultPlace = useCallback(
    (order) => {
      if (order?.storeId && roleOf(order.storeId) !== 'factory') return order.storeId;
      return stores.find((s) => roleOf(s.id) === 'warehouse')?.id || '';
    },
    [stores, roleOf]
  );

  const ctx = {
    storeId,
    store,
    stores,
    role,
    roleOf,
    listsStoreId,
    user: currentUser,
    materials: materials.rows,
    products: products.rows,
    orders,
    runs: runs.rows,
    machines: machines.rows,
    suppliers: suppliers.rows,
    staff: staff.rows,
    stockList: place.list,
    stockLoading: place.loading,
    patchItem: place.patchItem,
    loading: isFactory ? materials.loading || products.loading || allOrders.loading || runs.loading || machines.loading || suppliers.loading : allOrders.loading,
    lists,
    settings,
    notify,
    setFollowUp,
    intent,
    clearIntent: () => setIntent(null),
    defaultPlace,
    goMake,
    goOrder,
    goPlace,
    goStock,
  };

  /* ---- overview numbers ---- */
  const today = todayStr();
  const weekAhead = new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10);
  const liveOrders = orders.filter((o) => o.workStatus !== 'cancelled');
  const openOrders = liveOrders.filter((o) => o.workStatus !== 'delivered');
  const dueSoon = openOrders.filter((o) => o.dueDate && o.dueDate <= weekAhead);
  const overdue = openOrders.filter((o) => o.dueDate && o.dueDate < today);
  const owedToYou = liveOrders.reduce((s, o) => s + Math.max(0, num(o.totalPrice) - num(o.paid)), 0);
  const lowMaterials = materials.rows.filter((m) => num(m.quantity) <= 0 || (num(m.lowStockThreshold) > 0 && num(m.quantity) <= num(m.lowStockThreshold)));
  const lowStock = place.list.filter((r) => {
    const s = stockState(r);
    return s.out || s.low;
  });
  const stockPairs = place.list.reduce((s, r) => s + totalOf(r.stockRows), 0);
  const activeRuns = runs.rows.filter((r) => r.status === 'in_progress');
  const unplaced = runs.rows.filter((r) => r.status === 'completed' && !r.placedStoreId);
  const owedSuppliers = suppliers.rows.reduce((s, x) => s + Math.max(0, num(x.owed)), 0);

  const tileInfo = {
    materials: { line: lowMaterials.length ? `${lowMaterials.length} low on stock` : `${materials.rows.length} materials`, alert: lowMaterials.length > 0 },
    suppliers: { line: owedSuppliers > 0 ? `${money(owedSuppliers)} owed` : `${suppliers.rows.length} supplier${suppliers.rows.length !== 1 ? 's' : ''}`, alert: owedSuppliers > 0 },
    make: { line: `${activeRuns.length} in progress`, sub: `${products.rows.length} product${products.rows.length !== 1 ? 's' : ''}` },
    orders: { line: dueSoon.length ? `${dueSoon.length} due this week` : `${openOrders.length} open`, sub: owedToYou > 0 ? `${money(owedToYou)} owed to you` : '', alert: overdue.length > 0 },
    machines: { line: `${machines.rows.length} machine${machines.rows.length !== 1 ? 's' : ''}` },
    pay: { line: `${staff.rows.length} team member${staff.rows.length !== 1 ? 's' : ''}` },
    stock: { line: lowStock.length ? `${lowStock.length} low or out` : `${stockPairs} pairs`, sub: place.list.length ? `${place.list.length} item${place.list.length !== 1 ? 's' : ''}` : '', alert: lowStock.length > 0 },
  };

  const attention = [
    ...overdue.slice(0, 3).map((o) => ({ key: `o${o.id}`, text: `${o.orderNo} for ${o.clientName} is overdue`, tone: 'red', go: () => goOrder(o.id) })),
    ...(isFactory ? unplaced.slice(0, 2).map((r) => ({ key: `u${r.id}`, text: `${r.madeTotal} pairs from ${r.runNo} aren't in a store yet`, tone: 'amber', go: () => goPlace(r.id) })) : []),
    ...(isFactory ? lowMaterials.slice(0, 3).map((m) => ({ key: `m${m.id}`, text: `${m.name} is ${num(m.quantity) <= 0 ? 'finished' : 'running low'}`, tone: 'amber', go: () => setSection('materials') })) : []),
    ...(!isFactory ? lowStock.slice(0, 3).map((r) => ({ key: `s${r.item.id}`, text: `${r.item.name} is ${stockState(r).out ? 'out of stock' : 'running low'}`, tone: 'amber', go: () => setSection('stock') })) : []),
  ].slice(0, 5);

  if (stores.length === 0) {
    return (
      <div className="min-h-full p-4" style={{ background: CANVAS }}>
        <EmptyState icon={Store} title="No places yet" body="Add your factory, warehouse or shop in the Stores section first, then come back to run it from here." />
      </div>
    );
  }

  const tiles = isFactory ? FACTORY_TILES : PLACE_TILES;
  const Active = section ? VIEWS[section] : null;
  const warehouseName = stores.find((s) => roleOf(s.id) === 'warehouse')?.name;

  return (
    <div className="min-h-full pb-10" style={{ background: CANVAS }}>
      <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-[#E1E8F4] bg-[#F5F8FD]/95 px-4 pb-3 pt-4 backdrop-blur">
        <div className="-mx-1 flex min-w-0 flex-1 gap-2 overflow-x-auto px-1 pb-0.5">
          {stores.map((s) => {
            const active = s.id === storeId;
            const r = roleOf(s.id);
            const RoleIcon = r === 'factory' ? Factory : r === 'warehouse' ? Warehouse : Store;
            return (
              <button key={s.id} type="button" onClick={() => setStoreId(s.id)} className={`flex shrink-0 items-center gap-2 rounded-full border-2 px-4 py-2 text-sm font-semibold transition-colors ${active ? 'border-[#2B6CDA] bg-[#2B6CDA] text-white shadow-md shadow-[#2B6CDA]/25' : 'border-[#E1E8F4] bg-white text-[#4C5E7A]'}`}>
                <RoleIcon size={14} /> {s.name}
                <span className={`text-[10px] font-medium ${active ? 'text-white/70' : 'text-[#8CA0BC]'}`}>{ROLE_LABEL[r]}</span>
              </button>
            );
          })}
        </div>
        <button type="button" onClick={() => setPlacesOpen(true)} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[#E1E8F4] bg-white text-[#5C7196] hover:text-[#2B6CDA]" aria-label="Set up places" title="Factory, warehouse or retail?">
          <Settings size={16} />
        </button>
      </div>

      <div className="px-4">
        <AnimatePresence mode="wait">
          {!section ? (
            <motion.div key="home" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
              <div className="mt-4">
                <h3 className="text-lg font-semibold" style={{ color: INK }}>{store?.name}</h3>
                <p className="text-sm text-[#8CA0BC]">
                  {isFactory
                    ? warehouseName
                      ? `Set up top to bottom. Finished shoes go to ${warehouseName}.`
                      : 'Set up top to bottom. Choose a warehouse with the gear above.'
                    : `${ROLE_LABEL[role]} · see what is on the shelf and take orders from it.`}
                </p>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
                {tiles.map((t, idx) => {
                  const info = tileInfo[t.id];
                  return (
                    <motion.button key={t.id} type="button" whileTap={{ scale: 0.97 }} onClick={() => setSection(t.id)} className={`relative flex flex-col items-start gap-3 rounded-[22px] border-2 bg-white p-4 text-left shadow-sm shadow-[#0F2242]/[0.03] transition-shadow hover:shadow-lg hover:shadow-[#2B6CDA]/[0.10] sm:p-5 ${info.alert ? 'border-[#F0DCAF]' : 'border-[#EAF0F9]'}`}>
                      {isFactory && <span className="absolute right-3.5 top-3.5 flex h-5 w-5 items-center justify-center rounded-full bg-[#EEF2F7] text-[11px] font-semibold text-[#64748B]">{idx + 1}</span>}
                      <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#EAF2FE] text-[#2B6CDA]"><t.icon size={20} strokeWidth={1.8} /></span>
                      <div>
                        <p className="text-base font-semibold" style={{ color: INK }}>{t.label}</p>
                        <p className={`text-xs font-medium ${info.alert ? 'text-[#B9812E]' : 'text-[#8CA0BC]'}`}>{info.line}</p>
                        {info.sub && <p className={`text-xs font-medium ${t.id === 'orders' ? 'text-[#C0433A]' : 'text-[#8CA0BC]'}`}>{info.sub}</p>}
                      </div>
                    </motion.button>
                  );
                })}
              </div>

              {attention.length > 0 && (
                <div className="mt-6">
                  <SectionLabel>Needs your attention</SectionLabel>
                  <div className="space-y-2">
                    {attention.map((a) => (
                      <button key={a.key} type="button" onClick={a.go} className={`flex w-full items-center justify-between gap-3 rounded-2xl border px-4 py-3 text-left text-sm font-medium ${a.tone === 'red' ? 'border-[#F5D3CE] bg-[#FBEAE8]/60 text-[#8A342C]' : 'border-[#F0DCAF] bg-[#FBF0DA]/60 text-[#8A611E]'}`}>
                        <span className="flex items-center gap-2"><AlertTriangle size={14} className="shrink-0" />{a.text}</span>
                        <ArrowRight size={14} className="shrink-0" />
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </motion.div>
          ) : (
            <motion.div key={`${storeId}-${section}`} initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }}>
              <button type="button" onClick={() => setSection(null)} className="mt-4 flex items-center gap-1 text-sm font-semibold text-[#2B6CDA]">
                <ChevronLeft size={16} /> {store?.name}
              </button>
              {Active && <Active ctx={ctx} />}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <AnimatePresence>{placesOpen && <PlacesModal stores={stores} roleOf={roleOf} notify={notify} onSaved={() => setSection(null)} onClose={() => setPlacesOpen(false)} />}</AnimatePresence>
      <AnimatePresence>{followUp && <FollowUpDialog data={followUp} onClose={() => setFollowUp(null)} />}</AnimatePresence>
    </div>
  );
}