import random
import datetime
import requests
import json
from os import environ
from json import dumps
from requests import post

import sys

def send_notification(message):
    token = environ.get('token')
    if not token:
        # If the token is not present, stop sending push notification
        return 'PushPlus: No token configured, cannot send push notification.'
    url = 'http://www.pushplus.plus/send/'

    data = {
        "token": token,
        "title": "皎月连签到：" + message, # Set title to be "皎月连签到：" followed by the message
        "content": message,
    }

    headers = {'Content-Type': 'application/json'}
    rsp = requests.post(url, data=json.dumps(data), headers=headers)
    return rsp.text

if __name__ == '__main__':
    if len(sys.argv) > 1:
        checkin_message = sys.argv[1]
        print(send_notification(checkin_message))
    else:
        print("Usage: python push_notification.py <checkin_message>")
        sys.exit(1)
