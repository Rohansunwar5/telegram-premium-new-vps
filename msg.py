import json
import boto3
from fastapi import FastAPI, HTTPException, Query
from telethon.sync import TelegramClient
from telethon.sessions import StringSession
from botocore.exceptions import ClientError
from mangum import Mangum  # Import Mangum for AWS Lambda support

# FastAPI App
app = FastAPI()

# AWS Configuration
AWS_REGION = "us-east-1"
DYNAMODB_TABLE = "TelegramSessions"

# Initialize DynamoDB
dynamodb = boto3.resource("dynamodb", region_name=AWS_REGION)
table = dynamodb.Table(DYNAMODB_TABLE)

# Valid session IDs (excluding 2)
SESSION_IDS = [i for i in range(1, 19) if i != 2]
current_index = 0  # Keeps track of the last used session ID

def get_next_session_id():
    """ Returns the next session ID in round-robin fashion. """
    global current_index
    session_id = SESSION_IDS[current_index]
    current_index = (current_index + 1) % len(SESSION_IDS)
    return str(session_id)  # Convert to string for DynamoDB lookup

def fetch_session_from_dynamodb(session_id):
    """ Fetches session data from DynamoDB based on the session_id. """
    try:
        response = table.get_item(Key={"SessionId": session_id})
        if "Item" in response:
            return response["Item"]
        else:
            print(f"No session found for SessionId: {session_id}")
            return None
    except ClientError as e:
        print(f"Error fetching session from DynamoDB: {e}")
        return None

async def fetch_messages_from_user(client, channel_name, user_id, limit=1):
    """ Fetches messages from the given user in a Telegram channel. """
    messages_info = []
    try:
        async for message in client.iter_messages(channel_name, from_user=user_id, limit=limit):
            if message.text:
                messages_info.append({
                    "message_id": message.id,
                    "text": message.text,
                    "date": message.date.isoformat(),
                    "from_user": user_id
                })
    except Exception as e:
        print(f"Failed to fetch messages: {e}")
    
    return messages_info

async def retrieve_telegram_messages(channel_name: str, user_id: str, limit: int = 1):
    """ Retrieves messages from Telegram using a round-robin session selection. """
    session_id = get_next_session_id()
    db_data = fetch_session_from_dynamodb(session_id)

    if not db_data:
        return {"status": "error", "message": f"Failed to fetch session data for SessionId: {session_id}"}

    session_str = db_data["Session_Data"]
    api_id = db_data["API_ID"]
    api_hash = db_data["API_HASH"]

    session = StringSession(session_str)

    try:
        async with TelegramClient(session, api_id, api_hash) as client:
            messages_info = await fetch_messages_from_user(client, channel_name, user_id, limit)
            return {"status": "success", "messages": messages_info}
    except Exception as e:
        print(f"Error: {e}")
        return {"status": "error", "message": str(e)}

@app.post("/fetch_messages/")
async def fetch_messages(channel_name: str = Query(...), user_id: str = Query(...)):
    """ API Endpoint to fetch messages from a Telegram channel. """
    if not channel_name or not user_id:
        raise HTTPException(status_code=400, detail="channel_name and user_id are required")

    result = await retrieve_telegram_messages(channel_name, user_id)
    
    if result["status"] == "error":
        raise HTTPException(status_code=500, detail=result["message"])

    return result

# Mangum Handler for AWS Lambda
handler = Mangum(app)
