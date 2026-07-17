import requests
import math
import subprocess
import platform
import re
import json
import socket
import time
import os
import sys

OPENCELLID_API_KEY = "LAGAY_MO_DITO_ANG_API_KEY"

CYAN = "\033[96m"
GREEN = "\033[92m"
YELLOW = "\033[93m"
RED = "\033[91m"
MAGENTA = "\033[95m"
BLUE = "\033[94m"
BOLD = "\033[1m"
DIM = "\033[2m"
BLINK = "\033[5m"
RESET = "\033[0m"

def clear():
    os.system("clear" if os.name != "nt" else "cls")

def banner():
    clear()
    print(f"""{CYAN}
    ╔══════════════════════════════════════════════════════════════════╗
    ║  ██╗     ████████╗██████╗  █████╗  ██████╗██╗  ██╗███████╗      ║
    ║  ██║     ╚══██╔══╝██╔══██╗██╔══██╗██╔════╝██║ ██╔╝██╔════╝      ║
    ║  ██║        ██║   ██████╔╝███████║██║     █████╔╝ █████╗        ║
    ║  ██║        ██║   ██╔══██╗██╔══██║██║     ██╔═██╗ ██╔══╝        ║
    ║  ███████╗   ██║   ██║  ██║██║  ██║╚██████╗██║  ██╗███████╗      ║
    ║  ╚══════╝   ╚═╝   ╚═╝  ╚═╝╚═╝  ╚═╝ ╚═════╝╚═╝  ╚═╝╚══════╝      ║
    ║                                                                  ║
    ║     [ IP + WiFi + Cell Tower + Network Fusion Engine v3.1 ]     ║
    ║                                                                  ║
    ║     {RED}{BLINK}⚠  FOR EDUCATIONAL PURPOSES ONLY  ⚠{RESET}{CYAN}                    ║
    ╚══════════════════════════════════════════════════════════════════╝{RESET}
    """)

def section(title):
    print(f"\n{MAGENTA}{BOLD}[{title}]{RESET}")
    print(f"{DIM}{'─' * 55}{RESET}")

def status(label, value, color=GREEN):
    print(f"  {CYAN}{label:<22}{RESET} {color}{value}{RESET}")

def warn(msg):
    print(f"  {YELLOW}[!] {msg}{RESET}")

def err(msg):
    print(f"  {RED}[X] {msg}{RESET}")

def ok(msg):
    print(f"  {GREEN}[+] {msg}{RESET}")

def info(msg):
    print(f"  {BLUE}[i] {msg}{RESET}")

def get_public_ip():
    try:
        r = requests.get("https://api.ipify.org?format=json", timeout=5)
        return r.json().get("ip")
    except:
        return None

def get_target_ip():
    print(f"\n{CYAN}{BOLD}╔{'═' * 53}╗{RESET}")
    print(f"{CYAN}{BOLD}║{RESET}  {GREEN}TARGET SELECTION{RESET}{' ' * 34}{CYAN}{BOLD}║{RESET}")
    print(f"{CYAN}{BOLD}╠{'═' * 53}╣{RESET}")
    print(f"{CYAN}{BOLD}║{RESET}  [1] Track YOUR current IP address{' ' * 18}{CYAN}{BOLD}║{RESET}")
    print(f"{CYAN}{BOLD}║{RESET}  [2] Track SPECIFIC IP address{' ' * 23}{CYAN}{BOLD}║{RESET}")
    print(f"{CYAN}{BOLD}║{RESET}  [3] Track DOMAIN (resolve + geolocate){' ' * 14}{CYAN}{BOLD}║{RESET}")
    print(f"{CYAN}{BOLD}╚{'═' * 53}╝{RESET}")
    
    choice = input(f"\n  {CYAN}{BOLD}>>>{RESET} ").strip()
    
    if choice == "2":
        target = input(f"  {YELLOW}Enter IP address: {RESET}").strip()
        return target
    elif choice == "3":
        domain = input(f"  {YELLOW}Enter domain: {RESET}").strip()
        try:
            resolved = socket.gethostbyname(domain)
            ok(f"Resolved {domain} -> {resolved}")
            return resolved
        except:
            err(f"Failed to resolve {domain}")
            return None
    else:
        return None

