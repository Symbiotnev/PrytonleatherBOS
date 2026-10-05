import { useEffect, useMemo, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../Libs/firebase_config.mjs';

/*
  useSellingStores(allStores)

  Inventory and Sales only manage the WAREHOUSE and the RETAIL shops. The
  factory is managed in Operations. This hook reads opsSettings/main (set in
  Operations -> gear icon) and returns only the places that should appear in
  the store switcher.

    - Before Operations setup is saved: returns every store (nothing changes).
    - After setup: warehouse + retail shops only.
    - Safety net: if that leaves nothing, returns every store except the factory.
*/
export const useSellingStores = (allStores) => {
  const [settings, setSettings] = useState(null); // null = still loading

  useEffect(
    () =>
      onSnapshot(
        doc(db, 'opsSettings', 'main'),
        (s) => setSettings(s.exists() ? s.data() : {}),
        () => setSettings({})
      ),
    []
  );

  return useMemo(() => {
    if (!settings || !settings.setupDone) return allStores;
    const allowed = new Set([settings.warehouseStoreId, ...(settings.retailStoreIds || [])].filter(Boolean));
    const picked = allStores.filter((s) => allowed.has(s.id));
    if (picked.length > 0) return picked;
    return allStores.filter((s) => s.id !== settings.factoryStoreId);
  }, [allStores, settings]);
};