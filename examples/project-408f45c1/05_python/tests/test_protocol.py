from prototype.protocol import Message

def test_message_is_newline_delimited():
    assert Message("command","abc","ping",{}).encode().endswith(b"\n")
