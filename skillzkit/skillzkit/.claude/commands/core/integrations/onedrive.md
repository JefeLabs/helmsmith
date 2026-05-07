---
description: OneDrive integration for file storage operations via Microsoft Graph API. REST only. Uses the shared microsoft-graph auth provider — same OAuth as Outlook and Teams. Read, upload, share, search, manage permissions. Covers personal OneDrive and shared drives (SharePoint document libraries via Graph).
argument-hint: <free-form-prompt> [--drive <id>] [--path <path>]
allowed-tools: Read, Write, Edit, Bash
---

> **Read first**: `integrations/_context.md`,
> `integrations/_auth-provider-microsoft-graph.md`.

Direct invocation of OneDrive for file operations via
Microsoft Graph. Shares the microsoft-graph auth provider
with Outlook and Teams.

## Phase 0: pre-flight

Same pattern as Outlook — verify integration active,
microsoft-graph provider healthy, access token current.

```bash
ACCESS_TOKEN=$(get_msgraph_access_token)
[ -n "$ACCESS_TOKEN" ] || {
  echo "Could not obtain Microsoft Graph access token"
  exit 1
}
```

## Phase 1: prompt interpretation

Operations OneDrive handles via Microsoft Graph:

### File operations

- **List files in folder**: enumerate contents at a path
- **Get file metadata**: name, size, modified date, owner,
  share state
- **Download file**: fetch content
- **Upload file**: create or update content
- **Move / copy**: change location
- **Delete**: remove (goes to recycle bin; recoverable)
- **Create folder**: mkdir at path
- **Search**: query across drive by name or content

### Sharing operations

- **Get sharing info**: who has access to a file/folder
- **Create share link**: generate sharing URL with
  permission level (view, edit, anonymous)
- **Set permissions**: grant specific users access
- **Revoke sharing**: remove share

### Drive operations

- **List drives accessible to user**: personal OneDrive,
  shared with user, SharePoint document libraries
- **Drive metadata**: storage quota, drive type
- **Recent files**: recently accessed across drives

## Phase 2: execution

```bash
ACCESS_TOKEN=$(get_msgraph_access_token)

# List files in root of personal OneDrive
curl -sS \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  "https://graph.microsoft.com/v1.0/me/drive/root/children"

# List files in a specific folder
curl -sS \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  "https://graph.microsoft.com/v1.0/me/drive/root:/Documents/skoolscout:/children"

# Search for files
curl -sS \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  "https://graph.microsoft.com/v1.0/me/drive/root/search(q='compliance')"

# Get file metadata
curl -sS \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  "https://graph.microsoft.com/v1.0/me/drive/root:/path/to/file.pdf"

# Download file content
curl -sS -L \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -o "downloaded-file.pdf" \
  "https://graph.microsoft.com/v1.0/me/drive/root:/path/to/file.pdf:/content"

# Upload small file (<4 MB) — simple PUT
curl -sS \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/pdf" \
  -X PUT \
  --data-binary "@local-file.pdf" \
  "https://graph.microsoft.com/v1.0/me/drive/root:/path/to/uploaded-file.pdf:/content"

# Upload large file (>4 MB) — upload session
SESSION_URL=$(curl -sS \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -X POST \
  -d '{"item": {"@microsoft.graph.conflictBehavior": "rename"}}' \
  "https://graph.microsoft.com/v1.0/me/drive/root:/path/to/large-file.zip:/createUploadSession" | \
  jq -r '.uploadUrl')

# Then upload chunks (typically 320 KiB or larger multiples)
# (Implementation iterates Content-Range headers)

# Create share link
curl -sS \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -X POST \
  -d '{"type": "view", "scope": "anonymous"}' \
  "https://graph.microsoft.com/v1.0/me/drive/items/${ITEM_ID}/createLink"

unset ACCESS_TOKEN
```

### Path vs ID addressing

Microsoft Graph supports addressing files two ways:

