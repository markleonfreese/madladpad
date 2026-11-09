export async function processInputFiles(event, processFiles) {
  const input = event?.target;
  if (!input) return;
  const files = Array.from(input.files || []);
  try {
    return await processFiles(files);
  } finally {
    input.value = '';
  }
}
