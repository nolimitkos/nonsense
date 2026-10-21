# Credits to LLH Lua Land | .gg/Zame2JAGDr
# LuaObfuscator Alpha Chaotic Evil Deobfuscator

import re

def deobfuscate_chaotic_evil(script_text):
    blobs = _extract_luaobfuscator_blobs(script_text)
    if not blobs:
        return None
    for blob_data in blobs:
        constants = _parse_luaobf_blob_string_constants(blob_data)
        if not constants:
            continue
        url_results = []
        lua_results = []
        seen = set()
        for ki, klen, key_bytes in constants:
            if klen < 4 or klen > 128:
                continue
            for di, dlen, data_bytes in constants:
                if di == ki or dlen <= klen:
                    continue
                decrypted_raw = _xor_decrypt_v7(data_bytes, key_bytes)
                try:
                    text = decrypted_raw.decode("utf-8")
                except UnicodeDecodeError:
                    try:
                        text = decrypted_raw.decode("latin-1")
                    except Exception:
                        continue
                if not text or text in seen:
                    continue
                printable_ratio = sum(c.isprintable() or c in "\n\r\t" for c in text) / max(len(text), 1)
                if printable_ratio < 0.88:
                    continue
                seen.add(text)
                stripped = text.strip().rstrip("\x00")
                if re.match(r"https?://", stripped):
                    url_results.append(stripped)
                elif _looks_like_lua_source(stripped):
                    cleaned = _remove_lua_comments(stripped).strip()
                    if _looks_like_lua_source(cleaned):
                        lua_results.append(_rename_obfuscated_lua_identifiers(cleaned).strip())
        if lua_results:
            return max(lua_results, key=len)
        if url_results:
            url = url_results[0]
            return f'loadstring(game:HttpGet("{url}"))()'
    return None

def _xor_decrypt_v7(encrypted, key):
    if not key or not encrypted:
        return encrypted
    result = bytearray(len(encrypted))
    key_len = len(key)
    for i in range(len(encrypted)):
        result[i] = encrypted[i] ^ key[(i + 1) % key_len]
    return bytes(result)

def _parse_luaobf_blob_string_constants(blob_data):
    constants = []
    i = 0
    length = len(blob_data)
    while i < length - 5:
        if blob_data[i] == 0x03:
            str_len = blob_data[i + 1]
            if str_len > 0 and (i + 5 + str_len) <= length:
                if blob_data[i+2] == 0 and blob_data[i+3] == 0 and blob_data[i+4] == 0:
                    str_bytes = blob_data[i+5:i+5+str_len]
                    constants.append((i, str_len, str_bytes))
                    i += 5 + str_len
                    continue
        i += 1
    return constants

def _extract_luaobfuscator_blobs(content):
    blobs = []
    pattern = re.compile(r'"(LOL![0-9A-Fa-f2-9Q]+)"')
    for match in pattern.finditer(content):
        encoded = match.group(1)
        decoded = _decode_luaobfuscator_blob(encoded)
        if decoded:
            blobs.append(decoded)
    return blobs

def _decode_luaobfuscator_blob(value):
    if not value.startswith("LOL!"):
        return b""
    encoded = value[4:]
    decoded = bytearray()
    repeat_count = 1
    for index in range(0, len(encoded) - 1, 2):
        pair = encoded[index:index + 2]
        if pair[1] == "Q":
            if pair[0].isdigit():
                repeat_count = int(pair[0])
            continue
        try:
            decoded.extend(bytes([int(pair, 16)]) * repeat_count)
        except ValueError:
            return b""
        repeat_count = 1
    return bytes(decoded)

def _looks_like_lua_source(value):
    if not value or len(value) < 8:
        return False
    printable_ratio = sum(c in "\n\r\t" or ord(c) >= 32 for c in value) / len(value)
    if printable_ratio < 0.96:
        return False
    return bool(
        re.search(
            r"\b(?:local|function|return|if|then|else|elseif|for|while|repeat|"
            r"do|end|print|string|table|loadstring|require)\b",
            value,
        )
        and re.search(r"\b(?:local|function|return|if|for|while|print)\b", value)
        and ("=" in value or "(" in value or "\n" in value)
    )

