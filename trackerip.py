import requests
import math
import subprocess
import platform
import re
import json
import socket
import time
import os

OPENCELLID_API_KEY = "pk.f0b467ed92c7b7515d68885f475c1994"

CYAN = "\033[96m"
GREEN = "\033[92m"
YELLOW = "\033[93m"
RED = "\033[91m"
MAGENTA = "\033[95m"
BLUE = "\033[94m"
BOLD = "\033[1m"
DIM = "\033[2m"
RESET = "\033[0m"

def banner():
    os.system("clear" if os.name != "nt" else "cls")
    print(f"""{CYAN}
    ╔══════════════════════════════════════════════════════════════╗
    ║  ██╗     ████████╗██████╗  █████╗  ██████╗██╗  ██╗███████╗   ║
    ║  ██║     ╚══██╔══╝██╔══██╗██╔══██╗██╔════╝██║ ██╔╝██╔════╝   ║
    ║  ██║        ██║   ██████╔╝███████║██║     █████╔╝ █████╗     ║
    ║  ██║        ██║   ██╔══██╗██╔══██║██║     ██╔═██╗ ██╔══╝     ║
    ║  ███████╗   ██║   ██║  ██║██║  ██║╚██████╗██║  ██╗███████╗   ║
    ║  ╚══════╝   ╚═╝   ╚═╝  ╚═╝╚═╝  ╚═╝ ╚═════╝╚═╝  ╚═╝╚══════╝   ║
    ║                                                              ║
    ║     [ IP + WiFi + Cell Tower + Network Fusion Engine ]       ║
    ╚══════════════════════════════════════════════════════════════╝{RESET}
    """)

def section(title):
    print(f"\n{MAGENTA}{BOLD}[{title}]{RESET}")
    print(f"{DIM}{'─' * 50}{RESET}")

def status(label, value, color=GREEN):
    print(f"  {CYAN}{label:<20}{RESET} {color}{value}{RESET}")

def warn(msg):
    print(f"  {YELLOW}[!] {msg}{RESET}")

def err(msg):
    print(f"  {RED}[X] {msg}{RESET}")

def ok(msg):
    print(f"  {GREEN}[+] {msg}{RESET}")

def get_ip_location(ip=None):
    try:
        url = f"http://ip-api.com/json/{ip}?fields=status,message,country,regionName,city,zip,lat,lon,timezone,isp,org,as,query,proxy,mobile" if ip else "http://ip-api.com/json/?fields=status,message,country,regionName,city,zip,lat,lon,timezone,isp,org,as,query,proxy,mobile"
        r = requests.get(url, timeout=8)
        d = r.json()
        if d.get("status") == "success":
            return {
                "ip": d.get("query"),
                "country": d.get("country"),
                "region": d.get("regionName"),
                "city": d.get("city"),
                "zip": d.get("zip"),
                "latitude": d.get("lat"),
                "longitude": d.get("lon"),
                "timezone": d.get("timezone"),
                "isp": d.get("isp"),
                "org": d.get("org"),
                "asn": d.get("as"),
                "proxy": d.get("proxy"),
                "mobile": d.get("mobile")
            }
    except Exception as e:
        return {"error": str(e)}
    return {"error": "Failed"}

def get_wifi_networks():
    networks = []
    system = platform.system()
    try:
        if system == "Linux" and "ANDROID_ROOT" in os.environ:
            result = subprocess.run(["termux-wifi-scaninfo"], capture_output=True, text=True, timeout=10)
            data = json.loads(result.stdout)
            for ap in data:
                networks.append({
                    "ssid": ap.get("ssid", "Hidden"),
                    "mac": ap.get("bssid"),
                    "signal": ap.get("rssi"),
                    "freq": ap.get("frequency"),
                    "channel": ap.get("channel_width")
                })
        elif system == "Windows":
            result = subprocess.run(["netsh", "wlan", "show", "profiles"], capture_output=True, text=True, timeout=10)
            ssids = re.findall(r"All User Profile\s+:\s+(.+)", result.stdout)
            for ssid in ssids:
                networks.append({"ssid": ssid.strip(), "mac": None, "signal": None})
        elif system == "Darwin":
            result = subprocess.run(["/System/Library/PrivateFrameworks/Apple80211.framework/Versions/Current/Resources/airport", "-s"], capture_output=True, text=True, timeout=10)
            lines = result.stdout.strip().split("\n")[1:]
            for line in lines:
                parts = line.split()
                if len(parts) >= 3:
                    networks.append({"ssid": parts[0], "mac": parts[1], "signal": parts[2]})
        elif system == "Linux":
            result = subprocess.run(["iwlist", "scan"], capture_output=True, text=True, timeout=10)
            cells = result.stdout.split("Cell ")
            for cell in cells[1:]:
                ssid_match = re.search(r'ESSID:"([^"]+)"', cell)
                mac_match = re.search(r'Address:\s*([0-9A-Fa-f:]{17})', cell)
                sig_match = re.search(r'Signal level=(-?\d+)', cell)
                if ssid_match:
                    networks.append({
                        "ssid": ssid_match.group(1),
                        "mac": mac_match.group(1) if mac_match else None,
                        "signal": int(sig_match.group(1)) if sig_match else None
                    })
    except Exception as e:
        return {"error": str(e), "system": system}
    return {"networks": networks, "count": len(networks), "system": system}

