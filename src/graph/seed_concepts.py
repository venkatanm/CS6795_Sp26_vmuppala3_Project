"""
Seed script for SAT Knowledge Graph - Top 50 Math Concepts

This script populates the knowledge graph with:
- Top 50 SAT Math concepts
- Prerequisite relationships between concepts
- Common misconceptions associated with concepts
"""
import asyncio
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from src.db.base import AsyncSessionLocal
from src.db.models import Concept, Misconception, ConceptPrerequisite, ConceptMisconception


# Top 50 SAT Math Concepts organized by category
CONCEPTS_DATA = [
    # Heart of Algebra (Level 1 - Top Level)
    {"name": "Heart of Algebra", "category": "Heart of Algebra", "level": 1, "description": "Core algebraic reasoning and problem solving"},
    
    # Linear Equations and Functions (Level 2)
    {"name": "Linear Equations in One Variable", "category": "Heart of Algebra", "level": 2, "description": "Solving equations like ax + b = c"},
    {"name": "Linear Functions", "category": "Heart of Algebra", "level": 2, "description": "Functions of the form f(x) = mx + b"},
    {"name": "Slope-Intercept Form", "category": "Heart of Algebra", "level": 3, "description": "y = mx + b form of linear equations"},
    {"name": "Point-Slope Form", "category": "Heart of Algebra", "level": 3, "description": "y - y₁ = m(x - x₁) form"},
    {"name": "Standard Form", "category": "Heart of Algebra", "level": 3, "description": "Ax + By = C form"},
    {"name": "Systems of Linear Equations", "category": "Heart of Algebra", "level": 2, "description": "Two or more linear equations solved together"},
    {"name": "Graphing Linear Equations", "category": "Heart of Algebra", "level": 2, "description": "Plotting lines on coordinate plane"},
    {"name": "Parallel and Perpendicular Lines", "category": "Heart of Algebra", "level": 2, "description": "Lines with equal or negative reciprocal slopes"},
    
    # Inequalities
    {"name": "Linear Inequalities", "category": "Heart of Algebra", "level": 2, "description": "Inequalities involving linear expressions"},
    {"name": "Systems of Inequalities", "category": "Heart of Algebra", "level": 2, "description": "Multiple inequalities solved together"},
    
    # Problem Solving and Data Analysis (Level 1 - Top Level)
    {"name": "Problem Solving and Data Analysis", "category": "Problem Solving and Data Analysis", "level": 1, "description": "Quantitative reasoning with data"},
    
    # Ratios, Proportions, and Percentages
    {"name": "Ratios and Proportions", "category": "Problem Solving and Data Analysis", "level": 2, "description": "Comparing quantities using ratios"},
    {"name": "Percentages", "category": "Problem Solving and Data Analysis", "level": 2, "description": "Calculating percentages and percent change"},
    {"name": "Unit Conversion", "category": "Problem Solving and Data Analysis", "level": 2, "description": "Converting between measurement units"},
    
    # Statistics and Probability
    {"name": "Mean, Median, Mode", "category": "Problem Solving and Data Analysis", "level": 2, "description": "Measures of central tendency"},
    {"name": "Range and Standard Deviation", "category": "Problem Solving and Data Analysis", "level": 2, "description": "Measures of spread"},
    {"name": "Scatterplots", "category": "Problem Solving and Data Analysis", "level": 2, "description": "Graphs showing relationships between variables"},
    {"name": "Line of Best Fit", "category": "Problem Solving and Data Analysis", "level": 2, "description": "Trend line through scatterplot data"},
    {"name": "Probability", "category": "Problem Solving and Data Analysis", "level": 2, "description": "Likelihood of events occurring"},
    {"name": "Conditional Probability", "category": "Problem Solving and Data Analysis", "level": 3, "description": "Probability given a condition"},
    
    # Advanced Math (Level 1 - Top Level)
    {"name": "Advanced Math", "category": "Advanced Math", "level": 1, "description": "Complex mathematical reasoning"},
    
    # Quadratics
    {"name": "Quadratic Equations", "category": "Advanced Math", "level": 2, "description": "Equations of the form ax² + bx + c = 0"},
    {"name": "Factoring Quadratics", "category": "Advanced Math", "level": 3, "description": "Breaking down quadratics into factors"},
    {"name": "Quadratic Formula", "category": "Advanced Math", "level": 3, "description": "x = (-b ± √(b²-4ac)) / 2a"},
    {"name": "Completing the Square", "category": "Advanced Math", "level": 3, "description": "Method to solve quadratics"},
    {"name": "Vertex Form", "category": "Advanced Math", "level": 3, "description": "y = a(x-h)² + k form of quadratics"},
    {"name": "Discriminant", "category": "Advanced Math", "level": 3, "description": "b² - 4ac determines nature of roots"},
    {"name": "Graphing Quadratics", "category": "Advanced Math", "level": 2, "description": "Parabolas and their properties"},
    
    # Polynomials
    {"name": "Polynomial Operations", "category": "Advanced Math", "level": 2, "description": "Adding, subtracting, multiplying polynomials"},
    {"name": "Polynomial Factoring", "category": "Advanced Math", "level": 2, "description": "Factoring higher-degree polynomials"},
    {"name": "Remainder Theorem", "category": "Advanced Math", "level": 3, "description": "Finding remainders when dividing polynomials"},
    
    # Exponents and Radicals
    {"name": "Exponent Rules", "category": "Advanced Math", "level": 2, "description": "Rules for manipulating exponents"},
    {"name": "Scientific Notation", "category": "Advanced Math", "level": 2, "description": "Expressing numbers as a × 10ⁿ"},
    {"name": "Radicals and Roots", "category": "Advanced Math", "level": 2, "description": "Square roots, cube roots, etc."},
    {"name": "Rational Exponents", "category": "Advanced Math", "level": 3, "description": "Exponents as fractions"},
    
    # Additional Topics in Math (Level 1 - Top Level)
    {"name": "Additional Topics in Math", "category": "Additional Topics in Math", "level": 1, "description": "Geometry, trigonometry, and complex numbers"},
    
    # Geometry
    {"name": "Area and Perimeter", "category": "Additional Topics in Math", "level": 2, "description": "Calculating area and perimeter of shapes"},
    {"name": "Volume and Surface Area", "category": "Additional Topics in Math", "level": 2, "description": "3D geometry calculations"},
    {"name": "Triangles", "category": "Additional Topics in Math", "level": 2, "description": "Properties of triangles"},
    {"name": "Pythagorean Theorem", "category": "Additional Topics in Math", "level": 3, "description": "a² + b² = c² for right triangles"},
    {"name": "Similar Triangles", "category": "Additional Topics in Math", "level": 2, "description": "Triangles with proportional sides"},
    {"name": "Circles", "category": "Additional Topics in Math", "level": 2, "description": "Properties of circles"},
    {"name": "Circle Equations", "category": "Additional Topics in Math", "level": 3, "description": "(x-h)² + (y-k)² = r²"},
    {"name": "Angles and Arcs", "category": "Additional Topics in Math", "level": 2, "description": "Angle measures and arc lengths"},
    {"name": "Coordinate Geometry", "category": "Additional Topics in Math", "level": 2, "description": "Geometry on coordinate plane"},
    {"name": "Distance Formula", "category": "Additional Topics in Math", "level": 3, "description": "Distance between two points"},
    {"name": "Midpoint Formula", "category": "Additional Topics in Math", "level": 3, "description": "Finding midpoint of a segment"},
    
    # Trigonometry
    {"name": "Right Triangle Trigonometry", "category": "Additional Topics in Math", "level": 2, "description": "SOH CAH TOA"},
    {"name": "Unit Circle", "category": "Additional Topics in Math", "level": 3, "description": "Trigonometric functions on unit circle"},
    
    # Complex Numbers
    {"name": "Complex Numbers", "category": "Additional Topics in Math", "level": 2, "description": "Numbers of the form a + bi"},
    {"name": "Imaginary Unit", "category": "Additional Topics in Math", "level": 3, "description": "i = √(-1)"},
]


