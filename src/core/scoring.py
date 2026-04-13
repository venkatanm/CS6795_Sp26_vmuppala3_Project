"""
ELO rating system for student performance and item difficulty scoring.
"""
from typing import Union


class EloScorer:
    """ELO rating calculator for adaptive assessment."""
    
    @staticmethod
    def calculate_expected_score(student_elo: float, item_difficulty: float) -> float:
        """
        Calculate the expected probability that a student will answer correctly.
        
        Args:
            student_elo: Student's current ELO rating
            item_difficulty: Item's difficulty rating (higher = harder)
            
        Returns:
            Expected score between 0.0 and 1.0
        """
        return 1 / (1 + 10 ** ((item_difficulty - student_elo) / 400))
    
    @staticmethod
    def update_rating(
        student_elo: float,
        item_difficulty: float,
        outcome: int,
        k_factor: float = 30
    ) -> float:
        """
        Update student's ELO rating based on their performance.
        
        Args:
            student_elo: Student's current ELO rating
            item_difficulty: Item's difficulty rating
            outcome: 1 if correct, 0 if incorrect
            k_factor: K-factor for rating volatility (default: 30)
            
        Returns:
            New student ELO rating
        """
        expected = EloScorer.calculate_expected_score(student_elo, item_difficulty)
        new_rating = student_elo + k_factor * (outcome - expected)
        return new_rating


if __name__ == "__main__":
    # Test cases
    print("=" * 60)
    print("ELO Scoring System Test")
    print("=" * 60)
    
    # Test 1: Student 1200 beats Item 1400 (should go up significantly)
    student_elo = 1200.0
    item_difficulty = 1400.0
    outcome = 1  # Correct
    
    expected = EloScorer.calculate_expected_score(student_elo, item_difficulty)
    new_rating = EloScorer.update_rating(student_elo, item_difficulty, outcome)
    rating_change = new_rating - student_elo
    
    print(f"\nTest 1: Student beats difficult item")
    print(f"  Student ELO: {student_elo}")
    print(f"  Item Difficulty: {item_difficulty}")
    print(f"  Outcome: {'Correct' if outcome == 1 else 'Incorrect'}")
    print(f"  Expected Score: {expected:.4f} ({expected * 100:.2f}%)")
    print(f"  New Rating: {new_rating:.2f}")
    print(f"  Rating Change: +{rating_change:.2f}")
    
    # Test 2: Student 1200 misses Item 1000 (should go down)
    student_elo = 1200.0
    item_difficulty = 1000.0
    outcome = 0  # Incorrect
    
    expected = EloScorer.calculate_expected_score(student_elo, item_difficulty)
    new_rating = EloScorer.update_rating(student_elo, item_difficulty, outcome)
    rating_change = new_rating - student_elo
    
    print(f"\nTest 2: Student misses easy item")
    print(f"  Student ELO: {student_elo}")
    print(f"  Item Difficulty: {item_difficulty}")
    print(f"  Outcome: {'Correct' if outcome == 1 else 'Incorrect'}")
    print(f"  Expected Score: {expected:.4f} ({expected * 100:.2f}%)")
    print(f"  New Rating: {new_rating:.2f}")
    print(f"  Rating Change: {rating_change:.2f}")
    
    # Test 3: Student 1200 beats Item 1200 (expected, small change)
    student_elo = 1200.0
    item_difficulty = 1200.0
    outcome = 1  # Correct
    
    expected = EloScorer.calculate_expected_score(student_elo, item_difficulty)
    new_rating = EloScorer.update_rating(student_elo, item_difficulty, outcome)
    rating_change = new_rating - student_elo
    
    print(f"\nTest 3: Student beats item of equal difficulty")
    print(f"  Student ELO: {student_elo}")
    print(f"  Item Difficulty: {item_difficulty}")
    print(f"  Outcome: {'Correct' if outcome == 1 else 'Incorrect'}")
    print(f"  Expected Score: {expected:.4f} ({expected * 100:.2f}%)")
    print(f"  New Rating: {new_rating:.2f}")
    print(f"  Rating Change: +{rating_change:.2f}")
    
    print("\n" + "=" * 60)
