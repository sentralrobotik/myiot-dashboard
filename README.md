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
firebase.json               # Config deploy Firebase
database.rules.json         # Security rules Realtime Database
library/MyIoT/               # Library Arduino (ESP32 & ESP8266)
```

---

## 1. Cara Membuat Template & Device (di Dashboard Web)

**Template** = "cetakan" yang menentukan datastream (data apa saja yang dikirim/diterima) dan widget (tampilan di dashboard) untuk satu jenis alat. **Device** = alat fisik yang memakai template tersebut.

1. Login ke dashboard web → buka tab **Template** → tekan **+ Buat Template**
2. Beri nama template (misal: "Lampu Kamar") dan pilih ikon
3. Tambahkan **Datastream** — ini "kanal data" antara ESP dan dashboard:
   | Kolom | Contoh isi |
   |---|---|
   | Nama | Lampu |
   | Pin virtual | V2 |
   | Tipe | Boolean (untuk ON/OFF), Integer/Double (untuk angka), String (untuk teks) |
   | Min / Max | 0 / 1 (kalau Boolean atau persentase) |
   | Unit | °C, %, dll (opsional) |
4. Tambahkan **Widget** — tampilan visual di dashboard untuk datastream itu. Widget yang tersedia:

   | Widget | Cocok untuk tipe data | Kegunaan |
   |---|---|---|
   | 🌡️ Gauge | Integer, Double | Tampilan meter/jarum untuk angka (suhu, kelembaban) |
   | 🔢 Label Nilai | Integer, Double, String | Menampilkan angka/teks polos |
   | 📈 Grafik (Chart) | Integer, Double | Riwayat data dari waktu ke waktu |
   | 🎚️ Slider | Integer, Double | Kirim angka dari dashboard ke ESP (misal atur kecepatan motor) |
   | 🔀 Switch | Boolean | Tombol ON/OFF (misal nyalakan lampu/relay) |
   | 🔘 Tombol Push | Boolean | Kirim sinyal sesaat (misal buka pintu 1 detik) |
   | 💡 LED | Boolean | Indikator visual ON/OFF (tidak mengirim perintah, hanya tampilan) |

5. Simpan template
6. Buka tab **Device** → **+ Buat Device** → beri nama, pilih template yang dibuat tadi
7. Nanti setelah ESP menyala dan tersambung Wi-Fi, salin **Device ID** dari Serial Monitor ke sini untuk menghubungkan alat fisik ke akun dashboard

---

## 2. Cara Download & Install Library

1. Download folder `library/MyIoT` dari project ini
2. Salin folder tersebut ke folder `libraries` Arduino IDE kamu:
   - Windows: `Documents/Arduino/libraries/`
   - Mac: `~/Documents/Arduino/libraries/`
   - Linux: `~/Arduino/libraries/`
3. Pastikan nama foldernya jadi `MyIoT` (bukan `MyIoT-main` atau nama zip lainnya)
4. Buka **Arduino IDE** → **Tools → Manage Libraries** → cari **ArduinoJson** → install (dependency yang dibutuhkan MyIoT)
5. Install board package sesuai alat kamu, lewat **Tools → Board → Boards Manager**:
   - **esp32 by Espressif Systems** (kalau pakai ESP32)
   - **esp8266 by ESP8266 Community** (kalau pakai ESP8266/NodeMCU)
6. Restart Arduino IDE → cek **Sketch → Include Library** → `MyIoT` harus sudah muncul di daftar

---

## 3. Cara Menghubungkan Hardware ke Wi-Fi

Wi-Fi **tidak** ditulis manual di kode — diatur langsung dari alatnya lewat portal setup.

**Pertama kali (device belum pernah online):**
1. Upload sketch ke ESP, lalu buka **Serial Monitor** (baud rate `115200`)
2. Device otomatis membuka hotspot sendiri bernama `MyIoT-Setup-xxxx`
3. Di HP, sambungkan Wi-Fi ke hotspot tersebut
4. Halaman setup biasanya terbuka otomatis (captive portal). Kalau tidak, buka browser dan akses `http://192.168.4.1`
5. Isi nama Wi-Fi (SSID) dan password Wi-Fi rumah/sekolah → tekan **Simpan & Sambungkan**
6. Tunggu beberapa detik — Serial Monitor akan menampilkan **Device ID**. Catat ini untuk dihubungkan ke dashboard

**Kalau mau ganti Wi-Fi nanti (device sudah pernah online):**
- Lewat dashboard: buka device → **Atur Wi-Fi** → isi SSID/password baru → device akan menerima & pindah Wi-Fi dalam beberapa detik (device harus online dulu)
- Atau reset manual: panggil `MyIoT.resetWifi();` di kode, upload, lalu ulangi langkah "pertama kali" di atas

---

## 4. Cara Menggunakan Kode

### Struktur dasar sketch

