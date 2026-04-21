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
}

export interface Allocation {
  id: number;
  team_id: number;
  floor_id: number;
  desks_used: number;
  team: Team;
  floor: Floor;
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

export type Tab = "scenarios" | "floors" | "teams" | "compare";
