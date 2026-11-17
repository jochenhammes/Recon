/** Files from a drop event, including the contents of dropped folders (recursively). */
export async function droppedFiles(dt: DataTransfer): Promise<File[]> {
  type Entry = { isFile: boolean; isDirectory: boolean; name: string; file?: (cb: (f: File) => void, err: (e: unknown) => void) => void; createReader?: () => { readEntries: (cb: (e: Entry[]) => void, err: (e: unknown) => void) => void } };
  const entries = Array.from(dt.items ?? [])
    .map((it) => (it as unknown as { webkitGetAsEntry?: () => Entry | null }).webkitGetAsEntry?.() ?? null)
    .filter((e): e is Entry => !!e);
  if (!entries.length || !entries.some((e) => e.isDirectory)) return Array.from(dt.files);
  const out: File[] = [];
  const walk = async (e: Entry): Promise<void> => {
    if (e.isFile && e.file) out.push(await new Promise<File>((res, rej) => e.file!(res, rej)));
    else if (e.isDirectory && e.createReader) {
      const reader = e.createReader();
      // readEntries returns batches until empty.
      for (;;) {
        const batch = await new Promise<Entry[]>((res, rej) => reader.readEntries(res, rej));
        if (!batch.length) break;
        for (const c of batch) await walk(c);
      }
    }
  };
  for (const e of entries) await walk(e);
  return out;
}
