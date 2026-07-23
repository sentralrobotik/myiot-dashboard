#include "MyIoT.h"
#include <ArduinoJson.h>
#include <WiFiClientSecure.h>
#include <DNSServer.h>

// ---------- Deteksi platform: ESP32 atau ESP8266 ----------
// Nama header WiFi/HTTPClient/WebServer beda antara dua chip ini,
// jadi library ini pilih otomatis sesuai board yang kamu upload.
#if defined(ESP32)
  #include <WiFi.h>
  #include <HTTPClient.h>
  #include <WebServer.h>
  #include <Preferences.h>
  typedef WebServer MyIoTWebServer;
  static Preferences prefs;
#elif defined(ESP8266)
  #include <ESP8266WiFi.h>
  #include <ESP8266HTTPClient.h>
  #include <ESP8266WebServer.h>
  #include <EEPROM.h>
  typedef ESP8266WebServer MyIoTWebServer;
  // ESP8266 tidak punya Preferences.h (itu API khusus ESP32/NVS), jadi
  // Wi-Fi kredensial disimpan manual di EEPROM (area flash kecil yang persist).
  #define MYIOT_EEPROM_SIZE   128
  #define MYIOT_EEPROM_MAGIC  0xA5   // penanda "sudah pernah disimpan", beda dari flash kosong (0xFF)
  #define MYIOT_SSID_MAXLEN   32
  #define MYIOT_PASS_MAXLEN   64
#else
  #error "Library MyIoT hanya mendukung board ESP32 atau ESP8266"
#endif

static MyIoTWebServer configServer(80);
static DNSServer dnsServer;
static bool configCredentialsReceived = false;
static String configPendingSsid, configPendingPass;
const byte MYIOT_DNS_PORT = 53;

// ---------- Penyimpanan Wi-Fi (beda implementasi per chip, API sama dari luar) ----------

static void storageBegin() {
#if defined(ESP32)
  prefs.begin("myiot", false);
#elif defined(ESP8266)
  EEPROM.begin(MYIOT_EEPROM_SIZE);
#endif
}

#if defined(ESP8266)
static String eepromReadStr(int addr, int maxLen) {
  char buf[MYIOT_PASS_MAXLEN + 1];
  for (int i = 0; i < maxLen; i++) buf[i] = (char)EEPROM.read(addr + i);
  buf[maxLen] = 0;
  return String(buf);
}
static void eepromWriteStr(int addr, const String& val, int maxLen) {
  for (int i = 0; i < maxLen; i++) EEPROM.write(addr + i, i < (int)val.length() ? val[i] : 0);
}
#endif

static String storageGetSsid() {
#if defined(ESP32)
  return prefs.getString("ssid", "");
#elif defined(ESP8266)
  if (EEPROM.read(0) != MYIOT_EEPROM_MAGIC) return "";
  return eepromReadStr(1, MYIOT_SSID_MAXLEN);
#endif
}
static String storageGetPass() {
#if defined(ESP32)
  return prefs.getString("pass", "");
#elif defined(ESP8266)
  if (EEPROM.read(0) != MYIOT_EEPROM_MAGIC) return "";
  return eepromReadStr(1 + MYIOT_SSID_MAXLEN, MYIOT_PASS_MAXLEN);
#endif
}
static void storageSaveWifi(const String& ssid, const String& pass) {
#if defined(ESP32)
  prefs.putString("ssid", ssid);
  prefs.putString("pass", pass);
#elif defined(ESP8266)
  EEPROM.write(0, MYIOT_EEPROM_MAGIC);
  eepromWriteStr(1, ssid, MYIOT_SSID_MAXLEN);
  eepromWriteStr(1 + MYIOT_SSID_MAXLEN, pass, MYIOT_PASS_MAXLEN);
  EEPROM.commit();
#endif
}
static void storageClearWifi() {
#if defined(ESP32)
  prefs.remove("ssid");
  prefs.remove("pass");
#elif defined(ESP8266)
  EEPROM.write(0, 0x00);
  EEPROM.commit();
#endif
}

// ---------- Kredensial Firebase default (dipakai bareng-bareng, sekelas) ----------
// Ini bukan password rahasia -- keamanan sebenarnya diatur oleh Firebase Security Rules
// (tiap device dapat ID unik sendiri saat sign-in anonim, jadi aman dipakai banyak kelompok).
static const char* MYIOT_DEFAULT_API_KEY  = "AIzaSyCexrk4wcs_lRUpNJM0_bHuIGJNBjto0fY";
static const char* MYIOT_DEFAULT_HOST     = "https://myiot-dashboard-default-rtdb.asia-southeast1.firebasedatabase.app";

