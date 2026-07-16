export function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="inline-flex items-center rounded-full bg-[#3a3a3c] px-3.5 py-1.5 text-xs font-bold uppercase tracking-wide text-white">
      {children}
    </div>
  );
}
