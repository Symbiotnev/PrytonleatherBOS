import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Users,
  User,
  BadgeCheck,
  IdCard,
  Phone,
  CalendarDays,
  Plus,
  X,
  Pencil,
  Trash2,
  Loader2,
  Eye,
  MoreVertical,
  Store,
  Check,
} from 'lucide-react';
import {
  collection,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  orderBy,
  serverTimestamp,
} from 'firebase/firestore';
import { db } from '../Libs/firebase_config.mjs';

/* ------------------------------------------------------------------ */
/*  Config                                                             */
/* ------------------------------------------------------------------ */

// Quick-pick suggestions for the role field. The field itself is free
// text, so anything can be typed — these just save typing.
const ROLE_SUGGESTIONS = ['Manager', 'Sales attendant', 'Cashier', 'Cutter', 'Stitcher', 'Finisher', 'Driver'];

/* ------------------------------------------------------------------ */
/*  Subtle background texture                                          */
/* ------------------------------------------------------------------ */

const AmbientDotGrid = ({ className = '' }) => (
  <motion.div
    aria-hidden
    className={`pointer-events-none absolute inset-0 ${className}`}
    style={{
      backgroundImage: 'radial-gradient(#BFDAF0 1px, transparent 1px)',
      backgroundSize: '20px 20px',
      maskImage: 'radial-gradient(ellipse 65% 55% at 50% 0%, black 30%, transparent 100%)',
    }}
    initial={{ opacity: 0.15 }}
    animate={{ opacity: [0.15, 0.32, 0.15] }}
    transition={{ duration: 6, repeat: Infinity, ease: 'easeInOut' }}
  />
);

const CardDotGrid = ({ className = '' }) => (
  <div
    aria-hidden
    className={`pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-40 ${className}`}
    style={{
      backgroundImage: 'radial-gradient(#BFDAF0 1px, transparent 1px)',
      backgroundSize: '16px 16px',
      maskImage: 'radial-gradient(ellipse 70% 60% at 50% 0%, black 30%, transparent 100%)',
    }}
  />
);

/* ------------------------------------------------------------------ */
/*  Helpers                                                             */
/* ------------------------------------------------------------------ */

const getInitials = (name) => {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
};

// startDate is stored as a plain 'YYYY-MM-DD' string (what <input type="date">
// produces). Parsing it by hand avoids the timezone shift you get from
// `new Date('YYYY-MM-DD')`, which is read as UTC.
const parseLocalDate = (value) => {
  if (!value || typeof value !== 'string') return null;
  const [y, m, d] = value.split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
};

