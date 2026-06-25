export default function VehicleDetailLoading() {
  return (
    <div className="space-y-6" aria-busy="true">
      <div className="space-y-2">
        <div className="h-4 w-24 animate-pulse rounded bg-surface-2" />
        <div className="h-7 w-56 animate-pulse rounded bg-surface-2" />
      </div>
      <div className="h-48 w-full animate-pulse rounded-lg bg-surface-2" />
      <div className="grid gap-4 sm:grid-cols-2">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-24 animate-pulse rounded-lg bg-surface-2" />
        ))}
      </div>
    </div>
  );
}
