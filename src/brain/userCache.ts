/**
 * Browser cache (Cache Storage) for catalogue files the user downloaded from the source (e.g. Harvard-Oxford from
 * FSL): kept per catalogue id so they are available again after reloading. Only on this device and browser; every
 * call degrades to "not cached" where the Cache API is missing or blocked.
 */

const CACHE = "recon-brain-user";
const PREFIX = "/__recon-brain/";

const store = async (): Promise<Cache | null> => {
  try {
    return typeof caches === "undefined" ? null : await caches.open(CACHE);
  } catch {
    return null;
  }
};

const key = (id: string, name: string) => new Request(`${PREFIX}${encodeURIComponent(id)}/${encodeURIComponent(name)}`);

/** Stores the files of a catalogue entry (replacing earlier ones); false if the cache is not available. */
export async function cacheUserFiles(id: string, files: File[]): Promise<boolean> {
  const c = await store();
  if (!c) return false;
  try {
    await removeCachedEntry(id);
    for (const f of files) await c.put(key(id, f.name), new Response(f, { headers: { "Content-Type": "application/octet-stream", "X-File-Name": encodeURIComponent(f.name) } }));
    return true;
  } catch {
    return false;
  }
}

async function keysOf(c: Cache): Promise<{ id: string; name: string; req: Request }[]> {
  const out: { id: string; name: string; req: Request }[] = [];
  for (const req of await c.keys()) {
    const path = new URL(req.url).pathname;
    const i = path.indexOf(PREFIX);
    if (i < 0) continue;
    const [id, name] = path.slice(i + PREFIX.length).split("/");
    if (id && name) out.push({ id: decodeURIComponent(id), name: decodeURIComponent(name), req });
  }
  return out;
}

/** Catalogue ids with stored files. */
export async function cachedEntryIds(): Promise<string[]> {
  const c = await store();
  if (!c) return [];
  try {
    return [...new Set((await keysOf(c)).map((k) => k.id))];
  } catch {
    return [];
  }
}

/** The stored files of an entry, or null. */
export async function cachedUserFiles(id: string): Promise<File[] | null> {
  const c = await store();
  if (!c) return null;
  try {
    const files: File[] = [];
    for (const k of (await keysOf(c)).filter((k) => k.id === id)) {
      const r = await c.match(k.req);
      if (r) files.push(new File([await r.blob()], k.name));
    }
    return files.length ? files : null;
  } catch {
    return null;
  }
}

export async function removeCachedEntry(id: string): Promise<void> {
  const c = await store();
  if (!c) return;
  try {
    for (const k of (await keysOf(c)).filter((k) => k.id === id)) await c.delete(k.req);
  } catch {
    /* nothing to remove */
  }
}