const todayISO = () => {
  const now = new Date();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${mm}-${dd}`;
};

const formatStartDate = (value) => {
  const date = parseLocalDate(value);
  if (!date) return '';
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
};

// "2 yrs 3 mos", "8 mos", "Less than a month"
const formatTenure = (value) => {
  const start = parseLocalDate(value);
  if (!start) return '';
  const now = new Date();
  let months = (now.getFullYear() - start.getFullYear()) * 12 + (now.getMonth() - start.getMonth());
  if (now.getDate() < start.getDate()) months -= 1;
  if (months < 0) return 'Not started yet';
  if (months < 1) return 'Less than a month';
  const years = Math.floor(months / 12);
  const rest = months % 12;
  const parts = [];
  if (years) parts.push(`${years} ${years === 1 ? 'yr' : 'yrs'}`);
  if (rest) parts.push(`${rest} ${rest === 1 ? 'mo' : 'mos'}`);
  return parts.join(' ');
};

// Resolves a member's store IDs into display names. `missing` counts IDs
// whose store has since been deleted, so the UI can flag it instead of
// silently showing nothing.
const resolveStores = (storeIds, stores) => {
  const ids = Array.isArray(storeIds) ? storeIds : [];
  const byId = new Map(stores.map((s) => [s.id, s.name]));
  return {
    names: ids.map((id) => byId.get(id)).filter(Boolean),
    missing: ids.filter((id) => !byId.has(id)).length,
  };
};

/* ------------------------------------------------------------------ */
/*  Reusable pill field                                                 */
/* ------------------------------------------------------------------ */

const ModalField = ({
  id,
  label,
  icon: Icon,
  value,
  onChange,
  required = false,
  placeholder,
  type = 'text',
  max,
  inputMode,
}) => (
  <div>
    <label htmlFor={id} className="mb-1.5 block text-xs font-medium text-[#6B7C8C]">
      {label}
      {!required && <span className="ml-1 font-normal text-[#9FB4C7]">(optional)</span>}
    </label>
    <div className="flex items-center gap-3 rounded-full border-2 border-[#E4EBF1] bg-[#FBF8F3] px-4 py-2.5 transition-colors focus-within:border-[#1E6BA8] focus-within:bg-white focus-within:shadow-[0_0_0_4px_rgba(30,107,168,0.10)]">
      <Icon size={16} className="shrink-0 text-[#9FB4C7]" />
      <input
        id={id}
        type={type}
        value={value}
        onChange={onChange}
        required={required}
        placeholder={placeholder}
        max={max}
        inputMode={inputMode}
        className="w-full bg-transparent text-sm text-[#16324F] outline-none placeholder:text-[#B7C4CF]"
      />
    </div>
  </div>
);

/* ------------------------------------------------------------------ */
/*  Role field — free text with quick-pick suggestion chips             */
/* ------------------------------------------------------------------ */

const RoleField = ({ value, onChange }) => (
  <div>
    <ModalField
      id="staff-role"
      label="Role"
      icon={BadgeCheck}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      required
      placeholder="e.g. Sales attendant"
    />
    <div className="mt-2 flex flex-wrap gap-1.5">
      {ROLE_SUGGESTIONS.map((r) => {
        const selected = value.trim().toLowerCase() === r.toLowerCase();
        return (
          <button
            key={r}
            type="button"
            onClick={() => onChange(r)}
            className="rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors"
            style={{
              borderColor: selected ? '#1E6BA8' : '#E4EBF1',
              backgroundColor: selected ? 'rgba(30,107,168,0.08)' : '#FFFFFF',
              color: selected ? '#1E6BA8' : '#6B7C8C',
            }}
          >
            {r}
          </button>
        );
      })}
    </div>
  </div>
);

/* ------------------------------------------------------------------ */
/*  Store picker — multi-select chips. A staff member can be attached   */
/*  to several stores (or factories); at least one is required.         */
/* ------------------------------------------------------------------ */

const StorePicker = ({ stores, storesLoading, selectedIds, onToggle }) => (
  <div>
    <label className="mb-1.5 block text-xs font-medium text-[#6B7C8C]">
      Stores
      <span className="ml-1 font-normal text-[#9FB4C7]">({selectedIds.length} selected)</span>
    </label>

    {storesLoading ? (
      <div className="flex gap-2">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-9 w-24 animate-pulse rounded-full bg-[#EFEAE0]" />
        ))}
      </div>
    ) : stores.length === 0 ? (
      <p className="rounded-2xl border border-dashed border-[#BFD6E8] bg-[#1E6BA8]/[0.04] px-3.5 py-3 text-xs leading-relaxed text-[#6B7C8C]">
        No stores yet — add one in the Stores tab first, then come back to attach staff to it.
      </p>
    ) : (
      <div className="flex max-h-36 flex-wrap gap-1.5 overflow-y-auto rounded-2xl border border-[#E4EBF1] bg-[#FBF8F3] p-2.5">
        {stores.map((store) => {
          const isSelected = selectedIds.includes(store.id);
          return (
            <button
              key={store.id}
              type="button"
              onClick={() => onToggle(store.id)}
              className="flex items-center gap-1.5 rounded-full border-2 px-3 py-1.5 text-xs font-medium transition-colors"
              style={{
                borderColor: isSelected ? '#1E6BA8' : '#E4EBF1',
                backgroundColor: isSelected ? '#1E6BA8' : '#FFFFFF',
                color: isSelected ? '#FFFFFF' : '#16324F',
              }}
            >
              {isSelected ? <Check size={12} /> : <Store size={12} className="text-[#9FB4C7]" />}
              {store.name}
            </button>
          );
        })}
      </div>
    )}
  </div>
);

/* ------------------------------------------------------------------ */
/*  Add / Edit modal                                                    */
/* ------------------------------------------------------------------ */

const StaffModal = ({ initialMember, stores, storesLoading, onClose, onSave, saving }) => {
  const [form, setForm] = useState({
    fullName: initialMember?.fullName || '',
    role: initialMember?.role || '',
    storeIds: Array.isArray(initialMember?.storeIds) ? initialMember.storeIds : [],
    phone: initialMember?.phone || '',
    idNumber: initialMember?.idNumber || '',
    startDate: initialMember?.startDate || '',
  });

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const toggleStore = (id) =>
    setForm((f) => ({
      ...f,
      storeIds: f.storeIds.includes(id) ? f.storeIds.filter((x) => x !== id) : [...f.storeIds, id],
    }));

  const canSubmit = form.fullName.trim() && form.role.trim() && form.storeIds.length > 0;

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!canSubmit) return;
    onSave({
      fullName: form.fullName.trim(),
      role: form.role.trim(),
      storeIds: form.storeIds,
      phone: form.phone.trim(),
      idNumber: form.idNumber.trim(),
      startDate: form.startDate,
    });
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#0F3355]/40 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.form
        onSubmit={handleSubmit}
        onClick={(e) => e.stopPropagation()}
        initial={{ opacity: 0, y: 16, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 10, scale: 0.97 }}
        transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
        className="relative max-h-[90dvh] w-full max-w-sm overflow-y-auto rounded-3xl bg-white p-6 shadow-2xl shadow-black/10 sm:p-7"
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 rounded-full p-1.5 text-[#9FB4C7] transition-colors hover:bg-[#1E6BA8]/[0.08] hover:text-[#1E6BA8]"
          aria-label="Close"
        >
          <X size={16} />
        </button>

        <div className="mb-5 flex items-center gap-2.5">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#1E6BA8]/[0.08] text-[#1E6BA8]">
            <Users size={18} />
          </div>
          <h2 className="text-base font-semibold text-[#16324F]">
            {initialMember ? 'Edit staff member' : 'Add a staff member'}
          </h2>
        </div>

        <div className="space-y-4">
          <ModalField
            id="staff-name"
            label="Full name"
            icon={User}
            value={form.fullName}
            onChange={set('fullName')}
            required
            placeholder="Jane Wanjiru"
          />
          <RoleField value={form.role} onChange={(role) => setForm((f) => ({ ...f, role }))} />
          <StorePicker
            stores={stores}
            storesLoading={storesLoading}
            selectedIds={form.storeIds}
            onToggle={toggleStore}
          />

          <div className="border-t border-[#EFEAE0] pt-4">
            <p className="mb-3 text-[11px] font-medium uppercase tracking-wide text-[#8496A6]">
              More details
            </p>
            <div className="space-y-4">
              <ModalField
                id="staff-start"
                label="Started working"
                icon={CalendarDays}
                type="date"
                max={todayISO()}
                value={form.startDate}
                onChange={set('startDate')}
              />
              <ModalField
                id="staff-phone"
                label="Phone"
                icon={Phone}
                type="tel"
                inputMode="tel"
                value={form.phone}
                onChange={set('phone')}
                placeholder="07xx xxx xxx"
              />
              <ModalField
                id="staff-id"
                label="ID number"
                icon={IdCard}
                inputMode="numeric"
                value={form.idNumber}
                onChange={set('idNumber')}
                placeholder="National ID number"
              />
            </div>
          </div>
        </div>

        <motion.button
          type="submit"
          disabled={saving || !canSubmit}
          whileTap={{ scale: 0.97 }}
          className="mt-6 flex w-full items-center justify-center gap-2 rounded-full bg-[#1E6BA8] py-3 text-sm font-semibold text-white shadow-lg shadow-[#1E6BA8]/30 transition-opacity disabled:opacity-60"
        >
          {saving && (
            <motion.span animate={{ rotate: 360 }} transition={{ duration: 0.7, repeat: Infinity, ease: 'linear' }}>
              <Loader2 size={16} />
            </motion.span>
          )}
          {saving ? 'Saving…' : initialMember ? 'Save changes' : 'Add staff member'}
        </motion.button>
      </motion.form>
    </motion.div>
  );
};

/* ------------------------------------------------------------------ */
/*  View details modal                                                  */
/* ------------------------------------------------------------------ */

const DetailRow = ({ icon: Icon, label, children }) => (
  <div className="flex items-center gap-2.5 rounded-2xl border border-[#E4EBF1] bg-[#FBF8F3] px-4 py-3">
    <Icon size={15} className="shrink-0 text-[#9FB4C7]" />
    <div className="min-w-0">
      <p className="text-[11px] text-[#8496A6]">{label}</p>
      <div className="text-sm font-medium text-[#16324F]">{children}</div>
    </div>
  </div>
);

const ViewStaffModal = ({ member, stores, onClose }) => {
  const { names: storeNames, missing: missingStores } = resolveStores(member.storeIds, stores);
  const tenure = formatTenure(member.startDate);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#0F3355]/40 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        onClick={(e) => e.stopPropagation()}
        initial={{ opacity: 0, y: 16, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 10, scale: 0.97 }}
        transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
        className="relative max-h-[90dvh] w-full max-w-sm overflow-y-auto rounded-3xl bg-white p-6 shadow-2xl shadow-black/10 sm:p-7"
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 rounded-full p-1.5 text-[#9FB4C7] transition-colors hover:bg-[#1E6BA8]/[0.08] hover:text-[#1E6BA8]"
          aria-label="Close"
        >
          <X size={16} />
        </button>

        <div className="flex items-center gap-3 pr-6">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#1B4F80] to-[#2C7CB8] text-sm font-semibold text-white">
            {getInitials(member.fullName)}
          </div>
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold text-[#16324F]">{member.fullName}</h2>
            <span className="mt-0.5 inline-flex items-center gap-1 rounded-full bg-[#1E6BA8]/[0.08] px-2 py-0.5 text-[10px] font-medium text-[#1E6BA8]">
              <BadgeCheck size={11} />
              {member.role}
            </span>
          </div>
        </div>

        <div className="mt-5 space-y-3">
          <DetailRow icon={Store} label={storeNames.length === 1 ? 'Store' : 'Stores'}>
            {storeNames.length > 0 && (
              <div className="mt-1 flex flex-wrap gap-1.5">
                {storeNames.map((name) => (
                  <span
                    key={name}
                    className="rounded-full bg-[#1E6BA8]/[0.08] px-2.5 py-1 text-[11px] font-medium text-[#1E6BA8]"
                  >
                    {name}
                  </span>
                ))}
              </div>
            )}
            {missingStores > 0 && (
              <p className="mt-1 text-xs font-medium text-[#B3413B]">
                {missingStores === 1 ? '1 store no longer exists' : `${missingStores} stores no longer exist`}
              </p>
            )}
            {storeNames.length === 0 && missingStores === 0 && (
              <span className="font-normal text-[#8496A6]">None assigned</span>
            )}
          </DetailRow>

          <DetailRow icon={CalendarDays} label="Started working">
            {member.startDate ? (
              <>
                {formatStartDate(member.startDate)}
                {tenure && <span className="ml-1.5 text-xs font-normal text-[#8496A6]">· {tenure}</span>}
              </>
            ) : (
              <span className="font-normal text-[#8496A6]">Not recorded</span>
            )}
          </DetailRow>

          <DetailRow icon={Phone} label="Phone">
            {member.phone ? (
              <a href={`tel:${member.phone}`} className="text-[#1E6BA8] hover:underline">
                {member.phone}
              </a>
            ) : (
              <span className="font-normal text-[#8496A6]">Not recorded</span>
            )}
          </DetailRow>

          <DetailRow icon={IdCard} label="ID number">
            {member.idNumber || <span className="font-normal text-[#8496A6]">Not recorded</span>}
          </DetailRow>
        </div>
      </motion.div>
    </motion.div>
  );
};

/* ------------------------------------------------------------------ */
/*  Mobile action sheet                                                 */
/* ------------------------------------------------------------------ */

const MobileActionSheet = ({ title, subtitle, actions, onClose }) => (
  <motion.div
    initial={{ opacity: 0 }}
    animate={{ opacity: 1 }}
    exit={{ opacity: 0 }}
    transition={{ duration: 0.2 }}
    className="fixed inset-0 z-50 flex items-end justify-center bg-[#0F3355]/40 backdrop-blur-sm sm:hidden"
    onClick={onClose}
  >
    <motion.div
      onClick={(e) => e.stopPropagation()}
      initial={{ y: 60, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: 40, opacity: 0 }}
      transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
      className="w-full rounded-t-3xl bg-white p-5 shadow-2xl shadow-black/10"
      style={{ paddingBottom: 'calc(1.25rem + env(safe-area-inset-bottom))' }}
    >
      <div className="mx-auto mb-4 h-1.5 w-12 rounded-full bg-[#E4EBF1]" />
      {title && (
        <div className="mb-3 px-1">
          <p className="truncate text-sm font-semibold text-[#16324F]">{title}</p>
          {subtitle && <p className="truncate text-xs text-[#8496A6]">{subtitle}</p>}
        </div>
      )}
      <div className="space-y-1">
        {actions.map((a) => (
          <button
            key={a.label}
            type="button"
            onClick={() => {
              a.onClick();
              onClose();
            }}
            className={`flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-left text-sm font-medium transition-colors ${
              a.danger ? 'text-[#B3413B] hover:bg-[#B3413B]/[0.08]' : 'text-[#16324F] hover:bg-[#1E6BA8]/[0.08]'
            }`}
          >
            <span
              className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
                a.danger ? 'bg-[#B3413B]/[0.08] text-[#B3413B]' : 'bg-[#1E6BA8]/[0.08] text-[#1E6BA8]'
              }`}
            >
              <a.icon size={15} />
            </span>
            {a.label}
          </button>
        ))}
      </div>
    </motion.div>
  </motion.div>
);

