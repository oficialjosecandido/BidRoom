# How to Run BidRoom on Your Computer

This guide explains how to open and run the BidRoom app on your own machine so you can use it in your browser. No coding experience needed—just follow the steps in order.

---

## What You Need First

Before starting, you need these installed on your computer:

1. **Node.js**  
   This is the program that runs both the website (frontend) and the server (backend).  
   - Download it from: [https://nodejs.org](https://nodejs.org)  
   - Choose the **LTS** version (recommended).  
   - Run the installer and follow the instructions.  
   - When it’s done, you can check it worked by opening **Terminal** (Mac) or **Command Prompt** (Windows) and typing:  
     `node --version`  
   You should see a version number (for example `v20.x.x`).

2. **The BidRoom project**  
   - Either **download** the project folder (e.g. as a ZIP) and unzip it, or  
   - If you use **Git**, open Terminal/Command Prompt, go to the folder where you want the project, and run:  
     `git clone <repository-url>`  
   (Replace `<repository-url>` with the actual link to the BidRoom repository.)

3. **Backend configuration (one-time setup)**  
   The server needs a few settings (database, etc.). Someone technical may need to prepare this once:
   - In the project folder, go into the **backend** folder.
   - Copy the file **env.development.example** (if present) and rename the copy to **.env**, or create **.env** with the required variables.
   - Edit **.env** and fill in the real values (MongoDB address, email settings, etc.).  
   If you’re not sure what to put, ask the person who set up the project or your team’s developer.  
   **Email (optional):** To have the app send emails (verification, bid notifications, etc.) in development, see **[Email setup for dev](EMAIL-SETUP-DEV.md)**.

---

## Running the Project

BidRoom has two parts that must both be running:

1. **Backend** (the server that handles data and logic)  
2. **Frontend** (the website you see in the browser)

You can start them in two ways.

---

### Option A: Start Backend and Frontend Separately (good for first time)

**Step 1 – Start the backend**

1. Open **Terminal** (Mac) or **Command Prompt** (Windows).
2. Go to the project folder, then into **backend**:
   - Mac/Linux:  
     `cd path/to/BidRoom/backend`  
   - Windows:  
     `cd path\to\BidRoom\backend`  
   (Replace `path/to/BidRoom` or `path\to\BidRoom` with the real path to your BidRoom folder.)
3. Install backend dependencies (only needed the first time or after an update):  
   `npm install`
4. Start the backend:  
   `npm run dev`  
   When it’s running, you’ll see a message like “Server is running on port 3000”. **Leave this window open.**

**Step 2 – Start the frontend**

1. Open a **new** Terminal/Command Prompt window.
2. Go to the project folder, then into **frontend**:
   - Mac/Linux:  
     `cd path/to/BidRoom/frontend`  
   - Windows:  
     `cd path\to\BidRoom\frontend`
3. Install frontend dependencies (only needed the first time or after an update):  
   `npm install`
4. Start the frontend:  
   `npm start`  
   When it’s ready, the app will usually open in your browser at **http://localhost:4200**. If it doesn’t, open your browser and go to that address.

**Step 3 – Use the app**

- Use the site at **http://localhost:4200**.
- Keep both Terminal/Command Prompt windows open while you use BidRoom. Closing them will stop the backend or frontend.

---

### Option B: Start Both with One Script (Mac/Linux only)

If you’re on **Mac or Linux** and the project already has a startup script:

1. Open **Terminal**.
2. Go to the **BidRoom** project folder (not inside `backend` or `frontend`):  
   `cd path/to/BidRoom`
3. Run:  
   `./start-dev.sh`  
   (If you get a “permission denied” message, try first:  
   `chmod +x start-dev.sh`  
   then run `./start-dev.sh` again.)
4. When both servers have started, open your browser and go to **http://localhost:4200**.

To stop everything, press **Ctrl+C** in the Terminal window where you ran the script.

---

## Quick Reference

| What              | Address / Command        |
|-------------------|--------------------------|
| Website (use this)| http://localhost:4200    |
| Backend API       | http://localhost:3000    |
| Start backend     | `cd backend` → `npm run dev` |
| Start frontend    | `cd frontend` → `npm start`  |

---

## If Something Goes Wrong

- **“command not found: node” or “npm”**  
  Node.js is not installed or not in your PATH. Install Node.js from [nodejs.org](https://nodejs.org) and, if needed, restart Terminal/Command Prompt.

- **“Cannot find module” or “dependency” errors**  
  Run `npm install` again in the folder where you see the error (`backend` or `frontend`).

- **Backend won’t start / “Database connection failed”**  
  Check that the **.env** file exists in the **backend** folder and that values like `MONGO_URI` are correct. Someone technical may need to set these.

- **Emails not sending in dev**  
  See **[Email setup for dev](EMAIL-SETUP-DEV.md)**. You need either Gmail (with an App Password) or Ethereal credentials in `backend/.env`. Check that `EMAIL_FROM` matches your sending address (no typos).

- **Frontend shows errors or “cannot connect”**  
  Make sure the **backend** is running first (Option A, Step 1). The frontend talks to the backend at http://localhost:3000.

- **Port already in use**  
  Another program is using port 3000 or 4200. Close other apps that might use those ports, or ask a developer to change the port in the configuration.

---

## Summary

1. Install **Node.js** and get the **BidRoom** project on your computer.  
2. In **backend**, copy **env.development.example** to **.env** and fill in the values (get help if needed).  
3. Start the **backend** (`cd backend` → `npm run dev`).  
4. In a new window, start the **frontend** (`cd frontend` → `npm start`).  
5. Open **http://localhost:4200** in your browser to use BidRoom.

If you’re on Mac/Linux, you can use **Option B** and run `./start-dev.sh` from the project folder to start both parts at once.
