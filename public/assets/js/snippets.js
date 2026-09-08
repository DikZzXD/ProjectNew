/**
 * Snippet generators for the playground's language tabs.
 * Each one receives { url, method, params } and returns runnable code.
 */

function pretty(url) {
  return url;
}

function bodyObject(params) {
  return JSON.stringify(params, null, 2);
}

const GEN = {
  curl({ url, method }) {
    return method === 'POST'
      ? `curl -X POST "${url}" \\\n  -H "Content-Type: application/json"`
      : `curl -X GET "${pretty(url)}"`;
  },

  javascript({ url, method, params }) {
    if (method === 'POST') {
      return `const res = await fetch("${url}", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(${bodyObject(params)})
});

const data = await res.json();
console.log(data);`;
    }
    return `const res = await fetch("${url}");
const data = await res.json();

console.log(data);`;
  },

  python({ url, method, params }) {
    if (method === 'POST') {
      return `import requests

res = requests.post(
    "${url}",
    json=${bodyObject(params).replace(/true/g, 'True').replace(/false/g, 'False').replace(/null/g, 'None')},
    timeout=30,
)

print(res.json())`;
    }
    return `import requests

res = requests.get("${url}", timeout=30)
res.raise_for_status()

print(res.json())`;
  },

  php({ url, method }) {
    if (method === 'POST') {
      return `<?php
$ch = curl_init("${url}");
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_POST           => true,
    CURLOPT_HTTPHEADER     => ["Content-Type: application/json"],
]);

$response = curl_exec($ch);
curl_close($ch);

print_r(json_decode($response, true));`;
    }
    return `<?php
$response = file_get_contents("${url}");
$data = json_decode($response, true);

print_r($data);`;
  },

  node({ url, method, params }) {
    if (method === 'POST') {
      return `import axios from "axios";

const { data } = await axios.post("${url}", ${bodyObject(params)});

console.log(data);`;
    }
    return `import axios from "axios";

const { data } = await axios.get("${url}");

console.log(data);`;
  },

  go({ url }) {
    return `package main

import (
\t"fmt"
\t"io"
\t"net/http"
)

func main() {
\tres, err := http.Get("${url}")
\tif err != nil {
\t\tpanic(err)
\t}
\tdefer res.Body.Close()

\tbody, _ := io.ReadAll(res.Body)
\tfmt.Println(string(body))
}`;
  },
};

export const LANGS = [
  { id: 'curl', label: 'Curl' },
  { id: 'javascript', label: 'Javascript' },
  { id: 'python', label: 'Python' },
  { id: 'php', label: 'Php' },
  { id: 'node', label: 'Node.js' },
  { id: 'go', label: 'Go' },
];

export function snippet(lang, context) {
  return (GEN[lang] || GEN.curl)(context);
}
