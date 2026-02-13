# LAN Port Scanner

A local LAN port scanner with a Web UI, built with Node.js, Express, Socket.IO, and Electron.

## Features
- Scans local network for active hosts.
- Checks common ports (80, 443, 22, etc.).
- Real-time progress updates via Socket.IO.
- Cross-platform desktop application (Windows, macOS, Linux).

## Build & Release

This project uses GitHub Actions to automatically build and release the application for Windows, macOS, and Linux.

### Creating a Release

To trigger a new release build:

1.  Commit your changes.
2.  Create a git tag starting with `v` (e.g., `v1.0.0`).
3.  Push the tag to GitHub.

```bash
git tag v1.0.0
git push origin v1.0.0
```

GitHub Actions will automatically:
1.  Build the application for Windows (`.exe`), macOS (`.dmg`), and Linux (`.AppImage`).
2.  Create a GitHub Release.
3.  Upload the executable files to the release.

### Manual Build

You can also trigger a build manually from the "Actions" tab on GitHub by selecting the "Build/Release" workflow and clicking "Run workflow".

## Local Development

1.  Install dependencies:
    ```bash
    npm install
    ```

2.  Start the application (Electron + Server):
    ```bash
    npm start
    ```

## Note on PakePlus

While **PakePlus** is a great tool for wrapping web pages, this application requires a full **Node.js runtime** to perform network scanning (using the `net` and `os` modules). Therefore, we use **Electron** which includes Node.js, ensuring the backend logic works correctly in the offline executable.
