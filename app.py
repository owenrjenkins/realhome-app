#!/usr/bin/env python3
"""
Flask wrapper for Next.js RealHome application
This allows deployment using the backend deployment service
"""

import subprocess
import os
import sys
from flask import Flask
from flask_cors import CORS

app = Flask(__name__)
CORS(app)

# Start Next.js server as a subprocess
nextjs_process = None

def start_nextjs():
    global nextjs_process
    try:
        # Change to the correct directory
        os.chdir('/home/ubuntu/realhome')
        
        # Start Next.js in production mode
        nextjs_process = subprocess.Popen(
            ['npm', 'start'],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            env=dict(os.environ, PORT='3001')  # Use port 3001 for Next.js
        )
        print("Next.js server started on port 3001")
    except Exception as e:
        print(f"Error starting Next.js: {e}")

@app.route('/')
def index():
    return '''
    <html>
    <head>
        <title>RealHome - Redirecting...</title>
        <meta http-equiv="refresh" content="0;url=http://localhost:3001">
    </head>
    <body>
        <p>Redirecting to RealHome application...</p>
        <p>If not redirected automatically, <a href="http://localhost:3001">click here</a>.</p>
    </body>
    </html>
    '''

@app.route('/health')
def health():
    return {'status': 'ok', 'service': 'RealHome Flask Wrapper'}

if __name__ == '__main__':
    start_nextjs()
    app.run(host='0.0.0.0', port=5000, debug=False)

