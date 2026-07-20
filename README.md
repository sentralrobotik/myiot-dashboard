# MyIoT Dashboard

Dashboard IoT custom berbasis Firebase untuk monitoring sensor & kontrol aktuator (relay/switch) dari ESP32 atau ESP8266.

```
[ESP32/ESP8266] <--internet--> [Firebase Realtime Database] <--internet--> [Dashboard Web]
```

## Fitur
- Data sensor real-time (gauge, label, chart)
- Kontrol aktuator dua arah (switch/slider/tombol → relay fisik)
- Status online/offline otomatis (heartbeat)
- Setup & ganti Wi-Fi tanpa hardcode di kode — via captive portal (setup awal) atau remote dari dashboard (setelah online)
- Multi-device, multi-template, akun per user

## Struktur Folder
```
frontend/                  # Dashboard web (HTML/JS/CSS), di-deploy ke Firebase Hosting
firebase.json              # Config deploy Firebase
database.rules.json        # Security rules Realtime Database
MyIoT-arduino-library/     # Library Arduino (ESP32 & ESP8266)
```

---

## 1. Setup Web (Firebase)

1. Buat project di [Firebase Console](https://console.firebase.google.com) → **Add project**
2. **Authentication → Sign-in method** → aktifkan **Email/Password** dan **Anonymous**
3. **Realtime Database → Create Database** → mode **Locked**
4. **Project Settings → Your apps → Web (`</>`)** → salin `firebaseConfig`
5. Isi config itu ke `frontend/firebase-config.js`, dan `projectId`-nya ke `.firebaserc`
6. Deploy:
   ```bash
   npm install -g firebase-tools
   firebase login
   firebase deploy --only database,hosting
   ```
7. Dapat **Hosting URL** (`https://nama-project.web.app`) → daftar akun di situ, buat **Template** (datastream + virtual pin, misal V0/V1/V2), lalu buat **Device**.

## 2. Hubungkan ke Mikrokontroler

**Board didukung:** ESP32, ESP8266 (auto-detect, satu kode untuk keduanya)

1. Install library di Arduino IDE: **ArduinoJson** (Library Manager) + `MyIoT-arduino-library` (copy manual ke folder `libraries`, rename jadi `MyIoT`)
2. Install board package: **esp32 by Espressif** dan/atau **esp8266 by ESP8266 Community** lewat Boards Manager
3. Sketch minimal:
   ```cpp
   #include <MyIoT.h>

   #define FIREBASE_API_KEY "isi_dari_firebaseConfig"
   #define FIREBASE_HOST    "https://xxx-default-rtdb.region.firebasedatabase.app"

   void onDashboardWrite(int pin, float value) {
     if (pin == 2) digitalWrite(RELAY_PIN, value ? HIGH : LOW);
   }

   void setup() {
     Serial.begin(115200);
     MyIoT.begin(FIREBASE_API_KEY, FIREBASE_HOST);
     MyIoT.onVirtualWrite(onDashboardWrite);
   }

   void loop() {
     MyIoT.run();                    // wajib — proses heartbeat & command
     MyIoT.virtualWrite(0, suhu);    // kirim data ke pin virtual V0
     delay(5000);
   }
   ```
4. Upload, pilih board & port yang sesuai di **Tools**

## 3. Set Wi-Fi

**Pertama kali (device belum pernah online):**
1. Buka Serial Monitor (baud `115200`) → device otomatis jadi hotspot `MyIoT-Setup-xxxx`
2. Sambungkan HP ke hotspot itu → captive portal terbuka otomatis (atau buka `http://192.168.4.1` manual)
3. Isi SSID + password Wi-Fi rumah → **Simpan & Sambungkan**
4. Catat **Device ID** yang muncul di Serial Monitor

**Ganti Wi-Fi nanti (device sudah online):**
- Dashboard → device → **Atur Wi-Fi** → isi SSID/password baru → terkirim ke device dalam beberapa detik (device harus masih online)

## 4. Hubungkan Device Fisik ke Akun

Dashboard → tab **Device** → **+** → isi nama, pilih template, tempel **Device ID** dari Serial Monitor → **Buat Device**

---

## Library API

| Fungsi | Kegunaan |
|---|---|
| `MyIoT.begin(apiKey, host)` | Inisialisasi, wajib dipanggil di `setup()` |
| `MyIoT.run()` | Wajib dipanggil tiap `loop()` — proses heartbeat & command masuk |
| `MyIoT.virtualWrite(pin, value)` | Kirim data sensor ke pin virtual |
| `MyIoT.virtualRead(pin)` | Baca nilai terakhir dari pin virtual |
| `MyIoT.onVirtualWrite(handler)` | Callback saat dashboard kirim perintah (switch/slider/tombol) |
| `MyIoT.getDeviceId()` | Ambil Device ID (uid) untuk link ke dashboard |
| `MyIoT.resetWifi()` | Hapus kredensial Wi-Fi tersimpan, paksa buka portal setup lagi |

## Troubleshooting Singkat

- **Port tidak muncul** → cek kabel USB data (bukan kabel cas), install driver CH340/CP2102
- **Sensor `nan`** → cek wiring & tipe sensor di kode
- **Device tidak online** → cek `FIREBASE_API_KEY`/`FIREBASE_HOST` sudah benar
- **Relay tidak merespon** → tunggu ±5 detik (siklus polling), cek pin di `onDashboardWrite` cocok dengan datastream

---

Lisensi: bebas dipakai & dimodifikasi untuk keperluan pribadi/edukasi.
