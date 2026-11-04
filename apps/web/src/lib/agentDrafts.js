  import { useEffect, useState } from "react";

  // Drafts created from the agent bar. They live in memory for this session and
  // show up in Approvals as ordinary approval cards — nothing executes here.
  let drafts = [];
  const listeners = new Set();

  const emit = () => listeners.forEach((fn) => fn());

  export function addDraft(draft) {
    drafts = [draft, ...drafts];
    emit();
  }

  export function removeDraft(id) {
    drafts = drafts.filter((d) => d.id !== id);
    emit();
  }

  export function useAgentDrafts() {
    const [items, setItems] = useState(drafts);

    useEffect(() => {
      const sync = () => setItems(drafts);
      listeners.add(sync);
      sync();
      return () => listeners.delete(sync);
    }, []);

    return items;
  }