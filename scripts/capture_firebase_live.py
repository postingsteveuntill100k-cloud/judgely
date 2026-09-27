import socket, json, base64, time, subprocess, os

def send_cmd(s, msg_id, cmd, params=None):
    payload = json.dumps([0, msg_id, cmd, params or {}])
    s.sendall(f"{len(payload)}:{payload}".encode('utf-8'))
    data = b""
    while b":" not in data:
        data += s.recv(1024)
    length_str, rest = data.split(b":", 1)
    msg_len = int(length_str)
    while len(rest) < msg_len:
        rest += s.recv(min(4096, msg_len - len(rest)))
    return json.loads(rest[:msg_len].decode('utf-8'))

def capture_firebase():
    tmp_prof = f"/tmp/ff_fb_{int(time.time()*1000)}"
    os.makedirs(tmp_prof, exist_ok=True)
    proc = subprocess.Popen([
        "firefox", "--headless", "--marionette", "--no-remote", "--profile", tmp_prof
    ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(2)
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    for _ in range(15):
        try:
            s.connect(("127.0.0.1", 2828))
            break
        except ConnectionRefusedError:
            time.sleep(0.5)

    # Handshake
    hs = b""
    while b":" not in hs:
        hs += s.recv(1024)
    h_len, h_rest = hs.split(b":", 1)
    while len(h_rest) < int(h_len):
        h_rest += s.recv(int(h_len) - len(h_rest))

    send_cmd(s, 1, "WebDriver:NewSession", {})
    send_cmd(s, 2, "WebDriver:SetWindowRect", {"width": 1440, "height": 950})

    # 1. Live Deployed Firebase Hosting
    print("[1] Navigating to https://nexuslabs-b7b5e.web.app...")
    send_cmd(s, 3, "WebDriver:Navigate", {"url": "https://nexuslabs-b7b5e.web.app"})
    time.sleep(3)
    resp = send_cmd(s, 4, "WebDriver:TakeScreenshot", {})
    if isinstance(resp, list) and len(resp) > 3 and isinstance(resp[3], dict) and "value" in resp[3]:
        with open("/tmp/live_firebase_showcase.png", "wb") as f:
            f.write(base64.b64decode(resp[3]["value"]))
        print("  -> Saved /tmp/live_firebase_showcase.png, size:", os.path.getsize("/tmp/live_firebase_showcase.png"))

    # 2. Click "+ Host a Hackathon" Modal
    print("[2] Opening + Host a Hackathon modal...")
    send_cmd(s, 5, "WebDriver:ExecuteScript", {
        "script": "const btn = document.getElementById('btn-header-host-guest') || document.getElementById('btn-hero-host-event'); if (btn) btn.click();"
    })
    time.sleep(1)
    resp = send_cmd(s, 6, "WebDriver:TakeScreenshot", {})
    if isinstance(resp, list) and len(resp) > 3 and isinstance(resp[3], dict) and "value" in resp[3]:
        with open("/tmp/live_firebase_host_modal.png", "wb") as f:
            f.write(base64.b64decode(resp[3]["value"]))
        print("  -> Saved /tmp/live_firebase_host_modal.png, size:", os.path.getsize("/tmp/live_firebase_host_modal.png"))

    send_cmd(s, 7, "WebDriver:DeleteSession", {})
    s.close()
    proc.terminate()
    proc.wait()
    print("Done! All live Firebase screenshots captured.")

if __name__ == "__main__":
    capture_firebase()
