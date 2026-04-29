import { useState, useRef, useCallback, useEffect } from "react";
import { X, Crown } from "lucide-react";
import type { Floor, FloorElement, Team } from "../types";
import * as api from "../api";

type DrawMode = "none" | "desk" | "office" | "meeting_room";
type ElementType = "desk" | "office" | "meeting_room";

interface Props {
  floor: Floor;
  elements: FloorElement[];
  teams: Team[];
  onElementsChange: () => void;
  drawMode: DrawMode;
  onDrawModeChange: (m: DrawMode) => void;
}

interface Popover {
  elementId: number;
  screenX: number;
  screenY: number;
}

function hex2rgba(hex: string, alpha: number) {
  const n = parseInt(hex.replace("#", ""), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

function teamColor(teamId: number | null, teams: Team[], alpha: number): string {
  if (!teamId) return `rgba(75,85,99,${alpha})`;
  return hex2rgba(teams.find((t) => t.id === teamId)?.color ?? "#6366f1", alpha);
}

// Teal colour for unassigned meeting rooms
const MEETING_ROOM_COLOR = "rgba(20,184,166,";

export default function PdfFloorPlanCanvas({
  floor, elements, teams, onElementsChange, drawMode, onDrawModeChange,
}: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [popover, setPopover] = useState<Popover | null>(null);
  const [hovered, setHovered] = useState<number | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [lasso, setLasso] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const lassoStart = useRef<{ nx: number; ny: number } | null>(null);
  const [saving, setSaving] = useState(false);

  const desks = elements.filter((e) => e.element_type === "desk");
  const offices = elements.filter((e) => e.element_type === "office");
  const meetingRooms = elements.filter((e) => e.element_type === "meeting_room");

  const toNorm = useCallback((e: React.MouseEvent | MouseEvent): { nx: number; ny: number } => {
    const el = containerRef.current;
    if (!el) return { nx: 0, ny: 0 };
    const r = el.getBoundingClientRect();
    return {
      nx: (e.clientX - r.left) / r.width,
      ny: (e.clientY - r.top) / r.height,
    };
  }, []);

  const handleElementClick = (e: React.MouseEvent, el: FloorElement) => {
    e.stopPropagation();
    if (drawMode !== "none") return;
    const rect = (e.target as SVGElement).getBoundingClientRect();
    setPopover({ elementId: el.id, screenX: rect.left + rect.width / 2, screenY: rect.top });
    setSelected(new Set([el.id]));
  };

  const handleSvgClick = async (e: React.MouseEvent) => {
    if (drawMode === "none") {
      setPopover(null);
      setSelected(new Set());
      return;
    }
    const { nx, ny } = toNorm(e);
    const nw = drawMode === "desk" ? 0.025 : 0.06;
    const nh = drawMode === "desk" ? 0.018 : 0.08;
    setSaving(true);
    try {
      await api.addFloorElement(floor.id, {
        element_type: drawMode,
        nx: nx - nw / 2,
        ny: ny - nh / 2,
        nw,
        nh,
      });
      onElementsChange();
    } finally {
      setSaving(false);
    }
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (!e.shiftKey || drawMode !== "none") return;
    e.preventDefault();
    lassoStart.current = toNorm(e);
    setLasso({ x: lassoStart.current.nx, y: lassoStart.current.ny, w: 0, h: 0 });
  };

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!lassoStart.current || !containerRef.current) return;
      const { nx, ny } = toNorm(e);
      const sx = lassoStart.current.nx;
      const sy = lassoStart.current.ny;
      setLasso({ x: Math.min(sx, nx), y: Math.min(sy, ny), w: Math.abs(nx - sx), h: Math.abs(ny - sy) });
    };
    const onUp = () => {
      if (lasso) {
        const ids = new Set(
          elements
            .filter((el) => {
              const cx = el.nx + el.nw / 2;
              const cy = el.ny + el.nh / 2;
              return cx >= lasso.x && cx <= lasso.x + lasso.w && cy >= lasso.y && cy <= lasso.y + lasso.h;
            })
            .map((el) => el.id)
        );
        setSelected(ids);
      }
      lassoStart.current = null;
      setLasso(null);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  }, [elements, lasso, toNorm]);

  const assignSelected = async (teamId: number | null) => {
    if (!selected.size) return;
    setSaving(true);
    try {
      await api.bulkAssignElements(floor.id, [...selected], teamId);
      onElementsChange();
      setPopover(null);
      setSelected(new Set());
    } finally {
      setSaving(false);
    }
  };

  const deleteSelected = async () => {
    if (!selected.size) return;
    setSaving(true);
    try {
      await Promise.all([...selected].map((id) => api.deleteFloorElement(id)));
      onElementsChange();
      setSelected(new Set());
    } finally {
      setSaving(false);
    }
  };

  const deleteElement = async (id: number) => {
    setSaving(true);
    try {
      await api.deleteFloorElement(id);
      onElementsChange();
      setPopover(null);
    } finally {
      setSaving(false);
    }
  };

  const reclassify = async (id: number, type: ElementType) => {
    setSaving(true);
    try {
      await api.patchFloorElement(id, { element_type: type });
      onElementsChange();
      setPopover(null);
    } finally {
      setSaving(false);
    }
  };

  const aspectRatio =
    floor.pdf_page_width && floor.pdf_page_height
      ? floor.pdf_page_width / floor.pdf_page_height
      : 16 / 9;

  const popoverElement = popover ? elements.find((e) => e.id === popover.elementId) ?? null : null;

  const assignedDesks = desks.filter((d) => d.team_id).length;
  const assignedOffices = offices.filter((o) => o.team_id).length;

  return (
    <div className="space-y-2">
      {/* Stats bar */}
      <div className="flex items-center gap-4 text-xs text-gray-500 flex-wrap">
        <span>
          <span className="text-blue-400 font-medium">{desks.length}</span> desks
          {assignedDesks > 0 && <span className="text-gray-600"> · {assignedDesks} assigned</span>}
        </span>
        <span>
          <span className="text-purple-400 font-medium">{offices.length}</span> offices
          {assignedOffices > 0 && <span className="text-gray-600"> · {assignedOffices} assigned</span>}
        </span>
        {meetingRooms.length > 0 && (
          <span><span className="text-teal-400 font-medium">{meetingRooms.length}</span> meeting rooms</span>
        )}
        {selected.size > 0 && <span className="text-indigo-400 font-medium">{selected.size} selected</span>}
        {saving && <span className="text-gray-400 animate-pulse">Saving…</span>}
        <span className="ml-auto text-gray-600 italic">
          {drawMode === "none"
            ? "Click element to assign · Shift+drag to lasso select"
            : `Click to place ${drawMode.replace("_", " ")} · click toolbar button again to cancel`}
        </span>
      </div>

      {/* Canvas */}
      <div
        ref={containerRef}
        className={`relative w-full rounded-xl overflow-hidden select-none bg-gray-950 ${
          drawMode !== "none" ? "cursor-crosshair" : "cursor-default"
        }`}
        style={{ aspectRatio }}
        onMouseDown={handleMouseDown}
        onClick={handleSvgClick}
      >
        {floor.image_path && (
          <img
            src={floor.image_path}
            alt="Floor plan"
            className="absolute inset-0 w-full h-full"
            style={{ objectFit: "fill" }}
            draggable={false}
          />
        )}

        <svg
          ref={svgRef}
          className="absolute inset-0 w-full h-full"
          viewBox="0 0 1 1"
          preserveAspectRatio="none"
        >
          {/* Desk elements */}
          {desks.map((el) => {
            const isSelected = selected.has(el.id);
            const isHovered = hovered === el.id;
            const fill = teamColor(el.team_id, teams, isHovered || isSelected ? 0.85 : 0.65);
            const stroke = teamColor(el.team_id, teams, 1);
            return (
              <rect
                key={el.id}
                x={el.nx} y={el.ny} width={el.nw} height={el.nh}
                fill={fill}
                stroke={isSelected ? "#fff" : stroke}
                strokeWidth={isSelected ? 0.003 : 0.001}
                rx="0.002"
                style={{ cursor: "pointer" }}
                onMouseEnter={() => setHovered(el.id)}
                onMouseLeave={() => setHovered(null)}
                onClick={(e) => handleElementClick(e, el)}
              />
            );
          })}

          {/* Office elements */}
          {offices.map((el) => {
            const isSelected = selected.has(el.id);
            const isHovered = hovered === el.id;
            const fill = teamColor(el.team_id, teams, isHovered || isSelected ? 0.45 : 0.25);
            const stroke = teamColor(el.team_id, teams, 1);
            const cx = el.nx + el.nw / 2;
            const cy = el.ny + el.nh / 2;
            const fontSize = Math.min(el.nw, el.nh) * 0.35;
            return (
              <g key={el.id} style={{ cursor: "pointer" }}
                onMouseEnter={() => setHovered(el.id)}
                onMouseLeave={() => setHovered(null)}
                onClick={(e) => handleElementClick(e, el)}
              >
                <rect
                  x={el.nx} y={el.ny} width={el.nw} height={el.nh}
                  fill={fill} stroke={isSelected ? "#fff" : stroke}
                  strokeWidth={isSelected ? 0.004 : 0.003}
                  strokeDasharray={el.is_lead_office ? "0.012,0.006" : "none"}
                  rx="0.004"
                />
                {el.is_lead_office && (
                  <>
                    <text x={cx} y={el.ny + el.nh * 0.38} textAnchor="middle" dominantBaseline="middle"
                      fontSize={fontSize * 1.1} fill="white"
                      style={{ filter: "drop-shadow(0 1px 2px rgba(0,0,0,0.8))" }}>
                      👑
                    </text>
                    <text x={cx} y={el.ny + el.nh * 0.72} textAnchor="middle" dominantBaseline="middle"
                      fontSize={Math.min(fontSize, 0.018)} fill="white" fontWeight="600"
                      style={{ filter: "drop-shadow(0 1px 2px rgba(0,0,0,0.9))" }}>
                      {el.label || "Team Lead"}
                    </text>
                  </>
                )}
                {!el.is_lead_office && el.team_id && (
                  <text x={cx} y={cy} textAnchor="middle" dominantBaseline="middle"
                    fontSize={Math.min(fontSize, 0.02)} fill="white" fontWeight="600"
                    style={{ filter: "drop-shadow(0 1px 2px rgba(0,0,0,0.9))" }}>
                    {el.label || teams.find((t) => t.id === el.team_id)?.name}
                  </text>
                )}
                {!el.team_id && (
                  <text x={cx} y={cy} textAnchor="middle" dominantBaseline="middle"
                    fontSize={Math.min(fontSize, 0.018)} fill="rgba(156,163,175,0.8)">
                    Office
                  </text>
                )}
              </g>
            );
          })}

          {/* Meeting room elements */}
          {meetingRooms.map((el) => {
            const isSelected = selected.has(el.id);
            const isHovered = hovered === el.id;
            const alpha = isHovered || isSelected ? 0.45 : 0.25;
            const fill = el.team_id
              ? teamColor(el.team_id, teams, alpha)
              : `${MEETING_ROOM_COLOR}${alpha})`;
            const stroke = el.team_id
              ? teamColor(el.team_id, teams, 1)
              : "rgba(20,184,166,1)";
            const cx = el.nx + el.nw / 2;
            const cy = el.ny + el.nh / 2;
            const fontSize = Math.min(el.nw, el.nh) * 0.28;
            return (
              <g key={el.id} style={{ cursor: "pointer" }}
                onMouseEnter={() => setHovered(el.id)}
                onMouseLeave={() => setHovered(null)}
                onClick={(e) => handleElementClick(e, el)}
              >
                <rect
                  x={el.nx} y={el.ny} width={el.nw} height={el.nh}
                  fill={fill} stroke={isSelected ? "#fff" : stroke}
                  strokeWidth={isSelected ? 0.004 : 0.003}
                  strokeDasharray="0.008,0.004"
                  rx="0.006"
                />
                <text x={cx} y={cy - fontSize * 0.4} textAnchor="middle" dominantBaseline="middle"
                  fontSize={Math.min(fontSize * 0.8, 0.018)} fill="rgba(153,246,228,0.9)"
                  style={{ filter: "drop-shadow(0 1px 1px rgba(0,0,0,0.8))" }}>
                  📋
                </text>
                <text x={cx} y={cy + fontSize * 0.6} textAnchor="middle" dominantBaseline="middle"
                  fontSize={Math.min(fontSize * 0.7, 0.015)} fill="rgba(153,246,228,0.9)" fontWeight="600"
                  style={{ filter: "drop-shadow(0 1px 1px rgba(0,0,0,0.9))" }}>
                  {el.label || "Meeting Room"}
                </text>
              </g>
            );
          })}

          {/* Lasso rectangle */}
          {lasso && (
            <rect
              x={lasso.x} y={lasso.y} width={lasso.w} height={lasso.h}
              fill="rgba(99,102,241,0.15)" stroke="#6366f1"
              strokeWidth="0.002" strokeDasharray="0.01,0.005"
            />
          )}
        </svg>

        {/* Element popover */}
        {popover && popoverElement && (
          <ElementPopover
            element={popoverElement}
            teams={teams}
            screenX={popover.screenX}
            screenY={popover.screenY}
            containerRef={containerRef}
            onAssign={(tid) => assignSelected(tid)}
            onDelete={() => deleteElement(popoverElement.id)}
            onReclassify={(t) => reclassify(popoverElement.id, t)}
            onClose={() => { setPopover(null); setSelected(new Set()); }}
          />
        )}

        {/* Bulk-assign bar */}
        {selected.size > 1 && !popover && (
          <div className="absolute bottom-3 left-1/2 -translate-x-1/2 bg-gray-900 border border-gray-600 rounded-xl px-3 py-2 flex items-center gap-2 shadow-xl flex-wrap max-w-[90%]">
            <span className="text-xs text-gray-300 mr-1">{selected.size} selected — assign to:</span>
            {teams.map((t) => (
              <button
                key={t.id}
                onClick={(e) => { e.stopPropagation(); assignSelected(t.id); }}
                className="px-2 py-0.5 rounded-full text-xs text-white font-medium"
                style={{ backgroundColor: t.color + "cc" }}
              >
                {t.name}
              </button>
            ))}
            <button
              onClick={(e) => { e.stopPropagation(); assignSelected(null); }}
              className="px-2 py-0.5 rounded-full text-xs bg-gray-700 text-gray-300"
            >
              Unassign
            </button>
            <div className="w-px h-4 bg-gray-600 mx-1" />
            <button
              onClick={(e) => { e.stopPropagation(); deleteSelected(); }}
              className="px-2 py-0.5 rounded-full text-xs bg-red-900 text-red-300 hover:bg-red-800"
            >
              Delete {selected.size}
            </button>
            <button onClick={() => setSelected(new Set())} className="ml-1 text-gray-500 hover:text-white">
              <X size={12} />
            </button>
          </div>
        )}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-3 pt-1">
        {teams.map((t) => {
          const tDesks = desks.filter((d) => d.team_id === t.id).length;
          const tOffice = offices.find((o) => o.team_id === t.id && o.is_lead_office);
          if (!tDesks && !tOffice) return null;
          return (
            <div key={t.id} className="flex items-center gap-1.5 text-xs text-gray-300">
              <span className="w-3 h-3 rounded-sm flex-shrink-0" style={{ backgroundColor: t.color }} />
              <span>{t.name}</span>
              {tDesks > 0 && <span className="text-gray-500">{tDesks} desks</span>}
              {tOffice && (
                <span className="text-amber-400 flex items-center gap-0.5">
                  <Crown size={10} /> {t.team_lead_name || "Lead"}
                </span>
              )}
            </div>
          );
        })}
        {desks.filter((d) => !d.team_id).length > 0 && (
          <div className="flex items-center gap-1.5 text-xs text-gray-500">
            <span className="w-3 h-3 rounded-sm bg-gray-600" />
            Unassigned ({desks.filter((d) => !d.team_id).length})
          </div>
        )}
      </div>
    </div>
  );
}

