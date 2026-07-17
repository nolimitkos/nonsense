import requests
import math
import subprocess
import platform
import re
import json
import socket
import struct

# ============================================
# CONFIGURATION - Lagay mo dito ang API key mo
# ============================================
OPENCELLID_API_KEY = "LAGAY_MO_DITO_ANG_API_KEY"  # Kunin sa https://www.opencellid.org/

# ============================================
# IP GEOLOCATION
# ============================================
def get_ip_location(ip=None):
    try:
        url = f"http://ip-api.com/json/{ip}?fields=status,message,country,regionName,city,zip,lat,lon,timezone,isp,org,as,query,proxy,mobile" if ip else "http://ip-api.com/json/?fields=status,message,country,regionName,city,zip,lat,lon,timezone,isp,org,as,query,proxy,mobile"
        r = requests.get(url, timeout=8)
        d = r.json()
        if d.get("status") == "success":
            return {
                "source": "IP Geolocation",
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
                "mobile": d.get("mobile"),
                "accuracy_radius_km": "5-50",
                "confidence": "low"
            }
    except Exception as e:
        return {"source": "IP Geolocation", "error": str(e)}
    return {"source": "IP Geolocation", "error": "Failed"}

# ============================================
# OPENCELLID - CELL TOWER GEOLOCATION
# ============================================
def get_cell_tower_location(mcc, mnc, lac, cell_id, radio="gsm"):
    if OPENCELLID_API_KEY == "LAGAY_MO_DITO_ANG_API_KEY":
        return {"error": "No API key configured. Get free key at https://www.opencellid.org/"}
    
    try:
        url = f"https://us1.unwiredlabs.com/v2/process.php"
        payload = {
            "token": OPENCELLID_API_KEY,
            "radio": radio,
            "mcc": mcc,
            "mnc": mnc,
            "cells": [{"lac": lac, "cid": cell_id}],
            "address": 1
        }
        r = requests.post(url, json=payload, timeout=10)
        data = r.json()
        
        if data.get("status") == "ok":
            return {
                "source": "OpenCellID (Cell Tower)",
                "latitude": data.get("lat"),
                "longitude": data.get("lon"),
                "accuracy_meters": data.get("accuracy"),
                "address": data.get("address"),
                "balance": data.get("balance"),
                "confidence": "medium" if data.get("accuracy", 9999) < 1000 else "low"
            }
        else:
            return {"error": data.get("message", "Unknown error"), "status": data.get("status")}
    except Exception as e:
        return {"error": str(e)}

def search_nearby_cell_towers(lat, lon, radius_m=1000, limit=10):
    if OPENCELLID_API_KEY == "LAGAY_MO_DITO_ANG_API_KEY":
        return {"error": "No API key configured"}
    
    try:
        url = "https://us1.unwiredlabs.com/v2/process.php"
        payload = {
            "token": pk.f0b467ed92c7b7515d68885f475c1994,
            "lat": lat,
            "lon": lon,
            "radius": radius_m,
            "limit": limit
        }
        r = requests.post(url, json=payload, timeout=10)
        return r.json()
    except Exception as e:
        return {"error": str(e)}

# ============================================
# WIFI NETWORK SCANNING
# ============================================
def get_wifi_networks():
    networks = []
    system = platform.system()
    try:
        if system == "Windows":
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

# ============================================
# NETWORK DATA
# ============================================
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

# ============================================
# FUSION ENGINE
# ============================================
def haversine(lat1, lon1, lat2, lon2):
    R = 6371
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = math.sin(dlat/2)**2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon/2)**2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1-a))
    return R * c

