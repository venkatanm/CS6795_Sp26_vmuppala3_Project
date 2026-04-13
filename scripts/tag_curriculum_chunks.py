"""
P1-7 Fix: Tag curriculum_chunks with concept_name using keyword matching.

Since the concepts table is empty (P1-4 not yet done), we use the concept
names defined in src/graph/seed_concepts.py and do keyword-based matching
against each chunk's content and source field.

Only concept_name (and concept_id where available) is updated.
Content and embeddings are NOT touched.
"""

import asyncio
import re
import sys
import os

# Ensure project root is on path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import text, select
from src.db.base import AsyncSessionLocal
from src.db.models import CurriculumChunk, Concept

# ---------------------------------------------------------------------------
# Concept keyword index — derived from seed_concepts.py
# Each entry: (concept_name, [keywords/phrases to match in content])
# More specific concepts are listed first; the first match wins.
# ---------------------------------------------------------------------------

CONCEPT_KEYWORDS = [
    # ---- Heart of Algebra ----
    ("Parallel and Perpendicular Lines", ["parallel", "perpendicular", "negative reciprocal"]),
    ("Slope-Intercept Form", ["slope-intercept", "y = mx", "y=mx", "slope intercept"]),
    ("Point-Slope Form", ["point-slope", "y - y1", "y-y1", "point slope form"]),
    ("Standard Form", ["standard form", "ax + by", "ax+by"]),
    ("Systems of Linear Equations", ["system of equation", "systems of linear", "elimination method", "substitution method", "simultaneous equation"]),
    ("Linear Inequalities", ["linear inequalit", "inequality", "inequalities", "greater than", "less than", "≥", "≤"]),
    ("Systems of Inequalities", ["system of inequalit", "systems of inequalit"]),
    ("Graphing Linear Equations", ["graph.*linear", "plotting.*line", "coordinate plane", "x-intercept", "y-intercept"]),
    ("Linear Equations in One Variable", ["linear equation", "solve for x", "one variable", "ax + b", "ax+b"]),
    ("Linear Functions", ["linear function", "f(x) = mx", "rate of change", "slope"]),

    # ---- Problem Solving and Data Analysis ----
    ("Conditional Probability", ["conditional probability", "given that", "p(a|b)", "p(a | b)"]),
    ("Probability", ["probability", "likelihood", "chance", "random", "sample space", "event"]),
    ("Line of Best Fit", ["line of best fit", "best-fit line", "regression line", "trend line", "least squares"]),
    ("Scatterplots", ["scatterplot", "scatter plot", "scatter diagram", "correlation"]),
    ("Range and Standard Deviation", ["standard deviation", "range", "variance", "spread", "interquartile"]),
    ("Mean, Median, Mode", ["mean", "median", "mode", "average", "central tendency"]),
    ("Unit Conversion", ["unit conversion", "convert", "measurement unit", "dimensional analysis"]),
    ("Percentages", ["percent", "percentage", "%", "percent change", "percent increase", "percent decrease"]),
    ("Ratios and Proportions", ["ratio", "proportion", "rate", "per", "direct variation"]),

    # ---- Advanced Math ----
    ("Discriminant", ["discriminant", "b² - 4ac", "b^2 - 4ac", "nature of roots"]),
    ("Completing the Square", ["completing the square", "complete the square"]),
    ("Quadratic Formula", ["quadratic formula", "(-b ±", "(-b \\u00b1", "x = (-b"]),
    ("Vertex Form", ["vertex form", "a(x-h)²", "a(x-h)^2", "vertex of"]),
    ("Factoring Quadratics", ["factor.*quadratic", "factoring.*quadratic", "factor the expression", "factor.*trinomial"]),
    ("Graphing Quadratics", ["graph.*parabola", "parabola", "graphing quadratic", "axis of symmetry"]),
    ("Quadratic Equations", ["quadratic equation", "ax² + bx", "ax^2 + bx", "quadratic"]),
    ("Remainder Theorem", ["remainder theorem", "factor theorem", "synthetic division"]),
    ("Polynomial Factoring", ["factor.*polynomial", "polynomial factor", "factoring polynomial"]),
    ("Polynomial Operations", ["polynomial", "binomial", "trinomial", "degree", "leading coefficient"]),
    ("Rational Exponents", ["rational exponent", "fractional exponent", "x^(1/", "x^(m/"]),
    ("Radicals and Roots", ["radical", "square root", "cube root", "√", "nth root"]),
    ("Scientific Notation", ["scientific notation", "× 10", "x 10^"]),
    ("Exponent Rules", ["exponent rule", "power rule", "product of powers", "quotient of powers", "negative exponent", "zero exponent"]),

    # ---- Additional Topics in Math ----
    ("Imaginary Unit", ["imaginary unit", "i = √", "i^2 = -1", "i² = -1"]),
    ("Complex Numbers", ["complex number", "a + bi", "imaginary", "real part", "imaginary part"]),
    ("Unit Circle", ["unit circle", "radian", "trigonometric function.*circle"]),
    ("Right Triangle Trigonometry", ["sin", "cos", "tan", "soh cah toa", "trigonometry", "trig ratio", "right triangle.*trig", "sine", "cosine", "tangent"]),
    ("Circle Equations", ["circle equation", "(x-h)²", "(x-h)^2", "equation of a circle"]),
    ("Angles and Arcs", ["arc length", "central angle", "inscribed angle", "arc", "sector", "angle measure"]),
    ("Circles", ["circle", "radius", "diameter", "circumference", "chord", "tangent line"]),
    ("Distance Formula", ["distance formula", "distance between.*point"]),
    ("Midpoint Formula", ["midpoint formula", "midpoint of"]),
    ("Coordinate Geometry", ["coordinate", "ordered pair", "x-axis", "y-axis", "quadrant", "origin"]),
    ("Similar Triangles", ["similar triangle", "aa similarity", "sas similarity", "proportional side"]),
    ("Pythagorean Theorem", ["pythagorean theorem", "a² + b²", "a^2 + b^2", "right triangle", "hypotenuse"]),
    ("Triangles", ["triangle", "angle sum", "interior angle", "exterior angle", "equilateral", "isosceles", "scalene"]),
    ("Volume and Surface Area", ["volume", "surface area", "cylinder", "cone", "sphere", "prism", "pyramid"]),
    ("Area and Perimeter", ["area", "perimeter", "rectangle", "square", "trapezoid", "parallelogram"]),

    # ---- Top-level / fallback categories ----
    ("Heart of Algebra", ["algebra", "equation", "variable", "expression", "solve"]),
    ("Problem Solving and Data Analysis", ["data analysis", "statistics", "graph", "table", "survey", "sample"]),
    ("Advanced Math", ["function", "polynomial", "exponential", "logarithm", "rational function"]),
    ("Additional Topics in Math", ["geometry", "trigonometry", "complex", "three-dimensional"]),
]

