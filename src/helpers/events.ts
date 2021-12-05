type Listener = (...args: any[]) => void;
type AsyncListener = (...args: any[]) => Promise<void>;

export function notifyAllListeners(callbacks: Listener[], ...args: any[]) {
  for (const callback of callbacks) {
    callback(...args);
  }
}

export async function notifyAllListenersAsync(callbacks: (Listener | AsyncListener)[], ...args: any[]) {
  for (const callback of callbacks) {
    await callback(...args);
  }
}
