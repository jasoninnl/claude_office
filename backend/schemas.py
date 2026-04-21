from pydantic import BaseModel, Field
from typing import Optional, List, Any


class MeetingRoom(BaseModel):
    name: str
    capacity: int


# --- Floor ---
class FloorBase(BaseModel):
    name: str
    level: int
    total_desks: int = 0
    meeting_rooms: List[dict] = []
    amenities: List[str] = []
    notes: str = ""


class FloorCreate(FloorBase):
    pass


class FloorUpdate(FloorBase):
    pass


class FloorOut(FloorBase):
    id: int
    image_path: Optional[str] = None

    class Config:
        from_attributes = True


# --- Team ---
class TeamBase(BaseModel):
    name: str
    headcount: int = 1
    department: str = ""
    color: str = "#6366f1"
    required_desks: int = 0
    min_meeting_room_capacity: int = 0
    meeting_rooms_needed: int = 0
    must_be_with: List[int] = []
    must_be_near: List[int] = []
    must_separate_from: List[int] = []
    floor_preference: Optional[int] = None
    notes: str = ""


class TeamCreate(TeamBase):
    pass


class TeamUpdate(TeamBase):
    pass


class TeamOut(TeamBase):
    id: int

    class Config:
        from_attributes = True


# --- Allocation ---
class AllocationItem(BaseModel):
    team_id: int
    floor_id: int
    desks_used: int = 0
    pos_x: Optional[float] = None
    pos_y: Optional[float] = None
    pos_w: Optional[float] = None
    pos_h: Optional[float] = None


class AllocationOut(BaseModel):
    id: int
    team_id: int
    floor_id: int
    desks_used: int
    pos_x: Optional[float] = None
    pos_y: Optional[float] = None
    pos_w: Optional[float] = None
    pos_h: Optional[float] = None
    team: TeamOut
    floor: FloorOut

    class Config:
        from_attributes = True


class AllocationPositionUpdate(BaseModel):
    pos_x: float
    pos_y: float
    pos_w: float
    pos_h: float


# --- Scenario ---
class ScenarioBase(BaseModel):
    name: str
    description: str = ""
    is_baseline: bool = False


class ScenarioCreate(ScenarioBase):
    allocations: List[AllocationItem] = []


class ScenarioUpdate(ScenarioBase):
    allocations: List[AllocationItem] = []


class ScenarioOut(ScenarioBase):
    id: int
    score: Optional[float] = None
    score_breakdown: Optional[dict] = None
    allocations: List[AllocationOut] = []

    class Config:
        from_attributes = True


# --- Optimizer ---
class OptimizeRequest(BaseModel):
    scenario_name: str = "Optimized Scenario"
    description: str = ""
    weights: dict = Field(default_factory=lambda: {
        "collaboration": 1.0,
        "space_utilization": 1.0,
        "meeting_rooms": 1.0,
        "constraints": 2.0,
        "floor_preference": 0.5,
    })


class ScoreBreakdown(BaseModel):
    total: float
    collaboration: float
    space_utilization: float
    meeting_rooms: float
    constraint_violations: float
    floor_preference: float
    details: List[str] = []
