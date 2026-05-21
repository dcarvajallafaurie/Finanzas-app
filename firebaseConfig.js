import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyBJfJkR6GKG0oJeUl6B3OR46kA5h9gFqCI",
  authDomain: "finance-casa.firebaseapp.com",
  projectId: "finance-casa",
  storageBucket: "finance-casa.firebasestorage.app",
  messagingSenderId: "482815043136",
  appId: "1:482815043136:web:ab8687fb6016de975b61a5",
  measurementId: "G-KR3T811JRL"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

export { auth };