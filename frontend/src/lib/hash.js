export async function sha256(arrayBuffer) {
  return crypto.subtle.digest("SHA-256", arrayBuffer);
}
