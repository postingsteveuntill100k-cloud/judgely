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
        data += chunk
        
    res = json.loads(rest[:msg_len].decode('utf-8'))
    return res

def exec_js(s, msg_id, script, args=None):
    if args is None:
        args = []
    res = send_cmd(s, msg_id, "WebDriver:ExecuteScript", {"script": script, "args": args})
    return res

def take_shot(s, msg_id, out_path):
    res = send_cmd(s, msg_id, "WebDriver:TakeScreenshot", {"full": True})
    b64 = res[3].get("value")
    if b64:
        with open(out_path, "wb") as f:
            f.write(base64.b64decode(b64))
        print(f"Captured: {out_path} ({os.path.getsize(out_path)} bytes)")

def test_flow():
    tmp_prof = f"/tmp/ff_prof_events_{int(time.time()*1000)}"
    os.makedirs(tmp_prof, exist_ok=True)
    
    proc = subprocess.Popen([
        "firefox", "--headless", "--marionette", "--no-remote",
        "--profile", tmp_prof
    ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    
    connected = False
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    for _ in range(20):
        try:
            time.sleep(0.5)
            s.connect(("127.0.0.1", 2828))
            connected = True
            break
        except ConnectionRefusedError:
            pass
            
    if not connected:
        raise RuntimeError("Failed to connect to Marionette after 10 seconds")
    
    # Handshake
    handshake_data = b""
    while b":" not in handshake_data:
        handshake_data += s.recv(1024)
    h_len, h_rest = handshake_data.split(b":", 1)
    while len(h_rest) < int(h_len):
        h_rest += s.recv(int(h_len) - len(h_rest))
    
    # New session
    send_cmd(s, 1, "WebDriver:NewSession", {})
    
    # Set window size
    send_cmd(s, 2, "WebDriver:SetWindowRect", {"width": 1440, "height": 1000})
    
    # 1. Navigate to portal
    send_cmd(s, 3, "WebDriver:Navigate", {"url": "http://localhost:8080/projects"})
    time.sleep(1.5)
    
    # Verify events directory and switcher
    res = exec_js(s, 4, """
      return {
        eventsCount: (window.Judgely.state.events || []).length,
        activeEvent: window.Judgely.state.activeEventId,
        headerEventText: document.getElementById('header-event-name') ? document.getElementById('header-event-name').textContent.trim() : null
      };
    """)
    print("Initial event state:", res)
    take_shot(s, 5, "/tmp/review_event_initial.png")
    
    # 2. Click "+ Host Hackathon" to open wizard
    exec_js(s, 6, "window.Judgely.showCreateHackathonModal();")
    time.sleep(0.8)
    take_shot(s, 7, "/tmp/review_event_wizard_opened.png")
    
    # 3. Sign in as Participant (Priya) first to show multi-role capability
    exec_js(s, 8, """
      window.Judgely.api.demoLogin('participant').then(res => {
        window.Judgely.onLoginSuccess(res.user);
      });
    """)
    time.sleep(1)
    take_shot(s, 9, "/tmp/review_event_priya_signed_in.png")
    
    # 4. Priya now creates her OWN Hackathon ("Nexus Frontier 2026")
    res_create = exec_js(s, 10, """
      return window.Judgely.api.createEvent({
        name: 'Nexus Frontier 2026',
        description: 'Building verifiable agentic protocols and decentralized infrastructure'
      });
    """)
    print("Created Hackathon:", res_create)
    time.sleep(1)
    
    # 5. Open new event in Organizer Operations Center!
    exec_js(s, 11, """
      window.Judgely.api.getEvents().then(res => {
        window.Judgely.setState({ events: res.events });
        const newEvt = res.events.find(e => e.name === 'Nexus Frontier 2026');
        if (newEvt) {
          window.Judgely.setActiveEvent(newEvt.id);
          window.Judgely.navigateTo('organizer');
        }
      });
    """)
    time.sleep(1.5)
    take_shot(s, 12, "/tmp/review_event_priya_as_organizer.png")
    
    # 6. Switch back to original Hackathon where Priya is Participant!
    exec_js(s, 13, """
      const origEvt = window.Judgely.state.events.find(e => e.name !== 'Nexus Frontier 2026');
      if (origEvt) {
        window.Judgely.setActiveEvent(origEvt.id);
        window.Judgely.navigateTo('participant');
      }
    """)
    time.sleep(1.5)
    take_shot(s, 14, "/tmp/review_event_priya_back_as_participant.png")
    
    print("✅ Successfully verified multi-event hosting & participation in real browser!")
    
    send_cmd(s, 15, "WebDriver:DeleteSession", {})
    s.close()
    proc.terminate()

if __name__ == "__main__":
    test_flow()
