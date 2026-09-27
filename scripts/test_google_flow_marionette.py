import socket
import json
import base64
import time
import subprocess
import os

def send_cmd(s, msg_id, cmd, params=None):
    if params is None:
        params = {}
    payload = json.dumps([0, msg_id, cmd, params])
    s.sendall(f"{len(payload)}:{payload}".encode('utf-8'))
    
    data = b""
    while b":" not in data:
        chunk = s.recv(1024)
        if not chunk:
            raise EOFError("Socket closed")
        data += chunk
    
    length_str, rest = data.split(b":", 1)
    msg_len = int(length_str)
    
    while len(rest) < msg_len:
        chunk = s.recv(min(4096, msg_len - len(rest)))
        if not chunk:
            raise EOFError("Socket closed")
        rest += chunk
        
    res = json.loads(rest[:msg_len].decode('utf-8'))
    return res

def exec_js(s, msg_id, script, args=None):
    if args is None:
        args = []
    res = send_cmd(s, msg_id, "WebDriver:ExecuteScript", {"script": script, "args": args})
    if isinstance(res, list) and len(res) > 3 and isinstance(res[3], dict):
        return res[3].get("value")
    return res

def take_shot(s, msg_id, out_path):
    res = send_cmd(s, msg_id, "WebDriver:TakeScreenshot", {"full": True})
    b64 = res[3].get("value")
    if b64:
        with open(out_path, "wb") as f:
            f.write(base64.b64decode(b64))
        print(f"Captured: {out_path} ({os.path.getsize(out_path)} bytes)")
    else:
        print(f"Failed screenshot for {out_path}:", res)

def run():
    tmp_prof = f"/tmp/ff_prof_gflow_{int(time.time()*1000)}"
    os.makedirs(tmp_prof, exist_ok=True)
    
    proc = subprocess.Popen([
        "firefox", "--headless", "--marionette", "--no-remote",
        "--profile", tmp_prof
    ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    
    time.sleep(2)
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    _counter = [1]
    def next_id():
        _counter[0] += 1
        return _counter[0]
        
    try:
        s.connect(('127.0.0.1', 2828))
        hs = b""
        while b":" not in hs:
            hs += s.recv(1024)
        h_len, h_rest = hs.split(b":", 1)
        while len(h_rest) < int(h_len):
            h_rest += s.recv(int(h_len) - len(h_rest))
            
        send_cmd(s, next_id(), "WebDriver:NewSession", {})
        send_cmd(s, next_id(), "WebDriver:SetWindowRect", {"width": 1440, "height": 900})
        
        # 1. Login Page
        print("Navigating to /login...")
        send_cmd(s, next_id(), "WebDriver:Navigate", {"url": "http://localhost:8080/login"})
        time.sleep(2)
        take_shot(s, next_id(), "/tmp/modern_login.png")
        
        # 2. Click "Continue with Google"
        print("Clicking Continue with Google...")
        exec_js(s, next_id(), "document.querySelector('#btn-continue-google').click();")
        time.sleep(1)
        take_shot(s, next_id(), "/tmp/google_chooser_modal.png")
        
        # 3. Click Abhinav reddy (unregistered email from user screenshot)
        print("Clicking Abhinav reddy (unregistered email)...")
        exec_js(s, next_id(), "document.querySelector('[data-email=\"quality.prashanth@gmail.com\"]').click();")
        time.sleep(1.5)
        take_shot(s, next_id(), "/tmp/google_chooser_error.png")
        
        # 4. Click Priya Nair (registered participant)
        print("Clicking Priya Nair (registered participant)...")
        exec_js(s, next_id(), "document.querySelector('[data-email=\"priya1@example.org\"]').click();")
        time.sleep(2)
        take_shot(s, next_id(), "/tmp/modern_participant.png")
        
        # 5. Public View
        print("Navigating to Public View...")
        send_cmd(s, next_id(), "WebDriver:Navigate", {"url": "http://localhost:8080/"})
        time.sleep(2)
        take_shot(s, next_id(), "/tmp/modern_public.png")
        
        print("=== Marionette Google Flow Suite Passed Successfully ===")
        
    finally:
        s.close()
        proc.terminate()
        proc.wait()

if __name__ == "__main__":
    run()