def get_cell_tower_location(mcc, mnc, lac, cell_id):
    if OPENCELLID_API_KEY == "LAGAY_MO_DITO_ANG_API_KEY":
        return {"error": "API key not configured"}
    try:
        url = f"https://opencellid.org/ajax/searchCell.php?mcc={mcc}&mnc={mnc}&lac={lac}&cell_id={cell_id}"
        r = requests.get(url, timeout=10, headers={"User-Agent": "Mozilla/5.0"})
        data = r.json()
        if "lat" in data and "lon" in data:
            return {
                "latitude": float(data["lat"]),
                "longitude": float(data["lon"]),
                "accuracy_meters": int(data.get("range", 1000)),
                "source": "OpenCellID"
            }
        return {"error": data.get("message", "Tower not found")}
    except Exception as e:
        return {"error": str(e)}

def search_nearby_towers(lat, lon, radius_m=5000):
    if OPENCELLID_API_KEY == "LAGAY_MO_DITO_ANG_API_KEY":
        return {"error": "API key not configured"}
    try:
        url = f"https://opencellid.org/ajax/searchCell.php?lat={lat}&lon={lon}&range={radius_m}"
        r = requests.get(url, timeout=10, headers={"User-Agent": "Mozilla/5.0"})
        return r.json()
    except Exception as e:
        return {"error": str(e)}

def get_public_ip():
    try:
        r = requests.get("https://api.ipify.org?format=json", timeout=5)
        return r.json().get("ip")
    except:
        return None

def get_network_info():
    try:
        hostname = socket.gethostname()
        local_ip = socket.gethostbyname(hostname)
        return {"hostname": hostname, "local_ip": local_ip}
    except:
        return {"hostname": "unknown", "local_ip": "unknown"}

def haversine(lat1, lon1, lat2, lon2):
    R = 6371
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = math.sin(dlat/2)**2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon/2)**2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1-a))
    return R * c

def get_termux_cell_info():
    try:
        result = subprocess.run(["termux-telephony-deviceinfo"], capture_output=True, text=True, timeout=5)
        return json.loads(result.stdout)
    except:
        return None