- **By path**: `/me/drive/root:/Documents/file.pdf` — readable but path may have URL encoding issues
- **By ID**: `/me/drive/items/{id}` — opaque but stable across renames/moves

The integration uses path addressing for prompts that name
paths and ID addressing internally for follow-up operations
on the same file.

### Shared drives (SharePoint)

When a user wants to access a shared drive (e.g., a
SharePoint document library):

```bash
# List drives the user can access
curl -sS \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  "https://graph.microsoft.com/v1.0/me/drives"

# Or list drives in a SharePoint site
curl -sS \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  "https://graph.microsoft.com/v1.0/sites/{site-id}/drives"

# Operate on specific drive
curl -sS \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  "https://graph.microsoft.com/v1.0/drives/{drive-id}/root/children"
```

## Phase 3: result formatting

### File listing

```
=== OneDrive: /Documents/skoolscout ===
Drive: edwin@skoolscout.org (personal)

Folders (3):
  📁 brand-assets/             modified 2 weeks ago
  📁 compliance-docs/          modified 3 days ago
  📁 product-strategy/         modified 1 month ago

Files (8):
  📄 product-roadmap-2026.docx
     2.4 MB · modified 2 days ago · shared with 4 people
  
  📄 ferpa-compliance-summary.pdf
     412 KB · modified 1 week ago · shared (link)
  
  📄 tournament-revenue-q1.xlsx
     128 KB · modified 3 hours ago
  
  ... (5 more)

To download: /core:integrations:onedrive "download tournament-revenue-q1.xlsx"
To share: /core:integrations:onedrive "create a view link for product-roadmap-2026.docx"
```

### Search results

```
=== OneDrive Search: 'compliance' ===
Drive: edwin@skoolscout.org

Results (12):

  /Documents/compliance-docs/ferpa-summary.pdf
    412 KB · modified 1 week ago
    
  /Documents/compliance-docs/coppa-checklist.docx
    87 KB · modified 2 weeks ago
    
  /Documents/skoolscout/audit-prep-q2.xlsx
    234 KB · modified yesterday
    Match: title and content
  
  ... (9 more)

Showing top 12 of 47 total matches.
For more, refine search:
  /core:integrations:onedrive "search for ferpa compliance from 2026"
```

### Share link creation

```
=== OneDrive: Share Link Created ===
File:           product-roadmap-2026.docx
Permission:     view (read-only)
Scope:          anonymous (anyone with link)
Expires:        90 days (default policy)

Share link:
  https://skoolscout-my.sharepoint.com/:w:/g/personal/edwin_skoolscout_org/...

Note: organizational sharing policies apply. If your tenant
restricts anonymous links, the link will require sign-in.
```

### Upload confirmation

```
=== OneDrive: File Uploaded ===
Source:   /local/path/to/q2-report.pdf (4.7 MB)
Target:   /Documents/skoolscout/q2-report.pdf
Method:   upload session (file >4MB)
Duration: 3.2s

File ID:    01ABCDEF...
Size:       4.7 MB
ETag:       "{...}"
```

## Phase 4: error handling

| Error | Likely cause | Suite guidance |
|-------|--------------|----------------|
| 401 | Token expired | Auto-refresh; if still fails, re-auth microsoft-graph |
| 403 | Scope insufficient OR org policy blocks | Check scopes; check org sharing policies |
| 404 | File path doesn't exist | Verify path; check drive selection (personal vs shared) |
| 409 | Conflict (file exists with different contents) | Set `@microsoft.graph.conflictBehavior` to `rename` or `replace` |
| 413 | Payload too large for simple upload | Use upload session for files >4 MB |
| 423 | File locked by another user (Office co-authoring) | Retry later or coordinate with locker |
| 507 | Insufficient storage | Check quota; clean up old files |

## Cross-namespace integration

OneDrive is consumed by:

