import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Store,
  MapPin,
  Landmark,
  Phone,
  Clock,
  AlignLeft,
  Plus,
  X,
  Pencil,
  Trash2,
  Loader2,
  MoreVertical,
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

// Keep in sync with the `description` size limit in firestore.rules.
const DESCRIPTION_MAX = 500;

/* ------------------------------------------------------------------ */
/*  Subtle background texture — a faint dot-grid that breathes very    */
/*  slowly, so the page doesn't feel bare but never competes with the  */
/*  content sitting on top of it.                                      */
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
/*  Small reusable pill field — same visual language as Auth.jsx's     */
/*  FloatingField, trimmed down for use inside a modal on a white bg   */
/* ------------------------------------------------------------------ */

const ModalField = ({ id, label, icon: Icon, value, onChange, required = false, placeholder }) => (
  <div>
    <label htmlFor={id} className="mb-1.5 block text-xs font-medium text-[#6B7C8C]">
      {label}
      {!required && <span className="ml-1 font-normal text-[#9FB4C7]">(optional)</span>}
    </label>
    <div className="flex items-center gap-3 rounded-full border-2 border-[#E4EBF1] bg-[#FBF8F3] px-4 py-2.5 transition-colors focus-within:border-[#1E6BA8] focus-within:bg-white focus-within:shadow-[0_0_0_4px_rgba(30,107,168,0.10)]">
      <Icon size={16} className="shrink-0 text-[#9FB4C7]" />
      <input
        id={id}
        value={value}
        onChange={onChange}
        required={required}
        placeholder={placeholder}
        className="w-full bg-transparent text-sm text-[#16324F] outline-none placeholder:text-[#B7C4CF]"
      />
    </div>
  </div>
);

/* ------------------------------------------------------------------ */
/*  Multi-line field for the store description. Rounded-2xl instead of */
/*  a full pill so the corners don't clip the text, with a live        */
/*  character counter against the rules' size limit.                   */
/* ------------------------------------------------------------------ */

const ModalTextarea = ({ id, label, icon: Icon, value, onChange, placeholder, maxLength }) => (
  <div>
    <label htmlFor={id} className="mb-1.5 flex items-center justify-between text-xs font-medium text-[#6B7C8C]">
      <span>
        {label}
        <span className="ml-1 font-normal text-[#9FB4C7]">(optional)</span>
      </span>
      <span className="font-normal text-[#9FB4C7]">
        {value.length}/{maxLength}
      </span>
    </label>
    <div className="flex items-start gap-3 rounded-2xl border-2 border-[#E4EBF1] bg-[#FBF8F3] px-4 py-3 transition-colors focus-within:border-[#1E6BA8] focus-within:bg-white focus-within:shadow-[0_0_0_4px_rgba(30,107,168,0.10)]">
      <Icon size={16} className="mt-0.5 shrink-0 text-[#9FB4C7]" />
      <textarea
        id={id}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        maxLength={maxLength}
        rows={4}
        className="w-full resize-none bg-transparent text-sm leading-relaxed text-[#16324F] outline-none placeholder:text-[#B7C4CF]"
      />
    </div>
  </div>
);

/* ------------------------------------------------------------------ */
/*  Add / Edit modal                                                   */
/* ------------------------------------------------------------------ */

