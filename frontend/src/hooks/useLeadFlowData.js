import { useState, useEffect, useCallback } from 'react';

export function useLeadFlowData(startDate, endDate) {
  const [deals, setDeals] = useState([]);
  const [owners, setOwners] = useState([]);
  const [stages, setStages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const [dealsRes, ownersRes, stagesRes] = await Promise.all([
        fetch(`/api/deals/created?startDate=${startDate}&endDate=${endDate}`),
        fetch('/api/owners'),
        fetch('/api/stages'),
      ]);

      if (!dealsRes.ok) {
        const err = await dealsRes.json().catch(() => ({}));
        throw new Error(err.error || `Deals request failed: ${dealsRes.status}`);
      }
      if (!ownersRes.ok) {
        const err = await ownersRes.json().catch(() => ({}));
        throw new Error(err.error || `Owners request failed: ${ownersRes.status}`);
      }

      const stagesData = stagesRes.ok ? await stagesRes.json() : [];
      const [dealsData, ownersData] = await Promise.all([
        dealsRes.json(),
        ownersRes.json(),
      ]);

      setDeals(dealsData);
      setOwners(ownersData);
      setStages(stagesData);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [startDate, endDate]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return { deals, owners, stages, loading, error, refetch: fetchData };
}
