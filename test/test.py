import requests
import time

# Your API key from CAPTCHAs.IO
API_KEY = 'gy6eqaj8dt-baxmxybr0r0gi-eugse7wpvo'

# The site URL and the site key of the hCaptcha
page_url = 'https://accounts.hcaptcha.com/demo'
site_key = 'a5f74b19-9e45-40e0-b45d-47ff91b7a6c2'

# Step 1: Submit the captcha solving request
submit_url = 'https://api.captchas.io/in.php'
data = {
    'key': API_KEY,
    'method': 'hcaptcha',
    'sitekey': site_key,
    'pageurl': page_url,
    'json': 1
}

response = requests.post(submit_url, data=data)
response_json = response.json()

if response_json.get('status') == 1:
    captcha_id = response_json.get('request')
    print(f"✅ Captcha submitted! ID: {captcha_id}")

    # Step 2: Poll for the captcha result
    result_url = 'https://api.captchas.io/res.php'
    result_data = {
        'key': API_KEY,
        'action': 'get',
        'id': captcha_id,
        'json': 1
    }

    # Wait for a few seconds before polling
    print("⏳ Waiting 20 seconds before polling...")
    time.sleep(20)

    while True:
        result_response = requests.get(result_url, params=result_data)
        result_json = result_response.json()

        if result_json.get('status') == 1:
            captcha_solution = result_json.get('request')
            print(f"✅ Captcha Solved! Token: {captcha_solution}")
            break
        elif result_json.get('request') in ['CAPCHA_NOT_READY', 'ERROR_NO_SLOT_AVAILABLE']:
            print("⏳ Captcha not ready, waiting 5 seconds...")
            time.sleep(5)
        else:
            print(f"❌ Error: {result_json.get('request')}")
            break
else:
    print(f"❌ Error submitting captcha: {response_json.get('request')}")
