#include <Arduino.h>
#include "protocol.h"

String line;
void respond(const String& id, const String& status) {
  Serial.printf("{\"type\":\"response\",\"request_id\":\"%s\",\"status\":\"%s\",\"protocol_version\":\"%s\"}\n", id.c_str(), status.c_str(), PROTOCOL_VERSION_TEXT);
}
void setup() { Serial.begin(SERIAL_BAUD); Serial.setTimeout(1000); }
void loop() {
  while (Serial.available()) {
    char c = static_cast<char>(Serial.read());
    if (c == '\n') { if (line.length() > 0) respond("unparsed", "received"); line = ""; }
    else if (line.length() < MAX_MESSAGE_BYTES) line += c;
    else { line = ""; Serial.println("{\"type\":\"error\",\"code\":\"MESSAGE_TOO_LONG\"}"); }
  }
}
