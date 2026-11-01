# LocalHire 🚀

## Empowering Local Employment Through Smart Hiring

LocalHire is a smart hiring platform designed to connect local job seekers with nearby employers quickly and efficiently. Our goal is to simplify the recruitment process for both candidates and recruiters by using location-based job matching, easy application tracking, and a user-friendly interface.

This project helps reduce unemployment gaps by making local opportunities more accessible and visible to everyone.

---

## 🌟 Features

- 🔍 Location-based job search
- 👤 Job seeker profile creation
- 🏢 Employer job posting dashboard
- 📄 Resume upload and management
- 📌 Job application tracking
- 🤖 Smart job recommendations
- 📊 Admin monitoring and management
- 📱 Responsive and simple UI

---

## 🛠️ Tech Stack

### Frontend
- HTML
- CSS
- JavaScript
- React.js (if used)

### Backend
- Node.js
- Express.js

### Database
- MongoDB / Firebase (update based on your project)

### Other Tools
- Git & GitHub
- VS Code
- APIs for job/location services

---

## 🎯 Problem Statement

Many job seekers struggle to find opportunities near their location, while small businesses often find it difficult to hire local talent efficiently.

LocalHire solves this by creating a bridge between employers and candidates within the same area, making hiring faster, smarter, and more accessible.

---

## 🚀 How It Works

1. Users create their profile
2. Employers post available jobs
3. Job seekers search jobs based on location and skills
4. Candidates apply directly through the platform
5. Employers review applications and shortlist candidates
6. Hiring becomes faster and more localized

---

## 📸 Project Preview

(Add screenshots of your project here)

Example:

![Home Page Screenshot](your-image-link-here)

---

## 📂 Installation & Running

```bash
git clone https://github.com/amraqureshi/localhire.git
cd LOCALHIRE_MAIN-main
npm install
npm --prefix server install
npm run dev
```

The entire application (backend API, WebSocket server, and static frontend) runs on port **5000** (`http://localhost:5000`).

---

## 🛡️ Admin Account Setup & Governance

For security reasons, **public registration does not allow registering with an Admin role** (`authController` strictly blocks unprivileged role escalation).

To bootstrap an Administrator account, configure `ADMIN_EMAIL` and `ADMIN_PASSWORD` in `server/.env`:

```env
ADMIN_EMAIL=admin@localhire.dev
ADMIN_PASSWORD=YourSecurePassword123!
```

Then execute the database seed script:

```bash
npm --prefix server run prisma:seed
```

This creates or updates the administrative user in the PostgreSQL database. You can then log in at `http://localhost:5000/pages/auth.html` using the configured credentials and access the **Admin Governance Console** at `http://localhost:5000/pages/admin.html`.

