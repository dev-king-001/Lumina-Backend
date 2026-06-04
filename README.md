# Lumina Network Backend & Contracts

This repository contains the Lumina Network ecosystem, including the Node.js backend API and the Soroban Rust smart contracts.

## Project Structure

- `/backend`: Node.js Express API for managing vesting schedules, claims, and providing off-chain analytics.
- `/contracts`: Soroban (Rust) smart contracts for on-chain vesting enforcement.
- `/docs`: Detailed implementation summaries, architecture guides, and API documentation.
- `/kubernetes`: K8s deployment manifests for scalable infrastructure.
- `/scripts`: Utility scripts for deployment, backups, and maintenance.

## Getting Started

### Smart Contracts (Rust)
Navigate to the `contracts` directory:
```bash
cd contracts
cargo test
```

### Backend (Node.js)
Navigate to the `backend` directory:
```bash
cd backend
npm install
npm start
```
See `docs/RUN_LOCALLY.md` for detailed setup instructions.

### Windows Setup Note
If you are developing on Windows, ensure that **Node.js** and **Cargo** bin directories are in your System PATH:
- **Node.js:** `C:\Program Files\nodejs\`
- **Cargo:** `%USERPROFILE%\.cargo\bin`

This allows you to run `npm` and `stellar` from any terminal. If compilation fails, ensure the **"Desktop development with C++"** workload is installed in Visual Studio.

## Documentation Highlights
- [Architecture Overview](docs/ARCHITECTURE.md)
- [API Reference](backend/API_DOCUMENTATION.md)
- [Historical Price Tracking](docs/summaries/HISTORICAL_PRICE_TRACKING.md)
- [Multi-Sig Revocation](docs/summaries/MULTI_SIG_REVOCATION_SYSTEM.md)

## License
MIT