"""Chrome native messaging framing. stdout must only carry these frames."""
import json
import struct
from typing import BinaryIO

MAX_FRAME = 1_000_000

def encode_native(value: dict) -> bytes:
    if not isinstance(value, dict):
        raise ValueError('OBJECT_REQUIRED')
    body = json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(',', ':')).encode('utf-8')
    if len(body) > MAX_FRAME:
        raise ValueError('FRAME_TOO_LARGE')
    return struct.pack('=I', len(body)) + body

def _exact(stream: BinaryIO, size: int, eof_ok=False) -> bytes | None:
    result = bytearray()
    while len(result) < size:
        chunk = stream.read(size - len(result))
        if not chunk:
            if eof_ok and not result:
                return None
            raise ValueError('TRUNCATED_FRAME')
        result.extend(chunk)
    return bytes(result)

def read_native(stream: BinaryIO) -> dict | None:
    header = _exact(stream, 4, True)
    if header is None:
        return None
    size = struct.unpack('=I', header)[0]
    if not 0 < size <= MAX_FRAME:
        raise ValueError('FRAME_TOO_LARGE_OR_EMPTY')
    def reject_constant(value):
        raise ValueError('INVALID_JSON_CONSTANT')
    value = json.loads(_exact(stream, size), parse_constant=reject_constant)
    if not isinstance(value, dict):
        raise ValueError('OBJECT_REQUIRED')
    return value