/* ------------------------------------------------------------------ */
/*  Custom delete-confirm dialog                                        */
/* ------------------------------------------------------------------ */

const ConfirmRemoveDialog = ({ member, onCancel, onConfirm, removing }) => (
  <motion.div
    initial={{ opacity: 0 }}
    animate={{ opacity: 1 }}
    exit={{ opacity: 0 }}
    transition={{ duration: 0.2 }}
    className="fixed inset-0 z-50 flex items-center justify-center bg-[#0F3355]/40 p-4 backdrop-blur-sm"
    onClick={onCancel}
  >
    <motion.div
      onClick={(e) => e.stopPropagation()}
      initial={{ opacity: 0, y: 12, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 8, scale: 0.96 }}
      transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
      className="w-full max-w-xs rounded-3xl bg-white p-6 text-center shadow-2xl shadow-black/10"
    >
      <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-[#B3413B]/[0.08] text-[#B3413B]">
        <Trash2 size={18} />
      </div>
      <h3 className="mt-3 text-sm font-semibold text-[#16324F]">Remove {member.fullName}?</h3>
      <p className="mt-1 text-xs leading-relaxed text-[#8496A6]">
        Their record will be permanently deleted from your staff list. This can't be undone.
      </p>
      <div className="mt-5 flex gap-2.5">
        <button
          type="button"
          onClick={onCancel}
          className="flex-1 rounded-full border border-[#E4EBF1] py-2.5 text-sm font-medium text-[#6B7C8C] transition-colors hover:bg-[#EFEAE0]/50"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={removing}
          className="flex-1 rounded-full bg-[#B3413B] py-2.5 text-sm font-semibold text-white transition-opacity disabled:opacity-60"
        >
          {removing ? 'Removing…' : 'Remove'}
        </button>
      </div>
    </motion.div>
  </motion.div>
);

/* ------------------------------------------------------------------ */
/*  Main component                                                      */
/* ------------------------------------------------------------------ */

export default function Staff({ onNotify }) {
  const notify = onNotify || (() => {});

  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [storeFilter, setStoreFilter] = useState('all'); // 'all' | storeId
  const [modalMember, setModalMember] = useState(undefined); // undefined = closed, null = add, object = edit
  const [viewTarget, setViewTarget] = useState(null);
  const [removeTarget, setRemoveTarget] = useState(null);
  const [sheetTarget, setSheetTarget] = useState(null);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);

  // Stores list — powers the store picker and the name lookups wherever a
  // member's store is shown.
  const [stores, setStores] = useState([]);
  const [storesLoading, setStoresLoading] = useState(true);

  useEffect(() => {
    const q = query(collection(db, 'staff'), orderBy('createdAt', 'desc'));
    const unsub = onSnapshot(
      q,
      { includeMetadataChanges: true },
      (snap) => {
        const docs = snap.docs.map((d) => ({
          id: d.id,
          ...d.data(),
          _pending: d.metadata.hasPendingWrites,
        }));
        // createdAt is null locally until the server confirms the write, so
        // pin unconfirmed docs to the top — a newly-added member appears
        // instantly and then settles into normal order.
        docs.sort((a, b) => {
          if (a._pending && !b._pending) return -1;
          if (!a._pending && b._pending) return 1;
          const aTime = a.createdAt?.toMillis?.() ?? 0;
          const bTime = b.createdAt?.toMillis?.() ?? 0;
          return bTime - aTime;
        });
        setMembers(docs);
        setLoading(false);
      },
      () => setLoading(false)
    );
    return unsub;
  }, []);

  useEffect(() => {
    const q = query(collection(db, 'stores'), orderBy('name', 'asc'));
    const unsub = onSnapshot(
      q,
      (snap) => {
        setStores(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
        setStoresLoading(false);
      },
      () => setStoresLoading(false)
    );
    return unsub;
  }, []);

  const visibleMembers = members.filter((m) => storeFilter === 'all' || (Array.isArray(m.storeIds) && m.storeIds.includes(storeFilter))
  );

  const handleSave = useCallback(
    async (form) => {
      setSaving(true);
      try {
        if (modalMember && modalMember.id) {
          await updateDoc(doc(db, 'staff', modalMember.id), {
            ...form,
            updatedAt: serverTimestamp(),
          });
          notify({ type: 'success', message: `${form.fullName} updated.` });
        } else {
          // Not awaiting the server round-trip before closing the modal —
          // the SDK writes to the local cache immediately, so the card
          // shows up right away. Failures still surface via the catch.
          addDoc(collection(db, 'staff'), {
            ...form,
            createdAt: serverTimestamp(),
          }).catch((err) => {
            notify({ type: 'error', message: err?.message || 'Could not save staff member.' });
          });
          notify({ type: 'success', message: `${form.fullName} added.` });
        }
        setModalMember(undefined);
      } catch (err) {
        notify({ type: 'error', message: err?.message || 'Could not save staff member.' });
      } finally {
        setSaving(false);
      }
    },
    [modalMember, notify]
  );

  const handleRemove = useCallback(async () => {
    if (!removeTarget) return;
    setRemoving(true);
    try {
      await deleteDoc(doc(db, 'staff', removeTarget.id));
      notify({ type: 'success', message: `${removeTarget.fullName} removed.` });
      setRemoveTarget(null);
    } catch (err) {
      notify({ type: 'error', message: err?.message || 'Could not remove staff member.' });
    } finally {
      setRemoving(false);
    }
  }, [removeTarget, notify]);

  return (
    <div className="relative mt-6 sm:mt-8">
      <AmbientDotGrid />

      <div className="relative flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-[#16324F] sm:text-lg">Staff</h2>
          <p className="text-xs text-[#8496A6] sm:text-sm">Keep a record of your team and where they work.</p>
        </div>
        <motion.button
          type="button"
          whileTap={{ scale: 0.96 }}
          onClick={() => setModalMember(null)}
          className="flex shrink-0 items-center gap-1.5 rounded-full bg-[#1E6BA8] px-4 py-2.5 text-xs font-semibold text-white shadow-md shadow-[#1E6BA8]/25 sm:text-sm"
        >
          <Plus size={15} />
          Add staff
        </motion.button>
      </div>

      {/* store filter pills — only worth showing once there's something to filter */}
      {stores.length > 0 && members.length > 0 && (
        <div className="relative mt-5 -mx-1 overflow-x-auto px-1 pb-1">
          <div className="inline-flex rounded-full bg-[#EFEAE0] p-1">
            {[{ id: 'all', name: 'All' }, ...stores].map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setStoreFilter(s.id)}
                className="relative z-10 shrink-0 whitespace-nowrap rounded-full px-4 py-2 text-xs font-medium transition-colors"
                style={{ color: storeFilter === s.id ? '#FFFFFF' : '#6B7C8C' }}
              >
                {storeFilter === s.id && (
                  <motion.div
                    layoutId="staff-filter-pill"
                    className="absolute inset-0 -z-10 rounded-full bg-[#1E6BA8] shadow-md shadow-[#1E6BA8]/30"
                    transition={{ type: 'spring', stiffness: 340, damping: 28 }}
                  />
                )}
                {s.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {loading ? (
        <div className="relative mt-8 flex justify-center py-10 text-[#9FB4C7]">
          <Loader2 size={20} className="animate-spin" />
        </div>
      ) : visibleMembers.length === 0 ? (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
          className="relative mt-5 flex flex-col items-start gap-3 rounded-2xl border border-dashed border-[#BFD6E8] bg-[#1E6BA8]/[0.04] p-6 sm:p-8"
        >
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#1E6BA8]/[0.08] text-[#1E6BA8]">
            <Users size={18} />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-[#16324F]">
              {members.length === 0 ? 'No staff yet' : 'Nobody at this store'}
            </h3>
            <p className="mt-1 text-sm text-[#6B7C8C]">
              {members.length === 0
                ? 'Add your first team member to start keeping their details on record.'
                : 'No staff are attached to this store yet.'}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setModalMember(null)}
            className="mt-1 rounded-full bg-[#1E6BA8] px-4 py-2 text-xs font-semibold text-white"
          >
            Add staff
          </button>
        </motion.div>
      ) : (
        <motion.div layout className="relative mt-5 grid grid-cols-1 gap-3 sm:mt-6 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3">
          <AnimatePresence initial={false}>
            {visibleMembers.map((member) => {
              const { names: storeNames, missing: missingStores } = resolveStores(member.storeIds, stores);
              const showMissing = missingStores > 0 && !storesLoading;
              const tenure = formatTenure(member.startDate);
              return (
                <motion.div
                  key={member.id}
                  layout
                  initial={{ opacity: 0, y: 10, scale: 0.97 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.96 }}
                  transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
                  onClick={() => setViewTarget(member)}
                  className="group relative cursor-pointer overflow-hidden rounded-2xl border border-[#E4EBF1] bg-white p-4 shadow-sm shadow-black/[0.02] transition-shadow hover:shadow-md sm:p-5"
                >
                  <CardDotGrid />

                  <div className="relative flex items-start justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-3">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#1B4F80] to-[#2C7CB8] text-xs font-semibold text-white">
                        {getInitials(member.fullName)}
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-[#16324F]">{member.fullName}</p>
                        <p className="truncate text-xs text-[#8496A6]">{member.role}</p>
                      </div>
                    </div>

                    {member._pending && (
                      <span className="flex shrink-0 items-center gap-1 rounded-full bg-[#1E6BA8]/[0.08] px-2 py-0.5 text-[10px] font-medium text-[#1E6BA8]">
                        <Loader2 size={10} className="animate-spin" />
                        Saving
                      </span>
                    )}
                  </div>

                  <div className="relative mt-3 space-y-1.5 text-xs text-[#6B7C8C]">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Store size={13} className="shrink-0 text-[#9FB4C7]" />
                      {storeNames.slice(0, 2).map((name) => (
                        <span
                          key={name}
                          className="truncate rounded-full bg-[#EFEAE0] px-2 py-0.5 text-[10px] font-medium text-[#6B7C8C]"
                        >
                          {name}
                        </span>
                      ))}
                      {storeNames.length > 2 && (
                        <span className="text-[10px] font-medium text-[#8496A6]">
                          +{storeNames.length - 2} more
                        </span>
                      )}
                      {showMissing && (
                        <span className="text-[10px] font-medium text-[#B3413B]">
                          {missingStores === 1 ? '1 store removed' : `${missingStores} stores removed`}
                        </span>
                      )}
                      {storeNames.length === 0 && !showMissing && !storesLoading && (
                        <span className="text-[10px] font-medium text-[#B3413B]">No store assigned</span>
                      )}
                    </div>
                    {tenure && (
                      <div className="flex items-center gap-1.5">
                        <CalendarDays size={13} className="shrink-0 text-[#9FB4C7]" />
                        <span>{tenure} with the business</span>
                      </div>
                    )}
                  </div>

                  <div
                    className="relative mt-3 flex items-center justify-end border-t border-[#EFEAE0] pt-3"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {/* Desktop/tablet — icons always visible with a tint. */}
                    <div className="hidden items-center gap-1 sm:flex">
                      <button
                        type="button"
                        onClick={() => setViewTarget(member)}
                        className="rounded-full bg-[#1E6BA8]/[0.08] p-1.5 text-[#1E6BA8] transition-colors hover:bg-[#1E6BA8]/[0.18]"
                        aria-label="View details"
                      >
                        <Eye size={14} />
                      </button>
                      <button
                        type="button"
                        onClick={() => setModalMember(member)}
                        className="rounded-full bg-[#1E6BA8]/[0.08] p-1.5 text-[#1E6BA8] transition-colors hover:bg-[#1E6BA8]/[0.18]"
                        aria-label="Edit staff member"
                      >
                        <Pencil size={14} />
                      </button>
                      <button
                        type="button"
                        onClick={() => setRemoveTarget(member)}
                        className="rounded-full bg-[#B3413B]/[0.08] p-1.5 text-[#B3413B] transition-colors hover:bg-[#B3413B]/[0.18]"
                        aria-label="Remove staff member"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>

                    {/* Mobile — single "more" button opens a bottom sheet. */}
                    <button
                      type="button"
                      onClick={() => setSheetTarget(member)}
                      className="rounded-full bg-[#1E6BA8]/[0.08] p-1.5 text-[#1E6BA8] transition-colors hover:bg-[#1E6BA8]/[0.18] sm:hidden"
                      aria-label="More actions"
                    >
                      <MoreVertical size={15} />
                    </button>
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </motion.div>
      )}

      <AnimatePresence>
        {modalMember !== undefined && (
          <StaffModal
            initialMember={modalMember}
            stores={stores}
            storesLoading={storesLoading}
            saving={saving}
            onClose={() => setModalMember(undefined)}
            onSave={handleSave}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {viewTarget && <ViewStaffModal member={viewTarget} stores={stores} onClose={() => setViewTarget(null)} />}
      </AnimatePresence>

      <AnimatePresence>
        {removeTarget && (
          <ConfirmRemoveDialog
            member={removeTarget}
            removing={removing}
            onCancel={() => setRemoveTarget(null)}
            onConfirm={handleRemove}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {sheetTarget && (
          <MobileActionSheet
            title={sheetTarget.fullName}
            subtitle={sheetTarget.role}
            onClose={() => setSheetTarget(null)}
            actions={[
              { label: 'View details', icon: Eye, onClick: () => setViewTarget(sheetTarget) },
              { label: 'Edit staff member', icon: Pencil, onClick: () => setModalMember(sheetTarget) },
              { label: 'Remove staff member', icon: Trash2, danger: true, onClick: () => setRemoveTarget(sheetTarget) },
            ]}
          />
        )}
      </AnimatePresence>
    </div>
  );
}