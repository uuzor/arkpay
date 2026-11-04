export default function RoutePending() {
  return (
    <div className="grid min-h-screen place-items-center bg-[#fafafb]">
      <div className="flex items-center gap-2 text-[12px] text-pewter">
        <span className="h-3 w-3 animate-spin rounded-full border-2 border-mist border-t-ink" />
        Loading…
      </div>
    </div>
  );
}
