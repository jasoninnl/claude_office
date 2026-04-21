import { useState } from "react";
import { Plus, Pencil, Trash2, X, Check, DoorOpen } from "lucide-react";
import type { Floor, MeetingRoom } from "../types";
import * as api from "../api";

interface Props {
  floors: Floor[];
  onFloorChange: () => void;
}

const emptyFloor = (): Omit<Floor, "id"> => ({
  name: "",
  level: 1,
  total_desks: 60,
  meeting_rooms: [],
  amenities: [],
  notes: "",
});

export default function FloorManager({ floors, onFloorChange }: Props) {
  const [editing, setEditing] = useState<number | "new" | null>(null);
  const [form, setForm] = useState<Omit<Floor, "id">>(emptyFloor());
  const [roomInput, setRoomInput] = useState({ name: "", capacity: 8 });
  const [amenityInput, setAmenityInput] = useState("");

  const startEdit = (floor: Floor) => {
    setEditing(floor.id);
    setForm({ ...floor });
  };

  const startNew = () => {
    setEditing("new");
    setForm({ ...emptyFloor(), level: floors.length + 1 });
  };

  const cancel = () => {
    setEditing(null);
    setForm(emptyFloor());
  };

  const save = async () => {
    if (!form.name.trim()) return;
    if (editing === "new") {
      await api.createFloor(form);
    } else if (typeof editing === "number") {
      await api.updateFloor(editing, form);
    }
    onFloorChange();
    cancel();
  };

  const remove = async (id: number) => {
    if (!confirm("Delete this floor? All scenario allocations to this floor will be removed.")) return;
    await api.deleteFloor(id);
    onFloorChange();
  };

  const addRoom = () => {
    if (!roomInput.name.trim()) return;
    setForm((f) => ({ ...f, meeting_rooms: [...f.meeting_rooms, { ...roomInput }] }));
    setRoomInput({ name: "", capacity: 8 });
  };

  const removeRoom = (i: number) =>
    setForm((f) => ({ ...f, meeting_rooms: f.meeting_rooms.filter((_, idx) => idx !== i) }));

  const addAmenity = () => {
    if (!amenityInput.trim()) return;
    setForm((f) => ({ ...f, amenities: [...f.amenities, amenityInput.trim()] }));
    setAmenityInput("");
  };

  const removeAmenity = (i: number) =>
    setForm((f) => ({ ...f, amenities: f.amenities.filter((_, idx) => idx !== i) }));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-white">Floors</h2>
        <button
          onClick={startNew}
          className="flex items-center gap-2 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-sm font-medium transition-colors"
        >
          <Plus size={14} /> Add Floor
        </button>
      </div>

      {/* Floor list */}
      <div className="space-y-3">
        {[...floors].sort((a, b) => a.level - b.level).map((floor) => (
          <div key={floor.id} className="bg-gray-900 border border-gray-700 rounded-xl">
            {editing === floor.id ? (
              <FloorForm
                form={form}
                setForm={setForm}
                roomInput={roomInput}
                setRoomInput={setRoomInput}
                amenityInput={amenityInput}
                setAmenityInput={setAmenityInput}
                addRoom={addRoom}
                removeRoom={removeRoom}
                addAmenity={addAmenity}
                removeAmenity={removeAmenity}
                onSave={save}
                onCancel={cancel}
              />
            ) : (
              <div className="flex items-start justify-between p-4">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-400 font-mono">L{floor.level}</span>
                    <h3 className="font-semibold text-white">{floor.name}</h3>
                  </div>
                  <div className="flex flex-wrap gap-4 mt-1 text-sm text-gray-400">
                    <span>{floor.total_desks} desks</span>
                    <span className="flex items-center gap-1">
                      <DoorOpen size={13} />
                      {floor.meeting_rooms.length} meeting rooms
                      {floor.meeting_rooms.length > 0 && (
                        <span className="text-xs text-gray-500">
                          ({floor.meeting_rooms.map((r) => `${r.name}(${r.capacity})`).join(", ")})
                        </span>
                      )}
                    </span>
                    {floor.amenities.length > 0 && (
                      <span>{floor.amenities.join(", ")}</span>
                    )}
                  </div>
                  {floor.notes && <p className="text-xs text-gray-500 mt-1">{floor.notes}</p>}
                </div>
                <div className="flex gap-2 ml-4">
                  <button onClick={() => startEdit(floor)} className="p-1.5 text-gray-400 hover:text-white rounded">
                    <Pencil size={14} />
                  </button>
                  <button onClick={() => remove(floor.id)} className="p-1.5 text-gray-400 hover:text-red-400 rounded">
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* New floor form */}
      {editing === "new" && (
        <div className="bg-gray-900 border border-indigo-600 rounded-xl">
          <div className="px-4 pt-3 pb-1 text-sm font-medium text-indigo-400">New Floor</div>
          <FloorForm
            form={form}
            setForm={setForm}
            roomInput={roomInput}
            setRoomInput={setRoomInput}
            amenityInput={amenityInput}
            setAmenityInput={setAmenityInput}
            addRoom={addRoom}
            removeRoom={removeRoom}
            addAmenity={addAmenity}
            removeAmenity={removeAmenity}
            onSave={save}
            onCancel={cancel}
          />
        </div>
      )}
    </div>
  );
}

interface FormProps {
  form: Omit<Floor, "id">;
  setForm: React.Dispatch<React.SetStateAction<Omit<Floor, "id">>>;
  roomInput: { name: string; capacity: number };
  setRoomInput: React.Dispatch<React.SetStateAction<{ name: string; capacity: number }>>;
  amenityInput: string;
  setAmenityInput: React.Dispatch<React.SetStateAction<string>>;
  addRoom: () => void;
  removeRoom: (i: number) => void;
  addAmenity: () => void;
  removeAmenity: (i: number) => void;
  onSave: () => void;
  onCancel: () => void;
}

function FloorForm({ form, setForm, roomInput, setRoomInput, amenityInput, setAmenityInput, addRoom, removeRoom, addAmenity, removeAmenity, onSave, onCancel }: FormProps) {
  return (
    <div className="p-4 space-y-3">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="col-span-2">
          <label className="text-xs text-gray-400">Name</label>
          <input
            className="mt-1 w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-indigo-500"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            placeholder="e.g. Ground Floor"
          />
        </div>
        <div>
          <label className="text-xs text-gray-400">Level</label>
          <input
            type="number" min={1} max={20}
            className="mt-1 w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-indigo-500"
            value={form.level}
            onChange={(e) => setForm((f) => ({ ...f, level: +e.target.value }))}
          />
        </div>
        <div>
          <label className="text-xs text-gray-400">Total Desks</label>
          <input
            type="number" min={0}
            className="mt-1 w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-indigo-500"
            value={form.total_desks}
            onChange={(e) => setForm((f) => ({ ...f, total_desks: +e.target.value }))}
          />
        </div>
      </div>

      {/* Meeting rooms */}
      <div>
        <label className="text-xs text-gray-400">Meeting Rooms</label>
        <div className="flex flex-wrap gap-1.5 mt-1">
          {form.meeting_rooms.map((r, i) => (
            <span key={i} className="flex items-center gap-1 px-2 py-0.5 bg-gray-700 rounded-full text-xs text-gray-200">
              {r.name} ({r.capacity}) <button onClick={() => removeRoom(i)}><X size={10} /></button>
            </span>
          ))}
        </div>
        <div className="flex gap-2 mt-1.5">
          <input
            className="flex-1 bg-gray-800 border border-gray-600 rounded-lg px-2 py-1 text-xs text-white focus:outline-none focus:border-indigo-500"
            placeholder="Room name"
            value={roomInput.name}
            onChange={(e) => setRoomInput((r) => ({ ...r, name: e.target.value }))}
            onKeyDown={(e) => e.key === "Enter" && addRoom()}
          />
          <input
            type="number" min={1} max={100}
            className="w-20 bg-gray-800 border border-gray-600 rounded-lg px-2 py-1 text-xs text-white focus:outline-none focus:border-indigo-500"
            placeholder="Cap"
            value={roomInput.capacity}
            onChange={(e) => setRoomInput((r) => ({ ...r, capacity: +e.target.value }))}
          />
          <button onClick={addRoom} className="px-2 py-1 bg-gray-700 hover:bg-gray-600 rounded-lg text-xs text-white">
            + Add
          </button>
        </div>
      </div>

      {/* Amenities */}
      <div>
        <label className="text-xs text-gray-400">Amenities</label>
        <div className="flex flex-wrap gap-1.5 mt-1">
          {form.amenities.map((a, i) => (
            <span key={i} className="flex items-center gap-1 px-2 py-0.5 bg-gray-700 rounded-full text-xs text-gray-200">
              {a} <button onClick={() => removeAmenity(i)}><X size={10} /></button>
            </span>
          ))}
        </div>
        <div className="flex gap-2 mt-1.5">
          <input
            className="flex-1 bg-gray-800 border border-gray-600 rounded-lg px-2 py-1 text-xs text-white focus:outline-none focus:border-indigo-500"
            placeholder="e.g. Kitchen, Phone Booths"
            value={amenityInput}
            onChange={(e) => setAmenityInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addAmenity()}
          />
          <button onClick={addAmenity} className="px-2 py-1 bg-gray-700 hover:bg-gray-600 rounded-lg text-xs text-white">
            + Add
          </button>
        </div>
      </div>

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