def fuse_locations(ip_data, cell_data, wifi_count):
    locations = []
    
    if "latitude" in ip_data and "longitude" in ip_data:
        locations.append({
            "lat": ip_data["latitude"],
            "lon": ip_data["longitude"],
            "weight": 1,
            "source": "IP",
            "accuracy": 25000
        })
    
    if "latitude" in cell_data and "longitude" in cell_data:
        acc = cell_data.get("accuracy_meters", 1000)
        locations.append({
            "lat": cell_data["latitude"],
            "lon": cell_data["longitude"],
            "weight": 3 if acc < 500 else 2,
            "source": "Cell Tower",
            "accuracy": acc
        })
    
    if not locations:
        return None, "No location data available"
    
    total_weight = sum(l["weight"] for l in locations)
    avg_lat = sum(l["lat"] * l["weight"] for l in locations) / total_weight
    avg_lon = sum(l["lon"] * l["weight"] for l in locations) / total_weight
    
    min_accuracy = min(l["accuracy"] for l in locations)
    
    if wifi_count >= 10:
        confidence = "high"
        radius = f"{min_accuracy}m (WiFi dense area)"
    elif wifi_count >= 5:
        confidence = "medium"
        radius = f"{min_accuracy * 2}m"
    elif min_accuracy < 1000:
        confidence = "medium"
        radius = f"{min_accuracy}m"
    else:
        confidence = "low"
        radius = f"{min_accuracy}m"
    
    if ip_data.get("proxy"):
        confidence = "very low (VPN/Proxy)"
    
    return {
        "latitude": round(avg_lat, 6),
        "longitude": round(avg_lon, 6),
        "accuracy_radius": radius,
        "confidence": confidence,
        "sources_used": [l["source"] for l in locations]
    }, None

# ============================================
# MAIN TRACKER
# ============================================
def combined_location_tracker():
    print("=" * 65)
    print("COMBINED LOCATION TRACKER v2.0")
    print("IP + WiFi + Cell Tower + Network Data Fusion")
    print("=" * 65)

    print("\n[1] NETWORK INFO")
    print("-" * 45)
    net_info = get_network_info()
    pub_ip = get_public_ip()
    print(f"  Hostname: {net_info['hostname']}")
    print(f"  Local IP: {net_info['local_ip']}")
    print(f"  Public IP: {pub_ip}")

    print("\n[2] IP GEOLOCATION")
    print("-" * 45)
    ip_data = get_ip_location()
    for k, v in ip_data.items():
        print(f"  {k}: {v}")

    print("\n[3] WIFI NETWORKS")
    print("-" * 45)
    wifi_data = get_wifi_networks()
    if "error" in wifi_data:
        print(f"  Error: {wifi_data['error']}")
        print(f"  System: {wifi_data.get('system', 'unknown')}")
        wifi_count = 0
    else:
        print(f"  System: {wifi_data['system']}")
        print(f"  Networks Found: {wifi_data['count']}")
        for i, net in enumerate(wifi_data['networks'][:8]):
            print(f"    [{i+1}] {net['ssid']} | MAC: {net['mac']} | Signal: {net['signal']}")
        if wifi_data['count'] > 8:
            print(f"    ... and {wifi_data['count'] - 8} more")
        wifi_count = wifi_data['count']

    print("\n[4] OPENCELLID (Cell Tower)")
    print("-" * 45)
    print("  NOTE: Configure OPENCELLID_API_KEY to use this feature")
    print("  Get free key at: https://www.opencellid.org/")
    cell_data = {"error": "API key not configured"}
    if OPENCELLID_API_KEY != "LAGAY_MO_DITO_ANG_API_KEY":
        print("  Searching nearby cell towers from IP location...")
        if "latitude" in ip_data:
            nearby = search_nearby_cell_towers(ip_data["latitude"], ip_data["longitude"], radius_m=5000, limit=5)
            print(f"  Nearby towers: {nearby}")
    else:
        print(f"  {cell_data['error']}")

    print("\n[5] FUSED LOCATION ESTIMATE")
    print("-" * 45)
    fused, err = fuse_locations(ip_data, cell_data, wifi_count)
    if err:
        print(f"  Error: {err}")
    else:
        print(f"  Coordinates: {fused['latitude']}, {fused['longitude']}")
        print(f"  Accuracy: {fused['accuracy_radius']}")
        print(f"  Confidence: {fused['confidence']}")
        print(f"  Sources: {', '.join(fused['sources_used'])}")
        
        print(f"\n  Google Maps: https://www.google.com/maps?q={fused['latitude']},{fused['longitude']}")
        print(f"  OpenStreetMap: https://www.openstreetmap.org/?mlat={fused['latitude']}&mlon={fused['longitude']}&zoom=16")

    print("\n[6] ACCURACY COMPARISON")
    print("-" * 45)
    print("  IP Only        : ~5-50 km radius")
    print("  IP + WiFi Count: ~1-5 km radius (density indicator)")
    print("  Cell Tower     : ~100m - 2 km radius")
    print("  WiFi MAC + API : ~10-100 m radius (needs Google/Unwired API)")
    print("  GPS            : ~1-10 m radius (needs hardware)")
    print("=" * 65)

if __name__ == "__main__":
    combined_location_tracker()
