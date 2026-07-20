#ifndef MYIOT_H
#define MYIOT_H

#include <Arduino.h>

typedef void (*MyIoTWriteHandler)(int pin, float value);

class MyIoTClass {
  public:
    void begin(const char* apiKey, const char* firebaseHost);
    void run();                                   // panggil di loop()
    void virtualWrite(int pin, float value);       // kirim data sensor
    float virtualRead(int pin);                    // baca nilai terakhir
    void resetWifi();                              // hapus kredensial wifi tersimpan
    String getDeviceId();                          // uid Firebase, dipakai untuk link ke akun web

    // Daftarkan fungsi yang dipanggil tiap kali dashboard mengirim perintah
    // "set nilai pin virtual" (misal toggle switch/slider di web).
    // Contoh: MyIoT.onVirtualWrite(myHandler);
    //   void myHandler(int pin, float value) {
    //     if (pin == 2) digitalWrite(RELAY_PIN, value ? HIGH : LOW);
    //   }
    void onVirtualWrite(MyIoTWriteHandler handler);

  private:
    String _apiKey;
    String _host;
    String _ssid, _pass;

    String _idToken;
    String _refreshToken;
    String _uid;
    unsigned long _tokenExpiryMillis = 0;
    unsigned long _lastCommandCheck = 0;

    void loadWifiFromStorage();
    void connectWifi(const String& ssid, const String& pass, unsigned long timeoutMs = 15000);
    void checkPendingCommand();
    void applyNewWifi(const String& newSsid, const String& newPass);
    void sendHeartbeat();               // tulis timestamp terakhir aktif, dipakai dashboard utk status online/offline
    unsigned long _lastHeartbeat = 0;
    MyIoTWriteHandler _writeHandler = nullptr;
    void startConfigPortal();           // AP + captive portal, dipakai saat belum ada Wi-Fi tersimpan sama sekali
    void reportWifiStatus();            // lapor SSID yang sedang tersambung ke /status/ssid

    bool signInAnonymously();
    bool refreshIdToken();
    void ensureValidToken();                       // sign-in / refresh kalau perlu, dipanggil sebelum tiap request
};

extern MyIoTClass MyIoT;

#endif
