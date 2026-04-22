"""
PDF floor plan processor using PyMuPDF.

Extracts desk and office elements from vector PDF drawings, rasterizes the
page to PNG for display, and normalises all coordinates to the 0-1 range so
the SVG canvas can use them directly without any client-side maths.

Detection heuristics are tuned for typical architectural PDFs at 1:50–1:100
scale, where:
  desk symbol  ≈  300–8 000 pt²  (0.7 m × 1.4 m desk at 1:100 → ~20×40 pt)
  private office ≈  5 000–150 000 pt²  (3 m × 4 m room at 1:50 → ~170×227 pt)
"""

from __future__ import annotations
from pathlib import Path
from typing import Any

import fitz  # PyMuPDF

# Area thresholds in PDF points²  (tunable via API if needed)
DESK_AREA_MIN = 300
DESK_AREA_MAX = 8_000
OFFICE_AREA_MIN = 5_000
OFFICE_AREA_MAX = 150_000

# Rasterisation resolution
RASTER_DPI = 150


def process_pdf(pdf_path: Path) -> dict[str, Any]:
    """
    Open a PDF, rasterise page 0 to PNG, detect desks and offices.

    Returns
    -------
    {
        image_bytes   : bytes           PNG of the page
        pdf_page_width  : float         page width  in PDF points
        pdf_page_height : float         page height in PDF points
        elements      : list[dict]      detected floor elements
        desk_count    : int
        office_count  : int
        warnings      : list[str]
    }
    """
    doc = fitz.open(str(pdf_path))
    if not doc.page_count:
        raise ValueError("PDF has no pages")

    page = doc[0]
    pw = page.rect.width
    ph = page.rect.height

    # Rasterise
    scale = RASTER_DPI / 72
    pix = page.get_pixmap(matrix=fitz.Matrix(scale, scale), clip=page.rect, alpha=False)
    image_bytes = pix.tobytes("png")

    elements = _extract_elements(page, pw, ph)
    _enrich_offices_with_labels(page, elements, pw, ph)

    doc.close()

    warnings: list[str] = []
    desk_count = sum(1 for e in elements if e["element_type"] == "desk")
    office_count = sum(1 for e in elements if e["element_type"] == "office")

    if desk_count == 0:
        warnings.append(
            "No desk symbols detected. The PDF may use non-standard symbols or "
            "be a scanned image. Use the canvas tools to manually place desks."
        )
    if office_count == 0:
        warnings.append(
            "No office rooms detected. Team leads will not be automatically "
            "assigned to separate offices. Add offices manually if needed."
        )

    return {
        "image_bytes": image_bytes,
        "pdf_page_width": pw,
        "pdf_page_height": ph,
        "elements": elements,
        "desk_count": desk_count,
        "office_count": office_count,
        "warnings": warnings,
    }


def _extract_elements(page: fitz.Page, pw: float, ph: float) -> list[dict]:
    page_area = pw * ph
    drawings = page.get_drawings()

    candidates = []
    seen: set[tuple] = set()

    for d in drawings:
        r: fitz.Rect | None = d.get("rect")
        if r is None:
            continue
        w, h = r.width, r.height
        if w < 2 or h < 2:
            continue

        key = (round(r.x0), round(r.y0), round(w), round(h))
        if key in seen:
            continue
        seen.add(key)

        area = w * h
        # Skip floor boundary and pure lines
        if area / page_area > 0.25:
            continue
        aspect = max(w, h) / max(min(w, h), 1.0)
        if aspect > 8:
            continue

        if DESK_AREA_MIN <= area <= DESK_AREA_MAX and aspect <= 4:
            etype = "desk"
        elif OFFICE_AREA_MIN <= area <= OFFICE_AREA_MAX and aspect <= 3:
            etype = "office"
        else:
            continue

        candidates.append({
            "element_type": etype,
            "x": r.x0, "y": r.y0, "w": w, "h": h,
            "nx": r.x0 / pw, "ny": r.y0 / ph,
            "nw": w / pw,    "nh": h / ph,
            "confidence": _confidence(area, aspect, etype),
            "label": "",
        })

    return _remove_desk_inside_office(candidates)


