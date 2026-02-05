# Frontend Architecture (High-Level)

This frontend is a React + TypeScript control surface organized around two main domains:

- `logical`: labels, groups, and moods (intent model)
- `live`: real-time LED state polling + per-endpoint updates (transport model)

The top-level container is `LogicalWorkspace`, which composes these domains into one UI.

## 1) Component Layout

```mermaid
flowchart TD
  App["App.tsx"] --> LogicalWorkspace["LogicalWorkspace.tsx"]

  LogicalWorkspace --> Header["WorkspaceHeaderSection"]
  LogicalWorkspace --> Labels["LabelMatrixSection"]
  LogicalWorkspace --> Live["LiveLedControlSection"]
  LogicalWorkspace --> Groups["GroupsSection"]
  LogicalWorkspace --> Moods["MoodStudioSection"]

  Live --> Health["DeviceHealthStrip"]
  Live --> GroupedEndpoints["LogicalEndpointSections"]
  GroupedEndpoints --> EndpointControl["LedEndpointControl (per endpoint)"]
```

## 2) State and Data Boundaries

```mermaid
flowchart LR
  UI["React Components"] --> LW["useLogicalWorkspace"]
  UI --> LT["useLiveLedTransport"]

  LW --> API["api.ts"]
  LT --> API
  LT --> Poll["useStaggeredDevicePolling"]

  API --> Backend["/api server + device HTTP endpoints"]
```

## 3) Runtime Flow (Live Control)

```mermaid
sequenceDiagram
  participant User
  participant UI as LiveLedControlSection / LedEndpointControl
  participant LT as useLiveLedTransport
  participant API as api.ts
  participant Device as Device Endpoint

  User->>UI: Change brightness/timing/PIR mask
  UI->>LT: updateEndpointDraft(endpointId, patch)
  LT->>LT: Queue + debounce per device
  LT->>API: setLedConfig(deviceUri, ledIndex, diff)
  API->>Device: POST /config/led
  LT->>API: fetchDeviceSnapshot(deviceUri)
  API->>Device: GET /combined.bin + /combined.schema
  LT-->>UI: Update snapshot, draft, dirty/pending, health
```

## 4) Runtime Flow (Logical Data + Mood Apply)

```mermaid
sequenceDiagram
  participant User
  participant UI as GroupsSection / MoodStudioSection
  participant LW as useLogicalWorkspace
  participant API as api.ts
  participant Server as FastAPI /api
  participant Device as Device Endpoint

  User->>UI: Create/Delete group
  UI->>LW: createGroup/deleteGroup
  LW->>API: POST/DELETE /api/groups
  API->>Server: Persist group JSON
  Server-->>API: Group result
  API-->>LW: Parsed response
  LW-->>UI: Updated groups state

  User->>UI: Apply mood (optional group scope)
  UI->>LW: applyMood(name, groupId)
  LW->>API: POST /api/mood-configs/{name}/apply
  API->>Server: Apply orchestration by labels/group
  Server->>Device: POST /config/led (fan-out writes)
  Server-->>API: Apply report
  API-->>LW: successCount/failureCount/failures
  LW-->>UI: Status + report
```

## Notes

- `useLogicalWorkspace` is the orchestration layer for discovery, labels, groups, and moods.
- `useLiveLedTransport` is the transport/state-sync layer for low-latency LED control.
- `api.ts` is the only frontend HTTP boundary and handles payload parsing/validation.
- Browser `localStorage` is no longer used for logical groups.
- Groups are persisted server-side via `/api/groups`.
- Mood apply orchestration is server-side via `/api/mood-configs/{name}/apply`.
- Live interactive per-LED writes still go directly from frontend to device endpoints for low-latency control.
