# PhD Application Tracker

A private dashboard for tracking PhD applications, plus a personal space for each recommender.

**Your dashboard** (`index.html`)
- Deadline countdown, timeline, and a "needs attention" list
- Programs with country, deadline, portal, and a checklist colored by importance: red = required, amber = recommended, blue = optional, green = done
- Filter programs by country
- Assign recommenders to specific schools and track each letter
- Add or remove recommenders anytime; each one gets a private link
- Polite reminder emails drafted for you, including their link
- Saved links, and a profile with the materials recommenders can open

**Recommender space** (`recommender.html?k=…`)
- Shows only that person's schools, countries and deadlines
- They tap "I have the upload link" and "Mark as submitted"; you see it instantly
- You can still change any status yourself if they forget
- No account needed. Your notes, other recommenders and other data stay hidden.

---

## Setup (about 15 minutes, free)

### 1. Create the Firebase project
1. Go to https://console.firebase.google.com and click **Add project**. Any name works, e.g. `phd-tracker`. You can turn off Google Analytics.
2. In the left menu: **Build → Firestore Database → Create database**. Choose a location close to you, start in **production mode**.
3. **Build → Authentication → Get started → Google → Enable**, then save.
4. **Project settings (gear icon) → Your apps → Web (`</>`)**. Register the app (no hosting needed). Copy the values shown into `js/firebase-config.js`: `apiKey`, `authDomain`, `projectId`, `appId`.

### 2. Put the site on GitHub Pages
1. Create a repository on GitHub, e.g. `phd-applications-2027`, and upload all these files (keep the folders).
2. **Settings → Pages → Build and deployment → Deploy from a branch → `main` / root → Save.**
3. After a minute your site is at `https://honaminto.github.io/phd-applications-2027/`.
4. Back in Firebase: **Authentication → Settings → Authorized domains → Add domain** → `honaminto.github.io`.

> On a free GitHub plan the repository must be public for Pages to work. That is fine here: the code contains no personal data. Everything personal lives in Firebase, locked by the rules below. If you have GitHub Pro (free with the GitHub Student Developer Pack), you can make the repo private.

### 3. Lock the data to you
1. Open your site and **Sign in with Google**. The page shows your user ID.
2. Paste that ID into `js/firebase-config.js` (`OWNER_UID`) and commit.
3. In Firebase: **Firestore Database → Rules**. Replace everything with the contents of `firestore.rules`, put your user ID where it says `PASTE_YOUR_USER_ID`, and click **Publish**.
4. Reload the site. You're in.

### 4. Daily use
- Add programs on the **Programs** tab, recommenders on the **Recommenders** tab.
- Fill in the **Profile** tab so recommenders see your name and materials.
- To share with a recommender: **Recommenders → Copy link**, or use **Draft reminder email**, which already includes it.

## Privacy notes
- Each recommender link contains a long random code. Anyone with the link can open that one page, so send it only to that person.
- To revoke a link, remove the recommender and add them again. They get a new link and the old one stops working.
- Search engines are asked not to index these pages.

## Files
```
index.html            your dashboard
recommender.html      the recommender space
css/style.css         shared design (light and dark mode)
js/firebase-config.js your Firebase settings
js/common.js          shared helpers
js/app.js             dashboard logic
js/recommender.js     recommender logic
firestore.rules       database security rules
```
