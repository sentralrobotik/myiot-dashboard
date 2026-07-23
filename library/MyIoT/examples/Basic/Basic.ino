#include <MyIoT.h>

#define RELAY_PIN 5 // ganti sesuai pin fisik yang kamu pakai

// Dipanggil otomatis tiap kali kamu tekan switch/slider/tombol di dashboard web,
// untuk datastream yang pin-nya "V2". Di sinilah aksi fisiknya ditentukan.
void onDashboardWrite(int pin, float value) {
  if (pin == 2) {
    digitalWrite(RELAY_PIN, value ? HIGH : LOW);
    Serial.println("Relay di-set ke: " + String(value ? "ON" : "OFF"));
  }
}

void setup() {
  Serial.begin(115200);
  pinMode(RELAY_PIN, OUTPUT);

  // Wifi (SSID & password) diisi lewat portal setup / dashboard,
  // bukan hardcode di sini. Lihat MyIoT.h -> resetWifi() untuk reset manual.
  // Tidak perlu isi API key / host Firebase di sini lagi --
  // MyIoT.begin() sudah pakai kredensial default dari library.
  MyIoT.begin();
  MyIoT.onVirtualWrite(onDashboardWrite);

  // Salin "Device ID" yang muncul di Serial Monitor ke dashboard web,
  // untuk menghubungkan device ini ke akunmu.
}

void loop() {
  MyIoT.run(); // wajib dipanggil tiap loop — di sinilah perintah dari dashboard dicek & dieksekusi

  float suhu = 28.5; // ganti dengan pembacaan sensor asli
  MyIoT.virtualWrite(0, suhu); // kirim ke pin virtual V0

  delay(5000);
}

