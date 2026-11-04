import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import Money from "@/components/arkay/Money";
import { apiJson } from "@/lib/api";

export default function EditActionDialog({ request, open, onOpenChange, onSaved }) {
  const [payeeName, setPayeeName] = useState("");
  const [payeePaypal, setPayeePaypal] = useState("");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [purpose, setPurpose] = useState("");
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open && request) {
      setPayeeName(request.sender?.name ?? "");
      setPayeePaypal(request.payeePaypal ?? request.sender?.email ?? "");
      setAmount(String(request.amount ?? ""));
      setCurrency(request.currency ?? "USD");
      setPurpose(request.purpose ?? "");
      setError(null);
    }
  }, [open, request]);

  if (!request) return null;
  const local = Boolean(request.local);

  const save = async () => {
    if (local) {
      onSaved?.({ ...request, amount: Number(amount) || 0, purpose: purpose.trim() || request.purpose, edited: true });
      toast("Change saved — the old approval was voided", {
        description: "A new hash was issued. This action needs a fresh approval.",
      });
      onOpenChange(false);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await apiJson(`/approvals/${encodeURIComponent(request.id)}/supersede`, {
        method: "POST",
        body: {
          payeeName: payeeName.trim(),
          payeePaypal: payeePaypal.trim(),
          amount: amount.trim(),
          currency: currency.trim().toUpperCase(),
          purpose: purpose.trim(),
          by: "dashboard",
        },
      });
      onOpenChange(false);
      onSaved?.(res?.newId, request.id);
    } catch (e) {
      const msg = e?.message ?? "Could not save this edit.";
      setError(msg);
      toast("Edit failed", { description: msg });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-[440px] overflow-auto rounded-xl">
        <DialogHeader>
          <DialogTitle className="text-[16px] tracking-[-0.02em]">Edit before approving</DialogTitle>
          <DialogDescription className="text-[12.5px] leading-5 text-graphite">
            Any edit voids the current approval and creates a new action with a new hash.
            {local ? "" : " Its Telegram card arrives via /pending in the bot."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <label className="text-[11px] font-medium uppercase tracking-[0.12em] text-steel">Payee name</label>
            <Input value={payeeName} onChange={(e) => setPayeeName(e.target.value)} className="mt-1 h-9 rounded-xl" />
          </div>
          <div>
            <label className="text-[11px] font-medium uppercase tracking-[0.12em] text-steel">PayPal email</label>
            <Input value={payeePaypal} onChange={(e) => setPayeePaypal(e.target.value)} inputMode="email" className="mt-1 h-9 rounded-xl" />
          </div>
          <div className="grid grid-cols-[1fr_110px] gap-2">
            <div>
              <label className="text-[11px] font-medium uppercase tracking-[0.12em] text-steel">Amount</label>
              <Input
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                inputMode="decimal"
                className="mt-1 h-9 rounded-xl tabular"
              />
            </div>
            <div>
              <label className="text-[11px] font-medium uppercase tracking-[0.12em] text-steel">Currency</label>
              <Input
                value={currency}
                onChange={(e) => setCurrency(e.target.value.toUpperCase())}
                maxLength={3}
                className="mt-1 h-9 rounded-xl uppercase"
              />
            </div>
          </div>
          <div>
            <label className="text-[11px] font-medium uppercase tracking-[0.12em] text-steel">Purpose</label>
            <Input value={purpose} onChange={(e) => setPurpose(e.target.value)} className="mt-1 h-9 rounded-xl" />
          </div>
          {!local ? (
            <div className="rounded-lg bg-fog p-3 text-[11.5px] text-graphite">
              Payee <span className="font-medium text-ink">{request.sender.name}</span> · {request.sender.email} · currently{" "}
              <Money amount={request.amount} currency={request.currency} className="text-ink" />
            </div>
          ) : null}
          {error ? (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-[11.5px] font-medium leading-5 text-red-700 ring-1 ring-inset ring-red-100">
              {error}
            </p>
          ) : null}
        </div>

        <div className="mt-1 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="rounded-xl border border-mist/80 px-3 py-2 text-[12.5px] font-medium text-ink"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="rounded-xl bg-ink px-3 py-2 text-[12.5px] font-semibold text-paper disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save & re-approve"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
