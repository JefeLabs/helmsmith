# pritty commit — agent-written commits and labelled subjects (design)

**Status:** for owner approval, 2026-11-16. Decisions marked *owner* came from the owner in conversation; decisions marked *my call* are the author's and are listed again in §8 for the owner to check.

## 1. Intent

Agents do most of the committing now. The agent that wrote a change knows what it did, which tests prove it, and which effort or ticket it belongs to. Today `pritty commit` throws that away: it asks its own model to regroup the staged files and write the messages from a redacted diff capped at 12,000 characters, and pritty's skill tells the calling agent not to write its own messages. The owner wants the agent to hand pritty the commit (grouping and message), and pritty to do the mechanics and enforce the format (*owner*).

The owner also wants every commit subject to carry the effort it belongs to, as a leading label (*owner*):

```
WEDMODD-23444 fix(issue-report): log only exception class when status apply fails
WEDMODD-23444 test(issue-report): assert failed status apply logs no exception text
STATUS-LOGGING fix(issue-report): avoid doubled prefix in scheduler names
```

The owner likes the commit format pritty produces today and wants it kept (*owner*): one commit per change per category, code first, then its tests, sharing a scope, imperative lowercase subjects. Evidence for why it works is in skoolscout-com's history, where `fix(issue-report): …` is followed by `test(issue-report): cover …` (§3).

## 2. Goals, non-goals, anti-goals

**Goals**
- Subject format `<label> <type>(<scope>)[!]: <message>` (*owner*), switched on per repository (*owner*): a new config key `commitLabels` (default `false`). A label given explicitly, in args or in the JSON body, is always used; the interactive flow adds labels only where `commitLabels` is `true`. Labels apply to the `conventional` and `angular` styles only, which have a type for the label to precede (*my call*).
- The label is either the ticket (e.g. `WEDMODD-23444`) or the name of the effort grouping, the group of commits that make one change, such as a fix and its tests (*owner*). It is always written in capitals with words joined by hyphens; pritty converts what it is given (*owner*): `status logging` → `STATUS-LOGGING`, `wedmodd-23444` → `WEDMODD-23444`.
- `pritty commit` takes its commits from one of three inputs (*owner*): **args** (one commit from `--label`, `--type`, `--scope`, `--message`), **a JSON body** (one or more commits), or **interactive** when neither is given. Args and JSON make no model call.
- `--output=json` prints the result on a real run and the plan on `--dry-run` (*owner*); `--json` remains as its shorthand.
- One call commits the staged paths listed after `--`, or every staged file when none are listed; listed paths must already be staged and the rest stay staged (*owner*, option b).
- Today's format is enforced on the args and JSON inputs too: one category per commit, so code and its tests stay separate, adjacent commits (*owner* keeps today's format; enforcement is *my call*).
- `pritty commit` with no message keeps today's model-driven flow, and its commits carry a label too (*my call*, following "I like what pritty is doing today").
- A PR whose commits all carry the same label gets the title `LABEL: summary [type]… [scope]…` (*owner*).
- Every parser of commit subjects the owner controls accepts the leading label: pritty, gitradar, skoolscout-com's commit-msg hook (*my call*, required by the owner's format).

**Non-goals**
- Removing pritty's built-in model, provider config or `pritty auth` (discussed; not decided; separate work).
- Changing `pritty pr` beyond the shared-label PR title (§5.8) and parsing labelled commits; changing `pritty rebase`.
- Hunk-level commits: a file goes whole into one commit.

**Anti-goals**
- pritty committing anything that was not staged.
- pritty rewriting the agent's type, scope or message. It may add trailers and it normalises the label (*owner*); otherwise it never changes the agent's words (rule C).
- A commit that mixes code and test files.
- Labelled commits that gitradar, the skoolscout hook or pritty's PR title code read as non-conventional.

## 3. Constraints

