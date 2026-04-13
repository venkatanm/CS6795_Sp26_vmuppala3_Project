"""
Score Engine Service

Converts final IRT theta estimates into reported Section Scores (200-800).
"""
from typing import Dict, List, Optional, Tuple, Any
from enum import Enum


class SectionType(str, Enum):
    """Section type enumeration"""
    MATH = "math"
    RW = "rw"  # Reading & Writing


class ScoreEngine:
    """
    Score Engine for converting theta to section scores.
    
    Features:
    - Clamps theta between -3.0 and 3.0
    - Looks up score in scoring table
    - Applies section floor/ceiling rules (min 200, max 800)
    - Supports per-exam scoring curves via ExamPacket
    """
    
    # Default scoring tables (sample data - should be replaced with actual SAT conversion tables)
    DEFAULT_MATH_TABLE: List[Dict[str, Any]] = [
        {"theta_range": [-3.0, -2.5], "score": 200},
        {"theta_range": [-2.5, -2.0], "score": 250},
        {"theta_range": [-2.0, -1.5], "score": 300},
        {"theta_range": [-1.5, -1.0], "score": 350},
        {"theta_range": [-1.0, -0.5], "score": 400},
        {"theta_range": [-0.5, 0.0], "score": 450},
        {"theta_range": [0.0, 0.5], "score": 500},
        {"theta_range": [0.5, 1.0], "score": 550},
        {"theta_range": [1.0, 1.5], "score": 600},
        {"theta_range": [1.5, 2.0], "score": 650},
        {"theta_range": [2.0, 2.5], "score": 700},
        {"theta_range": [2.5, 3.0], "score": 750},
        {"theta_range": [3.0, 3.0], "score": 800},  # Handle exactly 3.0
    ]
    
    DEFAULT_RW_TABLE: List[Dict[str, Any]] = [
        {"theta_range": [-3.0, -2.5], "score": 200},
        {"theta_range": [-2.5, -2.0], "score": 250},
        {"theta_range": [-2.0, -1.5], "score": 300},
        {"theta_range": [-1.5, -1.0], "score": 350},
        {"theta_range": [-1.0, -0.5], "score": 400},
        {"theta_range": [-0.5, 0.0], "score": 450},
        {"theta_range": [0.0, 0.5], "score": 500},
        {"theta_range": [0.5, 1.0], "score": 550},
        {"theta_range": [1.0, 1.5], "score": 600},
        {"theta_range": [1.5, 2.0], "score": 650},
        {"theta_range": [2.0, 2.5], "score": 700},
        {"theta_range": [2.5, 3.0], "score": 750},
        {"theta_range": [3.0, 3.0], "score": 800},  # Handle exactly 3.0
    ]
    
    @staticmethod
    def calculate_final_score(
        final_theta: float,
        section: SectionType,
        scoring_config: Optional[Dict[str, Any]] = None
    ) -> int:
        """
        Calculate final section score from theta estimate.
        
        Args:
            final_theta: IRT theta estimate (typically -3.0 to 3.0)
            section: Section type ('math' or 'rw')
            scoring_config: Optional scoring configuration from ExamPacket
                Format: {
                    "math": [{"theta_range": [min, max], "score": score}, ...],
                    "rw": [{"theta_range": [min, max], "score": score}, ...],
                    "default_score": optional default
                }
        
        Returns:
            Section score (200-800)
        """
        # Step 1: Clamp theta between -3.0 and 3.0
        clamped_theta = max(-3.0, min(3.0, final_theta))
        
        # Step 2: Get scoring table for the section
        if scoring_config:
            scoring_table = scoring_config.get(
                section.value if isinstance(section, SectionType) else section,
                ScoreEngine.DEFAULT_MATH_TABLE if section == SectionType.MATH else ScoreEngine.DEFAULT_RW_TABLE
            )
        else:
            scoring_table = (
                ScoreEngine.DEFAULT_MATH_TABLE 
                if section == SectionType.MATH 
                else ScoreEngine.DEFAULT_RW_TABLE
            )
        
        # Step 3: Look up score in the table
        section_score: Optional[int] = None
        
        for entry in scoring_table:
            theta_range = entry.get("theta_range", [])
            if len(theta_range) != 2:
                continue
            min_theta, max_theta = theta_range[0], theta_range[1]
            
            if min_theta <= clamped_theta <= max_theta:
                section_score = entry.get("score")
                break
        
        # Step 4: Apply floor/ceiling rules if no match found
        if section_score is None:
            if scoring_table:
                first_range = scoring_table[0].get("theta_range", [])
                last_range = scoring_table[-1].get("theta_range", [])
                
                # If theta is below minimum range, use floor (200)
                if first_range and clamped_theta < first_range[0]:
                    section_score = 200
                # If theta is above maximum range, use ceiling (800)
                elif last_range and clamped_theta > last_range[1]:
                    section_score = 800
                # Fallback to default or floor
                else:
                    section_score = scoring_config.get("default_score", 200) if scoring_config else 200
            else:
                section_score = 200
        
        # Step 5: Apply section-specific floor/ceiling rules
        # RW min is 200, Math min is 200 (both follow SAT scale)
        final_score = max(200, min(800, section_score))
        
        return int(final_score)
    
    @staticmethod
    def convert_elo_to_theta(elo_rating: float) -> float:
        """
        Convert ELO rating to IRT theta estimate.
        
        This is a helper method to convert from the current ELO-based system
        to IRT theta for scoring. The conversion is approximate.
        
        Formula: theta ≈ (elo - 1200) / 200
        This maps:
        - 800 ELO → -2.0 theta
        - 1200 ELO → 0.0 theta (average)
        - 1600 ELO → 2.0 theta
        
        Args:
            elo_rating: ELO rating (typically 800-1600, with 1200 as average)
        
        Returns:
            Approximate IRT theta estimate
        """
        # Normalize ELO to theta scale
        # Assuming ELO range of 800-1600 maps to theta -2.0 to 2.0
        normalized_elo = (elo_rating - 1200) / 200
        return max(-3.0, min(3.0, normalized_elo))
    
    @staticmethod
    def calculate_final_score_from_elo(
        elo_rating: float,
        section: SectionType,
        scoring_config: Optional[Dict[str, Any]] = None
    ) -> int:
        """
        Calculate final score from ELO rating (convenience method).
        
        Args:
            elo_rating: ELO rating (from student_theta in database)
            section: Section type ('math' or 'rw')
            scoring_config: Optional scoring configuration from ExamPacket
        
        Returns:
            Section score (200-800)
        """
        theta = ScoreEngine.convert_elo_to_theta(elo_rating)
        return ScoreEngine.calculate_final_score(theta, section, scoring_config)
    
    @staticmethod
    def validate_scoring_table(scoring_table: List[Dict[str, Any]]) -> bool:
        """
        Validate scoring table structure.
        
        Args:
            scoring_table: Scoring table to validate
        
        Returns:
            True if valid, raises ValueError if invalid
        """
        if not isinstance(scoring_table, list) or len(scoring_table) == 0:
            raise ValueError("Scoring table must be a non-empty list")
        
        for i, entry in enumerate(scoring_table):
            if "theta_range" not in entry or not isinstance(entry["theta_range"], list):
                raise ValueError(f"Entry {i}: theta_range must be a list [min, max]")
            
            theta_range = entry["theta_range"]
            if len(theta_range) != 2:
                raise ValueError(f"Entry {i}: theta_range must have exactly 2 elements")
            
            min_theta, max_theta = theta_range[0], theta_range[1]
            
            if not isinstance(min_theta, (int, float)) or not isinstance(max_theta, (int, float)):
                raise ValueError(f"Entry {i}: theta_range values must be numbers")
            
            if min_theta > max_theta:
                raise ValueError(f"Entry {i}: minTheta ({min_theta}) must be <= maxTheta ({max_theta})")
            
            if "score" not in entry:
                raise ValueError(f"Entry {i}: score is required")
            
            score = entry["score"]
            if not isinstance(score, (int, float)) or score < 200 or score > 800:
                raise ValueError(f"Entry {i}: score must be a number between 200 and 800")
        
        return True
