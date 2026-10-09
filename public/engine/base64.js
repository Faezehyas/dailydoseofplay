// Bytes <-> base64, for binary data inside JSON messages. Strict on input:
// anything that isn't canonical base64 throws.

export function toBase64(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

const B64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

export function fromBase64(text) {
  if (typeof text !== "string" || !B64.test(text)) throw new TypeError("bad base64");
  const s = atob(text);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  if (toBase64(out) !== text) throw new TypeError("bad base64"); // e.g. "AB==", which decodes like "AA=="
  return out;
}
