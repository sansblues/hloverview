// The page: a bar above to pick the run, the map, a bar below to play it.
import { useEffect, useState } from "react";
import { Tooltip } from "@base-ui/react/tooltip";
import { Header } from "./header.tsx";
import { Stage } from "./stage.tsx";
import { Footer } from "./footer.tsx";
import { add, key, start } from "./map/engine.ts";
import { group } from "./map/run.ts";

export function App() {
  const [dropping, setDropping] = useState(false);
  useEffect(() => {
    start();
    let depth = 0;   // drag events fire for every element crossed: count them, so leaving a child is not leaving the page
    const enter = (ev: DragEvent) => { ev.preventDefault(); depth++; setDropping(true); };
    const leave = () => { if (--depth <= 0) { depth = 0; setDropping(false); } };
    const over = (ev: DragEvent) => ev.preventDefault();
    const drop = (ev: DragEvent) => { ev.preventDefault(); depth = 0; setDropping(false); if (ev.dataTransfer) dropped(ev.dataTransfer).then(found => add(group(found))); };
    document.addEventListener("keydown", key);
    addEventListener("dragenter", enter); addEventListener("dragleave", leave); addEventListener("dragover", over); addEventListener("drop", drop);
    return () => {
      document.removeEventListener("keydown", key);
      removeEventListener("dragenter", enter); removeEventListener("dragleave", leave); removeEventListener("dragover", over); removeEventListener("drop", drop);
    };
  }, []);
  return (
    <Tooltip.Provider delay={400}>
      <Header />
      <Stage dropping={dropping} />
      <Footer />
    </Tooltip.Provider>
  );
}

// What was dropped: files, and everything inside dropped folders, with their paths.
async function dropped(transfer: DataTransfer) {
  const found: { file: File; path: string }[] = [];
  const walk = async (entry: FileSystemEntry, path: string): Promise<void> => {
    if (entry.isFile) found.push({ file: await new Promise<File>((done, fail) => (entry as FileSystemFileEntry).file(done, fail)), path: path + entry.name });
    else {
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      for (let batch; (batch = await new Promise<FileSystemEntry[]>((done, fail) => reader.readEntries(done, fail))).length;)   // a folder reads in batches
        await Promise.all(batch.map(e => walk(e, `${path}${entry.name}/`)));
    }
  };
  await Promise.all([...transfer.items].map(item => item.webkitGetAsEntry()).filter(e => e !== null).map(e => walk(e, "")));
  return found;
}
