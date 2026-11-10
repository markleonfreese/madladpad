const DATABASE = 'madladpad-local-v1';
const STORE = 'items';
const BLOB_RECORD = '__madladpadBlobRecord';

// WebKit can abort IndexedDB writes for Blob/File values with an UnknownError.
// Store their bytes as a structured-cloneable typed array and restore the
// original Blob/File interface when reading them back.
async function encodeStoredValue(value) {
  if (typeof Blob !== 'undefined' && value instanceof Blob) {
    return {
      [BLOB_RECORD]: true,
      name: typeof value.name === 'string' ? value.name : null,
      lastModified: typeof value.lastModified === 'number' ? value.lastModified : null,
      type: value.type,
      bytes: new Uint8Array(await value.arrayBuffer())
    };
  }
  if (Array.isArray(value)) return Promise.all(value.map(encodeStoredValue));
  if (value && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(await Promise.all(Object.entries(value).map(async ([key, item]) => [key, await encodeStoredValue(item)])));
  }
  return value;
}

function decodeStoredValue(value) {
  if (value && value[BLOB_RECORD] === true && value.bytes instanceof Uint8Array) {
    if (value.name !== null && typeof File !== 'undefined') {
      return new File([value.bytes], value.name, {type: value.type || '', lastModified: value.lastModified ?? Date.now()});
    }
    return new Blob([value.bytes], {type: value.type || ''});
  }
  if (Array.isArray(value)) return value.map(decodeStoredValue);
  if (value && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, decodeStoredValue(item)]));
  }
  return value;
}

function storageError(event, fallback) {
  return event?.target?.error || event?.target?.transaction?.error || new Error(fallback);
}

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function transaction(mode, fn) {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      tx.oncomplete = () => resolve(result.result);
      tx.onerror = event => reject(tx.error || storageError(event, 'Local storage request failed.'));
      tx.onabort = event => reject(tx.error || storageError(event, 'Local storage transaction was aborted.'));
      const result = fn(tx.objectStore(STORE));
    });
  } finally { db.close(); }
}

export const getValue = async key => decodeStoredValue(await transaction('readonly', store => store.get(key)));
export const putValue = async (key, value) => {
  const encoded = await encodeStoredValue(value);
  return transaction('readwrite', store => store.put(encoded, key));
};
export const deleteValue = key => transaction('readwrite', store => store.delete(key));

// Commit project metadata and all 16 media slots together, or preserve the old pack.
export async function replaceProjectMedia(project, media, voiceMedia = null) {
  if (!Array.isArray(media) || media.length !== 16) throw new Error('Expected 16 media slots');
  if (voiceMedia !== null && (!Array.isArray(voiceMedia) || voiceMedia.some(item => !/^[a-zA-Z0-9_-]{1,64}$/.test(item?.id) || !item?.file?.type?.startsWith('audio/')))) throw new Error('Invalid vocal layer media');
  const encodedMedia = await Promise.all(media.map(encodeStoredValue));
  const encodedVoiceMedia = voiceMedia === null ? null : await Promise.all(voiceMedia.map(async ({id, file}) => ({id, file:await encodeStoredValue(file)})));
  const db = await openDb();
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('Project save failed'));
      tx.onabort = () => reject(tx.error || new Error('Project save aborted'));
      try {
        const store = tx.objectStore(STORE);
        store.put(project, 'project');
        encodedMedia.forEach((file, id) => file ? store.put(file, `media:${id}`) : store.delete(`media:${id}`));
        if (encodedVoiceMedia !== null) {
          if (store.getAllKeys) {
            const keys = store.getAllKeys();
            keys.onsuccess = () => {
              keys.result.filter(key => typeof key === 'string' && key.startsWith('voice-layer:')).forEach(key => store.delete(key));
              encodedVoiceMedia.forEach(({id, file}) => store.put(file, `voice-layer:${id}`));
            };
          } else encodedVoiceMedia.forEach(({id, file}) => store.put(file, `voice-layer:${id}`));
        }
      } catch (error) { tx.abort(); reject(error); }
    });
  } finally { db.close(); }
}

// Persist a capture and its project metadata together, or not at all.
export async function saveCapturedPad(id, file, project) {
  if(!Number.isInteger(id) || id<0 || id>=16)throw new RangeError('Invalid pad');
  const encodedFile = await encodeStoredValue(file);
  const db=await openDb();
  try {
    await new Promise((resolve,reject)=>{
      const tx=db.transaction(STORE,'readwrite');
      tx.oncomplete=()=>resolve();
      tx.onerror=()=>reject(tx.error||new Error('Capture save failed'));
      tx.onabort=()=>reject(tx.error||new Error('Capture save aborted'));
      try {const store=tx.objectStore(STORE);store.put(encodedFile,`media:${id}`);store.put(project,'project');}
      catch(error){tx.abort();reject(error);}
    });
  } finally {db.close();}
}

// Save a raw vocal take and its layer metadata in one transaction.
export async function saveVoiceLayer(id, file, project) {
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(id) || !file?.type?.startsWith('audio/')) throw new Error('Invalid vocal take');
  const encodedFile = await encodeStoredValue(file);
  const db = await openDb();
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('Vocal take save failed'));
      tx.onabort = () => reject(tx.error || new Error('Vocal take save aborted'));
      try { const store = tx.objectStore(STORE); store.put(encodedFile, `voice-layer:${id}`); store.put(project, 'project'); }
      catch (error) { tx.abort(); reject(error); }
    });
  } finally { db.close(); }
}

export async function deleteVoiceLayer(id, project) {
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(id)) throw new Error('Invalid vocal layer id');
  const db = await openDb();
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('Vocal layer delete failed'));
      tx.onabort = () => reject(tx.error || new Error('Vocal layer delete aborted'));
      try { const store = tx.objectStore(STORE); store.delete(`voice-layer:${id}`); store.put(project, 'project'); }
      catch (error) { tx.abort(); reject(error); }
    });
  } finally { db.close(); }
}

export async function collectProjectMedia() {
  return Promise.all(Array.from({length: 16}, (_, id) => getValue(`media:${id}`)));
}

export async function collectVoiceMedia(layers) {
  return Promise.all(layers.map(async layer => ({id: layer.id, file: await getValue(`voice-layer:${layer.id}`)})));
}

export function blobAsDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

export function dataUrlAsBlob(data) {
  const match = typeof data === 'string'
    ? /^data:((?:audio|video|image)\/[\w.+-]+)((?:;[A-Za-z0-9!#$&^_.+-]+=[A-Za-z0-9!#$&^_.+,:/-]+)*);base64,/i.exec(data)
    : null;
  if (!match) throw new Error('Invalid imported media data');
  const encoded = data.slice(match[0].length);
  const binary = atob(encoded);
  const result = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) result[i] = binary.charCodeAt(i);
  return new Blob([result], {type: match[1].toLowerCase()});
}