def _remove_lua_comments(code):
    output = []
    index = 0
    length = len(code)
    quote = None
    long_string_pattern = re.compile(r"\[(=*)\[")
    long_comment_pattern = re.compile(r"--\[(=*)\[")
    while index < length:
        ch = code[index]
        if quote:
            output.append(ch)
            if ch == "\\" and index + 1 < length:
                index += 1
                output.append(code[index])
            elif ch == quote:
                quote = None
            index += 1
            continue
        if ch in ("'", '"'):
            quote = ch
            output.append(ch)
            index += 1
            continue
        if ch == "[":
            long_string = long_string_pattern.match(code, index)
            if long_string:
                opener = long_string.group(0)
                closer = "]" + long_string.group(1) + "]"
                end = code.find(closer, index + len(opener))
                if end == -1:
                    output.append(code[index:])
                    break
                output.append(code[index:end + len(closer)])
                index = end + len(closer)
                continue
        if ch == "-" and index + 1 < length and code[index + 1] == "-":
            long_comment = long_comment_pattern.match(code, index)
            if long_comment:
                opener = long_comment.group(0)
                closer = "]" + long_comment.group(1) + "]"
                end = code.find(closer, index + len(opener))
                index = length if end == -1 else end + len(closer)
            else:
                newline = code.find("\n", index + 2)
                index = length if newline == -1 else newline
            continue
        output.append(ch)
        index += 1
    return "".join(output)

def _rename_obfuscated_lua_identifiers(code):
    renamed = {}
    ident_pattern = re.compile(
        r"\b(?:r|v|var|value|f|fn|func|t|tbl|table|s|str|string|n|num|number|l|local|a|b|c|d|x|y|z)\d{1,3}\b",
        re.IGNORECASE,
    )
    token_pattern = re.compile(r"[A-Za-z_][A-Za-z0-9_]*")
    long_string_pattern = re.compile(r"\[(=*)\[")
    def repl(match):
        ident = match.group(0)
        prefix_match = re.match(r"[A-Za-z]+", ident)
        number_match = re.search(r"\d+", ident)
        if not prefix_match or not number_match:
            return ident
        prefix = prefix_match.group(0).lower()
        number = number_match.group(0)
        names = {
            "v": "value", "var": "value", "value": "value",
            "f": "function", "fn": "function", "func": "function",
            "t": "table", "tbl": "table",
            "s": "string", "str": "string",
            "n": "number", "num": "number",
            "l": "local",
            "a": "argument", "b": "buffer", "c": "context",
            "d": "data", "x": "coord_x", "y": "coord_y", "z": "coord_z"
        }
        new = f"{names.get(prefix, 'variable')}_{number}"
        renamed.setdefault(ident, new)
        return renamed[ident]
    output = []
    idx = 0
    length = len(code)
    prev = ""
    while idx < length:
        ch = code[idx]
        if ch in ("'", '"'):
            quote = ch
            start = idx
            idx += 1
            while idx < length:
                if code[idx] == "\\":
                    idx += 2
                    continue
                if code[idx] == quote:
                    idx += 1
                    break
                idx += 1
            output.append(code[start:idx])
            prev = quote
            continue
        if ch == "[":
            long_string = long_string_pattern.match(code, idx)
            if long_string:
                opener = long_string.group(0)
                closer = "]" + long_string.group(1) + "]"
                end = code.find(closer, idx + len(opener))
                if end == -1:
                    output.append(code[idx:])
                    break
                end += len(closer)
                output.append(code[idx:end])
                idx = end
                prev = "]"
                continue
        ident = token_pattern.match(code, idx)
        if ident:
            token = ident.group(0)
            if prev in (".", ":"):
                output.append(token)
            else:
                output.append(ident_pattern.sub(repl, token))
            prev = token[-1:]
            idx += len(token)
            continue
        output.append(ch)
        if not ch.isspace():
            prev = ch
        idx += 1
    return "".join(output)
