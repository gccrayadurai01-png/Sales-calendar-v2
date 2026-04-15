export default function Filters({ teams, selectedTeam, onTeamChange }) {
  return (
    <div className="filters">
      <div className="filter-group">
        <label>TEAM</label>
        <select value={selectedTeam} onChange={(e) => onTeamChange(e.target.value)}>
          <option value="">All Teams</option>
          {teams.map((team) => (
            <option key={team.id} value={team.id}>
              {team.name}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
