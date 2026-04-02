# Tic-Tac-Toe Nakama Backend

This provides the server-authoritative multiplayer logic and matchmaking for the Tic-Tac-Toe game using [Nakama](https://heroiclabs.com/nakama/). The backend is written in TypeScript and runs securely via Nakama's JS/Goja runtime.

## Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) or Docker Engine & Docker Compose
- [Node.js](https://nodejs.org/) (v16+ recommended for compiling TypeScript)
- npm (comes with Node.js)

## Project Structure

- `src/index.ts`: The main entry point containing the game logic, match loop, and matchmaking hooks.
- `docker-compose.yml`: Local Docker setup containing Nakama Server and CockroachDB/PostgreSQL.
- `tsconfig.json` & `package.json`: TypeScript configuration for the build process.

## Getting Started

### 1. Install Dependencies

You'll need to install the TypeScript dependencies for the compiler and Nakama runtime typings:

```bash
cd backend
npm install
```

### 2. Build the TypeScript Module

Compile the `src/index.ts` code into vanilla JavaScript that Nakama can evaluate:

```bash
npm run build
```
*Note: This will generate `build/index.js`.*

### 3. Start the Server

Ensure Docker is running on your machine, then spin up the Nakama and Database containers:

```bash
docker-compose up -d
```

### 4. Stopping / Resetting the Server

To stop the containers:
```bash
docker-compose down
```

To fully reset the database and data (useful for wiping leaderboards or accounts):
```bash
docker-compose down -v
```
## Making Changes to Game Logic

If you modify elements in `src/index.ts` (e.g., game rules, match handling):
1. Run `npm run build` again.
2. Restart the Nakama container to pick up the new JS module: `docker-compose restart nakama`.
