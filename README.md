# Logic App Run Resubmitter

A cross-platform desktop application for browsing and resubmitting **Azure Logic App Standard** (stateful) workflow runs. Built with Electron, React, and TypeScript.

![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)

## Features

- **Azure sign-in** — Interactive browser authentication, no app registration required
- **Resource browser** — Cascading dropdowns for Subscription → Resource Group → Logic App → Workflow
- **Run search** — Filter workflow runs by date range and status (Failed, Succeeded, Cancelled, etc.)
- **Manual input** — Paste specific run IDs to resubmit
- **Batch resubmit** — Select multiple runs and resubmit them with a single click
- **Progress tracking** — Real-time progress bar and per-run status during resubmission
- **Retry logic** — Automatic retry with exponential backoff for rate-limited (429) requests
- **Cross-platform** — Runs on Windows, macOS, and Linux; packages as a native executable

## Prerequisites

- **Node.js 20+** and **npm**
- An **Azure subscription** with Logic App Standard resources
- Appropriate Azure RBAC permissions:
  - `Logic App Contributor` or `Contributor` on the Logic App resource
  - Or a custom role with: `Microsoft.Web/sites/read`, `Microsoft.Web/sites/hostruntime/*`, `Microsoft.Logic/workflows/runs/read`, `Microsoft.Logic/workflows/triggers/run/action`

## Getting Started

### Install dependencies

```bash
npm install
```

### Run in development mode

```bash
npm run dev
```

This starts the Electron app with hot-reload for the renderer (React UI).

### Build for production

```bash
npm run build
```

### Package as executable

```bash
# All platforms (builds for current OS)
npm run package

# Platform-specific
npm run package:win
npm run package:mac
npm run package:linux
```

Packaged binaries are output to the `dist/` directory.

## Authentication

The app uses `InteractiveBrowserCredential` from `@azure/identity`. When you click **"Sign in with Azure"**, your system browser opens the Microsoft login page. After you authenticate, the token is used for all subsequent Azure Management API calls.

- No Azure AD app registration is required
- Optionally provide a **Tenant ID** if you want to target a specific directory
- Tokens are kept in memory only — you'll sign in again each time you open the app

## How It Works

1. **Sign in** to Azure using your browser
2. **Select** your Subscription → Resource Group → Logic App → Workflow
3. **Search** for runs using a date/time range and optional status filter
4. **Select** the runs you want to resubmit (or switch to Manual Input and paste run IDs)
5. **Click "Resubmit"** — the app resubmits each run via the Azure Management API with retry handling

Under the hood, the app calls the Logic Apps Standard host runtime API:

```
POST /subscriptions/{sub}/resourceGroups/{rg}/providers/Microsoft.Web/sites/{app}
     /hostruntime/runtime/webhooks/workflow/api/management/workflows/{workflow}
     /triggers/{trigger}/histories/{runId}/resubmit?api-version=2018-11-01
```

## Project Structure

```
src/
├── main/                  # Electron main process
│   ├── index.ts           # App lifecycle, window creation, IPC handlers
│   └── azure-service.ts   # Azure auth & REST API calls
├── preload/
│   └── index.ts           # Secure IPC bridge (contextBridge)
└── renderer/              # React UI
    ├── index.html
    └── src/
        ├── main.tsx
        ├── App.tsx
        ├── styles.css
        ├── types.ts
        └── components/
            ├── LoginScreen.tsx
            ├── ResourceSelector.tsx
            ├── RunExplorer.tsx
            └── StatusBadge.tsx
```

## Tech Stack

| Layer | Technology |
|-------|------------|
| Desktop shell | [Electron](https://www.electronjs.org/) |
| UI framework | [React 18](https://react.dev/) |
| Language | [TypeScript](https://www.typescriptlang.org/) |
| Build tool | [electron-vite](https://electron-vite.org/) |
| Azure auth | [@azure/identity](https://www.npmjs.com/package/@azure/identity) |
| Packaging | [electron-builder](https://www.electron.build/) |

## Contributing

Contributions are welcome! Please open an issue or pull request.

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/my-feature`)
3. Commit your changes (`git commit -am 'Add my feature'`)
4. Push to the branch (`git push origin feature/my-feature`)
5. Open a Pull Request

## License

[MIT](LICENSE)
