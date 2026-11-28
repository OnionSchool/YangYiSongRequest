/// <reference lib="webworker" />

// 后台线程算 PoW，免得卡住点歌条

function hex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

onmessage = async (
  event: MessageEvent<{ challengeId: string; contextHash: string; difficulty: number }>
) => {
  const { challengeId, contextHash, difficulty } = event.data;
  const prefix = '0'.repeat(difficulty);
  let nonce = 0;
  const started = Date.now();
  for (;;) {
    const candidate = String(nonce);
    const data = new TextEncoder().encode(`${challengeId}:${contextHash}:${candidate}`);
    const hash = hex(await crypto.subtle.digest('SHA-256', data));
    nonce += 1;
    if (hash.startsWith(prefix)) {
      postMessage({ type: 'done', nonce: candidate });
      return;
    }
    // 每 64 次上报一次进度，让点歌条能显示「算了多少次」，手机上也知道自己没卡死
    if (nonce % 64 === 0) {
      postMessage({ type: 'progress', tried: nonce, elapsedMs: Date.now() - started });
    }
  }
};
