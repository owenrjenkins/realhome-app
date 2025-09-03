from flask import Flask, send_from_directory, jsonify
import subprocess
import os
import signal
import threading
import time

app = Flask(__name__)

# Start Next.js server in background
nextjs_process = None

def start_nextjs():
    global nextjs_process
    try:
        # Build the Next.js app first
        subprocess.run(['npm', 'run', 'build'], cwd='/home/ubuntu/realhome', check=True)
        # Start the Next.js server
        nextjs_process = subprocess.Popen(['npm', 'start'], cwd='/home/ubuntu/realhome')
        time.sleep(5)  # Give it time to start
    except Exception as e:
        print(f"Error starting Next.js: {e}")

# Start Next.js in a background thread
threading.Thread(target=start_nextjs, daemon=True).start()

@app.route('/')
def index():
    return '''
    <html>
    <head><title>RealHome - Redirecting...</title></head>
    <body>
        <h1>RealHome Application</h1>
        <p>The Next.js application is starting up...</p>
        <p><a href="http://localhost:3000">Click here to access RealHome</a></p>
        <script>
            setTimeout(() => {
                window.location.href = 'http://localhost:3000';
            }, 3000);
        </script>
    </body>
    </html>
    '''

@app.route('/health')
def health():
    return jsonify({"status": "ok", "service": "realhome-wrapper"})

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)
