import { useState, useEffect, useCallback } from 'react';

export function useContactsData(startDate, endDate) {
  const [contacts, setContacts] = useState([]);
  const [owners, setOwners] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      // Fetch owners first, then contacts (sequential to avoid rate limits)
      const ownersRes = await fetch('/api/owners');
      if (!ownersRes.ok) {
        const err = await ownersRes.json().catch(() => ({}));
        throw new Error(err.error || `Owners request failed: ${ownersRes.status}`);
      }
      const ownersData = await ownersRes.json();
      setOwners(ownersData);

      const url = (startDate && endDate)
        ? `/api/contacts/created?startDate=${startDate}&endDate=${endDate}`
        : `/api/contacts/created`;
      const contactsRes = await fetch(url);
      if (!contactsRes.ok) {
        const err = await contactsRes.json().catch(() => ({}));
        throw new Error(err.error || `Contacts request failed: ${contactsRes.status}`);
      }
      const contactsData = await contactsRes.json();
      setContacts(contactsData);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [startDate, endDate]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return { contacts, owners, loading, error, refetch: fetchData };
}
