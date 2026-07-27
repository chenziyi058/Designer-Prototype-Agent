def classify(rotation_speed: float, direction_changes: int, pause_ratio: float) -> str:
    """Transparent baseline until a validated trained model replaces it."""
    if rotation_speed >= 0 and direction_changes <= 3 and pause_ratio < 0.4: return "stable_candidate"
    return "not_stable"
