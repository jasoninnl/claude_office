import { useState, useRef, useCallback, useEffect } from "react";
import { X, Crown, RotateCcw, RotateCw } from "lucide-react";
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
  const [deskOrientation, setDeskOrientation] = useState<"landscape" | "portrait">("landscape");
  const [preview, setPreview] = useState<{ nx: number; ny: number; nw: number; nh: number } | null>(null);
  const [dragging, setDragging] = useState<{
    id: number; origNx: number; origNy: number;
    offsetNx: number; offsetNy: number; nx: number; ny: number;
  } | null>(null);
  const draggingRef = useRef<typeof dragging>(null);
  const dragMovedRef = useRef(false);

  type HistoryEntry = { undo: () => Promise<void>; redo: () => Promise<void> };
  const undoStack = useRef<HistoryEntry[]>([]);
  const redoStack = useRef<HistoryEntry[]>([]);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  // Always up-to-date ref so closures in undo/redo entries don't go stale
  const onChangeRef = useRef(onElementsChange);
  onChangeRef.current = onElementsChange;

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

  // Returns snapped top-left position for a desk placed at cursor (cx,cy)
  const snapDesk = useCallback((cx: number, cy: number, nw: number, nh: number): { nx: number; ny: number } => {
    const THRESHOLD = 0.09;
    const GAP = 0.004;
    let best = Infinity;
    let result = { nx: cx - nw / 2, ny: cy - nh / 2 };
    for (const desk of desks) {
      const ecx = desk.nx + desk.nw / 2;
      const ecy = desk.ny + desk.nh / 2;
      const dx = Math.abs(cx - ecx);
      const dy = Math.abs(cy - ecy);
      const dist = dx * dx + dy * dy;
      if (dist < THRESHOLD * THRESHOLD && dist < best) {
        best = dist;
        if (dy <= dx) {
          // Same horizontal row — align Y centres, place adjacent on X
          const snappedCx = cx >= ecx
            ? ecx + desk.nw / 2 + GAP + nw / 2
            : ecx - desk.nw / 2 - GAP - nw / 2;
          result = { nx: snappedCx - nw / 2, ny: ecy - nh / 2 };
        } else {
          // Same vertical column — align X centres, place adjacent on Y
          const snappedCy = cy >= ecy
            ? ecy + desk.nh / 2 + GAP + nh / 2
            : ecy - desk.nh / 2 - GAP - nh / 2;
          result = { nx: ecx - nw / 2, ny: snappedCy - nh / 2 };
        }
      }
    }
    return result;
  }, [desks]);

  const pushHistory = useCallback((entry: HistoryEntry) => {
    undoStack.current.push(entry);
    redoStack.current = [];
    setCanUndo(true);
    setCanRedo(false);
  }, []);

  const handleUndo = useCallback(async () => {
    const entry = undoStack.current.pop();
    if (!entry) return;
    await entry.undo();
    redoStack.current.push(entry);
    setCanUndo(undoStack.current.length > 0);
    setCanRedo(true);
  }, []);

  const handleRedo = useCallback(async () => {
    const entry = redoStack.current.pop();
    if (!entry) return;
    await entry.redo();
    undoStack.current.push(entry);
    setCanUndo(true);
    setCanRedo(redoStack.current.length > 0);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        handleUndo();
      } else if ((e.metaKey || e.ctrlKey) && (e.key === "y" || (e.key === "z" && e.shiftKey))) {
        e.preventDefault();
        handleRedo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handleUndo, handleRedo]);

  const handleElementMouseDown = useCallback((e: React.MouseEvent, el: FloorElement) => {
    if (e.shiftKey || drawMode !== "none") return;
    e.stopPropagation();
    const { nx, ny } = toNorm(e);
    dragMovedRef.current = false;
    const state = { id: el.id, origNx: el.nx, origNy: el.ny, offsetNx: nx - el.nx, offsetNy: ny - el.ny, nx: el.nx, ny: el.ny };
    draggingRef.current = state;
    setDragging(state);
  }, [drawMode, toNorm]);

  const handleElementClick = (e: React.MouseEvent, el: FloorElement) => {
    e.stopPropagation();
    if (drawMode !== "none") return;
    if (dragMovedRef.current) return; // was a drag, not a click
    const rect = (e.target as SVGElement).getBoundingClientRect();
    setPopover({ elementId: el.id, screenX: rect.left + rect.width / 2, screenY: rect.top });
    setSelected(new Set([el.id]));
  };

  const deskSize = useCallback((): { nw: number; nh: number } => {
    if (deskOrientation === "landscape") return { nw: 0.025, nh: 0.018 };
    // Portrait: rotate 90° keeping the same physical pixel footprint.
    // nw_landscape * page_width == nh_portrait * page_width  →  must compensate for aspect ratio.
    const pw = floor.pdf_page_width || 842;
    const ph = floor.pdf_page_height || 595;
    return { nw: (0.018 * ph) / pw, nh: (0.025 * pw) / ph };
  }, [deskOrientation, floor.pdf_page_width, floor.pdf_page_height]);

  const handleMouseMove = (e: React.MouseEvent) => {
    if (drawMode === "none") { setPreview(null); return; }
    const { nx, ny } = toNorm(e);
    if (drawMode === "desk") {
      const { nw, nh } = deskSize();
      const pos = snapDesk(nx, ny, nw, nh);
      setPreview({ ...pos, nw, nh });
    } else {
      const nw = 0.06, nh = 0.08;
      setPreview({ nx: nx - nw / 2, ny: ny - nh / 2, nw, nh });
    }
  };

  const handleSvgClick = async (e: React.MouseEvent) => {
    if (drawMode === "none") {
      setPopover(null);
      setSelected(new Set());
      return;
    }
    const { nx, ny } = toNorm(e);
    let finalNx: number, finalNy: number, nw: number, nh: number;
    if (drawMode === "desk") {
      ({ nw, nh } = deskSize());
      const pos = snapDesk(nx, ny, nw, nh);
      finalNx = pos.nx; finalNy = pos.ny;
    } else {
      nw = 0.06; nh = 0.08;
      finalNx = nx - nw / 2; finalNy = ny - nh / 2;
    }
    setSaving(true);
    try {
      const params = { element_type: drawMode, nx: finalNx, ny: finalNy, nw, nh, label: "" };
      let addedId: number | null = null;
      const doAdd = async () => {
        const el = await api.addFloorElement(floor.id, params);
        addedId = el.id;
        onChangeRef.current();
      };
      const doDelete = async () => {
        if (addedId != null) { await api.deleteFloorElement(addedId); onChangeRef.current(); }
      };
      await doAdd();
      pushHistory({ undo: doDelete, redo: doAdd });
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
      // Lasso tracking
      if (lassoStart.current && containerRef.current) {
        const { nx, ny } = toNorm(e);
        const sx = lassoStart.current.nx, sy = lassoStart.current.ny;
        setLasso({ x: Math.min(sx, nx), y: Math.min(sy, ny), w: Math.abs(nx - sx), h: Math.abs(ny - sy) });
      }
      // Drag tracking
      if (draggingRef.current) {
        const { nx, ny } = toNorm(e);
        const newNx = nx - draggingRef.current.offsetNx;
        const newNy = ny - draggingRef.current.offsetNy;
        if (Math.hypot(newNx - draggingRef.current.origNx, newNy - draggingRef.current.origNy) > 0.005) {
          dragMovedRef.current = true;
        }
        const updated = { ...draggingRef.current, nx: newNx, ny: newNy };
        draggingRef.current = updated;
        setDragging(updated);
      }
    };
    const onUp = () => {
      // Lasso commit
      if (lasso) {
        const ids = new Set(
          elements.filter((el) => {
            const cx = el.nx + el.nw / 2, cy = el.ny + el.nh / 2;
            return cx >= lasso.x && cx <= lasso.x + lasso.w && cy >= lasso.y && cy <= lasso.y + lasso.h;
          }).map((el) => el.id)
        );
        setSelected(ids);
      }
      lassoStart.current = null;
      setLasso(null);
      // Drag commit
      const d = draggingRef.current;
      if (d && dragMovedRef.current) {
        const elementId = d.id;
        const origNx = d.origNx, origNy = d.origNy;
        const newNx = d.nx, newNy = d.ny;
        api.patchFloorElement(elementId, { nx: newNx, ny: newNy }).then(() => {
          onChangeRef.current();
          pushHistory({
            undo: async () => { await api.patchFloorElement(elementId, { nx: origNx, ny: origNy }); onChangeRef.current(); },
            redo: async () => { await api.patchFloorElement(elementId, { nx: newNx, ny: newNy }); onChangeRef.current(); },
          });
        });
      }
      draggingRef.current = null;
      setDragging(null);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  }, [elements, lasso, toNorm, onElementsChange, pushHistory]);

  const assignSelected = async (teamId: number | null) => {
    if (!selected.size) return;
    setSaving(true);
    try {
      const elementIds = [...selected];
      const prevStates = elementIds.map((id) => {
        const el = elements.find((e) => e.id === id);
        return { team_id: el?.team_id ?? null, is_lead_office: el?.is_lead_office ?? false };
      });
      const newTeamId = teamId;
      const doAssign = async () => {
        await api.bulkAssignElements(floor.id, elementIds, newTeamId);
        onChangeRef.current();
        setPopover(null);
        setSelected(new Set());
      };
      const doRestore = async () => {
        await Promise.all(elementIds.map((id, i) =>
          api.patchFloorElement(id, { team_id: prevStates[i].team_id, is_lead_office: prevStates[i].is_lead_office })
        ));
        onChangeRef.current();
      };
      await doAssign();
      pushHistory({ undo: doRestore, redo: doAssign });
    } finally {
      setSaving(false);
    }
  };

  const deleteSelected = async () => {
    if (!selected.size) return;
    setSaving(true);
    try {
      const toDelete = elements.filter((e) => selected.has(e.id));
      const snapshots = toDelete.map((el) => ({
        element_type: el.element_type, nx: el.nx, ny: el.ny, nw: el.nw, nh: el.nh, label: el.label,
      }));
      const currentIds = toDelete.map((el) => el.id);
      const doDelete = async () => {
        await Promise.all(currentIds.map((id) => api.deleteFloorElement(id)));
        onChangeRef.current();
        setSelected(new Set());
      };
      const doAdd = async () => {
        const added = await Promise.all(snapshots.map((s) => api.addFloorElement(floor.id, s)));
        added.forEach((el, i) => { currentIds[i] = el.id; });
        onChangeRef.current();
      };
      await doDelete();
      pushHistory({ undo: doAdd, redo: doDelete });
    } finally {
      setSaving(false);
    }
  };

  const deleteElement = async (id: number) => {
    const el = elements.find((e) => e.id === id);
    if (!el) return;
    setSaving(true);
    try {
      const snapshot = { element_type: el.element_type, nx: el.nx, ny: el.ny, nw: el.nw, nh: el.nh, label: el.label };
      let currentId = id;
      const doDelete = async () => {
        await api.deleteFloorElement(currentId);
        onChangeRef.current();
        setPopover(null);
      };
      const doAdd = async () => {
        const added = await api.addFloorElement(floor.id, snapshot);
        currentId = added.id;
        onChangeRef.current();
      };
      await doDelete();
      pushHistory({ undo: doAdd, redo: doDelete });
    } finally {
      setSaving(false);
    }
  };

  const rotateDeskSize = async (id: number) => {
    const el = elements.find((e) => e.id === id);
    if (!el) return;
    const pw = floor.pdf_page_width || 842;
    const ph = floor.pdf_page_height || 595;
    const w_px = el.nw * pw, h_px = el.nh * ph;
    const nw = h_px / pw, nh = w_px / ph;
    const cx = el.nx + el.nw / 2, cy = el.ny + el.nh / 2;
    const origNx = el.nx, origNy = el.ny, origNw = el.nw, origNh = el.nh;
    const newNx = cx - nw / 2, newNy = cy - nh / 2;
    setSaving(true);
    try {
      await api.patchFloorElement(id, { nx: newNx, ny: newNy, nw, nh });
      onChangeRef.current();
      setPopover(null);
      pushHistory({
        undo: async () => { await api.patchFloorElement(id, { nx: origNx, ny: origNy, nw: origNw, nh: origNh }); onChangeRef.current(); },
        redo: async () => { await api.patchFloorElement(id, { nx: newNx, ny: newNy, nw, nh }); onChangeRef.current(); },
      });
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
        <div className="flex items-center gap-0.5 border-l border-gray-700 pl-2">
          <button
            onClick={handleUndo}
            disabled={!canUndo}
            className="p-1 rounded hover:bg-gray-800 text-gray-400 hover:text-white disabled:opacity-25 disabled:cursor-not-allowed"
            title="Undo (Ctrl+Z)"
          >
            <RotateCcw size={13} />
          </button>
          <button
            onClick={handleRedo}
            disabled={!canRedo}
            className="p-1 rounded hover:bg-gray-800 text-gray-400 hover:text-white disabled:opacity-25 disabled:cursor-not-allowed"
            title="Redo (Ctrl+Y)"
          >
            <RotateCw size={13} />
          </button>
        </div>
        {drawMode === "desk" && (
          <button
            onClick={() => setDeskOrientation((o) => o === "landscape" ? "portrait" : "landscape")}
            className="px-2 py-0.5 rounded bg-gray-800 text-gray-300 hover:text-white border border-gray-600 font-mono"
            title="Toggle desk orientation"
          >
            {deskOrientation === "landscape" ? "▬ Landscape" : "▮ Portrait"}
          </button>
        )}
        <span className="ml-auto text-gray-600 italic">
          {drawMode === "none"
            ? "Click element to assign · Shift+drag to lasso select"
            : `Click to place ${drawMode.replace("_", " ")} · click toolbar to cancel`}
        </span>
      </div>

      {/* Canvas */}
      <div
        ref={containerRef}
        className={`relative w-full rounded-xl overflow-hidden select-none bg-gray-950 ${
          drawMode !== "none" ? "cursor-crosshair" : dragging ? "cursor-grabbing" : "cursor-default"
        }`}
        style={{ aspectRatio }}
        onMouseDown={handleMouseDown}
        onClick={handleSvgClick}
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setPreview(null)}
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
          data-print-svg="true"
          className="absolute inset-0 w-full h-full"
          viewBox="0 0 1 1"
          preserveAspectRatio="none"
        >
          {/* Desk elements */}
          {desks.map((el) => {
            const isSelected = selected.has(el.id);
            const isHovered = hovered === el.id;
            const isDragged = dragging?.id === el.id;
            const rx = isDragged ? dragging!.nx : el.nx;
            const ry = isDragged ? dragging!.ny : el.ny;
            const fill = teamColor(el.team_id, teams, isHovered || isSelected ? 0.85 : 0.65);
            const stroke = teamColor(el.team_id, teams, 1);
            return (
              <rect
                key={el.id}
                x={rx} y={ry} width={el.nw} height={el.nh}
                fill={fill}
                stroke={isSelected ? "#fff" : stroke}
                strokeWidth={isSelected ? 0.003 : 0.001}
                opacity={isDragged ? 0.7 : 1}
                rx="0.002"
                style={{ cursor: drawMode === "none" ? "grab" : "pointer" }}
                onMouseEnter={() => setHovered(el.id)}
                onMouseLeave={() => setHovered(null)}
                onMouseDown={(e) => handleElementMouseDown(e, el)}
                onClick={(e) => handleElementClick(e, el)}
              />
            );
          })}

          {/* Office elements */}
          {offices.map((el) => {
            const isSelected = selected.has(el.id);
            const isHovered = hovered === el.id;
            const isDragged = dragging?.id === el.id;
            const rx = isDragged ? dragging!.nx : el.nx;
            const ry = isDragged ? dragging!.ny : el.ny;
            const fill = teamColor(el.team_id, teams, isHovered || isSelected ? 0.45 : 0.25);
            const stroke = teamColor(el.team_id, teams, 1);
            const cx = rx + el.nw / 2;
            const cy = ry + el.nh / 2;
            const fontSize = Math.min(el.nw, el.nh) * 0.35;
            return (
              <g key={el.id} style={{ cursor: drawMode === "none" ? "grab" : "pointer" }}
                onMouseEnter={() => setHovered(el.id)}
                onMouseLeave={() => setHovered(null)}
                onMouseDown={(e) => handleElementMouseDown(e, el)}
                onClick={(e) => handleElementClick(e, el)}
                opacity={isDragged ? 0.7 : 1}
              >
                <rect
                  x={rx} y={ry} width={el.nw} height={el.nh}
                  fill={fill} stroke={isSelected ? "#fff" : stroke}
                  strokeWidth={isSelected ? 0.004 : 0.003}
                  strokeDasharray={el.is_lead_office ? "0.012,0.006" : "none"}
                  rx="0.004"
                />
                {el.is_lead_office && (
                  <>
                    <text x={cx} y={ry + el.nh * 0.38} textAnchor="middle" dominantBaseline="middle"
                      fontSize={fontSize * 1.1} fill="white"
                      style={{ filter: "drop-shadow(0 1px 2px rgba(0,0,0,0.8))" }}>
                      👑
                    </text>
                    <text x={cx} y={ry + el.nh * 0.72} textAnchor="middle" dominantBaseline="middle"
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
            const isDragged = dragging?.id === el.id;
            const rx = isDragged ? dragging!.nx : el.nx;
            const ry = isDragged ? dragging!.ny : el.ny;
            const alpha = isHovered || isSelected ? 0.45 : 0.25;
            const fill = el.team_id
              ? teamColor(el.team_id, teams, alpha)
              : `${MEETING_ROOM_COLOR}${alpha})`;
            const stroke = el.team_id
              ? teamColor(el.team_id, teams, 1)
              : "rgba(20,184,166,1)";
            const cx = rx + el.nw / 2;
            const cy = ry + el.nh / 2;
            const fontSize = Math.min(el.nw, el.nh) * 0.28;
            return (
              <g key={el.id} style={{ cursor: drawMode === "none" ? "grab" : "pointer" }}
                onMouseEnter={() => setHovered(el.id)}
                onMouseLeave={() => setHovered(null)}
                onMouseDown={(e) => handleElementMouseDown(e, el)}
                onClick={(e) => handleElementClick(e, el)}
                opacity={isDragged ? 0.7 : 1}
              >
                <rect
                  x={rx} y={ry} width={el.nw} height={el.nh}
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

          {/* Placement preview */}
          {preview && drawMode !== "none" && (
            <rect
              x={preview.nx} y={preview.ny} width={preview.nw} height={preview.nh}
              fill="rgba(99,102,241,0.25)" stroke="#6366f1"
              strokeWidth="0.002" strokeDasharray="0.008,0.004" rx="0.002"
              style={{ pointerEvents: "none" }}
            />
          )}

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
            onRotate={() => rotateDeskSize(popoverElement.id)}
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
  onRotate: () => void;
  onClose: () => void;
}

function ElementPopover({ element, teams, screenX, screenY, containerRef, onAssign, onDelete, onReclassify, onRotate, onClose }: PopoverProps) {
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
          {element.element_type === "desk" && (
            <button
              onClick={onRotate}
              className="flex-1 text-xs text-gray-400 hover:text-white bg-gray-800 hover:bg-gray-700 rounded px-2 py-1 whitespace-nowrap"
            >
              ↺ Rotate 90°
            </button>
          )}
          {otherTypes.map((t) => (
            <button
              key={t}
              onClick={() => onReclassify(t)}
              className="flex-1 text-xs text-gray-400 hover:text-white bg-gray-800 hover:bg-gray-700 rounded px-2 py-1 whitespace-nowrap"
            >
              → {t === "meeting_room" ? "Mtg Room" : t.charAt(0).toUpperCase() + t.slice(1)}
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