# Prerequisite relationships: (prerequisite, dependent)
PREREQUISITES = [
    # Linear Equations prerequisites
    ("Linear Equations in One Variable", "Systems of Linear Equations"),
    ("Linear Functions", "Systems of Linear Equations"),
    ("Slope-Intercept Form", "Graphing Linear Equations"),
    ("Point-Slope Form", "Graphing Linear Equations"),
    ("Standard Form", "Graphing Linear Equations"),
    ("Linear Functions", "Parallel and Perpendicular Lines"),
    ("Slope-Intercept Form", "Parallel and Perpendicular Lines"),
    ("Linear Equations in One Variable", "Linear Inequalities"),
    ("Linear Inequalities", "Systems of Inequalities"),
    
    # Quadratics prerequisites
    ("Linear Equations in One Variable", "Quadratic Equations"),
    ("Factoring Quadratics", "Quadratic Equations"),
    ("Quadratic Formula", "Quadratic Equations"),
    ("Completing the Square", "Quadratic Equations"),
    ("Quadratic Equations", "Graphing Quadratics"),
    ("Vertex Form", "Graphing Quadratics"),
    
    # Polynomial prerequisites
    ("Polynomial Operations", "Polynomial Factoring"),
    ("Factoring Quadratics", "Polynomial Factoring"),
    
    # Exponent prerequisites
    ("Exponent Rules", "Scientific Notation"),
    ("Exponent Rules", "Rational Exponents"),
    ("Radicals and Roots", "Rational Exponents"),
    
    # Geometry prerequisites
    ("Area and Perimeter", "Volume and Surface Area"),
    ("Triangles", "Pythagorean Theorem"),
    ("Triangles", "Similar Triangles"),
    ("Coordinate Geometry", "Distance Formula"),
    ("Coordinate Geometry", "Midpoint Formula"),
    ("Distance Formula", "Circle Equations"),
    
    # Trigonometry prerequisites
    ("Triangles", "Right Triangle Trigonometry"),
    ("Right Triangle Trigonometry", "Unit Circle"),
    
    # Statistics prerequisites
    ("Mean, Median, Mode", "Range and Standard Deviation"),
    ("Scatterplots", "Line of Best Fit"),
    ("Probability", "Conditional Probability"),
    
    # Category-level prerequisites
    ("Heart of Algebra", "Linear Equations in One Variable"),
    ("Heart of Algebra", "Linear Functions"),
    ("Advanced Math", "Quadratic Equations"),
    ("Advanced Math", "Polynomial Operations"),
    ("Advanced Math", "Exponent Rules"),
    ("Additional Topics in Math", "Area and Perimeter"),
    ("Additional Topics in Math", "Triangles"),
    ("Additional Topics in Math", "Circles"),
    ("Additional Topics in Math", "Coordinate Geometry"),
]


