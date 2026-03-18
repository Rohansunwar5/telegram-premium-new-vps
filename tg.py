import os
import time
import json
import httpx
import concurrent.futures

API_URLS = (os.getenv("API_URLS")).split(',')

def fetch_api(url, payload):
    """
    Fetches data from the given API URL with the provided payload.
    """
    start_time = time.time()
    url = url.strip()

    try:
        with httpx.Client(timeout=10.0) as client:
            response = client.post(url, data=payload)
            elapsed_time = time.time() - start_time

            if response.status_code == 200:
                data = response.json()
                print(f"Response from {url}: {data}")  # Debug: print full response

                if "channel_names" in data:
                    print(f"Successfully fetched {url} in {elapsed_time:.2f} seconds.")
                    return data
                else:
                    print(f"Unexpected response format from {url}.")
            else:
                print(f"Error fetching {url}: HTTP {response.status_code}.")
    except Exception as e:
        elapsed_time = time.time() - start_time
        print(f"Exception fetching {url}: {e}. Time taken: {elapsed_time:.2f} seconds.")

    return {}

def fetch_all_apis(urls, payload):
    """
    Fetches data from all APIs concurrently using threading.
    """
    results = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=5) as executor:
        future_to_url = {executor.submit(fetch_api, url, payload): url for url in urls}
        for future in concurrent.futures.as_completed(future_to_url):
            result = future.result()
            if result:
                results.append(result)
    return results

def lambda_handler(event, context):
    """
    AWS Lambda handler function.
    """
    try:
        
        body = event.get("body")
        if not body:
            return {
                'statusCode': 400,
                'body': json.dumps({"error": "search_query is required"})
            }

        
        body_dict = json.loads(body)
        search_query = body_dict.get('search_query')

        if not search_query:
            return {
                'statusCode': 400,
                'body': json.dumps({"error": "search_query is required"})
            }

        payload = {'search_query': search_query}
        print(f"Payload: {payload}")  # Debug: print payload

        
        results = fetch_all_apis(API_URLS, payload)

        
        channel_names = []
        for result in results:
            channels = result.get("channel_names", [])
            channel_names.extend(channels)

        
        channel_names = list(dict.fromkeys(channel_names))

        
        keywords = [
            "News", "ias", "upsc", "exam", "movies", "movie", "currentaffairs", "affair",
            "times", "Newspaper", "paper", "academy", "chess", "bytes", "MEGHUPDATES",
            "Insight SSB", "Insight", "Gurukul", "Premier League", "Geopolitics", "politics",
            "Update", "Updates", "tech", "noel", "Pravda", "course", "helper", "University",
            "success", "football", "sports", "Mechanical", "PapersWIKI", "Papers", "soccer",
            "memes", "Editorial", "Bulletin", "Coverage", "Story", "Newsletter", "Headline",
            "notes", "Media", "latest", "Ngo", "journalist", "reporter", "live", "Lovers",
            "Literature", "facts", "telugu", "RAJA_Loot_Deals", "southfronteng", "bgmi",
            "game", "deals", "gamer", "Bazaar", "Coupons", "Editor", "itarmyofukraine2022","TV","Study","education"
        ]

        
        matched_channels = [channel for channel in channel_names if any(sub in channel.lower() for sub in keywords)]
        unmatched_channels = [channel for channel in channel_names if not any(sub in channel.lower() for sub in keywords)]

        
        rearranged_channels = unmatched_channels + matched_channels

        return {
            'statusCode': 200,
            'body': json.dumps({"channel_names": rearranged_channels}),
            'headers': {
                'Access-Control-Allow-Headers': 'Content-Type',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'POST'
            },
        }

    except Exception as e:
        print(f"Error in Lambda function: {e}")
        return {
            'statusCode': 500,
            'body': json.dumps({"error": "Internal Server Error"})
        }
