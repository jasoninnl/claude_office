import { useState } from "react";
import { Plus, Pencil, Trash2, X, Check, Users, Link, ArrowUpDown, Unlink } from "lucide-react";
import type { Team } from "../types";
import * as api from "../api";

interface Props {
  teams: Team[];
  onTeamChange: () => void;
}

const COLORS = [
  "#3b82f6", "#8b5cf6", "#ec4899", "#f59e0b", "#10b981",
  "#6366f1", "#14b8a6", "#f97316", "#84cc16", "#94a3b8",
  "#ef4444", "#06b6d4", "#a855f7", "#f43f5e", "#22c55e",
];

const emptyTeam = (): Omit<Team, "id"> => ({
  name: "",
  headcount: 10,
  department: "",
  color: COLORS[0],
  required_desks: 0,
  min_meeting_room_capacity: 0,
  meeting_rooms_needed: 0,
  must_be_with: [],
  must_be_near: [],
  must_separate_from: [],
  floor_preference: null,
  notes: "",
});

export default function TeamManager({ teams, onTeamChange }: Props) {
  const [editing, setEditing] = useState<number | "new" | null>(null);
  const [form, setForm] = useState<Omit<Team, "id">>(emptyTeam());

  const teamMap = Object.fromEntries(teams.map((t) => [t.id, t]));

  const startEdit = (team: Team) => {
    setEditing(team.id);
    setForm({ ...team });
  };

  const startNew = () => {
    setEditing("new");
    setForm({ ...emptyTeam(), color: COLORS[teams.length % COLORS.length] });
  };

  const cancel = () => {
    setEditing(null);
    setForm(emptyTeam());
  };

  const save = async () => {
    if (!form.name.trim()) return;
    const data = {
      ...form,
      required_desks: form.required_desks || 0,
      floor_preference: form.floor_preference ?? null,
    };
    if (editing === "new") {
      await api.createTeam(data);
    } else if (typeof editing === "number") {
      await api.updateTeam(editing, data);
    }
    onTeamChange();
    cancel();
  };

  const remove = async (id: number) => {
    if (!confirm("Delete this team?")) return;
    await api.deleteTeam(id);
    onTeamChange();
  };

  const toggleRelation = (
    field: "must_be_with" | "must_be_near" | "must_separate_from",
    id: number
  ) => {
    setForm((f) => {
      const current = f[field] as number[];
      return {
        ...f,
        [field]: current.includes(id) ? current.filter((x) => x !== id) : [...current, id],
      };
    });
  };

  const departments = Array.from(new Set(teams.map((t) => t.department).filter(Boolean)));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-white">Teams</h2>
        <button
          onClick={startNew}
          className="flex items-center gap-2 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-sm font-medium transition-colors"
        >
          <Plus size={14} /> Add Team
        </button>
      </div>

      <div className="space-y-2">
        {teams.map((team) => (
          <div key={team.id} className="bg-gray-900 border border-gray-700 rounded-xl">
            {editing === team.id ? (
              <TeamForm
                form={form}
                setForm={setForm}
                teams={teams}
                editingId={team.id}
                toggleRelation={toggleRelation}
                onSave={save}
                onCancel={cancel}
              />
            ) : (
              <div className="flex items-start justify-between p-4">
                <div className="flex items-start gap-3">
                  <div
                    className="w-3 h-3 rounded-full mt-1.5 flex-shrink-0"
                    style={{ backgroundColor: team.color }}
                  />
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold text-white">{team.name}</h3>
                      {team.department && (
                        <span className="text-xs text-gray-500 bg-gray-800 px-1.5 py-0.5 rounded">
                          {team.department}
                        </span>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-3 mt-0.5 text-sm text-gray-400">
                      <span className="flex items-center gap-1">
                        <Users size={12} /> {team.headcount} people
                      </span>
                      {team.meeting_rooms_needed > 0 && (
                        <span>{team.meeting_rooms_needed} meeting room(s)</span>
                      )}
                      {team.floor_preference !== null && (
                        <span>Prefers floor {team.floor_preference}</span>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-1.5 mt-1">
                      {team.must_be_with.map((id) => teamMap[id] && (
                        <span key={id} className="text-xs px-1.5 py-0.5 bg-emerald-950 text-emerald-400 rounded border border-emerald-800">
                          ↔ {teamMap[id].name}
                        </span>
                      ))}
                      {team.must_be_near.map((id) => teamMap[id] && (
                        <span key={id} className="text-xs px-1.5 py-0.5 bg-blue-950 text-blue-400 rounded border border-blue-800">
                          ≈ {teamMap[id].name}
                        </span>
                      ))}
                      {team.must_separate_from.map((id) => teamMap[id] && (
                        <span key={id} className="text-xs px-1.5 py-0.5 bg-red-950 text-red-400 rounded border border-red-800">
                          ✕ {teamMap[id].name}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="flex gap-2 ml-4">
                  <button onClick={() => startEdit(team)} className="p-1.5 text-gray-400 hover:text-white rounded">
                    <Pencil size={14} />
                  </button>
                  <button onClick={() => remove(team.id)} className="p-1.5 text-gray-400 hover:text-red-400 rounded">
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {editing === "new" && (
        <div className="bg-gray-900 border border-indigo-600 rounded-xl">
          <div className="px-4 pt-3 pb-1 text-sm font-medium text-indigo-400">New Team</div>
          <TeamForm
            form={form}
            setForm={setForm}
            teams={teams}
            editingId={null}
            toggleRelation={toggleRelation}
            onSave={save}
            onCancel={cancel}
          />
        </div>
      )}
    </div>
  );
}

interface TeamFormProps {
  form: Omit<Team, "id">;
  setForm: React.Dispatch<React.SetStateAction<Omit<Team, "id">>>;
  teams: Team[];
  editingId: number | null;
  toggleRelation: (field: "must_be_with" | "must_be_near" | "must_separate_from", id: number) => void;
  onSave: () => void;
  onCancel: () => void;
}

function TeamForm({ form, setForm, teams, editingId, toggleRelation, onSave, onCancel }: TeamFormProps) {
  const otherTeams = teams.filter((t) => t.id !== editingId);

  return (
    <div className="p-4 space-y-3">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="col-span-2">
          <label className="text-xs text-gray-400">Team Name</label>
          <input
            className="mt-1 w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-indigo-500"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            placeholder="e.g. Engineering"
          />
        </div>
        <div>
          <label className="text-xs text-gray-400">Headcount</label>
          <input
            type="number" min={1}
            className="mt-1 w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-indigo-500"
            value={form.headcount}
            onChange={(e) => setForm((f) => ({ ...f, headcount: +e.target.value }))}
          />
        </div>
        <div>
          <label className="text-xs text-gray-400">Desks Override</label>
          <input
            type="number" min={0}
            className="mt-1 w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-indigo-500"
            value={form.required_desks}
            onChange={(e) => setForm((f) => ({ ...f, required_desks: +e.target.value }))}
            placeholder="0 = use headcount"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div>
          <label className="text-xs text-gray-400">Department</label>
          <input
            className="mt-1 w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-indigo-500"
            value={form.department}
            onChange={(e) => setForm((f) => ({ ...f, department: e.target.value }))}
            placeholder="e.g. Technology"
          />
        </div>
        <div>
          <label className="text-xs text-gray-400">Mtg Rooms Needed</label>
          <input
            type="number" min={0}
            className="mt-1 w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-indigo-500"
            value={form.meeting_rooms_needed}
            onChange={(e) => setForm((f) => ({ ...f, meeting_rooms_needed: +e.target.value }))}
          />
        </div>
        <div>
          <label className="text-xs text-gray-400">Min Room Capacity</label>
          <input
            type="number" min={0}
            className="mt-1 w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-indigo-500"
            value={form.min_meeting_room_capacity}
            onChange={(e) => setForm((f) => ({ ...f, min_meeting_room_capacity: +e.target.value }))}
          />
        </div>
        <div>
          <label className="text-xs text-gray-400">Floor Preference</label>
          <input
            type="number" min={1}
            className="mt-1 w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-indigo-500"
            value={form.floor_preference ?? ""}
            placeholder="Any"
            onChange={(e) => setForm((f) => ({ ...f, floor_preference: e.target.value ? +e.target.value : null }))}
          />
        </div>
      </div>

      {/* Color */}
      <div>
        <label className="text-xs text-gray-400">Colour</label>
        <div className="flex flex-wrap gap-1.5 mt-1">
          {COLORS.map((c) => (
            <button
              key={c}
              onClick={() => setForm((f) => ({ ...f, color: c }))}
              className={`w-6 h-6 rounded-full transition-transform ${form.color === c ? "ring-2 ring-white scale-110" : "hover:scale-110"}`}
              style={{ backgroundColor: c }}
            />
          ))}
        </div>
      </div>

      {/* Constraints */}
      {otherTeams.length > 0 && (
        <div>
          <label className="text-xs text-gray-400 block mb-1.5">Team Relationships</label>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <RelationBox
              label="Must share floor"
              color="emerald"
              teams={otherTeams}
              selected={form.must_be_with as number[]}
              onToggle={(id) => toggleRelation("must_be_with", id)}
            />
            <RelationBox
              label="Prefer nearby"
              color="blue"
              teams={otherTeams}
              selected={form.must_be_near as number[]}
              onToggle={(id) => toggleRelation("must_be_near", id)}
            />
            <RelationBox
              label="Must separate"
              color="red"
              teams={otherTeams}
              selected={form.must_separate_from as number[]}
              onToggle={(id) => toggleRelation("must_separate_from", id)}
            />
          </div>
        </div>
      )}

      {/* Notes */}
      <div>
        <label className="text-xs text-gray-400">Notes</label>
        <textarea
          className="mt-1 w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-indigo-500 resize-none"
          rows={2}
          value={form.notes}
          onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
        />
      </div>

      <div className="flex gap-2 justify-end">
        <button onClick={onCancel} className="px-3 py-1.5 text-sm text-gray-400 hover:text-white rounded-lg">
          Cancel
        </button>
        <button
          onClick={onSave}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-sm font-medium"
        >
          <Check size={14} /> Save
        </button>
      </div>
    </div>
  );
}

function RelationBox({
  label, color, teams, selected, onToggle,
}: {
  label: string;
  color: "emerald" | "blue" | "red";
  teams: Team[];
  selected: number[];
  onToggle: (id: number) => void;
}) {
  const styles = {
    emerald: { border: "border-emerald-800", bg: "bg-emerald-950", text: "text-emerald-400", active: "bg-emerald-800" },
    blue: { border: "border-blue-800", bg: "bg-blue-950", text: "text-blue-400", active: "bg-blue-800" },
    red: { border: "border-red-800", bg: "bg-red-950", text: "text-red-400", active: "bg-red-800" },
  }[color];

  return (
    <div className={`border ${styles.border} rounded-lg p-2`}>
      <p className={`text-xs font-medium ${styles.text} mb-1.5`}>{label}</p>
      <div className="flex flex-wrap gap-1">
        {teams.map((t) => (
          <button
            key={t.id}
            onClick={() => onToggle(t.id)}
            className={`px-1.5 py-0.5 rounded text-xs transition-colors ${
              selected.includes(t.id)
                ? `${styles.active} ${styles.text}`
                : "bg-gray-800 text-gray-400 hover:bg-gray-700"
            }`}
          >
            {t.name}
          </button>
        ))}
      </div>
    </div>
  );
}