- **skoolscout-com's commit-msg hook** (`.helmsmith/hooks/commit-msg`) refuses any subject not starting with `type(scope):`. Tested 2026-11-16: `[status apply logging] fix(issue-report): …` is refused. The hook requires a scope, lowercase first word of the description, and warns over 72 characters. It must accept the label before any pritty that emits labels reaches skoolscout teammates.
- **gitradar** (`apps/gitradar/src/collector/git.ts:172`, `CONVENTIONAL_RE`, anchored at `^`) reads a labelled subject as intent `other` with no scope, which zeroes the `fix:feat` and `scopes` scorecard metrics for those commits.
- **pritty's own parser** (`apps/pritty/src/commands/_shared/conventional.ts`, `parseConventional`, anchored at `^`) feeds PR titles (`conventionalPrTitle`), PR labels (`labels.ts`), `retypeForBranch` and `applySubjectOverrides`.
- **Commit mechanics:** pritty commits a subset of the index through a temporary index file (`commitIndexSubset`, `apps/pritty/src/git.ts`), so hooks, signing and other staged files behave as with `git commit`. Option b reuses this.
- **`--json` contract** (`_shared/output.ts`): stdout carries exactly one JSON line, the result; human lines go to stderr; failures are a message on stderr and exit 1.
- **Scope rule** already enforced by `--scope` (`isCommitScope`): one to three lowercase segments joined by `/`. The owner keeps the name `--scope` (*owner*); no `--area` flag.
- **Ticket config is optional.** `ticket.pattern` has no default and the whole `ticket` block is optional (`apps/pritty/src/config.ts`); skoolscout-com has none. `detectTicket` matches case-insensitively and upper-cases the result, so turning detection on by default would read workbrokr branches such as `feature/family/help--issue-reports-03-…` as ticket `REPORTS-03`. `resolveTicketContext` calls `process.exit(1)` and prints to stdout, so it cannot be reused under `--json` as is.
- Runtime Node 24, as everywhere in helmsmith.

## 4. Approaches

1. **Three inputs** (*owner* picked): args for one commit, a JSON body for one or more, interactive when neither is given. Args are easiest for an agent making one commit at a time; the JSON body lets an agent (or a person editing a dry run) hand over a whole effort at once, validated together; interactive keeps today's behaviour for people.
2. **Args only.** Simplest, but an agent making five commits makes five calls, and nothing checks them as a set (for example, that a test commit does not precede its code).
3. **pritty launches an agent for interactive use** (instead of its built-in model). Discussed as the way to drop the embedded model; the owner prefers today's interactive behaviour, so the model stays for now.

## 5. Design

### 5.1 Subject grammar

```
subject = [ label " " ] type [ "(" scope ")" ] [ "!" ] ": " message
label   = [A-Z0-9]+ ( "-" [A-Z0-9]+ )*                         e.g. WEDMODD-23444, STATUS-LOGGING
```

**Normalisation** (*owner*): pritty trims the label, upper-cases it and replaces each run of spaces with one hyphen, then checks it against `label`. `status logging` → `STATUS-LOGGING`; `wedmodd-23444` → `WEDMODD-23444`. Anything still outside the grammar after that (`/`, `_`, `--`, punctuation) is refused rather than guessed at (*my call*). The model path applies the same normalisation to the labels it produces.

The grammar is fixed, independent of any repository's `ticket` config. Because every label is upper-case, pritty does not try to tell a ticket from a name (`STATUS-12` and `WEDMODD-12` look alike). After normalisation the label never contains a space, so every parser can treat "one token followed by a space, then `type`" as an optional prefix. Subjects without a label keep parsing as today.

### 5.2 Choosing the input

