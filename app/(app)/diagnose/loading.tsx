export default function DiagnoseLoading() {
  return (
    <div className="mx-auto max-w-2xl space-y-6" aria-busy="true">
      <div className="h-7 w-44 animate-pulse rounded bg-muted" />
      <div className="h-10 w-full animate-pulse rounded bg-muted" />
      <div className="h-32 w-full animate-pulse rounded bg-muted" />
      <div className="h-10 w-32 animate-pulse rounded bg-muted" />
    </div>
  );
}
