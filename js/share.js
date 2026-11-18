// Saving and sharing files: Web Share with files first (iOS standalone), Blob download fallback.

export async function saveFile(text, filename, mime) {
  const blob = new Blob([text], { type: mime });
  try {
    const file = new File([blob], filename, { type: mime });
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: filename });
      return 'shared';
    }
  } catch (e) {
    if (e?.name === 'AbortError') return 'cancelled';
    // fall through to download
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  return 'downloaded';
}

/** Open a file picker and resolve with the text of the chosen file (or null). */
export function pickFile(accept = '.json,application/json') {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.style.display = 'none';
    input.addEventListener('change', async () => {
      const f = input.files?.[0];
      input.remove();
      resolve(f ? await f.text() : null);
    });
    document.body.append(input);
    input.click();
  });
}
