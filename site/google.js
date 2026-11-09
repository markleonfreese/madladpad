const PHOTOS_SCOPE = 'https://www.googleapis.com/auth/photospicker.mediaitems.readonly';
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const API = 'https://photospicker.googleapis.com/v1';

function config() {
  const c = window.MADLADPAD_GOOGLE || {};
  if (!isGooglePickerConfigured()) {
    throw new Error('Google pickers need a configured OAuth client ID, restricted API key and Google Cloud project number. See README.');
  }
  return c;
}

export function isGooglePickerConfigured() {
  const c = window.MADLADPAD_GOOGLE || {};
  return [c.clientId,c.apiKey,c.appId].every(value=>{
    const text=String(value ?? '').trim();
    return Boolean(text) && !text.startsWith('YOUR_');
  });
}

export async function waitForPhotosSelection(session, getSession, {now=Date.now,sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms)),maxWaitMs=5*60*1000}={}) {
  const seconds = Number.parseFloat(session.pollingConfig?.timeoutIn || '300s');
  if (!Number.isFinite(seconds) || seconds <= 0) return session;
  const deadline = now() + Math.min(seconds * 1000, maxWaitMs);
  let current = session;
  while (!current.mediaItemsSet) {
    const remaining = deadline - now();
    if (remaining <= 0) break;
    const interval = Number.parseFloat(current.pollingConfig?.pollInterval || '3s');
    const delay = Math.min(Math.max(1000, (Number.isFinite(interval) ? interval : 3) * 1000), remaining);
    await sleep(delay);
    current = await getSession();
  }
  return current;
}

function loadScript(url, ready) {
  if (ready()) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = url;
    script.async = true;
    script.onload = () => ready() ? resolve() : reject(new Error('Google script did not initialise'));
    script.onerror = () => reject(new Error('Google script could not load'));
    document.head.append(script);
  });
}

async function accessToken(scope) {
  const c = config();
  await loadScript('https://accounts.google.com/gsi/client', () => !!window.google?.accounts?.oauth2);
  return new Promise((resolve,reject) => {
    const client = google.accounts.oauth2.initTokenClient({
      client_id: c.clientId,
      scope,
      callback: response => response.error ? reject(new Error(response.error)) : resolve(response.access_token),
      error_callback: response => reject(new Error(response?.type || 'Google authorisation cancelled'))
    });
    client.requestAccessToken({prompt: 'consent'});
  });
}

async function fetchAuthorised(url, token, options={}) {
  const response = await fetch(url, { ...options, headers:{Authorization:`Bearer ${token}`, ...(options.headers||{})} });
  if (!response.ok) throw new Error(`Google API request failed (${response.status})`);
  return response;
}

export async function pickFromDrive(onFiles) {
  const c = config();
  const token = await accessToken(DRIVE_SCOPE);
  await loadScript('https://apis.google.com/js/api.js', () => !!window.gapi?.load);
  await new Promise((resolve,reject) => gapi.load('picker', {callback:resolve,onerror:reject}));
  const view = new google.picker.DocsView(google.picker.ViewId.DOCS);
  view.setMimeTypes('video/mp4,video/quicktime,video/webm,audio/mpeg,audio/mp4,audio/wav,audio/x-wav,audio/ogg,image/jpeg,image/png,image/webp');
  const picker = new google.picker.PickerBuilder().addView(view)
    .setOAuthToken(token).setDeveloperKey(c.apiKey).setAppId(c.appId)
    .enableFeature(google.picker.Feature.MULTISELECT_ENABLED)
    .setCallback(async data => {
      if (data[google.picker.Response.ACTION] !== google.picker.Action.PICKED) return;
      try {
        const docs = data[google.picker.Response.DOCUMENTS] || [];
        const files = await Promise.all(docs.map(async doc => {
          const id = doc[google.picker.Document.ID];
          const response = await fetchAuthorised(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?alt=media`, token);
          const blob = await response.blob();
          const mime = doc[google.picker.Document.MIME_TYPE] || doc.mimeType || blob.type;
          return new File([blob], doc[google.picker.Document.NAME] || doc.name || `drive-${id}`, {type:mime});
        }));
        await onFiles(files);
      } catch (error) { window.dispatchEvent(new CustomEvent('madladpad-error',{detail:error.message})); }
    }).build();
  picker.setVisible(true);
}

export async function pickFromPhotos(onFiles, onStatus=()=>{}) {
  config();
  // Reserve the tab during the user's click; opening it after OAuth awaits is popup-blocked on mobile.
  const pickerTab = window.open('about:blank','_blank');
  if (!pickerTab) throw new Error('Enable pop-ups for this site to use Google Photos.');
  let session;
  let token;
  try {
    token = await accessToken(PHOTOS_SCOPE);
  const endpoint = `${API}/sessions`;
    session = await (await fetchAuthorised(endpoint,token,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).json();
    const pickerUrl=new URL(session.pickerUri);
    if(pickerUrl.protocol!=='https:' || pickerUrl.hostname!=='photos.google.com') throw new Error('Invalid Google Photos picker address');
    pickerTab.location.href = `${session.pickerUri.replace(/\/$/,'')}/autoclose`;
    const current = await waitForPhotosSelection(session,async()=>
      (await fetchAuthorised(`${endpoint}/${encodeURIComponent(session.id)}`,token)).json());
    if (!current.mediaItemsSet) throw new Error('Google Photos selection timed out or was cancelled.');
    const files = [];
    let pageToken = '';
    do {
      const url = `${API}/mediaItems?sessionId=${encodeURIComponent(session.id)}${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}`:''}`;
      const page = await (await fetchAuthorised(url,token)).json();
      for (const item of page.mediaItems || []) {
        const media = item.mediaFile;
        if (!media || !/^(video|image)\//.test(media.mimeType)) continue;
        onStatus(`Downloading ${media.filename || 'selected media'}…`);
        const response = await fetchAuthorised(`${media.baseUrl}=${media.mimeType.startsWith('video/') ? 'dv':'d'}`,token);
        const blob = await response.blob();
        files.push(new File([blob], media.filename || 'Google Photos', {type:media.mimeType}));
      }
      pageToken = page.nextPageToken || '';
    } while (pageToken);
    await onFiles(files);
  } catch(error) {
    try { pickerTab.close(); } catch { /* Browser may have severed the window reference. */ }
    throw error;
  } finally {
    if(session?.id && token) await fetchAuthorised(`${API}/sessions/${encodeURIComponent(session.id)}`,token,{method:'DELETE'}).catch(() => {});
  }
}
