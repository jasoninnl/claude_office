import { useState } from "react";
import { RadarChart, PolarGrid, PolarAngleAxis, Radar, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Legend, CartesianGrid } from "recharts";
import type { Scenario } from "../types";

interface Props {
  scenarios: Scenario[];
}

export default function CompareView({ scenarios }: Props) {
  const [diffIdA, setDiffIdA] = useState<number | "">("");
  const [diffIdB, setDiffIdB] = useState<number | "">("");
  const scored = scenarios.filter((s) => s.score !== null && s.score_breakdown !== null);

  if (scored.length < 2) {
    return (
      <div className="space-y-6">
        <div className="text-center py-12 text-gray-500">
          <p>Need at least 2 scored scenarios to compare charts.</p>
          <p className="text-sm mt-1">Run the optimiser or save some scenarios first.</p>
        </div>
        <ScenarioDiff scenarios={scenarios} diffIdA={diffIdA} diffIdB={diffIdB} setDiffIdA={setDiffIdA} setDiffIdB={setDiffIdB} />
      </div>
    );
  }

  const COLORS = ["#6366f1", "#10b981", "#f59e0b", "#ec4899", "#3b82f6", "#ef4444"];

  // Radar data
  const radarKeys = ["collaboration", "space_utilization", "meeting_rooms", "floor_preference"];
  const radarLabels: Record<string, string> = {
    collaboration: "Collaboration",
    space_utilization: "Space",
    meeting_rooms: "Mtg Rooms",
    floor_preference: "Floor Pref",
  };

  const radarData = radarKeys.map((key) => ({
    metric: radarLabels[key],
    ...Object.fromEntries(
      scored.map((s) => [s.name, (s.score_breakdown as any)[key] ?? 0])
    ),
  }));

  // Bar data: overall scores
  const barData = scored.map((s) => ({
    name: s.name.length > 18 ? s.name.slice(0, 16) + "…" : s.name,
    Score: s.score ?? 0,
    Violations: -((s.score_breakdown as any).constraint_violations ?? 0),
  }));

  // Floor utilisation comparison (first scenario only for now)
  const floorUtil = scored.map((s) => {
    const fu = (s.score_breakdown as any)?.floor_utilization ?? {};
    return { name: s.name, ...Object.fromEntries(Object.entries(fu).map(([k, v]: any) => [k, v.pct])) };
  });

  const floorNames = Object.keys((scored[0].score_breakdown as any)?.floor_utilization ?? {});

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold text-white">Scenario Comparison</h2>

      {/* Score overview */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {scored.map((s, i) => (
          <div key={s.id} className="bg-gray-900 border border-gray-700 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
              <p className="text-xs text-gray-400 truncate">{s.name}</p>
            </div>
            <p className={`text-2xl font-bold ${s.score! >= 50 ? "text-emerald-400" : s.score! >= 0 ? "text-amber-400" : "text-red-400"}`}>
              {s.score?.toFixed(1)}
            </p>
            <p className="text-xs text-gray-500 mt-1">Overall score</p>
            {(s.score_breakdown as any)?.constraint_violations > 0 && (
              <p className="text-xs text-red-400 mt-1">
                {(s.score_breakdown as any).constraint_violations} constraint pts lost
              </p>
            )}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Radar chart */}
        <div className="bg-gray-900 border border-gray-700 rounded-xl p-4">
          <h3 className="text-sm font-medium text-gray-300 mb-4">Objective Breakdown</h3>
          <ResponsiveContainer width="100%" height={280}>
            <RadarChart data={radarData}>
              <PolarGrid stroke="#374151" />
              <PolarAngleAxis dataKey="metric" tick={{ fill: "#9ca3af", fontSize: 12 }} />
              {scored.map((s, i) => (
                <Radar
                  key={s.id}
                  name={s.name}
                  dataKey={s.name}
                  stroke={COLORS[i % COLORS.length]}
                  fill={COLORS[i % COLORS.length]}
                  fillOpacity={0.15}
                />
              ))}
              <Legend wrapperStyle={{ fontSize: "12px" }} />
            </RadarChart>
          </ResponsiveContainer>
        </div>

        {/* Bar chart */}
        <div className="bg-gray-900 border border-gray-700 rounded-xl p-4">
          <h3 className="text-sm font-medium text-gray-300 mb-4">Score vs Violations</h3>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={barData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
              <XAxis dataKey="name" tick={{ fill: "#9ca3af", fontSize: 11 }} />
              <YAxis tick={{ fill: "#9ca3af", fontSize: 11 }} />
              <Tooltip contentStyle={{ backgroundColor: "#1f2937", border: "1px solid #374151", borderRadius: "8px" }} />
              <Legend wrapperStyle={{ fontSize: "12px" }} />
              <Bar dataKey="Score" fill="#6366f1" radius={[4, 4, 0, 0]} />
              <Bar dataKey="Violations" fill="#ef4444" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Floor utilisation comparison */}
      {floorNames.length > 0 && (
        <div className="bg-gray-900 border border-gray-700 rounded-xl p-4">
          <h3 className="text-sm font-medium text-gray-300 mb-4">Floor Utilisation % by Scenario</h3>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={floorUtil}>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
              <XAxis dataKey="name" tick={{ fill: "#9ca3af", fontSize: 11 }} />
              <YAxis domain={[0, 120]} tick={{ fill: "#9ca3af", fontSize: 11 }} unit="%" />
              <Tooltip contentStyle={{ backgroundColor: "#1f2937", border: "1px solid #374151", borderRadius: "8px" }} />
              <Legend wrapperStyle={{ fontSize: "12px" }} />
              {floorNames.map((fn, i) => (
                <Bar key={fn} dataKey={fn} fill={COLORS[i % COLORS.length]} radius={[4, 4, 0, 0]} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Violation details */}
      {scored.some((s) => (s.score_breakdown as any)?.details?.length > 0) && (
        <div className="bg-gray-900 border border-gray-700 rounded-xl p-4">
          <h3 className="text-sm font-medium text-gray-300 mb-3">Constraint Details</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {scored.map((s, i) => {
              const details: string[] = (s.score_breakdown as any)?.details ?? [];
              if (details.length === 0) return null;
              return (
                <div key={s.id}>
                  <p className="text-xs font-medium mb-1.5" style={{ color: COLORS[i % COLORS.length] }}>
                    {s.name}
                  </p>
                  {details.map((d, j) => (
                    <p key={j} className={`text-xs ${d.startsWith("✗") ? "text-red-400" : d.startsWith("⚠") ? "text-amber-400" : "text-emerald-400"}`}>
                      {d}
                    </p>
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Team movement diff */}
      <ScenarioDiff scenarios={scenarios} diffIdA={diffIdA} diffIdB={diffIdB} setDiffIdA={setDiffIdA} setDiffIdB={setDiffIdB} />
    </div>
  );
}

interface DiffProps {
  scenarios: Scenario[];
  diffIdA: number | "";
  diffIdB: number | "";
  setDiffIdA: (v: number | "") => void;
  setDiffIdB: (v: number | "") => void;
}

function ScenarioDiff({ scenarios, diffIdA, diffIdB, setDiffIdA, setDiffIdB }: DiffProps) {
  const sA = scenarios.find((s) => s.id === diffIdA);
  const sB = scenarios.find((s) => s.id === diffIdB);

  const diff = (() => {
    if (!sA || !sB) return [];
    const allTeamIds = new Set([
      ...sA.allocations.map((a) => a.team_id),
      ...sB.allocations.map((a) => a.team_id),
    ]);
    return [...allTeamIds].map((teamId) => {
      const allocA = sA.allocations.find((a) => a.team_id === teamId);
      const allocB = sB.allocations.find((a) => a.team_id === teamId);
      const team = allocA?.team ?? allocB?.team!;
      const floorA = allocA?.floor.name ?? null;
      const floorB = allocB?.floor.name ?? null;
      const desksA = allocA?.desks_used ?? 0;
      const desksB = allocB?.desks_used ?? 0;
      let status: "same" | "moved" | "added" | "removed";
      if (floorA && floorB) status = floorA === floorB ? "same" : "moved";
      else if (!floorA) status = "added";
      else status = "removed";
      return { team, floorA, floorB, desksA, desksB, status };
    }).sort((a, b) => {
      const order = { moved: 0, added: 1, removed: 2, same: 3 };
      return order[a.status] - order[b.status];
    });
  })();

  const statusConfig = {
    same:    { label: "Same",    pill: "bg-gray-800 text-gray-400",     row: "" },
    moved:   { label: "Moved",   pill: "bg-amber-900 text-amber-300",   row: "bg-amber-950/20" },
    added:   { label: "New",     pill: "bg-emerald-900 text-emerald-300", row: "bg-emerald-950/20" },
    removed: { label: "Removed", pill: "bg-red-900 text-red-300",       row: "bg-red-950/20" },
  };

  const selectCls = "bg-gray-800 border border-gray-600 text-gray-200 text-sm rounded-lg px-3 py-1.5 focus:outline-none focus:border-indigo-500";

  return (
    <div className="bg-gray-900 border border-gray-700 rounded-xl p-4">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <h3 className="text-sm font-medium text-gray-300">Team Movement Diff</h3>
        <div className="flex items-center gap-2 text-xs flex-wrap">
          <select className={selectCls} value={diffIdA} onChange={(e) => setDiffIdA(e.target.value === "" ? "" : Number(e.target.value))}>
            <option value="">— Scenario A —</option>
            {scenarios.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <span className="text-gray-500">vs</span>
          <select className={selectCls} value={diffIdB} onChange={(e) => setDiffIdB(e.target.value === "" ? "" : Number(e.target.value))}>
            <option value="">— Scenario B —</option>
            {scenarios.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
      </div>

      {!sA || !sB ? (
        <p className="text-xs text-gray-500 text-center py-6">Select two scenarios above to see which teams moved between them.</p>
      ) : diff.length === 0 ? (
        <p className="text-xs text-gray-500 text-center py-6">No teams found in either scenario.</p>
      ) : (
        <>
          <div className="flex gap-4 mb-3 text-xs text-gray-500 flex-wrap">
            {(["moved", "added", "removed", "same"] as const).map((s) => {
              const count = diff.filter((d) => d.status === s).length;
              if (!count) return null;
              const { label, pill } = statusConfig[s];
              return (
                <span key={s} className="flex items-center gap-1.5">
                  <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${pill}`}>{label}</span>
                  <span>{count}</span>
                </span>
              );
            })}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-gray-800">
                  <th className="text-left pb-2 text-gray-500 font-medium pr-4">Team</th>
                  <th className="text-left pb-2 text-gray-500 font-medium pr-4">{sA.name}</th>
                  <th className="text-center pb-2 text-gray-500 font-medium px-2"></th>
                  <th className="text-left pb-2 text-gray-500 font-medium pr-4">{sB.name}</th>
                  <th className="text-left pb-2 text-gray-500 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {diff.map(({ team, floorA, floorB, desksA, desksB, status }) => {
                  const { label, pill, row } = statusConfig[status];
                  return (
                    <tr key={team.id} className={`border-b border-gray-800/50 ${row}`}>
                      <td className="py-2 pr-4">
                        <div className="flex items-center gap-1.5">
                          <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: team.color }} />
                          <span className="text-gray-200 font-medium">{team.name}</span>
                          <span className="text-gray-600">{team.headcount}p</span>
                        </div>
                      </td>
                      <td className="py-2 pr-4">
                        {floorA
                          ? <span className="text-gray-300">{floorA} <span className="text-gray-600">({desksA}d)</span></span>
                          : <span className="text-gray-600 italic">unallocated</span>
                        }
                      </td>
                      <td className="py-2 px-2 text-center text-gray-600">
                        {status === "moved" ? "→" : status === "added" ? "✦" : status === "removed" ? "✕" : "·"}
                      </td>
                      <td className="py-2 pr-4">
                        {floorB
                          ? <span className="text-gray-300">{floorB} <span className="text-gray-600">({desksB}d)</span></span>
                          : <span className="text-gray-600 italic">unallocated</span>
                        }
                      </td>
                      <td className="py-2">
                        <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${pill}`}>{label}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