def get_ip_location(ip=None):
    providers = []
    
    try:
        url = f"http://ip-api.com/json/{ip}?fields=status,message,country,regionName,city,zip,lat,lon,timezone,isp,org,as,query,proxy,mobile,hosting" if ip else "http://ip-api.com/json/?fields=status,message,country,regionName,city,zip,lat,lon,timezone,isp,org,as,query,proxy,mobile,hosting"
        r = requests.get(url, timeout=8)
        d = r.json()
        if d.get("status") == "success":
            providers.append({
                "source": "ip-api",
                "ip": d.get("query"),
                "country": d.get("country"),
                "country_code": d.get("countryCode"),
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
                "hosting": d.get("hosting"),
                "mobile": d.get("mobile")
            })
    except:
        pass
    
    try:
        url2 = f"https://ipwho.is/{ip}" if ip else "https://ipwho.is/"
        r2 = requests.get(url2, timeout=8)
        d2 = r2.json()
        if d2.get("success"):
            providers.append({
                "source": "ipwho.is",
                "ip": d2.get("ip"),
                "country": d2.get("country"),
                "country_code": d2.get("country_code"),
                "region": d2.get("region"),
                "city": d2.get("city"),
                "zip": d2.get("postal"),
                "latitude": d2.get("latitude"),
                "longitude": d2.get("longitude"),
                "timezone": d2.get("timezone", {}).get("id"),
                "isp": d2.get("connection", {}).get("isp"),
                "org": d2.get("connection", {}).get("org"),
                "asn": d2.get("connection", {}).get("asn"),
                "proxy": None,
                "hosting": None,
                "mobile": None
            })
    except:
        pass
    
    if not providers:
        return {"error": "All providers failed"}
    
    best = providers[0]
    if len(providers) > 1:
        lat_sum = sum(p["latitude"] for p in providers if p.get("latitude"))
        lon_sum = sum(p["longitude"] for p in providers if p.get("longitude"))
        count = sum(1 for p in providers if p.get("latitude"))
        if count > 0:
            best["latitude"] = round(lat_sum / count, 6)
            best["longitude"] = round(lon_sum / count, 6)
        best["sources"] = [p["source"] for p in providers]
    
    return best

def get_wifi_networks():
    networks = []
    system = platform.system()
    try:
        if "ANDROID_ROOT" in os.environ:
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

def reverse_dns(ip):
    try:
        return socket.gethostbyaddr(ip)[0]
    except:
        return None

def get_whois(ip):
    try:
        result = subprocess.run(["whois", ip], capture_output=True, text=True, timeout=10)
        output = result.stdout
        org = re.search(r'OrgName:\s+(.+)', output)
        country = re.search(r'Country:\s+(.+)', output)
        netrange = re.search(r'NetRange:\s+(.+)', output)
        return {
            "org": org.group(1).strip() if org else None,
            "country": country.group(1).strip() if country else None,
            "netrange": netrange.group(1).strip() if netrange else None
        }
    except:
        return None

def scan_common_ports(ip):
    common_ports = [21, 22, 23, 25, 53, 80, 110, 143, 443, 445, 993, 995, 3306, 3389, 8080, 8443]
    open_ports = []
    for port in common_ports:
        try:
            sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            sock.settimeout(0.5)
            result = sock.connect_ex((ip, port))
            if result == 0:
                open_ports.append(port)
            sock.close()
        except:
            pass
    return open_ports

def get_termux_cell_info():
    try:
        result = subprocess.run(["termux-telephony-deviceinfo"], capture_output=True, text=True, timeout=5)
        return json.loads(result.stdout)
    except:
        return None

