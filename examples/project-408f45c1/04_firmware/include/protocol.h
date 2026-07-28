#pragma once
constexpr unsigned long SERIAL_BAUD = 115200;
constexpr size_t MAX_MESSAGE_BYTES = 512;
constexpr const char* PROTOCOL_VERSION_TEXT = "1.0.0";
constexpr const char* PROTOCOL_COMMANDS = "ping,get_status,set_output";
constexpr const char* PROTOCOL_ERROR_CODES = "INVALID_JSON,UNKNOWN_COMMAND,INVALID_PAYLOAD,INTERNAL_ERROR";
