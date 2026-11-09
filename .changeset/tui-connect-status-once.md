---
"@helmsmith/gittyup": patch
"@helmsmith/gitradar": patch
"@helmsmith/taskmaster": patch
"@helmsmith/mech-pencil": patch
"@helmsmith/toolz": patch
"@helmsmith/skillzkit": patch
---

`connect` checks each connection's status once when it opens (and again on `r` or after a login or logout), instead of thousands of times a second. An app that passed no optional connections got a new empty list on every render, so every render re-fetched every status and each fetch caused another render.
