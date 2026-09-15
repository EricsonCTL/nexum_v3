import urllib.request
url = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vT_et0B2equYxZT7QXjReBl0VMJ1qx5clTNbnoXzULo1pKnWOkGh6wv3nAlgz9p-8gyKGDoVSXKEVSU/pub?gid=872949406&single=true&output=csv'
with urllib.request.urlopen(url, timeout=20) as r:
    text = r.read().decode('utf-8')
print('\n'.join(text.splitlines()[:12]))
