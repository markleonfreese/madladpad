const MODEL_HOST = 'https://huggingface.co';

export function withModelReferrerPolicy(fetchImpl) {
  return (input, init = {}) => {
    let url;
    try {
      url = new URL(input instanceof Request ? input.url : String(input));
    } catch {
      return fetchImpl(input, init);
    }

    // Hugging Face's redirected cache endpoint currently returns 404 when a
    // Workers preview URL is sent as Referer. Avoid leaking the app URL and
    // keep the redirected model request compatible with the host.
    if (url.origin !== MODEL_HOST) return fetchImpl(input, init);
    return fetchImpl(input, { ...init, referrerPolicy: 'no-referrer' });
  };
}
