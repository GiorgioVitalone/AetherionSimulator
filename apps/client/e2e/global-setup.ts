async function waitForBaseUrl(baseURL: string): Promise<void> {
  const timeoutMs = 60_000;
  const intervalMs = 1_000;
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(baseURL, {
        redirect: 'manual',
      });

      if (response.ok) {
        return;
      }
    } catch {
      // Keep polling until the app is reachable.
    }

    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }

  throw new Error(`Timed out waiting for ${baseURL} to become reachable.`);
}

export default async function globalSetup(): Promise<void> {
  const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:8080';
  await waitForBaseUrl(baseURL);
}
