#include <unity.h>
#include "protocol.h"
void test_limits() { TEST_ASSERT_EQUAL_UINT32(115200, SERIAL_BAUD); TEST_ASSERT_EQUAL_UINT32(512, MAX_MESSAGE_BYTES); }
void setup(){ UNITY_BEGIN(); RUN_TEST(test_limits); UNITY_END(); }
void loop(){}
