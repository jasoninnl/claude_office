export interface MeetingRoom {
  name: string;
  capacity: number;
}

export interface Floor {
  id: number;
  name: string;
  level: number;
  total_desks: number;
  meeting_rooms: MeetingRoom[];
  amenities: string[];
  notes: string;
  image_path: string | null;
  pdf_path: string | null;
  pdf_page_width: number | null;
  pdf_page_height: number | null;
}

export interface Team {
  id: number;
  name: string;
  headcount: number;
  department: string;
  color: string;
  required_desks: number;
  min_meeting_room_capacity: number;
  meeting_rooms_needed: number;
  must_be_with: number[];
  must_be_near: number[];
  must_separate_from: number[];
  floor_preference: number | null;
  notes: string;
  has_team_lead: boolean;
  team_lead_name: string;
}

export interface Allocation {
  id: number;
  team_id: number;
  floor_id: number;
  desks_used: number;
  pos_x: number | null;
  pos_y: number | null;
  pos_w: number | null;
  pos_h: number | null;
  team: Team;
  floor: Floor;
}

export interface FloorElement {
  id: number;
  floor_id: number;
  element_type: "desk" | "office" | "meeting_room";
  x: number;
  y: number;
  w: number;
  h: number;
  nx: number;   // normalised 0–1
  ny: number;
  nw: number;
  nh: number;
  label: string;
  confidence: number;
  team_id: number | null;
  is_lead_office: boolean;
  team: Team | null;
}

export interface PDFParseResult {
  desk_count: number;
  office_count: number;
  warnings: string[];
}

export interface ScoreBreakdown {
  total: number;
  collaboration: number;
  space_utilization: number;
  meeting_rooms: number;
  constraint_violations: number;
  floor_preference: number;
  details: string[];
  floor_utilization?: Record<string, { used: number; total: number; pct: number }>;
}

export interface Scenario {
  id: number;
  name: string;
  description: string;
  is_baseline: boolean;
  score: number | null;
  score_breakdown: ScoreBreakdown | null;
  allocations: Allocation[];
}

export type Tab = "scenarios" | "floorplan" | "floors" | "teams" | "compare";