// ---------- Setup & WiFi ----------

void MyIoTClass::begin() {
  begin(MYIOT_DEFAULT_API_KEY, MYIOT_DEFAULT_HOST);
}

void MyIoTClass::begin(const char* apiKey, const char* firebaseHost) {
  _apiKey = apiKey;
  _host = firebaseHost;   // contoh: "https://myiot-xxxx.firebaseio.com"

  storageBegin();
  loadWifiFromStorage();

  if (_ssid.length() > 0) {
    connectWifi(_ssid, _pass);
  }

  if (WiFi.status() != WL_CONNECTED) {
    // Belum ada Wi-Fi tersimpan (atau gagal konek) -> buka portal setup.
    // Device jadi hotspot sendiri, HP disambungkan ke situ untuk isi SSID/password.
    startConfigPortal();
  }

  if (WiFi.status() == WL_CONNECTED) {
    signInAnonymously();
    reportWifiStatus();
    Serial.println("Device ID (uid): " + _uid);
    Serial.println("Salin Device ID ini ke dashboard web untuk menghubungkan device.");
  }
}

void MyIoTClass::startConfigPortal() {
  String apName;
#if defined(ESP32)
  apName = "MyIoT-Setup-" + String((uint32_t)(ESP.getEfuseMac() & 0xFFFF), HEX);
#elif defined(ESP8266)
  apName = "MyIoT-Setup-" + String(ESP.getChipId(), HEX);
#endif
  WiFi.mode(WIFI_AP);
  WiFi.softAP(apName.c_str());
  IPAddress apIP = WiFi.softAPIP();

  Serial.println("=== Mode Setup Wi-Fi ===");
  Serial.println("1. Sambungkan HP ke Wi-Fi bernama: " + apName);
  Serial.println("2. Buka browser, akses: http://" + apIP.toString());
  Serial.println("   (di HP modern biasanya otomatis kebuka sendiri / captive portal popup)");

  dnsServer.start(MYIOT_DNS_PORT, "*", apIP); // captive portal: semua domain diarahkan ke ESP

  configCredentialsReceived = false;

  configServer.on("/", HTTP_GET, []() {
    String html =
      "<html><body style='font-family:sans-serif;padding:24px;max-width:400px;margin:auto;'>"
      "<h3>Atur Wi-Fi MyIoT</h3>"
      "<p>Pilih Wi-Fi rumah/kantor kamu supaya device ini bisa online.</p>"
      "<form action='/save' method='POST'>"
      "<label>Nama Wi-Fi (SSID)</label><br>"
      "<input name='ssid' style='width:100%;padding:10px;margin:6px 0 16px;box-sizing:border-box;'><br>"
      "<label>Password</label><br>"
      "<input name='pass' type='password' style='width:100%;padding:10px;margin:6px 0 16px;box-sizing:border-box;'><br>"
      "<button type='submit' style='width:100%;padding:12px;'>Simpan & Sambungkan</button>"
      "</form></body></html>";
    configServer.send(200, "text/html", html);
  });

  configServer.on("/save", HTTP_POST, []() {
    configPendingSsid = configServer.arg("ssid");
    configPendingPass = configServer.arg("pass");
    configServer.send(200, "text/html",
      "<html><body style='font-family:sans-serif;padding:24px;'>"
      "Menyambungkan ke Wi-Fi... Tutup halaman ini, cek dashboard atau Serial Monitor "
      "beberapa saat lagi. Kalau gagal, hotspot setup ini akan muncul lagi."
      "</body></html>");
    configCredentialsReceived = true;
  });

  // request ke domain manapun (dipakai HP utk deteksi captive portal) diarahkan ke halaman setup
  configServer.onNotFound([]() {
    configServer.sendHeader("Location", "/", true);
    configServer.send(302, "text/plain", "");
  });

  configServer.begin();

  // blocking: tunggu sampai user isi form. Ini disengaja -- device memang belum
  // bisa ngapa-ngapain lagi sebelum tersambung internet.
  while (!configCredentialsReceived) {
    dnsServer.processNextRequest();
    configServer.handleClient();
    delay(10);
  }

  configServer.stop();
  dnsServer.stop();
  WiFi.mode(WIFI_STA);

  connectWifi(configPendingSsid, configPendingPass, 20000);
  if (WiFi.status() == WL_CONNECTED) {
    _ssid = configPendingSsid;
    _pass = configPendingPass;
    storageSaveWifi(_ssid, _pass);
    Serial.println("Berhasil tersambung ke Wi-Fi: " + _ssid);
  } else {
    Serial.println("Gagal tersambung, membuka ulang mode setup...");
    startConfigPortal(); // coba lagi dari awal
  }
}

