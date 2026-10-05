import React from 'react';
import { Settings as SettingsIcon } from 'lucide-react';

// Placeholder — replace with the real Settings section.
export default function Settings() {
  return (
    <div className="rounded-3xl border border-dashed border-[#BFD6E8] bg-white p-10 text-center">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[#1E6BA8]/[0.08] text-[#1E6BA8]">
        <SettingsIcon size={22} />
      </div>
      <h2 className="mt-4 text-lg font-semibold text-[#16324F]">Settings</h2>
      <p className="mt-1 text-sm text-[#8496A6]">Coming soon.</p>
    </div>
  );
}