const StoreModal = ({ initialStore, onClose, onSave, saving }) => {
  const [form, setForm] = useState({
    name: initialStore?.name || '',
    location: initialStore?.location || '',
    county: initialStore?.county || '',
    phone: initialStore?.phone || '',
    operatingHours: initialStore?.operatingHours || '',
    description: initialStore?.description || '',
  });

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!form.name.trim() || !form.location.trim() || !form.county.trim()) return;
    onSave({ ...form, description: form.description.trim() });
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
            <Store size={18} />
          </div>
          <h2 className="text-base font-semibold text-[#16324F]">
            {initialStore ? 'Edit store' : 'Add a store'}
          </h2>
        </div>

        <div className="space-y-4">
          <ModalField id="store-name" label="Store name" icon={Store} value={form.name} onChange={set('name')} required placeholder="Pryton Leather — Westlands" />
          <ModalField id="store-location" label="Location" icon={MapPin} value={form.location} onChange={set('location')} required placeholder="Woodvale Grove, Westlands" />
          <ModalField id="store-county" label="County" icon={Landmark} value={form.county} onChange={set('county')} required placeholder="Nairobi" />
          <ModalField id="store-phone" label="Phone" icon={Phone} value={form.phone} onChange={set('phone')} placeholder="07xx xxx xxx" />
          <ModalField id="store-hours" label="Operating hours" icon={Clock} value={form.operatingHours} onChange={set('operatingHours')} placeholder="Mon–Sat, 9am–6pm" />
          <ModalTextarea
            id="store-description"
            label="Description"
            icon={AlignLeft}
            value={form.description}
            onChange={set('description')}
            maxLength={DESCRIPTION_MAX}
            placeholder="Describe the store front — e.g. ground-floor shopfront next to the pharmacy, blue signage. For a factory, note what's produced there."
          />
        </div>

        <motion.button
          type="submit"
          disabled={saving}
          whileTap={{ scale: 0.97 }}
          className="mt-6 flex w-full items-center justify-center gap-2 rounded-full bg-[#1E6BA8] py-3 text-sm font-semibold text-white shadow-lg shadow-[#1E6BA8]/30 transition-opacity disabled:opacity-60"
        >
          {saving && (
            <motion.span animate={{ rotate: 360 }} transition={{ duration: 0.7, repeat: Infinity, ease: 'linear' }}>
              <Loader2 size={16} />
            </motion.span>
          )}
          {saving ? 'Saving…' : initialStore ? 'Save changes' : 'Add store'}
        </motion.button>
      </motion.form>
    </motion.div>
  );
};

/* ------------------------------------------------------------------ */
/*  Mobile action sheet — replaces the desktop hover icon row on       */
/*  small screens, where hover states don't really exist. Triggered    */
/*  by the "more" button on each card.                                 */
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
/*  Custom delete-confirm dialog (no window.confirm)                   */
/* ------------------------------------------------------------------ */

const ConfirmDeleteDialog = ({ storeName, onCancel, onConfirm, deleting }) => (
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
      <h3 className="mt-3 text-sm font-semibold text-[#16324F]">Delete this store?</h3>
      <p className="mt-1 text-xs leading-relaxed text-[#8496A6]">
        "{storeName}" will be permanently removed. This can't be undone.
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
          disabled={deleting}
          className="flex-1 rounded-full bg-[#B3413B] py-2.5 text-sm font-semibold text-white transition-opacity disabled:opacity-60"
        >
          {deleting ? 'Deleting…' : 'Delete'}
        </button>
      </div>
    </motion.div>
  </motion.div>
);

/* ------------------------------------------------------------------ */
/*  Main component                                                     */
/* ------------------------------------------------------------------ */

