// Shown immediately while the coin page loads (on-chain reads take a few seconds).
export default function Loading() {
  return (
    <div className="space-y-5" aria-busy="true" aria-label="Loading coin">
      <div className="h-4 w-16 animate-pulse rounded bg-panel2" />
      <section className="card p-4 sm:p-5">
        <div className="flex gap-4">
          <div className="h-16 w-16 animate-pulse rounded-2xl bg-panel2 sm:h-20 sm:w-20" />
          <div className="flex-1 space-y-2.5 pt-1">
            <div className="h-6 w-48 animate-pulse rounded bg-panel2" />
            <div className="h-4 w-64 animate-pulse rounded bg-panel2" />
            <div className="h-7 w-72 animate-pulse rounded-lg bg-panel2" />
          </div>
        </div>
        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-5">
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} className="h-14 animate-pulse rounded-xl bg-panel2" />
          ))}
        </div>
      </section>
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_380px]">
        <div className="card h-72 animate-pulse" />
        <div className="card h-96 animate-pulse" />
      </div>
    </div>
  );
}
