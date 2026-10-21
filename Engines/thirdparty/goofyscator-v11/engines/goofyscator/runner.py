from __future__ import annotations

import asyncio
import json
import os
from pathlib import Path
import shutil
import signal
import tempfile

ROOT = Path(__file__).resolve().parent.parent


async def run_goofyscator(source: str, timeout: float = 300) -> tuple[Path, dict]:
    if len(source.encode('utf-8')) > 5_000_000:
        raise ValueError('Source exceeds 5 MB')
    node = shutil.which('node')
    if not node:
        raise RuntimeError('Goofyscator analysis requires Node.js')
    directory = Path(tempfile.mkdtemp(prefix='luaenvlog_gv11d_'))
    process = None
    try:
        input_path = directory / 'input.lua'
        output = directory / 'goofyscator-v11-analysis.json'
        input_path.write_text(source, encoding='utf-8')
        process = await asyncio.create_subprocess_exec(
            node, str(ROOT / 'obf/node_modules/tsx/dist/cli.mjs'),
            str(ROOT / 'goofyscator/cli.mjs'), str(input_path), str(output), cwd=str(ROOT),
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
            start_new_session=os.name != 'nt',
        )
        stdout, stderr = await asyncio.wait_for(process.communicate(), timeout)
        try:
            summary = json.loads(stdout.decode('utf-8').strip().splitlines()[-1])
        except (ValueError, IndexError):
            raise RuntimeError('Goofyscator analysis returned no result: ' + stderr.decode('utf-8', 'replace')[:600])
        if process.returncode or not summary.get('ok'):
            raise RuntimeError('Goofyscator V11 analysis failed: ' + str(summary.get('error', 'no result'))[:900])
        if not summary.get('artifact_only'):
            output = directory / 'deobfuscated.lua'
        if not output.is_file() or not output.stat().st_size:
            raise RuntimeError('Goofyscator analysis produced no artifact')
        if summary.get('artifact_only') and output.stat().st_size > 65_536:
            raise RuntimeError('Goofyscator recovery failed; oversized diagnostic report withheld')
        return output, summary
    except BaseException as error:
        if process is not None and process.returncode is None:
            if os.name == 'nt':
                killer = await asyncio.create_subprocess_exec('taskkill', '/PID', str(process.pid), '/T', '/F',
                    stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL)
                await killer.wait()
            else:
                try:
                    os.killpg(process.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
            await process.communicate()
        shutil.rmtree(directory, ignore_errors=True)
        if isinstance(error, asyncio.TimeoutError):
            raise RuntimeError(f'Goofyscator analysis timed out ({timeout:g}s)') from error
        raise
