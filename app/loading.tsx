// Shown immediately while a page's server data loads.
export default function Loading() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading">
      <div className="h-48 animate-pulse rounded-3xl border border-line bg-panel" />
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="flex gap-3 rounded-2xl p-3">
            <div className="h-[104px] w-[104px] animate-pulse rounded-xl bg-panel2" />
            <div className="flex-1 space-y-2 pt-1">
              <div className="h-4 w-3/4 animate-pulse rounded bg-panel2" />
              <div className="h-3 w-1/2 animate-pulse rounded bg-panel2" />
              <div className="h-2 w-full animate-pulse rounded bg-panel2" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
