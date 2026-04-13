import requests
import json
import time

# 1. SETUP: We use the SEARCH endpoint (Plural 'questions')
url = "https://qbank-api.collegeboard.org/msreportingquestionbank-prod/questionbank/digital/get-questions"

# 2. HEADERS (Use your working Cookie!)
headers = {
    'accept': 'application/json, text/plain, */*',
    'content-type': 'application/json',
    'origin': 'https://satsuiteeducatorquestionbank.collegeboard.org',
    'referer': 'https://satsuiteeducatorquestionbank.collegeboard.org/',
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    
    # [CRITICAL] PASTE YOUR WORKING COOKIE HERE
    'Cookie': 'ak_bmsc=C4653A222CE932B6CD1EA2098AFE8125~000000000000000000000000000000~YAAQRGDQF/heWgCcAQAANBELBh75zEjGPg/eND/+XTHGlVXOGI7OrcaC0tv31T/vxNAxpTydHPzxwC7oPUQ1OOkZUC21DUzYLC9ZGriW4tsoSR9Pn+Gj+o52xbi1IVcJROxRdEMTYh6abFhVoGmzPGvNVL6nfX7kNAdPmyhymUIYr95CGhu75mLChmNEfOBed8puhUF5MHU23UmeGw/6bf2E5AuH74SlAclVQjTeUrNDJo7FatIz3b7ILhUO/HPvKi4qESQT9szuy2ju0pukK7CHjVZBSrJoPqAEqHg5ieuJMBtf1nvDKoHl7zvU8sxF0PadS/HVKUK1XGSbtGBxdJReJ56arL8oI5K/Smz05k4lHedbpkiOPy7ROk/H93LVoHL5sA6+SfvN1DDaglQ0PYZ+RzQiw4ba3mcuvw/2pQlE//avD6Cb0oD6JKI=; cwr_u=c5733d76-9ae7-43f1-8037-7e3fa280e155; kiwi_fpid=778e2267-ba77-48af-96fe-9eb8e7f189bb; OptanonAlertBoxClosed=2026-01-28T19:18:40.189Z; kndctr_5E1B123F5245B29B0A490D45_AdobeOrg_consent=general%3Din; kndctr_5E1B123F5245B29B0A490D45_AdobeOrg_identity=CiY2NjI4ODIyNDQ3MzYzMDg0MjIwMjE1NjkzMzU2Njc0NzQzNjM1N1ISCPLOrLDAMxABGAEqA09SMjAA8AHyzqywwDM%3D; AMCV_5E1B123F5245B29B0A490D45%40AdobeOrg=MCMID|66288224473630842202156933566747436357; kndctr_5E1B123F5245B29B0A490D45_AdobeOrg_cluster=or2; Wed Jan 28 2026 12:48:21 GMT-0800 (Pacific Standard Time); s_tbm=1; kiwi_life={"ds":"2026-01-28T20:48:24.126Z","chs":"Other Sites^Direct","cps":"Other:github.com^Other:Google^Direct","mrs":"","gclid":"","orig":{"ch":"Direct","cp":"Direct"},"last":{"ch":"Direct","cp":"Direct"}}; mboxEdgeCluster=35; bm_sv=E481E6CC04E7DFC254E1EA76988AD04A~YAAQRGDQF8CEaQCcAQAApnZdBh4oxqQAhPyveEyjqm5YuIj4CeAzb3a0dUyuXEAcqwVxcbTAJYDjB4vJsjcsNl+ImsFl93P9x08UlgZCLXQ/YJ/ZbW/93b+OUnWVB1F3QqGlRBoucq7/F7e4gqOfxmd4v+4m4ON5g6h187ZsGNhi4EGi2s1Hv40iVv6pH1YSJkdaWxA7FYOoDS4YNRpBdmThP/SJFkcXpU5bOQtm0TSRND0ExUvlTrOLwQ/KPQnm3ft0vOyGDQ==~1; bm_sz=41BB0C7F1D57B3A3669A36FA122BE94D~YAAQRGDQF8GEaQCcAQAApnZdBh4fXwijkp2CfEe9fBoPEaHD0LGMNg3b9hVVswCJM7ohPeS33RW84kil4kVgEGUAigrKyCOCLEap2cf0uoswkDg/xz8vrAbnKhTA65chbic9UD6Reb5uiitEzkyUtIyukeEYYV0+lNndzxH+isdGLVlVzf3zGbYQwp9dM+Yht3qH3Dn0IN65ZCYRS0rhd49AsLzXVNgKf3wX1AoZPody2Y6nnNQ4anY+MCiCB0OSwO7DusGDLz+xf2prpxWapNYI75EYGFsGvksDpFPiJyJfg0kK+QUjoMksQIAg+8adgfqFVqPaA97hQb1+kpslSnBcgRIKlfWl29yS4uF9exnBzCeLe0w4MveF/FGuDJZBPYPOP6grDy12RIkT/CmBQxbhJFdzE6r7WnV3my4hRzIicKg4aD+yrHeCYlRQG7DvuThGTAfTk9yPuQ1BJsaAS75ts3QJhIpcFrfKMEGzD+fV6ZPm8ELG09zgHLnOVOq3TktAg9h2jhn8dWvFLM1ZzSnTXzbst/2U+hKLj72tNA==~3490870~3556400; _abck=B6C5D7381FDACA7C1145C08D6D409413~0~YAAQRGDQF8uEaQCcAQAA4HZdBg96I3OOVtCn4SFAY8MKTsJh4hIZt8au2Kvl8tHhsRs13iOcztmyx4T1RYN8sEns57ByBYGeyTELe93fA2PdM26k1NI+7Ai3o1MUNnJgkaHY2jQVvjFPbkevNWv9CDvbQw+7NLdzmXdIUgt/6zYAgrOCkTUm/ZC7eOc7dAneNiyTvOfmyT8XZ43fDnaY/TcNiVowJ1b8GX/qhy8njUccCopREIZMvfYD7RaLD8tC4Vm2upacaHtH1kP7rYdIRo4a4PNGuU6Vog0oBs7xCxeiIdHkcCeyfs2uaGwMNyflFhi+6JEo35RhgPAgAbkrGcLa6TuVfxc0/rN00fdzbkACHtwtgmI6HUofuhmVkwGFviGpU14+9iK/7v81QMG4Y/rT6Z72blEZ2dcSaptF4Ej5RXCmPZmOyiLaJhUX3Js2Qir87ceFWiO2NxN8nqi3OVBKL3oXUGmiyOi0u4mncJD2io/moKqp8OPVlxkDicxPihXDV2/IEqcs8iM22utjjsyXODOlk88c7ms1IUB+wawoyLdhsD0sl2kQfMoPozRLj20XH7GMke51AQjK7r3W7jAoUDWXNtnC1v8n0mV4NbjlTpJCm97iDvoyfz+sKVn2uVxG0Wb8A0qGCynZnXRzALZNCbhLND6QsG3PnjWBQUJUZZpWYEvYa/RykEqHuYotuR+nnmlMlJ+7Ohm6DJAQnLsb2EWG1lFUmFHXiLcuHyL1/0Nznw==~-1~-1~-1~AAQAAAAF%2f%2f%2f%2f%2f%2fCkBdzELYwbaKJVNYEpyBVS8Vutm2Q0rZCqYfyrdkltlvGhrxZJ2afd1hapBSQSIARfHAiwKJ0qBrAeIG7l2RlON3aRTDENQpyrXwfJUXfTERrIFakEfDg2VUcHOKwnAoyu5we3H1x07ysC+ePTI09%2f0iuLXQT1NFZIGUUw94qeMMUu4zXkYPl9emq9VusPAjznPEcTFWiO~-1; OptanonConsent=isGpcEnabled=0&datestamp=Wed+Jan+28+2026+12%3A48%3A35+GMT-0800+(Pacific+Standard+Time)&version=202509.1.0&browserGpcFlag=0&isIABGlobal=false&hosts=&consentId=498e9dd4-88eb-4571-a29c-77908d6951e5&interactionCount=1&isAnonUser=1&landingPath=NotLandingPage&groups=C0001%3A1%2CC0002%3A1%2CC0003%3A1%2CC0004%3A1&intType=1&geolocation=US%3BCA&AwaitingReconsent=false; kiwi_sess={"prev":{"sc":"satsuiteeducatorquestionbank","pn":"satsuiteeducatorquestionbank/digital/results","ch":"","cp":""},"cbUser":"","tags":{"ac":{"vToken":"","vExp":""}},"activityMap":{"pageName":"","linkName":"","linkRegion":"","linkType":"","linkUrl":""}}; mbox=session%2366288224473630842202156933566747436357%2DfhEHrm%231769635177; cwr_s=eyJzZXNzaW9uSWQiOiJmYzgyOGI0YS02MjY1LTQ0YWQtYmE5Zi1lNmVjNzkyMjU3YTciLCJyZWNvcmQiOnRydWUsImV2ZW50Q291bnQiOjI5LCJwYWdlIjp7InBhZ2VJZCI6Ii9kaWdpdGFsL3Jlc3VsdHMiLCJwYXJlbnRQYWdlSWQiOiIvZGlnaXRhbC9yZXN1bHRzIiwiaW50ZXJhY3Rpb24iOjEsInN0YXJ0IjoxNzY5NjMzMzE0ODA1fX0='
}

# 3. PAYLOAD: Ask for ALL SAT questions
payload = {
    "page": 0,
    "rows": 10000,  # Try to grab them all at once
    "sort": [{"field": "published_date", "dir": "desc"}],
    "test": 2,      # 2 = SAT (1 = PSAT)
    "exams": [2],
    "author": "College Board",
    "calculation": False
}

print("📥 Fetching fresh Question Index...")

try:
    response = requests.post(url, headers=headers, json=payload)
    
    if response.status_code == 200:
        data = response.json()
        questions = data.get('questions', [])
        
        print(f"✅ Success! Found {len(questions)} active questions.")
        
        # Save this NEW index
        with open('fresh_sat_index.json', 'w', encoding='utf-8') as f:
            json.dump(questions, f, indent=4)
            
        print("💾 Saved to 'fresh_sat_index.json'.")
        print("👉 Now update your harvest_questions.py to load THIS file instead of sat_gold_mine.json!")
        
    else:
        print(f"❌ Failed. Status: {response.status_code}")
        print("Response:", response.text)

except Exception as e:
    print(f"Error: {e}")