- **Direct user invocation** for file operations
- **`market/pr/media-kit`** — store and share media kits
  through OneDrive
- **`product/strategy/scaffold`** — when scaffolding pulls
  in template files from a OneDrive shared drive
- **Backup workflows** — periodic backup of project state
  to OneDrive (when configured)

## Quota awareness

Microsoft Graph exposes drive quota:

```bash
QUOTA=$(curl -sS \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  "https://graph.microsoft.com/v1.0/me/drive" | \
  jq '.quota')
```

Returns:
```jsonc
{
  "deleted": 4500,
  "remaining": 980000000000,
  "state": "normal",
  "total": 1000000000000,
  "used": 19996000000
}
```

When state moves to `nearing` (90% full) or `critical`
(99%), the integration surfaces a warning before upload
operations.

## What this integration does NOT do

- **Replace OneDrive sync client.** The desktop/mobile sync
  client handles continuous sync; the integration is for
  programmatic operations.
- **Manage Office Online co-authoring.** When a file is open
  in Word Online with multiple editors, the API can read
  but writes may conflict. The integration surfaces conflicts
  rather than forcing changes.
- **Handle SharePoint sites/lists beyond drives.** Lists,
  pages, and other SharePoint content require separate
  endpoints and likely separate integration in the future.
- **Bulk file operations.** No "move all files matching X"
  command; operations are per-file. Bulk operations could be
  added if needed.

## Examples

```bash
# List files in a folder
/core:integrations:onedrive "list files in /Documents/skoolscout"

# Search
/core:integrations:onedrive "find PDFs about FERPA compliance"

# Download
/core:integrations:onedrive "download q2-report.pdf"

# Upload
/core:integrations:onedrive "upload /tmp/draft.pdf to /Documents/drafts/"

# Share
/core:integrations:onedrive "create a view-only link for product-roadmap-2026.docx"

# Recent files
/core:integrations:onedrive "show me recently accessed files"

# Quota
/core:integrations:onedrive "how much OneDrive storage am I using"
```

---

# Registry definition

## Integration metadata

```yaml
name: onedrive
displayName: OneDrive (M365)
provider: microsoft
category: file-storage
multiInstance: false
authProvider: microsoft-graph
```

## Interfaces

### CLI

**Not available.** No canonical OneDrive CLI; the OneDrive
sync client is GUI/desktop, not a programmatic CLI.

### MCP

**Not available** at this time.

### REST

```yaml
baseUrl: https://graph.microsoft.com/v1.0
authMethod: oauth2-bearer-via-shared-provider
authProvider: microsoft-graph
documentationUrl: https://learn.microsoft.com/en-us/graph/api/resources/onedrive
```

## Required scopes (Microsoft Graph)

For typical operations:

- `Files.ReadWrite` — read/write personal files
- `Files.Read.All` — read shared files (other users' files
  user has access to)
- `Files.ReadWrite.All` — write to shared files (use with
  caution; broad scope)
- `Sites.Read.All` — SharePoint sites (when shared drives
  are used)

The shared microsoft-graph auth provider unions these with
Outlook and Teams scopes.

## Rate limits

Microsoft Graph throttling per tenant + app. Heavy file
operations (bulk uploads) may hit limits faster than
mail/calendar; respect `Retry-After`.

## Required by skillz commands

Auto-populated.

## Compliance considerations

OneDrive operations may be subject to:

- **Org sharing policies** — some tenants disable anonymous
  links entirely; others restrict by file type or domain
- **DLP** — files with sensitive content may be blocked from
  upload, sharing, or download
- **Conditional access** — same as Outlook (MFA required,
  etc.)
- **eDiscovery** — Microsoft 365 retains files for legal
  hold; deleted files may be recoverable longer than recycle
  bin shows
- **External sharing restrictions** — some tenants disable
  external sharing entirely

For SkoolScout / education contexts: student-data files
should never be shared via anonymous links; check tenant
policies before automating sharing.
