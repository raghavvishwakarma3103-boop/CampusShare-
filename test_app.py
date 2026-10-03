import unittest
import json
import io
from app import app, sessions

class CampusShareTestCase(unittest.TestCase):
    def setUp(self):
        self.app = app.test_client()
        self.app.testing = True

    def test_pages(self):
        # Home page
        response = self.app.get('/')
        self.assertEqual(response.status_code, 200)
        self.assertIn(b'CAMPUS SHARE', response.data)

        # Send page
        response = self.app.get('/send')
        self.assertEqual(response.status_code, 200)

        # Receive page
        response = self.app.get('/receive')
        self.assertEqual(response.status_code, 200)

    def test_session_lifecycle(self):
        # 1. Create Session
        res = self.app.post('/api/create-session', json={
            'filename': 'test_document.pdf',
            'filesize': 2048,
            'total_chunks': 1
        })
        self.assertEqual(res.status_code, 200)
        data = json.loads(res.data)
        self.assertTrue(data['success'])
        code = data['code']
        self.assertEqual(len(code), 6)

        # 2. Check Session Status
        res = self.app.get(f'/api/session-status/{code}')
        self.assertEqual(res.status_code, 200)

        # 3. Upload Chunk
        chunk_file = (io.BytesIO(b'file content chunk data'), 'chunk_0.dat')
        res = self.app.post('/api/upload-chunk', data={
            'code': code,
            'chunk_index': 0,
            'total_chunks': 1,
            'file': chunk_file
        }, content_type='multipart/form-data')
        self.assertEqual(res.status_code, 200)

        # 4. Connect Session
        res = self.app.post('/api/connect-session', json={'code': code})
        self.assertEqual(res.status_code, 200)
        conn_data = json.loads(res.data)
        self.assertEqual(conn_data['filename'], 'test_document.pdf')

        # 5. Download Chunk
        res = self.app.get(f'/api/download-chunk/{code}/0')
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data, b'file content chunk data')

        # 6. Complete Transfer
        res = self.app.post('/api/complete-transfer', json={'code': code})
        self.assertEqual(res.status_code, 200)

        # 7. QR Code endpoint
        res = self.app.get(f'/api/qr-code/{code}')
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.content_type, 'image/png')

if __name__ == '__main__':
    unittest.main()
