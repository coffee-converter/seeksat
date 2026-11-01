// lib/passes/download.js - hands a text file to the browser as a download.
export function downloadText(text, filename, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke after this tick; a synchronous revoke can drop the download in Safari.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