```cpp
#include <MyIoT.h>

#define LAMPU_PIN 5  // pin fisik yang terhubung ke relay/aktuator

// Dipanggil otomatis tiap kali widget kontrol (switch/slider/tombol) di dashboard ditekan
void onDashboardWrite(int pin, float value) {
  if (pin == 2) {                              // pin virtual sesuai datastream di template
    digitalWrite(LAMPU_PIN, value ? HIGH : LOW);
  }
}

void setup() {
  Serial.begin(115200);
  pinMode(LAMPU_PIN, OUTPUT);

  MyIoT.begin();                        // pakai kredensial default dari library
  MyIoT.onVirtualWrite(onDashboardWrite); // daftarkan handler kontrol
}

void loop() {
  MyIoT.run();  // wajib — proses heartbeat & cek perintah baru dari dashboard
}
```

### Daftar fungsi library

| Fungsi | Kegunaan |
|---|---|
| `MyIoT.begin()` | Inisialisasi pakai kredensial default library. Wajib dipanggil di `setup()` |
| `MyIoT.begin(apiKey, host)` | Inisialisasi pakai project Firebase sendiri (kalau tidak mau pakai yang default) |
| `MyIoT.run()` | Wajib dipanggil tiap `loop()` — mengecek perintah masuk & mengirim heartbeat |
| `MyIoT.virtualWrite(pin, value)` | Kirim data dari ESP ke dashboard (dipakai untuk widget **Gauge**, **Label Nilai**, **Grafik**) |
| `MyIoT.virtualRead(pin)` | Baca nilai terakhir yang tersimpan di pin virtual tertentu |
| `MyIoT.onVirtualWrite(handler)` | Daftarkan fungsi yang dipanggil saat dashboard kirim perintah (dipakai untuk **Switch**, **Slider**, **Tombol Push**) |
| `MyIoT.getDeviceId()` | Ambil Device ID (uid) untuk ditempel ke dashboard |
| `MyIoT.resetWifi()` | Hapus Wi-Fi tersimpan, paksa buka portal setup lagi |

### Cara pakai per jenis widget

**Switch / Tombol Push** (dashboard → ESP, mengontrol sesuatu):
Widget ini mengirim perintah lewat `onVirtualWrite`. Cek nomor pin virtualnya, lalu jalankan aksi fisik:
```cpp
void onDashboardWrite(int pin, float value) {
  if (pin == 2) {                          // switch "Lampu" di pin V2
    digitalWrite(LAMPU_PIN, value ? HIGH : LOW);
  }
  if (pin == 3) {                          // tombol push "Buka Pintu" di pin V3
    if (value) {
      digitalWrite(PINTU_PIN, HIGH);
      delay(1000);
      digitalWrite(PINTU_PIN, LOW);
    }
  }
}
```

**Gauge / Label Nilai / Grafik** (ESP → dashboard, menampilkan data sensor):
Widget ini menampilkan data yang dikirim lewat `virtualWrite`. Kirim tiap beberapa detik di `loop()`:
```cpp
void loop() {
  MyIoT.run();

  float suhu = dht.readTemperature();     // baca sensor asli
  MyIoT.virtualWrite(0, suhu);            // kirim ke pin V0 -> tampil di widget Gauge/Grafik "Suhu"

  int kelembaban = dht.readHumidity();
  MyIoT.virtualWrite(1, kelembaban);      // kirim ke pin V1 -> tampil di widget "Kelembaban"

  delay(5000);
}
```

**Slider** (dashboard → ESP, mengirim angka bukan cuma ON/OFF):
Sama seperti switch, tapi `value` berupa angka (bukan 0/1):
```cpp
void onDashboardWrite(int pin, float value) {
  if (pin == 4) {                          // slider "Kecepatan Kipas" di pin V4, 0-255
    analogWrite(KIPAS_PIN, (int)value);
  }
}
```

**LED** (indikator saja, tidak mengirim perintah):
Widget ini hanya menampilkan nilai — kirim status dari ESP seperti widget Label Nilai:
```cpp
MyIoT.virtualWrite(5, lampuMenyala ? 1 : 0); // widget LED di V5 ikut menyala/mati
```

> **Tips:** nomor pin di kode (`pin == 2`, dst.) harus **sama persis** dengan nomor pin virtual yang diisi saat membuat datastream di Template.

---

## Troubleshooting Singkat

- **Port tidak muncul** → cek kabel USB data (bukan kabel cas), install driver CH340/CP2102
- **Sensor `nan`** → cek wiring & tipe sensor di kode
- **Device tidak online** → cek Wi-Fi sudah benar, atau `MyIoT.begin(apiKey, host)` kalau pakai project Firebase sendiri
- **Widget tidak merespon** → tunggu ±5 detik (siklus polling), cek nomor pin di kode cocok dengan pin virtual di datastream template

---

Lisensi: bebas dipakai & dimodifikasi untuk keperluan pribadi/edukasi.
