# @helmsmith/pritty-connect

The interactive connections view for [`@helmsmith/pritty`](../pritty): GitHub Copilot login status, login and logout in a terminal UI.

It is a separate package because the view is an OpenTUI app and needs the Bun runtime; keeping it out of `@helmsmith/pritty` lets `pritty commit`, `pr` and `rebase` install and run under plain Node without Bun, OpenTUI or React.

```bash
npm i -g @helmsmith/pritty-connect
pritty connect        # delegates here when it is on PATH
pritty-connect        # or run it directly
```
