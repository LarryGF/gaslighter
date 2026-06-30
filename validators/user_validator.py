REQUIRED_FIELDS = ["name", "email"]
VALID_ROLES = ["member", "admin", "moderator"]


def validate_user_data(data):
    errors = []
    for field in REQUIRED_FIELDS:
        if field not in data:
            errors.append(f"{field} is required")
    role = data.get("role", "member")
    if role not in VALID_ROLES:
        errors.append(f"invalid role: {role}")
    return errors
