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

def capture_roles():
    tmp_prof = f"/tmp/ff_roles_{int(time.time()*1000)}"
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

    # 1. Login as Participant (Priya)
    send_cmd(s, 3, "WebDriver:Navigate", {"url": "http://localhost:8080/login"})
    time.sleep(1.5)
    send_cmd(s, 4, "WebDriver:ExecuteScript", {
        "script": "const btn = document.getElementById('btn-demo-participant'); if (btn) btn.click();"
    })
    time.sleep(2.5)
    shot = send_cmd(s, 5, "WebDriver:TakeScreenshot", {"full": True})
    with open("/tmp/live_participant_view.png", "wb") as f:
        f.write(base64.b64decode(shot[3]["value"]))
    print("Captured /tmp/live_participant_view.png")

    # 2. Logout and Login as Judge (Tomas Varga)
    send_cmd(s, 6, "WebDriver:ExecuteScript", {"script": "window.Judgely.api.logout();"})
    time.sleep(0.5)
    send_cmd(s, 7, "WebDriver:Navigate", {"url": "http://localhost:8080/login"})
    time.sleep(1.5)
    send_cmd(s, 8, "WebDriver:ExecuteScript", {
        "script": "const btn = document.getElementById('btn-demo-judge'); if (btn) btn.click();"
    })
    time.sleep(2.5)
    shot_j = send_cmd(s, 9, "WebDriver:TakeScreenshot", {"full": True})
    with open("/tmp/live_judge_view.png", "wb") as f:
        f.write(base64.b64decode(shot_j[3]["value"]))
    print("Captured /tmp/live_judge_view.png")

    # 3. Logout and Login as Organizer (Operations Center)
    send_cmd(s, 10, "WebDriver:ExecuteScript", {"script": "window.Judgely.api.logout();"})
    time.sleep(0.5)
    send_cmd(s, 11, "WebDriver:Navigate", {"url": "http://localhost:8080/login"})
    time.sleep(1.5)
    send_cmd(s, 12, "WebDriver:ExecuteScript", {
        "script": "const btn = document.getElementById('btn-demo-organizer'); if (btn) btn.click();"
    })
    time.sleep(2.5)
    shot_o = send_cmd(s, 11, "WebDriver:TakeScreenshot", {"full": True})
    with open("/tmp/live_organizer_view.png", "wb") as f:
        f.write(base64.b64decode(shot_o[3]["value"]))
    print("Captured /tmp/live_organizer_view.png")

    send_cmd(s, 12, "WebDriver:DeleteSession", {})
    s.close()
    proc.terminate()

if __name__ == "__main__":
    capture_roles()
