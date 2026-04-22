from sqlalchemy import Column, Integer, String, Float, Boolean, ForeignKey, JSON, Text
from sqlalchemy.orm import relationship
from database import Base


class Floor(Base):
    __tablename__ = "floors"

    id = Column(Integer, primary_key=True)
    name = Column(String, nullable=False)
    level = Column(Integer, nullable=False)
    total_desks = Column(Integer, default=0)
    meeting_rooms = Column(JSON, default=list)
    amenities = Column(JSON, default=list)
    notes = Column(Text, default="")
    image_path = Column(String, nullable=True)   # rasterised floor plan PNG
    pdf_path = Column(String, nullable=True)      # original uploaded PDF
    pdf_page_width = Column(Float, nullable=True)  # PDF points
    pdf_page_height = Column(Float, nullable=True)

    allocations = relationship("Allocation", back_populates="floor", cascade="all, delete-orphan")
    elements = relationship("FloorElement", back_populates="floor", cascade="all, delete-orphan")


class Team(Base):
    __tablename__ = "teams"

    id = Column(Integer, primary_key=True)
    name = Column(String, nullable=False)
    headcount = Column(Integer, default=1)
    department = Column(String, default="")
    color = Column(String, default="#6366f1")
    required_desks = Column(Integer, default=0)
    min_meeting_room_capacity = Column(Integer, default=0)
    meeting_rooms_needed = Column(Integer, default=0)
    must_be_with = Column(JSON, default=list)
    must_be_near = Column(JSON, default=list)
    must_separate_from = Column(JSON, default=list)
    floor_preference = Column(Integer, nullable=True)
    notes = Column(Text, default="")
    has_team_lead = Column(Boolean, default=False)
    team_lead_name = Column(String, default="")

    allocations = relationship("Allocation", back_populates="team", cascade="all, delete-orphan")
    floor_elements = relationship("FloorElement", back_populates="team")


class Scenario(Base):
    __tablename__ = "scenarios"

    id = Column(Integer, primary_key=True)
    name = Column(String, nullable=False)
    description = Column(Text, default="")
    is_baseline = Column(Boolean, default=False)
    score = Column(Float, nullable=True)
    score_breakdown = Column(JSON, nullable=True)

    allocations = relationship("Allocation", back_populates="scenario", cascade="all, delete-orphan")


class Allocation(Base):
    __tablename__ = "allocations"

    id = Column(Integer, primary_key=True)
    scenario_id = Column(Integer, ForeignKey("scenarios.id"), nullable=False)
    team_id = Column(Integer, ForeignKey("teams.id"), nullable=False)
    floor_id = Column(Integer, ForeignKey("floors.id"), nullable=False)
    desks_used = Column(Integer, default=0)
    pos_x = Column(Float, nullable=True)
    pos_y = Column(Float, nullable=True)
    pos_w = Column(Float, nullable=True)
    pos_h = Column(Float, nullable=True)

    scenario = relationship("Scenario", back_populates="allocations")
    team = relationship("Team", back_populates="allocations")
    floor = relationship("Floor", back_populates="allocations")


class FloorElement(Base):
    """A detected desk or private office on a floor, from a parsed PDF."""
    __tablename__ = "floor_elements"

    id = Column(Integer, primary_key=True)
    floor_id = Column(Integer, ForeignKey("floors.id"), nullable=False)

    # "desk" | "office"
    element_type = Column(String, default="desk", nullable=False)

    # Raw PDF coordinates (points from top-left)
    x = Column(Float, nullable=False)
    y = Column(Float, nullable=False)
    w = Column(Float, nullable=False)
    h = Column(Float, nullable=False)

    # Normalised 0–1 coordinates for the SVG canvas
    nx = Column(Float, nullable=False)
    ny = Column(Float, nullable=False)
    nw = Column(Float, nullable=False)
    nh = Column(Float, nullable=False)

    label = Column(String, default="")            # e.g. "Office A", "Team Lead"
    confidence = Column(Float, default=1.0)       # detection confidence 0–1

    # Assignment (floor-level, shared across scenarios)
    team_id = Column(Integer, ForeignKey("teams.id"), nullable=True)
    is_lead_office = Column(Boolean, default=False)

    floor = relationship("Floor", back_populates="elements")
    team = relationship("Team", back_populates="floor_elements")