# Common misconceptions: (concept, misconception_name, misconception_description)
MISCONCEPTIONS_DATA = [
    ("Slope-Intercept Form", "Confusing Slope for Y-Intercept", "Students often mix up m (slope) and b (y-intercept) in y = mx + b"),
    ("Slope-Intercept Form", "Switching Rise and Run", "Students confuse rise/run with run/rise when calculating slope"),
    ("Systems of Linear Equations", "Substitution vs Elimination Confusion", "Students struggle to choose the right method for solving systems"),
    ("Quadratic Formula", "Sign Errors in Formula", "Students make mistakes with negative signs in the quadratic formula"),
    ("Factoring Quadratics", "Forgetting to Factor Out GCF", "Students skip factoring out the greatest common factor first"),
    ("Pythagorean Theorem", "Applying to Non-Right Triangles", "Students try to use a² + b² = c² on triangles that aren't right triangles"),
    ("Exponent Rules", "Multiplying Exponents Instead of Adding", "Students multiply exponents when they should add: x² × x³ = x⁵, not x⁶"),
    ("Exponent Rules", "Distributing Exponents Incorrectly", "Students think (x + y)² = x² + y²"),
    ("Probability", "Confusing Independent and Dependent Events", "Students don't adjust probability for dependent events"),
    ("Percentages", "Percent Increase vs Percent Of", "Students confuse calculating percent increase with finding a percent of a number"),
    ("Mean, Median, Mode", "Using Mean When Median is Appropriate", "Students use mean for skewed data when median would be better"),
    ("Distance Formula", "Forgetting to Square Root", "Students calculate (x₂-x₁)² + (y₂-y₁)² but forget to take the square root"),
    ("Graphing Linear Equations", "Plotting Y-Intercept Incorrectly", "Students plot the y-intercept at the wrong location on the graph"),
]