| Input | Selected by | Model call |
|---|---|---|
| Args | `--message` (with `--label`, `--type`, `--scope`) | no |
| JSON body | `--input=json`, commits read from stdin | no |
| Interactive | neither | yes (today's flow) |

Args and JSON together are refused (*my call*).

**Dry run** (*owner*): `--dry-run`, which pritty already has, works with all three inputs. It runs every check and reports the commits it would make (with `--output=json`, the same JSON without `sha`), and touches nothing. The spelling stays `--dry-run`, matching git and today's pritty (*my call*).

**Output** (*owner*): `--output=json` prints the result as one JSON line (§5.5); without it, output is for people, as today. The existing `--json` flag stays as a shorthand for `--output=json` on every command, because workbrokr calls `pritty pr --json` and pritty's skill documents it (*my call*). `--input=json` mirrors it: the value names the format and the commits arrive on stdin, so a file is `< plan.json` (*my call*); `--body` is taken by the commit body.

### 5.3 Args: `pritty commit --message …`

```
pritty commit --label <label> --type <type> --scope <scope> --message <text>
              [--body <text>] [--trailer "Token: value"]… [--no-verify]
              [--dry-run] [--json] [-- <path>…]
```

- No model is called, and no plan cache is read or written (*my call*).
- **Required with `--message`:** `--type`, `--scope` (*my call*: the skoolscout hook requires a scope), and `--label` when the repository sets `commitLabels: true` (*my call*). Where it is off, `--label` is optional and used when given. The agent chooses the label: the ticket when the work has one, otherwise the effort grouping's name, the same on that grouping's code and test commits.
- **Files:** the paths after `--`, resolved like git pathspecs from the current directory, must each name a staged file; with none, every staged file. Other staged files stay staged (*owner*, option b). Nothing staged, or a listed path that is not staged, is refused.
- **One category per commit:** the categorizer labels the files; if they span more than one category the call is refused, naming the categories and their files (*my call*: this is what keeps code and tests in separate commits). A `test` or `storybook` category commit must be `--type test`; a code-category commit must not be `--type test` (*my call*).
- **Validation before committing**, all problems reported in one error (stderr, exit 1, per the `--json` contract): label grammar; type is a conventional type; scope rule; message non-empty, first word not capitalised, no trailing period (*my call*, mirrors the skoolscout hook); trailers are `Token: value`. A full subject over 72 characters is a warning on stderr, not a refusal (*my call*, mirrors the hook).
- **Assembly:** pritty builds `<label> <type>(<scope>): <message>`, adds `--body` as the body, then appends `commitTrailers` and `--trailer` lines with the existing idempotent `applyTrailers`. pritty does not add a `Refs:` trailer from the label: with upper-case names it cannot tell a ticket from a name, and the subject already carries the label (*my call*). No `fix/`-branch retyping on this path: the agent's `--type` stands (rule C).
- **No ticket gate on the args or JSON inputs** (*my call*): no branch ticket detection, no `ticket.validate` gate and no live lookup. These inputs check format only; a label that is not a ticket is accepted even where `ticket.validate` is on. Ticket enforcement stays on the model path.
- **`--dry-run`:** validates and reports, touches nothing.

### 5.4 JSON body: `pritty commit --input=json`

The input is the same shape `--json` prints (§5.5), so `pritty commit --dry-run --output=json > plan.json`, an edit, then `pritty commit --input=json < plan.json` round-trips (*my call*). Per commit: `label`, `type`, `scope`, `description` (the text `--message` takes in args), optional `body`, optional `files`. Output-only fields (`message`, `category`, `sha`) are ignored on input.

```json
{"commits":[
  {"label":"WEDMODD-23444","type":"fix","scope":"issue-report","description":"log only exception class when status apply fails","files":["src/StatusConsumer.java"]},
  {"label":"WEDMODD-23444","type":"test","scope":"issue-report","description":"assert failed status apply logs no exception text","files":["src/StatusConsumerTest.java"]}
]}
```

- **Every commit gets the args checks** (§5.3): label normalisation and grammar, type, scope, description, one category, type/category consistency, trailers.
- **Checks across commits**, all run before the first commit is made, all problems reported together: each listed file is staged and in only one commit; `files` may be omitted only when the body holds a single commit (then: every staged file). Staged files no commit lists stay staged, as with args (*my call*, consistent with option b).
- **Order** (*my call*): commits are made label by label, in the order each label first appears, and inside a label code first, then `test`, then `storybook`, as the model path orders today. The output lists the order actually used.
- **A commit refused by git mid-way** (a hook, for instance): pritty stops, exits 1, and stderr names the refused commit and the shas already made (*my call*, keeps the `--json` failure contract).

### 5.5 JSON output

Same envelope as today, one line on stdout. `message` keeps its meaning: the full message as committed, first line included, so it now starts with the label (*my call*). Callers that pipe it to skoolscout's `commit-msg --check` keep working once the hook accepts labels. Each commit gains the parts as new fields:

```json
{"dryRun":false,"commits":[{"category":"app","message":"WEDMODD-23444 fix(issue-report): log only exception class when status apply fails","label":"WEDMODD-23444","type":"fix","scope":"issue-report","description":"log only exception class when status apply fails","files":["src/StatusConsumer.java"],"sha":"3d38059ab"}]}
```

`sha` is absent on a dry run, as today. The CLI flag stays `--message` (*owner*); in JSON the same text is `description`, because `message` is taken. The model path fills `label`, `type`, `scope` and `description` too, parsed from what it commits. Additive.

### 5.6 Interactive: `pritty commit` with neither

Today's flow (categorize, one model call, reconcile, order code → test → storybook, confirm, commit), plus:

- **Label prompt**, only where `commitLabels` is `true` (*my call*, the owner remembered pritty asking for a Jira ticket; it never did): when no ticket is detected and the run is attended, pritty asks `Label for these commits (Jira ticket or effort name, Enter for the model's names):`. A ticket-shaped answer is looked up through `ticket.validation` when one is configured. Unattended runs (`--json`, `--auto-approve`) skip the prompt and use the model's effort names.

- Where `commitLabels` is `true`, each commit's subject gets a label. The label is the ticket pritty already detects when the repository configures a `ticket` block; otherwise the change's label, normalised as in §5.1 (*my call*). Detection is not turned on for repositories without a `ticket` block (see §3). With `commitGrouping: "category"`, which has no change labels, the model is asked for one label for the whole run (*my call*).
- The prompt asks for `change` labels of two to four words so they make usable subject labels (*my call*).
- The model's `message` stays `type(scope): subject`; pritty prepends the label when assembling, so the label is never left to the model's formatting.

### 5.7 Parsers

- **pritty `parseConventional`:** accepts and returns an optional leading label. `conventionalPrTitle`, `labels.ts`, `retypeForBranch` and `applySubjectOverrides` keep working on labelled subjects and preserve the label.
- **gitradar `CONVENTIONAL_RE`:** accepts an optional leading label token, so intent and scope parse as today. gitradar does not record the label (out of scope).
- **skoolscout-com commit-msg hook:** accepts an optional leading label (`[A-Z0-9]+(-[A-Z0-9]+)*`) before `type(scope):`, with its tests (`commit-msg.test.sh`). Separate PR in skoolscout-com.

### 5.8 PR titles

When every commit pritty pr reads (`base..HEAD`), not counting merge commits, carries the same label, the PR title takes this form (*owner*):

```
<LABEL>: <summary> [<type>]… [<scope>]…
WEDMODD-23444: stop status apply from logging exception text [fix] [test] [issue-report]
```

- **Tags** (*owner*: types and scopes): every commit type on the branch, once each, most significant first (the existing `TYPE_RANK` order: feat, fix, perf, refactor, …, test, chore), then every scope, once each, in the order the commits first use it (*my call* on the orders).
- **Summary:** the model's title summary as today (imperative, at most 70 characters, no trailing period), with any `type(scope):` prefix the model wrote removed. Expected total about 100 to 115 characters; GitHub's limit is 256. Long tag lists may be cut off in narrow list views but are always on the PR page.
- **No shared label** (some commit unlabelled, or two labels): today's title, `type(scope): summary`, unchanged (*my call*).
- Merge commits (for example a sync of `origin/develop` into the branch) are skipped when checking, since they carry no label (*my call*).
- With `--title` (the agent's verbatim title), pritty adds `<LABEL>: ` in front and the tags at the end, each only if not already there (*my call*: additions, like trailers, under rule C). `pr --check` updating a title in place follows the same rule.
- This depends on the commits, not on `commitLabels`: a branch whose commits all carry one label gets this title whatever the setting (*my call*).
- GitHub labels derived from commit types (`labels.ts`) are unchanged.
- **Known limit:** in a repository that squash-merges, the PR title becomes the commit subject on the base branch, and `LABEL: … [fix]` is not a conventional subject, so gitradar counts that commit as `other` and commitlint-style checks reject it. skoolscout-com lands PRs as merge commits, which keep the labelled commits and put the title only in the merge commit's body.

### 5.9 Docs

pritty `SKILL.md` and the `/commit` slash-command template (`_shared/templates.ts`): the anti-pattern "write your own message" is replaced by the args and JSON inputs: the agent passes label, type, scope and message, one call per commit, code before tests. Also fix the stale "per category" wording. README commit section and `docs/work-lifecycle.md` updated.

### 5.10 Rollout order

1. helmsmith PR: pritty (three inputs, `--output=json`, labels behind `commitLabels`, parser) + gitradar parser + docs, with changesets: pritty minor (additive; labels are off by default), gitradar patch. Publish with `make publish-web`.
2. skoolscout-com PR: the commit-msg hook accepts a leading label, with its tests.
3. skoolscout-com sets `"commitLabels": true` in both `.pritty.json` and `.helmsmith/pritty.json` (they must stay identical), once step 2 is on `develop`. The WEDMODD repository does the same once its commit checks accept a leading label.

Because labels are off until a repository opts in, step 1 no longer waits for the hook.

## 6. Testing

- pritty unit: label normalisation (`status logging` → `STATUS-LOGGING`, `wedmodd-23444` → `WEDMODD-23444`, repeated spaces) and refusals (`/`, `_`, `--`, empty); every refusal in §5.3 and §5.4, reported together; one-category rule and type/category consistency; path selection (listed, none, unstaged, outside repo); assembly with body and trailers; no retyping on the args and JSON inputs; `parseConventional` with and without label; PR title `LABEL: summary [types] [scopes]` when all commits share a label (merges skipped), today's title for mixed or missing labels, `--title` gets label and tags added once, a model-written `type(scope):` prefix removed from the summary; model path prepends the detected ticket or the normalised change label.
- pritty unit (JSON body): cross-commit checks (file twice, unstaged file, missing `files` with several commits), ordering by label then code → test → storybook, args + `--input` refused, stop-and-report when git refuses a commit mid-way; interactive label prompt shown only when attended and no ticket detected.
- pritty e2e (built CLI): two calls commit app then test files from one staging, leaving nothing else changed; `--dry-run --output=json` output fed back through `--input=json` makes the same commits; `--dry-run --json` and real `--json` shapes; refusal exits 1 with the message on stderr and nothing on stdout.
- gitradar: `parseConventionalCommit` on labelled and unlabelled subjects.
- skoolscout hook: labelled subjects pass, `[x] fix(...)` and capitalised descriptions still refused.

## 7. Left to the builder

Exact error wording; flag help text; whether the args and JSON inputs live in `commit.ts` or a sibling module; how to shorten an over-long model label; README layout.

## 8. Calls to check (author's, not the owner's)

- `--message` selects the args input; `--type` and `--scope` are then required (`--label` too where `commitLabels` is on).
- Refuse a call whose files span categories; `test`/`storybook` commits must be `--type test`, code commits must not.
- Message checks mirror the skoolscout hook; over 72 characters warns, does not refuse.
- No `Refs:` trailer derived from the label.
- Label grammar fixed (`[A-Z0-9]+(-[A-Z0-9]+)*` after the owner's normalisation), not taken from `ticket.pattern`; characters other than letters, digits, spaces and single hyphens are refused, not converted.
- Args and JSON inputs run no ticket gate or lookup.
- JSON `message` stays the full committed message (now labelled); the description is a new `description` field.
- Model path labels: detected ticket first, else the change label, normalised; in `category` grouping, one model-chosen label per run.
- PR title with a shared label: tags ordered types (TYPE_RANK) then scopes (first use); no shared label keeps today's title; merge commits skipped when checking; `--title` gets label and tags added if missing; applies whatever `commitLabels` says.
- `commitLabels` defaults to `false`; `--label` required in args only where it is `true`; labels only for `conventional`/`angular` styles.
- pritty ships first (labels off by default); each repository turns labels on after its own commit checks accept them.
- `--input=json` reads the body from stdin (value names the format, like `--output=json`); `--json` kept as shorthand for `--output=json` on every command; args and `--input` together refused; input shape = output shape, with `description` for the text `--message` takes.
- JSON body: commits ordered by label (first appearance), code → test → storybook inside each; unlisted staged files stay staged; mid-way git refusal stops and reports shas made.
- Interactive label prompt when attended and no ticket is detected.
