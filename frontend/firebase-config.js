// Ganti seluruh isi objek ini dengan config dari:
// Firebase Console > Project Settings > General > Your apps > SDK setup and configuration
const firebaseConfig = {
  apiKey: "AIzaSyCexrk4wcs_lRUpNJM0_bHuIGJNBjto0fY",
  authDomain: "myiot-dashboard.firebaseapp.com",
  databaseURL: "https://myiot-dashboard-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "myiot-dashboard",
  storageBucket: "myiot-dashboard.firebasestorage.app",
  messagingSenderId: "649580691201",
  appId: "1:649580691201:web:5849a7f9d97473204f2500"
};

firebase.initializeApp(firebaseConfig);

// Dipakai langsung oleh app.js (script biasa, bukan module)
window.fbAuth = firebase.auth();
window.fbDb = firebase.database();
