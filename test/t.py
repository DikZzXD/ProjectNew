import requests
import time

API_KEY = "gy6eqaj8dt-baxmxybr0r0gi-eugse7wpvo"
site_key = "a5f74b19-9e45-40e0-b45d-47ff91b7a6c2"
page_url = "https://accounts.hcaptcha.com/demo"

# Submit captcha
submit_url = "https://api.captchas.io/in.php"
data = {
    "key": API_KEY,
    "method": "hcaptcha",
    "sitekey": site_key,
    "pageurl": page_url,
    "json": 1
}

response = requests.post(submit_url, data=data)
response_json = response.json()
print(f"Submit response: {response_json}")

if response_json.get("status") == 1:
    captcha_id = response_json.get("request")
    print(f"✅ Captcha submitted! ID: {captcha_id}")

    # Poll result
    result_url = "https://api.captchas.io/res.php"
    result_data = {
        "key": API_KEY,
        "action": "get",
        "id": captcha_id,
        "json": 1
    }

    print("⏳ Waiting 20 seconds...")
    time.sleep(20)

    for attempt in range(30):
        result_response = requests.get(result_url, params=result_data)
        result_json = result_response.json()
        print(f"Attempt {attempt+1}: {result_json.get('status')} - {result_json.get('request')}")

        if result_json.get("status") == 1:
            print(f"✅ Solved! Token: {result_json.get('request')}")
            break
        elif result_json.get("request") in ["CAPCHA_NOT_READY", "ERROR_NO_SLOT_AVAILABLE"]:
            print("⏳ Not ready, waiting 5s...")
            time.sleep(5)
        else:
            print(f"❌ Error: {result_json.get('request')}")
            break
else:
    print(f"❌ Error: {response_json.get('request')}")