def tracker():
    banner()
    time.sleep(0.3)

    section("TARGET ACQUISITION")
    net_info = get_network_info()
    pub_ip = get_public_ip()
    status("Hostname", net_info["hostname"])
    status("Local IP", net_info["local_ip"])
    status("Public IP", pub_ip if pub_ip else "Unknown", YELLOW)

    section("IP GEOLOCATION")
    ip_data = get_ip_location()
    if "error" in ip_data:
        err(ip_data["error"])
        return

    status("IP Address", ip_data["ip"])
    status("Country", ip_data["country"])
    status("Region", ip_data["region"])
    status("City", ip_data["city"])
    status("ZIP Code", ip_data["zip"] if ip_data["zip"] else "N/A", YELLOW)
    status("Coordinates", f"{ip_data['latitude']}, {ip_data['longitude']}")
    status("Timezone", ip_data["timezone"])
    status("ISP", ip_data["isp"])
    status("Organization", ip_data["org"])
    status("ASN", ip_data["asn"])
    status("Proxy/VPN", "DETECTED" if ip_data["proxy"] else "None", RED if ip_data["proxy"] else GREEN)
    status("Mobile Data", "Yes" if ip_data["mobile"] else "No", YELLOW if ip_data["mobile"] else GREEN)

    section("WIFI RECONNAISSANCE")
    wifi_data = get_wifi_networks()
    if "error" in wifi_data:
        warn(wifi_data["error"])
        wifi_count = 0
    else:
        status("System", wifi_data["system"])
        status("Networks Found", str(wifi_data["count"]), GREEN if wifi_data["count"] > 0 else YELLOW)
        for i, net in enumerate(wifi_data["networks"][:10]):
            sig = net.get("signal")
            sig_color = GREEN if sig and sig > -50 else YELLOW if sig and sig > -70 else RED
            print(f"  {DIM}[{i+1:02d}]{RESET} {net['ssid']:<20} {CYAN}MAC:{RESET}{net['mac'] or 'N/A'}  {sig_color}RSSI:{sig or 'N/A'}{RESET}")
        if wifi_data["count"] > 10:
            print(f"  {DIM}... and {wifi_data['count'] - 10} more networks{RESET}")
        wifi_count = wifi_data["count"]

    section("CELL TOWER INTELLIGENCE")
    cell_info = get_termux_cell_info()
    if cell_info:
        status("Network Type", cell_info.get("network_type", "Unknown"))
        status("MCC", str(cell_info.get("mcc", "N/A")))
        status("MNC", str(cell_info.get("mnc", "N/A")))
        status("LAC", str(cell_info.get("lac", "N/A")))
        status("Cell ID", str(cell_info.get("cid", "N/A")))
        status("Signal Strength", f"{cell_info.get('signal_strength', 'N/A')} dBm")

        if OPENCELLID_API_KEY != "LAGAY_MO_DITO_ANG_API_KEY":
            mcc = cell_info.get("mcc")
            mnc = cell_info.get("mnc")
            lac = cell_info.get("lac")
            cid = cell_info.get("cid")
            if all([mcc, mnc, lac, cid]):
                ok(f"Querying OpenCellID for tower {cid}...")
                tower = get_cell_tower_location(mcc, mnc, lac, cid)
                if "error" not in tower:
                    status("Tower Lat", str(tower["latitude"]))
                    status("Tower Lon", str(tower["longitude"]))
                    status("Accuracy", f"~{tower['accuracy_meters']}m")
                else:
                    warn(tower["error"])
            else:
                warn("Incomplete cell data for tower lookup")
        else:
            warn("OpenCellID API key not configured")
    else:
        warn("Termux telephony info unavailable")

    section("FUSED LOCATION ESTIMATE")
    confidence = "LOW"
    radius = "50+ km"
    sources = ["IP"]

    if wifi_count >= 10:
        confidence = "HIGH"
        radius = "500m - 2km"
        sources.append("WiFi Density")
    elif wifi_count >= 3:
        confidence = "MEDIUM"
        radius = "2-5 km"
        sources.append("WiFi Density")

    if ip_data.get("proxy"):
        confidence = "COMPROMISED"
        radius = "UNKNOWN"
        sources = ["IP (Proxy/VPN)"]

    status("Coordinates", f"{ip_data['latitude']}, {ip_data['longitude']}")
    status("Accuracy Radius", radius, RED if "50+" in radius else YELLOW if "km" in radius else GREEN)
    status("Confidence", confidence, RED if confidence == "LOW" else YELLOW if confidence == "MEDIUM" else GREEN)
    status("Data Sources", ", ".join(sources))

    section("NAVIGATION LINKS")
    lat, lon = ip_data["latitude"], ip_data["longitude"]
    print(f"  {CYAN}Google Maps:{RESET}     https://www.google.com/maps?q={lat},{lon}")
    print(f"  {CYAN}OpenStreetMap:{RESET}   https://www.openstreetmap.org/?mlat={lat}&mlon={lon}&zoom=16")
    print(f"  {CYAN}What3Words:{RESET}    https://what3words.com/{lat},{lon}")

    section("THREAT ASSESSMENT")
    print(f"  {DIM}IP Only        : ~5-50 km radius{RESET}")
    print(f"  {DIM}IP + WiFi      : ~1-5 km radius (density-based){RESET}")
    print(f"  {DIM}Cell Tower     : ~100m - 2 km radius{RESET}")
    print(f"  {DIM}WiFi MAC + API : ~10-100 m radius{RESET}")
    print(f"  {DIM}GPS Hardware   : ~1-10 m radius{RESET}")

    print(f"\n{MAGENTA}{'═' * 52}{RESET}")
    print(f"{GREEN}{BOLD}  TRACKING COMPLETE{RESET}")
    print(f"{MAGENTA}{'═' * 52}{RESET}\n")

if __name__ == "__main__":
    tracker()
