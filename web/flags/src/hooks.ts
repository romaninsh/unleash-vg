import { useEffect, useState } from "react";

/** `value`, once it has stopped changing for `ms` (typing filters wait before asking the server). */
export function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}

/**
 * A text box whose value also lives in the address (?q=…): the box keeps its own text so fast
 * typing loses nothing, and the address follows once typing pauses. Back / reload restore it.
 */
export function useAddressText(fromAddress: string, toAddress: (v: string) => void, ms = 200) {
  const [text, setText] = useState(fromAddress);
  const settled = useDebounced(text, ms);
  useEffect(() => { if (settled !== fromAddress) toAddress(settled); }, [settled]);
  useEffect(() => { if (fromAddress !== settled) setText(fromAddress); }, [fromAddress]);
  return [text, setText] as const;
}
