// Defines the allowed sales reps and their teams.
// Only deals owned by these reps will appear in the calendar.
// Names must match HubSpot owner full names (case-insensitive).

export const TEAMS = [
  {
    id: 'smb',
    name: 'SMB Team',
    reps: [
      'Vicky Cariappa',
      'Royston Aden',
      'Lawrence Lewis',
      'Yogesh Vig',
      'Kritika Gupta',
      'Kartik Kashyap',
      'Deepak R J',
      'Rutuja Kawade',
    ],
  },
  {
    id: 'am',
    name: 'AM Team',
    reps: [
      'Joy Prakash',
      'Arundhati Sen',
      'Vivin Joseph',
    ],
  },
  {
    id: 'ent',
    name: 'Ent Team',
    reps: [
      'Anthony Raymond',
      'Lennis Brown',
    ],
  },
];

// Flat list of all allowed rep names (lowercase for matching)
export const ALLOWED_REP_NAMES = TEAMS.flatMap((t) => t.reps.map((r) => r.toLowerCase()));

// Look up which team a rep belongs to by their full name
export function getRepTeam(fullName) {
  const lower = fullName.toLowerCase();
  return TEAMS.find((t) => t.reps.some((r) => r.toLowerCase() === lower)) || null;
}
