export default function PassportsLoading() {
  return (
    <div className="space-y-6" aria-busy="true">
      <div className="h-7 w-48 animate-pulse rounded bg-muted" />
      <div className="h-40 w-full animate-pulse rounded-lg bg-muted" />
      <div className="h-40 w-full animate-pulse rounded-lg bg-muted" />
    </div>
  );
}
