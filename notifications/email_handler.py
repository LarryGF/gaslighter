from notifications.utils import format_message, timestamp


def handle_email(recipient, template, **kwargs):
    body = format_message(template, **kwargs)
    return {"status": "sent", "channel": "email", "timestamp": timestamp()}


def handle_email_error(error):
    return {"status": "error", "error": str(error), "timestamp": timestamp()}
