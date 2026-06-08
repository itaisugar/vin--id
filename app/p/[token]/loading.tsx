export default function PublicPassportLoading() {
  return (
    <div className="flex min-h-dvh flex-col bg-muted/30">
      <div className="border-b border-border bg-background">
        <div className="mx-auto h-14 w-full max-w-3xl px-4" />
      </div>
      <main className="mx-auto w-full max-w-3xl flex-1 space-y-4 px-4 py-6" aria-busy="true">
        <div className="h-28 w-full animate-pulse rounded-lg bg-muted" />
        <div className="h-40 w-full animate-pulse rounded-lg bg-muted" />
        <div className="h-40 w-full animate-pulse rounded-lg bg-muted" />
      </main>
    </div>
  );
}