# Source-file to category hints (helps break ties for ambiguous chunks)
SOURCE_CATEGORY_HINTS = {
    "sat-suite-classroom-practice-math.pdf": ["Heart of Algebra", "Problem Solving and Data Analysis", "Advanced Math", "Additional Topics in Math"],
    "Official Digital Study Guide.pdf": ["Heart of Algebra", "Problem Solving and Data Analysis", "Advanced Math", "Additional Topics in Math"],
    "Official Digital Study Guide.pdf.pdf": ["Heart of Algebra", "Problem Solving and Data Analysis", "Advanced Math", "Additional Topics in Math"],
}


def score_concept(text_lower: str, keywords: list[str]) -> int:
    """Return how many keywords match in the text."""
    score = 0
    for kw in keywords:
        try:
            if re.search(kw, text_lower, re.IGNORECASE):
                score += 1
        except re.error:
            # Fallback to plain string search if regex is invalid
            if kw.lower() in text_lower:
                score += 1
    return score


def best_concept_for_chunk(content: str, source: str | None) -> str | None:
    """Return the best-matching concept name for the given chunk content."""
    text_lower = (content or "").lower()
    if not text_lower.strip():
        return None

    best_name = None
    best_score = 0

    for concept_name, keywords in CONCEPT_KEYWORDS:
        s = score_concept(text_lower, keywords)
        if s > best_score:
            best_score = s
            best_name = concept_name

    # Require at least 1 keyword hit
    if best_score == 0:
        return None

    return best_name