async def seed_concepts(db: AsyncSession):
    """Seed concepts into the database."""
    print("Seeding concepts...")
    concept_map = {}
    
    for concept_data in CONCEPTS_DATA:
        # Check if concept already exists
        result = await db.execute(
            select(Concept).where(Concept.name == concept_data["name"])
        )
        existing = result.scalar_one_or_none()
        
        if existing:
            print(f"  Concept '{concept_data['name']}' already exists, skipping...")
            concept_map[concept_data["name"]] = existing
        else:
            concept = Concept(
                name=concept_data["name"],
                description=concept_data.get("description"),
                category=concept_data.get("category"),
                level=concept_data.get("level")
            )
            db.add(concept)
            await db.flush()  # Flush to get the ID
            concept_map[concept_data["name"]] = concept
            print(f"  Created concept: {concept_data['name']}")
    
    await db.commit()
    print(f" Seeded {len(concept_map)} concepts\n")
    return concept_map


async def seed_misconceptions(db: AsyncSession):
    """Seed misconceptions into the database."""
    print("Seeding misconceptions...")
    misconception_map = {}
    
    for concept_name, mis_name, mis_description in MISCONCEPTIONS_DATA:
        # Check if misconception already exists
        result = await db.execute(
            select(Misconception).where(Misconception.name == mis_name)
        )
        existing = result.scalar_one_or_none()
        
        if existing:
            misconception_map[mis_name] = existing
        else:
            misconception = Misconception(
                name=mis_name,
                description=mis_description
            )
            db.add(misconception)
            await db.flush()
            misconception_map[mis_name] = misconception
            print(f"  Created misconception: {mis_name}")
    
    await db.commit()
    print(f" Seeded {len(misconception_map)} misconceptions\n")
    return misconception_map


async def seed_prerequisites(db: AsyncSession, concept_map: dict):
    """Seed prerequisite relationships."""
    print("Seeding prerequisite relationships...")
    count = 0
    
    for prereq_name, dependent_name in PREREQUISITES:
        if prereq_name not in concept_map or dependent_name not in concept_map:
            print(f"  Warning: Missing concept for prerequisite relationship: {prereq_name} -> {dependent_name}")
            continue
        
        # Check if relationship already exists
        result = await db.execute(
            select(ConceptPrerequisite).where(
                ConceptPrerequisite.prerequisite_id == concept_map[prereq_name].id,
                ConceptPrerequisite.dependent_id == concept_map[dependent_name].id
            )
        )
        existing = result.scalar_one_or_none()
        
        if existing:
            continue
        
        prerequisite = ConceptPrerequisite(
            prerequisite_id=concept_map[prereq_name].id,
            dependent_id=concept_map[dependent_name].id
        )
        db.add(prerequisite)
        count += 1
    
    await db.commit()
    print(f" Seeded {count} prerequisite relationships\n")


async def seed_concept_misconceptions(db: AsyncSession, concept_map: dict, misconception_map: dict):
    """Seed concept-misconception relationships."""
    print("Seeding concept-misconception relationships...")
    count = 0
    
    for concept_name, mis_name, _ in MISCONCEPTIONS_DATA:
        if concept_name not in concept_map or mis_name not in misconception_map:
            print(f"  Warning: Missing concept or misconception: {concept_name} -> {mis_name}")
            continue
        
        # Check if relationship already exists
        result = await db.execute(
            select(ConceptMisconception).where(
                ConceptMisconception.concept_id == concept_map[concept_name].id,
                ConceptMisconception.misconception_id == misconception_map[mis_name].id
            )
        )
        existing = result.scalar_one_or_none()
        
        if existing:
            continue
        
        relationship = ConceptMisconception(
            concept_id=concept_map[concept_name].id,
            misconception_id=misconception_map[mis_name].id
        )
        db.add(relationship)
        count += 1
    
    await db.commit()
    print(f" Seeded {count} concept-misconception relationships\n")


async def main():
    """Main seeding function."""
    print("=" * 60)
    print("SAT Knowledge Graph Seeding Script")
    print("=" * 60)
    print()
    
    async with AsyncSessionLocal() as db:
        try:
            # Seed concepts
            concept_map = await seed_concepts(db)
            
            # Seed misconceptions
            misconception_map = await seed_misconceptions(db)
            
            # Seed prerequisites
            await seed_prerequisites(db, concept_map)
            
            # Seed concept-misconception relationships
            await seed_concept_misconceptions(db, concept_map, misconception_map)
            
            print("=" * 60)
            print(" Seeding completed successfully!")
            print("=" * 60)
            
        except Exception as e:
            await db.rollback()
            print(f" Error during seeding: {e}")
            raise


if __name__ == "__main__":
    asyncio.run(main())
