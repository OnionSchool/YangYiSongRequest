function hex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

self.onmessage = async (
  event: MessageEvent<{ challengeId: string; contextHash: string; difficulty: number }>
) => {
  const { challengeId, contextHash, difficulty } = event.data;
  const prefix = '0'.repeat(difficulty);
  const encoder = new TextEncoder();
  for (let value = 0; ; value += 1) {
    const nonce = value.toString(36);
    const digest = hex(
      await crypto.subtle.digest(
        'SHA-256',
        encoder.encode(`${challengeId}:${contextHash}:${nonce}`)
      )
    );
    if (digest.startsWith(prefix)) {
      self.postMessage({ nonce });
      return;
    }
  }
};
