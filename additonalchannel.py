#add-ch
import boto3
from telethon.sync import TelegramClient
from telethon.sessions import StringSession
from telethon.errors import ChannelInvalidError, ChannelPrivateError, FloodWaitError
from botocore.exceptions import ClientError
import json
import os
# AWS region and DynamoDB table name
aws_region = 'us-east-1'
dynamodb = boto3.resource('dynamodb', region_name=aws_region)
table = dynamodb.Table('Additional-Channels')

hide_channel = ["TheUnderground 4", 
"ARES PRIVATE CHANNEL",
"DataRecordsShop",
"DataBreachPremium", 
"SpamoArabo",
"Coa_Agency", 
"Anonymous0islamic", 
"investigationAnonYmousPS", 
"Team_r70YEMEN", 
"OceanLeak",
"databasee01", 
"leakdataprivate", 
"PDDcp", 
"baseleak", 
"LianSec",
"exposedghost", 
"insidehackerz", 
"afaghhosting ", 
"SMokerFiles", 
"RipperSec", 
"NetGhostSecurity",
"shieldteam1", 
"illsvcleaksupload", 
"HUBHEAD", 
"HUBHEAD | VIP SNATCH ROOM 2", 
"Goblin's Free Logs",
"OBSERVERINFO ",
"BreachedDiscussion1", 
"SiegedSecurity",
"Akatsuki", 
"LEAKS AGGREGATOR | УТЕЧКИ АГРЕГАТОР | БАЗЫ ДАННЫХ | СЛИВ |", 
"fakesec666",
"ridgedforums",
"KMPteam", 
"h4shur",
"IranDataLeak", 
"ByteMeCrew ",
"arvinclub1",
"TigerElectronicUnit",
"xxShad0dexx", 
"[ EVILX LEAKS CHAT]"
]

def get_update_current_index():
    current_index = os.environ['CURRENT_INDEX']
    new_index = int(current_index) + 1
    if new_index > 10:
        new_index = 1
    # Update environment variable
    os.environ['CURRENT_INDEX'] = str(new_index)
    print(current_index)
    return current_index
    
# Lambda handler
def lambda_handler(event, context):
    print(event)
    body = event.get("body")
    if not body:
        return {
            'statusCode': 400,
            'body': json.dumps({"error": "search_query is required"}),
            'headers': {
                'Access-Control-Allow-Headers': 'Content-Type',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'POST'
            },
        }

        # Assuming the request body is form-encoded
    body_dict = json.loads(body)
    search_query = body_dict.get("search_query", None)
    channel_name = body_dict.get("channel_name", None)
    print("search_query",search_query)
    print("channel_name",channel_name)
    if not search_query or not channel_name:
        return {
            "statusCode": 400,
            "body": "Missing search_query or channel_name in request",
            'headers': {
                'Access-Control-Allow-Headers': 'Content-Type',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'POST'
            },
        }

    # Retrieve Telegram messages
    result = retrieve_telegram_messages(search_query, channel_name)
    return result

# Fetch session from DynamoDB
def fetch_session_from_dynamodb(session_id):
    try:
        response = table.get_item(Key={'SessionId': session_id})
        print(response)
        if 'Item' in response:
            return response['Item']
        else:
            print("Session not found in DynamoDB, starting a new session.")
            session_id = int(session_id) + 1
            response = table.get_item(Key={'SessionId': str(session_id)})
            print(response)
            if 'Item' in response:
                return response['Item']
            else:
                return None
    except ClientError as e:
        print(f"Failed to load session from DynamoDB: {e}")
        return None

# Save session to DynamoDB
def save_session_to_dynamodb(session_str, session_id="default"):
    try:
        table.put_item(Item={
            'SessionId': session_id,
            'SessionData': session_str
        })
        print("Session saved to DynamoDB.")
    except ClientError as e:
        print(f"Failed to save session to DynamoDB: {e}")

# Fetch messages from the channel synchronously
def fetch_messages_from_channel(client, channel_name, keyword, limit=7):
    messages_info = []
    try:
        for message in client.iter_messages(channel_name, limit=limit, search=keyword):
            if channel_name in hide_channel:
                new_channel_name = " "
            else:
                new_channel_name = channel_name
            if message.text:
                messages_info.append({
                    "channel_name": new_channel_name,
                    "message_id": message.id,
                    "text": message.text,
                    "date": message.date.isoformat(),
                })
    except (ChannelInvalidError, ChannelPrivateError) as e:
        print(f"Channel error: {str(e)}")
    except FloodWaitError as e:
        print(f"Rate limited by Telegram, wait for {e.seconds} seconds.")
    except Exception as e:
        print(f"Failed to fetch messages: {str(e)}")
    
    return messages_info

# Main function to retrieve messages
def retrieve_telegram_messages(search_query, channel_name, limit=5):
    # Fetch the session from DynamoDB
    index = get_update_current_index()
    print(index)
    db_data = fetch_session_from_dynamodb(index)
    
    if db_data:
        print("db_data",db_data)
        session_str = db_data['Session_Data']
        api_id = db_data["API_ID"]
        api_hash = db_data["API_HASH"]
        session = StringSession(session_str)
    else:
        print("No session found in DynamoDB.")
        return {"statusCode": 500, "body": "Failed to fetch session from DynamoDB"}
        
    try:
        # Create the Telegram client using the session
        with TelegramClient(session, api_id, api_hash,use_ipv6=False) as client:
            print("client",client)
            messages_info = fetch_messages_from_channel(client, channel_name, search_query, limit)
            print(messages_info)
        
        # Save the updated session string back to DynamoDB if a new session was created
        # if not db_data:
        #     save_session_to_dynamodb(session.save())
        
        return {
            'statusCode': 200,
            'body': json.dumps({"messages_info": messages_info}),
            'headers': {
                'Access-Control-Allow-Headers': 'Content-Type',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'POST'
            },
        }
    except Exception as e:
        print(f"Error: {str(e)}")
        return {"statusCode": 500, "error": str(e)}

