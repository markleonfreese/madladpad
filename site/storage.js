const DATABASE = 'madladpad-local-v1';
const STORE = 'items';

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
      const result = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(result.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally { db.close(); }
}

export const getValue = key => transaction('readonly', store => store.get(key));
export const putValue = (key, value) => transaction('readwrite', store => store.put(value, key));
export const deleteValue = key => transaction('readwrite', store => store.delete(key));

// Persist a capture and its project metadata together, or not at all.
export async function saveCapturedPad(id, file, project) {
  if(!Number.isInteger(id) || id<0 || id>=16)throw new RangeError('Invalid pad');
  const db=await openDb();
  try {
    await new Promise((resolve,reject)=>{
      const tx=db.transaction(STORE,'readwrite');
      tx.oncomplete=()=>resolve();
      tx.onerror=()=>reject(tx.error||new Error('Capture save failed'));
      tx.onabort=()=>reject(tx.error||new Error('Capture save aborted'));
      try {const store=tx.objectStore(STORE);store.put(file,`media:${id}`);store.put(project,'project');}
      catch(error){tx.abort();reject(error);}
    });
  } finally {db.close();}
}

export async function collectProjectMedia() {
  return Promise.all(Array.from({length: 16}, (_, id) => getValue(`media:${id}`)));
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
  if (typeof data !== 'string' || !/^data:(audio|video|image)\/[\w.+-]+;base64,/.test(data)) throw new Error('Invalid imported media data');
  const [header, encoded] = data.split(',', 2);
  const binary = atob(encoded);
  const result = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) result[i] = binary.charCodeAt(i);
  return new Blob([result], {type: header.slice(5).split(';')[0]});
}