export default function Stores({ onNotify }) {
  const notify = onNotify || (() => {});

  const [stores, setStores] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modalStore, setModalStore] = useState(undefined); // undefined = closed, null = add, object = edit
  const [saving, setSaving] = useState(false);
  const [pendingDelete, setPendingDelete] = useState(null); // store being confirmed for delete
  const [deleting, setDeleting] = useState(false);
  const [sheetTarget, setSheetTarget] = useState(null); // store whose mobile action sheet is open

  useEffect(() => {
    const q = query(collection(db, 'stores'), orderBy('createdAt', 'desc'));

    // includeMetadataChanges lets us see the doc the instant it's written
    // locally (hasPendingWrites: true), before the server has acknowledged
    // it — that's what makes a newly-added store show up immediately.
    const unsub = onSnapshot(
      q,
      { includeMetadataChanges: true },
      (snap) => {
        const docs = snap.docs.map((d) => ({
          id: d.id,
          ...d.data(),
          _pending: d.metadata.hasPendingWrites,
        }));

        // createdAt is null on the client until the server round-trip
        // completes, so orderBy alone can't place a brand-new doc
        // correctly yet. Pin pending (unconfirmed) docs to the top so
        // the store you just added never jumps or flickers — it just
        // settles into normal createdAt order once it's confirmed.
        docs.sort((a, b) => {
          if (a._pending && !b._pending) return -1;
          if (!a._pending && b._pending) return 1;
          const aTime = a.createdAt?.toMillis?.() ?? 0;
          const bTime = b.createdAt?.toMillis?.() ?? 0;
          return bTime - aTime;
        });

        setStores(docs);
        setLoading(false);
      },
      () => setLoading(false)
    );
    return unsub;
  }, []);

  const handleSave = useCallback(
    async (form) => {
      setSaving(true);
      try {
        if (modalStore && modalStore.id) {
          await updateDoc(doc(db, 'stores', modalStore.id), {
            ...form,
            updatedAt: serverTimestamp(),
          });
          notify({ type: 'success', message: `"${form.name}" updated.` });
        } else {
          // Not awaiting the network round-trip before closing the modal —
          // the Firestore SDK writes to local cache synchronously, so
          // onSnapshot fires (and the card appears) right away. addDoc's
          // promise still resolves/rejects in the background for error
          // handling.
          addDoc(collection(db, 'stores'), {
            ...form,
            createdAt: serverTimestamp(),
          }).catch((err) => {
            notify({ type: 'error', message: err?.message || 'Could not save store.' });
          });
          notify({ type: 'success', message: `"${form.name}" added.` });
        }
        setModalStore(undefined);
      } catch (err) {
        notify({ type: 'error', message: err?.message || 'Could not save store.' });
      } finally {
        setSaving(false);
      }
    },
    [modalStore, notify]
  );

  const handleDelete = useCallback(async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      await deleteDoc(doc(db, 'stores', pendingDelete.id));
      notify({ type: 'success', message: `"${pendingDelete.name}" deleted.` });
      setPendingDelete(null);
    } catch (err) {
      notify({ type: 'error', message: err?.message || 'Could not delete store.' });
    } finally {
      setDeleting(false);
    }
  }, [pendingDelete, notify]);

  return (
    <div className="relative mt-6 sm:mt-8">
      <AmbientDotGrid />

      <div className="relative flex items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-[#16324F] sm:text-lg">Stores</h2>
          <p className="text-xs text-[#8496A6] sm:text-sm">Branch locations and factories across the business.</p>
        </div>
        <motion.button
          type="button"
          whileTap={{ scale: 0.96 }}
          onClick={() => setModalStore(null)}
          className="flex shrink-0 items-center gap-1.5 rounded-full bg-[#1E6BA8] px-4 py-2.5 text-xs font-semibold text-white shadow-md shadow-[#1E6BA8]/25 sm:text-sm"
        >
          <Plus size={15} />
          Add store
        </motion.button>
      </div>

      {loading ? (
        <div className="relative mt-8 flex justify-center py-10 text-[#9FB4C7]">
          <Loader2 size={20} className="animate-spin" />
        </div>
      ) : stores.length === 0 ? (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
          className="relative mt-5 flex flex-col items-start gap-3 rounded-2xl border border-dashed border-[#BFD6E8] bg-[#1E6BA8]/[0.04] p-6 sm:p-8"
        >
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#1E6BA8]/[0.08] text-[#1E6BA8]">
            <Store size={18} />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-[#16324F]">No stores yet</h3>
            <p className="mt-1 text-sm text-[#6B7C8C]">
              Add your first branch or factory to start tracking it across the app.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setModalStore(null)}
            className="mt-1 rounded-full bg-[#1E6BA8] px-4 py-2 text-xs font-semibold text-white"
          >
            Add a store
          </button>
        </motion.div>
      ) : (
        <motion.div
          layout
          className="relative mt-5 grid grid-cols-1 gap-3 sm:mt-6 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3"
        >
          <AnimatePresence initial={false}>
            {stores.map((store) => (
              <motion.div
                key={store.id}
                layout
                initial={{ opacity: 0, y: 10, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, scale: 0.96 }}
                transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
                className="group relative overflow-hidden rounded-2xl border border-[#E4EBF1] bg-white p-4 shadow-sm shadow-black/[0.02] transition-shadow hover:shadow-md sm:p-5"
              >
                <CardDotGrid />

                <div className="relative flex items-start justify-between gap-2">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#1E6BA8]/[0.08] text-[#1E6BA8]">
                    <Store size={16} />
                  </div>

                  <div className="flex shrink-0 items-center gap-1.5">
                    <AnimatePresence>
                      {store._pending && (
                        <motion.span
                          initial={{ opacity: 0, scale: 0.9 }}
                          animate={{ opacity: 1, scale: 1 }}
                          exit={{ opacity: 0, scale: 0.9 }}
                          className="flex items-center gap-1 rounded-full bg-[#1E6BA8]/[0.08] px-2 py-0.5 text-[10px] font-medium text-[#1E6BA8]"
                        >
                          <Loader2 size={10} className="animate-spin" />
                          Saving
                        </motion.span>
                      )}
                    </AnimatePresence>

                    {/* Desktop/tablet — icons are always visible with a    */}
                    {/* highlighted tint, not hover-only.                    */}
                    <div className="hidden items-center gap-1 sm:flex">
                      <button
                        type="button"
                        onClick={() => setModalStore(store)}
                        className="rounded-full bg-[#1E6BA8]/[0.08] p-1.5 text-[#1E6BA8] transition-colors hover:bg-[#1E6BA8]/[0.18]"
                        aria-label="Edit store"
                      >
                        <Pencil size={14} />
                      </button>
                      <button
                        type="button"
                        onClick={() => setPendingDelete(store)}
                        className="rounded-full bg-[#B3413B]/[0.08] p-1.5 text-[#B3413B] transition-colors hover:bg-[#B3413B]/[0.18]"
                        aria-label="Delete store"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>

                    {/* Mobile — a single "more" button opens a bottom-      */}
                    {/* sheet with the same actions, since hover states     */}
                    {/* don't really exist on touch.                         */}
                    <button
                      type="button"
                      onClick={() => setSheetTarget(store)}
                      className="rounded-full bg-[#1E6BA8]/[0.08] p-1.5 text-[#1E6BA8] transition-colors hover:bg-[#1E6BA8]/[0.18] sm:hidden"
                      aria-label="More actions"
                    >
                      <MoreVertical size={15} />
                    </button>
                  </div>
                </div>

                <h3 className="relative mt-3 truncate text-sm font-semibold text-[#16324F]">{store.name}</h3>

                <div className="relative mt-2 space-y-1.5 text-xs text-[#6B7C8C]">
                  <div className="flex items-start gap-1.5">
                    <MapPin size={13} className="mt-0.5 shrink-0 text-[#9FB4C7]" />
                    <span className="truncate">{store.location}, {store.county}</span>
                  </div>
                  {store.phone && (
                    <div className="flex items-center gap-1.5">
                      <Phone size={13} className="shrink-0 text-[#9FB4C7]" />
                      <span>{store.phone}</span>
                    </div>
                  )}
                  {store.operatingHours && (
                    <div className="flex items-center gap-1.5">
                      <Clock size={13} className="shrink-0 text-[#9FB4C7]" />
                      <span>{store.operatingHours}</span>
                    </div>
                  )}
                  {store.description && (
                    <div className="flex items-start gap-1.5">
                      <AlignLeft size={13} className="mt-0.5 shrink-0 text-[#9FB4C7]" />
                      <span className="line-clamp-3 whitespace-pre-line leading-relaxed">
                        {store.description}
                      </span>
                    </div>
                  )}
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </motion.div>
      )}

      <AnimatePresence>
        {modalStore !== undefined && (
          <StoreModal
            initialStore={modalStore}
            saving={saving}
            onClose={() => setModalStore(undefined)}
            onSave={handleSave}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {pendingDelete && (
          <ConfirmDeleteDialog
            storeName={pendingDelete.name}
            deleting={deleting}
            onCancel={() => setPendingDelete(null)}
            onConfirm={handleDelete}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {sheetTarget && (
          <MobileActionSheet
            title={sheetTarget.name}
            subtitle={`${sheetTarget.location}, ${sheetTarget.county}`}
            onClose={() => setSheetTarget(null)}
            actions={[
              { label: 'Edit store', icon: Pencil, onClick: () => setModalStore(sheetTarget) },
              { label: 'Delete store', icon: Trash2, danger: true, onClick: () => setPendingDelete(sheetTarget) },
            ]}
          />
        )}
      </AnimatePresence>
    </div>
  );
}