import { useSyncExternalStore } from "react";
import { type Lang, getLang, subscribeLang } from "./lang";

/** Current language; components using it re-render when it changes. */
export const useLang = (): Lang => useSyncExternalStore(subscribeLang, getLang, getLang);