def haversine(lat1, lon1, lat2, lon2):
    R = 6371
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = math.sin(dlat/2)**2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon/2)**2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1-a))
    return R * c

def loading_animation(text, duration=2):
    chars = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]
    end_time = time.time() + duration
    i = 0
    while time.time() < end_time:
        sys.stdout.write(f"\r  {CYAN}{chars[i % len(chars)]}{RESET} {text}")
        sys.stdout.flush()
        time.sleep(0.1)
        i += 1
    sys.stdout.write(f"\r  {GREEN}[✓]{RESET} {text} Complete\n")
    sys.stdout.flush()

def tracker():
    banner()
    
    target_ip = get_target_ip()
    if target_ip is None:
        target_ip = ""
    
    print(f"\n  {YELLOW}{BOLD}INITIATING RECONNAISSANCE...{RESET}")
    time.sleep(0.5)
    
    loading_animation("Resolving target", 1.5)
    loading_animation("Querying geolocation databases", 2)
    loading_animation("Analyzing network topology", 1.5)
    
    section("TARGET PROFILE")
    if target_ip:
        status("Target IP", target_ip, YELLOW)
    else:
        status("Mode", "Self-Tracking (Current Device)", GREEN)
    
    pub_ip = get_public_ip()
    if not target_ip:
        status("Public IP", pub_ip if pub_ip else "Unknown")
    else:
        status("Your IP", pub_ip if pub_ip else "Unknown", DIM)
        status("Target IP", target_ip, RED)
    
    rdns = reverse_dns(target_ip if target_ip else pub_ip)
    if rdns:
        status("Reverse DNS", rdns, MAGENTA)
    
    section("IP GEOLOCATION [MULTI-SOURCE FUSION]")
    ip_data = get_ip_location(target_ip)
    if "error" in ip_data:
        err(ip_data["error"])
        return
    
    status("IP Address", ip_data["ip"])
    status("Country", f"{ip_data.get('country', 'N/A')} ({ip_data.get('country_code', 'N/A')})")
    status("Region", ip_data.get("region", "N/A"))
    status("City", ip_data.get("city", "N/A"))
    status("ZIP Code", ip_data.get("zip") if ip_data.get("zip") else "N/A", YELLOW)
    status("Coordinates", f"{ip_data['latitude']}, {ip_data['longitude']}")
    status("Timezone", ip_data.get("timezone", "N/A"))
    status("ISP", ip_data.get("isp", "N/A"))
    status("Organization", ip_data.get("org", "N/A"))
    status("ASN", ip_data.get("asn", "N/A"))
    status("Proxy/VPN", "DETECTED" if ip_data.get("proxy") else "None", RED if ip_data.get("proxy") else GREEN)
    status("Hosting/Datacenter", "YES" if ip_data.get("hosting") else "No", RED if ip_data.get("hosting") else GREEN)
    status("Mobile Data", "Yes" if ip_data.get("mobile") else "No", YELLOW if ip_data.get("mobile") else GREEN)
    
    if "sources" in ip_data:
        status("Data Sources", ", ".join(ip_data["sources"]), BLUE)
    
    section("WHOIS INTELLIGENCE")
    whois_data = get_whois(target_ip if target_ip else pub_ip)
    if whois_data:
        if whois_data.get("org"):
            status("Registered Org", whois_data["org"])
        if whois_data.get("country"):
            status("Registry Country", whois_data["country"])
        if whois_data.get("netrange"):
            status("Net Range", whois_data["netrange"])
    else:
        warn("WHOIS data unavailable (whois command not installed)")
    
    section("PORT RECONNAISSANCE")
    scan_target = target_ip if target_ip else pub_ip
    if scan_target:
        ok(f"Scanning {scan_target} for open ports...")
        open_ports = scan_common_ports(scan_target)
        if open_ports:
            for port in open_ports:
                service = {
                    21: "FTP", 22: "SSH", 23: "Telnet", 25: "SMTP", 53: "DNS",
                    80: "HTTP", 110: "POP3", 143: "IMAP", 443: "HTTPS", 445: "SMB",
                    993: "IMAPS", 995: "POP3S", 3306: "MySQL", 3389: "RDP",
                    8080: "HTTP-Alt", 8443: "HTTPS-Alt"
                }.get(port, "Unknown")
                status(f"Port {port}", f"OPEN ({service})", RED)
        else:
            info("No common ports open or host blocking scans")
    
    section("WIFI RECONNAISSANCE")
    wifi_data = get_wifi_networks()
    if "error" in wifi_data:
        warn(wifi_data["error"])
        wifi_count = 0
    else:
        status("System", wifi_data["system"])
        status("Networks Found", str(wifi_data["count"]), GREEN if wifi_data["count"] > 0 else YELLOW)
        for i, net in enumerate(wifi_data["networks"][:12]):
            sig = net.get("signal")
            sig_color = GREEN if sig and sig > -50 else YELLOW if sig and sig > -70 else RED
            ssid = net['ssid'][:18] if len(net['ssid']) > 18 else net['ssid']
            print(f"  {DIM}[{i+1:02d}]{RESET} {ssid:<20} {CYAN}MAC:{RESET}{net['mac'] or 'N/A'}  {sig_color}RSSI:{sig or 'N/A'}{RESET}")
        if wifi_data["count"] > 12:
            print(f"  {DIM}... and {wifi_data['count'] - 12} more networks{RESET}")
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
    else:
        warn("Termux telephony info unavailable (install termux-api app)")
    
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
    
    if ip_data.get("proxy") or ip_data.get("hosting"):
        confidence = "COMPROMISED"
        radius = "UNKNOWN"
        sources = ["IP (Anonymized/Hosting)"]
    
    status("Coordinates", f"{ip_data['latitude']}, {ip_data['longitude']}")
    status("Accuracy Radius", radius, RED if "50+" in radius or "UNKNOWN" in radius else YELLOW if "km" in radius else GREEN)
    status("Confidence", confidence, RED if confidence in ["LOW", "COMPROMISED"] else YELLOW if confidence == "MEDIUM" else GREEN)
    status("Data Sources", ", ".join(sources))
    
    section("NAVIGATION LINKS")
    lat, lon = ip_data["latitude"], ip_data["longitude"]
    print(f"  {CYAN}Google Maps:{RESET}      https://www.google.com/maps?q={lat},{lon}")
    print(f"  {CYAN}OpenStreetMap:{RESET}    https://www.openstreetmap.org/?mlat={lat}&mlon={lon}&zoom=16")
    print(f"  {CYAN}What3Words:{RESET}     https://what3words.com/{lat},{lon}")
    print(f"  {CYAN}Google Earth:{RESET}     https://earth.google.com/web/search/{lat},{lon}")
    
    section("THREAT ASSESSMENT")
    print(f"  {DIM}IP Only           : ~5-50 km radius{RESET}")
    print(f"  {DIM}IP + WiFi         : ~1-5 km radius (density-based){RESET}")
    print(f"  {DIM}Cell Tower        : ~100m - 2 km radius{RESET}")
    print(f"  {DIM}WiFi MAC + API    : ~10-100 m radius{RESET}")
    print(f"  {DIM}GPS Hardware      : ~1-10 m radius{RESET}")
    print(f"  {DIM}Multi-Source Fuse : Best available from all sources{RESET}")
    
    print(f"\n{MAGENTA}{'═' * 57}{RESET}")
    print(f"{GREEN}{BOLD}  RECONNAISSANCE COMPLETE{RESET}")
    print(f"{MAGENTA}{'═' * 57}{RESET}\n")

if __name__ == "__main__":
    tracker()