void MyIoTClass::reportWifiStatus() {
  if (WiFi.status() != WL_CONNECTED || _uid.length() == 0) return;
  WiFiClientSecure client;
  client.setInsecure();
  HTTPClient http;
  String url = _host + "/devices/" + _uid + "/status/ssid.json?auth=" + _idToken;
  http.begin(client, url);
  http.PUT("\"" + WiFi.SSID() + "\"");
  http.end();
}

void MyIoTClass::loadWifiFromStorage() {
  _ssid = storageGetSsid();
  _pass = storageGetPass();
}

void MyIoTClass::connectWifi(const String& ssid, const String& pass, unsigned long timeoutMs) {
  WiFi.begin(ssid.c_str(), pass.c_str());
  unsigned long start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < timeoutMs) {
    delay(300);
  }
}

String MyIoTClass::getDeviceId() {
  return _uid;
}

void MyIoTClass::onVirtualWrite(MyIoTWriteHandler handler) {
  _writeHandler = handler;
}

// ---------- Firebase Auth (anonymous sign-in + refresh) ----------

bool MyIoTClass::signInAnonymously() {
  WiFiClientSecure client;
  client.setInsecure(); // versi awal: skip validasi sertifikat, cukup untuk tahap belajar/hobi

  HTTPClient http;
  String url = "https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=" + _apiKey;
  http.begin(client, url);
  http.addHeader("Content-Type", "application/json");

  String payload = "{\"returnSecureToken\":true}";
  int code = http.POST(payload);

  bool ok = false;
  if (code == 200) {
    StaticJsonDocument<1024> doc;
    DeserializationError err = deserializeJson(doc, http.getString());
    if (!err) {
      _idToken = doc["idToken"].as<String>();
      _refreshToken = doc["refreshToken"].as<String>();
      _uid = doc["localId"].as<String>();
      long expiresIn = doc["expiresIn"].as<long>(); // detik, biasanya 3600
      _tokenExpiryMillis = millis() + (expiresIn * 1000UL);
      ok = true;
    }
  } else {
    Serial.println("Sign-in anonim gagal, kode HTTP: " + String(code));
  }
  http.end();
  return ok;
}

bool MyIoTClass::refreshIdToken() {
  WiFiClientSecure client;
  client.setInsecure();

  HTTPClient http;
  String url = "https://securetoken.googleapis.com/v1/token?key=" + _apiKey;
  http.begin(client, url);
  http.addHeader("Content-Type", "application/x-www-form-urlencoded");

  String payload = "grant_type=refresh_token&refresh_token=" + _refreshToken;
  int code = http.POST(payload);

  bool ok = false;
  if (code == 200) {
    StaticJsonDocument<1024> doc;
    DeserializationError err = deserializeJson(doc, http.getString());
    if (!err) {
      _idToken = doc["id_token"].as<String>();
      _refreshToken = doc["refresh_token"].as<String>();
      long expiresIn = doc["expires_in"].as<String>().toInt(); // detik, dalam bentuk string di respons ini
      _tokenExpiryMillis = millis() + (expiresIn * 1000UL);
      ok = true;
    }
  } else {
    Serial.println("Refresh token gagal, kode HTTP: " + String(code));
  }
  http.end();
  return ok;
}

void MyIoTClass::ensureValidToken() {
  if (_idToken.length() == 0) {
    signInAnonymously();
    return;
  }
  // refresh 60 detik sebelum kadaluarsa, biar ada jeda aman
  if ((long)(millis() - _tokenExpiryMillis) > -60000L) {
    refreshIdToken();
  }
}

// ---------- Data & command ----------

void MyIoTClass::run() {
  if (WiFi.status() != WL_CONNECTED) return;
  ensureValidToken();

  // polling tiap 5 detik, tidak nge-block loop() dengan delay()
  if (millis() - _lastCommandCheck > 5000) {
    checkPendingCommand();
    _lastCommandCheck = millis();
  }

  // heartbeat tiap 5 detik juga, supaya dashboard tahu device ini masih hidup.
  // Dashboard anggap device "offline" kalau lastSeen tidak update > 15 detik.
  if (millis() - _lastHeartbeat > 5000) {
    sendHeartbeat();
    _lastHeartbeat = millis();
  }
}

