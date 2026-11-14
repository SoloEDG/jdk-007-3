// 音频体积远超 localStorage 上限，人声 WAV 单独存进 IndexedDB，
// localStorage 里只保留引用 id 与波形等元数据。

const DB_NAME = "nightshift-studio";
const STORE = "audio-blobs";
const DB_VERSION = 1;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE))
        db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB 打开失败"));
  });
}

function tx<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(STORE, mode);
        const request = run(transaction.objectStore(STORE));
        request.onsuccess = () => {
          resolve(request.result);
          db.close();
        };
        request.onerror = () => {
          reject(request.error ?? new Error("音频存取失败"));
          db.close();
        };
      }),
  );
}

export async function putAudioBlob(id: string, blob: Blob): Promise<void> {
  await tx("readwrite", (store) => store.put(blob, id));
}

export async function getAudioBlob(id: string): Promise<Blob | null> {
  try {
    return await tx("readonly", (store) => store.get(id));
  } catch {
    return null;
  }
}

export async function deleteAudioBlob(id: string): Promise<void> {
  try {
    await tx("readwrite", (store) => store.delete(id));
  } catch {
    // 清理失败不阻断主流程
  }
}
