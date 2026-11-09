---
"@helmsmith/gittyup": patch
"@helmsmith/gitradar": patch
"@helmsmith/taskmaster": patch
"@helmsmith/mech-pencil": patch
"@helmsmith/toolz": patch
"@helmsmith/timetracker": patch
"@helmsmith/skillzkit": patch
---

Interactive screens no longer burn CPU while they sit open. Every screen that binds a key (`connect`, mech-pencil's `wizard`, timetracker's summary, and any list, menu, table or confirm prompt) re-registered its key bindings in an endless loop, re-rendering hundreds of thousands of times and holding a core at 100% or more. Bindings now register once.
