# PIR LED Controller - React Frontend

React + TypeScript + Tailwind frontend for the PIR LED controller system.

## Development

```bash
bash dev.sh
```

Starts both the API server (port 8000) and React dev server (port 5173) with hot reload.

## Tech Stack

- **React 18** - UI framework
- **TypeScript** - Type safety
- **Vite** - Fast build tool
- **Tailwind CSS** - Styling
- **Fetch API** - HTTP client

## Architecture

The app communicates with the backend API for device discovery, configuration, and config persistence. Each React component has a single responsibility:

- Device selection and polling
- LED configuration interface
- Mood config CRUD operations

See individual `.tsx` files for implementation details.
