// Storage: a JSON file in a user-chosen folder (File System Access API), with IndexedDB
// as the fallback when the API is unavailable or no folder has been chosen yet.
// In folder mode the IndexedDB copy is kept as a mirror so data survives a lost folder.

const DATA_FILE_NAME = "task-tracker.json";
const DB_NAME = "task-tracker";
const STORE_NAME = "kv";
const KEY_DATA = "data";
const KEY_DIR_HANDLE = "dirHandle";
const SAVE_DEBOUNCE_MS = 250;

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE_NAME);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbRequest(mode, fn) {
  return openDb().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, mode);
    const req = fn(tx.objectStore(STORE_NAME));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => db.close();
  }));
}

const idbGet = key => idbRequest("readonly", store => store.get(key));
const idbSet = (key, value) => idbRequest("readwrite", store => store.put(value, key));
const idbDelete = key => idbRequest("readwrite", store => store.delete(key));

const storage = {
  supportsFolders: typeof window.showDirectoryPicker === "function",
  mode: "idb", // "idb" | "file"
  dirHandle: null,
  fileLastModified: 0,
  status: "idle", // "idle" | "saving" | "saved" | "error"
  onStatusChange: () => {},
  _pendingData: null,
  _saveTimer: null,
  _writeChain: Promise.resolve(),

  get folderName() {
    return this.dirHandle ? this.dirHandle.name : null;
  },

  // Resolves to { state: "ready", data } (data may be null on first run)
  // or { state: "needs-permission" } when a saved folder must be re-authorised by a click.
  async init() {
    if (this.supportsFolders) {
      const handle = await idbGet(KEY_DIR_HANDLE);
      if (handle) {
        this.dirHandle = handle;
        const perm = await handle.queryPermission({ mode: "readwrite" });
        if (perm !== "granted") return { state: "needs-permission" };
        return this._enterFileMode();
      }
    }
    return { state: "ready", data: (await idbGet(KEY_DATA)) || null };
  },

  async reconnect() {
    const perm = await this.dirHandle.requestPermission({ mode: "readwrite" });
    if (perm !== "granted") return { state: "needs-permission" };
    return this._enterFileMode();
  },

  async _enterFileMode() {
    this.mode = "file";
    const data = (await this.readFile()) || (await idbGet(KEY_DATA)) || null;
    return { state: "ready", data };
  },

  // Resolves to the folder's existing data, null if the folder has no data file yet,
  // or undefined if the user cancelled the picker. Does not commit the folder yet —
  // call commitFolder() or cancelFolder() afterwards.
  async chooseFolder() {
    let handle;
    try {
      handle = await window.showDirectoryPicker({ id: "task-tracker", mode: "readwrite" });
    } catch (e) {
      if (e.name === "AbortError") return undefined;
      throw e;
    }
    this._candidateHandle = handle;
    const prev = this.dirHandle;
    this.dirHandle = handle;
    try {
      return await this.readFile();
    } finally {
      this.dirHandle = prev;
    }
  },

  async commitFolder() {
    this.dirHandle = this._candidateHandle;
    this._candidateHandle = null;
    this.mode = "file";
    await idbSet(KEY_DIR_HANDLE, this.dirHandle);
  },

  cancelFolder() {
    this._candidateHandle = null;
  },

  async disconnect() {
    this.dirHandle = null;
    this.mode = "idb";
    await idbDelete(KEY_DIR_HANDLE);
    return { state: "ready", data: (await idbGet(KEY_DATA)) || null };
  },

  async readFile() {
    let fileHandle;
    try {
      fileHandle = await this.dirHandle.getFileHandle(DATA_FILE_NAME);
    } catch (e) {
      if (e.name === "NotFoundError") return null;
      throw e;
    }
    const file = await fileHandle.getFile();
    this.fileLastModified = file.lastModified;
    const text = await file.text();
    return text.trim() ? JSON.parse(text) : null;
  },

  async writeFile(data) {
    const fileHandle = await this.dirHandle.getFileHandle(DATA_FILE_NAME, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(JSON.stringify(data, null, 2));
    await writable.close();
    this.fileLastModified = (await fileHandle.getFile()).lastModified;
  },

  save(data) {
    this._pendingData = data;
    clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => this.flush(), SAVE_DEBOUNCE_MS);
    this._setStatus("saving");
  },

  flush() {
    clearTimeout(this._saveTimer);
    if (!this._pendingData) return this._writeChain;
    const data = this._pendingData;
    this._pendingData = null;
    this._writeChain = this._writeChain.then(async () => {
      try {
        if (this.mode === "file") await this.writeFile(data);
        await idbSet(KEY_DATA, data);
        this._setStatus("saved");
      } catch (e) {
        console.error("Save failed", e);
        this._setStatus("error");
      }
    });
    return this._writeChain;
  },

  // Re-reads the data file if something else (e.g. OneDrive sync from the other device)
  // changed it since we last read or wrote it. Resolves to the new data, or null.
  async checkForExternalChanges() {
    if (this.mode !== "file" || this._pendingData) return null;
    await this._writeChain;
    let file;
    try {
      file = await (await this.dirHandle.getFileHandle(DATA_FILE_NAME)).getFile();
    } catch (e) {
      return null;
    }
    if (file.lastModified <= this.fileLastModified) return null;
    this.fileLastModified = file.lastModified;
    const text = await file.text();
    const data = text.trim() ? JSON.parse(text) : null;
    if (data) await idbSet(KEY_DATA, data);
    return data;
  },

  _setStatus(status) {
    this.status = status;
    this.onStatusChange(status);
  },
};
