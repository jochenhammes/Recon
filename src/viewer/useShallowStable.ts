import { useRef } from "react";

/** Returns the previous array instance while the elements are identical (stable memo dependency). */
export function useShallowStable<T>(arr: T[]): T[] {
  const ref = useRef(arr);
  const prev = ref.current;
  if (arr.length !== prev.length || arr.some((x, i) => x !== prev[i])) ref.current = arr;
  return ref.current;
}
