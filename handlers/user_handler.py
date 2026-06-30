from models.user import User
from serializers.user_serializer import serialize_user
from validators.user_validator import validate_user_data


def create_user(data):
    errors = validate_user_data(data)
    if errors:
        return {"errors": errors}
    user = User(id=data.get("id"), name=data["name"], email=data["email"],
                role=data.get("role", "member"))
    return serialize_user(user)
