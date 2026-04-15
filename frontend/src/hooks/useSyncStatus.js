import { useState, useEffect, useCallback } from 'react';

export function useSyncStatus() {
  const [syncInfo, setSyncInfo] = useState({
    lastSyncAt: null,
    status: 'loading',
    error: null,
    counts: { deals: 0, contacts: 0, owners: 0, stages: 0 },
  });

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/sync/status');
      if (res.ok) {
        const data = await res.json();
        setSyncInfo(data);
      }
    } catch {
      // ignore — backend might not be ready yet
    }
  }, []);

  const triggerSync = useCallback(async () => {
    try {
      setSyncInfo((prev) => ({ ...prev, status: 'running' }));
      await fetch('/api/sync', { method: 'POST' });
    } catch (err) {
      console.error('Failed to trigger sync:', err);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
    // Poll: every 3s while running, every 30s otherwise
    const interval = setInterval(() => {
      fetchStatus();
    }, syncInfo.status === 'running' ? 3000 : 30000);
    return () => clearInterval(interval);
  }, [fetchStatus, syncInfo.status]);

  // Relative time helper
  const timeAgo = syncInfo.lastSyncAt ? getTimeAgo(syncInfo.lastSyncAt) : null;

  return { ...syncInfo, timeAgo, triggerSync, refetchStatus: fetchStatus };
}

function getTimeAgo(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}