async def tag_chunks():
    async with AsyncSessionLocal() as db:
        # --- Check if concepts table has data ---
        concept_count_result = await db.execute(text("SELECT COUNT(*) FROM concepts"))
        concept_count = concept_count_result.scalar()
        print(f"Concepts in DB: {concept_count}")

        # Build concept name -> id map if available
        concept_id_map: dict[str, object] = {}
        if concept_count > 0:
            rows = await db.execute(text("SELECT id, name FROM concepts"))
            for row in rows.fetchall():
                concept_id_map[row[1]] = row[0]
            print(f"Loaded {len(concept_id_map)} concept name->id mappings")
        else:
            print("Concepts table empty — will use keyword matching only (no concept_id linkage)")

        # --- Fetch all chunks ---
        result = await db.execute(
            text("SELECT id, content, source, concept_id, concept_name FROM curriculum_chunks")
        )
        chunks = result.fetchall()
        print(f"\nTotal curriculum_chunks: {len(chunks)}")

        tagged = 0
        already_tagged = 0
        used_db_concept_id = 0
        used_keyword = 0
        unmatched = 0

        for chunk_id, content, source, concept_id, concept_name in chunks:
            new_concept_name = None
            new_concept_id = concept_id  # keep existing unless we find a better one

            # Case 1: concept_id exists → look up name from DB map
            if concept_id is not None and concept_id_map:
                matched_name = None
                for name, cid in concept_id_map.items():
                    if str(cid) == str(concept_id):
                        matched_name = name
                        break
                if matched_name:
                    new_concept_name = matched_name
                    used_db_concept_id += 1

            # Case 2: no concept_name yet → keyword match
            if new_concept_name is None:
                new_concept_name = best_concept_for_chunk(content, source)
                if new_concept_name:
                    used_keyword += 1
                    # If concepts are in DB, also set concept_id
                    if concept_id is None and new_concept_name in concept_id_map:
                        new_concept_id = concept_id_map[new_concept_name]
                else:
                    unmatched += 1

            # Skip if already correct
            if concept_name == new_concept_name:
                already_tagged += 1
                continue

            if new_concept_name is not None:
                await db.execute(
                    text("UPDATE curriculum_chunks SET concept_name = :name, concept_id = :cid WHERE id = :id"),
                    {"name": new_concept_name, "cid": new_concept_id, "id": str(chunk_id)}
                )
                tagged += 1

        await db.commit()

        print(f"\n=== Tagging Results ===")
        print(f"  Total chunks:           {len(chunks)}")
        print(f"  Newly tagged:           {tagged}")
        print(f"  Already tagged:         {already_tagged}")
        print(f"  Tagged via concept_id:  {used_db_concept_id}")
        print(f"  Tagged via keywords:    {used_keyword}")
        print(f"  Unmatched (no tag):     {unmatched}")

        # Verification query
        verify = await db.execute(
            text("SELECT concept_name, COUNT(*) as cnt FROM curriculum_chunks GROUP BY concept_name ORDER BY cnt DESC")
        )
        rows = verify.fetchall()
        print(f"\n=== concept_name distribution after tagging ===")
        for row in rows:
            print(f"  {row[0] or 'NULL':45s}  {row[1]}")


if __name__ == "__main__":
    asyncio.run(tag_chunks())
