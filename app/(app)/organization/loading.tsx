export default function OrganizationLoading() {
  return (
    <div className="mx-auto max-w-2xl space-y-6" aria-busy="true">
      <div className="space-y-2">
        <div className="h-7 w-40 animate-pulse rounded bg-surface-2" />
        <div className="h-4 w-64 animate-pulse rounded bg-surface-2" />
      </div>
      <div className="h-20 animate-pulse rounded-lg bg-surface-2" />
      <div className="h-56 animate-pulse rounded-lg bg-surface-2" />
      <div className="h-64 animate-pulse rounded-lg bg-surface-2" />
    </div>
  );
}
