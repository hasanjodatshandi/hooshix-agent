# MCP memory_get response contract (v2 envelope)

## Problem and scope
On the live Windows MCP connector, a known, principal-owned memory row could be created, listed, updated and deleted, but `memory_get` returned an empty transport result `{}`. A missing ID returned the expected `null`. The database query and the independently spawned stdio and HTTP MCP tests worked. A confirmed transport implementation defect has not yet been isolated; the response shape is a likely interoperability cause.

A memory record has its own string/JSON `content` field. MCP tool results ALSO have a `content` field containing ContentBlock[]. To avoid consumers incorrectly treating a raw memory record as a tool result, `memory_get` now returns one explicit envelope:

```json
{"record":{"id":123,"kind":"note","content":"example","principal_id":"operator","project_id":null,"task_id":null,"created_at":"...","updated_at":null}}
```

For a missing or inaccessible record the response stays `null`. The principal filter is still enforced by `getMemoryItem(memoryId, currentPrincipalId())`; no elevated access, identity fallback, enumeration of foreign records, or direct raw-SQL query was introduced.

## Compatibility
This intentionally changes the success payload from `row` to `{record:row}` (a response-contract change). Consumers must use `result.record.id`, `result.record.content`, etc. A caller should treat `null` as unavailable. Keep any client compatibility migration explicit; do not silently attempt to infer a ContentBlock from the stored user-controlled string.

The wire layer still uses standard MCP `content: [{type:"text",text:JSON.stringify(value)}]`. Only the JSON data _inside_ the text block is enveloped.

## Release verification
1. Node TypeScript typecheck, build and unit tests pass.
2. Real child-process stdio MCP round-trip: add / list / get / delete; ensure no top-level JSON `content` property and verify `record.id`, `record.kind`, `record.content`.
3. Full real OAuth HTTP MCP round-trip with a principal-scoped DB; assert matching principal and no cross-principal leak.
4. The signed-off Windows CI installer must include exactly this change.
5. **After installation**, retry the affected ChatGPT HooshiX connector directly. Add a non-sensitive temporary record, verify `memory_get` returns `{record:{...}}` instead of `{}`, then delete it.
6. Keep issue #24 open until step 5 succeeds. If it still returns `{}`, investigate the connected provider's response adapter, not the SQLite principal filter.