interface PopoverProps {
  element: FloorElement;
  teams: Team[];
  screenX: number;
  screenY: number;
  containerRef: React.RefObject<HTMLDivElement>;
  onAssign: (teamId: number | null) => void;
  onDelete: () => void;
  onReclassify: (type: "desk" | "office" | "meeting_room") => void;
  onClose: () => void;
}

function ElementPopover({ element, teams, screenX, screenY, containerRef, onAssign, onDelete, onReclassify, onClose }: PopoverProps) {
  const rect = containerRef.current?.getBoundingClientRect();
  const POPOVER_W = 224;   // slightly wider than w-52 to be safe
  const POPOVER_H_EST = 260;

  const containerW = rect?.width ?? 800;
  const rawLeft = rect ? screenX - rect.left : 0;
  const rawTop = rect ? screenY - rect.top : 0;

  // Clamp horizontally so the popover never escapes the canvas
  const left = Math.max(POPOVER_W / 2 + 4, Math.min(rawLeft, containerW - POPOVER_W / 2 - 4));

  // Flip below the element when there isn't enough space above
  const showBelow = rawTop < POPOVER_H_EST + 8;
  const top = showBelow ? rawTop + 8 : Math.max(8, rawTop - 10);
  const transform = showBelow ? "translate(-50%, 0)" : "translate(-50%, -100%)";

  const currentTeam = teams.find((t) => t.id === element.team_id);
  const typeLabel =
    element.element_type === "office" ? "🏠 Office"
    : element.element_type === "meeting_room" ? "📋 Meeting Room"
    : "🪑 Desk";

  const otherTypes = (["desk", "office", "meeting_room"] as const).filter((t) => t !== element.element_type);

  return (
    <div
      className="absolute z-20 bg-gray-900 border border-gray-600 rounded-xl shadow-2xl p-3"
      style={{ width: `${POPOVER_W}px`, left: `${left}px`, top: `${top}px`, transform }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold text-gray-300">
          {typeLabel}{element.label && ` — ${element.label}`}
        </span>
        <button onClick={onClose} className="text-gray-500 hover:text-white"><X size={12} /></button>
      </div>

      {currentTeam && (
        <div className="flex items-center gap-1.5 mb-2 text-xs">
          <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: currentTeam.color }} />
          <span className="text-gray-300">{currentTeam.name}</span>
          {element.is_lead_office && <span className="text-amber-400">👑 Lead office</span>}
        </div>
      )}

      <div className="space-y-1">
        <p className="text-xs text-gray-500 mb-1">Assign to team:</p>
        <div className="flex flex-wrap gap-1">
          {teams.map((t) => (
            <button
              key={t.id}
              onClick={() => onAssign(t.id)}
              className={`px-2 py-0.5 rounded-full text-xs text-white font-medium transition-opacity ${
                t.id === element.team_id ? "ring-2 ring-white" : "opacity-80 hover:opacity-100"
              }`}
              style={{ backgroundColor: t.color + "cc" }}
            >
              {t.name}
              {t.has_team_lead && element.element_type === "office" && " 👑"}
            </button>
          ))}
          {element.team_id && (
            <button
              onClick={() => onAssign(null)}
              className="px-2 py-0.5 rounded-full text-xs bg-gray-700 text-gray-300 hover:bg-gray-600"
            >
              Unassign
            </button>
          )}
        </div>

        <div className="border-t border-gray-700 pt-1.5 mt-1.5 flex gap-1 flex-wrap">
          {otherTypes.map((t) => (
            <button
              key={t}
              onClick={() => onReclassify(t)}
              className="flex-1 text-xs text-gray-400 hover:text-white bg-gray-800 hover:bg-gray-700 rounded px-2 py-1 whitespace-nowrap"
            >
              → {t === "meeting_room" ? "Meeting Room" : t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
          <button
            onClick={onDelete}
            className="text-xs text-red-400 hover:text-red-300 bg-gray-800 hover:bg-gray-700 rounded px-2 py-1"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}