void MyIoTClass::sendHeartbeat() {
  if (WiFi.status() != WL_CONNECTED || _uid.length() == 0) return;
  ensureValidToken();

  WiFiClientSecure client;
  client.setInsecure();
  HTTPClient http;
  String url = _host + "/devices/" + _uid + "/status/lastSeen.json?auth=" + _idToken;
  http.begin(client, url);
  http.addHeader("Content-Type", "application/json");
  // {".sv":"timestamp"} = suruh server Firebase isi sendiri jam server-nya,
  // supaya tidak perlu device punya RTC/NTP yang akurat.
  http.PUT("{\".sv\":\"timestamp\"}");
  http.end();
}

void MyIoTClass::virtualWrite(int pin, float value) {
  if (WiFi.status() != WL_CONNECTED || _uid.length() == 0) return;
  ensureValidToken();

  WiFiClientSecure client;
  client.setInsecure();
  HTTPClient http;
  String url = _host + "/devices/" + _uid + "/data/V" + String(pin) + ".json?auth=" + _idToken;
  http.begin(client, url);
  http.PUT(String(value));
  http.end();
}

float MyIoTClass::virtualRead(int pin) {
  float result = 0;
  if (WiFi.status() != WL_CONNECTED || _uid.length() == 0) return result;
  ensureValidToken();

  WiFiClientSecure client;
  client.setInsecure();
  HTTPClient http;
  String url = _host + "/devices/" + _uid + "/data/V" + String(pin) + ".json?auth=" + _idToken;
  http.begin(client, url);
  int code = http.GET();
  if (code == 200) {
    result = http.getString().toFloat();
  }
  http.end();
  return result;
}

void MyIoTClass::checkPendingCommand() {
  if (_uid.length() == 0) return;

  WiFiClientSecure client;
  client.setInsecure();
  HTTPClient http;
  String url = _host + "/devices/" + _uid + "/commands.json?auth=" + _idToken;
  http.begin(client, url);
  int code = http.GET();

  if (code == 200) {
    String body = http.getString();
    if (body != "null") {
      StaticJsonDocument<512> doc;
      DeserializationError err = deserializeJson(doc, body);
      if (!err && doc["type"] == "set_wifi") {
        String newSsid = doc["ssid"].as<String>();
        String newPass = doc["password"].as<String>();
        applyNewWifi(newSsid, newPass);

        // hapus command supaya tidak dieksekusi berulang
        WiFiClientSecure delClient;
        delClient.setInsecure();
        HTTPClient delHttp;
        delHttp.begin(delClient, url);
        delHttp.sendRequest("DELETE");
        delHttp.end();
      } else if (!err && doc["type"] == "virtual_write") {
        // Perintah dari dashboard: user menekan switch/slider/tombol di web.
        // Format pin dari dashboard adalah string seperti "V2" -> ambil angkanya saja.
        String pinStr = doc["pin"].as<String>();
        int pin = pinStr.substring(1).toInt(); // "V2" -> 2
        float value = doc["value"].as<float>();

        if (_writeHandler != nullptr) {
          _writeHandler(pin, value); // sketch yang menentukan aksi fisiknya (relay, dsb)
        }

        // tulis balik ke /data supaya dashboard langsung menampilkan nilai terbaru,
        // tanpa menunggu sketch memanggil virtualWrite() sendiri.
        virtualWrite(pin, value);

        // hapus command supaya tidak dieksekusi berulang tiap polling
        WiFiClientSecure delClient;
        delClient.setInsecure();
        HTTPClient delHttp;
        delHttp.begin(delClient, url);
        delHttp.sendRequest("DELETE");
        delHttp.end();
      }
    }
  }
  http.end();
}

void MyIoTClass::applyNewWifi(const String& newSsid, const String& newPass) {
  String oldSsid = _ssid, oldPass = _pass;

  connectWifi(newSsid, newPass);
  if (WiFi.status() == WL_CONNECTED) {
    _ssid = newSsid;
    _pass = newPass;
    storageSaveWifi(newSsid, newPass);
    signInAnonymously(); // WiFi baru = koneksi baru, aman untuk re-auth
    reportWifiStatus();
  } else {
    connectWifi(oldSsid, oldPass); // rollback ke WiFi lama
    reportWifiStatus();
  }
}

void MyIoTClass::resetWifi() {
  storageClearWifi();
  _ssid = ""; _pass = "";
}

MyIoTClass MyIoT;
