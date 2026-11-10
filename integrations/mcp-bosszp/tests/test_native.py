import io
import json
from pathlib import Path
import struct
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from boss_bridge.native import encode_native, read_native

class Chunked(io.BytesIO):
    def read(self, n=-1):
        return super().read(min(n, 2))

class NativeTests(unittest.TestCase):
    def test_fragmented_and_concatenated_unicode_frames(self):
        stream = Chunked(encode_native({'text': '职位'}) + encode_native({'ok': True}))
        self.assertEqual(read_native(stream), {'text': '职位'})
        self.assertEqual(read_native(stream), {'ok': True})
        self.assertIsNone(read_native(stream))

    def test_truncated_header_body_and_oversize_rejected(self):
        for value in [b'\x01', struct.pack('=I', 5) + b'{}', struct.pack('=I', 1000001)]:
            with self.subTest(value=value), self.assertRaises(ValueError):
                read_native(io.BytesIO(value))
        with self.assertRaises(ValueError):
            encode_native({'value': 'x' * 1000000})

    def test_invalid_json_and_non_object_rejected(self):
        for body in [b'no', b'[]', b'{"n":NaN}']:
            with self.subTest(body=body), self.assertRaises(ValueError):
                read_native(io.BytesIO(struct.pack('=I', len(body)) + body))

if __name__ == '__main__':
    unittest.main()
