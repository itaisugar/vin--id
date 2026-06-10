export default function ScanLoading() {
  return (
    <div className="mx-auto max-w-2xl space-y-6" aria-busy="true">
      <div className="h-7 w-44 animate-pulse rounded bg-muted" />
      <div className="h-10 w-full animate-pulse rounded bg-muted" />
      <div className="h-40 w-full animate-pulse rounded bg-muted" />
      <div className="h-10 w-40 animate-pulse rounded bg-muted" />
    </div>
  );
}