def _confidence(area: float, aspect: float, etype: str) -> float:
    if etype == "desk":
        a_score = 1.0 - abs(area - 2_000) / 4_000
        r_score = 1.0 - abs(aspect - 2.0) / 3.0
    else:
        a_score = 1.0 - abs(area - 35_000) / 70_000
        r_score = 1.0 - abs(aspect - 1.4) / 2.5
    return round(max(0.1, min(1.0, (a_score + r_score) / 2)), 2)


def _remove_desk_inside_office(elements: list[dict]) -> list[dict]:
    """Drop desks whose bounding box is fully inside an office."""
    offices = [e for e in elements if e["element_type"] == "office"]
    result = []
    for el in elements:
        if el["element_type"] == "desk":
            inside = any(
                el["x"] >= off["x"] and el["y"] >= off["y"]
                and el["x"] + el["w"] <= off["x"] + off["w"]
                and el["y"] + el["h"] <= off["y"] + off["h"]
                for off in offices
            )
            if inside:
                continue
        result.append(el)
    return result


def _enrich_offices_with_labels(
    page: fitz.Page, elements: list[dict], pw: float, ph: float
) -> None:
    """Attach the nearest text label to each detected office element."""
    text_blocks = []
    for block in page.get_text("blocks"):
        x0, y0, x1, y1, text, *_ = block
        text = text.strip()
        if not text or len(text) > 60:
            continue
        text_blocks.append({
            "text": text.replace("\n", " "),
            "cx": (x0 + x1) / 2 / pw,
            "cy": (y0 + y1) / 2 / ph,
        })

    for el in elements:
        if el["element_type"] != "office":
            continue
        for tb in text_blocks:
            if (el["nx"] <= tb["cx"] <= el["nx"] + el["nw"]
                    and el["ny"] <= tb["cy"] <= el["ny"] + el["nh"]):
                el["label"] = tb["text"]
                break


def auto_assign(
    desks: list,          # FloorElement ORM objects, element_type=="desk"
    offices: list,        # FloorElement ORM objects, element_type=="office"
    allocations: list,    # Allocation ORM objects for this floor+scenario
) -> None:
    """
    Assign desks and offices to teams in-place.

    Strategy
    --------
    * Sort desks spatially (row-major: bucket by y, then x) to produce
      contiguous spatial clusters per team — this makes the colour zones
      look like natural seating areas on the plan.
    * For each team, claim N consecutive desks proportional to headcount.
    * For teams with has_team_lead=True, claim the nearest available office
      to that team's desk centroid and mark it as a lead office.
    """
    # Reset
    for el in desks + offices:
        el.team_id = None
        el.is_lead_office = False
        el.label = el.label or ""  # preserve manual labels

    if not allocations:
        return

    # Sort desks: bucket rows by ~20pt bands, then left→right within each row
    def desk_sort_key(el):
        return (round(el.y / 20) * 20, el.x)

    desks_sorted = sorted(desks, key=desk_sort_key)
    offices_avail = sorted(offices, key=lambda o: o.y)  # top-floor offices first

    # Sort allocations largest team first
    allocs_sorted = sorted(
        allocations,
        key=lambda a: (a.desks_used or (a.team.required_desks or a.team.headcount)),
        reverse=True,
    )

    desk_idx = 0
    for alloc in allocs_sorted:
        team = alloc.team
        n_desks = alloc.desks_used or team.required_desks or team.headcount

        assigned: list = []
        for _ in range(n_desks):
            if desk_idx >= len(desks_sorted):
                break
            desks_sorted[desk_idx].team_id = team.id
            assigned.append(desks_sorted[desk_idx])
            desk_idx += 1

        # Assign a lead office if needed
        if team.has_team_lead and offices_avail:
            # Pick office closest to this team's desk centroid
            if assigned:
                cen_x = sum(d.nx for d in assigned) / len(assigned)
                cen_y = sum(d.ny for d in assigned) / len(assigned)
                best = min(
                    offices_avail,
                    key=lambda o: (o.nx - cen_x) ** 2 + (o.ny - cen_y) ** 2,
                )
            else:
                best = offices_avail[0]

            best.team_id = team.id
            best.is_lead_office = True
            best.label = (
                f"{team.team_lead_name}" if team.team_lead_name
                else f"{team.name} Lead"
            )
            offices_avail.remove(best)
