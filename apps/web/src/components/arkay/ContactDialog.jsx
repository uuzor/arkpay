import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

const KINDS = ["CLIENT", "SUPPLIER", "STAFF"];

export default function ContactDialog({ dialog, onClose, onSave }) {
  const [name, setName] = useState("");
  const [paypalEmail, setPaypalEmail] = useState("");
  const [kind, setKind] = useState("CLIENT");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const open = Boolean(dialog);

  useEffect(() => {
    if (open) {
      setName(dialog?.contact?.name ?? "");
      setPaypalEmail(dialog?.contact?.paypalEmail ?? "");
      setKind(dialog?.contact?.kind ?? "CLIENT");
      setError(null);
    }
  }, [open, dialog]);

  if (!dialog) return null;
  const editing = dialog.mode === "edit";

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await onSave({
        name: name.trim(),
        ...(paypalEmail.trim() ? { payeePaypal: paypalEmail.trim() } : {}),
        kind,
      });
    } catch (e) {
      const msg = e?.message ?? "Could not save this contact.";
      setError(msg);
      toast("Save failed", { description: msg });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-[400px] overflow-auto rounded-xl">
        <DialogHeader>
          <DialogTitle className="text-[16px] tracking-[-0.02em]">
            {editing ? "Edit contact" : "New contact"}
          </DialogTitle>
          <DialogDescription className="text-[12.5px] leading-5 text-graphite">
            {editing
              ? "Renaming or changing the PayPal email affects future matching. Past actions keep their own records."
              : "Saving matches an existing contact on PayPal email first — no duplicates."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <label htmlFor="contact-name" className="text-[11px] font-medium uppercase tracking-[0.12em] text-steel">Name</label>
            <Input id="contact-name" value={name} onChange={(e) => setName(e.target.value)} className="mt-1 h-9 rounded-xl" />
          </div>
          <div>
            <label htmlFor="contact-paypal" className="text-[11px] font-medium uppercase tracking-[0.12em] text-steel">PayPal email</label>
            <Input
              id="contact-paypal"
              value={paypalEmail}
              onChange={(e) => setPaypalEmail(e.target.value)}
              inputMode="email"
              placeholder="optional until first payment"
              className="mt-1 h-9 rounded-xl"
            />
          </div>
          <div>
            <label className="text-[11px] font-medium uppercase tracking-[0.12em] text-steel">Kind</label>
            <div className="mt-1.5 flex gap-1 rounded-xl bg-fog p-1">
              {KINDS.map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setKind(k)}
                  className={`flex-1 rounded-lg px-3 py-1.5 text-[12px] font-medium transition-colors ${
                    kind === k ? "bg-paper text-ink shadow-sm" : "text-graphite hover:text-ink"
                  }`}
                >
                  {k.charAt(0) + k.slice(1).toLowerCase()}
                </button>
              ))}
            </div>
          </div>
          {error ? (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-[11.5px] font-medium leading-5 text-red-700 ring-1 ring-inset ring-red-100">
              {error}
            </p>
          ) : null}
        </div>

        <div className="mt-1 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-mist/80 px-3 py-2 text-[12.5px] font-medium text-ink"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={save}
            disabled={saving || !name.trim()}
            className="rounded-xl bg-ink px-3 py-2 text-[12.5px] font-semibold text-paper disabled:opacity-50"
          >
            {saving ? "Saving…" : editing ? "Save changes" : "Add contact"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
