# USB 串口协议

版本 1.0.0，115200 baud，UTF-8 换行分隔 JSON，最大 512 字节。

请求必须包含 `type`、`request_id`、`name` 与 `payload`。超时 1000 ms，最多重试 2 次。
