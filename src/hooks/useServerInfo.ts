import { useCallback, useEffect, useState } from 'react';
import type { ServerInfo } from '../components/scan/types';

//fetches /api/server-info for QR code, IP/URL display.
export function useServerInfo() {
  const [serverInfo, setServerInfo] = useState<ServerInfo | null>(null);
  const [ipLoading, setIpLoading] = useState(false);

  const fetchServerInfo = useCallback(async () => {
    setIpLoading(true);
    const controller = new AbortController();
    const timeout = globalThis.setTimeout(() => controller.abort(), 5000);
    try {
      const res = await fetch('/api/server-info', { credentials: 'include', signal: controller.signal });
      if (!res.ok) throw new Error(`Server info request failed: ${res.status}`);
      const data = await res.json();
      setServerInfo({
        ip: data.ip || 'localhost',
        port: data.port || 3000,
        protocol: data.protocol || 'http',
        mobileUrl: data.mobileUrl,
        tunnelUrl: data.tunnelUrl ?? null,
      });
    } catch {
      setServerInfo({ ip: 'localhost', port: 3000, protocol: 'http' });
    } finally {
      globalThis.clearTimeout(timeout);
      setIpLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchServerInfo();
    const interval = globalThis.setInterval(fetchServerInfo, 30_000);
    return () => globalThis.clearInterval(interval);
  }, [fetchServerInfo]);

  return { serverInfo, ipLoading, fetchServerInfo };
}
