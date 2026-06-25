export default function RemindersListLoading() {
  return (
    <div className="space-y-6" aria-busy="true">
      <div className="flex items-center justify-between">
        <div className="h-7 w-36 animate-pulse rounded bg-surface-2" />
        <div className="h-10 w-32 animate-pulse rounded-md bg-surface-2" />
      </div>
      <div className="grid gap-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-28 animate-pulse rounded-lg bg-surface-2" />
        ))}
      </div>
    </div>
  );
}
