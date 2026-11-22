import { common } from "./common";
import { app } from "./app";

/** German source text → English. One file per area; merged here. */
export const EN_PARTS: Record<string, string>[] = [common, app];
