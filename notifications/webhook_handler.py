import json
import urllib.request
import urllib.error

from notifications.utils import format_message, timestamp


def handle_webhook(url, template, **kwargs):
    body = format_message(template, **kwargs)
    data = json.dumps({"body": body}).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req) as response:
            return {"status": "sent", "channel": "webhook", "timestamp": timestamp()}
    except Exception as e:
        return handle_webhook_error(e)


def handle_webhook_error(error):
    return {"status": "error", "error": str(error), "timestamp": timestamp()}
