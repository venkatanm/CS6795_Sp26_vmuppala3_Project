# src/services/prompt_templates.py

SAT_TEMPLATES = {
    "algebra_linear": [
        "Create a word problem involving a linear equation (y = mx + b) related to business costs or profit. The numbers should be realistic.",
        "Create a system of two linear equations. One equation should be in standard form (Ax + By = C) and the other in slope-intercept form. Ask for the value of x + y.",
        "Create a question about a line in the xy-plane that passes through two given points. Ask for the slope or the y-intercept."
    ],
    "algebra_quadratics": [
        "Create a quadratic equation in vertex form (y = a(x-h)^2 + k). Ask for the minimum or maximum value of the function.",
        "Create a question asking for the number of solutions to a quadratic equation using the discriminant (b^2 - 4ac).",
        "Create a word problem involving projectile motion modeled by a quadratic function. Ask when the object hits the ground."
    ],
    "geometry": [
        "Create a question about a circle in the xy-plane given by (x-h)^2 + (y-k)^2 = r^2. Ask for the radius or center.",
        "Create a question involving similar triangles. Provide side lengths and ask for a missing side.",
        "Create a question about the volume of a cylinder or prism where one dimension is changed (e.g., radius is doubled)."
    ],
    "data_analysis": [
        "Create a question based on a scatterplot description. Ask to estimate the line of best fit or predict a value.",
        "Create a probability question involving a two-way table of data.",
        "Create a question about mean, median, and range where one data point is added or removed."
    ]
}

def get_random_template(domain: str) -> str:
    import random
    # Default to algebra if domain not found
    templates = SAT_TEMPLATES.get(domain, SAT_TEMPLATES["algebra_linear"])
    return random.choice(templates)